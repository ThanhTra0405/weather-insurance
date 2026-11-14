using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace backend.Data;

/// <summary>
/// Dùng cho công cụ `dotnet ef` (không chạy Program.cs nên không seed/hosted service).
/// Đọc appsettings.json + user-secrets + biến môi trường, cùng cách với ứng dụng.
/// Tạo migration không cần kết nối thật; `dotnet ef database update` thì cần ConnectionStrings:Supabase.
/// </summary>
public class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    private const string PlaceholderConnection =
        "Host=localhost;Port=5432;Database=design_time_only;Username=postgres;Password=postgres";

    public AppDbContext CreateDbContext(string[] args)
    {
        var environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Development";

        var configuration = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile($"appsettings.{environment}.json", optional: true)
            .AddUserSecrets<AppDbContextFactory>(optional: true)
            .AddEnvironmentVariables()
            .Build();

        var connectionString = configuration.GetConnectionString("Supabase");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            Console.WriteLine(
                "[AppDbContextFactory] Chưa có ConnectionStrings:Supabase: dùng chuỗi giả, " +
                "chỉ đủ để tạo migration. `dotnet ef database update` sẽ không kết nối được.");
            connectionString = PlaceholderConnection;
        }

        var optionsBuilder = new DbContextOptionsBuilder<AppDbContext>();
        AppDbContextOptions.Configure(optionsBuilder, connectionString);
        return new AppDbContext(optionsBuilder.Options);
    }
}
