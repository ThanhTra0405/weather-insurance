using System.Numerics;
using backend.Services.Chain;
using backend.Services.interfaces;
using Nethereum.ABI.FunctionEncoding.Attributes;
using Nethereum.RPC.Eth.DTOs;

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

    /// Ket qua products(uint256): 8 field theo dung thu tu struct PolicyProduct.
    [FunctionOutput]
    public class ProductDTO : IFunctionOutputDTO
    {
        [Parameter("uint256", "id", 1)] public BigInteger Id { get; set; }
        [Parameter("string", "name", 2)] public string Name { get; set; } = "";
        [Parameter("uint8", "perilType", 3)] public byte PerilType { get; set; }
        [Parameter("uint256", "threshold", 4)] public BigInteger Threshold { get; set; }
        [Parameter("uint256", "durationDays", 5)] public BigInteger DurationDays { get; set; }
        [Parameter("uint256", "premium", 6)] public BigInteger Premium { get; set; }
        [Parameter("uint256", "coverageAmount", 7)] public BigInteger CoverageAmount { get; set; }
        [Parameter("bool", "active", 8)] public bool Active { get; set; }
    }

    [FunctionOutput]
    public class EvidenceDTO : IFunctionOutputDTO
    {
        [Parameter("bytes32", "fieldPhotoHash", 1)] public byte[] FieldPhotoHash { get; set; } = Array.Empty<byte>();
        [Parameter("bytes32", "documentHash", 2)] public byte[] DocumentHash { get; set; } = Array.Empty<byte>();
        [Parameter("uint256", "submittedAt", 3)] public BigInteger SubmittedAt { get; set; }
    }

    public record PendingPolicyDTO(
        ulong PolicyId, string Holder, BigInteger Lat, BigInteger Lng,
        byte[] RegionId, string CoverageAmountWei, BigInteger EndTime
    );

    /// Anh chup trang thai policy tai block moi nhat.
    /// Active: dang hieu luc (chua qua han). Expirable: chua duyet hoac dang hieu luc nhung da qua han.
    public record PolicySnapshot(
        List<PolicyOutputDTO> Active,
        List<PolicyOutputDTO> Expirable,
        BigInteger ChainTime
    );

    public class PolicyManagerClient : IPolicyManagerClient
    {
        private const byte StatusPending = 0;
        private const byte StatusActive = 1;

        private const string PolicyManagerAbi = """
        [
          {
            "inputs": [
              { "internalType": "uint256", "name": "policyId", "type": "uint256" },
              { "internalType": "bool", "name": "approved", "type": "bool" }
            ],
            "name": "verifyPolicy", "outputs": [], "stateMutability": "nonpayable", "type": "function"
          },
          {
            "inputs": [{ "internalType": "uint256", "name": "policyId", "type": "uint256" }],
            "name": "expirePolicy", "outputs": [], "stateMutability": "nonpayable", "type": "function"
          },
          {
            "inputs": [{ "internalType": "uint256", "name": "policyId", "type": "uint256" }],
            "name": "getClaimDeadline",
            "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
            "stateMutability": "view", "type": "function"
          },
          {
            "inputs": [], "name": "nextPolicyId",
            "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
            "stateMutability": "view", "type": "function"
          },
          {
            "inputs": [], "name": "nextProductId",
            "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
            "stateMutability": "view", "type": "function"
          },
          {
            "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
            "name": "products",
            "outputs": [
              { "internalType": "uint256", "name": "id", "type": "uint256" },
              { "internalType": "string", "name": "name", "type": "string" },
              { "internalType": "uint8", "name": "perilType", "type": "uint8" },
              { "internalType": "uint256", "name": "threshold", "type": "uint256" },
              { "internalType": "uint256", "name": "durationDays", "type": "uint256" },
              { "internalType": "uint256", "name": "premium", "type": "uint256" },
              { "internalType": "uint256", "name": "coverageAmount", "type": "uint256" },
              { "internalType": "bool", "name": "active", "type": "bool" }
            ],
            "stateMutability": "view", "type": "function"
          },
          {
            "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
            "name": "evidenceOf",
            "outputs": [
              { "internalType": "bytes32", "name": "fieldPhotoHash", "type": "bytes32" },
              { "internalType": "bytes32", "name": "documentHash", "type": "bytes32" },
              { "internalType": "uint256", "name": "submittedAt", "type": "uint256" }
            ],
            "stateMutability": "view", "type": "function"
          },
          {
            "inputs": [{ "internalType": "uint256", "name": "policyId", "type": "uint256" }],
            "name": "getPolicy",
            "outputs": [{
              "components": [
                { "internalType": "uint256", "name": "id", "type": "uint256" },
                { "internalType": "uint256", "name": "productId", "type": "uint256" },
                { "internalType": "address", "name": "holder", "type": "address" },
                { "internalType": "int256", "name": "lat", "type": "int256" },
                { "internalType": "int256", "name": "lng", "type": "int256" },
                { "internalType": "bytes32", "name": "regionId", "type": "bytes32" },
                { "internalType": "uint256", "name": "startTime", "type": "uint256" },
                { "internalType": "uint256", "name": "endTime", "type": "uint256" },
                { "internalType": "uint256", "name": "premiumPaid", "type": "uint256" },
                { "internalType": "uint256", "name": "coverageAmount", "type": "uint256" },
                { "internalType": "uint8", "name": "status", "type": "uint8" }
              ],
              "internalType": "struct PolicyManager.Policy", "name": "", "type": "tuple"
            }],
            "stateMutability": "view", "type": "function"
          }
        ]
        """;

        private readonly IChainContext _ctx;
        private readonly string _policyManagerAddress;
        private readonly ILogger<PolicyManagerClient> _logger;

        public PolicyManagerClient(IChainContext ctx, IConfiguration config, ILogger<PolicyManagerClient> logger)
        {
            _ctx = ctx;
            _policyManagerAddress = config["Blockchain:PolicyManagerAddress"]
                ?? throw new InvalidOperationException("Thieu Blockchain:PolicyManagerAddress");
            _logger = logger;
        }

        private Nethereum.Contracts.Contract Contract =>
            _ctx.Web3.Eth.GetContract(PolicyManagerAbi, _policyManagerAddress);

        public async Task<string> VerifyPolicyAsync(ulong policyId, bool approved, CancellationToken ct = default)
        {
            _logger.LogInformation("Goi verifyPolicy: policyId={PolicyId} approved={Approved}", policyId, approved);
            return await ChainTx.SendAsync(_ctx, Contract.GetFunction("verifyPolicy"), 300_000, ct,
                new BigInteger(policyId), approved);
        }

        public async Task<string> ExpirePolicyAsync(ulong policyId, CancellationToken ct = default)
        {
            _logger.LogInformation("Goi expirePolicy: policyId={PolicyId}", policyId);
            return await ChainTx.SendAsync(_ctx, Contract.GetFunction("expirePolicy"), 300_000, ct,
                new BigInteger(policyId));
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

            // Dung thoi gian block moi nhat (khop block.timestamp ma contract so sanh)
            var block = await _ctx.Web3.Eth.Blocks.GetBlockWithTransactionsHashesByNumber
                .SendRequestAsync(BlockParameter.CreateLatest());
            BigInteger now = block.Timestamp.Value;

            var active = all.Where(p => p.Status == StatusActive && p.EndTime >= now).ToList();
            var expirable = all
                .Where(p => (p.Status == StatusActive || p.Status == StatusPending) && p.EndTime < now)
                .ToList();

            return new PolicySnapshot(active, expirable, now);
        }

        public async Task<ulong> GetNextPolicyIdAsync(CancellationToken ct = default) =>
            (ulong)await Contract.GetFunction("nextPolicyId").CallAsync<BigInteger>();

        public async Task<ulong> GetNextProductIdAsync(CancellationToken ct = default) =>
            (ulong)await Contract.GetFunction("nextProductId").CallAsync<BigInteger>();

        public async Task<PolicyOutputDTO> GetPolicyAsync(ulong id, CancellationToken ct = default) =>
            await Contract.GetFunction("getPolicy")
                .CallDeserializingToObjectAsync<PolicyOutputDTO>(new BigInteger(id));

        /// Han cuoi xu ly boi thuong (>= endTime). Khac endTime: endTime la han BAO HIEM, day la han XU LY.
        public async Task<long> GetClaimDeadlineAsync(ulong policyId, CancellationToken ct = default) =>
            (long)await Contract.GetFunction("getClaimDeadline").CallAsync<BigInteger>(new BigInteger(policyId));

        public async Task<ProductDTO> GetProductAsync(ulong productId, CancellationToken ct = default) =>
            await Contract.GetFunction("products")
                .CallDeserializingToObjectAsync<ProductDTO>(new BigInteger(productId));

        public async Task<bool> HasEvidenceOnChainAsync(ulong policyId, CancellationToken ct = default)
        {
            var e = await Contract.GetFunction("evidenceOf")
                .CallDeserializingToObjectAsync<EvidenceDTO>(new BigInteger(policyId));
            return e.SubmittedAt != 0;
        }

        // Doc toan bo policy: O(n) RPC, du cho demo. ChainIndexer + policies_cache se thay the.
        private async Task<List<PolicyOutputDTO>> ReadAllPoliciesAsync()
        {
            var contract = Contract;
            var nextId = await contract.GetFunction("nextPolicyId").CallAsync<BigInteger>();
            var getPolicyFn = contract.GetFunction("getPolicy");
            var result = new List<PolicyOutputDTO>();

            for (BigInteger i = 1; i < nextId; i++)
                result.Add(await getPolicyFn.CallDeserializingToObjectAsync<PolicyOutputDTO>(i));

            return result;
        }
    }
}
