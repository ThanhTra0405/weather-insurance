using backend.Models;

namespace backend.Services.interfaces
{
    public interface IWeatherService
    {
        Task<WeatherPoint> GetRainfallLast30DaysAsync(decimal lat, decimal lng, CancellationToken ct = default);
    }
}