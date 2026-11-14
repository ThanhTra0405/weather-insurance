using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data.Configurations;

public class ReviewLogConfiguration : IEntityTypeConfiguration<ReviewLog>
{
    public void Configure(EntityTypeBuilder<ReviewLog> b)
    {
        b.ToTable("review_logs");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).UseIdentityByDefaultColumn();
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        b.HasIndex(x => new { x.PolicyId, x.CreatedAt }).IsDescending(false, true);
        b.HasOne<Staff>().WithMany().HasForeignKey(x => x.StaffId).OnDelete(DeleteBehavior.NoAction);
    }
}
