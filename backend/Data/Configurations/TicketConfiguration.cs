using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data.Configurations;

public class TicketConfiguration : IEntityTypeConfiguration<Ticket>
{
    public void Configure(EntityTypeBuilder<Ticket> b)
    {
        b.ToTable("tickets", t =>
        {
            t.HasCheckConstraint("ck_tickets_category",
                "category in ('review_rejected','payout_missing','policy_info','technical','other')");
            t.HasCheckConstraint("ck_tickets_status",
                "status in ('open','in_progress','waiting_customer','resolved','closed')");
            t.HasCheckConstraint("ck_tickets_priority", "priority in ('low','normal','high')");
            t.HasCheckConstraint("ck_tickets_rating", "rating between 1 and 5");
        });
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).UseIdentityByDefaultColumn();
        b.Property(x => x.WalletAddress).HasColumnName("wallet_address").IsRequired();
        b.Property(x => x.Category).IsRequired();
        b.Property(x => x.Subject).IsRequired();
        b.Property(x => x.Status).IsRequired().HasDefaultValue("open");
        b.Property(x => x.Priority).IsRequired().HasDefaultValue("normal");
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        b.Property(x => x.UpdatedAt).HasDefaultValueSql("now()");

        b.HasIndex(x => x.WalletAddress);
        b.HasIndex(x => new { x.Status, x.UpdatedAt }).IsDescending(false, true);

        b.HasOne<FarmerProfile>().WithMany().HasForeignKey(x => x.WalletAddress).OnDelete(DeleteBehavior.NoAction);
        b.HasOne<Staff>().WithMany().HasForeignKey(x => x.AssignedTo).OnDelete(DeleteBehavior.NoAction);
    }
}
