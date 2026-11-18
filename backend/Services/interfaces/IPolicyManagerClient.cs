namespace backend.Services.interfaces
{
    public interface IPolicyManagerClient
    {
        Task<string> VerifyPolicyAsync(ulong policyId, bool approved, CancellationToken ct = default);
        Task<List<PendingPolicyDTO>> GetPendingPoliciesAsync(CancellationToken ct = default);
        Task<PolicySnapshot> GetSnapshotAsync(CancellationToken ct = default);
        Task<string> ExpirePolicyAsync(ulong policyId, CancellationToken ct = default);
        Task<ulong> GetNextPolicyIdAsync(CancellationToken ct = default);
        Task<ulong> GetNextProductIdAsync(CancellationToken ct = default);
        Task<PolicyOutputDTO> GetPolicyAsync(ulong id, CancellationToken ct = default);
        Task<long> GetClaimDeadlineAsync(ulong policyId, CancellationToken ct = default);
        Task<ProductDTO> GetProductAsync(ulong productId, CancellationToken ct = default);
        Task<bool> HasEvidenceOnChainAsync(ulong policyId, CancellationToken ct = default);
    }
}
