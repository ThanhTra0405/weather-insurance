using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data.Configurations;

public class OracleLogConfiguration : IEntityTypeConfiguration<OracleLog>
{
    public void Configure(EntityTypeBuilder<OracleLog> b)
    {
        b.ToTable("oracle_logs", t =>
            t.HasCheckConstraint("ck_oracle_logs_status", "status in ('ok','error')"));
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).UseIdentityByDefaultColumn();
        b.Property(x => x.RegionId).IsRequired();
        b.Property(x => x.ValueScaled).HasColumnType("numeric(78,0)");
        b.Property(x => x.Status).IsRequired();
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        b.HasIndex(x => new { x.RegionId, x.PerilType, x.CreatedAt }).IsDescending(false, false, true);
    }
}
