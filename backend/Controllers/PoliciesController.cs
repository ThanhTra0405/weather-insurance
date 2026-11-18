using System.Text.Json;
using backend.Common;
using backend.Data;
using backend.Data.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

[ApiController]
[Route("api/policies")]
public class PoliciesController : ControllerBase
{
    private static readonly string[] TimelineEvents =
        { "PolicyCreated", "EvidenceSubmitted", "PolicyVerified", "PayoutTriggered", "PolicyExpired" };

    private readonly AppDbContext _db;

    public PoliciesController(AppDbContext db) => _db = db;

    /// Policy cua nong dan dang dang nhap (theo vi trong JWT).
    [Authorize(Roles = "farmer")]
    [HttpGet("mine")]
    public async Task<IActionResult> Mine(CancellationToken ct)
    {
        var wallet = User.GetWallet()?.ToLowerInvariant();
        if (string.IsNullOrEmpty(wallet)) return ApiResults.Forbidden();

        // So sanh khong phan biet hoa/thuong (DB co the luu dang checksum)
        var rows = await _db.PoliciesCache.AsNoTracking()
            .Where(p => p.Holder.ToLower() == wallet)
            .OrderByDescending(p => p.PolicyId)
            .ToListAsync(ct);

        var ids = rows.Select(r => r.PolicyId).ToList();
        var productIds = rows.Select(r => r.ProductId).Distinct().ToList();

        var names = await _db.ProductsCache.AsNoTracking()
            .Where(p => productIds.Contains(p.ProductId))
            .ToDictionaryAsync(p => p.ProductId, p => p.Name, ct);

        // hasEvidence: da gui hash len chain (de UI phan biet "can nop ho so" va "cho duyet")
        var withEvidence = (await _db.ChainEvents.AsNoTracking()
            .Where(e => e.EventName == "EvidenceSubmitted" && ids.Contains(e.PolicyId ?? -1))
            .Select(e => e.PolicyId ?? -1)
            .Distinct()
            .ToListAsync(ct)).ToHashSet();

        var result = rows.Select(r =>
        {
            var d = Shape(r, names.GetValueOrDefault(r.ProductId));
            d["hasEvidence"] = withEvidence.Contains(r.PolicyId);
            return d;
        });
        return Ok(result);
    }

    /// Farmer chi xem policy cua minh; admin/support xem tat ca.
    [Authorize]
    [HttpGet("{id:long}")]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        var p = await _db.PoliciesCache.AsNoTracking().FirstOrDefaultAsync(x => x.PolicyId == id, ct);
        if (p == null) return ApiResults.NotFound("Không tìm thấy policy");

        var role = User.GetRole();
        if (role == "farmer")
        {
            var wallet = User.GetWallet();
            if (string.IsNullOrEmpty(wallet) ||
                !string.Equals(wallet, p.Holder, StringComparison.OrdinalIgnoreCase))
                return ApiResults.Forbidden("Bạn không có quyền xem policy này");
        }
        else if (role != "admin" && role != "support")
        {
            return ApiResults.Forbidden();
        }

        var productName = await _db.ProductsCache.AsNoTracking()
            .Where(x => x.ProductId == p.ProductId)
            .Select(x => x.Name)
            .FirstOrDefaultAsync(ct);

        var events = await _db.ChainEvents.AsNoTracking()
            .Where(e => e.PolicyId == id && TimelineEvents.Contains(e.EventName))
            .OrderBy(e => e.BlockNumber).ThenBy(e => e.LogIndex)
            .ToListAsync(ct);

        string? rejectReason = null;
        if (p.Rejected)
        {
            rejectReason = await _db.ReviewLogs.AsNoTracking()
                .Where(r => r.PolicyId == id && !r.Approved)
                .OrderByDescending(r => r.CreatedAt)
                .Select(r => r.Note)
                .FirstOrDefaultAsync(ct);
        }

        var dto = Shape(p, productName);
        dto["rejectReason"] = rejectReason;
        dto["timeline"] = events.Select(ToTimeline).ToList();
        return Ok(dto);
    }

    private static Dictionary<string, object?> Shape(PolicyCache p, string? productName) => new()
    {
        ["policyId"] = p.PolicyId,
        ["productId"] = p.ProductId,
        ["productName"] = productName,
        ["perilType"] = (int)p.PerilType,
        ["holder"] = p.Holder.ToLowerInvariant(),
        ["latE6"] = p.LatE6,
        ["lngE6"] = p.LngE6,
        ["regionId"] = p.RegionId,
        ["status"] = (int)p.Status,
        ["startTime"] = p.StartTime,
        ["endTime"] = p.EndTime,
        ["premiumWei"] = p.PremiumWei.ToString(),
        ["coverageWei"] = p.CoverageWei.ToString(),
        ["rejected"] = p.Rejected,
    };

    private static object ToTimeline(ChainEvent e)
    {
        var (type, data) = e.EventName switch
        {
            "PolicyCreated" => ("created", new Dictionary<string, object?>()),
            "EvidenceSubmitted" => ("evidence", new Dictionary<string, object?>()),
            "PolicyVerified" => ("verified", new Dictionary<string, object?> { ["approved"] = ArgBool(e, "approved") }),
            "PayoutTriggered" => ("payout", new Dictionary<string, object?> { ["amountWei"] = ArgString(e, "amount") }),
            "PolicyExpired" => ("expired", new Dictionary<string, object?> { ["refunded"] = ArgBool(e, "refunded") }),
            _ => (e.EventName, new Dictionary<string, object?>()),
        };

        return new
        {
            type,
            time = e.BlockTime.ToUnixTimeSeconds(),
            txHash = e.TxHash,
            data,
        };
    }

    private static bool ArgBool(ChainEvent e, string name) =>
        e.Args.RootElement.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static string? ArgString(ChainEvent e, string name) =>
        e.Args.RootElement.TryGetProperty(name, out var v) ? v.ToString() : null;
}