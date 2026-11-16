
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

        public HistoryController(AppDbContext db)
        {
            _db = db;
        }

        // Lịch sử hợp đồng
        [HttpGet("policies")]
        public async Task<IActionResult> GetPolicies(
            [FromQuery] string? holder,
            [FromQuery] byte? status,
            CancellationToken ct)
        {
            var q = _db.PoliciesCache
                .AsNoTracking()
                .AsQueryable();

            if (!string.IsNullOrWhiteSpace(holder))
            {
                var h = holder.ToLowerInvariant();
                q = q.Where(p => p.Holder.ToLower() == h);
            }

            if (status.HasValue)
            {
                q = q.Where(p => p.Status == (short)status.Value);
            }

            var result = await q
                .OrderByDescending(p => p.PolicyId)
                .Take(200)
                .ToListAsync(ct);

            return Ok(result);
        }

        // Chi tiết hợp đồng
        [HttpGet("policies/{id:long}")]
        public async Task<IActionResult> GetPolicy(
            long id,
            CancellationToken ct)
        {
            var policy = await _db.PoliciesCache
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.PolicyId == id, ct);

            return policy is null ? NotFound() : Ok(policy);
        }

        // Lịch sử payout của một hợp đồng
        [HttpGet("policies/{id:long}/payouts")]
        public async Task<IActionResult> GetPayouts(
            long id,
            CancellationToken ct)
        {
            var payouts = await _db.ChainEvents
                .AsNoTracking()
                .Where(e =>
                    e.PolicyId == id &&
                    e.EventName == "PayoutTriggered")
                .OrderByDescending(e => e.BlockTime)
                .ToListAsync(ct);

            return Ok(payouts);
        }

        // Lịch sử Oracle theo khu vực
        [HttpGet("oracle/{regionId}")]
        public async Task<IActionResult> GetOracleHistory(
            string regionId,
            CancellationToken ct)
        {
            var history = await _db.OracleLogs
                .AsNoTracking()
                .Where(x => x.RegionId == regionId)
                .OrderByDescending(x => x.CreatedAt)
                .Take(100)
                .ToListAsync(ct);

            return Ok(history);
        }

        // Các giao dịch payout gần đây
        [HttpGet("payouts")]
        public async Task<IActionResult> GetRecentPayouts(
            CancellationToken ct)
        {
            var payouts = await _db.ChainEvents
                .AsNoTracking()
                .Where(e => e.EventName == "PayoutTriggered")
                .OrderByDescending(e => e.BlockTime)
                .Take(100)
                .ToListAsync(ct);

            return Ok(payouts);
        }
    }
}