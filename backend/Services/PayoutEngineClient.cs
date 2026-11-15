using System.Numerics;
using backend.Services.Chain;
using backend.Services.interfaces;

namespace backend.Services
{
    public class PayoutEngineClient : IPayoutEngineClient
    {
        private const string Abi = """
        [
          {
            "inputs": [{ "internalType": "uint256", "name": "policyId", "type": "uint256" }],
            "name": "isThresholdMet",
            "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
            "stateMutability": "view", "type": "function"
          },
          {
            "inputs": [{ "internalType": "uint256", "name": "policyId", "type": "uint256" }],
            "name": "checkAndPayout", "outputs": [],
            "stateMutability": "nonpayable", "type": "function"
          }
        ]
        """;

        private readonly IChainContext _ctx;
        private readonly string _address;
        private readonly ILogger<PayoutEngineClient> _logger;

        public PayoutEngineClient(IChainContext ctx, IConfiguration config, ILogger<PayoutEngineClient> logger)
        {
            _ctx = ctx;
            _address = config["Blockchain:PayoutEngineAddress"]
                ?? throw new InvalidOperationException("Thieu Blockchain:PayoutEngineAddress");
            _logger = logger;
        }

        public async Task<bool> IsThresholdMetAsync(ulong policyId, CancellationToken ct = default)
        {
            try
            {
                var fn = _ctx.Web3.Eth.GetContract(Abi, _address).GetFunction("isThresholdMet");
                return await fn.CallAsync<bool>(new BigInteger(policyId));
            }
            catch (Exception ex)
            {
                // Oracle chua co du lieu cho vung nay co the lam call that bai: coi nhu chua dat nguong
                _logger.LogDebug(ex, "isThresholdMet that bai cho policy {PolicyId}", policyId);
                return false;
            }
        }

        public async Task<string> CheckAndPayoutAsync(ulong policyId, CancellationToken ct = default)
        {
            var fn = _ctx.Web3.Eth.GetContract(Abi, _address).GetFunction("checkAndPayout");
            _logger.LogInformation("Goi checkAndPayout: policyId={PolicyId}", policyId);
            return await ChainTx.SendAsync(_ctx, fn, 400_000, ct, new BigInteger(policyId));
        }
    }
}
