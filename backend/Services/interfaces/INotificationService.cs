namespace backend.Services.interfaces;

/// <summary>
/// Gửi thông báo cho nông dân (B cài đặt, A gọi từ indexer).
/// type hợp lệ: evidence_received, policy_approved, policy_rejected, payout_sent,
/// policy_expired, ticket_reply, ticket_status.
/// </summary>
public interface INotificationService
{
    Task NotifyAsync(string walletAddress, string type, string title, string body,
                     string? link = null, CancellationToken ct = default);
}
