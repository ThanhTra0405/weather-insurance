namespace backend.Data.Entities;

/// <summary>Tin nhắn trong phiếu hỗ trợ.</summary>
public class TicketMessage
{
    public long Id { get; set; }
    public long TicketId { get; set; }

    /// <summary>farmer | staff | system</summary>
    public string SenderType { get; set; } = "farmer";

    /// <summary>Địa chỉ ví hoặc id nhân viên.</summary>
    public string? SenderRef { get; set; }
    public string Body { get; set; } = "";

    /// <summary>true: ghi chú nội bộ CSKH, nông dân không thấy.</summary>
    public bool IsInternal { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Ticket? Ticket { get; set; }
}
