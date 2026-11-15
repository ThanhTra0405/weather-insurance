namespace backend.Options;

/// <summary>Cấu hình cơ sở dữ liệu (khoá Database:*).</summary>
public class DatabaseOptions
{
    public const string SectionName = "Database";

    /// <summary>true: backend tự áp dụng migration khi khởi động.</summary>
    public bool AutoMigrate { get; set; } = true;
}
