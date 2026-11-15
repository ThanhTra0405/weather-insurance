using System.Text;
using backend.Options;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace backend.Auth;

public record JwtResult(string Token, DateTimeOffset ExpiresAt);

/// <summary>Tạo JWT HS256 với các claim: sub, role, wallet (nông dân), name.</summary>
public class JwtService
{
    private readonly JwtOptions _options;
    private readonly SigningCredentials _credentials;
    private readonly JsonWebTokenHandler _handler = new();

    public JwtService(IOptions<JwtOptions> options)
    {
        _options = options.Value;
        if (string.IsNullOrEmpty(_options.Secret) || _options.Secret.Length < 32)
            throw new InvalidOperationException("Jwt:Secret phải có ít nhất 32 ký tự (đặt bằng dotnet user-secrets).");

        _credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.Secret)),
            SecurityAlgorithms.HmacSha256);
    }

    /// <param name="subject">ví viết thường (nông dân) hoặc id nhân viên</param>
    /// <param name="role">farmer | admin | support</param>
    public JwtResult CreateToken(string subject, string role, string? wallet, string? name)
    {
        var now = DateTimeOffset.UtcNow;
        var expiresAt = now.AddMinutes(_options.ExpiryMinutes);

        var claims = new Dictionary<string, object>
        {
            ["sub"] = subject,
            ["role"] = role,
        };
        if (!string.IsNullOrEmpty(wallet)) claims["wallet"] = wallet;
        if (!string.IsNullOrEmpty(name)) claims["name"] = name;

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = _options.Issuer,
            Audience = _options.Audience,
            Claims = claims,
            NotBefore = now.UtcDateTime,
            Expires = expiresAt.UtcDateTime,
            SigningCredentials = _credentials,
        };

        return new JwtResult(_handler.CreateToken(descriptor), expiresAt);
    }
}
