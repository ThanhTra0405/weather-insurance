namespace backend.Services.interfaces
{
    public interface IPolicyManagerClient
    {
        Task<string> VerifyPolicyAsync(ulong policyId, bool approved, CancellationToken ct = default);
        Task<List<PendingPolicyDTO>> GetPendingPoliciesAsync(CancellationToken ct = default);
        Task<PolicySnapshot> GetSnapshotAsync(CancellationToken ct = default);
        Task<string> ExpirePolicyAsync(ulong policyId, CancellationToken ct = default);
    }
}