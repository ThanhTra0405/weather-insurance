namespace backend.Data.Entities;

/// <summary>Thông báo trong ứng dụng của nông dân.</summary>
public class Notification
{
    public long Id { get; set; }
    public string WalletAddress { get; set; } = "";
    public string Type { get; set; } = "";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string? Link { get; set; }
    public bool IsRead { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
