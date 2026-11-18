using System.Numerics;
using backend.Services.Chain;
using backend.Services.interfaces;
using Nethereum.ABI.FunctionEncoding.Attributes;
using Nethereum.Hex.HexConvertors.Extensions;

namespace backend.Services;

[FunctionOutput]
public class DailyRangeOutputDTO : IFunctionOutputDTO
{
    [Parameter("bool[]", "exists", 1)] public List<bool> Exists { get; set; } = new();
    [Parameter("uint256[]", "values", 2)] public List<BigInteger> Values { get; set; } = new();
}

public class OracleSubmitter : IOracleSubmitter
{
    public const int MaxBatch = 40;

    private const string SelfHostedOracleAbi = """
    [
      {
        "inputs": [
          { "internalType": "bytes32", "name": "regionId", "type": "bytes32" },
          { "internalType": "uint8", "name": "perilType", "type": "uint8" },
          { "internalType": "uint256", "name": "dayStart", "type": "uint256" },
          { "internalType": "uint256", "name": "value", "type": "uint256" }
        ],
        "name": "submitDailyData", "outputs": [], "stateMutability": "nonpayable", "type": "function"
      },
      {
        "inputs": [
          { "internalType": "bytes32", "name": "regionId", "type": "bytes32" },
          { "internalType": "uint8", "name": "perilType", "type": "uint8" },
          { "internalType": "uint256[]", "name": "dayStarts", "type": "uint256[]" },
          { "internalType": "uint256[]", "name": "values", "type": "uint256[]" }
        ],
        "name": "submitDailyDataBatch", "outputs": [], "stateMutability": "nonpayable", "type": "function"
      },
      {
        "inputs": [
          { "internalType": "bytes32", "name": "regionId", "type": "bytes32" },
          { "internalType": "uint8", "name": "perilType", "type": "uint8" },
          { "internalType": "uint256", "name": "fromDayStart", "type": "uint256" },
          { "internalType": "uint256", "name": "dayCount", "type": "uint256" }
        ],
        "name": "getDailyRange",
        "outputs": [
          { "internalType": "bool[]", "name": "exists", "type": "bool[]" },
          { "internalType": "uint256[]", "name": "values", "type": "uint256[]" }
        ],
        "stateMutability": "view", "type": "function"
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

    private Nethereum.Contracts.Contract Contract => _ctx.Web3.Eth.GetContract(SelfHostedOracleAbi, _oracleAddress);

    public async Task<string> SubmitWeatherDataAsync(
        string regionId, byte perilType, BigInteger valueScaled, long dayStart, CancellationToken ct = default)
    {
        EnsureDayStart(dayStart);
        _logger.LogInformation("Gui submitDailyData: regionId={RegionId} peril={Peril} day={Day} value={Value}",
            regionId, perilType, OracleDay.FromDayStart(dayStart), valueScaled);

        // bytes32 phai truyen dang byte[], khong duoc truyen chuoi hex "0x..."
        return await ChainTx.SendAsync(_ctx, Contract.GetFunction("submitDailyData"), 300_000, ct,
            regionId.HexToByteArray(), perilType, new BigInteger(dayStart), valueScaled);
    }

    public async Task<string> SubmitDailyBatchAsync(
        string regionId, byte perilType, IReadOnlyList<(long DayStart, BigInteger ValueScaled)> days,
        CancellationToken ct = default)
    {
        if (days.Count == 0) throw new ArgumentException("Khong co ngay nao de gui");
        if (days.Count > MaxBatch) throw new ArgumentException($"Toi da {MaxBatch} ngay / tx");
        foreach (var d in days) EnsureDayStart(d.DayStart);
        if (days.Select(d => d.DayStart).Distinct().Count() != days.Count)
            throw new ArgumentException("Batch co ngay trung nhau");

        var starts = days.Select(d => new BigInteger(d.DayStart)).ToList();
        var values = days.Select(d => d.ValueScaled).ToList();

        _logger.LogInformation("Gui submitDailyDataBatch: regionId={RegionId} peril={Peril} {From}..{To} ({N} ngay)",
            regionId, perilType, OracleDay.FromDayStart(days.Min(d => d.DayStart)),
            OracleDay.FromDayStart(days.Max(d => d.DayStart)), days.Count);

        // Gas ~ 90k / ngay
        var gas = 120_000UL + 100_000UL * (ulong)days.Count;
        return await ChainTx.SendAsync(_ctx, Contract.GetFunction("submitDailyDataBatch"), gas, ct,
            regionId.HexToByteArray(), perilType, starts, values);
    }

    public async Task<IReadOnlyList<OracleDayRecord>> GetDailyRangeAsync(
        string regionId, byte perilType, long fromDayStart, int dayCount, CancellationToken ct = default)
    {
        EnsureDayStart(fromDayStart);
        var r = await Contract.GetFunction("getDailyRange").CallDeserializingToObjectAsync<DailyRangeOutputDTO>(
            regionId.HexToByteArray(), perilType, new BigInteger(fromDayStart), new BigInteger(dayCount));

        var list = new List<OracleDayRecord>(dayCount);
        for (var i = 0; i < dayCount; i++)
            list.Add(new OracleDayRecord(fromDayStart + i * OracleDay.SecondsPerDay, r.Exists[i], r.Values[i]));
        return list;
    }

    private static void EnsureDayStart(long dayStart)
    {
        if ((dayStart + OracleDay.OffsetSeconds) % OracleDay.SecondsPerDay != 0)
            throw new ArgumentException("dayStart phai la 00:00 UTC+7 (xem OracleDay.DayStart)");
    }
}
