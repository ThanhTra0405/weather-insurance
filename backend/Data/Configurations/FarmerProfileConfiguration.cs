using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data.Configurations;

public class FarmerProfileConfiguration : IEntityTypeConfiguration<FarmerProfile>
{
    public void Configure(EntityTypeBuilder<FarmerProfile> b)
    {
        b.ToTable("farmer_profiles", t =>
        {
            t.HasCheckConstraint("ck_farmer_profiles_wallet_lower", "wallet_address = lower(wallet_address)");
            t.HasCheckConstraint("ck_farmer_profiles_farm_area_positive", "farm_area_ha > 0");
        });
        b.HasKey(x => x.WalletAddress);
        b.Property(x => x.WalletAddress).HasColumnName("wallet_address");
        b.Property(x => x.FullName).IsRequired();
        b.Property(x => x.Phone).IsRequired();
        b.Property(x => x.Province).IsRequired();
        b.Property(x => x.District).IsRequired();
        b.Property(x => x.CropType).IsRequired();
        b.Property(x => x.FarmAreaHa).HasColumnType("numeric(10,2)");
        b.Property(x => x.FarmLat).HasColumnType("numeric(9,6)");
        b.Property(x => x.FarmLng).HasColumnType("numeric(9,6)");
        // Mặc định true: phải ValueGeneratedNever để giá trị false gửi lên không bị EF bỏ qua (nếu không DB sẽ gán true).
        b.Property(x => x.NotifyEmail).HasDefaultValue(true).ValueGeneratedNever();
        b.Property(x => x.NotifyTelegram).HasDefaultValue(false);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        b.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");
    }
}
