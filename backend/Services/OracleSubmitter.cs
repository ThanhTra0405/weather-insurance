using System.Numerics;
using backend.Services.interfaces;
using Nethereum.Hex.HexConvertors.Extensions;
using Nethereum.Web3;

namespace WeatherInsurance.Backend.Services;

public class OracleSubmitter : IOracleSubmitter
{
    private const string SelfHostedOracleAbi = @"
    [
      {
        ""inputs"": [
          { ""internalType"": ""bytes32"", ""name"": ""regionId"", ""type"": ""bytes32"" },
          { ""internalType"": ""uint256"", ""name"": ""value"", ""type"": ""uint256"" },
          { ""internalType"": ""uint256"", ""name"": ""timestamp"", ""type"": ""uint256"" }
        ],
        ""name"": ""submitWeatherData"",
        ""outputs"": [],
        ""stateMutability"": ""nonpayable"",
        ""type"": ""function""
      }
    ]";

    private readonly Web3 _web3;
    private readonly string _oracleAddress;
    private readonly ILogger<OracleSubmitter> _logger;

    public OracleSubmitter(IConfiguration config, ILogger<OracleSubmitter> logger)
    {
        var rpcUrl = config["Blockchain:RpcUrl"]
            ?? throw new InvalidOperationException("Thieu Blockchain:RpcUrl trong config");
        var privateKey = config["Blockchain:OracleBackendPrivateKey"]
            ?? throw new InvalidOperationException("Thieu Blockchain:OracleBackendPrivateKey trong config");
        _oracleAddress = config["Blockchain:SelfHostedOracleAddress"]
            ?? throw new InvalidOperationException("Thieu Blockchain:SelfHostedOracleAddress trong config");

        var account = new Nethereum.Web3.Accounts.Account(privateKey);
        _web3 = new Web3(account, rpcUrl);
        _logger = logger;
    }

    public async Task<string> SubmitWeatherDataAsync(
        string regionId, decimal value, long timestamp, CancellationToken ct = default)
    {
        var contract = _web3.Eth.GetContract(SelfHostedOracleAbi, _oracleAddress);
        var function = contract.GetFunction("submitWeatherData");

        // FIX: bytes32 phai truyen dang byte[], khong duoc truyen thang chuoi hex "0x...".
        // Nethereum khong tu nhan dien string la hex cho kieu bytes32 (khac voi kieu address).
        byte[] regionIdBytes = regionId.HexToByteArray();

        BigInteger valueScaled = new BigInteger(value);
        BigInteger tsBig = new BigInteger(timestamp);

        _logger.LogInformation(
            "Gui submitWeatherData: regionId={RegionId} value={Value} timestamp={Timestamp}",
            regionId, valueScaled, tsBig);

        var txHash = await function.SendTransactionAsync(
            from: _web3.TransactionManager.Account.Address,
            gas: new Nethereum.Hex.HexTypes.HexBigInteger(300_000),
            value: null,
            functionInput: new object[] { regionIdBytes, valueScaled, tsBig }
        );

        return txHash;
    }
}