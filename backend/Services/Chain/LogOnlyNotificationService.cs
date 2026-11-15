using backend.Services.interfaces;

namespace backend.Services.Chain;

/// Ban tam thoi: chi ghi log. B se dang ky ban that, ban nay tu nhuong cho (TryAdd).
public sealed class LogOnlyNotificationService : INotificationService
{
    private readonly ILogger<LogOnlyNotificationService> _log;
    public LogOnlyNotificationService(ILogger<LogOnlyNotificationService> log) => _log = log;

    public Task NotifyAsync(string walletAddress, string type, string title, string body,
                            string? link = null, CancellationToken ct = default)
    {
        _log.LogInformation("[NOTIFY-STUB] {Wallet} | {Type} | {Title} | {Body} | {Link}",
            walletAddress, type, title, body, link);
        return Task.CompletedTask;
    }
}
