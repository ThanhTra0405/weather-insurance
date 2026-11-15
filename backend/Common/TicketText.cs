namespace backend.Common;

/// <summary>Nhãn tiếng Việt và tập giá trị hợp lệ của ticket (dùng cho tin nhắn hệ thống và thông báo).</summary>
public static class TicketText
{
    public static readonly string[] Categories = { "review_rejected", "payout_missing", "policy_info", "technical", "other" };
    public static readonly string[] Statuses = { "open", "in_progress", "waiting_customer", "resolved", "closed" };
    public static readonly string[] Priorities = { "low", "normal", "high" };

    /// <summary>Trạng thái được tính là "đang mở" (giới hạn 10 ticket / ví, đếm hàng đợi).</summary>
    public static readonly string[] OpenStatuses = { "open", "in_progress", "waiting_customer" };

    public static string Status(string status) => status switch
    {
        "open" => "Mới",
        "in_progress" => "Đang xử lý",
        "waiting_customer" => "Chờ khách hàng",
        "resolved" => "Đã giải quyết",
        "closed" => "Đã đóng",
        _ => status,
    };

    public static string Priority(string priority) => priority switch
    {
        "low" => "Thấp",
        "normal" => "Bình thường",
        "high" => "Cao",
        _ => priority,
    };

    public static string Preview(string? body, int max = 120)
    {
        var text = (body ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
        return text.Length <= max ? text : text[..max].TrimEnd() + "…";
    }
}
