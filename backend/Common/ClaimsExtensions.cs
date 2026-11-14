using System.Security.Claims;

namespace backend.Common;

/// <summary>Đọc claim từ JWT của ứng dụng: sub, role, wallet, name.</summary>
public static class ClaimsExtensions
{
    /// <summary>Ví (viết thường) của nông dân; null nếu không phải nông dân.</summary>
    public static string? GetWallet(this ClaimsPrincipal user) =>
        user.FindFirst("wallet")?.Value;

    /// <summary>"farmer" | "admin" | "support".</summary>
    public static string? GetRole(this ClaimsPrincipal user) =>
        user.FindFirst("role")?.Value ?? user.FindFirst(ClaimTypes.Role)?.Value;

    /// <summary>Id nhân viên (claim sub); null nếu không phải nhân viên hoặc không phải GUID.</summary>
    public static Guid? GetStaffId(this ClaimsPrincipal user)
    {
        var role = user.GetRole();
        if (role != "admin" && role != "support") return null;

        var sub = user.FindFirst("sub")?.Value ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }
}
