// Tạm thời của B. Khi A push IPolicyManagerClient.GetPolicyAsync/HasEvidenceOnChainAsync thì chuyển sang dùng của A và xoá file này.
using System.Numerics;
using Nethereum.ABI.FunctionEncoding.Attributes;
using Nethereum.Web3;

namespace backend.Services.App;

[FunctionOutput]
public class OnChainEvidenceDTO : IFunctionOutputDTO
{
    [Parameter("bytes32", "fieldPhotoHash", 1)] public byte[] FieldPhotoHash { get; set; } = Array.Empty<byte>();
    [Parameter("bytes32", "documentHash", 2)] public byte[] DocumentHash { get; set; } = Array.Empty<byte>();
    [Parameter("uint256", "submittedAt", 3)] public BigInteger SubmittedAt { get; set; }
}

/// <summary>
/// Đọc PolicyManager qua getter của mapping public `policies` và `evidenceOf`. Dùng mapping thay vì getPolicy()
/// vì getPolicy() revert khi policy không tồn tại, còn mapping trả về struct rỗng (id = 0) nên không phải bắt revert.
/// Tái sử dụng PolicyOutputDTO của PolicyManagerClient (cùng thứ tự trường với struct Policy).
/// </summary>
public class PolicyChainReader : IPolicyChainReader
{
    private const string Abi = @"[
      {
        ""inputs"": [{ ""internalType"": ""uint256"", ""name"": """", ""type"": ""uint256"" }],
        ""name"": ""policies"",
        ""outputs"": [
          { ""internalType"": ""uint256"", ""name"": ""id"", ""type"": ""uint256"" },
          { ""internalType"": ""uint256"", ""name"": ""productId"", ""type"": ""uint256"" },
          { ""internalType"": ""address"", ""name"": ""holder"", ""type"": ""address"" },
          { ""internalType"": ""int256"", ""name"": ""lat"", ""type"": ""int256"" },
          { ""internalType"": ""int256"", ""name"": ""lng"", ""type"": ""int256"" },
          { ""internalType"": ""bytes32"", ""name"": ""regionId"", ""type"": ""bytes32"" },
          { ""internalType"": ""uint256"", ""name"": ""startTime"", ""type"": ""uint256"" },
          { ""internalType"": ""uint256"", ""name"": ""endTime"", ""type"": ""uint256"" },
          { ""internalType"": ""uint256"", ""name"": ""premiumPaid"", ""type"": ""uint256"" },
          { ""internalType"": ""uint256"", ""name"": ""coverageAmount"", ""type"": ""uint256"" },
          { ""internalType"": ""enum PolicyManager.PolicyStatus"", ""name"": ""status"", ""type"": ""uint8"" }
        ],
        ""stateMutability"": ""view"",
        ""type"": ""function""
      },
      {
        ""inputs"": [{ ""internalType"": ""uint256"", ""name"": """", ""type"": ""uint256"" }],
        ""name"": ""evidenceOf"",
        ""outputs"": [
          { ""internalType"": ""bytes32"", ""name"": ""fieldPhotoHash"", ""type"": ""bytes32"" },
          { ""internalType"": ""bytes32"", ""name"": ""documentHash"", ""type"": ""bytes32"" },
          { ""internalType"": ""uint256"", ""name"": ""submittedAt"", ""type"": ""uint256"" }
        ],
        ""stateMutability"": ""view"",
        ""type"": ""function""
      }
    ]";

    private readonly IConfiguration _config;
    private readonly object _lock = new();
    private Nethereum.Contracts.Contract? _contract;

    public PolicyChainReader(IConfiguration config)
    {
        _config = config;
    }

    public async Task<ChainPolicy> GetPolicyAsync(ulong policyId, CancellationToken ct = default)
    {
        var fn = GetContract().GetFunction("policies");
        var p = await fn.CallDeserializingToObjectAsync<PolicyOutputDTO>(new BigInteger(policyId));

        var exists = p.Id != 0;
        return new ChainPolicy(
            Exists: exists,
            Holder: (p.Holder ?? "").ToLowerInvariant(),
            Status: p.Status,
            ProductId: exists ? (ulong)p.ProductId : 0,
            Lat: p.Lat,
            Lng: p.Lng,
            StartTime: p.StartTime,
            EndTime: p.EndTime,
            PremiumPaid: p.PremiumPaid,
            CoverageAmount: p.CoverageAmount);
    }

    public async Task<bool> HasEvidenceOnChainAsync(ulong policyId, CancellationToken ct = default)
    {
        var e = await GetEvidenceAsync(policyId, ct);
        return e.Exists;
    }

    public async Task<ChainEvidence> GetEvidenceAsync(ulong policyId, CancellationToken ct = default)
    {
        var fn = GetContract().GetFunction("evidenceOf");
        var e = await fn.CallDeserializingToObjectAsync<OnChainEvidenceDTO>(new BigInteger(policyId));
        return new ChainEvidence(ToHex(e.FieldPhotoHash), ToHex(e.DocumentHash), e.SubmittedAt);
    }

    private static string ToHex(byte[]? bytes) =>
        "0x" + Convert.ToHexString(bytes ?? Array.Empty<byte>()).ToLowerInvariant();

    // Tạo muộn (khi gọi lần đầu) để backend vẫn khởi động được khi chưa cấu hình chain.
    private Nethereum.Contracts.Contract GetContract()
    {
        if (_contract != null) return _contract;

        lock (_lock)
        {
            if (_contract != null) return _contract;

            var rpcUrl = _config["Blockchain:RpcUrl"];
            if (string.IsNullOrWhiteSpace(rpcUrl))
                throw new ChainNotConfiguredException("Chưa cấu hình Blockchain:RpcUrl");

            var address = _config["Blockchain:PolicyManagerAddress"];
            if (string.IsNullOrWhiteSpace(address))
                throw new ChainNotConfiguredException("Chưa cấu hình PolicyManagerAddress");

            var web3 = new Web3(rpcUrl); // không có tài khoản: chỉ gọi hàm view
            _contract = web3.Eth.GetContract(Abi, address);
            return _contract;
        }
    }
}
