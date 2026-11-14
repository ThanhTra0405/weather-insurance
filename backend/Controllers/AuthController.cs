using System.Globalization;
using System.Security.Cryptography;
using backend.Auth;
using backend.Common;
using backend.Data;
using backend.Data.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nethereum.Signer;

namespace backend.Controllers
{
    /// <summary>Đăng ký / đăng nhập nông dân bằng chữ ký ví, đăng nhập nhân viên bằng email + mật khẩu (SPEC-B mục 2).</summary>
    [ApiController]
    [Route("api/auth")]
    [EnableRateLimiting("auth")]
    public class AuthController : ControllerBase
    {
        private static readonly TimeSpan NonceLifetime = TimeSpan.FromMinutes(5);
        private const int BcryptCost = 11;
        private const int MinStaffPasswordLength = 10;

        // Hash giả để thời gian phản hồi không lộ email có tồn tại hay không.
        private static readonly Lazy<string> DummyHash =
            new(() => BCrypt.Net.BCrypt.HashPassword("mat-khau-gia-de-chong-do-thoi-gian", BcryptCost));

        private readonly AppDbContext _db;
        private readonly JwtService _jwt;
        private readonly IAuditLog _audit;
        private readonly StaffLoginThrottle _throttle;
        private readonly ILogger<AuthController> _logger;

        public AuthController(AppDbContext db, JwtService jwt, IAuditLog audit, StaffLoginThrottle throttle,
            ILogger<AuthController> logger)
        {
            _db = db;
            _jwt = jwt;
            _audit = audit;
            _throttle = throttle;
            _logger = logger;
        }

        // ============ Nông dân: nonce, đăng ký, đăng nhập ============

        [HttpGet("nonce")]
        public async Task<IActionResult> GetNonce([FromQuery] string? address, CancellationToken ct)
        {
            if (!WalletAddress.TryNormalize(address, out var wallet))
                return ApiResults.Validation(new Dictionary<string, string> { ["address"] = "Địa chỉ ví không hợp lệ" });

            var now = DateTimeOffset.UtcNow;
            var expiresAt = TruncateToSeconds(now.Add(NonceLifetime));
            var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

            // Dọn các nonce đã hết hạn của mọi ví.
            await _db.AuthNonces.Where(n => n.ExpiresAt < now).ExecuteDeleteAsync(ct);

            var row = await _db.AuthNonces.FirstOrDefaultAsync(n => n.WalletAddress == wallet, ct);
            if (row == null)
            {
                _db.AuthNonces.Add(new AuthNonce { WalletAddress = wallet, Nonce = nonce, ExpiresAt = expiresAt });
            }
            else
            {
                row.Nonce = nonce;
                row.ExpiresAt = expiresAt;
            }
            await _db.SaveChangesAsync(ct);

            return Ok(new { nonce, message = BuildMessage(wallet, nonce, expiresAt), expiresAt });
        }

        [HttpPost("register")]
        public async Task<IActionResult> Register([FromBody] RegisterRequest? request, CancellationToken ct)
        {
            if (request == null)
                return ApiResults.BadRequest("Thiếu dữ liệu đăng ký", "VALIDATION");

            var verified = await VerifySignatureAsync(request.Address, request.Signature, ct);
            if (verified.Error != null) return verified.Error;
            var wallet = verified.Wallet!;

            if (await _db.FarmerProfiles.AnyAsync(p => p.WalletAddress == wallet, ct))
                return ApiResults.Conflict("Ví này đã đăng ký, hãy đăng nhập", "ALREADY_REGISTERED");

            var fields = ProfileValidator.Validate(request.Profile);
            if (fields.Count > 0) return ApiResults.Validation(fields);

            var now = DateTimeOffset.UtcNow;
            var profile = new FarmerProfile { WalletAddress = wallet, CreatedAt = now, UpdatedAt = now };
            ProfileValidator.Apply(profile, request.Profile!);

            _db.FarmerProfiles.Add(profile);
            _db.AuthNonces.Remove(verified.Nonce!); // nonce chỉ dùng một lần
            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                // Nonce đã bị request khác dùng mất.
                return NonceExpired();
            }
            catch (DbUpdateException ex)
            {
                // Hai request đăng ký cùng lúc, hoặc nonce vừa bị dùng: kiểm tra lại để trả mã lỗi đúng.
                _db.ChangeTracker.Clear();
                if (await _db.FarmerProfiles.AnyAsync(p => p.WalletAddress == wallet, ct))
                    return ApiResults.Conflict("Ví này đã đăng ký, hãy đăng nhập", "ALREADY_REGISTERED");

                _logger.LogError(ex, "Không lưu được hồ sơ đăng ký của ví {Wallet}", wallet);
                throw;
            }

            await _audit.WriteAsync("farmer", wallet, "register", wallet, null, ct);
            return Ok(FarmerSession(wallet, profile));
        }

        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginRequest? request, CancellationToken ct)
        {
            if (request == null)
                return ApiResults.BadRequest("Thiếu dữ liệu đăng nhập", "VALIDATION");

            var verified = await VerifySignatureAsync(request.Address, request.Signature, ct);
            if (verified.Error != null) return verified.Error;
            var wallet = verified.Wallet!;

            // Dùng nonce xong là xoá (kể cả khi ví chưa đăng ký) để không thể phát lại chữ ký.
            _db.AuthNonces.Remove(verified.Nonce!);
            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                // Nonce đã bị request khác dùng mất.
                return ApiResults.Unauthorized("Phiên đăng nhập đã hết hạn, vui lòng thử lại", "NONCE_EXPIRED");
            }

            var profile = await _db.FarmerProfiles.AsNoTracking()
                .FirstOrDefaultAsync(p => p.WalletAddress == wallet, ct);
            if (profile == null)
                return ApiResults.NotFound("Ví này chưa đăng ký tài khoản", "NOT_REGISTERED");

            await _audit.WriteAsync("farmer", wallet, "login", wallet, null, ct);
            return Ok(FarmerSession(wallet, profile));
        }

        // ============ Nhân viên ============

        [HttpPost("staff/login")]
        public async Task<IActionResult> StaffLogin([FromBody] StaffLoginRequest? request, CancellationToken ct)
        {
            var email = (request?.Email ?? "").Trim().ToLowerInvariant();
            var password = request?.Password ?? "";
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var key = $"{email}|{ip}";

            if (_throttle.IsBlocked(key))
                return ApiResults.TooManyRequests("Đăng nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút");

            var staff = email.Length == 0
                ? null
                : await _db.Staff.AsNoTracking().FirstOrDefaultAsync(s => s.Email == email, ct);

            var passwordOk = BCrypt.Net.BCrypt.Verify(password, staff?.PasswordHash ?? DummyHash.Value);
            if (staff == null || !staff.Active || !passwordOk)
            {
                _throttle.RecordFailure(key);
                await _audit.WriteAsync("staff", email.Length == 0 ? null : email, "staff_login_failed", null,
                    new { ip }, ct);
                return ApiResults.Unauthorized("Sai email hoặc mật khẩu");
            }

            _throttle.Reset(key);
            var token = _jwt.CreateToken(staff.Id.ToString(), staff.Role, null, staff.FullName);
            await _audit.WriteAsync("staff", staff.Id.ToString(), "staff_login", null, new { ip }, ct);

            return Ok(new
            {
                token = token.Token,
                role = staff.Role,
                fullName = staff.FullName,
                staffId = staff.Id,
                expiresAt = token.ExpiresAt,
            });
        }

        [Authorize(Roles = "admin,support")]
        [HttpPost("staff/change-password")]
        public async Task<IActionResult> ChangeStaffPassword([FromBody] ChangePasswordRequest? request, CancellationToken ct)
        {
            var staffId = User.GetStaffId();
            if (staffId == null)
                return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");

            var staff = await _db.Staff.FirstOrDefaultAsync(s => s.Id == staffId.Value && s.Active, ct);
            if (staff == null)
                return ApiResults.Unauthorized("Tài khoản không tồn tại hoặc đã bị khoá");

            var current = request?.CurrentPassword ?? "";
            var next = request?.NewPassword ?? "";

            if (!BCrypt.Net.BCrypt.Verify(current, staff.PasswordHash))
                return ApiResults.Validation(new Dictionary<string, string>
                {
                    ["currentPassword"] = "Mật khẩu hiện tại không đúng",
                });

            if (next.Length < MinStaffPasswordLength)
                return ApiResults.Validation(new Dictionary<string, string>
                {
                    ["newPassword"] = $"Mật khẩu mới phải có ít nhất {MinStaffPasswordLength} ký tự",
                });

            if (next == current)
                return ApiResults.Validation(new Dictionary<string, string>
                {
                    ["newPassword"] = "Mật khẩu mới phải khác mật khẩu hiện tại",
                });

            staff.PasswordHash = BCrypt.Net.BCrypt.HashPassword(next, BcryptCost);
            await _db.SaveChangesAsync(ct);

            await _audit.WriteAsync("staff", staff.Id.ToString(), "staff_change_password", null, null, ct);
            return Ok(new { ok = true });
        }

        // ============ Thông tin phiên ============

        [Authorize]
        [HttpGet("me")]
        public async Task<IActionResult> Me(CancellationToken ct)
        {
            var role = User.GetRole();
            var result = new Dictionary<string, object?> { ["role"] = role };
            var name = User.FindFirst("name")?.Value;
            if (name != null) result["fullName"] = name;

            if (role == "farmer")
            {
                var wallet = User.GetWallet();
                result["wallet"] = wallet;
                var profile = wallet == null
                    ? null
                    : await _db.FarmerProfiles.AsNoTracking().FirstOrDefaultAsync(p => p.WalletAddress == wallet, ct);
                result["profileComplete"] = profile != null && ProfileValidator.IsComplete(profile);
                if (profile != null) result["fullName"] = profile.FullName;
            }
            else
            {
                result["staffId"] = User.GetStaffId();
            }

            return Ok(result);
        }

        // ============ Hàm phụ ============

        private object FarmerSession(string wallet, FarmerProfile profile)
        {
            var token = _jwt.CreateToken(wallet, "farmer", wallet, profile.FullName);
            return new
            {
                token = token.Token,
                role = "farmer",
                wallet,
                profile = ProfileValidator.ToDto(profile),
                expiresAt = token.ExpiresAt,
            };
        }

        private sealed record VerifyResult(string? Wallet, AuthNonce? Nonce, IActionResult? Error);

        /// <summary>
        /// Kiểm tra chữ ký ví trên message do server tự dựng lại (không tin message của client).
        /// Thành công thì trả ví viết thường và dòng nonce (người gọi chịu trách nhiệm xoá nonce).
        /// </summary>
        private async Task<VerifyResult> VerifySignatureAsync(string? address, string? signature, CancellationToken ct)
        {
            if (!WalletAddress.TryNormalize(address, out var wallet))
            {
                return new VerifyResult(null, null, ApiResults.Validation(
                    new Dictionary<string, string> { ["address"] = "Địa chỉ ví không hợp lệ" }));
            }

            var nonce = await _db.AuthNonces.FirstOrDefaultAsync(n => n.WalletAddress == wallet, ct);
            if (nonce == null)
                return new VerifyResult(null, null, NonceExpired());

            if (nonce.ExpiresAt <= DateTimeOffset.UtcNow)
            {
                _db.AuthNonces.Remove(nonce);
                await _db.SaveChangesAsync(ct);
                return new VerifyResult(null, null, NonceExpired());
            }

            if (string.IsNullOrWhiteSpace(signature))
                return new VerifyResult(null, null, InvalidSignature());

            string recovered;
            try
            {
                var message = BuildMessage(wallet, nonce.Nonce, nonce.ExpiresAt);
                recovered = new EthereumMessageSigner().EncodeUTF8AndEcRecover(message, signature.Trim());
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Chữ ký không đọc được cho ví {Wallet}", wallet);
                return new VerifyResult(null, null, InvalidSignature());
            }

            if (!string.Equals(recovered, wallet, StringComparison.OrdinalIgnoreCase))
                return new VerifyResult(null, null, InvalidSignature());

            return new VerifyResult(wallet, nonce, null);
        }

        private static IActionResult NonceExpired() =>
            ApiResults.Unauthorized("Phiên đăng nhập đã hết hạn, vui lòng thử lại", "NONCE_EXPIRED");

        private static IActionResult InvalidSignature() =>
            ApiResults.Unauthorized("Chữ ký không hợp lệ", "INVALID_SIGNATURE");

        /// <summary>Message 4 dòng đúng định dạng SPEC-B mục 2.2 (ngăn cách bằng \n, không có \n cuối).</summary>
        private static string BuildMessage(string wallet, string nonce, DateTimeOffset expiresAt)
        {
            var expires = expiresAt.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
            return $"Weather Insurance - Dang nhap\nDia chi: {wallet}\nNonce: {nonce}\nHet han: {expires}";
        }

        /// <summary>Cắt phần dưới 1 giây để thời điểm hết hạn lưu DB và message luôn khớp từng ký tự.</summary>
        private static DateTimeOffset TruncateToSeconds(DateTimeOffset value)
        {
            var utc = value.UtcDateTime;
            return new DateTimeOffset(utc.Ticks - (utc.Ticks % TimeSpan.TicksPerSecond), TimeSpan.Zero);
        }
    }
}
