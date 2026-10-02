using System;
using System.Numerics;
using System.Threading.Tasks;
using backend.Services.interfaces;
using Nethereum.Web3;

namespace backend.Services
{
    public class PayoutEngineClient : IPayoutEngineClient
    {
        private const string Abi = @"
        [
        {
            ""inputs"": [{ ""internalType"": ""uint256"", ""name"": ""policyId"", ""type"": ""uint256"" }],
            ""name"": ""isThresholdMet"",
            ""outputs"": [{ ""internalType"": ""bool"", ""name"": """", ""type"": ""bool"" }],
            ""stateMutability"": ""view"", ""type"": ""function""
        },
        {
            ""inputs"": [{ ""internalType"": ""uint256"", ""name"": ""policyId"", ""type"": ""uint256"" }],
            ""name"": ""checkAndPayout"", ""outputs"": [],
            ""stateMutability"": ""nonpayable"", ""type"": ""function""
        }
        ]";

        private readonly Web3 _web3;
        private readonly string _address;
        private readonly ILogger<PayoutEngineClient> _logger;

        public PayoutEngineClient(IConfiguration config, ILogger<PayoutEngineClient> logger)
        {
            var rpcUrl = config["Blockchain:RpcUrl"]
                ?? throw new InvalidOperationException("Thieu Blockchain:RpcUrl");
            // checkAndPayout ai cũng gọi được (permissionless), dùng key backend nào cũng được
            var privateKey = config["Blockchain:OracleBackendPrivateKey"]
                ?? config["Blockchain:VerifierPrivateKey"]
                ?? throw new InvalidOperationException("Thieu private key backend");
            _address = config["Blockchain:PayoutEngineAddress"]
                ?? throw new InvalidOperationException("Thieu Blockchain:PayoutEngineAddress");

            _web3 = new Web3(new Nethereum.Web3.Accounts.Account(privateKey), rpcUrl);
            _logger = logger;
        }

        public async Task<bool> IsThresholdMetAsync(ulong policyId, CancellationToken ct = default)
        {
            try
            {
                var fn = _web3.Eth.GetContract(Abi, _address).GetFunction("isThresholdMet");
                return await fn.CallAsync<bool>(new BigInteger(policyId));
            }
            catch (Exception ex)
            {
                // Oracle chưa có dữ liệu cho vùng này sẽ revert — coi như chưa đạt ngưỡng
                _logger.LogDebug(ex, "isThresholdMet that bai cho policy {PolicyId}", policyId);
                return false;
            }
        }

        public async Task<string> CheckAndPayoutAsync(ulong policyId, CancellationToken ct = default)
        {
            var fn = _web3.Eth.GetContract(Abi, _address).GetFunction("checkAndPayout");

            _logger.LogInformation("Goi checkAndPayout: policyId={PolicyId}", policyId);

            return await fn.SendTransactionAsync(
                from: _web3.TransactionManager.Account.Address,
                gas: new Nethereum.Hex.HexTypes.HexBigInteger(400_000),
                value: null,
                functionInput: new object[] { new BigInteger(policyId) }
            );
        }
    }
}