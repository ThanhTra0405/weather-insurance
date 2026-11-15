namespace backend.Options;

/// <summary>Tài khoản mặc định tạo lần đầu cho bảng staff (khoá Seed:*).</summary>
public class SeedOptions
{
    public const string SectionName = "Seed";

    public SeedAccount Admin { get; set; } = new();
    public SeedAccount Support { get; set; } = new();
}

public class SeedAccount
{
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(Email) && !string.IsNullOrWhiteSpace(Password);
}
