# Kế hoạch triển khai 5 tuần — Hệ thống Bảo hiểm Thời tiết Phi tập trung

> Chia việc theo tuần, mỗi tuần có mục tiêu rõ ràng + checklist chức năng cần hoàn thành. Áp dụng được cho cá nhân làm tuần tự, hoặc nhóm 2–3 người chia vai trò song song (ghi chú ở cuối mỗi tuần).

---

## Tổng quan lộ trình

| Tuần | Trọng tâm | Kết quả cuối tuần |
|---|---|---|
| 1 | Setup dự án + contract lõi (PolicyManager, LiquidityPool) | Tạo được policy, góp được vốn — compile & test pass |
| 2 | PayoutEngine + Oracle (mock) + test đầy đủ | Chạy được toàn bộ luồng local: mua → oracle báo → tự động payout |
| 3 | Cơ chế xác minh (isVerified) + oracle tự vận hành (self-hosted) | Có luồng xác minh hồ sơ + oracle thật lấy dữ liệu Open-Meteo |
| 4 | Frontend (Angular): kết nối ví, GPS, form mua policy, dashboard | Web app Angular chạy được trên điện thoại, gọi contract thật qua testnet |
| 5 | Deploy Sepolia, test tích hợp, polish, viết báo cáo | Demo hoàn chỉnh trên testnet + tài liệu nộp |

---

## TUẦN 1 — Setup dự án + Contract lõi

### Mục tiêu
Dựng khung Hardhat, viết xong `PolicyManager.sol` và `LiquidityPool.sol` ở mức cơ bản (chưa cần xác minh/oracle), test được các hàm chính.

### Việc cần làm
- [ ] `npm init`, cài Hardhat + hardhat-toolbox (bản TypeScript), cấu hình `hardhat.config.ts`
- [ ] Viết `LiquidityPool.sol`: `provideLiquidity()`, `withdrawLiquidity()`, `getPoolBalance()`
- [ ] Viết `PolicyManager.sol` (bản đơn giản): `createPolicyProduct()`, `buyPolicy()`, `getPolicy()`
        - [ ] **Validate toạ độ** trong `buyPolicy()`/`createPolicyProduct()` — chặn lat/lng nằm ngoài phạm vi hợp lệ (VD: bounding box lãnh thổ Việt Nam)
        - [ ] **Solvency check**: `buyPolicy()` từ chối nếu `coverageAmount` vượt quá vốn khả dụng còn lại của `LiquidityPool` (tránh bán vượt khả năng chi trả)
- [ ] Viết `IWeatherOracle.sol` interface (chưa cần implement, chỉ định nghĩa)
- [ ] **`pause()` / `unpause()`** trên `PolicyManager` và `LiquidityPool` — owner tạm dừng khẩn cấp
- [ ] Emit đầy đủ **event** cho mọi hành động ghi state: `PolicyCreated`, `LiquidityAdded`, `LiquidityWithdrawn`
- [ ] Test cơ bản: LP góp vốn đúng số dư, mua policy trừ đúng premium, revert đúng khi vượt solvency/toạ độ sai/đang pause
- [ ] `npx hardhat compile` và `npx hardhat test` chạy sạch, không lỗi

### Nếu làm nhóm
- Người A: `LiquidityPool.sol` + test
- Người B: `PolicyManager.sol` + test
- Người C: setup project, viết `IWeatherOracle.sol`, chuẩn bị tài liệu tuần 1

---

## TUẦN 2 — PayoutEngine + Oracle giả lập + Test đầy đủ

### Mục tiêu
Có luồng end-to-end chạy được ở local: mua policy → giả lập oracle báo dữ liệu → tự động payout đúng người, đúng số tiền.
b 
### Việc cần làm
- [ ] Viết `MockWeatherOracle.sol` implement `IWeatherOracle`: `setWeatherData()`, `getWeatherData()`
- [ ] Viết `PayoutEngine.sol`: `checkAndPayout()`, `isThresholdMet()`
- [ ] Emit event `PayoutTriggered` khi payout thành công
- [ ] Nối quyền: `LiquidityPool.setPayoutEngine()` — chỉ `PayoutEngine` được rút tiền pool
- [ ] Viết `ignition/modules/DeployAll.ts` (Hardhat Ignition) deploy đủ 4 contract, nối địa chỉ với nhau — thay cho `scripts/deploy.js` truyền thống
- [ ] Viết `scripts/simulateWeatherEvent.ts` — giả lập oracle set dữ liệu đạt ngưỡng
- [ ] Test tích hợp (`test/integration/FullFlow.test.js`): mua → set weather → checkAndPayout → kiểm tra số dư ví tăng đúng
- [ ] Test các trường hợp lỗi: rút vượt pool, gọi payout khi chưa đạt ngưỡng, gọi 2 lần cho cùng policy

### Nếu làm nhóm
- Người A: `PayoutEngine.sol` + test
- Người B: `MockWeatherOracle.sol` + `scripts/simulateWeatherEvent.ts`
- Người C: `ignition/modules/DeployAll.ts` + test tích hợp `FullFlow.test.js`

---

## TUẦN 3 — Cơ chế xác minh + Oracle tự vận hành (self-hosted)

### Mục tiêu
Thêm luồng xác minh vị trí/danh tính trước khi policy có hiệu lực, và có 1 oracle thật (không còn set tay) lấy dữ liệu Open-Meteo.

### Việc cần làm
- [ ] Cập nhật `PolicyManager.sol`: thêm field `isVerified`, `fieldPhotoHash`, `documentHash` vào struct `Policy`
- [ ] Thêm hàm `submitVerificationEvidence()`, `verifyPolicy(policyId, approved)` (chỉ admin gọi)
- [ ] Nếu `approved = false`: **hoàn (refund) một phần/toàn bộ premium** cho người mua, đóng policy — công bằng nếu hồ sơ bị từ chối không do lỗi cố ý
- [ ] Emit event `PolicyVerified` (kèm kết quả duyệt/từ chối)
- [ ] Thêm **cooling-off period**: policy chỉ hiệu lực sau X giờ kể từ lúc mua
- [ ] Viết `SelfHostedOracle.sol`: nhận dữ liệu ký gửi từ 1 địa chỉ backend đã whitelist
- [ ] Backend (`backend/`, dự án .NET — `backend.csproj`): tạo `Services/WeatherService.cs` gọi Open-Meteo theo toạ độ policy
- [ ] Backend: `Services/OracleSubmitter.cs` — ký & gửi transaction cập nhật oracle bằng thư viện **Nethereum** (`Nethereum.Web3`), chạy qua `BackgroundService`/`IHostedService` (cron nội bộ) hoặc endpoint gọi tay khi demo
- [ ] Backend: `Services/NearestStationService.cs` — tính trạm/điểm dữ liệu gần nhất theo công thức haversine
- [ ] Cấu hình `appsettings.json`/`appsettings.Development.json`: RPC URL, private key oracle backend (qua `dotnet user-secrets`, không commit key thật), địa chỉ contract
- [ ] Test: policy chưa verify thì `checkAndPayout()` phải revert hoặc bỏ qua

### Nếu làm nhóm
- Người A: cập nhật `PolicyManager.sol` (verify + cooling-off) + test
- Người B: `SelfHostedOracle.sol` + backend `WeatherService.cs`/`OracleSubmitter.cs` (Nethereum)
- Người C: backend `NearestStationService.cs` + tài liệu luồng xác minh

---

## TUẦN 4 — Frontend (Angular): ví, GPS, form mua policy, dashboard

### Mục tiêu
Có web app Angular chạy được trên điện thoại thật, kết nối ví, lấy GPS, gọi được contract qua Sepolia (hoặc local trước, Sepolia sau nếu kịp).

### Việc cần làm
- [ ] Khởi tạo project `ng new frontend --routing --style=scss`, cài `ethers.js` (hoặc `web3.js`) + `@web3modal/ethers` (hoặc WalletConnect Web3Provider) qua npm
- [ ] Tạo `Web3Service` (Angular service, injectable) bọc quanh `ethers.BrowserProvider` — quản lý state kết nối ví bằng `signal`/`BehaviorSubject`, expose cho toàn app qua DI
- [ ] Component `ConnectWalletButton` — gọi `Web3Service.connect()`, kết nối MetaMask/Trust Wallet (cho người dùng đã có ví sẵn)
- [ ] **Tạo ví tự động cho nông dân**: đăng ký Privy App ID, tích hợp Privy Web SDK (`@privy-io/js-sdk-core` — không có gói React-only), đăng nhập bằng OTP số điện thoại → tự động sinh ví embedded, không cần biết seed phrase
- [ ] Cấu hình **gas sponsorship** (Privy Paymaster hoặc tương đương) để ví mới (số dư 0) vẫn thực hiện được giao dịch đầu tiên
- [ ] `ContractService`: bọc `ethers.Contract` cho `PolicyManager`/`LiquidityPool`, dùng ABI export từ Hardhat (`blockchain/artifacts` hoặc copy sang `frontend/src/assets/abi`)
- [ ] Trang/Component `BuyPolicyComponent`: `ReactiveFormsModule` chọn sản phẩm, lấy GPS (`navigator.geolocation`), chụp ảnh (`<input capture>`), gọi `ContractService.buyPolicy()`
- [ ] Trang/Component `DashboardComponent`: đọc `getActivePolicies()`, hiển thị trạng thái từng policy (chờ xác minh / active / đã payout)
- [ ] Cấu hình `environment.ts` / `environment.prod.ts`: RPC URL, contract address, chainId (Sepolia)
- [ ] Test trên điện thoại thật qua mạng LAN (`ng serve --host 0.0.0.0`) hoặc ngrok
- [ ] Xử lý lỗi UX cơ bản: chưa đăng nhập/kết nối ví, từ chối quyền GPS, mạng sai (không phải Sepolia) — dùng Angular `HttpInterceptor`/guard hoặc kiểm tra `chainId` trong `Web3Service`

### Nếu làm nhóm
- Người A: `Web3Service` + `ConnectWalletButton` (MetaMask/WalletConnect) + `ContractService`
- Người B: tích hợp Privy (đăng nhập OTP, tạo ví tự động, gas sponsorship) + `BuyPolicyComponent` (GPS + camera + gọi contract)
- Người C: `DashboardComponent` + xử lý lỗi UX + routing/guard

---

## TUẦN 5 — Deploy Sepolia, test tích hợp, polish, viết báo cáo

### Mục tiêu
Hệ thống chạy hoàn chỉnh trên Sepolia testnet, demo được từ đầu đến cuối, có tài liệu nộp.

### Việc cần làm
- [ ] Deploy toàn bộ contract lên Sepolia (`npx hardhat ignition deploy ignition/modules/DeployAll.ts --network sepolia`)
- [ ] Verify source code trên Etherscan (`npx hardhat verify`, Ignition có thể tự verify qua flag `--verify`)
- [ ] Build Angular (`ng build --configuration production`) và deploy frontend lên Vercel/Netlify/Firebase Hosting — có URL cố định
- [ ] Deploy backend .NET (oracle service) lên môi trường có thể chạy nền liên tục (VD: Render, Railway, Azure App Service) — cần chạy 24/7 để cron gọi oracle hoạt động khi demo
- [ ] Test lại toàn bộ luồng trên testnet thật: mua → verify → oracle backend chạy → payout tự động
- [ ] Sửa lỗi phát sinh khi chạy thật (khác local thường lộ ra vấn đề gas, timing, RPC)
- [ ] Viết README hoàn chỉnh: hướng dẫn cài đặt, chạy, giải thích kiến trúc
- [ ] Chuẩn bị slide/báo cáo: tổng hợp từ các file md đã có (kiến trúc, chức năng, giới hạn đã biết — parametric theo vùng cố định, xác minh 1 lần, off-ramp cần sàn trung gian...)
- [ ] Quay video demo ngắn (phòng khi buổi bảo vệ gặp sự cố mạng/testnet)

### Nếu làm nhóm
- Người A: deploy + verify contract, fix bug phát sinh trên testnet
- Người B: deploy frontend, quay video demo
- Người C: viết báo cáo/slide, tổng hợp tài liệu

---

## Nguyên tắc ưu tiên nếu thiếu thời gian

Nếu tới tuần 4–5 vẫn chưa xong hết, cắt theo thứ tự này (từ ít quan trọng nhất trước):

1. **Cắt trước**: frontend đẹp/UX polish, video demo dài
2. **Cắt tiếp nếu cần**: oracle tự động qua cron (chuyển về set tay qua script cho buổi demo)
3. **Không cắt** (đây là phần lõi chứng minh hiểu công nghệ): `PolicyManager`, `LiquidityPool`, `PayoutEngine` chạy đúng logic, có test pass, deploy được lên Sepolia thật

## Việc không cần làm (đã thống nhất từ các buổi trước — nhắc lại để khỏi mất thời gian)

- Không cần code phần rút tiền thật ra ngân hàng (VCB/TCB/MB) — chỉ cần hiểu và giải thích được luồng khi được hỏi.
- Không cần tích hợp Chainlink CRE thật — self-hosted oracle là đủ cho phạm vi đồ án.
- Không cần xác minh ảnh vệ tinh (NDVI) tự động — xác minh thủ công qua ảnh + giấy tờ là đủ.
