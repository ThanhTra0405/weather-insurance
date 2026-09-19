# Chuẩn hoá `regionId` — dùng cho Hardhat, Backend (.NET), Frontend (Angular)

> File này là **nguồn chân lý duy nhất** cho công thức tính `regionId`. Bất kỳ nơi nào
> implement lại (backend .NET tuần 3, frontend Angular tuần 4) đều phải cho ra **đúng
> hash y hệt** với cùng input lat/lng — sai 1 chi tiết nhỏ (làm tròn, thứ tự pack, đơn vị)
> là oracle set dữ liệu cho region A nhưng policy tra region B, `checkAndPayout()` sẽ luôn
> thấy dữ liệu rỗng mà không có lỗi nào hiện ra để debug.

---

## 1. Mục đích

`regionId` là khoá (key) để nhóm nhiều policy nằm gần nhau vào chung **1 vùng dữ liệu thời tiết**
(bán kính ~15–25km, theo quyết định thiết kế ở tài liệu tổng hợp phần C). Thay vì lưu oracle data
theo từng toạ độ lẻ (tốn gas, không bao giờ trùng khớp tuyệt đối giữa 2 policy), hệ thống **làm tròn**
toạ độ về 1 lưới ô vuông cố định rồi hash lại — 2 policy nằm trong cùng 1 ô lưới sẽ ra cùng `regionId`,
dùng chung 1 điểm dữ liệu oracle.

---

## 2. Công thức chuẩn

### Bước 1 — Làm tròn về lưới ô vuông
```
gridSizeDeg = 0.2   (≈ 22km theo chiều vĩ độ tại xích đạo — khớp phạm vi 15–25km/policy đã chốt)

roundedLat = round(lat / gridSizeDeg) * gridSizeDeg
roundedLng = round(lng / gridSizeDeg) * gridSizeDeg
```

### Bước 2 — Scale về số nguyên (khớp định dạng contract lưu lat/lng)
`PolicyManager.sol` lưu toạ độ dạng `int256`, đã nhân sẵn `1e6` (xem hằng số `MIN_LAT`/`MAX_LAT`
trong contract: `8_180_000` tương ứng `8.18` độ). Vì vậy **bắt buộc nhân 1e6 trước khi hash**,
không hash số thập phân trực tiếp — Solidity không có kiểu số thực.

```
latScaled = round(roundedLat * 1_000_000)   // int256
lngScaled = round(roundedLng * 1_000_000)   // int256
```

### Bước 3 — Pack & hash
Dùng `abi.encodePacked(int256, int256)` rồi `keccak256` — **thứ tự bắt buộc: lat trước, lng sau**.

```
regionId = keccak256(abi.encodePacked(latScaled, lngScaled))   // bytes32
```

### Điểm bắt buộc giống nhau tuyệt đối giữa mọi ngôn ngữ implement
| Yếu tố | Giá trị chuẩn | Ghi chú |
|---|---|---|
| `gridSizeDeg` | `0.2` | Đổi giá trị này = đổi hết mọi regionId đã có, phải đồng bộ cả 3 nơi cùng lúc |
| Đơn vị trước khi pack | `int256`, đã nhân `1e6` | Không dùng `uint256`, không dùng số thập phân |
| Thứ tự pack | `lat` trước, `lng` sau | Đảo ngược = hash khác hoàn toàn |
| Kiểu hash | `keccak256` trên `abi.encodePacked` (Solidity) tương đương `solidityPacked` (ethers.js) | Không dùng `abi.encode` (có padding khác `encodePacked`) |
| Làm tròn số nguyên | Làm tròn *sau* khi nhân 1e6 (tránh sai số dấu phẩy động) | Xem lưu ý mục 4 |

---

## 3. Code tham chiếu theo từng ngôn ngữ

### Hardhat / TypeScript (đã dùng ở `blockchain/test/helpers/region.ts`)
```typescript
import { ethers } from "hardhat";

export function computeRegionId(
  lat: number,
  lng: number,
  gridSizeDeg: number = 0.2
): string {
  const roundedLat = Math.round(lat / gridSizeDeg) * gridSizeDeg;
  const roundedLng = Math.round(lng / gridSizeDeg) * gridSizeDeg;
  return ethers.keccak256(
    ethers.solidityPacked(
      ["int256", "int256"],
      [Math.round(roundedLat * 1e6), Math.round(roundedLng * 1e6)]
    )
  );
}
```

### Backend .NET / C# (dùng ở `backend/Services/RegionService.cs`, tuần 3)
```csharp
using Nethereum.Util;
using System.Numerics;

public static class RegionService
{
    private const decimal GridSizeDeg = 0.2m;

    public static string ComputeRegionId(decimal lat, decimal lng)
    {
        decimal roundedLat = Math.Round(lat / GridSizeDeg, 0, MidpointRounding.AwayFromZero) * GridSizeDeg;
        decimal roundedLng = Math.Round(lng / GridSizeDeg, 0, MidpointRounding.AwayFromZero) * GridSizeDeg;

        BigInteger latScaled = (BigInteger)Math.Round(roundedLat * 1_000_000m, 0, MidpointRounding.AwayFromZero);
        BigInteger lngScaled = (BigInteger)Math.Round(roundedLng * 1_000_000m, 0, MidpointRounding.AwayFromZero);

        // int256 = 32 byte, big-endian, two's complement — giống ABI encodePacked của Solidity
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
        // BigInteger.ToByteArray() la little-endian, can dao nguoc + pad ve 32 byte,
        // giu dung so am (two's complement) neu value < 0
        byte[] raw = value.ToByteArray(); // little-endian, co the co byte thua dau
        byte[] result = new byte[32];
        byte padByte = value.Sign < 0 ? (byte)0xFF : (byte)0x00;
        for (int i = 0; i < 32; i++) result[i] = padByte;

        int len = Math.Min(raw.Length, 32);
        for (int i = 0; i < len; i++)
            result[31 - i] = raw[i];

        return result;
    }
}
```
⚠️ Chưa test kỹ phần encode `int256` âm (toạ độ Việt Nam luôn dương nên `latScaled`/`lngScaled`
thực tế không bao giờ âm trong scope đồ án — nhưng nếu sau này mở rộng ra vùng có kinh độ âm,
phải viết unit test riêng cho case âm, đối chiếu với test vector mục 5).

### Frontend / Angular (dùng ở `frontend/src/app/utils/region.util.ts`, tuần 4)
```typescript
import { keccak256, solidityPacked } from 'ethers';

export function computeRegionId(
  lat: number,
  lng: number,
  gridSizeDeg: number = 0.2
): string {
  const roundedLat = Math.round(lat / gridSizeDeg) * gridSizeDeg;
  const roundedLng = Math.round(lng / gridSizeDeg) * gridSizeDeg;
  return keccak256(
    solidityPacked(
      ['int256', 'int256'],
      [Math.round(roundedLat * 1e6), Math.round(roundedLng * 1e6)]
    )
  );
}
```
Y hệt bản Hardhat vì cùng dùng `ethers.js` — chỉ khác cách import (Hardhat inject sẵn `ethers`
qua plugin, Angular import trực tiếp từ package `ethers`).

---

## 4. Lưu ý sai số dấu phẩy động

`lat`/`lng` từ GPS thường có nhiều số thập phân (VD: `10.0452391...`). Vì JS/C# dùng số thực
nhị phân (`number`/`decimal`), phép chia `lat / gridSizeDeg` có thể ra kết quả lệch cực nhỏ
(VD: `10.199999999998` thay vì `10.2`) — **luôn làm tròn bằng `Math.round`/`Math.Round` ở mỗi
bước**, không được bỏ qua bước làm tròn dù thấy "chắc không lệch". Test vector mục 5 cố tình có
1 case gần biên lưới (`10.099999`) để phát hiện sớm nếu implementation ở ngôn ngữ nào đó làm tròn sai.

---

## 5. Test vector cố định (đối chiếu bắt buộc khi implement C#/Angular)

Chạy hàm `computeRegionId` ở bất kỳ ngôn ngữ nào với các input dưới đây — **kết quả phải khớp
tuyệt đối từng ký tự**. Nếu lệch, sai ở bước làm tròn/pack/thứ tự tham số, phải rà lại theo mục 2.

| # | Input lat | Input lng | roundedLat | roundedLng | latScaled | lngScaled | `regionId` (bytes32) |
|---|---|---|---|---|---|---|---|
| 1 | `10.0452` (Cần Thơ) | `105.7469` | `10.0` | `105.8` | `10000000` | `105800000` | `0xae1dc2ef3defcad6722db3e995085bc05d8f4d07316414b3835427aeea13a613`* |
| 2 | `21.0278` (Hà Nội) | `105.8342` | `21.0` | `105.8` | `21000000` | `105800000` | `0x0b32b1a522c55a4dd773f9b515988b98a8bc8033b8b9b04ae7f98730d86a5d8c`* |
| 3 | `10.2` (đúng tâm ô lưới) | `105.8` | `10.2` | `105.8` | `10200000` | `105800000` | `0xaa364ee2cb9aaef891dd08fb64710bc1a7e228d5741afde933a610ed6b8f71bc`* |
| 4 | `10.099999` (gần biên lưới, phải làm tròn xuống `10.0`) | `105.699999` | `10.0` | `105.6` | `10000000` | `105600000` | `0x1e87188762efab3bae5d6102260e952733a8dd24be189934c2c724b44bed21ac`* |

\* **Các hash trên được sinh ra bằng `ethers.js` (`solidityPacked` + `keccak256`) chạy thật trong môi
trường Node — không phải số bịa.** Trước khi coi đây là "chuẩn cuối cùng", chạy lại đúng 4 dòng
này bằng snippet Hardhat ở mục 3 một lần nữa trong `blockchain/` thật của bạn (có OpenZeppelin,
đúng version `ethers` project đang dùng) để chắc chắn không lệch version. Sau khi xác nhận khớp,
đóng băng bảng này lại làm chuẩn đối chiếu cho backend .NET và frontend Angular.

### Cách tự chạy lại để xác nhận (Hardhat console hoặc node script)
```javascript
const { ethers } = require("ethers"); // hoặc require("hardhat").ethers trong Hardhat console

function computeRegionId(lat, lng, gridSizeDeg = 0.2) {
  const roundedLat = Math.round(lat / gridSizeDeg) * gridSizeDeg;
  const roundedLng = Math.round(lng / gridSizeDeg) * gridSizeDeg;
  return ethers.keccak256(
    ethers.solidityPacked(
      ["int256", "int256"],
      [Math.round(roundedLat * 1e6), Math.round(roundedLng * 1e6)]
    )
  );
}

console.log(computeRegionId(10.0452, 105.7469)); // case 1
console.log(computeRegionId(21.0278, 105.8342)); // case 2
console.log(computeRegionId(10.2, 105.8));       // case 3
console.log(computeRegionId(10.099999, 105.699999)); // case 4
```

---

## 6. Checklist khi implement lại ở ngôn ngữ mới

- [ ] `gridSizeDeg = 0.2`, không hardcode giá trị khác
- [ ] Làm tròn **sau khi chia** cho `gridSizeDeg`, rồi mới nhân lại
- [ ] Nhân `1_000_000` rồi làm tròn về số nguyên trước khi pack
- [ ] Pack đúng thứ tự `lat` trước, `lng` sau, kiểu `int256`
- [ ] Dùng thuật toán tương đương `abi.encodePacked` (không padding thêm như `abi.encode`)
- [ ] Chạy đủ 4 test vector ở mục 5, so khớp **toàn bộ chuỗi hex**, không chỉ vài ký tự đầu
- [ ] Nếu có case toạ độ âm (ngoài scope hiện tại), viết thêm test vector riêng và cập nhật bảng
