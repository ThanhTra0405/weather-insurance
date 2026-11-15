using System.Numerics;

namespace backend.Data.Entities;

/// <summary>Bản sao policy từ chain (A ghi).</summary>
public class PolicyCache
{
    public long PolicyId { get; set; }
    public long ProductId { get; set; }
    public short PerilType { get; set; }
    public string Holder { get; set; } = "";
    public long LatE6 { get; set; }
    public long LngE6 { get; set; }
    public string RegionId { get; set; } = "";

    /// <summary>0 PendingVerification, 1 Active, 2 PaidOut, 3 Closed.</summary>
    public short Status { get; set; }
    public long StartTime { get; set; }
    public long EndTime { get; set; }
    public BigInteger PremiumWei { get; set; }
    public BigInteger CoverageWei { get; set; }
    public bool Rejected { get; set; }
    public string? CreatedTx { get; set; }
    public string? VerifiedTx { get; set; }
    public string? PayoutTx { get; set; }
    public string? ClosedTx { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
