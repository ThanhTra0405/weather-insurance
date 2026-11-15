using System.Text;
using System.Threading.RateLimiting;
using backend.Common;
using backend.Data;
using backend.Options;
using backend.Repository;
using backend.Services;
using backend.Services.App;
using backend.Services.Chain;
using backend.Services.interfaces;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .ConfigureApiBehaviorOptions(options =>
    {
        // Body sai định dạng JSON: trả lỗi theo chuẩn { error, code } thay vì ProblemDetails mặc định.
        options.InvalidModelStateResponseFactory = _ =>
            ApiResults.Error(StatusCodes.Status400BadRequest, "Dữ liệu gửi lên không hợp lệ", "VALIDATION");
    });

// ===== B: cơ sở dữ liệu, JWT, audit, thông báo, DatabaseInitializer =====
// Đặt TRƯỚC khối chain của A để DatabaseInitializer (migrate + seed) chạy xong trước các hosted service của A.
builder.Services.AddAppServices(builder.Configuration);

// ===== CHAIN (A): IChainContext, indexer, oracle, faucet, admin client =====
builder.Services.AddChainServices(builder.Configuration);

// ===== JWT =====
var jwt = builder.Configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>() ?? new JwtOptions();
if (string.IsNullOrEmpty(jwt.Secret) || jwt.Secret.Length < 32)
{
    throw new InvalidOperationException(
        "Jwt:Secret phải có ít nhất 32 ký tự. Đặt bằng: dotnet user-secrets set \"Jwt:Secret\" \"<chuỗi ngẫu nhiên>\"");
}

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false; // giữ nguyên tên claim: sub, role, wallet, name
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Secret)),
            ValidAlgorithms = new[] { SecurityAlgorithms.HmacSha256 },
            ClockSkew = TimeSpan.FromMinutes(1),
            RoleClaimType = "role",
            NameClaimType = "name",
        };
    });
builder.Services.AddAuthorization();

// ===== CORS =====
var corsOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>();
if (corsOrigins == null || corsOrigins.Length == 0)
    corsOrigins = new[] { "http://localhost:4200" };


builder.Services.AddCors(options =>
{
    options.AddPolicy("App", policy =>
        policy.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod());
});

// ===== Giới hạn tần suất (theo IP) =====
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        await context.HttpContext.Response.WriteAsJsonAsync(
            new { error = "Thao tác quá nhanh, vui lòng thử lại sau", code = "RATE_LIMITED" }, token);
    };

    options.AddPolicy("auth", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));

    options.AddPolicy("evidence", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 30,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));
});

// ===== Chạy sau reverse proxy (TLS do host xử lý) =====
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

var app = builder.Build();

app.UseForwardedHeaders();

app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
{
    var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("LoiMayChu");
    var feature = context.Features.Get<IExceptionHandlerFeature>();
    if (feature != null)
        logger.LogError(feature.Error, "Lỗi không xử lý được tại {Path}", feature.Path);

    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    context.Response.ContentType = "application/json";
    await context.Response.WriteAsJsonAsync(new { error = "Lỗi máy chủ" });
}));

app.UseCors("App");

// Production: TLS do host xử lý nên không redirect HTTPS.
if (app.Environment.IsDevelopment())
    app.UseHttpsRedirection();

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();
