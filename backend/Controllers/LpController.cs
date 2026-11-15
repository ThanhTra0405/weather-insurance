using System.Numerics;
using System.Text.Json;
using backend.Common;
using backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

/// Lịch sử góp/rút vốn của ví đang đăng nhập (đọc từ chain_events, frontend không dùng getLogs).
[ApiController]
[Authorize(Roles = "farmer")]
[Route("api/lp")]
public class LpController : ControllerBase
{
    private readonly AppDbContext _db;

    public LpController(AppDbContext db) => _db = db;

    [HttpGet("history")]
    public async Task<IActionResult> History([FromQuery] int limit = 50, CancellationToken ct = default)
    {
        var wallet = User.GetWallet()?.ToLowerInvariant();
        if (string.IsNullOrEmpty(wallet)) return ApiResults.Forbidden();
        limit = Math.Clamp(limit, 1, 200);

        var rows = await _db.ChainEvents.AsNoTracking()
            .Where(e => e.WalletAddress == wallet
                        && (e.EventName == "LiquidityAdded" || e.EventName == "LiquidityWithdrawn"))
            .OrderByDescending(e => e.BlockNumber).ThenByDescending(e => e.LogIndex)
            .Take(limit)
            .ToListAsync(ct);

        return Ok(rows.Select(e => new
        {
            type = e.EventName == "LiquidityAdded" ? "added" : "withdrawn",
            amountWei = Amount(e.Args).ToString(),
            txHash = e.TxHash,
            time = e.BlockTime.ToUnixTimeSeconds(),
        }));
    }

    private static BigInteger Amount(JsonDocument args) =>
        args.RootElement.TryGetProperty("amount", out var v) && BigInteger.TryParse(v.ToString(), out var b)
            ? b
            : BigInteger.Zero;
}
