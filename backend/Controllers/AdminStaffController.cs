using System.Text.RegularExpressions;
using backend.Common;
using backend.Data;
using backend.Data.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers
{
    /// <summary>Quản lý tài khoản nhân viên (SPEC-B mục 8). Chỉ admin; mọi thay đổi ghi audit_logs.</summary>
    [ApiController]
    [Authorize(Roles = "admin")]
    [Route("api/admin/staff")]
    public class AdminStaffController : ControllerBase
    {
        private const int BcryptCost = 11;
        private const int MinPasswordLength = 10;
        private const int MaxPasswordLength = 128;
        private static readonly string[] Roles = { "admin", "support" };
        private static readonly Regex EmailRegex = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled);

        private readonly AppDbContext _db;
        private readonly IAuditLog _audit;
        private readonly ILogger<AdminStaffController> _logger;

        public AdminStaffController(AppDbContext db, IAuditLog audit, ILogger<AdminStaffController> logger)
        {
            _db = db;
            _audit = audit;
            _logger = logger;
        }

        [HttpGet]
        public async Task<IActionResult> List(CancellationToken ct)
        {
            var me = User.GetStaffId();
            var rows = await _db.Staff.AsNoTracking()
                .OrderBy(s => s.CreatedAt).ThenBy(s => s.Email)
                .ToListAsync(ct);

            return Ok(rows.Select(s => ToDto(s, me)).ToList());
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] CreateStaffRequest? request, CancellationToken ct)
        {
            var actorId = User.GetStaffId();
            if (actorId == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");
            if (request == null) return ApiResults.BadRequest("Thiếu dữ liệu nhân viên", "VALIDATION");

            var email = request.Email?.Trim().ToLowerInvariant() ?? "";
            var fullName = request.FullName?.Trim() ?? "";
            var role = request.Role?.Trim() ?? "";
            var password = request.Password ?? "";

            var fields = new Dictionary<string, string>();
            if (email.Length > 254 || !EmailRegex.IsMatch(email)) fields["email"] = "Email không hợp lệ";
            if (fullName.Length < 2 || fullName.Length > 100) fields["fullName"] = "Họ tên phải từ 2 đến 100 ký tự";
            if (!Roles.Contains(role)) fields["role"] = "Vai trò phải là admin hoặc support";
            AddPasswordError(fields, password);
            if (fields.Count > 0) return ApiResults.Validation(fields);

            if (await _db.Staff.AnyAsync(s => s.Email == email, ct))
                return ApiResults.Conflict("Email này đã được dùng cho tài khoản khác", "EMAIL_EXISTS");

            var staff = new Staff
            {
                Id = Guid.NewGuid(),
                Email = email,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(password, BcryptCost),
                FullName = fullName,
                Role = role,
                Active = true,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            _db.Staff.Add(staff);

            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex)
            {
                // Hai request tạo cùng email cùng lúc: ràng buộc unique chặn request thứ hai.
                _db.ChangeTracker.Clear();
                if (await _db.Staff.AnyAsync(s => s.Email == email, ct))
                    return ApiResults.Conflict("Email này đã được dùng cho tài khoản khác", "EMAIL_EXISTS");

                _logger.LogError(ex, "Không tạo được nhân viên {Email}", email);
                throw;
            }

            await _audit.WriteAsync("staff", actorId.Value.ToString(), "staff_create", $"staff:{staff.Id}",
                new { email, fullName, role }, ct);
            return Ok(ToDto(staff, actorId));
        }

        [HttpPatch("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] UpdateStaffRequest? request, CancellationToken ct)
        {
            var actorId = User.GetStaffId();
            if (actorId == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");
            if (request == null) return ApiResults.BadRequest("Thiếu dữ liệu cập nhật", "VALIDATION");

            var staff = await _db.Staff.FirstOrDefaultAsync(s => s.Id == id, ct);
            if (staff == null) return ApiResults.NotFound("Không tìm thấy nhân viên");

            var fullName = request.FullName?.Trim();
            var role = request.Role?.Trim();

            var fields = new Dictionary<string, string>();
            if (fullName != null && (fullName.Length < 2 || fullName.Length > 100))
                fields["fullName"] = "Họ tên phải từ 2 đến 100 ký tự";
            if (role != null && !Roles.Contains(role))
                fields["role"] = "Vai trò phải là admin hoặc support";
            if (request.Password != null) AddPasswordError(fields, request.Password);
            if (fields.Count > 0) return ApiResults.Validation(fields);

            var isSelf = staff.Id == actorId.Value;
            if (isSelf && role != null && role != staff.Role)
                return ApiResults.Conflict("Bạn không thể tự đổi vai trò của chính mình", "SELF_ROLE_CHANGE");
            if (isSelf && request.Active == false)
                return ApiResults.Conflict("Bạn không thể tự khoá tài khoản của chính mình", "SELF_DEACTIVATE");

            // Không để hệ thống mất admin đang hoạt động cuối cùng.
            var losesAdminRight = staff.Role == "admin" && staff.Active
                && (request.Active == false || (role != null && role != "admin"));
            if (losesAdminRight)
            {
                var otherActiveAdmins = await _db.Staff.CountAsync(
                    s => s.Id != staff.Id && s.Role == "admin" && s.Active, ct);
                if (otherActiveAdmins == 0)
                    return ApiResults.Conflict(
                        "Đây là admin đang hoạt động cuối cùng, không thể khoá hoặc hạ quyền", "LAST_ADMIN");
            }

            var changes = new Dictionary<string, object?>();
            if (fullName != null && fullName != staff.FullName)
            {
                changes["fullName"] = new { before = staff.FullName, after = fullName };
                staff.FullName = fullName;
            }
            if (role != null && role != staff.Role)
            {
                changes["role"] = new { before = staff.Role, after = role };
                staff.Role = role;
            }
            if (request.Active != null && request.Active != staff.Active)
            {
                changes["active"] = new { before = staff.Active, after = request.Active.Value };
                staff.Active = request.Active.Value;
            }
            if (request.Password != null)
            {
                staff.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password, BcryptCost);
                changes["passwordReset"] = true; // không ghi mật khẩu vào nhật ký
            }

            if (changes.Count == 0) return Ok(ToDto(staff, actorId));

            await _db.SaveChangesAsync(ct);
            await _audit.WriteAsync("staff", actorId.Value.ToString(), "staff_update", $"staff:{staff.Id}",
                new { email = staff.Email, changes }, ct);
            return Ok(ToDto(staff, actorId));
        }

        private static void AddPasswordError(Dictionary<string, string> fields, string password)
        {
            if (password.Length < MinPasswordLength)
                fields["password"] = $"Mật khẩu phải có ít nhất {MinPasswordLength} ký tự";
            else if (password.Length > MaxPasswordLength)
                fields["password"] = $"Mật khẩu tối đa {MaxPasswordLength} ký tự";
        }

        private static object ToDto(Staff s, Guid? me) => new
        {
            id = s.Id,
            email = s.Email,
            fullName = s.FullName,
            role = s.Role,
            active = s.Active,
            createdAt = s.CreatedAt,
            isSelf = me != null && s.Id == me.Value,
        };
    }

    public record CreateStaffRequest(string? Email, string? FullName, string? Role, string? Password);

    public record UpdateStaffRequest(string? FullName, string? Role, bool? Active, string? Password);
}
