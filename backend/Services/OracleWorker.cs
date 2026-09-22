using System;
using System.Collections.Generic;
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

            // TODO: thay bang danh sach region dang co policy active that,
            // hien tai chi la 1 vung mau de demo
            var demoLat = 10.0452m;
            var demoLng = 105.7469m;

            var regionId = regionService.ComputeRegionId(demoLat, demoLng);
            var weather = await weatherService.GetRainfallLast30DaysAsync(demoLat, demoLng, ct);

            var txHash = await oracleSubmitter.SubmitWeatherDataAsync(regionId, weather.Value, weather.Timestamp, ct);
            _logger.LogInformation("Da gui du lieu oracle, tx = {TxHash}", txHash);
        }
    }
}