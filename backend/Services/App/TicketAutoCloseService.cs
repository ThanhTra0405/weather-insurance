using backend.Data;
using backend.Data.Entities;
using backend.Services.interfaces;
using Microsoft.EntityFrameworkCore;

namespace backend.Services.App;

/// <summary>
/// Chạy mỗi giờ: ticket "resolved" không có hoạt động quá 72 giờ thì chuyển "closed" (SPEC-B mục 6.1).
/// "Hoạt động" = lần cập nhật cuối (updated_at): tin nhắn, đổi trạng thái/ưu tiên/người xử lý.
/// </summary>
public class TicketAutoCloseService : BackgroundService
{
    private const int BatchSize = 200;
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);
    private static readonly TimeSpan IdleLimit = TimeSpan.FromHours(72);

    private readonly IDbContextFactory<AppDbContext> _dbFactory;
    private readonly INotificationService _notifier;
    private readonly ILogger<TicketAutoCloseService> _logger;

    public TicketAutoCloseService(IDbContextFactory<AppDbContext> dbFactory, INotificationService notifier,
        ILogger<TicketAutoCloseService> logger)
    {
        _dbFactory = dbFactory;
        _notifier = notifier;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            // Đợi hệ thống khởi động xong rồi chạy lần đầu, sau đó mỗi giờ một lần.
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);

            using var timer = new PeriodicTimer(Interval);
            do
            {
                try
                {
                    await CloseIdleTicketsAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Lỗi khi tự đóng ticket quá hạn");
                }
            } while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            // đang tắt backend
        }
    }

    private async Task CloseIdleTicketsAsync(CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var cutoff = now - IdleLimit;
        var totalClosed = 0;

        await using var db = await _dbFactory.CreateDbContextAsync(ct);

        while (true)
        {
            var batch = await db.Tickets.AsNoTracking()
                .Where(t => t.Status == "resolved" && t.UpdatedAt < cutoff)
                .OrderBy(t => t.UpdatedAt)
                .Select(t => new { t.Id, t.WalletAddress, t.Subject })
                .Take(BatchSize)
                .ToListAsync(ct);
            if (batch.Count == 0) break;

            var closedInBatch = 0;
            foreach (var item in batch)
            {
                // Điều kiện nằm trong câu UPDATE: nếu nông dân vừa trả lời thì ticket không bị đóng nhầm.
                var affected = await db.Tickets
                    .Where(t => t.Id == item.Id && t.Status == "resolved" && t.UpdatedAt < cutoff)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(t => t.Status, "closed")
                        .SetProperty(t => t.ClosedAt, (DateTimeOffset?)now)
                        .SetProperty(t => t.UpdatedAt, now), ct);
                if (affected == 0) continue;

                closedInBatch++;
                db.TicketMessages.Add(new TicketMessage
                {
                    TicketId = item.Id,
                    SenderType = "system",
                    SenderRef = null,
                    Body = "Ticket tự động đóng sau 72 giờ không có phản hồi",
                    IsInternal = false,
                    CreatedAt = now,
                });
                await db.SaveChangesAsync(ct);

                try
                {
                    await _notifier.NotifyAsync(item.WalletAddress, "ticket_status",
                        "Yêu cầu hỗ trợ đã được tự động đóng",
                        $"Yêu cầu #{item.Id} \"{item.Subject}\" đã tự động đóng sau 72 giờ kể từ khi được giải quyết. Nếu cần, bạn có thể tạo yêu cầu mới.",
                        $"/tickets/{item.Id}", ct);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Không gửi được thông báo tự đóng ticket {TicketId}", item.Id);
                }
            }

            totalClosed += closedInBatch;
            if (batch.Count < BatchSize || closedInBatch == 0) break;
        }

        if (totalClosed > 0) _logger.LogInformation("Đã tự đóng {Count} ticket quá 72 giờ không hoạt động", totalClosed);
    }
}
