using System.Globalization;
using System.Numerics;
using System.Text.Json;
using backend.Data;
using backend.Data.Entities;
using backend.Services.interfaces;
using Microsoft.EntityFrameworkCore;
using Nethereum.ABI.FunctionEncoding.Attributes;
using Nethereum.Contracts;
using Nethereum.RPC.Eth.DTOs;

namespace backend.Services.Chain;

/// Doc event tu 3 contract -> chain_events -> lam moi products_cache / policies_cache -> ban thong bao.
/// Cache duoc lam moi bang cach DOC LAI tu chain (getPolicy, products), khong va tay theo event.
public class ChainIndexer : BackgroundService
{
    private sealed class Decoded
    {
        public FilterLog Log { get; init; } = null!;
        public string Contract { get; init; } = "";
        public string Name { get; init; } = "";
        public long? PolicyId { get; init; }
        public string? Wallet { get; init; }
        public Dictionary<string, object?> Args { get; init; } = new();
        public DateTimeOffset BlockTime { get; set; }
        public string TxHash => Log.TransactionHash.ToLowerInvariant();
        public long BlockNumber => (long)Log.BlockNumber.Value;
        public int LogIndex => (int)Log.LogIndex.Value;
    }

    private sealed record Mapped(long? PolicyId, string? Wallet, Dictionary<string, object?> Args);

    private static readonly TimeSpan MaxNotifyAge = TimeSpan.FromMinutes(10);

    private readonly IChainContext _ctx;
    private readonly IDbContextFactory<AppDbContext> _dbFactory;
    private readonly IPolicyManagerClient _pm;
    private readonly INotificationService _notifier;
    private readonly ILogger<ChainIndexer> _log;

    private readonly string _pmAddr, _poolAddr, _engineAddr; // viet thuong
    private readonly long _startBlock, _chunk, _confirmations;
    private readonly int _pollSeconds;
    private readonly string _publicUrl, _explorerTxBase;

    public ChainIndexer(IChainContext ctx, IDbContextFactory<AppDbContext> dbFactory, IPolicyManagerClient pm,
        INotificationService notifier, IConfiguration config, ILogger<ChainIndexer> log)
    {
        _ctx = ctx; _dbFactory = dbFactory; _pm = pm; _notifier = notifier; _log = log;

        _pmAddr = Need(config, "Blockchain:PolicyManagerAddress").ToLowerInvariant();
        _poolAddr = Need(config, "Blockchain:LiquidityPoolAddress").ToLowerInvariant();
        _engineAddr = Need(config, "Blockchain:PayoutEngineAddress").ToLowerInvariant();

        _startBlock = config.GetValue<long>("Indexer:StartBlock", 0);
        _pollSeconds = Math.Max(1, config.GetValue<int>("Indexer:PollSeconds", 10));
        _chunk = Math.Max(1, config.GetValue<long>("Indexer:BlockChunk", 10));
        _confirmations = Math.Max(0, config.GetValue<long>("Indexer:Confirmations", 2));

        _publicUrl = (config["App:PublicUrl"] ?? "http://localhost:4200").TrimEnd('/');
        _explorerTxBase = config["App:ExplorerTxBase"] ?? "https://sepolia.etherscan.io/tx/";
    }

    private static string Need(IConfiguration c, string key) =>
        c[key] ?? throw new InvalidOperationException($"Thieu {key}");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("ChainIndexer chay: StartBlock={Start} Chunk={Chunk} Confirmations={Conf} Poll={Poll}s",
            _startBlock, _chunk, _confirmations, _pollSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            var caughtUp = true;
            try
            {
                caughtUp = await RunOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Indexer loi, thu lai o chu ky sau");
                caughtUp = true; // loi thi nghi 1 chu ky roi thu lai
            }

            // Dang backfill thi chay lien tuc, chi nghi khi da bat kip
            if (!caughtUp) continue;
            try { await Task.Delay(TimeSpan.FromSeconds(_pollSeconds), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    /// true = da bat kip block moi nhat.
    private async Task<bool> RunOnceAsync(CancellationToken ct)
    {
        var head = (long)(await _ctx.Web3.Eth.Blocks.GetBlockNumber.SendRequestAsync()).Value;
        var latest = head - _confirmations;

        long last;
        await using (var db = await _dbFactory.CreateDbContextAsync(ct))
        {
            var st = await db.IndexerStates.AsNoTracking().FirstOrDefaultAsync(ct);
            last = st?.LastBlock ?? (_startBlock - 1);
        }

        var from = last + 1;
        if (from > latest) return true;

        var to = Math.Min(from + _chunk - 1, latest);
        await ProcessRangeAsync(from, to, ct);
        return to >= latest;
    }

    private async Task ProcessRangeAsync(long from, long to, CancellationToken ct)
    {
        // 1. Mot getLogs cho 3 contract, khong loc topic, decode theo ABI
        var filter = new NewFilterInput
        {
            FromBlock = new BlockParameter((ulong)from),
            ToBlock = new BlockParameter((ulong)to),
            Address = new[] { _pmAddr, _poolAddr, _engineAddr },
        };
        var logs = await _ctx.Web3.Eth.Filters.GetLogs.SendRequestAsync(filter) ?? Array.Empty<FilterLog>();

        var decoded = DecodeAll(logs);
        decoded.Sort((a, b) => a.BlockNumber != b.BlockNumber
            ? a.BlockNumber.CompareTo(b.BlockNumber)
            : a.LogIndex.CompareTo(b.LogIndex));

        // 2. block_time (cache theo block)
        var blockTimes = new Dictionary<long, DateTimeOffset>();
        foreach (var bn in decoded.Select(d => d.BlockNumber).Distinct())
        {
            var block = await _ctx.Web3.Eth.Blocks.GetBlockWithTransactionsHashesByNumber
                .SendRequestAsync(new BlockParameter((ulong)bn));
            blockTimes[bn] = DateTimeOffset.FromUnixTimeSeconds((long)block.Timestamp.Value);
        }
        foreach (var d in decoded) d.BlockTime = blockTimes[d.BlockNumber];

        // 3. Doc lai tu chain nhung policy/product bi anh huong (lam TRUOC khi mo transaction DB)
        var policyIds = decoded.Where(d => d.PolicyId.HasValue && AffectsPolicy(d.Name))
            .Select(d => d.PolicyId!.Value).Distinct().ToList();
        var productIds = new HashSet<long>();
        foreach (var d in decoded)
        {
            // Args da duoc doi BigInteger -> chuoi trong DecodeAll
            if (d.Name is "PolicyProductCreated") productIds.Add(long.Parse((string)d.Args["productId"]!));
            if (d.Name is "ProductStatusChanged") productIds.Add(long.Parse((string)d.Args["id"]!));
        }

        var productSnap = new Dictionary<long, ProductDTO>();
        async Task<ProductDTO> GetProduct(long id)
        {
            if (!productSnap.TryGetValue(id, out var p))
                productSnap[id] = p = await _pm.GetProductAsync((ulong)id, ct);
            return p;
        }

        foreach (var id in productIds) await GetProduct(id);

        var policySnap = new Dictionary<long, PolicyOutputDTO>();
        foreach (var id in policyIds)
        {
            var pol = await _pm.GetPolicyAsync((ulong)id, ct);
            policySnap[id] = pol;
            await GetProduct((long)pol.ProductId);
        }

        // 4. Mot transaction DB
        var fresh = new List<Decoded>();
        await using (var db = await _dbFactory.CreateDbContextAsync(ct))
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);

            // chain_events: bo qua event da co (tx_hash, log_index)
            var hashes = decoded.Select(d => d.TxHash).Distinct().ToList();
            var existing = hashes.Count == 0
                ? new HashSet<(string, int)>()
                : (await db.ChainEvents.AsNoTracking()
                    .Where(e => hashes.Contains(e.TxHash))
                    .Select(e => new { e.TxHash, e.LogIndex })
                    .ToListAsync(ct)).Select(e => (e.TxHash, e.LogIndex)).ToHashSet();

            foreach (var d in decoded)
            {
                if (existing.Contains((d.TxHash, d.LogIndex))) continue;
                db.ChainEvents.Add(new ChainEvent
                {
                    BlockNumber = d.BlockNumber,
                    TxHash = d.TxHash,
                    LogIndex = d.LogIndex,
                    Contract = d.Contract,
                    EventName = d.Name,
                    PolicyId = d.PolicyId,
                    WalletAddress = d.Wallet,
                    Args = JsonSerializer.SerializeToDocument(d.Args, ArgsJson),
                    BlockTime = d.BlockTime,
                });
                fresh.Add(d);
            }

            // products_cache
            foreach (var (id, p) in productSnap)
            {
                var row = await db.ProductsCache.FirstOrDefaultAsync(x => x.ProductId == id, ct);
                if (row == null) db.ProductsCache.Add(row = new ProductCache { ProductId = id });
                row.Name = p.Name;
                row.PerilType = p.PerilType;
                row.Threshold = p.Threshold;
                row.DurationDays = (int)p.DurationDays;
                row.PremiumWei = p.Premium;
                row.CoverageWei = p.CoverageAmount;
                row.Active = p.Active;
                row.UpdatedAt = DateTimeOffset.UtcNow;
            }

            // policies_cache: truong lay tu chain + tx hash lay tu event
            foreach (var (id, pol) in policySnap)
            {
                var prod = productSnap[(long)pol.ProductId];
                var row = await db.PoliciesCache.FirstOrDefaultAsync(x => x.PolicyId == id, ct);
                if (row == null) db.PoliciesCache.Add(row = new PolicyCache { PolicyId = id });

                row.ProductId = (long)pol.ProductId;
                row.PerilType = prod.PerilType;
                row.Holder = pol.Holder.ToLowerInvariant();
                row.LatE6 = (long)pol.Lat;
                row.LngE6 = (long)pol.Lng;
                row.RegionId = ChainUnits.Hex(pol.RegionId);
                row.Status = pol.Status;
                row.StartTime = (long)pol.StartTime;
                row.EndTime = (long)pol.EndTime;
                row.PremiumWei = prod.Premium; // premiumPaid tren chain ve 0 sau khi hoan phi, nen lay theo san pham
                row.CoverageWei = pol.CoverageAmount;
                row.UpdatedAt = DateTimeOffset.UtcNow;

                foreach (var ev in decoded.Where(e => e.PolicyId == id))
                {
                    switch (ev.Name)
                    {
                        case "PolicyCreated":
                            row.CreatedTx = ev.TxHash;
                            break;
                        case "PolicyVerified":
                            row.VerifiedTx = ev.TxHash;
                            if (!(bool)ev.Args["approved"]!)
                            {
                                row.Rejected = true;
                                row.ClosedTx = ev.TxHash;
                            }
                            break;
                        case "PayoutTriggered":
                            row.PayoutTx = ev.TxHash;
                            break;
                        case "PolicyExpired":
                            row.ClosedTx = ev.TxHash;
                            if ((bool)ev.Args["refunded"]!) row.Rejected = true; // het han khi chua duoc duyet
                            break;
                    }
                }
            }

            // indexer_state
            var state = await db.IndexerStates.FirstOrDefaultAsync(ct);
            if (state == null) db.IndexerStates.Add(new IndexerState { Id = 1, LastBlock = to });
            else state.LastBlock = to;

            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }

        if (decoded.Count > 0)
            _log.LogInformation("Indexer block {From}-{To}: {N} event ({New} moi)", from, to, decoded.Count, fresh.Count);

        // 5. Thong bao SAU khi commit, chi cho event moi va khong qua cu (backfill khong spam)
        await NotifyAsync(fresh, policySnap, ct);
    }

    private static bool AffectsPolicy(string name) => name is
        "PolicyCreated" or "EvidenceSubmitted" or "PolicyVerified" or "PolicyExpired"
        or "PayoutMarked" or "PayoutTriggered";

    private static readonly JsonSerializerOptions ArgsJson = new();

    // ===================== Decode =====================

    private string ContractOf(FilterLog log)
    {
        var a = log.Address.ToLowerInvariant();
        return a == _pmAddr ? "policyManager" : a == _poolAddr ? "pool" : a == _engineAddr ? "payoutEngine" : "other";
    }

    private void Collect<T>(FilterLog[] logs, string name, List<Decoded> sink, Func<T, Mapped> map)
        where T : class, IEventDTO, new()
    {
        foreach (var ev in logs.DecodeAllEvents<T>())
        {
            var m = map(ev.Event);
            sink.Add(new Decoded
            {
                Log = ev.Log,
                Contract = ContractOf(ev.Log),
                Name = name,
                PolicyId = m.PolicyId,
                Wallet = m.Wallet,
                Args = m.Args,
            });
        }
    }

    private static string Addr(string a) => a.ToLowerInvariant();

    private List<Decoded> DecodeAll(FilterLog[] logs)
    {
        var o = new List<Decoded>();
        if (logs.Length == 0) return o;

        // PolicyManager
        Collect<PolicyProductCreatedEvent>(logs, "PolicyProductCreated", o, e => new Mapped(null, null, new()
        {
            ["productId"] = e.ProductId, ["name"] = e.Name,
            ["premium"] = e.Premium, ["coverageAmount"] = e.CoverageAmount,
        }));
        Collect<PolicyCreatedEvent>(logs, "PolicyCreated", o, e => new Mapped((long)e.PolicyId, Addr(e.Holder), new()
        {
            ["policyId"] = e.PolicyId, ["productId"] = e.ProductId, ["holder"] = Addr(e.Holder),
            ["lat"] = e.Lat, ["lng"] = e.Lng, ["regionId"] = ChainUnits.Hex(e.RegionId),
            ["premiumPaid"] = e.PremiumPaid, ["coverageAmount"] = e.CoverageAmount, ["endTime"] = e.EndTime,
        }));
        Collect<ProductStatusChangedEvent>(logs, "ProductStatusChanged", o, e => new Mapped(null, null, new()
        {
            ["id"] = e.Id, ["active"] = e.Active,
        }));
        Collect<EvidenceSubmittedEvent>(logs, "EvidenceSubmitted", o, e => new Mapped((long)e.PolicyId, null, new()
        {
            ["policyId"] = e.PolicyId, ["fieldPhotoHash"] = ChainUnits.Hex(e.FieldPhotoHash),
            ["documentHash"] = ChainUnits.Hex(e.DocumentHash),
        }));
        Collect<PolicyVerifiedEvent>(logs, "PolicyVerified", o, e => new Mapped((long)e.PolicyId, null, new()
        {
            ["policyId"] = e.PolicyId, ["approved"] = e.Approved,
        }));
        Collect<PolicyExpiredEvent>(logs, "PolicyExpired", o, e => new Mapped((long)e.PolicyId, null, new()
        {
            ["policyId"] = e.PolicyId, ["refunded"] = e.Refunded,
        }));
        Collect<PayoutMarkedEvent>(logs, "PayoutMarked", o, e => new Mapped((long)e.PolicyId, null, new()
        {
            ["policyId"] = e.PolicyId,
        }));
        Collect<CoolingOffPeriodSetEvent>(logs, "CoolingOffPeriodSet", o, e => new Mapped(null, null, new()
        {
            ["seconds"] = e.Seconds,
        }));
        Collect<VerifierSetEvent>(logs, "VerifierSet", o, e => new Mapped(null, null, new()
        {
            ["verifier"] = Addr(e.Verifier),
        }));

        // LiquidityPool
        Collect<LiquidityAddedEvent>(logs, "LiquidityAdded", o, e => new Mapped(null, Addr(e.Provider), new()
        {
            ["provider"] = Addr(e.Provider), ["amount"] = e.Amount,
        }));
        Collect<LiquidityWithdrawnEvent>(logs, "LiquidityWithdrawn", o, e => new Mapped(null, Addr(e.Provider), new()
        {
            ["provider"] = Addr(e.Provider), ["amount"] = e.Amount,
        }));
        Collect<PolicyRefundedEvent>(logs, "PolicyRefunded", o, e => new Mapped((long)e.PolicyId, Addr(e.To), new()
        {
            ["policyId"] = e.PolicyId, ["to"] = Addr(e.To),
            ["refundAmount"] = e.RefundAmount, ["unlockedCoverage"] = e.UnlockedCoverage,
        }));
        Collect<CoverageUnlockedEvent>(logs, "CoverageUnlocked", o, e => new Mapped((long)e.PolicyId, null, new()
        {
            ["policyId"] = e.PolicyId, ["amount"] = e.Amount,
        }));

        // PayoutEngine
        Collect<PayoutTriggeredEvent>(logs, "PayoutTriggered", o, e => new Mapped((long)e.PolicyId, Addr(e.Holder), new()
        {
            ["policyId"] = e.PolicyId, ["holder"] = Addr(e.Holder), ["amount"] = e.Amount,
        }));

        // BigInteger khong serialize chinh xac thanh so JSON -> luu dang chuoi
        foreach (var d in o)
            foreach (var k in d.Args.Keys.ToList())
                if (d.Args[k] is BigInteger b) d.Args[k] = b.ToString();

        return o;
    }

    // ===================== Thong bao =====================

    private async Task NotifyAsync(List<Decoded> fresh, Dictionary<long, PolicyOutputDTO> policySnap, CancellationToken ct)
    {
        var cutoff = DateTimeOffset.UtcNow - MaxNotifyAge;

        foreach (var ev in fresh)
        {
            if (ev.BlockTime < cutoff) continue; // event cu (backfill): khong thong bao
            if (ev.PolicyId is not { } id) continue;

            try
            {
                string? wallet = null, type = null, title = null, body = null;

                if (ev.Name == "PayoutTriggered")
                {
                    wallet = (string?)ev.Args["holder"];
                    var amount = ChainUnits.TryBig((string?)ev.Args["amount"], out var a) ? a : BigInteger.Zero;
                    type = "payout_sent";
                    title = "Đã nhận bồi thường";
                    body = $"Bạn đã nhận bồi thường {ChainUnits.EthString(amount)} ETH cho policy #{id}. " +
                           $"Xem giao dịch: {_explorerTxBase}{ev.TxHash}";
                }
                else if (ev.Name is "EvidenceSubmitted" or "PolicyVerified" or "PolicyExpired")
                {
                    if (!policySnap.TryGetValue(id, out var pol)) continue;
                    wallet = pol.Holder.ToLowerInvariant();

                    if (ev.Name == "EvidenceSubmitted")
                    {
                        type = "evidence_received";
                        title = "Đã nhận hồ sơ xác minh";
                        body = $"Đã nhận hồ sơ xác minh của policy #{id}. Chúng tôi sẽ duyệt sớm.";
                    }
                    else if (ev.Name == "PolicyVerified" && (bool)ev.Args["approved"]!)
                    {
                        type = "policy_approved";
                        title = "Policy đã được duyệt";
                        body = $"Policy #{id} đã được duyệt, có hiệu lực từ {FormatVn((long)pol.StartTime)}.";
                    }
                    else if (ev.Name == "PolicyVerified")
                    {
                        var note = await LatestRejectNoteAsync(id, ct);
                        type = "policy_rejected";
                        title = "Hồ sơ bị từ chối";
                        body = string.IsNullOrWhiteSpace(note)
                            ? $"Hồ sơ policy #{id} bị từ chối. Phí bảo hiểm đã được hoàn lại."
                            : $"Hồ sơ policy #{id} bị từ chối. Lý do: {note}. Phí bảo hiểm đã được hoàn lại.";
                    }
                    else
                    {
                        var refunded = (bool)ev.Args["refunded"]!;
                        type = "policy_expired";
                        title = "Policy đã hết hạn";
                        body = refunded
                            ? $"Policy #{id} hết hạn khi chưa được duyệt, phí đã hoàn lại."
                            : $"Policy #{id} đã hết hạn.";
                    }
                }

                if (wallet == null || type == null) continue;
                await _notifier.NotifyAsync(wallet, type, title!, body!, $"{_publicUrl}/policies/{id}", ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogWarning(ex, "Khong gui duoc thong bao cho event {Name} policy {Id}", ev.Name, ev.PolicyId);
            }
        }
    }

    private async Task<string?> LatestRejectNoteAsync(long policyId, CancellationToken ct)
    {
        await using var db = await _dbFactory.CreateDbContextAsync(ct);
        return await db.ReviewLogs.AsNoTracking()
            .Where(r => r.PolicyId == policyId && !r.Approved)
            .OrderByDescending(r => r.CreatedAt)
            .Select(r => r.Note)
            .FirstOrDefaultAsync(ct);
    }

    /// dd/MM/yyyy HH:mm theo gio Viet Nam (UTC+7, khong phu thuoc tzdata cua host).
    private static string FormatVn(long unix) =>
        DateTimeOffset.FromUnixTimeSeconds(unix).ToOffset(TimeSpan.FromHours(7))
            .ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture);
}
