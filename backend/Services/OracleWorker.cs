using backend.Services.Chain;

namespace backend.Services
{
    /// Chi con vong lap: moi N phut goi IOracleCycle (logic nam trong OracleCycle).
    public class OracleWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<OracleWorker> _logger;
        private readonly TimeSpan _interval;

        public OracleWorker(IServiceScopeFactory scopeFactory, ILogger<OracleWorker> logger, IConfiguration config)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
            _interval = TimeSpan.FromMinutes(config.GetValue<int>("Blockchain:OracleIntervalMinutes", 30));
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = _scopeFactory.CreateScope();
                    var cycle = scope.ServiceProvider.GetRequiredService<IOracleCycle>();
                    var r = await cycle.RunAsync(refreshWeather: true, stoppingToken);
                    _logger.LogInformation("Oracle xong: gui {S}, payout {P}, dong {E}, loi {Err}",
                        r.SubmittedCount, r.PayoutCount, r.ExpiredCount, r.Errors.Count);
                }
                catch (OracleBusyException)
                {
                    _logger.LogInformation("Bo qua vong oracle vi dang co vong khac chay");
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Loi khi chay OracleWorker");
                }

                try { await Task.Delay(_interval, stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }
    }
}
