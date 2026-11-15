using backend.Common;
using backend.Data;
using backend.Services.Chain;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

[ApiController]
[Authorize(Roles = "farmer")]
[Route("api/faucet")]
public class FaucetController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IFaucetService _faucet;
    private readonly IAuditLog _audit;
    private readonly ILogger<FaucetController> _logger;

    public FaucetController(AppDbContext db, IFaucetService faucet, IAuditLog audit, ILogger<FaucetController> logger)
    {
        _db = db;
        _faucet = faucet;
        _audit = audit;
        _logger = logger;
    }

    [HttpPost]
    public async Task<IActionResult> Claim([FromBody] FaucetRequest? request, CancellationToken ct)
    {
        if (!WalletAddress.TryNormalize(request?.Address, out var address))
            return ApiResults.BadRequest("Địa chỉ ví không hợp lệ", "VALIDATION");

        var wallet = User.GetWallet()?.ToLowerInvariant();
        if (string.IsNullOrEmpty(wallet) || wallet != address)
            return ApiResults.Forbidden("Chỉ được nạp ETH cho ví của chính bạn");

        if (!_faucet.Configured)
            return ApiResults.ServiceUnavailable("Faucet chưa được cấu hình");

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        await _faucet.Lock.WaitAsync(ct);
        try
        {
            // 1. Cooldown theo vi (tra audit_logs)
            var since = DateTimeOffset.UtcNow.AddHours(-_faucet.CooldownHours);
            var last = await _db.AuditLogs.AsNoTracking()
                .Where(a => a.Action == "faucet" && a.ActorRef == wallet && a.CreatedAt > since)
                .OrderByDescending(a => a.CreatedAt)
                .Select(a => (DateTimeOffset?)a.CreatedAt)
                .FirstOrDefaultAsync(ct);
            if (last != null)
                return TooMany("Bạn đã nạp ETH gần đây", last.Value.AddHours(_faucet.CooldownHours));

            // 2. Toi da 5 lan/ngay theo IP
            if (_faucet.IpLimitReached(ip))
                return TooMany("Địa chỉ mạng của bạn đã nạp quá số lần cho phép hôm nay", DateTimeOffset.UtcNow.AddDays(1));

            // 3. Vi da du so du thi khong nap them
            var balance = await _faucet.GetBalanceWeiAsync(address, ct);
            if (ChainUnits.FromWei(balance) >= _faucet.AmountEth / 2)
                return Ok(new { skipped = true });

            // 4. Faucet can du ETH
            var faucetBalance = await _faucet.GetFaucetBalanceWeiAsync(ct);
            if (ChainUnits.FromWei(faucetBalance) < _faucet.AmountEth)
                return ApiResults.ServiceUnavailable("Faucet tạm hết ETH");

            string txHash;
            try
            {
                txHash = await _faucet.SendAsync(address, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Faucet gui ETH that bai cho {Wallet}", wallet);
                if (ex.Message.Contains("insufficient funds", StringComparison.OrdinalIgnoreCase))
                    return ApiResults.ServiceUnavailable("Faucet tạm hết ETH");
                return ApiResults.BadGateway("Không gửi được ETH, vui lòng thử lại sau");
            }

            _faucet.RecordIpUse(ip);
            await _audit.WriteAsync("farmer", wallet, "faucet", $"wallet:{wallet}",
                new { txHash, amountEth = _faucet.AmountEth, ip }, CancellationToken.None);

            return Ok(new { txHash, amountEth = _faucet.AmountEth });
        }
        finally
        {
            _faucet.Lock.Release();
        }
    }

    private static IActionResult TooMany(string message, DateTimeOffset retryAt) =>
        new ObjectResult(new
        {
            error = $"{message}. Có thể nạp lại sau {retryAt.ToOffset(TimeSpan.FromHours(7)):dd/MM/yyyy HH:mm}",
            code = "RATE_LIMITED",
            retryAt = retryAt.ToUnixTimeSeconds(),
        })
        { StatusCode = StatusCodes.Status429TooManyRequests };
}

public record FaucetRequest(string? Address);
