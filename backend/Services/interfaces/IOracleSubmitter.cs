using System.Numerics;

namespace backend.Services.interfaces
{
    public interface IOracleSubmitter
    {
        /// valueScaled da nhan 100 (mua: mm x 100, gio: km/h x 100).
        Task<string> SubmitWeatherDataAsync(string regionId, byte perilType, BigInteger valueScaled, long timestamp, CancellationToken ct = default);
    }
}
