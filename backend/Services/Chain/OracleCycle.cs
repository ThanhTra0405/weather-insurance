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
    /// So ngay du lieu bi thieu (nguon khong co / khong hop le) — KHONG duoc gui len chain.
    public int GapCount { get; set; }
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
    // Khop PolicyManager.MAX_CLAIM_GRACE: policy Active qua endTime toi da bay nhieu van con the dang trong han xu ly
    private const long MaxClaimGraceSeconds = 30 * 86_400;
    // Gioi han gia tri hop ly cua oracle (x100), khop DailyWeatherStore.maxValueOf
    private static readonly BigInteger[] MaxScaled = { 150_000, 450_000, 50_000 };
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
                .Where(p => p.Status == 1 && p.EndTime + MaxClaimGraceSeconds > now)
                .ToListAsync(ct);
            var expirable = await db.PoliciesCache.AsNoTracking()
                .Where(p => (p.Status == 0 || p.Status == 1) && p.EndTime < now)
                .Select(p => p.PolicyId)
                .ToListAsync(ct);

            _logger.LogInformation("Chu trinh oracle: {Live} policy dang hieu luc, {Exp} policy co the dong",
                live.Count, expirable.Count);

            if (refreshWeather) await SubmitWeatherAsync(live, now, result, ct);
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

    // 1. Dong bo lich su thoi tiet THEO NGAY: chi gui nhung ngay DA KET THUC (<= hom qua gio VN),
    //    nam trong thoi gian bao hiem, va chua co tren chain. Ngay thieu du lieu thi bo qua (khong gui 0).
    private async Task SubmitWeatherAsync(List<PolicyCache> live, long now, OracleCycleResult result, CancellationToken ct)
    {
        var today = OracleDay.TodayLocal(DateTimeOffset.FromUnixTimeSeconds(now));
        var yesterday = today.AddDays(-1);
        var oldestFetch = today.AddDays(-90); // Open-Meteo cho toi da 92 ngay qua khu

        foreach (var region in live.GroupBy(p => p.RegionId))
        {
            ct.ThrowIfCancellationRequested();
            var regionId = region.Key;

            // Khoang ngay can cho tung peril: tu ngay tron dau tien cua policy som nhat den min(ngay tron cuoi, hom qua)
            var needs = new Dictionary<byte, (DateOnly From, DateOnly To)>();
            foreach (var g in region.GroupBy(p => (byte)p.PerilType))
            {
                var from = g.Min(p => OracleDay.FirstCoveredDay(p.StartTime));
                var to = g.Max(p => OracleDay.LastCoveredDay(p.EndTime));
                if (to > yesterday) to = yesterday;
                if (from < oldestFetch.AddDays(2)) from = oldestFetch.AddDays(2); // chua cho 2 ngay cua so truot lu/gio
                if (to >= from) needs[g.Key] = (from, to);
            }
            if (needs.Count == 0) continue;

            var first = region.First();
            var (clat, clng) = _region.GetRegionCenter(first.LatE6 / 1_000_000m, first.LngE6 / 1_000_000m);
            var fetchFrom = needs.Values.Min(n => n.From).AddDays(-2);
            var fetchTo = needs.Values.Max(n => n.To);

            Dictionary<DateOnly, Models.DailyWeather> weather;
            try
            {
                var days = await _weather.GetDailyAsync(clat, clng, fetchFrom, fetchTo, ct);
                weather = days.ToDictionary(d => d.Date);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                foreach (var peril in needs.Keys)
                {
                    result.Errors.Add($"thoi tiet {regionId}/{peril}: {ex.Message}");
                    await LogAsync(regionId, peril, null, null, null, "error", "khong lay duoc thoi tiet: " + ex.Message);
                }
                _logger.LogError(ex, "Loi lay thoi tiet vung {Region}", regionId);
                continue;
            }

            foreach (var (peril, range) in needs)
            {
                ct.ThrowIfCancellationRequested();
                await SyncPerilAsync(regionId, peril, range.From, range.To, weather, result, ct);
            }
        }
    }

    private async Task SyncPerilAsync(string regionId, byte peril, DateOnly from, DateOnly to,
        Dictionary<DateOnly, Models.DailyWeather> weather, OracleCycleResult result, CancellationToken ct)
    {
        try
        {
            var count = to.DayNumber - from.DayNumber + 1;
            var onChain = await _oracle.GetDailyRangeAsync(regionId, peril, OracleDay.DayStart(from), count, ct);

            var toSend = new List<(long DayStart, BigInteger Value)>();
            var gaps = new List<DateOnly>();
            foreach (var rec in onChain)
            {
                if (rec.Exists) continue; // da co ban ghi cho ngay nay: khong gui lai / khong ghi de
                var day = OracleDay.FromDayStart(rec.DayStart);

                var v = DayValue(peril, day, weather);
                if (v is null) { gaps.Add(day); continue; }

                var scaled = OracleDay.Scale(v.Value);
                if (scaled > MaxScaled[peril]) { gaps.Add(day); continue; } // du lieu rac, contract cung se tu choi
                toSend.Add((rec.DayStart, scaled));
            }

            if (gaps.Count > 0)
            {
                result.GapCount += gaps.Count;
                var msg = $"thieu du lieu {gaps.Count} ngay: " + string.Join(", ", gaps.Take(10).Select(d => d.ToString("yyyy-MM-dd")))
                          + (gaps.Count > 10 ? ", ..." : "");
                result.Errors.Add($"oracle {regionId}/{peril}: {msg}");
                await LogAsync(regionId, peril, null, null, null, "error", msg);
                _logger.LogWarning("Oracle {Region} peril {Peril}: {Msg}", regionId, peril, msg);
            }

            for (var i = 0; i < toSend.Count; i += OracleSubmitter.MaxBatch)
            {
                ct.ThrowIfCancellationRequested();
                var chunk = toSend.Skip(i).Take(OracleSubmitter.MaxBatch).ToList(); // da sap xep tang dan theo ngay
                try
                {
                    var tx = await _oracle.SubmitDailyBatchAsync(regionId, peril, chunk, ct);
                    result.SubmittedCount += chunk.Count;
                    var last = chunk[^1];
                    await LogAsync(regionId, peril, last.Value, last.DayStart, tx, "ok", null);
                    _logger.LogInformation("Oracle {Region} peril {Peril}: gui {N} ngay den {Last}, tx = {Tx}",
                        regionId, peril, chunk.Count, OracleDay.FromDayStart(last.DayStart), tx);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    result.Errors.Add($"oracle {regionId}/{peril}: {ex.Message}");
                    await LogAsync(regionId, peril, chunk[^1].Value, chunk[^1].DayStart, null, "error", ex.Message);
                    _logger.LogError(ex, "Loi gui oracle {Region} peril {Peril}", regionId, peril);
                    break; // cac chunk sau se duoc thu lai o vong sau
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            result.Errors.Add($"oracle {regionId}/{peril}: {ex.Message}");
            await LogAsync(regionId, peril, null, null, null, "error", ex.Message);
            _logger.LogError(ex, "Loi dong bo oracle {Region} peril {Peril}", regionId, peril);
        }
    }

    /// Gia tri cua ngay D (don vi that, chua x100). null neu thieu du lieu.
    ///   han han: mua NGAY D (mm)
    ///   lu:      tong mua 3 ngay D-2..D (mm)      — cua so truot do backend tinh, y nhu logic cu
    ///   gio:     gio giat max 3 ngay D-2..D (km/h)
    private static decimal? DayValue(byte peril, DateOnly day, Dictionary<DateOnly, Models.DailyWeather> w)
    {
        if (peril == 0) return w.TryGetValue(day, out var d) ? d.RainMm : null;

        var vals = new List<decimal>(3);
        for (var k = 0; k < 3; k++)
        {
            if (!w.TryGetValue(day.AddDays(-k), out var x)) return null;
            var v = peril == 1 ? x.RainMm : x.WindGustMaxKmh;
            if (v is null) return null; // thieu 1 ngay trong cua so => khong gui, khong gia dinh 0
            vals.Add(v.Value);
        }
        return peril == 1 ? vals.Sum() : vals.Max();
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
                // Het han XU LY boi thuong (claimDeadline) moi khong con duoc chi tra; endTime chi la han bao hiem
                if (await _policyManager.GetClaimDeadlineAsync(id, ct) < now) continue;

                var ev = await _payout.EvaluateAsync(id, ct);
                if (!ev.Met) continue;
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
                // Policy Active con trong han xu ly boi thuong thi chua dong (contract cung se revert)
                if (onChain.Status == 1 && await _policyManager.GetClaimDeadlineAsync(id, ct) >= now) continue;

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
