namespace backend.Data.Entities;

/// <summary>Mẫu trả lời nhanh của CSKH.</summary>
public class CannedReply
{
    public long Id { get; set; }
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public Guid? CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
