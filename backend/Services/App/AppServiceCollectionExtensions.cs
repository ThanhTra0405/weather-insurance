using backend.Auth;
using backend.Common;
using backend.Data;
using backend.Options;
using backend.Services.interfaces;

namespace backend.Services.App;

public static class AppServiceCollectionExtensions
{
    /// <summary>
    /// Đăng ký dịch vụ của B: cơ sở dữ liệu, options, JWT, audit log, thông báo.
    /// PHẢI gọi trước khối đăng ký hosted service của A để DatabaseInitializer chạy xong trước.
    /// </summary>
    public static IServiceCollection AddAppServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<JwtOptions>(configuration.GetSection(JwtOptions.SectionName));
        services.Configure<SupabaseOptions>(configuration.GetSection(SupabaseOptions.SectionName));
        services.Configure<SeedOptions>(configuration.GetSection(SeedOptions.SectionName));
        services.Configure<TelegramOptions>(configuration.GetSection(TelegramOptions.SectionName));
        services.Configure<SmtpOptions>(configuration.GetSection(SmtpOptions.SectionName));
        services.Configure<AppOptions>(configuration.GetSection(AppOptions.SectionName));
        services.Configure<DatabaseOptions>(configuration.GetSection(DatabaseOptions.SectionName));

        services.AddAppData(configuration);

        services.AddSingleton<JwtService>();
        services.AddSingleton<StaffLoginThrottle>();
        services.AddSingleton<IAuditLog, AuditLogger>();
        services.AddSingleton<INotificationService, LogNotificationService>(); // ngày 2: thay bằng bản thật

        // Hosted service đầu tiên: migrate + seed (StartAsync được chờ xong trước service kế tiếp).
        services.AddHostedService<DatabaseInitializer>();

        return services;
    }
}
