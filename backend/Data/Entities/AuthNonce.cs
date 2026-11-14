namespace backend.Data.Entities;

/// <summary>Nonce dùng một lần cho đăng nhập bằng chữ ký ví.</summary>
public class AuthNonce
{
    public string WalletAddress { get; set; } = "";
    public string Nonce { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
}
