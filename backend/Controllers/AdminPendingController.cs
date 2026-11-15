using backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

/// Danh sach ho so cho duyet, doc tu policies_cache (khong goi chain). Duyet/tu choi nam o AdminReviewController (B).
[ApiController]
[Authorize(Roles = "admin,support")]
[Route("api/admin")]
public class AdminPendingController : ControllerBase
{
    private readonly AppDbContext _db;

    public AdminPendingController(AppDbContext db) => _db = db;

    [HttpGet("pending-policies")]
    public async Task<IActionResult> Pending(CancellationToken ct)
    {
        var rows = await _db.PoliciesCache.AsNoTracking()
            .Where(p => p.Status == 0)
            .ToListAsync(ct);

        var ids = rows.Select(r => r.PolicyId).ToList();
        var productIds = rows.Select(r => r.ProductId).Distinct().ToList();
        var wallets = rows.Select(r => r.Holder).Distinct().ToList();

        var names = await _db.ProductsCache.AsNoTracking()
            .Where(p => productIds.Contains(p.ProductId))
            .ToDictionaryAsync(p => p.ProductId, p => p.Name, ct);

        var evidenceAt = (await _db.ChainEvents.AsNoTracking()
            .Where(e => e.EventName == "EvidenceSubmitted" && ids.Contains(e.PolicyId ?? -1))
            .Select(e => new { PolicyId = e.PolicyId ?? -1, e.BlockTime })
            .ToListAsync(ct))
            .GroupBy(e => e.PolicyId)
            .ToDictionary(g => g.Key, g => g.Min(x => x.BlockTime).ToUnixTimeSeconds());

        var farmers = await _db.FarmerProfiles.AsNoTracking()
            .Where(f => wallets.Contains(f.WalletAddress))
            .ToDictionaryAsync(f => f.WalletAddress, f => new { f.FullName, f.Phone }, ct);

        // Ho so da co bang chung len truoc, trong moi nhom thi policy cu hon len truoc
        var result = rows
            .OrderByDescending(r => evidenceAt.ContainsKey(r.PolicyId))
            .ThenBy(r => r.PolicyId)
            .Select(r =>
            {
                farmers.TryGetValue(r.Holder, out var f);
                return new
                {
                    policyId = r.PolicyId,
                    holder = r.Holder,
                    lat = r.LatE6 / 1_000_000m,
                    lng = r.LngE6 / 1_000_000m,
                    coverageAmountWei = r.CoverageWei.ToString(),
                    endTime = r.EndTime,
                    productName = names.GetValueOrDefault(r.ProductId),
                    perilType = (int)r.PerilType,
                    hasEvidence = evidenceAt.ContainsKey(r.PolicyId),
                    evidenceSubmittedAt = evidenceAt.TryGetValue(r.PolicyId, out var t) ? (long?)t : null,
                    farmerName = f?.FullName,
                    farmerPhone = f?.Phone,
                };
            })
            .ToList();

        return Ok(result);
    }
}
