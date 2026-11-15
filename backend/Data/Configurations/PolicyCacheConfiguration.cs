using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data.Configurations;

public class PolicyCacheConfiguration : IEntityTypeConfiguration<PolicyCache>
{
    public void Configure(EntityTypeBuilder<PolicyCache> b)
    {
        b.ToTable("policies_cache");
        b.HasKey(x => x.PolicyId);
        b.Property(x => x.PolicyId).ValueGeneratedNever();
        b.Property(x => x.Holder).IsRequired();
        // Đặt tên cột tường minh để không phụ thuộc cách tách chữ+số của naming convention.
        b.Property(x => x.LatE6).HasColumnName("lat_e6");
        b.Property(x => x.LngE6).HasColumnName("lng_e6");
        b.Property(x => x.RegionId).IsRequired();
        b.Property(x => x.PremiumWei).HasColumnType("numeric(78,0)");
        b.Property(x => x.CoverageWei).HasColumnType("numeric(78,0)");
        b.Property(x => x.Rejected).HasDefaultValue(false);
        b.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");

        b.HasIndex(x => x.Holder);
        b.HasIndex(x => x.Status);
    }
}
