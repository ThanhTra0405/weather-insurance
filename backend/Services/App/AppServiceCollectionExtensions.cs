using backend.Auth;
using backend.Common;
using backend.Data;
using backend.Options;
using backend.Services.interfaces;

namespace backend.Services.App;

public static class AppServiceCollectionExtensions
{
    /// <summary>
    /// Đăng ký toàn bộ dịch vụ của module Application (B): options, cơ sở dữ liệu, xác thực, audit,
    /// lưu ảnh bằng chứng, thông báo và các hosted service thuộc nghiệp vụ ứng dụng.
    /// PHẢI gọi trước <c>AddChainServices</c>: bản INotificationService thật phải có trước bản stub (TryAdd) của Chain,
    /// và DatabaseInitializer (migrate + seed) phải chạy xong trước OracleWorker của Chain.
    /// </summary>
    public static IServiceCollection AddAppServices(this IServiceCollection services, IConfiguration configuration)
    {
        // ----- Options -----
        services.Configure<JwtOptions>(configuration.GetSection(JwtOptions.SectionName));
        services.Configure<SupabaseOptions>(configuration.GetSection(SupabaseOptions.SectionName));
        services.Configure<SeedOptions>(configuration.GetSection(SeedOptions.SectionName));
        services.Configure<TelegramOptions>(configuration.GetSection(TelegramOptions.SectionName));
        services.Configure<SmtpOptions>(configuration.GetSection(SmtpOptions.SectionName));
        services.Configure<AppOptions>(configuration.GetSection(AppOptions.SectionName));
        services.Configure<DatabaseOptions>(configuration.GetSection(DatabaseOptions.SectionName));

        // ----- Cơ sở dữ liệu -----
        // Nơi DUY NHẤT đăng ký AppDbContext: IDbContextFactory (singleton, cho worker/service)
        // và AppDbContext scoped (cho controller).
        services.AddAppData(configuration);

        // ----- Xác thực / bảo mật -----
        services.AddSingleton<JwtService>();
        services.AddSingleton<StaffLoginThrottle>();

        // ----- Audit -----
        services.AddSingleton<IAuditLog, AuditLogger>();

        // ----- Lưu trữ bằng chứng -----
        services.AddHttpClient();
        services.AddSingleton<IEvidenceStorage, SupabaseEvidenceStorage>();

        // ----- Đọc dữ liệu chain phục vụ duyệt hồ sơ -----
        services.AddSingleton<IPolicyChainReader, PolicyChainReader>(); // tạm của B

        // ----- Thông báo -----
        // Bản thật: Chain gọi qua INotificationService, bản stub của Chain tự nhường (TryAdd).
        services.AddSingleton<IEmailSender, EmailSender>();
        services.AddSingleton<TelegramApi>();
        services.AddSingleton<INotificationService, NotificationService>();

        // ----- Hosted services -----
        // Thứ tự đăng ký = thứ tự khởi động. DatabaseInitializer PHẢI đứng đầu (migrate + seed,
        // StartAsync được chờ xong trước service kế tiếp).
        services.AddHostedService<DatabaseInitializer>();
        services.AddHostedService<TelegramBotService>();
        services.AddHostedService<TicketAutoCloseService>();
        // Đồng bộ policy từ chain vào bảng Policies của DB ứng dụng (đọc chain qua IPolicyManagerClient của Chain).
        services.AddHostedService<PolicySyncWorker>();

        return services;
    }
}