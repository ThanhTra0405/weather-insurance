using System.Security.Cryptography;
using backend.Auth;
using backend.Common;
using backend.Data;
using backend.Data.Entities;
using backend.Options;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Controllers
{
    /// <summary>Hồ sơ nông dân (SPEC-B mục 3). Chỉ nông dân đã đăng nhập.</summary>
    [ApiController]
    [Authorize(Roles = "farmer")]
    [Route("api/profile")]
    public class ProfileController : ControllerBase
    {
        // Bỏ các ký tự dễ nhầm (0/O, 1/I) cho mã liên kết Telegram.
        private const string CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        private const int CodeLength = 8;
        private static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(15);

        private readonly AppDbContext _db;
        private readonly TelegramOptions _telegram;

        public ProfileController(AppDbContext db, IOptions<TelegramOptions> telegram)
        {
            _db = db;
            _telegram = telegram.Value;
        }

        [HttpGet("me")]
        public async Task<IActionResult> GetMine(CancellationToken ct)
        {
            var wallet = User.GetWallet();
            if (wallet == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");

            var profile = await _db.FarmerProfiles.AsNoTracking()
                .FirstOrDefaultAsync(p => p.WalletAddress == wallet, ct);
            if (profile == null) return Ok(new { hasProfile = false });

            return Ok(ProfileValidator.ToDto(profile));
        }

        [HttpPut("me")]
        public async Task<IActionResult> UpdateMine([FromBody] ProfileInput? input, CancellationToken ct)
        {
            var wallet = User.GetWallet();
            if (wallet == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");

            var fields = ProfileValidator.Validate(input);
            if (fields.Count > 0) return ApiResults.Validation(fields);

            var now = DateTimeOffset.UtcNow;
            var profile = await _db.FarmerProfiles.FirstOrDefaultAsync(p => p.WalletAddress == wallet, ct);
            if (profile == null)
            {
                // Upsert: JWT nông dân luôn đi kèm hồ sơ, nhánh này chỉ là phòng thủ.
                profile = new FarmerProfile { WalletAddress = wallet, CreatedAt = now };
                _db.FarmerProfiles.Add(profile);
            }

            ProfileValidator.Apply(profile, input!);
            profile.UpdatedAt = now;
            await _db.SaveChangesAsync(ct);

            return Ok(ProfileValidator.ToDto(profile));
        }

        [HttpPost("telegram-link")]
        public async Task<IActionResult> CreateTelegramLink(CancellationToken ct)
        {
            if (!_telegram.IsConfigured || string.IsNullOrWhiteSpace(_telegram.BotUsername))
                return ApiResults.ServiceUnavailable("Chưa cấu hình Telegram");

            var wallet = User.GetWallet();
            if (wallet == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");

            var profile = await _db.FarmerProfiles.FirstOrDefaultAsync(p => p.WalletAddress == wallet, ct);
            if (profile == null) return ApiResults.NotFound("Chưa có hồ sơ", "NOT_REGISTERED");

            var code = GenerateCode();
            var expiresAt = DateTimeOffset.UtcNow.Add(CodeLifetime);
            profile.TelegramLinkCode = code;
            profile.TelegramLinkExpiresAt = expiresAt;
            profile.UpdatedAt = DateTimeOffset.UtcNow;
            await _db.SaveChangesAsync(ct);

            var username = _telegram.BotUsername.Trim().TrimStart('@');
            return Ok(new
            {
                code,
                deepLink = $"https://t.me/{username}?start={code}",
                expiresAt,
            });
        }

        private static string GenerateCode()
        {
            var chars = new char[CodeLength];
            for (var i = 0; i < chars.Length; i++)
                chars[i] = CodeAlphabet[RandomNumberGenerator.GetInt32(CodeAlphabet.Length)];
            return new string(chars);
        }
    }
}
