using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data.Configurations;

public class CannedReplyConfiguration : IEntityTypeConfiguration<CannedReply>
{
    public void Configure(EntityTypeBuilder<CannedReply> b)
    {
        b.ToTable("canned_replies");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).UseIdentityByDefaultColumn();
        b.Property(x => x.Title).IsRequired();
        b.Property(x => x.Body).IsRequired();
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        b.HasOne<Staff>().WithMany().HasForeignKey(x => x.CreatedBy).OnDelete(DeleteBehavior.NoAction);
    }
}
