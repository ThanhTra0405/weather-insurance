using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data.Configurations;

public class IndexerStateConfiguration : IEntityTypeConfiguration<IndexerState>
{
    public void Configure(EntityTypeBuilder<IndexerState> b)
    {
        b.ToTable("indexer_state", t => t.HasCheckConstraint("ck_indexer_state_single_row", "id = 1"));
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasDefaultValue(1).ValueGeneratedNever();
    }
}
