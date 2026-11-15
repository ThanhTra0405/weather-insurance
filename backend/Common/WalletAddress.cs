using System.Text.RegularExpressions;

namespace backend.Common;

/// <summary>Chuẩn hoá địa chỉ ví: mọi chỗ đọc/ghi/so sánh ví đều đi qua đây (lưu dạng viết thường).</summary>
public static class WalletAddress
{
    private static readonly Regex Pattern = new("^0x[0-9a-fA-F]{40}$", RegexOptions.Compiled);

    /// <summary>Trim, kiểm tra "0x" + 40 ký tự hex, trả về dạng viết thường. Sai định dạng thì ném ArgumentException.</summary>
    public static string Normalize(string? address)
    {
        if (!TryNormalize(address, out var normalized))
            throw new ArgumentException("Địa chỉ ví không hợp lệ", nameof(address));
        return normalized;
    }

    public static bool TryNormalize(string? address, out string normalized)
    {
        var value = address?.Trim() ?? "";
        if (!Pattern.IsMatch(value))
        {
            normalized = "";
            return false;
        }

        normalized = value.ToLowerInvariant();
        return true;
    }
}
