using backend.Models;

namespace backend.Services.interfaces
{
    public interface IWeatherService
    {
        /// <summary>
        /// Lấy dữ liệu từng NGÀY (đã chuẩn hóa) trong [from, to] (giờ VN). Mỗi ngày đúng 1 phần tử, sắp xếp tăng dần.
        /// Ngày nguồn không trả dữ liệu vẫn có phần tử với giá trị null (KHÔNG thay bằng 0).
        /// </summary>
        Task<IReadOnlyList<DailyWeather>> GetDailyAsync(decimal lat, decimal lng, DateOnly from, DateOnly to,
            CancellationToken ct = default);
    }
}
