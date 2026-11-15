using backend.Services.interfaces;

namespace backend.Services.App;

/// <summary>
/// Bản tạm của INotificationService (ngày 1): chỉ ghi log.
/// Ngày 2 thay bằng NotificationService thật (lưu DB + Telegram + email) mà không phải sửa chỗ gọi.
/// </summary>
public class LogNotificationService : INotificationService
{
    private readonly ILogger<LogNotificationService> _logger;

    public LogNotificationService(ILogger<LogNotificationService> logger)
    {
        _logger = logger;
    }

    public Task NotifyAsync(string walletAddress, string type, string title, string body,
                            string? link = null, CancellationToken ct = default)
    {
        _logger.LogInformation("[Thông báo] {Wallet} | {Type} | {Title} | {Body} | {Link}",
            walletAddress, type, title, body, link);
        return Task.CompletedTask;
    }
}
