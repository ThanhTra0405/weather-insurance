namespace backend.Services.interfaces
{
    public interface IPayoutEngineClient
    {
        Task<bool> IsThresholdMetAsync(ulong policyId, CancellationToken ct = default);
        Task<string> CheckAndPayoutAsync(ulong policyId, CancellationToken ct = default);
    }
}