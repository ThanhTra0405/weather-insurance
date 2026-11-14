using System.Numerics;

namespace backend.Data.Entities;

/// <summary>Nhật ký oracle gửi dữ liệu thời tiết (A ghi).</summary>
public class OracleLog
{
    public long Id { get; set; }
    public string RegionId { get; set; } = "";
    public short PerilType { get; set; }
    public BigInteger? ValueScaled { get; set; }
    public long? DataTs { get; set; }
    public string? TxHash { get; set; }

    /// <summary>ok | error</summary>
    public string Status { get; set; } = "ok";
    public string? Error { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
