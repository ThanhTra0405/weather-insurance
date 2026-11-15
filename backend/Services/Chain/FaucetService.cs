using System.Numerics;
using Nethereum.Web3;
using Nethereum.Web3.Accounts;

namespace backend.Services.Chain;

public interface IFaucetService
{
    bool Configured { get; }
    string? Address { get; }
    decimal AmountEth { get; }
    int CooldownHours { get; }

    /// Giu khoa nay quanh doan "kiem tra cooldown -> gui -> ghi audit" de khong nap 2 lan khi bam nhanh.
    SemaphoreSlim Lock { get; }

    Task<BigInteger> GetBalanceWeiAsync(string address, CancellationToken ct = default);
    Task<BigInteger> GetFaucetBalanceWeiAsync(CancellationToken ct = default);
    Task<string> SendAsync(string toAddress, CancellationToken ct = default);

    bool IpLimitReached(string ip);
    void RecordIpUse(string ip);
}

/// Web3 rieng voi Faucet:PrivateKey (khac key operator) nen khong dung nonce cua operator.
public sealed class FaucetService : IFaucetService
{
    private const int MaxPerIpPerDay = 5;

    private readonly Web3 _web3;
    private readonly object _ipLock = new();
    private readonly Dictionary<string, List<DateTimeOffset>> _ipHits = new();

    public bool Configured { get; }
    public string? Address { get; }
    public decimal AmountEth { get; }
    public int CooldownHours { get; }
    public SemaphoreSlim Lock { get; } = new(1, 1);

    public FaucetService(IConfiguration config)
    {
        var rpcUrl = config["Blockchain:RpcUrl"]
            ?? throw new InvalidOperationException("Thieu Blockchain:RpcUrl");
        var chainId = long.Parse(config["Blockchain:ChainId"] ?? "31337");

        AmountEth = config.GetValue<decimal>("Faucet:AmountEth", 0.05m);
        CooldownHours = config.GetValue<int>("Faucet:CooldownHours", 24);

        var pk = config["Faucet:PrivateKey"];
        if (string.IsNullOrWhiteSpace(pk))
        {
            _web3 = new Web3(rpcUrl);
            Configured = false;
        }
        else
        {
            var account = new Account(pk, new BigInteger(chainId));
            _web3 = new Web3(account, rpcUrl);
            Address = account.Address;
            Configured = true;
        }
    }

    public async Task<BigInteger> GetBalanceWeiAsync(string address, CancellationToken ct = default) =>
        (await _web3.Eth.GetBalance.SendRequestAsync(address)).Value;

    public async Task<BigInteger> GetFaucetBalanceWeiAsync(CancellationToken ct = default) =>
        Address == null ? BigInteger.Zero : await GetBalanceWeiAsync(Address, ct);

    public async Task<string> SendAsync(string toAddress, CancellationToken ct = default)
    {
        if (!Configured) throw new InvalidOperationException("Faucet chua cau hinh");

        var receipt = await _web3.Eth.GetEtherTransferService()
            .TransferEtherAndWaitForReceiptAsync(toAddress, AmountEth);

        if (receipt.Status?.Value != 1)
            throw new InvalidOperationException($"Giao dich faucet bi revert: {receipt.TransactionHash}");
        return receipt.TransactionHash;
    }

    public bool IpLimitReached(string ip)
    {
        lock (_ipLock)
        {
            if (!_ipHits.TryGetValue(ip, out var hits)) return false;
            hits.RemoveAll(t => t < DateTimeOffset.UtcNow.AddDays(-1));
            return hits.Count >= MaxPerIpPerDay;
        }
    }

    public void RecordIpUse(string ip)
    {
        lock (_ipLock)
        {
            if (!_ipHits.TryGetValue(ip, out var hits))
                _ipHits[ip] = hits = new List<DateTimeOffset>();
            hits.Add(DateTimeOffset.UtcNow);
        }
    }
}
