using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data.Configurations;

public class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> b)
    {
        b.ToTable("notifications");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).UseIdentityByDefaultColumn();
        b.Property(x => x.WalletAddress).HasColumnName("wallet_address").IsRequired();
        b.Property(x => x.Type).IsRequired();
        b.Property(x => x.Title).IsRequired();
        b.Property(x => x.Body).IsRequired();
        b.Property(x => x.IsRead).HasDefaultValue(false);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        b.HasIndex(x => new { x.WalletAddress, x.IsRead, x.CreatedAt }).IsDescending(false, false, true);
    }
}
