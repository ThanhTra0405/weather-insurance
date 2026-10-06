using backend.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/history")]
    public class HistoryController : ControllerBase
    {
        private readonly AppDbContext _db;
        public HistoryController(AppDbContext db) => _db = db;

        [HttpGet("policies")]
        public async Task<IActionResult> GetPolicies(
            [FromQuery] string? holder, [FromQuery] byte? status, CancellationToken ct)
        {
            var q = _db.Policies.AsNoTracking().AsQueryable();
            if (!string.IsNullOrEmpty(holder))
            {
                var h = holder.ToLowerInvariant();
                q = q.Where(p => p.Holder.ToLower() == h);
            }
            if (status.HasValue) q = q.Where(p => p.Status == status.Value);

            return Ok(await q.OrderByDescending(p => p.PolicyId).Take(200).ToListAsync(ct));
        }

        [HttpGet("policies/{id:long}")]
        public async Task<IActionResult> GetPolicy(long id, CancellationToken ct)
        {
            var p = await _db.Policies.AsNoTracking().FirstOrDefaultAsync(x => x.PolicyId == id, ct);
            return p is null ? NotFound() : Ok(p);
        }

        [HttpGet("policies/{id:long}/payouts")]
        public async Task<IActionResult> GetPayouts(long id, CancellationToken ct) =>
            Ok(await _db.Payouts.AsNoTracking()
                .Where(x => x.PolicyId == id)
                .OrderByDescending(x => x.CreatedAt)
                .ToListAsync(ct));

        [HttpGet("oracle/{regionId}")]
        public async Task<IActionResult> GetOracleHistory(string regionId, CancellationToken ct) =>
            Ok(await _db.OracleSubmissions.AsNoTracking()
                .Where(x => x.RegionId == regionId)
                .OrderByDescending(x => x.CreatedAt)
                .Take(100)
                .ToListAsync(ct));

        [HttpGet("payouts")]
        public async Task<IActionResult> GetRecentPayouts(CancellationToken ct) =>
            Ok(await _db.Payouts.AsNoTracking()
                .OrderByDescending(x => x.CreatedAt)
                .Take(100)
                .ToListAsync(ct));
    }
}