namespace backend.Options;

/// <summary>Cấu hình JWT (khoá Jwt:*). Secret phải đặt bằng user-secrets, tối thiểu 32 ký tự.</summary>
public class JwtOptions
{
    public const string SectionName = "Jwt";

    public string Secret { get; set; } = "";
    public string Issuer { get; set; } = "weather-insurance";
    public string Audience { get; set; } = "weather-insurance-app";
    public int ExpiryMinutes { get; set; } = 720;
}
