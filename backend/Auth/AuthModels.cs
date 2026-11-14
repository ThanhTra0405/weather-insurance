namespace backend.Auth;

// Mọi field khai báo nullable để thiếu field không bị ASP.NET tự trả 400 sai định dạng;
// việc kiểm tra do controller/ProfileValidator làm và trả lỗi theo chuẩn { error, code, fields }.

public record RegisterRequest(string? Address, string? Signature, ProfileInput? Profile);

public record LoginRequest(string? Address, string? Signature);

public record StaffLoginRequest(string? Email, string? Password);

public record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);

/// <summary>Dữ liệu hồ sơ nông dân do client gửi (đăng ký và cập nhật).</summary>
public record ProfileInput(
    string? FullName,
    string? Phone,
    string? Email,
    string? Province,
    string? District,
    string? Commune,
    string? CropType,
    decimal? FarmAreaHa,
    decimal? FarmLat,
    decimal? FarmLng,
    bool? NotifyEmail,
    bool? NotifyTelegram);

/// <summary>Hồ sơ trả về cho client.</summary>
public record ProfileDto(
    bool HasProfile,
    string FullName,
    string Phone,
    string? Email,
    string Province,
    string District,
    string? Commune,
    string CropType,
    decimal FarmAreaHa,
    decimal? FarmLat,
    decimal? FarmLng,
    bool NotifyEmail,
    bool NotifyTelegram,
    bool TelegramLinked,
    bool IsComplete);
