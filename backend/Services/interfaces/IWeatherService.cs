using backend.Models;

namespace backend.Services.interfaces
{
    public interface IWeatherService
    {
        Task<WeatherSnapshot> GetWeatherAsync(decimal lat, decimal lng, CancellationToken ct = default);
    }
}
