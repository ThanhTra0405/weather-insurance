using System.Numerics;
using System.Text.Json;
using System.Text.RegularExpressions;
using backend.Common;
using backend.Data;
using backend.Data.Entities;
using backend.Services.Chain;
using backend.Services.interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

/// Cac API quan tri tang blockchain (A). Chi admin.
[ApiController]
[Authorize(Roles = "admin")]
[Route("api/admin")]
public class AdminChainController : ControllerBase
{
    private static readonly Regex RegionIdPattern = new("^0x[0-9a-fA-F]{64}$", RegexOptions.Compiled);

    private readonly AppDbContext _db;
    private readonly IAdminChainClient _chain;
    private readonly IChainContext _ctx;
    private readonly IOracleCycle _cycle;
    private readonly IOracleSubmitter _oracle;
    private readonly IRegionService _region;
    private readonly IAuditLog _audit;
    private readonly IConfiguration _config;
    private readonly ILogger<AdminChainController> _logger;

    public AdminChainController(AppDbContext db, IAdminChainClient chain, IChainContext ctx, IOracleCycle cycle,
        IOracleSubmitter oracle, IRegionService region, IAuditLog audit, IConfiguration config,
        ILogger<AdminChainController> logger)
    {
        _db = db; _chain = chain; _ctx = ctx; _cycle = cycle; _oracle = oracle;
        _region = region; _audit = audit; _config = config; _logger = logger;
    }

    private string? Actor => User.GetStaffId()?.ToString();

    private static string Short(string s, int max = 300) => s.Length <= max ? s : s[..max];

    // ===================== Thong ke =====================

    [HttpGet("stats")]
    public async Task<IActionResult> Stats(CancellationToken ct)
    {
        var counts = await _db.PoliciesCache.AsNoTracking()
            .GroupBy(p => p.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        int C(short s) => counts.FirstOrDefault(x => x.Status == s)?.Count ?? 0;

        var paidCoverage = await _db.PoliciesCache.AsNoTracking()
            .Where(p => p.Status == 2).Select(p => p.CoverageWei).ToListAsync(ct);
        var paidTotal = paidCoverage.Aggregate(BigInteger.Zero, (a, b) => a + b);

        var openStatuses = new[] { "open", "in_progress", "waiting_customer" };
        var ticketsOpen = await _db.Tickets.CountAsync(t => t.Status == "open", ct);
        var ticketsInProgress = await _db.Tickets.CountAsync(t => t.Status == "in_progress", ct);
        var ticketsUnassigned = await _db.Tickets.CountAsync(
            t => t.AssignedTo == null && openStatuses.Contains(t.Status), ct);

        // Du lieu tu chain: loi RPC khong lam hong ca trang thong ke
        string? chainError = null;
        PoolStatsDTO? pool = null;
        SystemInfoDTO? sys = null;
        try
        {
            pool = await _chain.GetPoolStatsAsync(ct);
            sys = await _chain.GetSystemInfoAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Khong doc duoc thong ke tu chain");
            chainError = "Không đọc được dữ liệu blockchain";
        }

        var lastLog = await _db.OracleLogs.AsNoTracking()
            .OrderByDescending(l => l.CreatedAt).FirstOrDefaultAsync(ct);
        var last = OracleCycle.Last;
        DateTimeOffset? lastRunAt = last?.FinishedAt ?? lastLog?.CreatedAt;
        var lastRunOk = last != null ? last.Errors.Count == 0 : (lastLog?.Status ?? "ok") == "ok";

        var lastBlock = await _db.IndexerStates.AsNoTracking()
            .Select(s => (long?)s.LastBlock).FirstOrDefaultAsync(ct) ?? 0;
        long latestBlock = 0;
        try { latestBlock = (long)(await _ctx.Web3.Eth.Blocks.GetBlockNumber.SendRequestAsync()).Value; }
        catch (Exception ex) when (ex is not OperationCanceledException) { _logger.LogWarning(ex, "Khong doc duoc block moi nhat"); }

        return Ok(new
        {
            policies = new
            {
                total = counts.Sum(x => x.Count),
                pending = C(0),
                active = C(1),
                paidOut = C(2),
                closed = C(3),
            },
            pool = new
            {
                balanceWei = (pool?.Balance ?? BigInteger.Zero).ToString(),
                depositedWei = (pool?.Deposited ?? BigInteger.Zero).ToString(),
                lockedWei = (pool?.Locked ?? BigInteger.Zero).ToString(),
                availableWei = (pool?.Available ?? BigInteger.Zero).ToString(),
            },
            payouts = new { count = C(2), totalWei = paidTotal.ToString() },
            tickets = new { open = ticketsOpen, inProgress = ticketsInProgress, unassigned = ticketsUnassigned },
            operatorBalanceWei = (sys?.OperatorBalanceWei ?? BigInteger.Zero).ToString(),
            faucetBalanceWei = (sys?.FaucetBalanceWei ?? BigInteger.Zero).ToString(),
            oracle = new
            {
                lastRunAt = lastRunAt?.ToUnixTimeSeconds(),
                lastRunOk,
            },
            indexer = new
            {
                lastBlock,
                latestBlock,
                lag = latestBlock > 0 ? Math.Max(0, latestBlock - lastBlock) : 0,
            },
            chainError,
        });
    }

    // ===================== Pool =====================

    [HttpGet("pool")]
    public async Task<IActionResult> Pool(CancellationToken ct)
    {
        PoolStatsDTO stats;
        BigInteger totalShares;
        try
        {
            stats = await _chain.GetPoolStatsAsync(ct);
            totalShares = await _chain.GetTotalSharesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Khong doc duoc pool");
            return ApiResults.BadGateway("Không đọc được dữ liệu blockchain, vui lòng thử lại sau");
        }

        var events = await _db.ChainEvents.AsNoTracking()
            .Where(e => e.EventName == "LiquidityAdded" || e.EventName == "LiquidityWithdrawn")
            .Select(e => new { e.EventName, e.WalletAddress, e.Args })
            .ToListAsync(ct);

        var byProvider = new Dictionary<string, (BigInteger added, BigInteger withdrawn)>();
        foreach (var e in events)
        {
            if (string.IsNullOrEmpty(e.WalletAddress)) continue;
            var amount = ArgBig(e.Args, "amount");
            byProvider.TryGetValue(e.WalletAddress, out var cur);
            byProvider[e.WalletAddress] = e.EventName == "LiquidityAdded"
                ? (cur.added + amount, cur.withdrawn)
                : (cur.added, cur.withdrawn + amount);
        }

        var investors = new List<object>();
        var investorCount = 0;
        foreach (var (provider, sums) in byProvider)
        {
            BigInteger shares;
            try { shares = await _chain.GetSharesOfAsync(provider, ct); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Khong doc duoc sharesOf {Provider}", provider);
                shares = BigInteger.Zero;
            }
            if (shares > 0) investorCount++;
            investors.Add(new
            {
                address = provider,
                shares = shares.ToString(),
                addedWei = sums.added.ToString(),
                withdrawnWei = sums.withdrawn.ToString(),
            });
        }

        return Ok(new
        {
            balanceWei = stats.Balance.ToString(),
            depositedWei = stats.Deposited.ToString(),
            lockedWei = stats.Locked.ToString(),
            availableWei = stats.Available.ToString(),
            totalShares = totalShares.ToString(),
            investorCount,
            totalAddedWei = byProvider.Values.Aggregate(BigInteger.Zero, (a, v) => a + v.added).ToString(),
            totalWithdrawnWei = byProvider.Values.Aggregate(BigInteger.Zero, (a, v) => a + v.withdrawn).ToString(),
            investors,
        });
    }

    // ===================== He thong: pause / system info =====================

    [HttpGet("system")]
    public async Task<IActionResult> SystemInfo(CancellationToken ct)
    {
        try
        {
            var s = await _chain.GetSystemInfoAsync(ct);
            return Ok(new
            {
                owner = s.Owner,
                verifier = s.Verifier,
                oracleSigner = s.OracleSigner,
                operatorAddress = s.OperatorAddress,
                faucetAddress = s.FaucetAddress,
                signerMatches = s.SignerMatches,
                coolingOffSeconds = (long)s.CoolingOffSeconds,
                paused = new { policyManager = s.PolicyManagerPaused, pool = s.PoolPaused, payoutEngine = s.PayoutEnginePaused },
                operatorBalanceWei = s.OperatorBalanceWei.ToString(),
                faucetBalanceWei = s.FaucetBalanceWei.ToString(),
            });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Khong doc duoc thong tin he thong");
            return ApiResults.BadGateway("Không đọc được dữ liệu blockchain, vui lòng thử lại sau");
        }
    }

    [HttpPost("system/pause")]
    public Task<IActionResult> Pause([FromBody] TargetRequest? request, CancellationToken ct) =>
        SetPaused(request, true, ct);

    [HttpPost("system/unpause")]
    public Task<IActionResult> Unpause([FromBody] TargetRequest? request, CancellationToken ct) =>
        SetPaused(request, false, ct);

    private async Task<IActionResult> SetPaused(TargetRequest? request, bool pause, CancellationToken ct)
    {
        var target = request?.Target?.Trim();
        string[] targets;
        if (target == "all") targets = AdminChainClient.Targets;
        else if (target != null && AdminChainClient.Targets.Contains(target)) targets = new[] { target };
        else
            return ApiResults.Validation(new Dictionary<string, string>
            {
                ["target"] = "target phải là policyManager, pool, payoutEngine hoặc all",
            });

        var results = new List<object>();
        string? firstError = null;
        var anyOk = false;
        foreach (var t in targets)
        {
            try
            {
                var tx = pause ? await _chain.PauseAsync(t, ct) : await _chain.UnpauseAsync(t, ct);
                anyOk = true;
                results.Add(new { target = t, txHash = tx, changed = tx != null, error = (string?)null });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Loi {Action} {Target}", pause ? "pause" : "unpause", t);
                firstError ??= Short(ex.Message);
                results.Add(new { target = t, txHash = (string?)null, changed = false, error = Short(ex.Message) });
            }
        }

        await _audit.WriteAsync("staff", Actor, pause ? "pause" : "unpause", $"system:{target}",
            new { results }, CancellationToken.None);

        return anyOk ? Ok(results) : ApiResults.BadGateway("Không gửi được giao dịch: " + firstError);
    }

    // ===================== San pham / cooling-off =====================

    [HttpPost("products")]
    public async Task<IActionResult> CreateProduct([FromBody] CreateProductRequest? r, CancellationToken ct)
    {
        if (r == null) return ApiResults.BadRequest("Thiếu dữ liệu sản phẩm", "VALIDATION");

        var f = new Dictionary<string, string>();
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Trim().Length > 100) f["name"] = "Tên sản phẩm 1–100 ký tự";
        if (r.PerilType is < 0 or > 2) f["perilType"] = "Loại rủi ro phải là 0 (hạn hán), 1 (lũ) hoặc 2 (gió mạnh)";
        if (r.Threshold <= 0) f["threshold"] = "Ngưỡng phải lớn hơn 0";
        if (r.DurationDays is < 1 or > 365) f["durationDays"] = "Thời hạn 1–365 ngày";
        else if (r.PerilType == 0 && r.DurationDays < 30) f["durationDays"] = "Hạn hán cần ít nhất 30 ngày";
        if (r.PremiumEth <= 0) f["premiumEth"] = "Phí phải lớn hơn 0";
        if (r.CoverageEth <= r.PremiumEth) f["coverageEth"] = "Số tiền bồi thường phải lớn hơn phí";
        if (f.Count > 0) return ApiResults.Validation(f);

        // threshold nhap theo don vi nguoi dung (mm hoac km/h), contract luu x100
        var threshold = (BigInteger)Math.Round(r.Threshold * 100m, 0, MidpointRounding.AwayFromZero);
        if (threshold <= 0) return ApiResults.Validation(new Dictionary<string, string> { ["threshold"] = "Ngưỡng quá nhỏ" });

        try
        {
            var tx = await _chain.CreateProductAsync(r.Name.Trim(), (byte)r.PerilType, threshold, r.DurationDays,
                ChainUnits.ToWei(r.PremiumEth), ChainUnits.ToWei(r.CoverageEth), ct);
            await _audit.WriteAsync("staff", Actor, "create_product", $"product:{r.Name.Trim()}",
                new { r.PerilType, r.Threshold, r.DurationDays, r.PremiumEth, r.CoverageEth, txHash = tx },
                CancellationToken.None);
            return Ok(new { txHash = tx });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Loi tao san pham");
            return ApiResults.BadGateway("Gửi giao dịch thất bại: " + Short(ex.Message));
        }
    }

    [HttpPatch("products/{id:long}/active")]
    public async Task<IActionResult> SetProductActive(long id, [FromBody] ActiveRequest? r, CancellationToken ct)
    {
        if (r == null || id <= 0) return ApiResults.BadRequest("Thiếu dữ liệu", "VALIDATION");
        try
        {
            var tx = await _chain.SetProductActiveAsync((ulong)id, r.Active, ct);
            await _audit.WriteAsync("staff", Actor, "set_product_active", $"product:{id}",
                new { r.Active, txHash = tx }, CancellationToken.None);
            return Ok(new { txHash = tx });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Loi doi trang thai san pham {Id}", id);
            return ApiResults.BadGateway("Gửi giao dịch thất bại: " + Short(ex.Message));
        }
    }

    [HttpPost("cooling-off")]
    public async Task<IActionResult> SetCoolingOff([FromBody] SecondsRequest? r, CancellationToken ct)
    {
        const long max = 7 * 24 * 3600;
        if (r == null || r.Seconds < 0 || r.Seconds > max)
            return ApiResults.Validation(new Dictionary<string, string> { ["seconds"] = "Cooling-off phải từ 0 đến 7 ngày (604800 giây)" });
        try
        {
            var tx = await _chain.SetCoolingOffAsync((ulong)r.Seconds, ct);
            await _audit.WriteAsync("staff", Actor, "set_cooling_off", "system",
                new { r.Seconds, txHash = tx }, CancellationToken.None);
            return Ok(new { txHash = tx });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Loi doi cooling-off");
            return ApiResults.BadGateway("Gửi giao dịch thất bại: " + Short(ex.Message));
        }
    }

    // ===================== Oracle =====================

    [HttpGet("oracle-status")]
    public async Task<IActionResult> OracleStatus(CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var active = await _db.PoliciesCache.AsNoTracking()
            .Where(p => p.Status == 1 && p.EndTime > now)
            .Select(p => new { p.RegionId, p.PerilType })
            .ToListAsync(ct);

        var items = new List<object>();
        foreach (var g in active.GroupBy(p => (p.RegionId, p.PerilType)).OrderBy(g => g.Key.RegionId).ThenBy(g => g.Key.PerilType))
        {
            var (regionId, peril) = g.Key;
            var logs = _db.OracleLogs.AsNoTracking().Where(l => l.RegionId == regionId && l.PerilType == peril);
            var lastAny = await logs.OrderByDescending(l => l.CreatedAt).FirstOrDefaultAsync(ct);
            var lastOk = await logs.Where(l => l.Status == "ok").OrderByDescending(l => l.CreatedAt).FirstOrDefaultAsync(ct);

            items.Add(new
            {
                regionId,
                perilType = (int)peril,
                activePolicies = g.Count(),
                lastValueScaled = lastOk?.ValueScaled?.ToString(),
                lastDataTs = lastOk?.DataTs,
                // Du lieu gio theo NGAY: tuoi = thoi gian ke tu lan gui thanh cong gan nhat (DataTs la 00:00 cua ngay du lieu)
                ageMinutes = lastOk != null ? (long?)Math.Max(0, (long)(DateTimeOffset.UtcNow - lastOk.CreatedAt).TotalMinutes) : null,
                lastTxHash = lastOk?.TxHash,
                lastStatus = lastAny?.Status,
                lastError = lastAny?.Status == "error" ? lastAny.Error : null,
            });
        }

        string? oracleSigner = null, operatorAddress = _ctx.OperatorAddress;
        bool? signerMatches = null;
        try
        {
            var sys = await _chain.GetSystemInfoAsync(ct);
            oracleSigner = sys.OracleSigner;
            signerMatches = sys.SignerMatches;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Khong doc duoc oracle signer");
        }

        var last = OracleCycle.Last;
        return Ok(new
        {
            items,
            runner = new
            {
                lastRunAt = last?.FinishedAt.ToUnixTimeSeconds(),
                lastRunOk = last == null ? (bool?)null : last.Errors.Count == 0,
                intervalMinutes = _config.GetValue<int>("Blockchain:OracleIntervalMinutes", 30),
                lastResult = last == null ? null : MapCycle(last),
            },
            oracleSigner,
            operatorAddress,
            signerMatches,
            simulateEnabled = _config.GetValue<bool>("Demo:EnableSimulate", false),
        });
    }

    [HttpPost("oracle/run-now")]
    public async Task<IActionResult> RunNow([FromQuery] bool skipWeather = false, CancellationToken ct = default)
    {
        try
        {
            var r = await _cycle.RunAsync(refreshWeather: !skipWeather, ct);
            await _audit.WriteAsync("staff", Actor, "oracle_run_now", "oracle",
                new { skipWeather, r.SubmittedCount, r.PayoutCount, r.ExpiredCount, errors = r.Errors.Count },
                CancellationToken.None);
            return Ok(MapCycle(r));
        }
        catch (OracleBusyException)
        {
            return ApiResults.Conflict("Oracle đang chạy, vui lòng thử lại sau");
        }
    }

    [HttpPost("oracle/simulate")]
    public async Task<IActionResult> Simulate([FromBody] SimulateRequest? r, CancellationToken ct)
    {
        if (!_config.GetValue<bool>("Demo:EnableSimulate", false)) return NotFound(); // an hoan toan khi tat
        if (r == null) return ApiResults.BadRequest("Thiếu dữ liệu giả lập", "VALIDATION");

        var f = new Dictionary<string, string>();
        if (r.PerilType is < 0 or > 2) f["perilType"] = "Loại rủi ro phải là 0, 1 hoặc 2";
        if (r.Value < 0) f["value"] = "Giá trị không được âm";

        string? regionId = null;
        if (!string.IsNullOrWhiteSpace(r.RegionId))
        {
            if (!RegionIdPattern.IsMatch(r.RegionId.Trim())) f["regionId"] = "regionId phải là 0x + 64 ký tự hex";
            else regionId = r.RegionId.Trim().ToLowerInvariant();
        }
        else if (r.Lat is { } lat && r.Lng is { } lng)
        {
            regionId = _region.ComputeRegionId(lat, lng);
        }
        else f["regionId"] = "Cần regionId hoặc toạ độ lat/lng";

        if (f.Count > 0) return ApiResults.Validation(f);

        var scaled = OracleDay.Scale(r.Value);

        // Oracle luu 1 ban ghi / ngay / vung / peril va KHONG ghi de: gia lap = gui gia tri cho cac ngay DA KET THUC.
        // Date = ngay cuoi (mac dinh hom qua, gio VN); Days = so ngay lien tiep ket thuc tai Date (mac dinh 1, toi da 40).
        // Han han can du 30 ngay: gui Days = 30 voi gia tri mm / NGAY.
        var days = r.Days ?? 1;
        if (days is < 1 or > 40)
            return ApiResults.Validation(new Dictionary<string, string> { ["days"] = "Days phải từ 1 đến 40" });
        var lastDay = r.Date ?? OracleDay.TodayLocal(DateTimeOffset.UtcNow).AddDays(-1);
        if (lastDay >= OracleDay.TodayLocal(DateTimeOffset.UtcNow))
            return ApiResults.Validation(new Dictionary<string, string> { ["date"] = "Chỉ gửi được ngày đã kết thúc (trước hôm nay)" });

        var peril = (byte)r.PerilType;
        var batch = Enumerable.Range(0, days)
            .Select(i => lastDay.AddDays(i - days + 1))
            .Select(d => (DayStart: OracleDay.DayStart(d), Value: scaled))
            .ToList();
        var ts = batch[^1].DayStart;
        try
        {
            var tx = days == 1
                ? await _oracle.SubmitWeatherDataAsync(regionId!, peril, scaled, ts, ct)
                : await _oracle.SubmitDailyBatchAsync(regionId!, peril, batch, ct);
            await WriteOracleLogAsync(regionId!, peril, scaled, ts, tx, "ok", null);
            await _audit.WriteAsync("staff", Actor, "oracle_simulate", $"region:{regionId}",
                new { perilType = r.PerilType, r.Value, days, date = lastDay.ToString("yyyy-MM-dd"), txHash = tx }, CancellationToken.None);
            return Ok(new { txHash = tx, regionId, perilType = r.PerilType, valueScaled = scaled.ToString(), timestamp = ts, days, date = lastDay.ToString("yyyy-MM-dd") });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Loi simulate oracle");
            await WriteOracleLogAsync(regionId!, peril, scaled, ts, null, "error", Short(ex.Message, 500));
            return ApiResults.BadGateway("Gửi giao dịch thất bại (ngày đã có dữ liệu thì không thể ghi đè): " + Short(ex.Message));
        }
    }

    private async Task WriteOracleLogAsync(string regionId, byte peril, BigInteger value, long ts, string? tx,
        string status, string? error)
    {
        try
        {
            _db.OracleLogs.Add(new OracleLog
            {
                RegionId = regionId,
                PerilType = peril,
                ValueScaled = value,
                DataTs = ts,
                TxHash = tx,
                Status = status,
                Error = error,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await _db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Khong ghi duoc oracle_logs");
        }
    }

    private static object MapCycle(OracleCycleResult r) => new
    {
        submittedCount = r.SubmittedCount,
        gapCount = r.GapCount,
        payoutCount = r.PayoutCount,
        expiredCount = r.ExpiredCount,
        errors = r.Errors,
        startedAt = r.StartedAt.ToUnixTimeSeconds(),
        finishedAt = r.FinishedAt.ToUnixTimeSeconds(),
    };

    // ===================== Payout =====================

    [HttpGet("payouts")]
    public async Task<IActionResult> Payouts([FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var query = _db.ChainEvents.AsNoTracking().Where(e => e.EventName == "PayoutTriggered");
        var count = await query.CountAsync(ct);

        var rows = await query
            .OrderByDescending(e => e.BlockNumber).ThenByDescending(e => e.LogIndex)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync(ct);

        var total = (await query.Select(e => e.Args).ToListAsync(ct))
            .Aggregate(BigInteger.Zero, (a, args) => a + ArgBig(args, "amount"));

        return Ok(new
        {
            page,
            pageSize,
            count,
            totalWei = total.ToString(),
            items = rows.Select(e => new
            {
                policyId = e.PolicyId,
                holder = e.WalletAddress,
                amountWei = ArgBig(e.Args, "amount").ToString(),
                txHash = e.TxHash,
                time = e.BlockTime.ToUnixTimeSeconds(),
            }),
        });
    }

    private static BigInteger ArgBig(JsonDocument args, string name) =>
        args.RootElement.TryGetProperty(name, out var v) && BigInteger.TryParse(v.ToString(), out var b)
            ? b
            : BigInteger.Zero;
}

public record TargetRequest(string? Target);
public record ActiveRequest(bool Active);
public record SecondsRequest(long Seconds);
public record CreateProductRequest(string Name, int PerilType, decimal Threshold, int DurationDays,
    decimal PremiumEth, decimal CoverageEth);
public record SimulateRequest(string? RegionId, decimal? Lat, decimal? Lng, int PerilType, decimal Value,
    DateOnly? Date = null, int? Days = null);
