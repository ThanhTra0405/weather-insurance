using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data.Configurations;

public class AuthNonceConfiguration : IEntityTypeConfiguration<AuthNonce>
{
    public void Configure(EntityTypeBuilder<AuthNonce> b)
    {
        b.ToTable("auth_nonces");
        b.HasKey(x => x.WalletAddress);
        b.Property(x => x.WalletAddress).HasColumnName("wallet_address");
        b.Property(x => x.Nonce).IsRequired();
    }
}
