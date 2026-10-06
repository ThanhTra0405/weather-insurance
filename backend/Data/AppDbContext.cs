using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace backend.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }
        public DbSet<PolicyRecord> Policies => Set<PolicyRecord>();
        public DbSet<PayoutRecord> Payouts => Set<PayoutRecord>();
        public DbSet<OracleSubmission> OracleSubmissions => Set<OracleSubmission>();
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<PolicyRecord>(e =>
            {
                e.HasKey(x => x.PolicyId);
                e.Property(x => x.PolicyId).ValueGeneratedNever();
                e.Property(x => x.Lat).HasPrecision(9,6);
                e.Property(x => x.Lng).HasPrecision(9,6);
                e.HasIndex(x => x.Holder);
                e.HasIndex(x => x.RegionId);
                e.HasIndex(x => x.Status);
            });

            modelBuilder.Entity<OracleSubmission>(e =>
            {
                e.Property(x => x.RainfallMm).HasPrecision(12, 3);
                e.HasIndex(x => new { x. RegionId, x.CreatedAt });
            });

            modelBuilder.Entity<PayoutRecord>(e =>
            {
                e.HasIndex(x => x.PolicyId);
            });
        }
    }
}