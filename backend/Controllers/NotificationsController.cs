using backend.Common;
using backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers
{
    /// <summary>Thông báo trong ứng dụng của nông dân (SPEC-B mục 7.2). Mỗi ví chỉ thấy thông báo của mình.</summary>
    [ApiController]
    [Authorize(Roles = "farmer")]
    [Route("api/notifications")]
    public class NotificationsController : ControllerBase
    {
        private const int MaxPageSize = 50;

        private readonly AppDbContext _db;

        public NotificationsController(AppDbContext db)
        {
            _db = db;
        }

        /// <summary>GET /api/notifications?unreadOnly=&amp;page=&amp;pageSize=20 → { items, total, unread }.</summary>
        [HttpGet]
        public async Task<IActionResult> List([FromQuery] bool unreadOnly = false, [FromQuery] int page = 1,
            [FromQuery] int pageSize = 20, CancellationToken ct = default)
        {
            var wallet = User.GetWallet();
            if (wallet == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");

            if (page < 1) page = 1;
            if (pageSize < 1) pageSize = 20;
            if (pageSize > MaxPageSize) pageSize = MaxPageSize;

            var query = _db.Notifications.AsNoTracking().Where(n => n.WalletAddress == wallet);
            if (unreadOnly) query = query.Where(n => !n.IsRead);

            var total = await query.CountAsync(ct);
            var unread = await _db.Notifications.AsNoTracking()
                .CountAsync(n => n.WalletAddress == wallet && !n.IsRead, ct);

            var items = await query
                .OrderByDescending(n => n.CreatedAt).ThenByDescending(n => n.Id)
                .Skip((page - 1) * pageSize).Take(pageSize)
                .Select(n => new
                {
                    id = n.Id,
                    type = n.Type,
                    title = n.Title,
                    body = n.Body,
                    link = n.Link,
                    isRead = n.IsRead,
                    createdAt = n.CreatedAt,
                })
                .ToListAsync(ct);

            return Ok(new { items, total, unread });
        }

        [HttpGet("unread-count")]
        public async Task<IActionResult> UnreadCount(CancellationToken ct)
        {
            var wallet = User.GetWallet();
            if (wallet == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");

            var unread = await _db.Notifications.AsNoTracking()
                .CountAsync(n => n.WalletAddress == wallet && !n.IsRead, ct);
            return Ok(new { unread });
        }

        [HttpPost("{id:long}/read")]
        public async Task<IActionResult> MarkRead(long id, CancellationToken ct)
        {
            var wallet = User.GetWallet();
            if (wallet == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");

            // Chỉ cập nhật thông báo của chính ví; id của ví khác coi như không tồn tại.
            var exists = await _db.Notifications.AsNoTracking()
                .AnyAsync(n => n.Id == id && n.WalletAddress == wallet, ct);
            if (!exists) return ApiResults.NotFound("Không tìm thấy thông báo");

            await _db.Notifications
                .Where(n => n.Id == id && n.WalletAddress == wallet && !n.IsRead)
                .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true), ct);
            return Ok(new { ok = true });
        }

        [HttpPost("read-all")]
        public async Task<IActionResult> MarkAllRead(CancellationToken ct)
        {
            var wallet = User.GetWallet();
            if (wallet == null) return ApiResults.Unauthorized("Phiên đăng nhập không hợp lệ");

            var updated = await _db.Notifications
                .Where(n => n.WalletAddress == wallet && !n.IsRead)
                .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true), ct);
            return Ok(new { updated });
        }
    }
}
