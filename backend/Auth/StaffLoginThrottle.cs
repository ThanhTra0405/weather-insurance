using System.Collections.Concurrent;

namespace backend.Auth;

/// <summary>
/// Giới hạn đăng nhập nhân viên sai: tối đa 5 lần / 15 phút theo (email + IP), lưu trong bộ nhớ.
/// Khởi động lại backend thì bộ đếm được reset (chấp nhận được cho phạm vi đồ án).
/// </summary>
public class StaffLoginThrottle
{
    private const int MaxFailures = 5;
    private const int SweepThreshold = 10_000;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    private readonly ConcurrentDictionary<string, Queue<DateTimeOffset>> _failures = new();

    public bool IsBlocked(string key)
    {
        if (!_failures.TryGetValue(key, out var queue)) return false;
        lock (queue)
        {
            Prune(queue);
            return queue.Count >= MaxFailures;
        }
    }

    public void RecordFailure(string key)
    {
        if (_failures.Count > SweepThreshold) Sweep();

        var queue = _failures.GetOrAdd(key, _ => new Queue<DateTimeOffset>());
        lock (queue)
        {
            Prune(queue);
            queue.Enqueue(DateTimeOffset.UtcNow);
        }
    }

    public void Reset(string key) => _failures.TryRemove(key, out _);

    private static void Prune(Queue<DateTimeOffset> queue)
    {
        var cutoff = DateTimeOffset.UtcNow - Window;
        while (queue.Count > 0 && queue.Peek() < cutoff) queue.Dequeue();
    }

    private void Sweep()
    {
        foreach (var (key, queue) in _failures)
        {
            bool empty;
            lock (queue)
            {
                Prune(queue);
                empty = queue.Count == 0;
            }
            if (empty) _failures.TryRemove(key, out _);
        }
    }
}
