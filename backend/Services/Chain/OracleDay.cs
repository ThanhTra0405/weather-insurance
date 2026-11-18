using System.Numerics;

namespace backend.Services.Chain;

/// <summary>
/// Quy ước ngày DUY NHẤT, khớp library DayTime.sol:
///   dayId = (timestamp + 7h) / 86400,  dayStart = dayId * 86400 - 7h  (00:00 giờ VN).
/// Backend luôn gửi dayStart cho Oracle; không bao giờ gửi "thời điểm hiện tại".
/// </summary>
public static class OracleDay
{
    public const int OffsetSeconds = 7 * 3600;
    public const long SecondsPerDay = 86_400;
    private static readonly int EpochDayNumber = new DateOnly(1970, 1, 1).DayNumber;

    public static long DayId(DateOnly d) => d.DayNumber - EpochDayNumber;

    public static long DayStart(DateOnly d) => DayId(d) * SecondsPerDay - OffsetSeconds;

    public static DateOnly FromDayStart(long dayStart)
    {
        if ((dayStart + OffsetSeconds) % SecondsPerDay != 0)
            throw new ArgumentException("dayStart khong phai 00:00 UTC+7");
        return DateOnly.FromDayNumber((int)((dayStart + OffsetSeconds) / SecondsPerDay) + EpochDayNumber);
    }

    public static DateOnly TodayLocal(DateTimeOffset nowUtc) =>
        DateOnly.FromDateTime(nowUtc.ToOffset(TimeSpan.FromSeconds(OffsetSeconds)).DateTime);

    /// <summary>Ngày đầu tiên nằm TRỌN trong bảo hiểm (làm tròn lên từ startTime).</summary>
    public static DateOnly FirstCoveredDay(long startTime) =>
        DateOnly.FromDayNumber((int)((startTime + OffsetSeconds + SecondsPerDay - 1) / SecondsPerDay) + EpochDayNumber);

    /// <summary>Ngày cuối cùng kết thúc không muộn hơn endTime.</summary>
    public static DateOnly LastCoveredDay(long endTime) =>
        DateOnly.FromDayNumber((int)((endTime + OffsetSeconds) / SecondsPerDay) - 1 + EpochDayNumber);

    /// <summary>Số nguyên x100 (mm x100, km/h x100), làm tròn; KHÔNG dùng new BigInteger(decimal) vì cắt phần thập phân.</summary>
    public static BigInteger Scale(decimal v) =>
        (BigInteger)Math.Round(v * 100m, 0, MidpointRounding.AwayFromZero);
}
