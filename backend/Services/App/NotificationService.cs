using System.Net;
using backend.Common;
using backend.Data;
using backend.Data.Entities;
using backend.Options;
using backend.Services.interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Services.App;

/// <summary>
/// Cài đặt thật của INotificationService (SPEC-B mục 7.1): lưu bảng notifications rồi gửi Telegram/email
/// ở nền, không chặn luồng gọi. Chữ ký giữ nguyên bản stub nên chỗ gọi (indexer của A) không phải sửa.
/// Singleton: dùng IDbContextFactory.
/// </summary>
public class NotificationService : INotificationService
{
    private static readonly TimeSpan DedupeWindow = TimeSpan.FromSeconds(60);

    private readonly IDbContextFactory<AppDbContext> _dbFactory;
    private readonly IEmailSender _email;
    private readonly TelegramApi _telegram;
    private readonly AppOptions _app;
    private readonly ILogger<NotificationService> _logger;

    private int _loggedNoSmtp;
    private int _loggedNoTelegram;

    public NotificationService(IDbContextFactory<AppDbContext> dbFactory, IEmailSender email, TelegramApi telegram,
        IOptions<AppOptions> app, ILogger<NotificationService> logger)
    {
        _dbFactory = dbFactory;
        _email = email;
        _telegram = telegram;
        _app = app.Value;
        _logger = logger;
    }

    private sealed record Recipient(string? Email, bool NotifyEmail, bool NotifyTelegram, long? TelegramChatId);

    public async Task NotifyAsync(string walletAddress, string type, string title, string body,
        string? link = null, CancellationToken ct = default)
    {
        if (!WalletAddress.TryNormalize(walletAddress, out var wallet))
        {
            _logger.LogWarning("Bỏ qua thông báo {Type}: địa chỉ ví không hợp lệ ({Wallet})", type, walletAddress);
            return;
        }

        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        // Chống trùng: cùng ví + loại + link trong 60 giây thì bỏ qua.
        var cutoff = DateTimeOffset.UtcNow - DedupeWindow;
        var duplicate = await db.Notifications.AsNoTracking().AnyAsync(
            n => n.WalletAddress == wallet && n.Type == type && n.Link == link && n.CreatedAt >= cutoff, ct);
        if (duplicate)
        {
            _logger.LogDebug("Bỏ qua thông báo trùng {Type} cho {Wallet} ({Link})", type, wallet, link);
            return;
        }

        db.Notifications.Add(new Notification
        {
            WalletAddress = wallet,
            Type = type,
            Title = title,
            Body = body,
            Link = link,
            IsRead = false,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync(ct);

        var recipient = await db.FarmerProfiles.AsNoTracking()
            .Where(p => p.WalletAddress == wallet)
            .Select(p => new Recipient(p.Email, p.NotifyEmail, p.NotifyTelegram, p.TelegramChatId))
            .FirstOrDefaultAsync(ct);
        if (recipient == null) return;

        var fullLink = BuildLink(link);

        // Fan-out ở nền: không dùng ct của request (request kết thúc thì ct bị huỷ).
        _ = Task.Run(() => FanOutAsync(wallet, recipient, title, body, fullLink));
    }

    private async Task FanOutAsync(string wallet, Recipient recipient, string title, string body, string? link)
    {
        if (recipient.NotifyTelegram && recipient.TelegramChatId != null)
        {
            try
            {
                await SendTelegramAsync(recipient.TelegramChatId.Value, title, body, link);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Gửi Telegram cho {Wallet} thất bại", wallet);
            }
        }

        if (recipient.NotifyEmail && !string.IsNullOrWhiteSpace(recipient.Email))
        {
            try
            {
                await SendEmailAsync(recipient.Email!, title, body, link);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Gửi email cho {Wallet} thất bại", wallet);
            }
        }
    }

    private async Task SendTelegramAsync(long chatId, string title, string body, string? link)
    {
        if (!_telegram.IsConfigured)
        {
            if (Interlocked.Exchange(ref _loggedNoTelegram, 1) == 0)
                _logger.LogInformation("Chưa cấu hình Telegram:BotToken: bỏ qua kênh Telegram.");
            return;
        }

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var html = $"<b>{Encode(title)}</b>\n{Encode(body)}";
        if (link != null) html += $"\n<a href=\"{Encode(link)}\">Xem chi tiết</a>";

        try
        {
            await _telegram.SendMessageAsync(chatId, html, cts.Token);
        }
        catch (HttpRequestException) when (link != null)
        {
            // Telegram có thể từ chối liên kết kiểu localhost: gửi lại dạng văn bản thường.
            var plain = $"<b>{Encode(title)}</b>\n{Encode(body)}\n{Encode(link)}";
            await _telegram.SendMessageAsync(chatId, plain, cts.Token);
        }
    }

    private async Task SendEmailAsync(string to, string title, string body, string? link)
    {
        if (!_email.IsConfigured)
        {
            if (Interlocked.Exchange(ref _loggedNoSmtp, 1) == 0)
                _logger.LogInformation("Chưa cấu hình Smtp:Host / Smtp:From: bỏ qua kênh email.");
            return;
        }

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(45));
        var text = link == null ? $"{title}\n\n{body}" : $"{title}\n\n{body}\n\nXem chi tiết: {link}";
        await _email.SendAsync(to, $"[Bảo hiểm thời tiết] {title}", BuildEmailHtml(title, body, link), text, cts.Token);
    }

    /// <summary>Link tương đối ("/tickets/5") được ghép với App:PublicUrl; link tuyệt đối giữ nguyên.</summary>
    private string? BuildLink(string? link)
    {
        if (string.IsNullOrWhiteSpace(link)) return null;
        if (link.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || link.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return link;

        return _app.PublicUrl.TrimEnd('/') + (link.StartsWith('/') ? link : "/" + link);
    }

    private static string BuildEmailHtml(string title, string body, string? link)
    {
        var button = link == null
            ? ""
            : $"<p style=\"margin:24px 0\"><a href=\"{Encode(link)}\" style=\"background:#15803d;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block\">Xem chi tiết</a></p>";

        return "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2937\">"
               + $"<h2 style=\"color:#15803d;margin-bottom:8px\">{Encode(title)}</h2>"
               + $"<p style=\"line-height:1.6\">{Encode(body).Replace("\n", "<br>")}</p>"
               + button
               + "<hr style=\"border:none;border-top:1px solid #e5e7eb;margin:24px 0\">"
               + "<p style=\"font-size:12px;color:#6b7280\">Bảo hiểm thời tiết — hệ thống thử nghiệm trên mạng Sepolia. "
               + "Bạn nhận email này vì đã bật thông báo email trong Hồ sơ.</p>"
               + "</div>";
    }

    private static string Encode(string value) => WebUtility.HtmlEncode(value) ?? "";
}
