using Microsoft.EntityFrameworkCore;

namespace backend.Data;

/// <summary>Cấu hình Npgsql dùng chung cho ứng dụng và công cụ `dotnet ef`.</summary>
public static class AppDbContextOptions
{
    public static void Configure(DbContextOptionsBuilder options, string connectionString)
    {
        options
            .UseNpgsql(connectionString)
            .UseSnakeCaseNamingConvention();
    }
}
