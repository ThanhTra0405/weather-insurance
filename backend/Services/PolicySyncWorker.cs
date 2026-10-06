using backend.Data;
using backend.Services.interfaces;
using Microsoft.EntityFrameworkCore;
using Nethereum.Hex.HexConvertors.Extensions;

namespace backend.Services
{
    public class PolicySyncWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<PolicySyncWorker> _logger;
        private readonly TimeSpan _interval;

        public PolicySyncWorker(IServiceScopeFactory scopeFactory, ILogger<PolicySyncWorker> logger, IConfiguration config)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
            _interval = TimeSpan.FromSeconds(config.GetValue<int>("Blockchain:SyncIntervalSeconds", 30));
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try { await SyncOnceAsync(stoppingToken); }
                catch (Exception ex) { _logger.LogError(ex, "Loi dong bo policy"); }

                await Task.Delay(_interval, stoppingToken);
            }
        }

        private async Task SyncOnceAsync(CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var chain = scope.ServiceProvider.GetRequiredService<IPolicyManagerClient>();

            var nextId = await chain.GetNextPolicyIdAsync(ct);
            var maxKnown = await db.Policies.MaxAsync(p => (long?)p.PolicyId, ct) ?? 0;

            var ids = new HashSet<ulong>();
            for (ulong i = (ulong)maxKnown + 1; i < nextId; i++) ids.Add(i);

            var open = await db.Policies
                .Where(p => p.Status == 0 || p.Status == 1)
                .Select(p => p.PolicyId)
                .ToListAsync(ct);
            foreach (var id in open) ids.Add((ulong)id);

            foreach (var id in ids.OrderBy(x => x))
            {
                ct.ThrowIfCancellationRequested();
                var p = await chain.GetPolicyAsync(id, ct);

                var rec = await db.Policies.FindAsync(new object[] { (long)id }, ct);
                if (rec is null)
                {
                    rec = new Data.Entities.PolicyRecord { PolicyId = (long)id };
                    db.Policies.Add(rec);
                }

                rec.ProductId = (long)p.ProductId;
                rec.Holder = p.Holder;
                rec.Lat = (decimal)p.Lat / 1_000_000m;
                rec.Lng = (decimal)p.Lng / 1_000_000m;
                rec.RegionId = "0x" + p.RegionId.ToHex();
                rec.StartTime = DateTimeOffset.FromUnixTimeSeconds((long)p.StartTime);
                rec.EndTime = DateTimeOffset.FromUnixTimeSeconds((long)p.EndTime);
                rec.PremiumPaidWei = p.PremiumPaid.ToString();
                rec.CoverageAmountWei = p.CoverageAmount.ToString();
                rec.Status = p.Status;
                rec.SyncedAt = DateTimeOffset.UtcNow;
            }

            if (ids.Count > 0)
            {
                await db.SaveChangesAsync(ct);
                _logger.LogInformation("Da dong bo {Count} policy vao DB", ids.Count);
            }
        }
    }
}
