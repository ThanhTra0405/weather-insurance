using System.Text.Json;
using backend.Models;
using backend.Services.interfaces;

namespace backend.Services
{
    public class WeatherService : IWeatherService
    {
        private readonly HttpClient _http;
        private readonly ILogger<WeatherService> _logger;

        public WeatherService(HttpClient http, ILogger<WeatherService> logger)
        {
            _http = http;
            _logger = logger;
        }

        public async Task<WeatherPoint> GetRainfallLast30DaysAsync(decimal lat, decimal lng, CancellationToken ct = default)
        {
            var endDate = DateTime.UtcNow.Date;
            var startDate = endDate.AddDays(-30);

            var url = $"https://api.open-meteo.com/v1/forecast" +
                      $"?latitude={lat.ToString(System.Globalization.CultureInfo.InvariantCulture)}" +
                      $"&longitude={lng.ToString(System.Globalization.CultureInfo.InvariantCulture)}" +
                      $"&daily=precipitation_sum" +
                      $"&start_date={startDate:yyyy-MM-dd}" +
                      $"&end_date={endDate:yyyy-MM-dd}" +
                      $"&timezone=auto";

            _logger.LogInformation("Goi Open-Meteo: {Url}", url);

            using var response = await _http.GetAsync(url, ct);
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(json);

            var precipArray = doc.RootElement.GetProperty("daily").GetProperty("precipitation_sum");
            decimal totalMm = 0;
            foreach (var v in precipArray.EnumerateArray())
            {
                if (v.ValueKind == JsonValueKind.Number)
                    totalMm += v.GetDecimal();
            }

            long timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            return new WeatherPoint(totalMm, timestamp);
        }
    }
}