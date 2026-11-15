using backend.Repository;
using backend.Services.interfaces;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace backend.Services.Chain;

public static class ChainServiceCollectionExtensions
{
    public static IServiceCollection AddChainServices(this IServiceCollection s, IConfiguration c)
    {
        // Nen tang: 1 Web3 + 1 khoa nonce dung chung cho moi tx cua operator
        s.AddSingleton<IChainContext, ChainContext>();

        // Ban stub; neu B da dang ky ban that truoc do thi TryAdd khong de
        s.TryAddSingleton<INotificationService, LogOnlyNotificationService>();

        s.AddHttpClient<IWeatherService, WeatherService>(h => h.Timeout = TimeSpan.FromSeconds(15));
        s.AddSingleton<INearestStationService, NearestStationService>();
        s.AddSingleton<IRegionService, RegionService>();
        s.AddSingleton<IOracleSubmitter, OracleSubmitter>();
        s.AddSingleton<IPolicyManagerClient, PolicyManagerClient>();
        s.AddSingleton<IPayoutEngineClient, PayoutEngineClient>();
        s.AddSingleton<StationRepository>();

        s.AddSingleton<IFaucetService, FaucetService>();
        s.AddSingleton<IAdminChainClient, AdminChainClient>();

        s.AddScoped<IOracleCycle, OracleCycle>();

        // Thu tu: indexer chay truoc de policies_cache co du lieu cho oracle
        s.AddHostedService<ChainIndexer>();
        s.AddHostedService<OracleWorker>();
        return s;
    }
}
