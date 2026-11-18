namespace backend.Models
{
    public record WeatherPoint(decimal Value, long Timestamp);

    /// <summary>Lượng mưa / gió giật của MỘT ngày lịch (giờ VN, UTC+7). null = nguồn không có dữ liệu ngày đó.</summary>
    public record DailyWeather(DateOnly Date, decimal? RainMm, decimal? WindGustMaxKmh);
}
