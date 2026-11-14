namespace backend.Data.Entities;

/// <summary>Hồ sơ nông dân (khoá chính là địa chỉ ví viết thường).</summary>
public class FarmerProfile
{
    public string WalletAddress { get; set; } = "";
    public string FullName { get; set; } = "";
    public string Phone { get; set; } = "";
    public string? Email { get; set; }
    public string Province { get; set; } = "";
    public string District { get; set; } = "";
    public string? Commune { get; set; }
    public string CropType { get; set; } = "";
    public decimal FarmAreaHa { get; set; }
    public decimal? FarmLat { get; set; }
    public decimal? FarmLng { get; set; }
    public bool NotifyEmail { get; set; } = true;
    public bool NotifyTelegram { get; set; }
    public long? TelegramChatId { get; set; }
    public string? TelegramLinkCode { get; set; }
    public DateTimeOffset? TelegramLinkExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
