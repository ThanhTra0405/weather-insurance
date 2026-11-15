namespace backend.Services.interfaces;

public interface INotificationService
{
    Task NotifyAsync(string walletAddress, string type, string title, string body,
                     string? link = null, CancellationToken ct = default);
}
