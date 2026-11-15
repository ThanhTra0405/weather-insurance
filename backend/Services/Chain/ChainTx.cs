using Nethereum.Contracts;
using Nethereum.Hex.HexTypes;

namespace backend.Services.Chain;

public static class ChainTx
{
    /// Gui tx duoi khoa nonce, gas co dinh, cho receipt, nem loi neu tx revert (status = 0).
    public static async Task<string> SendAsync(
        IChainContext ctx, Function fn, ulong gas, CancellationToken ct, params object[] args)
    {
        await ctx.TxLock.WaitAsync(ct);
        try
        {
            var hash = await fn.SendTransactionAsync(
                from: ctx.OperatorAddress,
                gas: new HexBigInteger(gas),
                value: null,
                functionInput: args);

            var receipt = await ctx.Web3.TransactionReceiptPolling.PollForReceiptAsync(hash, ct);
            if (receipt.Status?.Value != 1)
                throw new InvalidOperationException($"Giao dich bi revert: {hash}");
            return hash;
        }
        finally
        {
            ctx.TxLock.Release();
        }
    }

    /// Nhu SendAsync nhung de Nethereum estimate gas (+20%). Neu tx se revert thi loi nem ra ngay
    /// tu buoc estimate, kem ly do revert (dung cho tx admin).
    public static async Task<string> SendEstimatedAsync(
        IChainContext ctx, Function fn, CancellationToken ct, params object[] args)
    {
        await ctx.TxLock.WaitAsync(ct);
        try
        {
            var estimate = await fn.EstimateGasAsync(
                from: ctx.OperatorAddress,
                gas: null,
                value: null,
                functionInput: args);
            var gas = new HexBigInteger(estimate.Value * 12 / 10);

            var hash = await fn.SendTransactionAsync(
                from: ctx.OperatorAddress,
                gas: gas,
                value: null,
                functionInput: args);

            var receipt = await ctx.Web3.TransactionReceiptPolling.PollForReceiptAsync(hash, ct);
            if (receipt.Status?.Value != 1)
                throw new InvalidOperationException($"Giao dich bi revert: {hash}");
            return hash;
        }
        finally
        {
            ctx.TxLock.Release();
        }
    }
}
