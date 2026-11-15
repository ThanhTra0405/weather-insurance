using System.Globalization;
using System.Text.Json;
using backend.Models;
using backend.Services.interfaces;

namespace backend.Services
{
    public class WeatherService : IWeatherService
    {
        private static readonly int[] RetryDelaysMs = { 2000, 5000 };

        private readonly HttpClient _http;
        private readonly ILogger<WeatherService> _logger;

        public WeatherService(HttpClient http, ILogger<WeatherService> logger)
        {
            _http = http;
            _logger = logger;
        }

        public async Task<WeatherSnapshot> GetWeatherAsync(decimal lat, decimal lng, CancellationToken ct = default)
        {
            // 30 phan tu: 29 ngay truoc + hom nay
            var url = string.Create(CultureInfo.InvariantCulture,
                $"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}" +
                $"&daily=precipitation_sum,wind_gusts_10m_max&past_days=29&forecast_days=1&timezone=Asia%2FBangkok");

            _logger.LogInformation("Goi Open-Meteo: {Url}", url);

            for (var attempt = 0; ; attempt++)
            {
                try
                {
                    using var response = await _http.GetAsync(url, ct);
                    if ((int)response.StatusCode >= 500)
                        throw new HttpRequestException($"Open-Meteo tra ve {(int)response.StatusCode}");
                    response.EnsureSuccessStatusCode();

                    using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
                    var daily = doc.RootElement.GetProperty("daily");
                    var rain = ReadArray(daily.GetProperty("precipitation_sum"));
                    var gust = ReadArray(daily.GetProperty("wind_gusts_10m_max"));

                    return new WeatherSnapshot(
                        SumOrNull(rain),
                        SumOrNull(rain.TakeLast(3)),
                        MaxOrNull(gust.TakeLast(3)),
                        DateTimeOffset.UtcNow.ToUnixTimeSeconds());
                }
                catch (Exception ex) when (attempt < RetryDelaysMs.Length && !ct.IsCancellationRequested
                                           && (ex is HttpRequestException || ex is TaskCanceledException))
                {
                    _logger.LogWarning(ex, "Open-Meteo loi, thu lai lan {Attempt}", attempt + 1);
                    await Task.Delay(RetryDelaysMs[attempt], ct);
                }
            }
        }

        private static List<decimal?> ReadArray(JsonElement e) =>
            e.EnumerateArray()
             .Select(x => x.ValueKind == JsonValueKind.Number ? (decimal?)x.GetDecimal() : null)
             .ToList();

        private static decimal? SumOrNull(IEnumerable<decimal?> xs)
        {
            var v = xs.Where(x => x.HasValue).Select(x => x!.Value).ToList();
            return v.Count == 0 ? null : v.Sum();
        }

        private static decimal? MaxOrNull(IEnumerable<decimal?> xs)
        {
            var v = xs.Where(x => x.HasValue).Select(x => x!.Value).ToList();
            return v.Count == 0 ? null : v.Max();
        }
    }
}
