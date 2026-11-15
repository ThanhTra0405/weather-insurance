using System.Numerics;
using backend.Services.Chain;
using backend.Services.interfaces;
using Nethereum.Hex.HexConvertors.Extensions;

namespace backend.Services;

public class OracleSubmitter : IOracleSubmitter
{
    private const string SelfHostedOracleAbi = """
    [
      {
        "inputs": [
          { "internalType": "bytes32", "name": "regionId", "type": "bytes32" },
          { "internalType": "uint8", "name": "perilType", "type": "uint8" },
          { "internalType": "uint256", "name": "value", "type": "uint256" },
          { "internalType": "uint256", "name": "timestamp", "type": "uint256" }
        ],
        "name": "submitWeatherData",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ]
    """;

    private readonly IChainContext _ctx;
    private readonly string _oracleAddress;
    private readonly ILogger<OracleSubmitter> _logger;

    public OracleSubmitter(IChainContext ctx, IConfiguration config, ILogger<OracleSubmitter> logger)
    {
        _ctx = ctx;
        _oracleAddress = config["Blockchain:SelfHostedOracleAddress"]
            ?? throw new InvalidOperationException("Thieu Blockchain:SelfHostedOracleAddress trong config");
        _logger = logger;
    }

    public async Task<string> SubmitWeatherDataAsync(
        string regionId, byte perilType, BigInteger valueScaled, long timestamp, CancellationToken ct = default)
    {
        var function = _ctx.Web3.Eth.GetContract(SelfHostedOracleAbi, _oracleAddress).GetFunction("submitWeatherData");

        // bytes32 phai truyen dang byte[], khong duoc truyen chuoi hex "0x..."
        byte[] regionIdBytes = regionId.HexToByteArray();

        _logger.LogInformation(
            "Gui submitWeatherData: regionId={RegionId} peril={Peril} value={Value} timestamp={Timestamp}",
            regionId, perilType, valueScaled, timestamp);

        return await ChainTx.SendAsync(_ctx, function, 300_000, ct,
            regionIdBytes, perilType, valueScaled, new BigInteger(timestamp));
    }
}
