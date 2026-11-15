namespace backend.Services.App;

/// <summary>Gửi email qua SMTP (MailKit). Chưa cấu hình Smtp:Host và Smtp:From thì IsConfigured = false.</summary>
public interface IEmailSender
{
    bool IsConfigured { get; }

    Task SendAsync(string to, string subject, string htmlBody, string textBody, CancellationToken ct = default);
}
