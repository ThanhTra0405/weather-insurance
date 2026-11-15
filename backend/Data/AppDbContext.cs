using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace backend.Data;

/// <summary>
/// DbContext chung của B và A. Schema do EF Core migrations tạo (thư mục Data/Migrations),
/// mô hình tham chiếu ở docs/specs/SPEC-00-shared.md mục 3. Chỉ B tạo migration.
/// </summary>
public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    // Người dùng
    public DbSet<FarmerProfile> FarmerProfiles => Set<FarmerProfile>();
    public DbSet<Staff> Staff => Set<Staff>();
    public DbSet<AuthNonce> AuthNonces => Set<AuthNonce>();

    // Hồ sơ xác minh
    public DbSet<EvidenceMeta> EvidenceMetas => Set<EvidenceMeta>();
    public DbSet<ReviewLog> ReviewLogs => Set<ReviewLog>();

    // CSKH và thông báo
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<TicketMessage> TicketMessages => Set<TicketMessage>();
    public DbSet<CannedReply> CannedReplies => Set<CannedReply>();
    public DbSet<Notification> Notifications => Set<Notification>();

    // Dữ liệu chain (A ghi)
    public DbSet<ChainEvent> ChainEvents => Set<ChainEvent>();
    public DbSet<ProductCache> ProductsCache => Set<ProductCache>();
    public DbSet<PolicyCache> PoliciesCache => Set<PolicyCache>();
    public DbSet<IndexerState> IndexerStates => Set<IndexerState>();
    public DbSet<OracleLog> OracleLogs => Set<OracleLog>();

    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}
