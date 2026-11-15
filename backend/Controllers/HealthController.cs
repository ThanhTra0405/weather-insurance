using backend.Data;
using backend.Services.Chain;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

[ApiController]
[AllowAnonymous]
public class HealthController : ControllerBase
{
    private readonly IChainContext _chain;
    private readonly AppDbContext _db;

    public HealthController(IChainContext chain, AppDbContext db)
    {
        _chain = chain;
        _db = db;
    }

    /// Dung cho keep-alive (UptimeRobot). Luon tra 200; status = "degraded" neu RPC hoac DB loi.
    [HttpGet("/health")]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var status = "ok";
        long? block = null;
        long? lag = null;

        try
        {
            block = (long)(await _chain.Web3.Eth.Blocks.GetBlockNumber.SendRequestAsync()).Value;
        }
        catch
        {
            status = "degraded";
        }

        try
        {
            var last = await _db.IndexerStates.AsNoTracking()
                .Select(s => (long?)s.LastBlock)
                .FirstOrDefaultAsync(ct);
            if (block != null && last != null) lag = Math.Max(0, block.Value - last.Value);
        }
        catch
        {
            status = "degraded";
        }

        return Ok(new { status, block, indexerLag = lag });
    }
}
