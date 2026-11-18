using System.Numerics;

namespace backend.Services.interfaces
{
    public record OracleDayRecord(long DayStart, bool Exists, BigInteger ValueScaled);

    public interface IOracleSubmitter
    {
        /// <summary>
        /// Gửi giá trị của MỘT ngày (valueScaled = x100). dayStart = 00:00 UTC+7 của ngày đó (xem OracleDay).
        /// Contract revert nếu ngày đã có dữ liệu hoặc chưa kết thúc.
        /// </summary>
        Task<string> SubmitWeatherDataAsync(string regionId, byte perilType, BigInteger valueScaled, long dayStart, CancellationToken ct = default);

        /// <summary>Gửi nhiều ngày trong 1 tx (tối đa 40). Tất cả hoặc không ngày nào.</summary>
        Task<string> SubmitDailyBatchAsync(string regionId, byte perilType, IReadOnlyList<(long DayStart, BigInteger ValueScaled)> days, CancellationToken ct = default);

        /// <summary>Đọc lịch sử on-chain của dayCount ngày liên tiếp (để phát hiện ngày thiếu / tránh gửi trùng).</summary>
        Task<IReadOnlyList<OracleDayRecord>> GetDailyRangeAsync(string regionId, byte perilType, long fromDayStart, int dayCount, CancellationToken ct = default);
    }
}
