using System.Numerics;
using Nethereum.RPC.NonceServices;
using Nethereum.Web3;
using Nethereum.Web3.Accounts;

namespace backend.Services.Chain;

public interface IChainContext
{
    Web3 Web3 { get; }
    /// Dia chi operator (checksum). So sanh voi dia chi khac thi phai ToLowerInvariant().
    string OperatorAddress { get; }
    /// Moi tx cua operator phai giu khoa nay khi gui (tranh trung nonce).
    SemaphoreSlim TxLock { get; }
    long ChainId { get; }
}

public sealed class ChainContext : IChainContext
{
    public Web3 Web3 { get; }
    public string OperatorAddress { get; }
    public SemaphoreSlim TxLock { get; } = new(1, 1);
    public long ChainId { get; }

    public ChainContext(IConfiguration config)
    {
        var rpcUrl = config["Blockchain:RpcUrl"]
            ?? throw new InvalidOperationException("Thieu Blockchain:RpcUrl");
        var privateKey = config["Blockchain:OperatorPrivateKey"]
            ?? throw new InvalidOperationException("Thieu Blockchain:OperatorPrivateKey");
        ChainId = long.Parse(config["Blockchain:ChainId"] ?? "31337");

        // Truyen chainId de ky dung EIP-155
        var account = new Account(privateKey, new BigInteger(ChainId));
        Web3 = new Web3(account, rpcUrl);
        account.NonceService = new InMemoryNonceService(account.Address, Web3.Client);
        OperatorAddress = account.Address;
    }
}
