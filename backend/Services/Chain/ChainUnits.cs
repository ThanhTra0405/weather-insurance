using System.Globalization;
using System.Numerics;
using Nethereum.Util;

namespace backend.Services.Chain;

public static class ChainUnits
{
    public static decimal FromWei(BigInteger wei) => UnitConversion.Convert.FromWei(wei);

    public static BigInteger ToWei(decimal eth) => UnitConversion.Convert.ToWei(eth);

    /// "0.05", "1.234567" (toi da 6 chu so thap phan, bo so 0 thua)
    public static string EthString(BigInteger wei) =>
        FromWei(wei).ToString("0.######", CultureInfo.InvariantCulture);

    public static string Hex(byte[]? bytes) =>
        "0x" + Convert.ToHexString(bytes ?? Array.Empty<byte>()).ToLowerInvariant();

    public static bool TryBig(string? s, out BigInteger value) => BigInteger.TryParse(s, out value);
}
