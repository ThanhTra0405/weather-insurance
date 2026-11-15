namespace backend.Common;

/// <summary>Ghi nhật ký kiểm toán (bảng audit_logs). Lỗi ghi log không làm hỏng luồng chính.</summary>
public interface IAuditLog
{
    /// <param name="actorType">staff | farmer | system</param>
    /// <param name="actorRef">id nhân viên hoặc địa chỉ ví</param>
    /// <param name="detail">đối tượng bất kỳ, được lưu dưới dạng jsonb</param>
    Task WriteAsync(string actorType, string? actorRef, string action, string? target = null,
        object? detail = null, CancellationToken ct = default);
}
