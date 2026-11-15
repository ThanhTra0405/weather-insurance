namespace backend.Common;

/// <summary>Dựng mẫu cho EF.Functions.ILike từ chuỗi người dùng nhập (escape %, _ và \).</summary>
public static class SqlLike
{
    public static string Contains(string input) => "%" + Escape(input.Trim()) + "%";

    public static string StartsWith(string input) => Escape(input.Trim()) + "%";

    private static string Escape(string s) =>
        s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
}
