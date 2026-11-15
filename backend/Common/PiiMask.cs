namespace backend.Common;

/// <summary>Che email / số điện thoại khi hiển thị cho CSKH (SPEC-B mục 6.3). Admin thấy đầy đủ.</summary>
public static class PiiMask
{
    /// <summary>"abc@gmail.com" → "a***@gmail.com".</summary>
    public static string? Email(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return email;

        var at = email.IndexOf('@');
        if (at <= 0) return "***";
        return email[0] + "***" + email[at..];
    }

    /// <summary>"0912345678" → "09** *** 678"; "+84912345678" → "+84** *** 678".</summary>
    public static string? Phone(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return phone;

        var p = phone.Replace(" ", "");
        if (p.Length < 6) return "***";

        var prefix = p.StartsWith("+84", StringComparison.Ordinal) ? "+84" : p[..2];
        return $"{prefix}** *** {p[^3..]}";
    }
}
