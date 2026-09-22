namespace backend.Services.interfaces
{
    public interface IOracleSubmitter
    {
        Task<string> SubmitWeatherDataAsync(string regionId, decimal value, long timestamp, CancellationToken ct = default);
    }
}