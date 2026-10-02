using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.Threading.Tasks;
using backend.Services.interfaces;
using Nethereum.ABI.FunctionEncoding.Attributes;
using Nethereum.RPC.Eth.DTOs;
using Nethereum.Web3;

namespace backend.Services
{
    [FunctionOutput]
    public class PolicyOutputDTO : IFunctionOutputDTO
    {
        [Parameter("uint256", "id", 1)] public BigInteger Id { get; set; }
        [Parameter("uint256", "productId", 2)] public BigInteger ProductId { get; set; }
        [Parameter("address", "holder", 3)] public string Holder { get; set; } = "";
        [Parameter("int256", "lat", 4)] public BigInteger Lat { get; set; }
        [Parameter("int256", "lng", 5)] public BigInteger Lng { get; set; }
        [Parameter("bytes32", "regionId", 6)] public byte[] RegionId { get; set; } = Array.Empty<byte>();
        [Parameter("uint256", "startTime", 7)] public BigInteger StartTime { get; set; }
        [Parameter("uint256", "endTime", 8)] public BigInteger EndTime { get; set; }
        [Parameter("uint256", "premiumPaid", 9)] public BigInteger PremiumPaid { get; set; }
        [Parameter("uint256", "coverageAmount", 10)] public BigInteger CoverageAmount { get; set; }
        [Parameter("uint8", "status", 11)] public byte Status { get; set; }
    }

    public record PendingPolicyDTO(
        ulong PolicyId, string Holder, BigInteger Lat, BigInteger Lng,
        byte[] RegionId, string CoverageAmountWei, BigInteger EndTime
    );

    /// Ảnh chụp trạng thái policy tại thời điểm block mới nhất.
    /// Active: đang hiệu lực (chưa quá hạn). Expirable: chưa duyệt hoặc đang hiệu lực nhưng đã quá hạn.
    public record PolicySnapshot(
        List<PolicyOutputDTO> Active,
        List<PolicyOutputDTO> Expirable,
        BigInteger ChainTime
    );

    public class PolicyManagerClient : IPolicyManagerClient
    {
        private const byte StatusPending = 0;
        private const byte StatusActive = 1;

        private const string PolicyManagerAbi = @"
        [
        {
            ""inputs"": [
            { ""internalType"": ""uint256"", ""name"": ""policyId"", ""type"": ""uint256"" },
            { ""internalType"": ""bool"", ""name"": ""approved"", ""type"": ""bool"" }
            ],
            ""name"": ""verifyPolicy"", ""outputs"": [], ""stateMutability"": ""nonpayable"", ""type"": ""function""
        },
        {
            ""inputs"": [
            { ""internalType"": ""uint256"", ""name"": ""policyId"", ""type"": ""uint256"" }
            ],
            ""name"": ""expirePolicy"", ""outputs"": [], ""stateMutability"": ""nonpayable"", ""type"": ""function""
        },
        {
            ""inputs"": [], ""name"": ""nextPolicyId"",
            ""outputs"": [{ ""internalType"": ""uint256"", ""name"": """", ""type"": ""uint256"" }],
            ""stateMutability"": ""view"", ""type"": ""function""
        },
        {
            ""inputs"": [{ ""internalType"": ""uint256"", ""name"": ""policyId"", ""type"": ""uint256"" }],
            ""name"": ""getPolicy"",
            ""outputs"": [{
            ""components"": [
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
                { ""internalType"": ""uint8"", ""name"": ""status"", ""type"": ""uint8"" }
            ],
            ""internalType"": ""struct PolicyManager.Policy"", ""name"": """", ""type"": ""tuple""
            }],
            ""stateMutability"": ""view"", ""type"": ""function""
        }
        ]";

        private readonly Web3 _web3;
        private readonly string _policyManagerAddress;
        private readonly ILogger<PolicyManagerClient> _logger;

        public PolicyManagerClient(IConfiguration config, ILogger<PolicyManagerClient> logger)
        {
            var rpcUrl = config["Blockchain:RpcUrl"]
                ?? throw new InvalidOperationException("Thieu Blockchain:RpcUrl");
            // Dùng chung key backend signer, hoặc key riêng của verifier/admin nếu khác
            var privateKey = config["Blockchain:VerifierPrivateKey"]
                ?? config["Blockchain:OracleBackendPrivateKey"]
                ?? throw new InvalidOperationException("Thieu private key verifier");
            _policyManagerAddress = config["Blockchain:PolicyManagerAddress"]
                ?? throw new InvalidOperationException("Thieu Blockchain:PolicyManagerAddress");

            var account = new Nethereum.Web3.Accounts.Account(privateKey);
            _web3 = new Web3(account, rpcUrl);
            _logger = logger;
        }

        public async Task<string> VerifyPolicyAsync(ulong policyId, bool approved, CancellationToken ct = default)
        {
            var contract = _web3.Eth.GetContract(PolicyManagerAbi, _policyManagerAddress);
            var function = contract.GetFunction("verifyPolicy");

            _logger.LogInformation("Goi verifyPolicy: policyId={PolicyId} approved={Approved}", policyId, approved);

            return await function.SendTransactionAsync(
                from: _web3.TransactionManager.Account.Address,
                gas: new Nethereum.Hex.HexTypes.HexBigInteger(300_000),
                value: null,
                functionInput: new object[] { new BigInteger(policyId), approved }
            );
        }

        public async Task<string> ExpirePolicyAsync(ulong policyId, CancellationToken ct = default)
        {
            var contract = _web3.Eth.GetContract(PolicyManagerAbi, _policyManagerAddress);
            var function = contract.GetFunction("expirePolicy");

            _logger.LogInformation("Goi expirePolicy: policyId={PolicyId}", policyId);

            return await function.SendTransactionAsync(
                from: _web3.TransactionManager.Account.Address,
                gas: new Nethereum.Hex.HexTypes.HexBigInteger(300_000),
                value: null,
                functionInput: new object[] { new BigInteger(policyId) }
            );
        }

        public async Task<List<PendingPolicyDTO>> GetPendingPoliciesAsync(CancellationToken ct = default)
        {
            var all = await ReadAllPoliciesAsync();
            return all
                .Where(p => p.Status == StatusPending)
                .Select(p => new PendingPolicyDTO(
                    (ulong)p.Id, p.Holder, p.Lat, p.Lng, p.RegionId,
                    p.CoverageAmount.ToString(), p.EndTime))
                .ToList();
        }

        public async Task<PolicySnapshot> GetSnapshotAsync(CancellationToken ct = default)
        {
            var all = await ReadAllPoliciesAsync();

            // Dùng thời gian của block mới nhất (khớp block.timestamp mà contract so sánh,
            // kể cả khi Hardhat được tua thời gian bằng time.increase)
            var block = await _web3.Eth.Blocks.GetBlockWithTransactionsHashesByNumber
                .SendRequestAsync(BlockParameter.CreateLatest());
            BigInteger now = block.Timestamp.Value;

            var active = all
                .Where(p => p.Status == StatusActive && p.EndTime >= now)
                .ToList();
            var expirable = all
                .Where(p => (p.Status == StatusActive || p.Status == StatusPending) && p.EndTime < now)
                .ToList();

            return new PolicySnapshot(active, expirable, now);
        }

        // Đọc toàn bộ policy: O(n) lệnh gọi RPC mỗi lần, đủ cho demo.
        // Khi nhiều policy thì chuyển sang lắng nghe event PolicyCreated/PolicyVerified.
        private async Task<List<PolicyOutputDTO>> ReadAllPoliciesAsync()
        {
            var contract = _web3.Eth.GetContract(PolicyManagerAbi, _policyManagerAddress);
            var nextIdFn = contract.GetFunction("nextPolicyId");
            var getPolicyFn = contract.GetFunction("getPolicy");

            BigInteger nextId = await nextIdFn.CallAsync<BigInteger>();
            var result = new List<PolicyOutputDTO>();

            for (BigInteger i = 1; i < nextId; i++)
            {
                result.Add(await getPolicyFn.CallDeserializingToObjectAsync<PolicyOutputDTO>(i));
            }

            return result;
        }
    }
}