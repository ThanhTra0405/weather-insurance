using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.Threading.Tasks;
using backend.Services.interfaces;
using Nethereum.ABI.FunctionEncoding.Attributes;
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
    public class PolicyManagerClient : IPolicyManagerClient
    {
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

            var txHash = await function.SendTransactionAsync(
                from: _web3.TransactionManager.Account.Address,
                gas: new Nethereum.Hex.HexTypes.HexBigInteger(300_000),
                value: null,
                functionInput: new object[] { new BigInteger(policyId), approved }
            );

            return txHash;
        }

        public async Task<List<PendingPolicyDTO>> GetPendingPoliciesAsync(CancellationToken ct = default)
        {
            var contract = _web3.Eth.GetContract(PolicyManagerAbi, _policyManagerAddress);
            var nextIdFn = contract.GetFunction("nextPolicyId");
            var getPolicyFn = contract.GetFunction("getPolicy");

            BigInteger nextId = await nextIdFn.CallAsync<BigInteger>();
            var result = new List<PendingPolicyDTO>();

            for (BigInteger i = 1; i < nextId; i++)
            {
                var policy = await getPolicyFn.CallDeserializingToObjectAsync<PolicyOutputDTO>(i);
                if (policy.Status == 0) // PendingVerification
                {
                    result.Add(new PendingPolicyDTO(
                        (ulong)i, policy.Holder, policy.Lat, policy.Lng, policy.RegionId,
                        policy.CoverageAmount.ToString(), policy.EndTime
                    ));
                }
            }

            return result;
        }
    }
}