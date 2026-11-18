namespace backend.Services.interfaces
{
    public record ThresholdEvaluation(bool Met, System.Numerics.BigInteger Observed, int ValidDays);

    public interface IPayoutEngineClient
    {
        /// <summary>Gọi evaluate() on-chain: Observed (tổng mưa 30 ngày với hạn hán) và số ngày hợp lệ.</summary>
        Task<ThresholdEvaluation> EvaluateAsync(ulong policyId, CancellationToken ct = default);
        Task<bool> IsThresholdMetAsync(ulong policyId, CancellationToken ct = default);
        Task<string> CheckAndPayoutAsync(ulong policyId, CancellationToken ct = default);
    }
}