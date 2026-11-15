using backend.Data;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.App;

/// <summary>
/// Bot Telegram dùng long polling getUpdates (SPEC-B mục 3). Tắt hẳn nếu chưa cấu hình Telegram:BotToken.
/// /start {MÃ} liên kết chat với hồ sơ nông dân; /stop gỡ liên kết.
/// </summary>
public class TelegramBotService : BackgroundService
{
    private const string HelpText =
        "Đây là bot thông báo của hệ thống Bảo hiểm thời tiết. " +
        "Để liên kết, hãy mở trang Hồ sơ trên ứng dụng, bấm \"Liên kết Telegram\" rồi mở đường dẫn được cấp. " +
        "Gửi /stop để ngừng nhận thông báo.";

    private readonly TelegramApi _api;
    private readonly IDbContextFactory<AppDbContext> _dbFactory;
    private readonly ILogger<TelegramBotService> _logger;

    public TelegramBotService(TelegramApi api, IDbContextFactory<AppDbContext> dbFactory,
        ILogger<TelegramBotService> logger)
    {
        _api = api;
        _dbFactory = dbFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_api.IsConfigured)
        {
            _logger.LogInformation("Chưa cấu hình Telegram:BotToken: tắt bot Telegram.");
            return;
        }

        _logger.LogInformation("Bot Telegram bắt đầu nhận tin (long polling).");
        long offset = 0;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var updates = await _api.GetUpdatesAsync(offset, 30, stoppingToken);
                foreach (var update in updates)
                {
                    // Tăng offset trước khi xử lý để một update lỗi không bị lặp mãi.
                    offset = Math.Max(offset, update.UpdateId + 1);
                    if (update.ChatId == 0 || string.IsNullOrWhiteSpace(update.Text)) continue;

                    await HandleAsync(update, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Lỗi khi nhận tin từ Telegram, thử lại sau 10 giây.");
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }
    }

    private async Task HandleAsync(TelegramMessageUpdate update, CancellationToken ct)
    {
        try
        {
            var parts = update.Text.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var command = parts[0].Split('@')[0].ToLowerInvariant();

            if (command == "/start" && parts.Length >= 2)
                await LinkAsync(update.ChatId, parts[1], ct);
            else if (command == "/stop")
                await UnlinkAsync(update.ChatId, ct);
            else
                await _api.SendMessageAsync(update.ChatId, HelpText, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Không xử lý được tin Telegram từ chat {ChatId}", update.ChatId);
        }
    }

    private async Task LinkAsync(long chatId, string rawCode, CancellationToken ct)
    {
        var code = rawCode.Trim().ToUpperInvariant();
        var now = DateTimeOffset.UtcNow;

        await using var db = await _dbFactory.CreateDbContextAsync(ct);
        var profile = await db.FarmerProfiles.FirstOrDefaultAsync(
            p => p.TelegramLinkCode == code && p.TelegramLinkExpiresAt != null && p.TelegramLinkExpiresAt > now, ct);

        if (profile == null)
        {
            await _api.SendMessageAsync(chatId,
                "Mã liên kết không hợp lệ hoặc đã hết hạn. Hãy mở trang Hồ sơ và bấm \"Liên kết Telegram\" để lấy mã mới.", ct);
            return;
        }

        // Một chat chỉ gắn với một hồ sơ.
        var others = await db.FarmerProfiles
            .Where(p => p.TelegramChatId == chatId && p.WalletAddress != profile.WalletAddress)
            .ToListAsync(ct);
        foreach (var other in others)
        {
            other.TelegramChatId = null;
            other.NotifyTelegram = false;
            other.UpdatedAt = now;
        }

        profile.TelegramChatId = chatId;
        profile.NotifyTelegram = true;
        profile.TelegramLinkCode = null;
        profile.TelegramLinkExpiresAt = null;
        profile.UpdatedAt = now;
        await db.SaveChangesAsync(ct);

        await _api.SendMessageAsync(chatId, "Đã liên kết tài khoản. Bạn sẽ nhận thông báo bảo hiểm tại đây.", ct);
    }

    private async Task UnlinkAsync(long chatId, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        await using var db = await _dbFactory.CreateDbContextAsync(ct);
        var profiles = await db.FarmerProfiles.Where(p => p.TelegramChatId == chatId).ToListAsync(ct);

        foreach (var profile in profiles)
        {
            profile.TelegramChatId = null;
            profile.NotifyTelegram = false;
            profile.UpdatedAt = now;
        }
        if (profiles.Count > 0) await db.SaveChangesAsync(ct);

        await _api.SendMessageAsync(chatId,
            profiles.Count > 0
                ? "Đã gỡ liên kết. Bạn sẽ không nhận thông báo tại đây nữa."
                : "Chat này chưa liên kết với tài khoản nào.", ct);
    }
}
