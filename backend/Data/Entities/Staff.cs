namespace backend.Data.Entities;

/// <summary>Nhân viên (admin hoặc CSKH), đăng nhập bằng email + mật khẩu.</summary>
public class Staff
{
    public Guid Id { get; set; }
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string FullName { get; set; } = "";

    /// <summary>"admin" hoặc "support".</summary>
    public string Role { get; set; } = "support";
    public bool Active { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
}
