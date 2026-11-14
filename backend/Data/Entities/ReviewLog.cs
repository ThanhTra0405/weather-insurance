namespace backend.Data.Entities;

/// <summary>Nhật ký duyệt/từ chối hồ sơ (lý do được ghi trước khi gửi tx).</summary>
public class ReviewLog
{
    public long Id { get; set; }
    public long PolicyId { get; set; }
    public Guid? StaffId { get; set; }
    public bool Approved { get; set; }
    public string? Note { get; set; }
    public string? TxHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
