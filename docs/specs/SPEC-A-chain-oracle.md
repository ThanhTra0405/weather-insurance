# SPEC-A — Contract, Oracle, Backend tầng blockchain, Indexer, Deploy, Trang admin/LP

Đọc `SPEC-00-shared.md` trước (quy ước, config, schema, danh sách endpoint, mốc bàn giao).
Không viết test mới. Sau mỗi bước phải **chạy thử thủ công** (mục "Chạy thử" của từng ngày).

## Phạm vi sở hữu

| Khu vực | File |
|---|---|
| Contract | `blockchain/contracts/**`, `blockchain/interfaces/IWeatherOracle.sol` |
| Deploy/script | `blockchain/ignition/modules/*`, `blockchain/scripts/*`, `blockchain/hardhat.config.ts` |
| Backend chain | `backend/Services/**` (trừ Notification/Auth/Storage của B), `backend/Services/Chain/**` (mới) |
| Controller của A | `PoliciesController`, `ProductsController`, `FaucetController`, `AdminChainController`, `AdminPendingController`, `HealthController` |
| Frontend của A | `frontend/src/app/pages/admin-chain/**`, `frontend/src/app/pages/lp/**`, `frontend/src/assets/abi/*`, `frontend/src/environments/environment*.ts`, `contract.service.ts` |

**Không sửa:** `Program.cs` (B sở hữu, chỉ gọi `AddChainServices`), `EvidenceController`, `AdminReviewController`, `web3.service.ts`, `app.routes.ts` (B sở hữu).

---

## 1. Contract

### 1.1 Oracle theo `(regionId, perilType)`

`blockchain/interfaces/IWeatherOracle.sol`
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IWeatherOracle {
    function getWeatherData(bytes32 regionId, uint8 perilType)
        external view returns (uint256 value, uint256 timestamp);
}
```

`contracts/oracle/SelfHostedOracle.sol`
- `mapping(bytes32 => mapping(uint8 => Data)) private data;`
- `submitWeatherData(bytes32 regionId, uint8 perilType, uint256 value, uint256 timestamp) external onlyBackend` — `require(perilType <= 2, "peril khong hop le")`.
- `event WeatherDataSubmitted(bytes32 indexed regionId, uint8 indexed perilType, uint256 value, uint256 timestamp);`
- `getWeatherData(bytes32 regionId, uint8 perilType) external view returns (uint256, uint256)`.
- Giữ `setBackendSigner`, `backendSigner`.

`contracts/oracle/MockWeatherOracle.sol`: `setWeatherData(bytes32 regionId, uint8 perilType, uint256 value, uint256 timestamp)` và `getWeatherData(regionId, perilType)`.

### 1.2 `PayoutEngine.sol`

- Thêm `uint256 public constant DROUGHT_WINDOW = 30 days;`
- `isThresholdMet(policyId)`:
```solidity
PolicyManager.Policy memory pol = policyManager.getPolicy(policyId);
(, , uint8 perilType, uint256 threshold, , , , ) = policyManager.products(pol.productId);

(uint256 value, uint256 ts) = oracle.getWeatherData(pol.regionId, perilType);
if (ts < pol.startTime) return false;              // dữ liệu trước hiệu lực không tính
if (perilType == 0) {
    // Hạn hán: value là tổng mưa 30 ngày kết thúc tại ts → cửa sổ phải nằm hoàn toàn trong thời gian có hiệu lực
    if (ts < pol.startTime + DROUGHT_WINDOW) return false;
    return value < threshold;
}
return value > threshold;                           // lũ, gió
```
- `checkAndPayout`: lấy `perilType` từ product, gọi `oracle.getWeatherData(pol.regionId, perilType)` cho `require(ts >= pol.startTime, ...)`, sau đó `require(isThresholdMet(policyId))`. Giữ nguyên phần còn lại (payOut → markPaidOut → event).

### 1.3 `PolicyManager.sol`

- `createPolicyProduct`: nếu `perilType == 0` thì `require(durationDays >= 30, "han han can it nhat 30 ngay")`.
- Không đổi struct `Policy`/`PolicyProduct`, không đổi thứ tự field (backend và frontend decode theo thứ tự này).

### 1.4 `LiquidityPool.sol`

Đã kiểm tra lại: kịch bản "LP rút phần premium của policy chờ duyệt rồi `refundAndUnlock` revert" **không xảy ra**, vì luôn có `totalDeposited ≥ totalLocked` và `locked(coverage) > refund(premium)`. **Không cần sửa logic.**

Việc nhỏ: bỏ `whenNotPaused` khỏi `refundAndUnlock` để hoàn tiền (từ `expirePolicy` hồ sơ chưa duyệt) vẫn chạy khi pool đang pause — giống `unlockCoverage`. `verifyPolicy` vẫn `whenNotPaused` nên không mở lỗ hổng.

### 1.5 Việc theo sau khi đổi contract

1. `npx hardhat compile` sạch.
2. Sửa `test/helpers/weather.ts`, `test/SelfHostedOracle.test.ts`, `test/PayoutEngine.test.ts`, `test/integration/FullFlow.test.ts` chỉ vừa đủ để **hết lỗi compile** (thêm tham số `perilType`). Giới hạn 30 phút; nếu không kịp thì bỏ qua, không chặn tiến độ. Không viết test mới.
3. `scripts/simulateWeatherEvent.ts`: nhận `--peril 0|1|2` và `--value` (đơn vị người dùng, tự ×100).
4. Copy ABI từ `blockchain/artifacts` sang `frontend/src/assets/abi/` cho: PolicyManager, LiquidityPool, PayoutEngine, SelfHostedOracle (đủ `sharesOf`, `totalShares`, `getPoolStats`, `nextProductId`, `products`, `evidenceOf`, `expirePolicy`, `submitVerificationEvidence`). Đồng bộ ABI chuỗi JSON nhúng trong `OracleSubmitter`, `PolicyManagerClient`, `PayoutEngineClient` (xem mục 3).

---

## 2. Deploy

### 2.1 Module Ignition

Đọc `ignition/modules/DeployAll.ts` và `DeploySelfHosted.ts` rồi sửa `DeploySelfHosted.ts` (module dùng cho Sepolia):
- Bỏ địa chỉ hard-code `0x7099…79c8` (account #1 của Hardhat, key công khai).
- `backendSigner = m.getAccount(0)` (deployer chính là key operator).
- Sau khi nối các contract, gọi `PolicyManager.setVerifier(m.getAccount(0))` (owner vẫn qua `onlyVerifier`, nhưng gọi để trạng thái tường minh và hiện được trên trang System).
- Trả về đủ future để đọc địa chỉ: policyManager, liquidityPool, payoutEngine, selfHostedOracle.
- Lệnh deploy theo đúng cú pháp của phiên bản Hardhat trong `package.json`, kèm `--verify` để verify Etherscan.

`.env` (không commit): `SEPOLIA_RPC_URL`, `SEPOLIA_PRIVATE_KEY` (= key operator mới sinh), `ETHERSCAN_API_KEY`. Kiểm tra `.gitignore` có `.env`. Dùng Alchemy (RPC công cộng giới hạn `getLogs` rất chặt; Alchemy Free tối đa 10 block mỗi lần `getLogs`, Pay As You Go tối đa 10000 trên Sepolia). Tạo **hai key**: một cho backend/hardhat (bí mật), một cho frontend (công khai, bật Allowlist domain).

### 2.2 Script seed `blockchain/scripts/seedSepolia.ts`

Đọc địa chỉ từ `ignition/deployments/chain-<id>/deployed_addresses.json`, rồi:
1. `PolicyManager.setCoolingOffPeriod(60)` (60 giây cho demo; ghi chú trong báo cáo là cấu hình demo).
2. `LiquidityPool.provideLiquidity{value: 0.3 ether}`.
3. Tạo 3 sản phẩm (đơn vị threshold ×100):

| Tên | peril | threshold | Ý nghĩa | durationDays | premium | coverage |
|---|---|---|---|---|---|---|
| Bảo hiểm hạn hán | 0 | 15000 | < 150 mm / 30 ngày | 90 | 0.001 ETH | 0.01 ETH |
| Bảo hiểm lũ | 1 | 15000 | > 150 mm / 3 ngày | 90 | 0.001 ETH | 0.01 ETH |
| Bảo hiểm gió mạnh | 2 | 6000 | > 60 km/h | 90 | 0.001 ETH | 0.01 ETH |

4. In ra bảng địa chỉ để dán vào config.

### 2.3 Cấu hình 3 nơi sau khi deploy

1. Backend user-secrets / biến môi trường (mục 2 của SPEC-00).
2. `frontend/src/environments/environment.ts` → **local** (chainId 31337, địa chỉ Hardhat, `devFaucet: true`, `backendUrl: http://localhost:5083`).
3. `frontend/src/environments/environment.prod.ts` → **Sepolia** (chainId 11155111, `rpcUrl` = URL Alchemy của **key frontend**, địa chỉ Sepolia, `devFaucet: false`, `faucetUrl: ${backendUrl}/api/faucet`, `backendUrl` = URL production, `explorerTxBase`).

(Hiện `environment.ts` đang lẫn chainId Sepolia với RPC 127.0.0.1, phải tách đúng như trên.)

---

## 3. Backend tầng blockchain

### 3.1 Dùng chung 1 `Web3` và khoá nonce (sửa lỗi tiềm ẩn)

Hiện `OracleSubmitter`, `PolicyManagerClient`, `PayoutEngineClient` mỗi class tạo `Web3` riêng cùng một key → khi worker, review API và admin API gửi tx cùng lúc sẽ **trùng nonce**.

Tạo `Services/Chain/ChainContext.cs`:
```csharp
public interface IChainContext
{
    Web3 Web3 { get; }
    string OperatorAddress { get; }
    SemaphoreSlim TxLock { get; }     // mọi tx của operator phải giữ khoá này khi gửi
    long ChainId { get; }
}
```
- `new Account(Blockchain:OperatorPrivateKey, chainId)` (truyền `chainId` để ký đúng EIP-155).
- `account.NonceService = new InMemoryNonceService(account.Address, web3.Client)`.
- Singleton. Các client lấy `Web3` từ đây, bọc phần gửi tx bằng `await TxLock.WaitAsync()`; ưu tiên `SendTransactionAndWaitForReceiptAsync` cho tx quan trọng (verify, payout, expire, admin), bỏ `gas` hard-code cho tx admin (để Nethereum estimate), giữ trần nếu cần.
- Faucet dùng `Web3` riêng với `Faucet:PrivateKey` (key khác, không đụng nonce operator).

Đọc cấu hình: dùng `Blockchain:OperatorPrivateKey`. Xoá fallback `OracleBackendPrivateKey` / `VerifierPrivateKey`.

### 3.2 `AddChainServices` (làm **đầu tiên**, trước 12h ngày 1)

Tạo `Services/Chain/ChainServiceCollectionExtensions.cs`:
```csharp
public static IServiceCollection AddChainServices(this IServiceCollection s, IConfiguration c)
```
Chuyển vào đây toàn bộ đăng ký chain hiện có trong `Program.cs`: `IWeatherService`(HttpClient), `INearestStationService`, `IRegionService`, `IOracleSubmitter`, `IPolicyManagerClient`, `IPayoutEngineClient`, `OracleWorker`, `StationRepository`. Push ngay để B gọi trong `Program.cs`. Các đăng ký mới (mục 3.x) thêm tiếp vào đây.

### 3.3 `WeatherService`

Thay `IWeatherService.GetRainfallLast30DaysAsync` bằng:
```csharp
public record WeatherSnapshot(decimal? Rain30dMm, decimal? Rain3dMm, decimal? WindGustMax3dKmh, long Timestamp);
Task<WeatherSnapshot> GetWeatherAsync(decimal lat, decimal lng, CancellationToken ct = default);
```
- URL: `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&daily=precipitation_sum,wind_gusts_10m_max&past_days=29&forecast_days=1&timezone=Asia%2FBangkok` (30 phần tử, cuối là hôm nay). Dùng `CultureInfo.InvariantCulture`.
- `Rain30dMm` = tổng 30 phần tử `precipitation_sum` (bỏ `null`); `Rain3dMm` = tổng 3 phần tử cuối; `WindGustMax3dKmh` = max 3 phần tử cuối của `wind_gusts_10m_max`. Nếu toàn `null` → trả `null` cho peril đó (worker bỏ qua, không gửi).
- `HttpClient.Timeout = 15s`, thử lại tối đa 2 lần (chờ 2s, 5s) khi 5xx/timeout.
- Xoá `WeatherPoint` nếu không còn dùng (hoặc giữ cho tương thích).

`IRegionService`: thêm `(decimal lat, decimal lng) GetRegionCenter(decimal lat, decimal lng)` trả toạ độ đã làm tròn lưới 0.2° (cùng công thức `ComputeRegionId`). Worker gọi thời tiết theo **tâm vùng**, không theo toạ độ policy đầu tiên, để mọi policy cùng vùng dùng chung một giá trị.

### 3.4 `OracleSubmitter`

```csharp
Task<string> SubmitWeatherDataAsync(string regionId, byte perilType, BigInteger valueScaled, long timestamp, CancellationToken ct = default);
```
- ABI mới: `submitWeatherData(bytes32,uint8,uint256,uint256)`.
- `valueScaled = (BigInteger)Math.Round(value * 100, 0, MidpointRounding.AwayFromZero)` — làm ở worker, không dùng `new BigInteger(decimal)` (cắt thập phân).

### 3.5 `PolicyManagerClient` / `PayoutEngineClient`

`IPolicyManagerClient` thêm:
```csharp
Task<ulong> GetNextPolicyIdAsync(CancellationToken ct = default);
Task<ulong> GetNextProductIdAsync(CancellationToken ct = default);
Task<PolicyOutputDTO> GetPolicyAsync(ulong policyId, CancellationToken ct = default);
Task<ProductDTO> GetProductAsync(ulong productId, CancellationToken ct = default);   // id, name, perilType, threshold, durationDays, premium, coverageAmount, active
Task<bool> HasEvidenceOnChainAsync(ulong policyId, CancellationToken ct = default);  // evidenceOf(policyId).submittedAt != 0
```
- **`GetPolicyAsync` và `HasEvidenceOnChainAsync` làm ngay ngày 1** (cùng lúc `AddChainServices`), vì `EvidenceController` và review API của B dùng từ ngày 1.
- `ProductDTO` decode `products(uint256)` (8 field theo thứ tự struct).
- `VerifyPolicyAsync` giữ nguyên chữ ký (B gọi từ review API) nhưng dùng `IChainContext` + `TxLock` + chờ receipt.
- Bỏ phụ thuộc `GetSnapshotAsync`/`GetPendingPoliciesAsync` trong worker (dùng DB). Có thể giữ để dùng làm công cụ đối chiếu.
- `IPayoutEngineClient`: ABI không đổi (`isThresholdMet`, `checkAndPayout` vẫn nhận `policyId`); chỉ chuyển sang `IChainContext`.

`IAdminChainClient` (mới, `Services/Chain/AdminChainClient.cs`), mọi hàm ghi đều qua `TxLock`:
```csharp
Task<string> CreateProductAsync(string name, byte peril, BigInteger threshold, int durationDays, BigInteger premiumWei, BigInteger coverageWei);
Task<string> SetProductActiveAsync(ulong productId, bool active);
Task<string> SetCoolingOffAsync(ulong seconds);
Task<string> PauseAsync(string target);     // policyManager | pool | payoutEngine
Task<string> UnpauseAsync(string target);
Task<PoolStatsDTO> GetPoolStatsAsync();     // poolBalance, deposited, locked, available
Task<SystemInfoDTO> GetSystemInfoAsync();   // owner, verifier, oracleSigner, coolingOff, paused x3, operatorBalanceWei, faucetBalanceWei
```

### 3.6 Chu trình oracle — `IOracleCycle` + `OracleWorker`

Tách logic `RunOnceAsync` hiện có thành `IOracleCycle` (scoped):
```csharp
Task<OracleCycleResult> RunAsync(bool refreshWeather = true, CancellationToken ct = default);
```
`OracleWorker` chỉ còn vòng lặp gọi `IOracleCycle.RunAsync()` mỗi `Blockchain:OracleIntervalMinutes`. Dùng `SemaphoreSlim` tĩnh để hai lần chạy không chồng nhau (admin bấm "chạy ngay" khi worker đang chạy → trả 409).

Các bước (đọc từ `policies_cache`, không duyệt chain):
1. **Cập nhật oracle** (bỏ qua nếu `refreshWeather=false`): lấy các policy `status = 1` và `end_time > now`, nhóm theo `(region_id, peril_type)`. Với mỗi `region_id` lấy tâm vùng → `GetWeatherAsync` **một lần** → với mỗi peril cần: peril 0 ← `Rain30dMm`, 1 ← `Rain3dMm`, 2 ← `WindGustMax3dKmh`. Giá trị `null` → bỏ qua và ghi `oracle_logs(status='error', error='khong co du lieu')`. Gửi `SubmitWeatherDataAsync(regionId, peril, valueScaled, nowUnix)`. Ghi `oracle_logs` cho mỗi lần gửi (ok/error, tx hash).
2. **Payout:** với mỗi policy `status = 1` chưa quá hạn → `IsThresholdMetAsync` → nếu đạt thì `CheckAndPayoutAsync`. Bắt exception từng policy, không dừng cả vòng.
3. **Expire:** policy có `status in (0,1)` và `end_time < now` → `ExpirePolicyAsync`.
4. Trả `OracleCycleResult { SubmittedCount, PayoutCount, ExpiredCount, Errors[], StartedAt, FinishedAt }` và lưu bản mới nhất trong memory cho trang Oracle.

Nếu `policies_cache` chưa có dữ liệu (indexer chưa chạy xong), chu trình ghi log cảnh báo và thoát, không lỗi.

### 3.7 `ChainIndexer` (BackgroundService)

Nhiệm vụ: đọc event từ chain → ghi `chain_events` → cập nhật `products_cache`, `policies_cache` → bắn thông báo.

Contract và event cần đọc (decode bằng ABI, không hard-code topic):

| Contract | Event |
|---|---|
| PolicyManager | `PolicyProductCreated`, `PolicyCreated`, `ProductStatusChanged`, `EvidenceSubmitted`, `PolicyVerified`, `PolicyExpired`, `PayoutMarked`, `CoolingOffPeriodSet`, `VerifierSet` |
| LiquidityPool | `LiquidityAdded`, `LiquidityWithdrawn`, `PolicyRefunded`, `CoverageUnlocked` |
| PayoutEngine | `PayoutTriggered(policyId, holder, amount)` |

(Không index `WeatherDataSubmitted` — khối lượng lớn, đã có `oracle_logs`.)

Chu kỳ mỗi `Indexer:PollSeconds`:
1. `latest = blockNumber - Indexer:Confirmations`; `from = indexer_state.last_block + 1` (nếu bảng rỗng: `Indexer:StartBlock`).
2. Duyệt từng khoảng `Indexer:BlockChunk` block. Gọi **một** `getLogs` với danh sách địa chỉ của 3 contract (không lọc topic, rồi decode theo ABI), sắp theo `(blockNumber, logIndex)`. **Alchemy Free chỉ cho 10 block mỗi lần `getLogs`** nên mặc định `Indexer:BlockChunk = 10`; khi đang backfill chạy liên tiếp không nghỉ, chỉ chờ `Indexer:PollSeconds` khi đã bắt kịp. Đặt `Indexer:StartBlock` đúng block deploy để backfill ngắn. Nếu nâng gói Pay As You Go thì tăng lên tối đa 10000.
3. Trong **một transaction DB**: `insert ... on conflict (tx_hash, log_index) do nothing` vào `chain_events` (kèm `block_time` lấy từ block, cache theo block); gom `policy_id`/`product_id` bị ảnh hưởng; **làm mới dòng cache bằng cách đọc lại từ chain** (`getPolicy`, `products`) thay vì vá tay; gán `created_tx`, `verified_tx`, `payout_tx`, `closed_tx`, `rejected` (từ `PolicyVerified(approved=false)` hoặc `PolicyExpired`) tương ứng; cập nhật `indexer_state.last_block`.
4. **Sau khi commit**, với các event vừa insert mới (không phải insert trùng) gọi `INotificationService.NotifyAsync` theo bảng:

| Event | `type` | Nội dung (tiếng Việt) |
|---|---|---|
| `EvidenceSubmitted` | `evidence_received` | "Đã nhận hồ sơ xác minh của policy #{id}. Chúng tôi sẽ duyệt sớm." |
| `PolicyVerified(approved=true)` | `policy_approved` | "Policy #{id} đã được duyệt, có hiệu lực từ {startTime}." |
| `PolicyVerified(approved=false)` | `policy_rejected` | "Hồ sơ policy #{id} bị từ chối. Lý do: {note từ review_logs mới nhất, nếu có}. Phí bảo hiểm đã được hoàn lại." |
| `PayoutTriggered` | `payout_sent` | "Bạn đã nhận bồi thường {amount} ETH cho policy #{id}." + link `App:ExplorerTxBase + txHash` |
| `PolicyExpired` | `policy_expired` | `refunded` ? "Policy #{id} hết hạn khi chưa được duyệt, phí đã hoàn lại." : "Policy #{id} đã hết hạn." |

   `link` của thông báo: `{App:PublicUrl}/policies/{id}`. Địa chỉ nhận = `holder` của policy (đọc từ `policies_cache`).
5. Lỗi RPC/DB: log, chờ chu kỳ sau, không crash (try/catch toàn vòng). Lần đầu chạy phải **backfill** từ `StartBlock` đến hiện tại mà không spam thông báo cũ: nếu `block_time` của event cũ hơn 10 phút thì **không** gọi `NotifyAsync`.

### 3.8 Controller của A

Tất cả trả lỗi dạng `{ "error": "..." }`. Dùng `[Authorize(Roles = "...")]` (JWT do B cấu hình ở `Program.cs`; trước khi B xong thì tạm bỏ attribute để chạy thử, nhưng **phải gắn lại trước khi merge**).

**`HealthController`** — `GET /health` → `200 { status: "ok", block, indexerLag }` (không auth; dùng cho keep-alive).

**`ProductsController`** — `GET /api/products` đọc `products_cache`. Trả `thresholdDisplay` đã định dạng: peril 0 `"{threshold/100} mm / 30 ngày"`, peril 1 `"{...} mm / 3 ngày"`, peril 2 `"{...} km/h"`.

**`PoliciesController`**
- `GET /api/policies/mine` (farmer): các dòng `policies_cache` có `holder = wallet` trong JWT, kèm `productName`.
- `GET /api/policies/{id}`: farmer chỉ xem policy của mình (403 nếu khác), admin/support xem tất cả. Trả đúng shape trong SPEC-00 mục 4.3. `timeline` dựng từ `chain_events` theo `policy_id` (map `PolicyCreated→created`, `EvidenceSubmitted→evidence`, `PolicyVerified→verified`, `PayoutTriggered→payout`, `PolicyExpired→expired`). `rejectReason` = `note` mới nhất trong `review_logs` nếu policy bị từ chối.

**`AdminPendingController`** — `GET /api/admin/pending-policies` (admin, support): policy `status = 0` từ `policies_cache`, join `farmer_profiles`, `evidence_meta` (để có `hasEvidence`, `evidenceSubmittedAt` từ `chain_events`). Shape theo SPEC-00 mục 4.3. (B xoá action cũ khỏi `AdminReviewController`; A không sửa file đó.)

**`FaucetController`** — `POST /api/faucet {address}` (farmer):
- `address` phải bằng ví trong JWT, nếu không 403.
- Cooldown `Faucet:CooldownHours` theo ví (tra `audit_logs` action `faucet`), và tối đa 5 lần/ngày theo IP (đếm trong memory). Vượt → 429 kèm thời điểm được nạp lại.
- Nếu số dư ví đã ≥ `AmountEth / 2` → 200 `{ skipped: true }`.
- Gửi `Faucet:AmountEth` từ `Faucet:PrivateKey`, chờ receipt, ghi `audit_logs`, trả `{ txHash, amountEth }`.
- Nếu ví faucet cạn → 503 `{ error: "Faucet tạm hết ETH" }`.

**`AdminChainController`** (admin):
- `GET /api/admin/stats`:
```json
{ "policies": { "total": 0, "pending": 0, "active": 0, "paidOut": 0, "closed": 0 },
  "pool": { "balanceWei": "", "depositedWei": "", "lockedWei": "", "availableWei": "" },
  "payouts": { "count": 0, "totalWei": "" },
  "tickets": { "open": 0, "inProgress": 0, "unassigned": 0 },
  "operatorBalanceWei": "", "faucetBalanceWei": "",
  "oracle": { "lastRunAt": null, "lastRunOk": true },
  "indexer": { "lastBlock": 0, "latestBlock": 0, "lag": 0 } }
```
  (`tickets` đọc bảng `tickets` do B tạo.)
- `GET /api/admin/pool` → `getPoolStats` + `sharesOf`, `totalShares` tổng hợp từ `chain_events` LP (số nhà đầu tư, tổng góp/rút).
- `POST /api/admin/system/pause|unpause` `{ "target": "policyManager|pool|payoutEngine|all" }` → trả danh sách `{ target, txHash }`; ghi `audit_logs`.
- `POST /api/admin/products` `{ name, perilType, threshold, durationDays, premiumEth, coverageEth }` — `threshold` theo **đơn vị người dùng** (mm hoặc km/h), server ×100. Validate: peril 0 ⇒ `durationDays ≥ 30`, `coverageEth > premiumEth`. Trả `{ txHash }`. Ghi `audit_logs`.
- `PATCH /api/admin/products/{id}/active` `{ active }`; `POST /api/admin/cooling-off` `{ seconds }` (0–7 ngày).
- `GET /api/admin/oracle-status`: mỗi `(regionId, perilType)` đang có policy active: `lastValueScaled`, `lastDataTs`, `ageMinutes`, `lastTxHash`, `lastStatus`, `activePolicies`; kèm `runner { lastRunAt, lastRunOk, intervalMinutes, lastResult }` và thông tin signer (`oracleSigner`, `operatorAddress`, `signerMatches`).
- `POST /api/admin/oracle/run-now?skipWeather=false` → chạy `IOracleCycle` ngay (409 nếu đang chạy). `skipWeather=true` chỉ chạy bước payout + expire.
- `POST /api/admin/oracle/simulate` `{ regionId | lat,lng, perilType, value }` — chỉ khi `Demo:EnableSimulate = true` (nếu không → 404). `value` đơn vị người dùng, server ×100, timestamp = hiện tại. Ghi `oracle_logs` + `audit_logs`. Ghi chú: lần chạy oracle định kỳ kế tiếp sẽ ghi đè bằng dữ liệu thật; khi demo gọi `simulate` rồi `run-now?skipWeather=true`.
- `GET /api/admin/payouts?page=` từ `chain_events` `PayoutTriggered` (policyId, holder, amountWei, txHash, time) + tổng.

---

## 4. Frontend của A

Dùng `ApiService` do B cung cấp (H2): `get<T>(path, params?)`, `post<T>(path, body?)`, `patch<T>`, `del<T>`; tự gắn `Authorization` và xử lý 401. Trước khi có `ApiService`, A viết với đúng chữ ký đó.

Style: Angular standalone component + `signal`, tiếng Việt, giống các trang hiện có.

### 4.1 `contract.service.ts`
Thêm: `listProducts()` (lặp `1..nextProductId-1` qua `products(id)`, hoặc gọi `/api/products`), `getPoolStats()`, `getMyShares(address)`, `getTotalShares()`, `provideLiquidity(ethAmount)`, `withdrawLiquidity(shares)`, `getEvidence(policyId)` (đã có, kiểm tra ABI mới), `expirePolicy(id)` nếu cần. Cập nhật theo ABI mới, bỏ fallback cũ.

### 4.2 Trang admin (`pages/admin-chain/`, export `ADMIN_CHAIN_ROUTES: Routes` trong `admin-chain.routes.ts`; B gắn vào `/admin` trong `app.routes.ts`)

| Route (con của `/admin`) | Component | Nội dung |
|---|---|---|
| `dashboard` | `AdminDashboard` | Thẻ số liệu: policy theo trạng thái, hồ sơ chờ duyệt (link `/admin/review`), pool (balance/locked/available), tổng payout, ticket mở/chưa gán, số dư operator và faucet (cảnh báo đỏ khi < 0.05 ETH), tình trạng oracle (lần chạy cuối), độ trễ indexer. Làm mới 30 giây |
| `products` | `AdminProducts` | Bảng sản phẩm (id, tên, peril, ngưỡng hiển thị, thời hạn, premium, coverage, trạng thái). Form tạo sản phẩm (validate như server). Nút bật/tắt. Ô đổi cooling-off |
| `system` | `AdminSystem` | Trạng thái pause của 3 contract + nút Pause/Unpause từng cái và "tất cả" (có hộp xác nhận). Hiện owner, verifier, oracle signer, operator, số dư. Báo lỗi nếu `signerMatches = false` |
| `oracle` | `AdminOracle` | Bảng trạng thái oracle theo vùng/peril (giá trị đã chia 100, tuổi dữ liệu, tx → Etherscan, trạng thái). Nút "Chạy oracle ngay", nút "Chỉ chạy payout/expire". Khối **Giả lập thời tiết** (chỉ hiện khi API không trả 404): chọn vùng/toạ độ, peril, giá trị |
| `payouts` | `AdminPayouts` | Bảng lịch sử payout có phân trang + tổng, link tx Etherscan |

### 4.3 Trang LP (`pages/lp/lp.ts`, class `LiquidityPage`, route `/lp`, B đăng ký route)
- Hiển thị `getPoolStats` (balance, deposited, locked, available), số share của ví hiện tại và giá trị ước tính (`shares * deposited / totalShares`).
- Form góp vốn (ETH) → `provideLiquidity`; form rút (nhập số share hoặc nút 25/50/75/100%) → `withdrawLiquidity`. Báo lỗi dễ hiểu khi vượt vốn khả dụng ("Vượt vốn khả dụng, phần còn lại đang bị khoá cho policy").
- Lịch sử góp/rút của ví từ `chain_events` hoặc đọc event; hiển thị trạng thái giao dịch.

### 4.4 Việc chung
- Sửa `environment.ts` / `environment.prod.ts` như mục 2.3, thêm `explorerTxBase`. B chỉ được sửa 1 dòng mỗi lần (pull trước).
- Mọi link tx dùng `explorerTxBase + hash`.

---

## 5. Triển khai backend production

1. Thêm `backend/Dockerfile` (multi-stage: `mcr.microsoft.com/dotnet/sdk:10.0` build → `mcr.microsoft.com/dotnet/aspnet:10.0` runtime). `ASPNETCORE_URLS=http://+:${PORT}`.
2. Host: Railway hoặc Render (web service, Docker). Cần **chạy liên tục** vì có `OracleWorker` và `ChainIndexer`; nếu dùng gói free có ngủ, đặt UptimeRobot ping `GET /health` mỗi 5 phút.
3. Biến môi trường: toàn bộ khoá ở SPEC-00 mục 2 (dùng dạng `Blockchain__RpcUrl`, `Cors__Origins__0`...). Đặt `Cors:Origins` gồm URL frontend production (hiện CORS chỉ cho `localhost:4200` → frontend deploy sẽ bị chặn).
4. Kiểm tra sau deploy: `/health` ok, log indexer đang tiến block, `oracle-status` có dữ liệu.

---

## 6. Kế hoạch theo ngày (A)

### Ngày 1 — Contract + nền
1. (đầu ngày, ~45 phút) `AddChainServices` + `IChainContext` + `GetPolicyAsync` + `HasEvidenceOnChainAsync` (kèm ABI `evidenceOf`), push cho B. Xin Sepolia ETH (operator ≥ 0.5, faucet ≥ 0.5, pool 0.3) **ngay từ sáng**.
2. Contract mục 1.1–1.4. Compile. Xử lý nhanh test cũ (1.5).
3. Sửa `DeployAll`/`DeploySelfHosted`, `simulateWeatherEvent.ts`, viết `seedSepolia.ts`.
4. **Chạy thử:** `hardhat node` → deploy local → seed → mua policy bằng script → set weather qua `simulateWeatherEvent.ts --peril 0/1/2` → `checkAndPayout`. Cả 3 peril phải payout; hạn hán chỉ payout khi `ts ≥ startTime + 30 ngày` (dùng `time.increase` hoặc `evm_increaseTime`).
5. Copy ABI, push, báo **mốc H2** cho B.

### Ngày 2 — Backend chain
0. `git pull` lấy migration của B rồi chạy backend (tự áp dụng migration khi `Database:AutoMigrate=true`) hoặc `dotnet ef database update` để có đủ bảng trên Supabase. **A không tự tạo migration**; cần đổi schema thì nhờ B.
1. `WeatherService`, `RegionService.GetRegionCenter`, `OracleSubmitter`, `PolicyManagerClient`/`PayoutEngineClient` theo ABI mới, `AdminChainClient`.
2. `ChainIndexer` + stub `INotificationService` (dùng thật khi B xong).
3. `IOracleCycle` + `OracleWorker`.
4. Controller: Health, Products, Policies, AdminPending, Faucet, AdminChain.
5. **Chạy thử:** `dotnet run` + Hardhat local + Supabase: mua policy (script) → bảng `policies_cache`/`chain_events` có dòng; chạy `run-now` → `oracle_logs` có dòng; `simulate` + `run-now?skipWeather=true` → payout; faucet nạp ví mới; mỗi endpoint admin trả đúng JSON.
6. Báo **mốc H3**.

### Ngày 3 — Sepolia + giao diện admin/LP
1. (sáng sớm) Deploy Sepolia (key operator mới), verify Etherscan, `seedSepolia.ts`, ghi địa chỉ vào 3 nơi (mục 2.3). Báo **mốc H4**.
2. Deploy backend (mục 5), bật `Demo:EnableSimulate=true`.
3. Frontend: `contract.service.ts`, 5 trang admin, trang LP.
4. **Chạy thử:** toàn bộ checklist E2E (SPEC-00 mục 6) cùng B. Sửa lỗi phát sinh trên Sepolia (gas, nonce, RPC giới hạn `getLogs`, timing).

---

## 7. Tiêu chí hoàn thành của A

- [ ] `npx hardhat compile` sạch; deploy local và Sepolia chạy bằng đúng một lệnh; Etherscan đã verify.
- [ ] Không còn key/địa chỉ cũ trong `appsettings*.json`, `DeploySelfHosted.ts`; không commit `.env`.
- [ ] Cả 3 peril payout đúng; hạn hán không payout trước `startTime + 30 ngày`.
- [ ] Không còn nonce trùng khi worker, review, admin gửi tx đồng thời.
- [ ] `policies_cache` luôn khớp chain (đối chiếu 3 policy ngẫu nhiên); backfill không spam thông báo cũ.
- [ ] Tất cả endpoint trong SPEC-00 mục 4.2 do A phụ trách trả đúng JSON và đúng mã lỗi/role.
- [ ] Trang dashboard, products, system, oracle, payouts, LP hoạt động trên Sepolia.
- [ ] Backend production chạy 24/7, CORS đúng, `/health` ok.
