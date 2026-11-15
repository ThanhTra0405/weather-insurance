namespace backend.Options;

/// <summary>Cấu hình bot Telegram (khoá Telegram:*). Để trống BotToken thì tắt tính năng.</summary>
public class TelegramOptions
{
    public const string SectionName = "Telegram";

    public string BotToken { get; set; } = "";
    public string BotUsername { get; set; } = "";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(BotToken);
}
