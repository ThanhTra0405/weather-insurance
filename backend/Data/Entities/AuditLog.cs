using System.Text.Json;

namespace backend.Data.Entities;

/// <summary>Nhật ký kiểm toán hành động quan trọng.</summary>
public class AuditLog
{
    public long Id { get; set; }

    /// <summary>staff | farmer | system</summary>
    public string ActorType { get; set; } = "";
    public string? ActorRef { get; set; }
    public string Action { get; set; } = "";
    public string? Target { get; set; }
    public JsonDocument? Detail { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
