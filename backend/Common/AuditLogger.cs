using System.Text.Json;
using backend.Data;
using backend.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace backend.Common;

/// <summary>
/// Cài đặt IAuditLog. Đặt tên AuditLogger (không phải AuditLog) để không trùng entity backend.Data.Entities.AuditLog.
/// Dùng IDbContextFactory nên an toàn khi gọi từ service singleton.
/// </summary>
public class AuditLogger : IAuditLog
{
    private readonly IDbContextFactory<AppDbContext> _dbFactory;
    private readonly ILogger<AuditLogger> _logger;

    public AuditLogger(IDbContextFactory<AppDbContext> dbFactory, ILogger<AuditLogger> logger)
    {
        _dbFactory = dbFactory;
        _logger = logger;
    }

    public async Task WriteAsync(string actorType, string? actorRef, string action, string? target = null,
        object? detail = null, CancellationToken ct = default)
    {
        try
        {
            using var detailDoc = detail == null ? null : JsonSerializer.SerializeToDocument(detail);

            await using var db = await _dbFactory.CreateDbContextAsync(ct);
            db.AuditLogs.Add(new AuditLog
            {
                ActorType = actorType,
                ActorRef = actorRef,
                Action = action,
                Target = target,
                Detail = detailDoc,
            });
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Không ghi được audit log {Action} ({ActorType}/{ActorRef})", action, actorType, actorRef);
        }
    }
}
