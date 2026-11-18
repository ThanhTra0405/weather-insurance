using System.Globalization;
using System.Text.Json;
using backend.Models;
using backend.Services.interfaces;

namespace backend.Services
{
    /// <summary>
    /// Nguồn: Open-Meteo. Các biến daily dùng ở đây là tổng/cực đại của TỪNG NGÀY LỊCH (timezone Asia/Bangkok = UTC+7):
    ///   precipitation_sum   = tổng lượng mưa của ngày, mm (KHÔNG phải lượng mưa tích lũy)
    ///   wind_gusts_10m_max  = gió giật lớn nhất trong ngày, km/h
    /// Ngày hôm nay chưa kết thúc nên giá trị chưa đầy đủ: người gọi không được gửi ngày hôm nay lên chain.
    /// </summary>
    public class WeatherService : IWeatherService
    {
        private const int MaxPastDays = 92; // giới hạn lịch sử của forecast API
        private static readonly int[] RetryDelaysMs = { 2000, 5000 };

        private readonly HttpClient _http;
        private readonly ILogger<WeatherService> _logger;

        public WeatherService(HttpClient http, ILogger<WeatherService> logger)
        {
            _http = http;
            _logger = logger;
        }

        public async Task<IReadOnlyList<DailyWeather>> GetDailyAsync(
            decimal lat, decimal lng, DateOnly from, DateOnly to, CancellationToken ct = default)
        {
            if (to < from) throw new ArgumentException("to < from");
            var today = Chain.OracleDay.TodayLocal(DateTimeOffset.UtcNow);
            if (from < today.AddDays(-MaxPastDays))
                throw new ArgumentException($"Open-Meteo chỉ trả tối đa {MaxPastDays} ngày quá khứ");

            var url = string.Create(CultureInfo.InvariantCulture,
                $"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}" +
                $"&daily=precipitation_sum,wind_gusts_10m_max&timezone=Asia%2FBangkok" +
                $"&start_date={from:yyyy-MM-dd}&end_date={to:yyyy-MM-dd}");

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
                    return Parse(doc.RootElement.GetProperty("daily"), from, to);
                }
                catch (Exception ex) when (attempt < RetryDelaysMs.Length && !ct.IsCancellationRequested
                                           && (ex is HttpRequestException || ex is TaskCanceledException))
                {
                    _logger.LogWarning(ex, "Open-Meteo loi, thu lai lan {Attempt}", attempt + 1);
                    await Task.Delay(RetryDelaysMs[attempt], ct);
                }
            }
        }

        private static IReadOnlyList<DailyWeather> Parse(JsonElement daily, DateOnly from, DateOnly to)
        {
            var times = daily.GetProperty("time").EnumerateArray()
                .Select(x => DateOnly.ParseExact(x.GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture)).ToList();
            var rain = ReadArray(daily.GetProperty("precipitation_sum"));
            var gust = ReadArray(daily.GetProperty("wind_gusts_10m_max"));
            if (rain.Count != times.Count || gust.Count != times.Count)
                throw new InvalidOperationException("Open-Meteo: do dai mang time/gia tri khong khop");

            var byDate = new Dictionary<DateOnly, DailyWeather>();
            for (var i = 0; i < times.Count; i++)
            {
                if (byDate.ContainsKey(times[i]))
                    throw new InvalidOperationException($"Open-Meteo: trung ngay {times[i]}");
                byDate[times[i]] = new DailyWeather(times[i], Valid(rain[i]), Valid(gust[i]));
            }

            // Mọi ngày trong khoảng đều có phần tử; ngày thiếu = null (không bịa 0)
            var result = new List<DailyWeather>();
            for (var d = from; d <= to; d = d.AddDays(1))
                result.Add(byDate.TryGetValue(d, out var w) ? w : new DailyWeather(d, null, null));
            return result;
        }

        // Giá trị âm là dữ liệu rác
        private static decimal? Valid(decimal? v) => v is < 0 ? null : v;

        private static List<decimal?> ReadArray(JsonElement e) =>
            e.EnumerateArray()
             .Select(x => x.ValueKind == JsonValueKind.Number ? (decimal?)x.GetDecimal() : null)
             .ToList();
    }
}
