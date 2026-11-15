using System.Text.RegularExpressions;
using backend.Data.Entities;

namespace backend.Auth;

/// <summary>Kiểm tra và áp dụng dữ liệu hồ sơ nông dân. Dùng chung cho đăng ký và PUT /api/profile/me.</summary>
public static class ProfileValidator
{
    // Bounding box lấy đúng hằng số trong PolicyManager.sol (đã ×1e6):
    // MIN_LAT = 8_180_000, MAX_LAT = 23_400_000, MIN_LNG = 102_140_000, MAX_LNG = 109_470_000.
    public const decimal MinLat = 8.18m;
    public const decimal MaxLat = 23.4m;
    public const decimal MinLng = 102.14m;
    public const decimal MaxLng = 109.47m;

    private static readonly Regex PhoneRegex = new(@"^(0|\+84)\d{9,10}$", RegexOptions.Compiled);
    private static readonly Regex EmailRegex = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled);

    /// <summary>Trả về lỗi theo từng field (khoá camelCase khớp tên field JSON). Rỗng nghĩa là hợp lệ.</summary>
    public static Dictionary<string, string> Validate(ProfileInput? input)
    {
        var errors = new Dictionary<string, string>();
        if (input == null)
        {
            errors["profile"] = "Thiếu thông tin hồ sơ";
            return errors;
        }

        var fullName = input.FullName?.Trim() ?? "";
        if (fullName.Length < 2 || fullName.Length > 100)
            errors["fullName"] = "Họ tên phải từ 2 đến 100 ký tự";

        var phone = input.Phone?.Trim() ?? "";
        if (!PhoneRegex.IsMatch(phone))
            errors["phone"] = "Số điện thoại không hợp lệ";

        var email = input.Email?.Trim();
        if (!string.IsNullOrEmpty(email) && (email.Length > 254 || !EmailRegex.IsMatch(email)))
            errors["email"] = "Email không hợp lệ";

        var province = input.Province?.Trim() ?? "";
        if (province.Length == 0) errors["province"] = "Vui lòng nhập tỉnh/thành phố";
        else if (province.Length > 100) errors["province"] = "Tỉnh/thành phố tối đa 100 ký tự";

        var district = input.District?.Trim() ?? "";
        if (district.Length == 0) errors["district"] = "Vui lòng nhập quận/huyện";
        else if (district.Length > 100) errors["district"] = "Quận/huyện tối đa 100 ký tự";

        if ((input.Commune?.Trim().Length ?? 0) > 100)
            errors["commune"] = "Phường/xã tối đa 100 ký tự";

        var cropType = input.CropType?.Trim() ?? "";
        if (cropType.Length == 0) errors["cropType"] = "Vui lòng nhập loại cây trồng";
        else if (cropType.Length > 50) errors["cropType"] = "Loại cây trồng tối đa 50 ký tự";

        if (input.FarmAreaHa is not { } area)
        {
            errors["farmAreaHa"] = "Vui lòng nhập diện tích";
        }
        else
        {
            // Cột numeric(10,2): so sánh sau khi làm tròn 2 chữ số để không vi phạm check > 0.
            var rounded = Math.Round(area, 2);
            if (rounded < 0.01m || rounded > 10000m)
                errors["farmAreaHa"] = "Diện tích phải từ 0,01 đến 10000 ha";
        }

        if (input.FarmLat is { } lat && (lat < MinLat || lat > MaxLat))
            errors["farmLat"] = $"Vĩ độ phải nằm trong khoảng {MinLat} đến {MaxLat}";

        if (input.FarmLng is { } lng && (lng < MinLng || lng > MaxLng))
            errors["farmLng"] = $"Kinh độ phải nằm trong khoảng {MinLng} đến {MaxLng}";

        return errors;
    }

    /// <summary>
    /// Ghi dữ liệu (đã qua Validate) vào entity. Thay toàn bộ hồ sơ: lat/lng/email/commune bỏ trống thì xoá.
    /// Giá trị notify* không gửi lên thì giữ nguyên; bật Telegram chỉ có hiệu lực khi đã liên kết.
    /// </summary>
    public static void Apply(FarmerProfile target, ProfileInput input)
    {
        target.FullName = input.FullName!.Trim();
        target.Phone = input.Phone!.Trim();
        target.Email = Clean(input.Email);
        target.Province = input.Province!.Trim();
        target.District = input.District!.Trim();
        target.Commune = Clean(input.Commune);
        target.CropType = input.CropType!.Trim();
        target.FarmAreaHa = Math.Round(input.FarmAreaHa!.Value, 2);
        target.FarmLat = input.FarmLat.HasValue ? Math.Round(input.FarmLat.Value, 6) : null;
        target.FarmLng = input.FarmLng.HasValue ? Math.Round(input.FarmLng.Value, 6) : null;
        target.NotifyEmail = input.NotifyEmail ?? target.NotifyEmail;
        target.NotifyTelegram = (input.NotifyTelegram ?? target.NotifyTelegram) && target.TelegramChatId != null;
    }

    public static bool IsComplete(FarmerProfile p) =>
        !string.IsNullOrWhiteSpace(p.FullName)
        && !string.IsNullOrWhiteSpace(p.Phone)
        && !string.IsNullOrWhiteSpace(p.Province)
        && !string.IsNullOrWhiteSpace(p.District)
        && !string.IsNullOrWhiteSpace(p.CropType)
        && p.FarmAreaHa > 0;

    public static ProfileDto ToDto(FarmerProfile p) => new(
        HasProfile: true,
        FullName: p.FullName,
        Phone: p.Phone,
        Email: p.Email,
        Province: p.Province,
        District: p.District,
        Commune: p.Commune,
        CropType: p.CropType,
        FarmAreaHa: p.FarmAreaHa,
        FarmLat: p.FarmLat,
        FarmLng: p.FarmLng,
        NotifyEmail: p.NotifyEmail,
        NotifyTelegram: p.NotifyTelegram,
        TelegramLinked: p.TelegramChatId != null,
        IsComplete: IsComplete(p));

    private static string? Clean(string? value)
    {
        var v = value?.Trim();
        return string.IsNullOrEmpty(v) ? null : v;
    }
}
