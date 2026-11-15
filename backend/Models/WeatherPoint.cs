namespace backend.Models
{
    public record WeatherPoint(decimal Value, long Timestamp);

    public record WeatherSnapshot(decimal? Rain30dMm, decimal? Rain3dMm, decimal? WindGustMax3dKmh, long Timestamp);
}


