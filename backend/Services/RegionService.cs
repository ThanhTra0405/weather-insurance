using System.Numerics;
using backend.Services.interfaces;
using Nethereum.Hex.HexConvertors.Extensions;
using Nethereum.Util;

namespace backend.Services
{
    public class RegionService : IRegionService
    {
        private const decimal GridSizeDeg = 0.2m;

        public string ComputeRegionId(decimal lat, decimal lng)
        {
            decimal roundedLat = Math.Round(lat / GridSizeDeg, 0, MidpointRounding.AwayFromZero) * GridSizeDeg;
            decimal roundedLng = Math.Round(lng / GridSizeDeg, 0, MidpointRounding.AwayFromZero) * GridSizeDeg;

            BigInteger latScaled = (BigInteger)Math.Round(roundedLat * 1_000_000m, 0, MidpointRounding.AwayFromZero);
            BigInteger lngScaled = (BigInteger)Math.Round(roundedLng * 1_000_000m, 0, MidpointRounding.AwayFromZero);

            byte[] latBytes = ToInt256BigEndian(latScaled);
            byte[] lngBytes = ToInt256BigEndian(lngScaled);

            byte[] packed = new byte[64];
            Buffer.BlockCopy(latBytes, 0, packed, 0, 32);
            Buffer.BlockCopy(lngBytes, 0, packed, 32, 32);

            var sha3 = new Sha3Keccack();
            return "0x" + sha3.CalculateHash(packed).ToHex();
        }

        private static byte[] ToInt256BigEndian(BigInteger value)
        {
            byte[] raw = value.ToByteArray(); // little-endian
            byte[] result = new byte[32];
            byte padByte = value.Sign < 0 ? (byte)0xFF : (byte)0x00;
            for (int i = 0; i < 32; i++) result[i] = padByte;

            int len = Math.Min(raw.Length, 32);
            for (int i = 0; i < len; i++)
                result[31 - i] = raw[i];

            return result;
        }
    }
}