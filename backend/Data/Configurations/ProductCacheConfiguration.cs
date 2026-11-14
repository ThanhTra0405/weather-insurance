using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data.Configurations;

public class ProductCacheConfiguration : IEntityTypeConfiguration<ProductCache>
{
    public void Configure(EntityTypeBuilder<ProductCache> b)
    {
        b.ToTable("products_cache");
        b.HasKey(x => x.ProductId);
        b.Property(x => x.ProductId).ValueGeneratedNever();
        b.Property(x => x.Name).IsRequired();
        b.Property(x => x.Threshold).HasColumnType("numeric(78,0)");
        b.Property(x => x.PremiumWei).HasColumnType("numeric(78,0)");
        b.Property(x => x.CoverageWei).HasColumnType("numeric(78,0)");
        b.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");
    }
}
