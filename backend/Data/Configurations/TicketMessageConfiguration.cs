using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data.Configurations;

public class TicketMessageConfiguration : IEntityTypeConfiguration<TicketMessage>
{
    public void Configure(EntityTypeBuilder<TicketMessage> b)
    {
        b.ToTable("ticket_messages", t =>
            t.HasCheckConstraint("ck_ticket_messages_sender_type", "sender_type in ('farmer','staff','system')"));
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).UseIdentityByDefaultColumn();
        b.Property(x => x.SenderType).IsRequired();
        b.Property(x => x.Body).IsRequired();
        b.Property(x => x.IsInternal).HasDefaultValue(false);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        b.HasIndex(x => new { x.TicketId, x.CreatedAt });

        b.HasOne(x => x.Ticket).WithMany(t => t.Messages)
            .HasForeignKey(x => x.TicketId).OnDelete(DeleteBehavior.Cascade);
    }
}
