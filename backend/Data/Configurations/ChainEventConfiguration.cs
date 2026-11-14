using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data.Configurations;

public class ChainEventConfiguration : IEntityTypeConfiguration<ChainEvent>
{
    public void Configure(EntityTypeBuilder<ChainEvent> b)
    {
        b.ToTable("chain_events");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).UseIdentityByDefaultColumn();
        b.Property(x => x.TxHash).IsRequired();
        b.Property(x => x.Contract).IsRequired();
        b.Property(x => x.EventName).IsRequired();
        b.Property(x => x.WalletAddress).HasColumnName("wallet_address");
        b.Property(x => x.Args).HasColumnType("jsonb").IsRequired();

        b.HasIndex(x => new { x.TxHash, x.LogIndex }).IsUnique();
        b.HasIndex(x => x.PolicyId);
        b.HasIndex(x => new { x.EventName, x.BlockNumber }).IsDescending(false, true);
    }
}
