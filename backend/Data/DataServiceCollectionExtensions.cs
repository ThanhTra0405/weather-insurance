using Microsoft.EntityFrameworkCore;

namespace backend.Data;

public static class DataServiceCollectionExtensions
{
    /// <summary>
    /// Đăng ký IDbContextFactory (singleton, cho indexer/worker của A) và AppDbContext scoped (cho controller).
    /// </summary>
    public static IServiceCollection AddAppData(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Supabase");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "Chưa cấu hình ConnectionStrings:Supabase. Xem docs/supabase-setup.md (dotnet user-secrets set ...).");
        }

        services.AddDbContextFactory<AppDbContext>(options =>
            AppDbContextOptions.Configure(options, connectionString));

        services.AddScoped(sp => sp.GetRequiredService<IDbContextFactory<AppDbContext>>().CreateDbContext());

        return services;
    }
}
