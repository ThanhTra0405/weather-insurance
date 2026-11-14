using backend.Data;
using backend.Data.Entities;
using backend.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Services.App;

/// <summary>
/// Chạy khi khởi động, được chờ xong trước các hosted service đăng ký sau nó (của A):
/// áp dụng migration (nếu Database:AutoMigrate = true) rồi seed tài khoản admin/support từ Seed:*.
/// Việc tạo bucket Storage sẽ thêm ở đợt 3 (cần IEvidenceStorage).
/// </summary>
public class DatabaseInitializer : IHostedService
{
    private const int BcryptCost = 11;
    private const int MinPasswordLength = 10;

    private readonly IDbContextFactory<AppDbContext> _dbFactory;
    private readonly DatabaseOptions _database;
    private readonly SeedOptions _seed;
    private readonly ILogger<DatabaseInitializer> _logger;

    public DatabaseInitializer(IDbContextFactory<AppDbContext> dbFactory, IOptions<DatabaseOptions> database,
        IOptions<SeedOptions> seed, ILogger<DatabaseInitializer> logger)
    {
        _dbFactory = dbFactory;
        _database = database.Value;
        _seed = seed.Value;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var db = await _dbFactory.CreateDbContextAsync(cancellationToken);

        if (_database.AutoMigrate)
        {
            _logger.LogInformation("Đang áp dụng migration cơ sở dữ liệu...");
            await db.Database.MigrateAsync(cancellationToken);
            _logger.LogInformation("Migration hoàn tất.");
        }

        await SeedStaffAsync(db, _seed.Admin, "admin", "Quản trị viên", cancellationToken);
        await SeedStaffAsync(db, _seed.Support, "support", "Chăm sóc khách hàng", cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private async Task SeedStaffAsync(AppDbContext db, SeedAccount account, string role, string fullName,
        CancellationToken ct)
    {
        if (!account.IsConfigured)
        {
            _logger.LogWarning("Chưa cấu hình Seed:{Role} (Email/Password): bỏ qua tạo tài khoản {Role}.",
                role == "admin" ? "Admin" : "Support", role);
            return;
        }

        if (await db.Staff.AnyAsync(s => s.Role == role, ct)) return; // đã có, không tạo thêm

        if (account.Password.Length < MinPasswordLength)
        {
            _logger.LogWarning("Mật khẩu Seed của {Role} ngắn hơn {Min} ký tự: bỏ qua tạo tài khoản.",
                role, MinPasswordLength);
            return;
        }

        var email = account.Email.Trim().ToLowerInvariant();
        if (await db.Staff.AnyAsync(s => s.Email == email, ct))
        {
            _logger.LogWarning("Email seed của {Role} đã dùng cho tài khoản khác: bỏ qua.", role);
            return;
        }

        db.Staff.Add(new Staff
        {
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(account.Password, BcryptCost),
            FullName = fullName,
            Role = role,
        });
        await db.SaveChangesAsync(ct);
        _logger.LogInformation("Đã tạo tài khoản {Role} mặc định ({Email}).", role, email);
    }
}
