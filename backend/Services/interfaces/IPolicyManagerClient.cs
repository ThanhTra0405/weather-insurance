namespace backend.Services.interfaces
{
    public interface IPolicyManagerClient
    {
        Task<string> VerifyPolicyAsync(ulong policyId, bool approved, CancellationToken ct = default);
    }
}