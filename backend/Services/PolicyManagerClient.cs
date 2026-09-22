using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.Threading.Tasks;
using backend.Services.interfaces;
using Nethereum.Web3;

namespace backend.Services
{
    public class PolicyManagerClient : IPolicyManagerClient
    {
        private const string PolicyManagerAbi = @"
    [
      {
        ""inputs"": [
          { ""internalType"": ""uint256"", ""name"": ""policyId"", ""type"": ""uint256"" },
          { ""internalType"": ""bool"", ""name"": ""approved"", ""type"": ""bool"" }
        ],
        ""name"": ""verifyPolicy"",
        ""outputs"": [],
        ""stateMutability"": ""nonpayable"",
        ""type"": ""function""
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
    }
}