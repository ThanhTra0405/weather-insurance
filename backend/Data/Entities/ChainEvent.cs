using System.Text.Json;

namespace backend.Data.Entities;

/// <summary>Sự kiện contract do indexer (của A) ghi vào.</summary>
public class ChainEvent
{
    public long Id { get; set; }
    public long BlockNumber { get; set; }
    public string TxHash { get; set; } = "";
    public int LogIndex { get; set; }

    /// <summary>policyManager | pool | payoutEngine | oracle</summary>
    public string Contract { get; set; } = "";
    public string EventName { get; set; } = "";
    public long? PolicyId { get; set; }
    public string? WalletAddress { get; set; }
    public JsonDocument Args { get; set; } = null!;
    public DateTimeOffset BlockTime { get; set; }
}
