using System.Text.Json;
using backend.Common;
using backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers
{
    /// <summary>Xem nhật ký hoạt động (SPEC-B mục 8). Chỉ admin; mới nhất trước.</summary>
    [ApiController]
    [Authorize(Roles = "admin")]
    [Route("api/admin/audit")]
    public class AdminAuditController : ControllerBase
    {
        private const int MaxPageSize = 100;

        private readonly AppDbContext _db;

        public AdminAuditController(AppDbContext db)
        {
            _db = db;
        }

        /// <summary>
        /// GET /api/admin/audit?page=&amp;pageSize=&amp;action=&amp;actor=&amp;from=&amp;to= → { items, total, page, pageSize }.
        /// action: chứa chuỗi (không phân biệt hoa thường). actor: khớp actor_ref hoặc email/họ tên nhân viên.
        /// from/to: thời điểm ISO 8601 (khuyên dùng UTC), cả hai đầu đều bao gồm.
        /// </summary>
        [HttpGet]
        public async Task<IActionResult> List(
            [FromQuery] string? action, [FromQuery] string? actor,
            [FromQuery(Name = "from")] DateTimeOffset? fromTime, [FromQuery(Name = "to")] DateTimeOffset? toTime,
            [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
        {
            if (page < 1) page = 1;
            if (pageSize < 1) pageSize = 50;
            if (pageSize > MaxPageSize) pageSize = MaxPageSize;

            var query = _db.AuditLogs.AsNoTracking().AsQueryable();

            if (!string.IsNullOrWhiteSpace(action))
            {
                var actionPattern = SqlLike.Contains(action);
                query = query.Where(a => EF.Functions.ILike(a.Action, actionPattern));
            }

            if (!string.IsNullOrWhiteSpace(actor))
            {
                var actorPattern = SqlLike.Contains(actor);
                var matchedStaff = await _db.Staff.AsNoTracking()
                    .Where(s => EF.Functions.ILike(s.Email, actorPattern) || EF.Functions.ILike(s.FullName, actorPattern))
                    .Select(s => s.Id)
                    .ToListAsync(ct);
                var staffRefs = matchedStaff.Select(g => g.ToString()).ToList();

                query = query.Where(a => a.ActorRef != null
                    && (EF.Functions.ILike(a.ActorRef, actorPattern) || staffRefs.Contains(a.ActorRef)));
            }

            if (fromTime != null) query = query.Where(a => a.CreatedAt >= fromTime.Value);
            if (toTime != null) query = query.Where(a => a.CreatedAt <= toTime.Value);

            var total = await query.CountAsync(ct);
            var rows = await query
                .OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.Id)
                .Skip((page - 1) * pageSize).Take(pageSize)
                .ToListAsync(ct);

            // Tên nhân viên cho các dòng do nhân viên thực hiện.
            var staffIds = rows
                .Where(r => r.ActorType == "staff" && Guid.TryParse(r.ActorRef, out _))
                .Select(r => Guid.Parse(r.ActorRef!))
                .Distinct()
                .ToList();
            var names = staffIds.Count == 0
                ? new Dictionary<Guid, string>()
                : await _db.Staff.AsNoTracking()
                    .Where(s => staffIds.Contains(s.Id))
                    .ToDictionaryAsync(s => s.Id, s => s.FullName, ct);

            var items = new List<object>(rows.Count);
            foreach (var r in rows)
            {
                JsonElement? detail = null;
                if (r.Detail != null)
                {
                    detail = r.Detail.RootElement.Clone();
                    r.Detail.Dispose();
                }

                string? actorName = null;
                if (r.ActorType == "staff" && Guid.TryParse(r.ActorRef, out var sid) && names.TryGetValue(sid, out var n))
                    actorName = n;

                items.Add(new
                {
                    id = r.Id,
                    actorType = r.ActorType,
                    actorRef = r.ActorRef,
                    actorName,
                    action = r.Action,
                    target = r.Target,
                    detail,
                    createdAt = r.CreatedAt,
                });
            }

            return Ok(new { items, total, page, pageSize });
        }
    }
}
