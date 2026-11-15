using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data.Configurations;

public class EvidenceMetaConfiguration : IEntityTypeConfiguration<EvidenceMeta>
{
    public void Configure(EntityTypeBuilder<EvidenceMeta> b)
    {
        b.ToTable("evidence_meta");
        b.HasKey(x => x.PolicyId);
        b.Property(x => x.PolicyId).ValueGeneratedNever();
        b.Property(x => x.Holder).IsRequired();
        b.Property(x => x.SelfieHash).IsRequired();
        b.Property(x => x.FieldHash).IsRequired();
        b.Property(x => x.DocumentHash).IsRequired();
        b.Property(x => x.SelfiePath).IsRequired();
        b.Property(x => x.FieldPath).IsRequired();
        b.Property(x => x.DocumentPath).IsRequired();
        b.Property(x => x.Locked).HasDefaultValue(false);
        b.Property(x => x.UploadedAt).HasDefaultValueSql("now()");
    }
}
