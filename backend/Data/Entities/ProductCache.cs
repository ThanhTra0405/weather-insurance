using System.Numerics;

namespace backend.Data.Entities;

/// <summary>Bản sao gói bảo hiểm từ chain (A ghi).</summary>
public class ProductCache
{
    public long ProductId { get; set; }
    public string Name { get; set; } = "";
    public short PerilType { get; set; }
    public BigInteger Threshold { get; set; }
    public int DurationDays { get; set; }
    public BigInteger PremiumWei { get; set; }
    public BigInteger CoverageWei { get; set; }
    public bool Active { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
