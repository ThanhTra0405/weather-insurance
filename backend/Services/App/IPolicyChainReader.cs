// Tạm thời của B. Khi A push IPolicyManagerClient.GetPolicyAsync/HasEvidenceOnChainAsync thì chuyển sang dùng của A và xoá file này.
using System.Numerics;

namespace backend.Services.App;

/// <summary>Thiếu cấu hình để đọc blockchain (RpcUrl hoặc PolicyManagerAddress).</summary>
public class ChainNotConfiguredException : InvalidOperationException
{
    public ChainNotConfiguredException(string message) : base(message)
    {
    }
}

/// <summary>Policy đọc từ contract. Exists = false khi contract không có policy với id đó.</summary>
public record ChainPolicy(
    bool Exists,
    string Holder,
    byte Status,
    ulong ProductId,
    BigInteger Lat,
    BigInteger Lng,
    BigInteger StartTime,
    BigInteger EndTime,
    BigInteger PremiumPaid,
    BigInteger CoverageAmount);

/// <summary>Hash bằng chứng nông dân đã gửi lên contract (dạng "0x" + 64 hex viết thường). SubmittedAt = 0: chưa gửi.</summary>
public record ChainEvidence(string FieldPhotoHash, string DocumentHash, BigInteger SubmittedAt)
{
    public bool Exists => SubmittedAt > 0;
}

/// <summary>Đọc dữ liệu PolicyManager (chỉ đọc, không ký giao dịch).</summary>
public interface IPolicyChainReader
{
    /// <summary>Holder trả về dạng viết thường. Status: 0 PendingVerification, 1 Active, 2 PaidOut, 3 Closed.</summary>
    Task<ChainPolicy> GetPolicyAsync(ulong policyId, CancellationToken ct = default);

    /// <summary>true nếu nông dân đã gửi hash bằng chứng lên contract (evidenceOf.submittedAt != 0).</summary>
    Task<bool> HasEvidenceOnChainAsync(ulong policyId, CancellationToken ct = default);

    /// <summary>Đọc hash bằng chứng on-chain (evidenceOf) để so với evidence_meta khi duyệt.</summary>
    Task<ChainEvidence> GetEvidenceAsync(ulong policyId, CancellationToken ct = default);
}
