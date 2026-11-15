using System.Numerics;
using backend.Data;
using backend.Data.Entities;
using backend.Services.interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.Chain;

public class OracleCycleResult
{
    public int SubmittedCount { get; set; }
    public int PayoutCount { get; set; }
    public int ExpiredCount { get; set; }
    public List<string> Errors { get; } = new();
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset FinishedAt { get; set; }
}

public class OracleBusyException : Exception
{
    public OracleBusyException() : base("Oracle dang chay, thu lai sau") { }
}

public interface IOracleCycle
{
    Task<OracleCycleResult> RunAsync(bool refreshWeather = true, CancellationToken ct = default);
}

/// Doc danh sach policy tu policies_cache (do ChainIndexer cap nhat), KHONG duyet chain.
public class OracleCycle : IOracleCycle
{
    // Khong cho 2 lan chay chong nhau (worker + admin bam "chay ngay")
    private static readonly SemaphoreSlim Running = new(1, 1);
    public static OracleCycleResult? Last { get; private set; }

    private readonly IDbContextFactory<AppDbContext> _dbFactory;
    private readonly IWeatherService _weather;
    private readonly IOracleSubmitter _oracle;
    private readonly IRegionService _region;
    private readonly IPolicyManagerClient _policyManager;
    private readonly IPayoutEngineClient _payout;
    private readonly ILogger<OracleCycle> _logger;

    public OracleCycle(
        IDbContextFactory<AppDbContext> dbFactory, IWeatherService weather, IOracleSubmitter oracle,
        IRegionService region, IPolicyManagerClient policyManager, IPayoutEngineClient payout,
        ILogger<OracleCycle> logger)
    {
        _dbFactory = dbFactory; _weather = weather; _oracle = oracle; _region = region;
        _policyManager = policyManager; _payout = payout; _logger = logger;
    }

    public async Task<OracleCycleResult> RunAsync(bool refreshWeather = true, CancellationToken ct = default)
    {
        if (!await Running.WaitAsync(0, ct)) throw new OracleBusyException();

        var result = new OracleCycleResult { StartedAt = DateTimeOffset.UtcNow };
        try
        {
            await using var db = await _dbFactory.CreateDbContextAsync(ct);

            if (!await db.PoliciesCache.AnyAsync(ct))
            {
                _logger.LogWarning("policies_cache dang trong (indexer chua chay xong?), bo qua chu trinh oracle");
                return result;
            }

            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var live = await db.PoliciesCache.AsNoTracking()
                .Where(p => p.Status == 1 && p.EndTime > now)
                .ToListAsync(ct);
            var expirable = await db.PoliciesCache.AsNoTracking()
                .Where(p => (p.Status == 0 || p.Status == 1) && p.EndTime < now)
                .Select(p => p.PolicyId)
                .ToListAsync(ct);

            _logger.LogInformation("Chu trinh oracle: {Live} policy dang hieu luc, {Exp} policy co the dong",
                live.Count, expirable.Count);

            if (refreshWeather) await SubmitWeatherAsync(live, result, ct);
            await PayoutAsync(live, now, result, ct);
            await ExpireAsync(expirable, now, result, ct);
        }
        finally
        {
            result.FinishedAt = DateTimeOffset.UtcNow;
            Last = result;
            Running.Release();
        }
        return result;
    }

    // 1. Moi (vung, peril) dang co policy hieu luc: lay thoi tiet theo TAM VUNG 1 lan / vung, gui len oracle
    private async Task SubmitWeatherAsync(List<PolicyCache> live, OracleCycleResult result, CancellationToken ct)
    {
        foreach (var region in live.GroupBy(p => p.RegionId))
        {
            ct.ThrowIfCancellationRequested();

            var regionId = region.Key;
            var first = region.First();
            var (clat, clng) = _region.GetRegionCenter(first.LatE6 / 1_000_000m, first.LngE6 / 1_000_000m);
            var perils = region.Select(p => (byte)p.PerilType).Distinct().ToList();

            Models.WeatherSnapshot w;
            try
            {
                w = await _weather.GetWeatherAsync(clat, clng, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                foreach (var peril in perils)
                {
                    result.Errors.Add($"thoi tiet {regionId}/{peril}: {ex.Message}");
                    await LogAsync(regionId, peril, null, null, null, "error", "khong lay duoc thoi tiet: " + ex.Message);
                }
                _logger.LogError(ex, "Loi lay thoi tiet vung {Region}", regionId);
                continue;
            }

            foreach (var peril in perils)
            {
                ct.ThrowIfCancellationRequested();

                decimal? value = peril switch
                {
                    0 => w.Rain30dMm,
                    1 => w.Rain3dMm,
                    _ => w.WindGustMax3dKmh,
                };
                if (value is null)
                {
                    _logger.LogWarning("Khong co du lieu thoi tiet cho vung {Region} peril {Peril}", regionId, peril);
                    await LogAsync(regionId, peril, null, null, null, "error", "khong co du lieu");
                    continue;
                }

                // x100, lam tron (KHONG dung new BigInteger(decimal) vi se cat phan thap phan)
                var scaled = (BigInteger)Math.Round(value.Value * 100m, 0, MidpointRounding.AwayFromZero);
                try
                {
                    var tx = await _oracle.SubmitWeatherDataAsync(regionId, peril, scaled, w.Timestamp, ct);
                    result.SubmittedCount++;
                    await LogAsync(regionId, peril, scaled, w.Timestamp, tx, "ok", null);
                    _logger.LogInformation("Oracle {Region} peril {Peril} = {Value} (x100), tx = {Tx}",
                        regionId, peril, scaled, tx);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    result.Errors.Add($"oracle {regionId}/{peril}: {ex.Message}");
                    await LogAsync(regionId, peril, scaled, w.Timestamp, null, "error", ex.Message);
                    _logger.LogError(ex, "Loi gui oracle {Region} peril {Peril}", regionId, peril);
                }
            }
        }
    }

    // 2. Policy dat nguong thi payout (loi tung policy khong dung ca vong)
    private async Task PayoutAsync(List<PolicyCache> live, long now, OracleCycleResult result, CancellationToken ct)
    {
        foreach (var p in live)
        {
            ct.ThrowIfCancellationRequested();
            if (p.StartTime > now) continue; // dang cooling-off

            var id = (ulong)p.PolicyId;
            try
            {
                // cache co the cu so voi chain: xac nhan lai trang thai truoc khi gui tx
                var onChain = await _policyManager.GetPolicyAsync(id, ct);
                if (onChain.Status != 1) continue;

                if (!await _payout.IsThresholdMetAsync(id, ct)) continue;
                var tx = await _payout.CheckAndPayoutAsync(id, ct);
                result.PayoutCount++;
                _logger.LogInformation("Da payout policy {PolicyId}, tx = {Tx}", id, tx);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                result.Errors.Add($"payout #{id}: {ex.Message}");
                _logger.LogError(ex, "Loi payout policy {PolicyId}", id);
            }
        }
    }

    // 3. Policy qua han: dong, mo khoa coverage (chua duyet thi hoan premium)
    private async Task ExpireAsync(List<long> ids, long now, OracleCycleResult result, CancellationToken ct)
    {
        foreach (var policyId in ids)
        {
            ct.ThrowIfCancellationRequested();
            var id = (ulong)policyId;
            try
            {
                var onChain = await _policyManager.GetPolicyAsync(id, ct);
                if (onChain.Status != 0 && onChain.Status != 1) continue; // da dong/da boi thuong
                if (onChain.EndTime >= now) continue;                     // endTime tren chain moi hon cache

                var tx = await _policyManager.ExpirePolicyAsync(id, ct);
                result.ExpiredCount++;
                _logger.LogInformation("Da dong policy het han {PolicyId}, tx = {Tx}", id, tx);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                result.Errors.Add($"expire #{id}: {ex.Message}");
                _logger.LogError(ex, "Loi expire policy {PolicyId}", id);
            }
        }
    }

    private async Task LogAsync(string regionId, byte peril, BigInteger? value, long? dataTs, string? tx,
        string status, string? error)
    {
        try
        {
            await using var db = await _dbFactory.CreateDbContextAsync();
            db.OracleLogs.Add(new OracleLog
            {
                RegionId = regionId,
                PerilType = peril,
                ValueScaled = value,
                DataTs = dataTs,
                TxHash = tx,
                Status = status,
                Error = error is { Length: > 500 } ? error[..500] : error,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Khong ghi duoc oracle_logs");
        }
    }
}
