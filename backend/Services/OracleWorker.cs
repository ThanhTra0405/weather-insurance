using System;
using System.Linq;
using System.Threading.Tasks;
using backend.Services.interfaces;

namespace backend.Services
{
    public class OracleWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<OracleWorker> _logger;
        private readonly TimeSpan _interval;

        public OracleWorker(IServiceScopeFactory scopeFactory, ILogger<OracleWorker> logger, IConfiguration config)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
            var minutes = config.GetValue<int>("Blockchain:OracleIntervalMinutes", 30);
            _interval = TimeSpan.FromMinutes(minutes);
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await RunOnceAsync(stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Loi khi chay OracleWorker");
                }

                await Task.Delay(_interval, stoppingToken);
            }
        }

        private async Task RunOnceAsync(CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var weatherService = scope.ServiceProvider.GetRequiredService<IWeatherService>();
            var oracleSubmitter = scope.ServiceProvider.GetRequiredService<IOracleSubmitter>();
            var regionService = scope.ServiceProvider.GetRequiredService<IRegionService>();
            var policyManager = scope.ServiceProvider.GetRequiredService<IPolicyManagerClient>();
            var payoutEngine = scope.ServiceProvider.GetRequiredService<IPayoutEngineClient>();

            var snapshot = await policyManager.GetSnapshotAsync(ct);
            _logger.LogInformation(
                "Snapshot: {Active} policy dang hieu luc, {Expirable} policy can dong",
                snapshot.Active.Count, snapshot.Expirable.Count);

            // 1. Đẩy dữ liệu oracle cho từng vùng đang có policy hiệu lực (mỗi vùng 1 lần)
            var regions = snapshot.Active
                .GroupBy(p => Convert.ToHexString(p.RegionId))
                .Select(g => g.First());

            foreach (var p in regions)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var lat = (decimal)p.Lat / 1_000_000m;
                    var lng = (decimal)p.Lng / 1_000_000m;

                    var regionId = regionService.ComputeRegionId(lat, lng);
                    var weather = await weatherService.GetRainfallLast30DaysAsync(lat, lng, ct);
                    var txHash = await oracleSubmitter.SubmitWeatherDataAsync(regionId, weather.Value, weather.Timestamp, ct);
                    _logger.LogInformation("Da gui du lieu oracle cho vung cua policy {PolicyId}, tx = {TxHash}", p.Id, txHash);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Loi gui oracle cho policy {PolicyId}", p.Id);
                }
            }

            // 2. Policy nào đạt ngưỡng thì kích hoạt payout
            foreach (var p in snapshot.Active)
            {
                ct.ThrowIfCancellationRequested();
                var id = (ulong)p.Id;
                try
                {
                    if (!await payoutEngine.IsThresholdMetAsync(id, ct)) continue;

                    var txHash = await payoutEngine.CheckAndPayoutAsync(id, ct);
                    _logger.LogInformation("Da payout policy {PolicyId}, tx = {TxHash}", id, txHash);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Loi payout policy {PolicyId}", id);
                }
            }

            // 3. Policy quá hạn: đóng và mở khoá coverage (chưa duyệt thì hoàn premium)
            foreach (var p in snapshot.Expirable)
            {
                ct.ThrowIfCancellationRequested();
                var id = (ulong)p.Id;
                try
                {
                    var txHash = await policyManager.ExpirePolicyAsync(id, ct);
                    _logger.LogInformation("Da dong policy het han {PolicyId}, tx = {TxHash}", id, txHash);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Loi expire policy {PolicyId}", id);
                }
            }
        }
    }
}