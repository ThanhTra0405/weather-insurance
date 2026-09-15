# Tài liệu tổng hợp: Hệ thống Bảo hiểm Thời tiết Phi tập trung

> Gộp toàn bộ tài liệu thiết kế đã thảo luận: kiến trúc kỹ thuật, cấu trúc thư mục, triển khai, chức năng, xác minh vị trí/chống gian lận, và hướng dẫn ví người dùng.

---

## PHẦN A — THIẾT KẾ KỸ THUẬT BAN ĐẦU


## 1. Cấu trúc đề tài

### 1.1 Ý tưởng cốt lõi
Người dùng mua một **policy bảo hiểm** gắn với một điều kiện thời tiết đo được (lượng mưa, nhiệt độ, tốc độ gió...) tại một khu vực, trong một khoảng thời gian. Khi **oracle** xác nhận điều kiện đó xảy ra (VD: lượng mưa dưới 50mm trong 30 ngày → hạn hán), hợp đồng **tự động chi trả** — không cần nộp hồ sơ, không cần người xét duyệt, không cần chờ đợi.

Đây gọi là **parametric insurance** (bảo hiểm theo tham số) — khác bảo hiểm truyền thống ở chỗ: bồi thường dựa trên **dữ liệu đo lường khách quan**, không dựa trên "thiệt hại thực tế" phải chứng minh.

### 1.2 Các actor (vai trò) trong hệ thống

| Actor | Vai trò |
|---|---|
| **Policyholder** (người mua bảo hiểm) | Trả premium, được payout tự động nếu điều kiện kích hoạt |
| **Liquidity Provider (LP)** | Góp vốn vào pool để chi trả bồi thường, đổi lại nhận lãi từ premium |
| **Oracle** | Nguồn dữ liệu thời tiết bên ngoài (Chainlink Functions, hoặc mock để test) |
| **Owner/Admin** | Cấu hình sản phẩm bảo hiểm, tạm dừng khẩn cấp (pause), không được tự ý rút tiền |

### 1.3 Luồng nghiệp vụ (workflow)

```
1. LP góp vốn vào LiquidityPool
        │
        ▼
2. Policyholder chọn sản phẩm (vùng, loại rủi ro, ngưỡng, thời hạn)
   và mua policy bằng cách trả premium
        │
        ▼
3. Premium được cộng vào LiquidityPool (tăng vốn khả dụng để chi trả)
        │
        ▼
4. Trong thời hạn policy, Oracle định kỳ cập nhật dữ liệu thời tiết
        │
        ├── Điều kiện ĐẠT ngưỡng ──► PayoutEngine tự động
        │                            chuyển tiền bồi thường cho
        │                            policyholder, trừ từ pool
        │
        └── Hết hạn mà KHÔNG đạt ──► Policy đóng, không payout
            ngưỡng                   (premium đã thu thuộc về pool,
                                      trả lãi cho LP)
```

### 1.4 Kiến trúc hợp đồng (tách theo trách nhiệm — không dồn hết vào 1 file)

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  PolicyManager   │◄────►│  LiquidityPool    │◄────►│  WeatherOracle  │
│  - tạo policy    │      │  - nhận vốn LP    │      │  (interface +   │
│  - lưu điều kiện │      │  - giữ premium    │      │   mock/Chainlink)│
│  - kiểm tra hạn  │      │  - chi trả payout │      └─────────────────┘
└────────┬─────────┘      └───────────────────┘
         │
         ▼
┌──────────────────┐
│  PayoutEngine     │
│  - đối chiếu dữ    │
│    liệu oracle với │
│    ngưỡng policy   │
│  - kích hoạt trả   │
│    tiền             │
└──────────────────┘
```

Tách 4 hợp đồng riêng thay vì gộp 1 file để: (1) dễ test độc lập từng phần, (2) dễ nâng cấp oracle mà không đụng logic policy, (3) giới hạn quyền — `PolicyManager` không tự ý được rút tiền pool, chỉ `PayoutEngine` mới có quyền đó.

---

## 2. Cấu trúc thư mục

Repo tổ chức theo dạng **monorepo 3 phần**: `blockchain/` (smart contract, Hardhat + TypeScript), `backend/` (service off-chain, .NET), `frontend/` (web app Angular).

```
weather-insurance/
├── blockchain/                         # Toàn bộ phần smart contract (Hardhat + TypeScript)
│   ├── contracts/
│   │   ├── PolicyManager.sol           # Tạo & quản lý policy
│   │   ├── LiquidityPool.sol           # Quản lý vốn LP + chi trả
│   │   ├── PayoutEngine.sol            # Logic đối chiếu điều kiện & kích hoạt payout
│   │   ├── interfaces/
│   │   │   └── IWeatherOracle.sol      # Interface chuẩn, tách khỏi implementation
│   │   ├── oracle/
│   │   │   ├── MockWeatherOracle.sol   # Oracle giả để test local (owner tự set dữ liệu)
│   │   │   └── SelfHostedOracle.sol    # Oracle thật, nhận dữ liệu ký gửi từ backend
│   │   └── libraries/
│   │       └── PolicyMath.sol          # Hàm tính premium, tỷ lệ payout (tách logic toán)
│   │
│   ├── test/
│   │   ├── PolicyManager.test.ts
│   │   ├── LiquidityPool.test.ts
│   │   ├── PayoutEngine.test.ts
│   │   └── integration/
│   │       └── FullFlow.test.ts        # Test end-to-end: mua policy → oracle báo → payout
│   │
│   ├── ignition/modules/
│   │   └── DeployAll.ts                # Hardhat Ignition: deploy & nối toàn bộ contract
│   │
│   ├── scripts/
│   │   ├── seedLiquidity.ts            # Script LP góp vốn mẫu (để demo)
│   │   └── simulateWeatherEvent.ts     # Script giả lập oracle báo dữ liệu (test local)
│   │
│   ├── hardhat.config.ts
│   ├── tsconfig.json
│   ├── .env.example                    # SEPOLIA_RPC_URL, PRIVATE_KEY, ORACLE_SIGNER_KEY...
│   ├── package.json
│   └── README.md
│
├── backend/                            # Service off-chain (.NET)
│   ├── Program.cs
│   ├── backend.csproj
│   ├── appsettings.json
│   └── Properties/
│
├── frontend/                           # Web app (Angular)
│   └── src/app/
│
├── .gitignore
└── README.md
```

---

## 3. Triển khai (deployment plan)

### Giai đoạn 1 — Local (Hardhat network)
1. Deploy `MockWeatherOracle` trước — vì các contract khác cần địa chỉ của nó.
2. Deploy `LiquidityPool`.
3. Deploy `PolicyManager`, truyền địa chỉ `LiquidityPool` và `MockWeatherOracle` vào constructor.
4. Deploy `PayoutEngine`, truyền địa chỉ cả 3 contract trên.
5. Gọi `LiquidityPool.setPayoutEngine(address)` để cấp quyền cho `PayoutEngine` được rút tiền pool (chỉ nó, không ai khác).
6. Script `seedLiquidity.ts`: vài tài khoản test đóng vai LP, góp vốn vào pool.
7. Script `simulateWeatherEvent.ts`: giả lập oracle set dữ liệu mưa thấp → gọi `PayoutEngine.checkAndPayout(policyId)` → kiểm tra tiền tự động chuyển đúng.

### Giai đoạn 2 — Testnet (Sepolia) với oracle thật
1. Đăng ký **Chainlink Functions subscription**, nạp LINK token test (xin free ở faucet).
2. Deploy `ChainlinkWeatherOracle` thay cho mock — contract này gọi API thời tiết thật (VD: OpenWeatherMap) qua Chainlink Functions.
3. Deploy lại chuỗi `LiquidityPool → PolicyManager → PayoutEngine`, trỏ vào oracle thật.
4. Verify source code trên Etherscan (`npx hardhat verify`) để ai cũng đọc được contract.
5. Test bằng policy có ngưỡng thấp/thời hạn ngắn để nhanh thấy payout thật diễn ra.

### Giai đoạn 3 — Production (mainnet) — chỉ làm sau khi:
- Đã audit bảo mật (ít nhất tự chạy Slither/Mythril, tốt hơn là audit bên thứ ba).
- Đã test kỹ cơ chế chống thao túng oracle (dùng nhiều nguồn dữ liệu, lấy median).
- Có cơ chế `pause()` khẩn cấp và giới hạn số tiền tối đa 1 pool được rủi ro.

---

## 4. Các chức năng (functions) theo từng contract

### `PolicyManager.sol`
| Hàm | Vai trò gọi | Mô tả |
|---|---|---|
| `createPolicyProduct(region, riskType, threshold, duration, premiumRate)` | Owner | Định nghĩa 1 loại sản phẩm bảo hiểm (VD: "hạn hán Cần Thơ, ngưỡng 50mm/30 ngày") |
| `buyPolicy(productId, coverageAmount)` | Policyholder | Mua policy, trả premium (`payable`), tính theo `coverageAmount × premiumRate` |
| `getPolicy(policyId)` | Ai cũng gọi được (view) | Xem chi tiết 1 policy |
| `getActivePolicies(address)` | Ai cũng gọi được (view) | Danh sách policy đang hiệu lực của 1 địa chỉ |
| `expirePolicy(policyId)` | Bất kỳ ai (keeper/cron) | Đóng policy đã hết hạn mà chưa từng payout |

### `LiquidityPool.sol`
| Hàm | Vai trò gọi | Mô tả |
|---|---|---|
| `provideLiquidity()` | LP | Góp ETH/token vào pool, nhận LP share tương ứng |
| `withdrawLiquidity(shareAmount)` | LP | Rút vốn theo tỷ lệ share (chỉ rút được phần chưa bị khoá cho policy đang active) |
| `receivePremium(policyId, amount)` | Chỉ `PolicyManager` | Ghi nhận premium mới vào pool |
| `payOut(policyId, recipient, amount)` | Chỉ `PayoutEngine` | Chuyển tiền bồi thường — giới hạn quyền chặt để không ai khác rút được |
| `getPoolBalance()` | Ai cũng gọi được (view) | Tổng vốn khả dụng trong pool |
| `setPayoutEngine(address)` | Owner | Cấp quyền cho `PayoutEngine` (chỉ set 1 lần lúc deploy, hoặc qua timelock nếu đổi) |

### `PayoutEngine.sol`
| Hàm | Vai trò gọi | Mô tả |
|---|---|---|
| `checkAndPayout(policyId)` | Bất kỳ ai (thường do keeper/bot tự động gọi định kỳ) | Lấy dữ liệu mới nhất từ oracle, so với ngưỡng của policy, nếu đạt → gọi `LiquidityPool.payOut()` |
| `getLatestWeatherData(region)` | Ai cũng gọi được (view) | Đọc dữ liệu oracle hiện tại cho 1 vùng, không tốn gas ghi |
| `isThresholdMet(policyId)` | Ai cũng gọi được (view) | Kiểm tra trước xem policy có đủ điều kiện payout không, không thực thi giao dịch |

### `MockWeatherOracle.sol` (dùng khi test local)
| Hàm | Vai trò gọi | Mô tả |
|---|---|---|
| `setWeatherData(region, rainfallMm, timestamp)` | Owner (chỉ dùng lúc test) | Giả lập dữ liệu thời tiết, để kiểm tra logic payout mà không cần oracle thật |
| `getWeatherData(region)` | Ai cũng gọi được (view) | Trả về dữ liệu đã set — implement theo `IWeatherOracle` |

### `ChainlinkWeatherOracle.sol` (dùng khi deploy testnet/mainnet)
| Hàm | Vai trò gọi | Mô tả |
|---|---|---|
| `requestWeatherUpdate(region)` | Bất kỳ ai / keeper | Gửi request qua Chainlink Functions gọi API thời tiết thật |
| `fulfillRequest(requestId, response)` | Chỉ Chainlink node (callback) | Nhận kết quả trả về, lưu vào state |
| `getWeatherData(region)` | Ai cũng gọi được (view) | Cùng interface với mock, để `PayoutEngine` dùng chung logic không cần biết đang chạy oracle nào |

---

## 5. Điểm thiết kế đáng lưu ý

- **Interface `IWeatherOracle`** giúp `PayoutEngine` không quan tâm đang dùng mock hay Chainlink thật — chỉ cần đúng interface là thay được, rất hữu ích khi chuyển từ local → testnet.
- **Phân quyền chặt (`onlyPayoutEngine`, `onlyPolicyManager`)** giữa các contract — nguyên tắc *least privilege*, tránh 1 lỗ hổng ở đâu đó rút được toàn bộ pool.
- **Premium/payout tính theo công thức tách riêng** (`PolicyMath.sol`) để dễ audit và thay đổi mô hình định giá mà không sửa logic chính.
- **Chống thao túng oracle**: nên tổng hợp từ ≥2 nguồn dữ liệu độc lập, lấy giá trị trung vị (median) thay vì tin tuyệt đối 1 nguồn.

---

## Bước tiếp theo gợi ý
Có thể scaffold code thật cho từng contract ở trên (bắt đầu từ `MockWeatherOracle` + `PolicyManager` + `LiquidityPool` để chạy được luồng đầy đủ ở local trước khi đụng tới Chainlink thật).
-e 

---

## PHẦN B — XÁC ĐỊNH VỊ TRÍ, CHỐNG GIAN LẬN & MÔ HÌNH POLICY


## 1. Xác định toạ độ + tìm trạm khí tượng gần nhất

### Luồng thực hiện
1. Lúc đăng ký mua policy, app yêu cầu quyền truy cập GPS (`navigator.geolocation.getCurrentPosition()` trên web, hoặc Location API trên mobile).
2. Người dùng đứng tại ruộng, bấm "lấy vị trí" → có được toạ độ `(lat, long)` thực.
3. Off-chain service tính khoảng cách **Haversine** (công thức khoảng cách giữa 2 điểm trên mặt cầu) từ toạ độ đó tới danh sách các trạm khí tượng đã biết trước → chọn trạm gần nhất.
4. Toạ độ + trạm gần nhất được lưu vào `PolicyManager` khi tạo policy.

```javascript
// Công thức Haversine — tìm trạm khí tượng gần nhất
function findNearestStation(userLat, userLng, stations) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // bán kính Trái Đất, km

  let nearest = null;
  let minDist = Infinity;

  for (const station of stations) {
    const dLat = toRad(station.lat - userLat);
    const dLng = toRad(station.lng - userLng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(userLat)) *
        Math.cos(toRad(station.lat)) *
        Math.sin(dLng / 2) ** 2;
    const dist = 2 * R * Math.asin(Math.sqrt(a));

    if (dist < minDist) {
      minDist = dist;
      nearest = station;
    }
  }
  return { station: nearest, distanceKm: minDist };
}
```

### Giới hạn của cách này
- GPS 1 lần chỉ chứng minh *"điện thoại này đang ở toạ độ này lúc đó"* — không chứng minh được *"người cầm điện thoại sở hữu/canh tác đất tại đó"*.
- GPS trên điện thoại có thể bị **giả mạo (spoofing)** — dùng fake GPS app (phổ biến trên Android cần root, khó hơn trên iOS nhưng vẫn có cách qua công cụ dev).
- Không có cách nào ở tầng JavaScript phát hiện được GPS giả 100% — chỉ giảm thiểu được rủi ro, không loại bỏ hoàn toàn.

### Cách giảm thiểu rủi ro giả mạo GPS
- Kiểm tra trường `accuracy` đi kèm toạ độ — fake GPS thường báo độ chính xác đẹp bất thường (VD: đúng 5m), GPS thật ngoài trời thường dao động nhẹ tự nhiên.
- Lấy GPS nhiều lần trong nhiều ngày khác nhau thay vì 1 lần — vị trí quá nhất quán tuyệt đối theo từng mét là dấu hiệu đáng ngờ.
- Kết hợp thêm bằng chứng hình ảnh (xem mục 2 bên dưới).
- Đối chiếu với ảnh vệ tinh (chỉ số NDVI) để xác nhận có thực vật/ruộng thật tại toạ độ đó.

---

## 2. Cơ chế chống gian lận bằng hình ảnh

Đề xuất người dùng cung cấp 3 loại bằng chứng khi đăng ký policy:

| Bằng chứng | Mục đích | Cách xác minh |
|---|---|---|
| **Ảnh chân dung (selfie)** | Xác nhận có 1 người thật đứng ra đăng ký, gắn với 1 danh tính cụ thể | Đối chiếu (thủ công hoặc qua dịch vụ KYC) với giấy tờ tuỳ thân |
| **Ảnh chụp ruộng tại chỗ** | Xác nhận ruộng tồn tại thật, đang canh tác | Bắt buộc chụp trực tiếp bằng camera app (không cho chọn từ thư viện ảnh) — vì ảnh chụp trực tiếp giữ nguyên metadata EXIF chứa GPS gốc, khó giả mạo đồng thời cả app GPS lẫn ảnh |
| **Ảnh chụp giấy tờ đất** (sổ đỏ / giấy chứng nhận quyền sử dụng đất) | Xác nhận quyền sở hữu/canh tác hợp pháp | Đối chiếu thủ công bởi admin hoặc đại lý địa phương trước khi kích hoạt policy |

### Nguyên tắc đối chiếu chéo
- **EXIF của ảnh ruộng** nên khớp với **GPS đã khai báo ở bước 1** (sai lệch trong ngưỡng cho phép, VD vài trăm mét) — nếu lệch quá xa, từ chối hoặc đánh dấu cần xét duyệt thủ công.
- **Timestamp** của 3 loại bằng chứng nên gần nhau (cùng 1 buổi đi thực địa) — tránh trường hợp dùng ảnh cũ/ảnh của người khác.
- Toàn bộ quá trình xác minh này diễn ra **off-chain** (server backend xử lý, admin duyệt) — kết quả cuối cùng chỉ lưu 1 cờ `isVerified = true/false` lên on-chain, gắn với `policyId`. Contract không lưu ảnh trực tiếp (quá tốn gas), có thể lưu **hash của ảnh** (VD: SHA-256) để sau này chứng minh ảnh không bị thay đổi nếu có tranh chấp.

### Luồng xác minh đề xuất
```
Người dùng đăng ký:
  - GPS vị trí ruộng
  - Selfie
  - Ảnh chụp ruộng (camera trực tiếp)
  - Ảnh giấy tờ đất
        │
        ▼
Server backend:
  - Kiểm tra EXIF ảnh ruộng khớp GPS khai báo
  - Kiểm tra timestamp các ảnh gần nhau
  - Lưu hash từng ảnh
        │
        ▼
Admin / đại lý địa phương xét duyệt thủ công
  (đối chiếu giấy tờ, selfie có khớp người trên giấy tờ không)
        │
        ├── Duyệt ──► Gọi contract set isVerified = true
        │             cho policyId tương ứng
        │             → Policy chính thức có hiệu lực
        │
        └── Từ chối ──► Hoàn premium, policy không kích hoạt
```

**Lưu ý quan trọng**: đây vẫn là cơ chế xác minh **một lần lúc đăng ký**, không chống được 100% gian lận tinh vi — nhưng đủ để chặn phần lớn trường hợp gian lận đơn giản, và là mô hình gần với cách các dự án bảo hiểm vi mô nông nghiệp thật (như Kilimo Salama ở Kenya) đang áp dụng: kết hợp công nghệ + con người xác minh, không kỳ vọng công nghệ giải quyết 100% một mình.

---

## 3. Mô hình policy: theo từng ruộng hay theo người dùng

| Mô hình | Cách hoạt động | Đánh giá |
|---|---|---|
| **Per-parcel** (theo từng ruộng) | 1 policy = 1 mảnh ruộng cụ thể = 1 toạ độ/vùng = 1 trạm khí tượng gần nhất | ✅ Đơn giản để code và test. ✅ Đúng bản chất parametric insurance — mỗi ruộng có rủi ro khí hậu riêng theo vị trí. ⚠️ Người có nhiều ruộng phải mua nhiều policy riêng |
| **Per-user portfolio** (gộp nhiều ruộng) | 1 policy cover nhiều ruộng của cùng 1 người, mỗi ruộng có toạ độ riêng bên trong | ✅ UX gọn hơn. ⚠️ Phức tạp hơn nhiều để code — payout phải tính theo tỷ lệ diện tích bị ảnh hưởng, cần nhiều điểm dữ liệu oracle cùng lúc, dễ phát sinh lỗi logic |

### Quyết định cho đề tài này
**Chọn mô hình per-parcel** (1 policy = 1 ruộng):
- Phù hợp quy mô demo/học tập — logic contract đơn giản, dễ test từng phần.
- Nếu 1 người có nhiều ruộng, họ lặp lại thao tác mua nhiều lần — vẫn dùng chung 1 `PolicyManager` contract, chỉ khác `policyId`, không cần thiết kế thêm cấu trúc phức tạp.
- Vẫn có thể nâng cấp lên mô hình portfolio sau này nếu cần, vì kiến trúc tách rời (`PolicyManager`, `LiquidityPool`, `PayoutEngine`, oracle riêng) đã cho phép mở rộng mà không phải viết lại từ đầu.

### Cập nhật struct `Policy` (tham khảo)
```solidity
struct Policy {
    address holder;          // dia chi vi nguoi mua
    uint256 productId;       // loai san pham bao hiem
    int256 lat;               // toa do ruong
    int256 lng;
    address nearestStation;   // dia chi trạm/oracle theo doi
    uint256 coverageAmount;
    uint256 premiumPaid;
    uint256 startTime;
    uint256 endTime;
    bool isVerified;          // da xac minh giay to + anh chua
    bool isPaidOut;
    bytes32 fieldPhotoHash;   // hash anh chup ruong (bang chung)
    bytes32 documentHash;     // hash anh giay to dat
}
```

---

## Bước tiếp theo gợi ý
Có thể scaffold code thật cho:
1. Form đăng ký policy (HTML/JS) — lấy GPS, chụp ảnh, gọi Haversine tìm trạm gần nhất.
2. Cập nhật `PolicyManager.sol` với struct `Policy` mới ở trên, thêm hàm `verifyPolicy(policyId, bool approved)` chỉ admin gọi được.
-e 

---

## PHẦN C — TỔNG HỢP HỆ THỐNG: CẤU TRÚC THƯ MỤC, TRIỂN KHAI, CHỨC NĂNG


> Tài liệu tổng hợp toàn bộ thiết kế — kiến trúc, cấu trúc thư mục, kế hoạch triển khai, và danh sách chức năng.

---

## 1. Tổng quan đề tài

### 1.1 Ý tưởng cốt lõi
Người dùng mua **policy bảo hiểm** gắn với một điều kiện thời tiết đo được (lượng mưa, nhiệt độ, tốc độ gió...) tại **một ruộng/mảnh đất cụ thể**, trong một khoảng thời gian. Khi oracle xác nhận điều kiện xảy ra (VD: lượng mưa dưới 50mm trong 30 ngày → hạn hán), hợp đồng **tự động chi trả** — không cần nộp hồ sơ, không cần người xét duyệt.

Đây là **parametric insurance** — bồi thường dựa trên **dữ liệu đo lường khách quan**, không dựa trên "thiệt hại thực tế" phải chứng minh sau khi xảy ra.

### 1.2 Các quyết định thiết kế đã chốt (qua thảo luận)

| Vấn đề | Quyết định |
|---|---|
| Ai được mua? | Mở permissionless, nhưng có **cooling-off period** (policy chỉ hiệu lực sau X giờ kể từ lúc mua) để chống lợi dụng biết trước sự kiện |
| Theo dõi thời tiết ở đâu? | **Vùng cố định** (tâm toạ độ + bán kính), không theo GPS di chuyển của người dùng |
| Bán kính vùng | ~15–25km/policy cho bản demo, tương ứng độ phân giải phổ biến của API thời tiết miễn phí (Open-Meteo, OpenWeatherMap) |
| Người mua ở khu vực A, thiên tai xảy ra ở khu vực B | Không payout — đây là giới hạn cố hữu của mô hình theo vùng, cần nêu rõ trong tài liệu |
| Nguồn dữ liệu thời tiết | Open-Meteo (miễn phí, không cần key, ~10.000 lượt/ngày) là lựa chọn chính cho demo |
| Đưa dữ liệu lên chain | Oracle tự vận hành (backend .NET do mình kiểm soát, ký transaction bằng Nethereum) cho demo — **không dùng Chainlink Functions** (đã sunset 6/2026); có thể nâng cấp lên Chainlink CRE cho sản phẩm thật sau này |
| Xác định vị trí ruộng | Người dùng bật GPS tại ruộng 1 lần lúc đăng ký, hệ thống tự tính trạm/điểm dữ liệu gần nhất bằng công thức Haversine |
| Xác minh ruộng có thật + thuộc về người mua | Kết hợp: ảnh selfie + ảnh chụp ruộng (camera trực tiếp, giữ EXIF GPS) + ảnh giấy tờ đất → admin/đại lý xét duyệt thủ công → set cờ `isVerified` on-chain |
| 1 policy cho mấy ruộng | **Per-parcel**: 1 policy = 1 ruộng. Nhiều ruộng thì mua nhiều policy riêng |

### 1.3 Các actor trong hệ thống

| Actor | Vai trò |
|---|---|
| **Policyholder** | Trả premium, cung cấp GPS + ảnh xác minh, nhận payout tự động nếu điều kiện kích hoạt |
| **Liquidity Provider (LP)** | Góp vốn vào pool để chi trả bồi thường, nhận lãi từ premium |
| **Verifier / Admin** | Duyệt hồ sơ xác minh ruộng (giấy tờ, ảnh, selfie) trước khi policy có hiệu lực |
| **Oracle service** | Backend off-chain lấy dữ liệu thời tiết thật, đẩy lên contract |
| **Owner** | Cấu hình sản phẩm bảo hiểm, cấp quyền cho các contract, pause khẩn cấp |

### 1.4 Luồng nghiệp vụ tổng thể

```
1. LP góp vốn vào LiquidityPool
        │
        ▼
2. Policyholder chọn sản phẩm, bật GPS tại ruộng,
   chụp selfie + ảnh ruộng + ảnh giấy tờ, trả premium
        │
        ▼
3. Hệ thống tự tính trạm dữ liệu gần nhất (Haversine),
   lưu policy ở trạng thái "chờ xác minh"
        │
        ▼
4. Admin/đại lý đối chiếu hồ sơ (EXIF ảnh khớp GPS,
   giấy tờ khớp selfie) → duyệt hoặc từ chối
        │
        ├── Từ chối ──► Hoàn premium, đóng policy
        │
        └── Duyệt ──► isVerified = true, policy chính thức
                       có hiệu lực sau cooling-off period
                            │
                            ▼
        5. Trong thời hạn, oracle backend định kỳ lấy dữ liệu
           thời tiết thật, đẩy lên PayoutEngine
                            │
              ├── Đạt ngưỡng ──► Tự động payout cho policyholder,
              │                  trừ từ LiquidityPool
              │
              └── Hết hạn, không đạt ──► Đóng policy, premium
                                          thuộc về pool (trả lãi LP)
```

### 1.5 Kiến trúc hợp đồng

```
┌──────────────────┐      ┌───────────────────┐      ┌──────────────────┐
│  PolicyManager     │◄───►│  LiquidityPool      │◄───►│  IWeatherOracle    │
│  - tạo policy       │      │  - nhận vốn LP       │      │  interface, có 2   │
│  - lưu vị trí,      │      │  - giữ premium       │      │  cách triển khai:  │
│    trạm gần nhất    │      │  - chi trả payout    │      │  • MockWeatherOracle│
│  - lưu hash ảnh     │      └───────────────────┘      │  • SelfHostedOracle│
│    xác minh         │                                     │    (backend ký gửi) │
│  - quản lý          │      ┌───────────────────┐      └──────────────────┘
│    isVerified        │◄───►│  PayoutEngine       │
└──────────────────┘      │  - đối chiếu dữ liệu │
                              │    oracle với ngưỡng │
                              │  - kích hoạt payout   │
                              └───────────────────┘
```

Tách riêng từng contract để: (1) test độc lập từng phần, (2) đổi oracle (mock → self-hosted → Chainlink CRE sau này) mà không đụng logic policy, (3) giới hạn quyền chặt — chỉ `PayoutEngine` được rút tiền từ `LiquidityPool`.

---

## 2. Cấu trúc thư mục

```
weather-insurance/
├── blockchain/                           # Smart contract (Hardhat + TypeScript)
│   ├── contracts/
│   │   ├── PolicyManager.sol             # Tạo & quản lý policy, lưu vị trí + trạng thái xác minh
│   │   ├── LiquidityPool.sol             # Quản lý vốn LP + chi trả
│   │   ├── PayoutEngine.sol              # Đối chiếu điều kiện & kích hoạt payout
│   │   ├── interfaces/
│   │   │   └── IWeatherOracle.sol        # Interface chuẩn, tách khỏi implementation
│   │   ├── oracle/
│   │   │   ├── MockWeatherOracle.sol     # Oracle giả để test local
│   │   │   └── SelfHostedOracle.sol      # Nhận dữ liệu ký gửi từ backend riêng
│   │   └── libraries/
│   │       └── PolicyMath.sol            # Tính premium, Haversine on-chain (nếu cần), tỷ lệ payout
│   │
│   ├── test/
│   │   ├── PolicyManager.test.ts
│   │   ├── LiquidityPool.test.ts
│   │   ├── PayoutEngine.test.ts
│   │   └── integration/
│   │       └── FullFlow.test.ts          # Test end-to-end: mua → xác minh → oracle → payout
│   │
│   ├── ignition/modules/
│   │   └── DeployAll.ts                  # Hardhat Ignition: deploy & nối toàn bộ contract
│   ├── scripts/
│   │   ├── seedLiquidity.ts              # LP góp vốn mẫu (demo)
│   │   └── simulateWeatherEvent.ts       # Giả lập oracle báo dữ liệu (test local)
│   │
│   ├── hardhat.config.ts
│   ├── tsconfig.json
│   ├── .env.example                      # RPC URL, PRIVATE_KEY, ORACLE_SIGNER_KEY...
│   └── package.json
│
├── backend/                              # Off-chain service (.NET) — không phải smart contract
│   ├── Program.cs                        # Điểm khởi chạy, đăng ký DI + BackgroundService
│   ├── backend.csproj
│   ├── backend.http                      # File test nhanh các endpoint
│   ├── appsettings.json                  # RPC URL, địa chỉ contract (key thật để trong user-secrets)
│   ├── Properties/launchSettings.json
│   ├── Services/
│   │   ├── WeatherService.cs             # Gọi Open-Meteo theo toạ độ trạm
│   │   ├── OracleSubmitter.cs            # Ký & gửi transaction cập nhật oracle (Nethereum)
│   │   ├── OracleWorker.cs               # BackgroundService: cron định kỳ fetch + push
│   │   ├── NearestStationService.cs      # Tính khoảng cách Haversine, tìm trạm gần nhất
│   │   ├── ExifService.cs                # Đối chiếu EXIF ảnh ruộng với GPS khai báo
│   │   └── EvidenceHashService.cs        # Hash ảnh (SHA-256) trước khi lưu on-chain
│   ├── Controllers/
│   │   └── AdminReviewController.cs      # API cho admin duyệt/từ chối hồ sơ
│   └── Data/
│       └── stations.json                 # Danh sách trạm/điểm dữ liệu đã biết
│
├── frontend/                             # Web app (Angular)
│   └── src/
│       ├── app/
│       │   ├── services/
│       │   │   ├── web3.service.ts        # Kết nối ví, theo dõi account/chainId
│       │   │   └── contract.service.ts    # Bọc ethers.Contract, gọi hàm on-chain
│       │   ├── pages/
│       │   │   ├── buy-policy/            # Form mua policy: bản đồ, GPS, upload ảnh
│       │   │   └── dashboard/             # Xem policy đang có, trạng thái xác minh
│       │   ├── components/
│       │   │   ├── map-picker/            # Chọn/xác nhận vị trí trên bản đồ
│       │   │   └── connect-wallet-button/
│       │   └── app.routes.ts
│       ├── assets/abi/                    # ABI export từ blockchain/artifacts
│       └── environments/                  # RPC URL, contract address, chainId Sepolia
│
├── .gitignore
└── README.md
```

---

## 3. Kế hoạch triển khai

### Giai đoạn 1 — Local (Hardhat network)
1. Deploy `MockWeatherOracle` trước (các contract khác cần địa chỉ của nó).
2. Deploy `LiquidityPool`.
3. Deploy `PolicyManager`, truyền địa chỉ `LiquidityPool` + oracle vào constructor.
4. Deploy `PayoutEngine`, truyền địa chỉ cả 3 contract trên.
5. Gọi `LiquidityPool.setPayoutEngine(address)` — chỉ `PayoutEngine` được rút tiền pool.
6. `seedLiquidity.ts`: vài tài khoản test đóng vai LP, góp vốn.
7. `simulateWeatherEvent.ts`: set dữ liệu mưa thấp → gọi `PayoutEngine.checkAndPayout()` → kiểm tra payout đúng.
8. Test riêng luồng xác minh: tạo policy → gọi `verifyPolicy(policyId, true)` giả lập admin duyệt → policy chuyển active.

### Giai đoạn 2 — Testnet (Sepolia) với oracle thật tự vận hành
1. Deploy `SelfHostedOracle` thay mock — contract chỉ chấp nhận dữ liệu ký gửi từ 1 địa chỉ backend đã whitelist.
2. Chạy backend .NET (`dotnet run` trong `backend/`) — `OracleWorker` (BackgroundService) định kỳ gọi Open-Meteo theo toạ độ từng policy đang active, ký transaction gửi lên `SelfHostedOracle`.
3. Deploy lại chuỗi `LiquidityPool → PolicyManager → PayoutEngine`, trỏ vào oracle mới.
4. Verify source code trên Etherscan (`npx hardhat verify`).
5. Test với policy có ngưỡng thấp/thời hạn ngắn để nhanh thấy payout thật diễn ra.

### Giai đoạn 3 — Production (chỉ làm khi có nhu cầu thật, không bắt buộc cho đề tài học)
- Audit bảo mật (tối thiểu tự chạy Slither/Mythril).
- Thay `SelfHostedOracle` (tập trung, ít tin cậy) bằng Chainlink CRE hoặc oracle phi tập trung khác — cần khi thật sự cần độ tin cậy cao hơn 1 bên vận hành.
- Thêm cơ chế `pause()` khẩn cấp, giới hạn số tiền tối đa 1 pool được rủi ro.
- Chuyển xác minh từ thủ công sang bán tự động (đối chiếu vệ tinh NDVI, cơ chế stake).

---

## 4. Danh sách chức năng

### 4.1 Nên có (core — bắt buộc để hệ thống chạy được đầy đủ luồng)

**`PolicyManager.sol`**
- `createPolicyProduct(region, riskType, threshold, duration, premiumRate)` — Owner định nghĩa loại sản phẩm
- `buyPolicy(productId, lat, lng, coverageAmount)` — Người dùng mua, trả premium, lưu vị trí
- `submitVerificationEvidence(policyId, fieldPhotoHash, documentHash)` — Gửi hash bằng chứng đã xác minh off-chain
- `verifyPolicy(policyId, approved)` — Admin duyệt/từ chối, set `isVerified`
- `getPolicy(policyId)` / `getActivePolicies(address)` — Xem thông tin (view)
- `expirePolicy(policyId)` — Đóng policy hết hạn chưa từng payout

**`LiquidityPool.sol`**
- `provideLiquidity()` — LP góp vốn, nhận share
- `withdrawLiquidity(shareAmount)` — LP rút vốn (phần chưa bị khoá)
- `receivePremium(policyId, amount)` — Chỉ `PolicyManager` gọi
- `payOut(policyId, recipient, amount)` — Chỉ `PayoutEngine` gọi
- `getPoolBalance()` — Xem vốn khả dụng (view)

**`PayoutEngine.sol`**
- `checkAndPayout(policyId)` — Đối chiếu dữ liệu oracle với ngưỡng, kích hoạt payout nếu đạt
- `isThresholdMet(policyId)` — Kiểm tra trước, không tốn gas ghi (view)

**`MockWeatherOracle.sol`** (test local)
- `setWeatherData(region, value, timestamp)` — Owner giả lập dữ liệu
- `getWeatherData(region)` — Đọc dữ liệu (view)

**Backend**
- Tính trạm/điểm dữ liệu gần nhất bằng Haversine
- Lấy dữ liệu Open-Meteo theo lịch, đẩy lên `SelfHostedOracle`
- Đối chiếu EXIF ảnh ruộng với GPS khai báo

### 4.2 Nên thêm (quan trọng, giúp hệ thống đáng tin cậy hơn, không quá khó để làm thêm)

- **Cooling-off period**: `buyPolicy()` ghi `effectiveTime = block.timestamp + coolingOffPeriod`; `PayoutEngine` từ chối payout nếu sự kiện xảy ra trước mốc này — chống lợi dụng biết trước thiên tai mới mua.
- **Giới hạn coverage tối đa theo vốn pool khả dụng** — tránh bán quá nhiều policy vượt khả năng chi trả thực tế của `LiquidityPool` (giống nguyên tắc "solvency" trong bảo hiểm thật).
- **Sự kiện (event) đầy đủ** cho mọi hành động quan trọng (`PolicyCreated`, `PolicyVerified`, `PayoutTriggered`, `LiquidityAdded`...) — cần thiết để frontend/dashboard theo dõi real-time.
- **Hàm `pause()` / `unpause()`** ở `PolicyManager` và `PayoutEngine` — owner tạm dừng khẩn cấp nếu phát hiện oracle bị lỗi hoặc bị tấn công.
- **Giới hạn bán kính vùng hợp lệ** khi tạo `PolicyProduct` — validate toạ độ nằm trong phạm vi địa lý đã định nghĩa trước (VD: chỉ chấp nhận toạ độ trong lãnh thổ Việt Nam) để tránh dữ liệu rác.
- **Refund một phần premium** nếu policy bị từ chối xác minh (`verifyPolicy(..., false)`) — công bằng với người dùng, tránh mất trắng vì lỗi hồ sơ không cố ý.

### 4.3 Có thể thêm (mở rộng, nâng cao — làm sau nếu còn thời gian, hoặc nêu trong phần "hướng phát triển" của báo cáo)

- **Policy dạng NFT** (ERC-721) — mỗi policy là 1 NFT, giao dịch/chuyển nhượng được, dễ tích hợp với ví và marketplace.
- **Cơ chế stake chống gian lận** — người mua đặt cọc thêm, mất cọc nếu sau này bị phát hiện khai gian vị trí (qua đối chiếu vệ tinh hoặc khiếu nại cộng đồng).
- **Đối chiếu ảnh vệ tinh tự động (NDVI)** — off-chain service tự kiểm tra toạ độ có phải đất nông nghiệp thật không, giảm phụ thuộc xét duyệt thủ công.
- **Nhiều nguồn oracle + lấy giá trị trung vị** — gọi song song Open-Meteo và 1 API khác, giảm rủi ro phụ thuộc 1 nguồn dữ liệu.
- **Re-insurance giữa các pool** — nhiều `LiquidityPool` theo vùng khác nhau chia sẻ rủi ro chéo, giảm khả năng 1 pool vùng bị vỡ quỹ khi có thiên tai diện rộng.
- **Chuyển sang Chainlink CRE hoặc oracle phi tập trung khác** — thay `SelfHostedOracle` (tập trung, cần tin tưởng 1 bên) khi cần độ tin cậy cao hơn cho sản phẩm thật.
- **Mô hình per-user portfolio** — gộp nhiều ruộng vào 1 policy, cho người dùng có nhiều mảnh đất, đánh đổi lấy độ phức tạp code cao hơn.
- **Giao diện đại lý địa phương** — dashboard riêng cho đại lý xác thực hồ sơ tại thực địa, ký attestation on-chain thay vì chỉ admin trung tâm duyệt.
- **Dashboard thống kê** — tổng payout theo vùng/thời gian, tỷ lệ policy được kích hoạt, giúp đánh giá mô hình định giá premium có hợp lý không.

---

## 5. Ghi chú giới hạn cần nêu rõ khi trình bày

- Mô hình theo vùng cố định không xử lý được trường hợp người dùng di chuyển đến vùng khác gặp thiên tai — đây là giới hạn cố hữu của parametric insurance theo vùng, không phải lỗi thiết kế.
- Xác minh dựa trên ảnh + GPS 1 lần không chống được 100% gian lận tinh vi — cần kết hợp con người (admin/đại lý) xét duyệt, công nghệ chỉ hỗ trợ giảm tải, không thay thế hoàn toàn.
- `SelfHostedOracle` (backend tự vận hành) là điểm tập trung duy nhất phải tin tưởng — nên nêu rõ đây là đánh đổi phù hợp cho demo/học tập, sản phẩm thật cần oracle phi tập trung hơn.
-e 

---

## PHẦN D — TẠO VÍ & SỬ DỤNG VÍ CHO NGƯỜI DÙNG


## 1. Ví là gì, vì sao bắt buộc phải có

Mọi hành động trên blockchain (mua policy, nhận payout, góp vốn LP...) đều là 1 **transaction** phải được **ký** bằng private key của người dùng — web app không tự làm thay được, vì nếu web app giữ private key thay người dùng thì mất hết ý nghĩa "phi tập trung, người dùng tự kiểm soát tài sản". Vì vậy bắt buộc người dùng phải có ví riêng.

Ví = 1 cặp khoá (private key + public address), quản lý bởi phần mềm ví (app hoặc extension), độc lập với web app của bạn.

## 2. Các lựa chọn ví phổ biến cho người dùng phổ thông (mobile)

| Ví | Đặc điểm | Phù hợp với |
|---|---|---|
| **MetaMask Mobile** | App riêng, phổ biến nhất, có trình duyệt tích hợp sẵn bên trong app | Người dùng đã quen crypto hoặc mới bắt đầu, hướng dẫn có sẵn nhiều |
| **Trust Wallet** | Tương tự MetaMask, giao diện có thể thân thiện hơn với người hoàn toàn mới | Người dùng phổ thông, không rành kỹ thuật |
| **Coinbase Wallet** | Tích hợp tốt với sàn Coinbase, dễ mua ETH bằng thẻ ngân hàng ngay trong app | Người dùng muốn nạp tiền thật dễ dàng (không áp dụng cho testnet) |
| **Ví nhúng qua Privy / Web3Auth** | Người dùng đăng nhập bằng email/số điện thoại/Google, ví được tạo tự động phía sau — không cần biết "private key" là gì | Người dùng hoàn toàn không rành crypto, muốn trải nghiệm mượt như app thường |

→ Với **demo/testnet**, MetaMask Mobile hoặc Trust Wallet là đủ dùng, miễn phí, không cần tích hợp thêm gì phức tạp.

→ Với **sản phẩm thật nhắm tới nông dân** (đối tượng khó quen với khái niệm "seed phrase", "private key"), nên cân nhắc **ví nhúng (embedded wallet)** như Privy/Web3Auth — ẩn hoàn toàn độ phức tạp crypto, người dùng chỉ thấy trải nghiệm như đăng nhập app bình thường bằng số điện thoại.

> Lưu ý khi dùng Angular: Privy phát hành gói React (`@privy-io/react-auth`) là chính, nên với Angular phải dùng SDK lõi độc lập framework (`@privy-io/js-sdk-core`) và tự bọc thành một service, hoặc chọn Web3Auth vốn có sẵn SDK JS thuần — cần kiểm tra tài liệu phiên bản mới nhất trước khi chốt thư viện.

## 3. Luồng tạo ví lần đầu (với MetaMask/Trust Wallet — cách phổ biến nhất)

```
1. Tải app MetaMask (App Store / Google Play)
        │
        ▼
2. Chọn "Create a new wallet"
        │
        ▼
3. Đặt mật khẩu để mở khoá app (chỉ bảo vệ cục bộ trên máy)
        │
        ▼
4. App hiện ra "Secret Recovery Phrase" (seed phrase) — 12 từ tiếng Anh
   ⚠️ ĐÂY LÀ BƯỚC QUAN TRỌNG NHẤT: 12 từ này = toàn quyền kiểm soát ví.
   Ai có 12 từ này đều lấy được hết tài sản. Phải:
     - Viết tay ra giấy, không chụp ảnh màn hình, không lưu trên cloud
     - Cất giữ offline, không gửi cho bất kỳ ai (kể cả support giả mạo)
        │
        ▼
5. App bắt xác nhận lại vài từ trong seed phrase (đảm bảo đã ghi đúng)
        │
        ▼
6. Ví đã sẵn sàng — có 1 địa chỉ dạng 0xABC...123, hiện tại số dư = 0
```

## 4. Nạp tiền để test (testnet — không tốn tiền thật)

Vì demo chạy trên Sepolia testnet, người dùng cần **Sepolia ETH giả** để trả gas (phí giao dịch) và premium mô phỏng:

1. Copy địa chỉ ví (0xABC...123) từ app MetaMask.
2. Vào 1 trong các **faucet** (trang phát ETH test miễn phí): `sepoliafaucet.com`, `sepolia-faucet.pk910.de`, hoặc faucet do Alchemy/Infura cung cấp.
3. Dán địa chỉ ví vào, bấm nhận — vài phút sau có Sepolia ETH giả trong ví.

Không cần bước này nếu dùng ví nhúng kiểu Privy — có thể thiết kế để backend tự nạp gas hộ người dùng lần đầu (gọi là "gas sponsorship"), gần với trải nghiệm không cần biết gì về crypto.

## 5. Luồng kết nối ví với web app của bạn (mỗi lần sử dụng)

```
Người dùng mở web app (URL đã deploy) trên điện thoại
        │
        ▼
Bấm nút "Connect Wallet" trên web app
        │
        ├── Cách 1: Mở ngay trong app ví
        │   (người dùng mở link web app từ trong app MetaMask,
        │    trình duyệt tích hợp sẵn trong app tự nhận diện ví)
        │
        └── Cách 2: Quét mã QR (WalletConnect)
            (web app hiện mã QR, người dùng mở app ví,
             chọn "Scan QR", quét → 2 bên kết nối)
        │
        ▼
App ví hiện popup: "Web app này muốn kết nối với ví của bạn" → Bấm "Connect"
        │
        ▼
Web app giờ đã biết địa chỉ ví, có thể gọi các hàm contract
        │
        ▼
Mỗi khi web app gọi hàm cần ký (VD: buyPolicy(), withdraw()):
   App ví tự động bật popup hiện chi tiết giao dịch
   (gọi hàm gì, tốn bao nhiêu gas) → người dùng bấm "Confirm" mới thực thi
```

**Điểm quan trọng cần biết**: web app **không bao giờ** thấy được private key của người dùng — chỉ gửi yêu cầu "hãy ký giao dịch này", việc ký diễn ra hoàn toàn bên trong app ví, tách biệt khỏi web app. Đây là cơ chế bảo mật cốt lõi của mọi dApp.

## 6. Code phía web app (Angular + ethers.js + WalletConnect)

Trong Angular không có hook như React — state kết nối ví nên gom vào một **service dùng chung** (`Web3Service`), inject vào bất kỳ component nào cần.

```ts
// src/app/services/web3.service.ts
import { Injectable, signal } from '@angular/core';
import { BrowserProvider, JsonRpcSigner } from 'ethers';

@Injectable({ providedIn: 'root' })
export class Web3Service {
  readonly address = signal<string | null>(null);
  private provider?: BrowserProvider;
  private signer?: JsonRpcSigner;

  get isConnected() {
    return this.address() !== null;
  }

  async connect(): Promise<void> {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error('Chưa cài ví — hãy mở trang này trong app ví hoặc cài MetaMask');

    this.provider = new BrowserProvider(eth);
    this.signer = await this.provider.getSigner();
    this.address.set(await this.signer.getAddress());

    // Ví đổi tài khoản hoặc đổi mạng thì cập nhật lại state
    eth.on('accountsChanged', (accs: string[]) => this.address.set(accs[0] ?? null));
    eth.on('chainChanged', () => window.location.reload());
  }

  disconnect(): void {
    this.address.set(null);
    this.provider = undefined;
    this.signer = undefined;
  }

  getSigner(): JsonRpcSigner {
    if (!this.signer) throw new Error('Chưa kết nối ví');
    return this.signer;
  }
}
```

```ts
// src/app/components/connect-wallet-button/connect-wallet-button.component.ts
import { Component, inject } from '@angular/core';
import { Web3Service } from '../../services/web3.service';

@Component({
  selector: 'app-connect-wallet-button',
  standalone: true,
  template: `
    @if (web3.address(); as addr) {
      <p>Đã kết nối: {{ addr }}</p>
      <button (click)="web3.disconnect()">Ngắt kết nối</button>
    } @else {
      <button (click)="web3.connect()">Đăng nhập bằng ví điện tử</button>
    }
  `,
})
export class ConnectWalletButtonComponent {
  readonly web3 = inject(Web3Service);
}
```

Gọi hàm contract thì bọc thêm một `ContractService` dùng signer của `Web3Service`:

```ts
// src/app/services/contract.service.ts
import { Injectable, inject } from '@angular/core';
import { Contract, parseEther } from 'ethers';
import { Web3Service } from './web3.service';
import { environment } from '../../environments/environment';
import POLICY_MANAGER_ABI from '../../assets/abi/PolicyManager.json';

@Injectable({ providedIn: 'root' })
export class ContractService {
  private web3 = inject(Web3Service);

  private policyManager(): Contract {
    return new Contract(environment.policyManagerAddress, POLICY_MANAGER_ABI, this.web3.getSigner());
  }

  async buyPolicy(productId: number, coverageEth: string, lat: number, lng: number) {
    const tx = await this.policyManager()['buyPolicy'](productId, parseEther(coverageEth), lat, lng, {
      value: parseEther(coverageEth), // premium tính theo coverage × premiumRate
    });
    return tx.wait(); // chờ transaction được confirm trên chain
  }
}
```

Với kết nối qua QR (ví trên điện thoại, web mở trên máy tính), dùng thêm `@web3modal/ethers` hoặc `@walletconnect/ethereum-provider` — cả hai đều là thư viện JS thuần, không phụ thuộc React nên dùng được trong Angular; chỉ cần thay `BrowserProvider(eth)` bằng provider do WalletConnect trả về.

## 7. Lưu ý UX quan trọng khi thiết kế cho người dùng phổ thông (nông dân, ít rành công nghệ)

- **Giải thích rõ ràng, không dùng thuật ngữ** — thay vì "connect wallet", có thể ghi "Đăng nhập bằng ví điện tử của bạn".
- **Hướng dẫn từng bước có hình ảnh minh hoạ** ngay trong app lúc lần đầu mở, không giả định người dùng đã biết MetaMask là gì.
- **Cảnh báo rõ về seed phrase** — nhiều người dùng mới mất tài sản vì vô tình nhập seed phrase vào trang giả mạo (phishing). Nên có 1 màn hình cảnh báo cố định: *"Không ai (kể cả chúng tôi) có quyền hỏi 12 từ khôi phục của bạn"*.
- **Cân nhắc ví nhúng (Privy/Web3Auth)** nếu đối tượng người dùng thật sự là nông dân phổ thông — bước "viết 12 từ ra giấy" là rào cản rất lớn với người chưa từng dùng crypto, dễ khiến họ bỏ cuộc ngay từ bước đầu tiên.

---

## PHẦN E — LUỒNG PAYOUT: KHI SỰ KIỆN THỜI TIẾT XẢY RA, TIỀN VỀ NGƯỜI DÙNG NHƯ THẾ NÀO

### 1. Oracle phát hiện điều kiện đạt ngưỡng
Backend oracle định kỳ gọi API thời tiết, đẩy dữ liệu lên contract. Khi dữ liệu mới nhất cho thấy điều kiện đã đạt (VD: mưa dưới 50mm/30 ngày), điều kiện chỉ đơn giản là "đã đạt" trên chain, chờ được kích hoạt — không có gì tự chạy ngay lúc đó.

### 2. Ai gọi `checkAndPayout()`?
Contract không tự động chạy — phải có ai đó gửi transaction gọi hàm `checkAndPayout(policyId)` thì payout mới thực sự xảy ra.

| Cách | Hoạt động ra sao |
|---|---|
| **Backend tự gọi (đơn giản nhất cho demo)** | Cùng lúc với script đẩy dữ liệu oracle, backend luôn gọi kèm `checkAndPayout()` cho mọi policy đang active |
| **Chainlink Automation** (dịch vụ keeper tự động) | Đăng ký 1 "upkeep" — mạng lưới node Chainlink tự động gọi hàm định kỳ, không cần tự vận hành server 24/7 |
| **Permissionless (ai cũng gọi được)** | Hàm chỉ đọc dữ liệu oracle + trả đúng người, không có gì để lợi dụng — có thể thêm thưởng nhỏ (vài % phí gas) cho ai gọi trước, gọi là "keeper incentive" |

→ Gợi ý demo: dùng cách 1 (backend tự gọi), đơn giản nhất để chứng minh luồng hoạt động.

### 3. Tiền chuyển vào ví người dùng
`payOut()` trong `LiquidityPool` chuyển tiền trực tiếp vào địa chỉ ví của policyholder — ngay lập tức, không có bước trung gian, không cần người dùng làm gì thêm. Đây là ưu điểm cốt lõi so với bảo hiểm truyền thống (không cần nộp đơn khiếu nại, chờ xét duyệt).

### 4. Người dùng biết được đã nhận tiền bằng cách nào?
Blockchain không tự thông báo cho ai — cần thiết kế thêm:
- **Web app hiển thị trạng thái**: `Dashboard` đọc trực tiếp từ contract (`getPolicy(policyId)`) để hiện "Đã nhận bồi thường: X vào ngày Y".
- **Push notification / SMS / email**: backend lắng nghe event `PayoutTriggered`, gửi thông báo chủ động — quan trọng với nông dân vì họ không có thói quen tự mở app kiểm tra thường xuyên.
- **App ví tự hiện số dư tăng lên** khi người dùng mở ví — không cần qua web app mới thấy được.

### 5. Người dùng dùng số tiền đó thế nào?

| Cách | Phù hợp với |
|---|---|
| Giữ nguyên crypto, dùng cho giao dịch on-chain khác | Người dùng đã quen crypto |
| **Off-ramp qua sàn** (Binance, sàn nội địa) — bán lấy VND, rút về ngân hàng | Phổ biến nhất, cần thêm bước KYC ở sàn |
| **Payout bằng stablecoin** (USDT/USDC thay vì ETH) | Giảm rủi ro biến động giá — số tiền bồi thường không bị trồi sụt theo giá ETH trong lúc chờ rút |
| **Tích hợp on/off-ramp ngay trong web app** (MoonPay, Transak) | Trải nghiệm mượt nhất — bấm "Rút về ngân hàng" ngay trong app |

→ **Khuyến nghị: payout bằng stablecoin (USDT/USDC)** thay vì ETH thô — vừa ổn định giá trị, vừa dễ giải thích với người dùng ("nhận 500 USDT ≈ 12 triệu đồng") hơn là giải thích biến động giá ETH.

### Tóm tắt chuỗi payout

```
Oracle phát hiện đạt ngưỡng
        │
        ▼
Backend/keeper tự động gọi checkAndPayout()
        │
        ▼
Contract chuyển stablecoin thẳng vào ví người dùng
        │
        ▼
Event PayoutTriggered được emit
        │
        ├──► Web app Dashboard cập nhật trạng thái
        └──► Backend gửi SMS/notification chủ động
        │
        ▼
Người dùng thấy tiền trong ví → rút ra qua sàn/on-off-ramp
   để dùng cho nhu cầu thực tế (mua giống mới, sửa chuồng trại...)
```

---

## PHẦN F — RÚT TIỀN THẬT: TESTNET VS MAINNET, VÀ LƯU Ý PHÁP LÝ VIỆT NAM

### 1. Giai đoạn demo/đồ án (Sepolia testnet) — không rút được, và không cần rút
- Sepolia ETH là tiền giả lập, phát miễn phí từ faucet để dev test, **không có giá trị quy đổi ra VND**.
- Không sàn giao dịch nào (Binance, Remitano...) cho phép bán Sepolia ETH lấy tiền thật.
- Với đồ án/khoá luận, không cần giải quyết bước rút tiền thật — chỉ cần chứng minh luồng: policy → oracle phát hiện điều kiện → `payOut()` chuyển Sepolia ETH vào ví nông dân → thấy số dư tăng trong app ví (MetaMask) là đủ hoàn chỉnh về kỹ thuật.
- **Cách trình bày trong báo cáo**: *"Ở phạm vi đồ án, hệ thống dừng ở bước chuyển tiền vào ví testnet. Bước off-ramp ra tiền thật là quy trình chuẩn của ngành, nằm ngoài phạm vi triển khai của đồ án."*

### 2. Giai đoạn sản phẩm thật (mainnet, tiền thật)

Từ 1/1/2026, việc này nằm trong khung pháp lý của **Luật Công nghiệp Công nghệ số 2025**: tài sản số được công nhận hợp pháp cho mục đích **đầu tư/trao đổi**, nhưng **không được dùng làm phương tiện thanh toán trực tiếp** — nông dân không thể "trả tiền ETH" trực tiếp cho người bán phân bón, phải quy đổi qua kênh hợp pháp trước.

```
Ví nông dân (ETH/USDT thật trên mainnet)
        │
        ▼
Chuyển lên sàn giao dịch có phép (Binance, hoặc sàn nội địa
được cấp phép Sandbox theo luật mới)
        │
        ▼
Bán qua P2P Trading — người mua chuyển khoản VND
thẳng vào tài khoản ngân hàng nông dân (VCB, MB...)
        │
        ▼
Bắt buộc KYC (CCCD, đôi khi xác minh khuôn mặt) trước khi giao dịch
        │
        ▼
Lợi nhuận từ giao dịch dự kiến chịu thuế TNCN tương tự
chuyển nhượng chứng khoán (mức thuế cụ thể — VD 0.1%/giao dịch —
là mức dự kiến theo tương tự chứng khoán, cần theo dõi văn bản
hướng dẫn chi tiết vì chưa hoàn toàn chốt)
```

### 3. Khó khăn thực tế với đối tượng nông dân
Thao tác sàn P2P là rào cản lớn với người ít rành công nghệ — thực tế cần thêm 1 lớp trung gian hỗ trợ:
- Hợp tác với đại lý/hợp tác xã địa phương đứng ra làm off-ramp hộ nhiều nông dân cùng lúc.
- Dùng dịch vụ tích hợp sẵn on/off-ramp (MoonPay, Transak) ngay trong app để giảm thao tác thủ công.

### 4. Điểm mấu chốt cần nhớ
Ranh giới rõ ràng giữa 2 phần:
- **On-chain (phần bạn code)**: 100% tự động, từ contract → ví người dùng — đúng giá trị cốt lõi của đề tài.
- **Off-ramp (ví → ngân hàng)**: không tự động hoá 100% được, luôn cần 1 bên có giấy phép đứng giữa (sàn, payment provider) và luôn yêu cầu KYC theo luật — đây là ranh giới pháp lý, không phải lựa chọn thiết kế của bạn.

Nếu được hỏi trong buổi bảo vệ đồ án "vậy tiền thật thì sao", trả lời đúng luồng trên cho thấy hiểu rõ ranh giới giữa phần tự code và phần thuộc hạ tầng tài chính có sẵn của ngành — không cần tự code phần rút tiền.
