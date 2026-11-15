using System.Numerics;
using Nethereum.ABI.FunctionEncoding.Attributes;

namespace backend.Services.Chain;

[FunctionOutput]
public class PoolStatsDTO : IFunctionOutputDTO
{
    [Parameter("uint256", "balance", 1)] public BigInteger Balance { get; set; }
    [Parameter("uint256", "deposited", 2)] public BigInteger Deposited { get; set; }
    [Parameter("uint256", "locked", 3)] public BigInteger Locked { get; set; }
    [Parameter("uint256", "available", 4)] public BigInteger Available { get; set; }
}

public class SystemInfoDTO
{
    public string Owner { get; set; } = "";
    public string Verifier { get; set; } = "";
    public string OracleSigner { get; set; } = "";
    public string OperatorAddress { get; set; } = "";
    public string? FaucetAddress { get; set; }
    public BigInteger CoolingOffSeconds { get; set; }
    public bool PolicyManagerPaused { get; set; }
    public bool PoolPaused { get; set; }
    public bool PayoutEnginePaused { get; set; }
    public BigInteger OperatorBalanceWei { get; set; }
    public BigInteger FaucetBalanceWei { get; set; }
    public bool SignerMatches =>
        string.Equals(OracleSigner, OperatorAddress, StringComparison.OrdinalIgnoreCase);
}

public interface IAdminChainClient
{
    Task<string> CreateProductAsync(string name, byte peril, BigInteger threshold, int durationDays,
        BigInteger premiumWei, BigInteger coverageWei, CancellationToken ct = default);
    Task<string> SetProductActiveAsync(ulong productId, bool active, CancellationToken ct = default);
    Task<string> SetCoolingOffAsync(ulong seconds, CancellationToken ct = default);

    /// target: policyManager | pool | payoutEngine. Tra null neu contract da o dung trang thai do (khong gui tx).
    Task<string?> PauseAsync(string target, CancellationToken ct = default);
    Task<string?> UnpauseAsync(string target, CancellationToken ct = default);

    Task<PoolStatsDTO> GetPoolStatsAsync(CancellationToken ct = default);
    Task<BigInteger> GetTotalSharesAsync(CancellationToken ct = default);
    Task<BigInteger> GetSharesOfAsync(string address, CancellationToken ct = default);
    Task<SystemInfoDTO> GetSystemInfoAsync(CancellationToken ct = default);
}

public class AdminChainClient : IAdminChainClient
{
    public static readonly string[] Targets = { "policyManager", "pool", "payoutEngine" };

    private const string PolicyManagerAbi = """
    [
      { "inputs": [
          { "name": "name", "type": "string" }, { "name": "perilType", "type": "uint8" },
          { "name": "threshold", "type": "uint256" }, { "name": "durationDays", "type": "uint256" },
          { "name": "premium", "type": "uint256" }, { "name": "coverageAmount", "type": "uint256" } ],
        "name": "createPolicyProduct", "outputs": [{ "name": "productId", "type": "uint256" }],
        "stateMutability": "nonpayable", "type": "function" },
      { "inputs": [{ "name": "productId", "type": "uint256" }, { "name": "active", "type": "bool" }],
        "name": "setProductActive", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
      { "inputs": [{ "name": "seconds_", "type": "uint256" }],
        "name": "setCoolingOffPeriod", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
      { "inputs": [], "name": "pause", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
      { "inputs": [], "name": "unpause", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
      { "inputs": [], "name": "paused", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
      { "inputs": [], "name": "owner", "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
      { "inputs": [], "name": "verifier", "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
      { "inputs": [], "name": "coolingOffPeriod", "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }
    ]
    """;

    private const string PoolAbi = """
    [
      { "inputs": [], "name": "pause", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
      { "inputs": [], "name": "unpause", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
      { "inputs": [], "name": "paused", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
      { "inputs": [], "name": "totalShares", "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
      { "inputs": [{ "name": "", "type": "address" }], "name": "sharesOf", "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
      { "inputs": [], "name": "getPoolStats",
        "outputs": [
          { "name": "balance", "type": "uint256" }, { "name": "deposited", "type": "uint256" },
          { "name": "locked", "type": "uint256" }, { "name": "available", "type": "uint256" } ],
        "stateMutability": "view", "type": "function" }
    ]
    """;

    private const string PayoutEngineAbi = """
    [
      { "inputs": [], "name": "pause", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
      { "inputs": [], "name": "unpause", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
      { "inputs": [], "name": "paused", "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" }
    ]
    """;

    private const string OracleAbi = """
    [
      { "inputs": [], "name": "backendSigner", "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view", "type": "function" }
    ]
    """;

    private readonly IChainContext _ctx;
    private readonly IFaucetService _faucet;
    private readonly string _pmAddr, _poolAddr, _engineAddr, _oracleAddr;
    private readonly ILogger<AdminChainClient> _logger;

    public AdminChainClient(IChainContext ctx, IFaucetService faucet, IConfiguration config,
        ILogger<AdminChainClient> logger)
    {
        _ctx = ctx;
        _faucet = faucet;
        _logger = logger;
        _pmAddr = Need(config, "Blockchain:PolicyManagerAddress");
        _poolAddr = Need(config, "Blockchain:LiquidityPoolAddress");
        _engineAddr = Need(config, "Blockchain:PayoutEngineAddress");
        _oracleAddr = Need(config, "Blockchain:SelfHostedOracleAddress");
    }

    private static string Need(IConfiguration c, string key) =>
        c[key] ?? throw new InvalidOperationException($"Thieu {key}");

    private Nethereum.Contracts.Contract Pm => _ctx.Web3.Eth.GetContract(PolicyManagerAbi, _pmAddr);
    private Nethereum.Contracts.Contract Pool => _ctx.Web3.Eth.GetContract(PoolAbi, _poolAddr);

    // ---------- Ghi ----------

    public async Task<string> CreateProductAsync(string name, byte peril, BigInteger threshold, int durationDays,
        BigInteger premiumWei, BigInteger coverageWei, CancellationToken ct = default)
    {
        _logger.LogInformation("createPolicyProduct: {Name} peril={Peril} threshold={Threshold}", name, peril, threshold);
        return await ChainTx.SendEstimatedAsync(_ctx, Pm.GetFunction("createPolicyProduct"), ct,
            name, peril, threshold, new BigInteger(durationDays), premiumWei, coverageWei);
    }

    public async Task<string> SetProductActiveAsync(ulong productId, bool active, CancellationToken ct = default) =>
        await ChainTx.SendEstimatedAsync(_ctx, Pm.GetFunction("setProductActive"), ct,
            new BigInteger(productId), active);

    public async Task<string> SetCoolingOffAsync(ulong seconds, CancellationToken ct = default) =>
        await ChainTx.SendEstimatedAsync(_ctx, Pm.GetFunction("setCoolingOffPeriod"), ct,
            new BigInteger(seconds));

    public Task<string?> PauseAsync(string target, CancellationToken ct = default) => SetPausedAsync(target, true, ct);

    public Task<string?> UnpauseAsync(string target, CancellationToken ct = default) => SetPausedAsync(target, false, ct);

    private async Task<string?> SetPausedAsync(string target, bool pause, CancellationToken ct)
    {
        var (abi, addr) = target switch
        {
            "policyManager" => (PolicyManagerAbi, _pmAddr),
            "pool" => (PoolAbi, _poolAddr),
            "payoutEngine" => (PayoutEngineAbi, _engineAddr),
            _ => throw new ArgumentException($"target khong hop le: {target}"),
        };

        var contract = _ctx.Web3.Eth.GetContract(abi, addr);
        var isPaused = await contract.GetFunction("paused").CallAsync<bool>();
        if (isPaused == pause) return null; // da dung trang thai, khong can gui tx

        return await ChainTx.SendEstimatedAsync(_ctx, contract.GetFunction(pause ? "pause" : "unpause"), ct);
    }

    // ---------- Doc ----------

    public async Task<PoolStatsDTO> GetPoolStatsAsync(CancellationToken ct = default) =>
        await Pool.GetFunction("getPoolStats").CallDeserializingToObjectAsync<PoolStatsDTO>();

    public async Task<BigInteger> GetTotalSharesAsync(CancellationToken ct = default) =>
        await Pool.GetFunction("totalShares").CallAsync<BigInteger>();

    public async Task<BigInteger> GetSharesOfAsync(string address, CancellationToken ct = default) =>
        await Pool.GetFunction("sharesOf").CallAsync<BigInteger>(address);

    public async Task<SystemInfoDTO> GetSystemInfoAsync(CancellationToken ct = default)
    {
        var pm = Pm;
        var oracle = _ctx.Web3.Eth.GetContract(OracleAbi, _oracleAddr);
        var engine = _ctx.Web3.Eth.GetContract(PayoutEngineAbi, _engineAddr);

        var info = new SystemInfoDTO
        {
            Owner = await pm.GetFunction("owner").CallAsync<string>(),
            Verifier = await pm.GetFunction("verifier").CallAsync<string>(),
            OracleSigner = await oracle.GetFunction("backendSigner").CallAsync<string>(),
            OperatorAddress = _ctx.OperatorAddress,
            FaucetAddress = _faucet.Address,
            CoolingOffSeconds = await pm.GetFunction("coolingOffPeriod").CallAsync<BigInteger>(),
            PolicyManagerPaused = await pm.GetFunction("paused").CallAsync<bool>(),
            PoolPaused = await Pool.GetFunction("paused").CallAsync<bool>(),
            PayoutEnginePaused = await engine.GetFunction("paused").CallAsync<bool>(),
            OperatorBalanceWei = (await _ctx.Web3.Eth.GetBalance.SendRequestAsync(_ctx.OperatorAddress)).Value,
        };

        try { info.FaucetBalanceWei = await _faucet.GetFaucetBalanceWeiAsync(ct); }
        catch (Exception ex) { _logger.LogWarning(ex, "Khong doc duoc so du faucet"); }

        return info;
    }
}
