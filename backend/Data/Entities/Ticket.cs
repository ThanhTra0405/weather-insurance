namespace backend.Data.Entities;

/// <summary>Phiếu hỗ trợ của nông dân.</summary>
public class Ticket
{
    public long Id { get; set; }
    public string WalletAddress { get; set; } = "";
    public long? PolicyId { get; set; }

    /// <summary>review_rejected | payout_missing | policy_info | technical | other</summary>
    public string Category { get; set; } = "other";
    public string Subject { get; set; } = "";

    /// <summary>open | in_progress | waiting_customer | resolved | closed</summary>
    public string Status { get; set; } = "open";

    /// <summary>low | normal | high</summary>
    public string Priority { get; set; } = "normal";
    public Guid? AssignedTo { get; set; }
    public short? Rating { get; set; }
    public string? RatingComment { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }

    public ICollection<TicketMessage> Messages { get; set; } = new List<TicketMessage>();
}
