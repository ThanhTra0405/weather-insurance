namespace backend.Options;

/// <summary>Cấu hình chung của ứng dụng (khoá App:*).</summary>
public class AppOptions
{
    public const string SectionName = "App";

    /// <summary>URL frontend, dùng để dựng liên kết trong thông báo.</summary>
    public string PublicUrl { get; set; } = "http://localhost:4200";

    /// <summary>Tiền tố link xem giao dịch trên block explorer.</summary>
    public string ExplorerTxBase { get; set; } = "https://sepolia.etherscan.io/tx/";
}
