# SPEC-B — Supabase, Auth, Hồ sơ, Bằng chứng, CSKH, Thông báo, Frontend nông dân/CSKH

Đọc `SPEC-00-shared.md` trước (quy ước, config, **schema SQL**, danh sách endpoint, mốc bàn giao).
Không viết test mới. Sau mỗi bước phải **chạy thử thủ công** (mục "Chạy thử" từng ngày).

## Phạm vi sở hữu

| Khu vực | File |
|---|---|
| Hạ tầng backend | `backend/Program.cs`, `backend/Data/**` (DbContext, entity), `backend/Data/Migrations/**`, `backend/Options/**`, `backend/Auth/**` |
| Controller của B | `AuthController`, `ProfileController`, `EvidenceController` (viết lại), `AdminReviewController` (rút gọn), `TicketsController`, `SupportController`, `NotificationsController`, `AdminStaffController`, `AdminAuditController` |
| Service của B | `IEvidenceStorage`/`SupabaseEvidenceStorage`, `INotificationService`/`NotificationService`, `TelegramBotService`, `EmailSender`, `TicketAutoCloseService`, `IAuditLog`, `DatabaseInitializer` |
| Frontend của B | tất cả trong `frontend/src/app/**` **trừ** `pages/admin-chain/**`, `pages/lp/**`, `contract.service.ts`, `environments/*`, `assets/abi/*` (của A) |

**Không sửa:** `Services/**` chain của A (`OracleWorker`, `WeatherService`, `PolicyManagerClient`...), contract, `environment*.ts` (cần thêm key thì báo A, hoặc sửa đúng 1 dòng sau khi pull).

---

## 1. Supabase và dữ liệu

### 1.1 Thiết lập (đầu ngày 1)
1. Tạo project Supabase (nhớ Database Password, chọn region gần như Singapore). **Không cần chạy SQL tay và không cần tạo bucket tay**: bảng do EF migrations tạo, bucket do backend tự tạo.
2. Lấy: connection string (dùng **Session pooler**, port 5432, **không** dùng Transaction pooler 6543), `Supabase:Url`, `Supabase:ServiceRoleKey`. Cất vào user-secrets, **không commit**.
3. Cài công cụ một lần: `dotnet tool install --global dotnet-ef` (cùng major với .NET đang dùng).
4. Sau khi có `AppDbContext` + migration: chạy `dotnet ef database update` (hoặc chạy backend khi `Database:AutoMigrate=true`) để tạo bảng trên Supabase.
5. RLS bật cho mọi bảng và không có policy (làm trong migration `EnableRowLevelSecurity`): frontend không bao giờ gọi Supabase trực tiếp. Không đưa anon key vào frontend.

### 1.2 EF Core và migrations
Package: `Npgsql.EntityFrameworkCore.PostgreSQL`, `EFCore.NamingConventions` (`UseSnakeCaseNamingConvention()`), `Microsoft.EntityFrameworkCore.Design` (`PrivateAssets=all`), `BCrypt.Net-Next`, `Microsoft.AspNetCore.Authentication.JwtBearer`, `MailKit` — chọn phiên bản cùng major với .NET đang dùng.

- **Dùng EF Core migrations** (thư mục `backend/Data/Migrations`). Entity + Fluent API trong `AppDbContext` phải tái tạo đúng **mô hình ở SPEC-00 mục 3**:
  - `ToTable(...)` đúng tên bảng snake_case; khoá chính, khoá ngoại (`ticket_messages.ticket_id` cascade), chỉ mục và unique (`staff.email`, `chain_events (tx_hash, log_index)`, các chỉ mục còn lại trong SQL tham chiếu).
  - Ràng buộc `check` bằng `HasCheckConstraint` (`wallet_address = lower(wallet_address)`, các tập giá trị `role/category/status/priority/sender_type/status` của oracle_logs, `rating between 1 and 5`, `indexer_state.id = 1`, `farm_area_ha > 0`).
  - Giá trị mặc định: `HasDefaultValueSql("now()")` cho cột thời gian (kiểu `DateTimeOffset`, `timestamptz`), `gen_random_uuid()` cho `staff.id`, `false/'normal'/'open'` theo SQL; khoá `bigserial` dùng identity (`ValueGeneratedOnAdd`).
  - `numeric(78,0)` map sang `BigInteger` (`HasColumnType("numeric(78,0)")`); `jsonb` map sang `JsonDocument` (`HasColumnType("jsonb")`). Chọn cách này và dùng thống nhất (A cũng dùng).
- `AppDbContext` có `DbSet` cho **tất cả** bảng (cả bảng của A).
- Thêm `AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>` đọc cấu hình (`appsettings.json` + user-secrets + biến môi trường) để `dotnet ef` chạy được mà **không** chạy `Program.cs`.
- Migration: `dotnet ef migrations add InitialCreate -o Data/Migrations` (tất cả bảng) → **đọc lại file sinh ra và đối chiếu với SPEC-00 mục 3** (thiếu index/check thì sửa Fluent API rồi tạo lại, chưa push) → migration thứ hai `EnableRowLevelSecurity` (migration rỗng, dùng `migrationBuilder.Sql` bật RLS cho 15 bảng và `"__EFMigrationsHistory"`, `Down` tắt RLS) → `dotnet ef database update`.
- Quy tắc: không sửa migration đã push/áp dụng; thay đổi mới = migration mới; **chỉ B tạo migration**, `git pull` trước khi tạo; chạy qua Session pooler/kết nối trực tiếp.
- `DatabaseInitializer` (`IHostedService`, đăng ký **trước** các hosted service của A để bảng sẵn sàng): khi `Database:AutoMigrate = true` thì `Database.MigrateAsync()`, rồi `IEvidenceStorage.EnsureBucketAsync()` (lỗi chỉ log cảnh báo, không crash), rồi seed `staff` (mục 1.3). Nằm trong `StartAsync` và **được chờ xong** trước khi các service khác chạy.
- Đăng ký **`AddDbContextFactory<AppDbContext>`** và thêm scoped `AppDbContext` tạo từ factory. Lý do: indexer/worker của A là singleton hosted service, phải dùng `IDbContextFactory`.
- Helper `WalletAddress.Normalize(string)` (trim + lowercase + validate `0x` + 40 hex). Mọi nơi đọc/ghi ví đều đi qua hàm này.
- **Mốc H1 (trước 12h ngày 1):** push `AppDbContext` + entity đủ bảng + 2 migration và **đã áp dụng lên Supabase**.

### 1.3 `Program.cs` (B sở hữu)
Thứ tự: `UseForwardedHeaders` → `UseExceptionHandler` (trả `{ "error": "Lỗi máy chủ" }`, không lộ stack) → `UseCors` → `UseRateLimiter` → `UseAuthentication` → `UseAuthorization` → `MapControllers`.

- Gọi `builder.Services.AddChainServices(builder.Configuration)` (A cung cấp; nếu A chưa push thì tạo tạm file rỗng cùng chữ ký để build được, rồi bỏ khi pull).
- Thêm `AddAppServices(...)` của B (DB, JWT, storage, notification, hosted services).
- **Xoá**: `AdminApiKeyMiddleware`, `[AdminKey]`/`AdminKeyAttribute`, cấu hình `Admin:ApiKey`.
- CORS: `WithOrigins(Cors:Origins)` đọc từ config, `AllowAnyHeader().AllowAnyMethod()` (hiện chỉ cho `localhost:4200`).
- Rate limiter: `/api/auth/*` tối đa 20 request/phút/IP; `/api/evidence` 30/phút/IP.
- Trong container production, bỏ `UseHttpsRedirection` (TLS do host xử lý), bật `ForwardedHeaders`.
- Giữ `RequestSizeLimit(35_000_000)` cho upload bằng chứng.
- Đăng ký `DatabaseInitializer` (mục 1.2): sau khi migrate và tạo bucket, tạo admin và support từ `Seed:*` nếu `staff` chưa có (mật khẩu hash BCrypt, cost 11); thiếu cấu hình seed thì bỏ qua và log cảnh báo, không crash.

---

## 2. Xác thực và phân quyền

### 2.1 JWT
- HS256, khoá `Jwt:Secret`, `Jwt:Issuer`, `Jwt:Audience`, hết hạn `Jwt:ExpiryMinutes` (720).
- Claim: `sub` (ví lowercase với farmer, staff id với staff), `role` (`farmer|admin|support`), `wallet` (chỉ farmer), `name`.
- Extension `ClaimsPrincipal.GetWallet()`, `GetRole()`, `GetStaffId()` dùng chung (A cũng dùng).

### 2.2 Đăng ký và đăng nhập của nông dân (bằng chữ ký ví)

Không có mật khẩu. "Tài khoản" của nông dân = **một ví + một dòng `farmer_profiles`**. Đăng ký tạo dòng này; đăng nhập chỉ chấp nhận ví đã đăng ký. Lỗi nghiệp vụ trả `{ "error": "...", "code": "..." }` (thêm `fields` khi lỗi validate).

`GET /api/auth/nonce?address=0x..`
- Validate địa chỉ. Sinh nonce 16 byte hex. Upsert `auth_nonces` (hết hạn sau 5 phút).
- Trả `{ nonce, message, expiresAt }` với `message` **đúng định dạng** sau (server tự dựng lại khi verify, không tin message client gửi):
```
Weather Insurance - Dang nhap
Dia chi: {addressLowercase}
Nonce: {nonce}
Het han: {expiresAtIso8601Utc}
```

`POST /api/auth/register` `{ address, signature, profile }` — **đăng ký**
1. Lấy nonce còn hạn của ví, dựng lại message, `Nethereum.Signer.EthereumMessageSigner().EncodeUTF8AndEcRecover(message, signature)` rồi so với `address` (lowercase). Sai → 401 `INVALID_SIGNATURE`; nonce không có/hết hạn → 401 `NONCE_EXPIRED`.
2. Ví đã có `farmer_profiles` → **409** `ALREADY_REGISTERED` ("Ví này đã đăng ký, hãy đăng nhập").
3. Validate `profile` theo bảng ở mục 3 (đủ field bắt buộc). Sai → 400 `VALIDATION` kèm `fields: { phone: "Số điện thoại không hợp lệ", ... }`.
4. Insert `farmer_profiles`, **xoá nonce**, ghi `audit_logs` (`register`).
5. Trả `{ token, role: "farmer", wallet, profile, expiresAt }`.

`POST /api/auth/login` `{ address, signature }` — **đăng nhập**
1. Verify chữ ký như trên. Xoá nonce sau khi dùng (một lần).
2. Ví **chưa đăng ký** → **404** `NOT_REGISTERED` ("Ví này chưa đăng ký tài khoản") để UI chuyển sang đăng ký đúng ví đó.
3. Thành công → `{ token, role: "farmer", wallet, profile, expiresAt }` và ghi `audit_logs` (`login`).

Bảng mã lỗi: `INVALID_SIGNATURE` (401), `NONCE_EXPIRED` (401), `NOT_REGISTERED` (404), `ALREADY_REGISTERED` (409), `VALIDATION` (400), `RATE_LIMITED` (429).

Vì token chỉ cấp cho ví đã đăng ký, mọi JWT farmer luôn đi kèm hồ sơ hợp lệ (`profileGuard` ở frontend chỉ còn là lớp phòng thủ).

### 2.3 Đăng nhập nhân viên
`POST /api/auth/staff/login` `{ email, password }`
- BCrypt verify, kiểm `active`. Sai → 401 thông báo chung "Sai email hoặc mật khẩu".
- Chống dò: tối đa 5 lần sai / 15 phút theo (email + IP), vượt → 429 `RATE_LIMITED`. Ghi `audit_logs` cho đăng nhập thành công và thất bại (action `staff_login`, `staff_login_failed`).
- Trả `{ token, role, fullName, staffId, expiresAt }`.

`POST /api/auth/staff/change-password` `{ currentPassword, newPassword }` (admin, support): kiểm mật khẩu hiện tại, `newPassword` ≥ 10 ký tự và khác mật khẩu cũ; ghi `audit_logs` (`staff_change_password`).

Không có đăng ký công khai cho nhân viên: tài khoản do admin tạo ở `/admin/staff`; quên mật khẩu thì admin đặt lại.

`GET /api/auth/me` → `{ role, wallet?, staffId?, fullName?, profileComplete? }`.

### 2.4 Phân quyền
Dùng `[Authorize(Roles = "...")]` theo bảng ở SPEC-00 mục 4.2. Với endpoint "đúng chủ" (evidence, policy, ticket) kiểm tra thêm trong code và trả 403 nếu không phải chủ.

---

## 3. Hồ sơ nông dân

`GET /api/profile/me` → 200 `{ hasProfile: false }` nếu chưa có; ngược lại trả đủ field + `isComplete`.

`PUT /api/profile/me` (upsert) với validate:
| Field | Quy tắc |
|---|---|
| `fullName` | 2–100 ký tự |
| `phone` | `^(0\|\+84)\d{9,10}$` |
| `email` | tùy chọn, đúng định dạng |
| `province`, `district` | bắt buộc, ≤ 100 ký tự; `commune` tùy chọn |
| `cropType` | bắt buộc, ≤ 50 ký tự |
| `farmAreaHa` | 0.01–10000 |
| `farmLat`, `farmLng` | tùy chọn; nếu có phải nằm trong bounding box VN (dùng đúng hằng `MIN_LAT/MAX_LAT/MIN_LNG/MAX_LNG` trong `PolicyManager.sol`) |
| `notifyEmail`, `notifyTelegram` | boolean |

`isComplete` = có `fullName, phone, province, district, cropType, farmAreaHa`. Hồ sơ được **tạo lúc đăng ký** (`POST /api/auth/register`); `PUT /api/profile/me` dùng để **cập nhật** về sau, cùng bộ validate. Frontend vẫn giữ `profileGuard` làm lớp phòng thủ.

`POST /api/profile/telegram-link` → tạo mã 8 ký tự, hết hạn 15 phút, lưu vào `telegram_link_code`, `telegram_link_expires_at`; trả `{ code, deepLink: "https://t.me/{Telegram:BotUsername}?start={code}", expiresAt }`. Nếu chưa cấu hình `Telegram:BotToken` → 503 `{ error: "Chưa cấu hình Telegram" }`.

**`TelegramBotService`** (BackgroundService, long polling `getUpdates`, tắt nếu không có token): khi nhận `/start {CODE}` hợp lệ và chưa hết hạn → gán `telegram_chat_id`, `notify_telegram = true`, xoá mã, trả lời "Đã liên kết tài khoản. Bạn sẽ nhận thông báo bảo hiểm tại đây."; `/stop` → gỡ liên kết.

Không lưu CCCD hay giấy tờ tuỳ thân dạng số (đã chốt).

---

## 4. Bằng chứng xác minh (viết lại `EvidenceController`)

Bỏ hoàn toàn thư mục `EvidenceStore/` (ghi file ra đĩa sẽ mất khi redeploy). Thêm `.gitignore` cho thư mục đó.

### 4.1 `IEvidenceStorage` (Supabase Storage qua HttpClient)
```csharp
Task UploadAsync(string path, Stream data, string contentType, CancellationToken ct);   // POST /storage/v1/object/{bucket}/{path}, header x-upsert: true
Task<string> CreateSignedUrlAsync(string path, int expiresInSeconds, CancellationToken ct); // POST /storage/v1/object/sign/{bucket}/{path} → ghép {Supabase:Url}/storage/v1{signedURL}
Task DeleteAsync(string path, CancellationToken ct);
```
Header: `apikey` và `Authorization: Bearer {ServiceRoleKey}`. Đường dẫn `{policyId}/{kind}{ext}`.

### 4.2 `POST /api/evidence/{policyId}` (role farmer)
Multipart giữ nguyên form hiện tại: `holder`, `lat`, `lng`, `accuracy`, `selfie`, `field`, `document`.

Thứ tự kiểm tra (trả lỗi sớm):
1. Lấy policy on-chain bằng `IPolicyManagerClient.GetPolicyAsync` (A cung cấp ở ngày 1). Không tồn tại → 404.
2. `policy.Holder` (lowercase) phải bằng ví trong JWT, nếu không → **403**.
3. `status` phải là `0` (PendingVerification), nếu không → 409 "Policy không còn ở trạng thái chờ xác minh".
4. Nếu **on-chain đã có evidence** (`IPolicyManagerClient.HasEvidenceOnChainAsync`) hoặc `evidence_meta.locked` → **409** "Hồ sơ đã gửi lên blockchain, không thể thay thế". Khi phát hiện on-chain đã có thì đặt `locked = true`.
5. Mỗi ảnh: `0 < size ≤ 10MB`, `ContentType` bắt đầu `image/`, đuôi trong `.jpg .jpeg .png .webp .heic` (đuôi lạ → `.jpg`), kiểm tra magic bytes cơ bản. Sai → 400.
6. Đọc từng file vào `MemoryStream`; tính **SHA-256** (`0x` + hex) cho cả 3 ảnh.
7. Giữ nguyên logic EXIF hiện có trên ảnh `field` (MetadataExtractor, `GpsDirectory`, haversine so với `lat/lng` khai báo) nhưng đọc từ stream.
8. Upload 3 ảnh lên Storage (ghi đè được vì chưa khoá). Upsert `evidence_meta`.
9. Trả `{ policyId, selfieHash, fieldPhotoHash, documentHash, exifGpsPresent, distanceMeters }`.

### 4.3 Lấy hồ sơ
- `GET /api/evidence/{policyId}/meta` (admin, support, hoặc farmer đúng chủ): giữ nguyên tên field frontend đang dùng — `declaredLat, declaredLng, gpsAccuracy, exifGpsPresent, exifLat, exifLng, distanceMeters, fieldPhotoHash, documentHash` — và thêm `selfieHash, uploadedAt, locked`. 404 nếu chưa có.
- `GET /api/evidence/{policyId}/{kind}` (cùng quyền): trả JSON `{ url, expiresIn: 300 }` (signed URL), **không** trả file trực tiếp. `kind ∈ selfie|field|document`, khác → 400.

---

## 5. Duyệt hồ sơ (`AdminReviewController`, rút gọn)

Xoá `[AdminKey]` và action `pending-policies` (A chuyển sang `AdminPendingController`).

`POST /api/admin/review/{policyId}` `[Authorize(Roles="admin")]` body `{ approved, note }`:
1. Đọc policy on-chain: `status` phải là 0, nếu không → 409.
2. `approved = false` ⇒ `note` bắt buộc (≥ 5 ký tự, ≤ 500). `approved = true` ⇒ `note` tùy chọn.
3. Nếu **duyệt**: phải có `evidence_meta` **và** evidence on-chain, **và hash khớp** (`fieldPhotoHash`, `documentHash` on-chain = trong `evidence_meta`). Không khớp → 422 "Hash hồ sơ không khớp, không thể duyệt". (Kiểm tra phía server, không chỉ dựa vào UI.)
4. Ghi `review_logs` (`tx_hash = null`) **trước** khi gửi tx, để indexer (A) lấy được lý do khi bắn thông báo từ chối.
5. `VerifyPolicyAsync(policyId, approved)`. Thành công → cập nhật `tx_hash`. Thất bại → **xoá** dòng `review_logs` vừa tạo, trả 502 `{ error: "Gửi giao dịch thất bại: ..." }`.
6. Ghi `audit_logs` (action `review`, target `policy:{id}`, detail `{approved, note}`).
7. Trả `{ policyId, approved, txHash }`.

Review API **không** tự tạo thông báo (indexer của A tạo khi thấy event `PolicyVerified`).

---

## 6. CSKH — ticket

### 6.1 Quy tắc
| Việc | Quy tắc |
|---|---|
| Tạo ticket (farmer) | Phải có hồ sơ; `policyId` tùy chọn nhưng nếu có phải thuộc ví (kiểm `policies_cache.holder`); tối đa 10 ticket đang mở / ví; `category ∈ review_rejected, payout_missing, policy_info, technical, other`; `subject` 5–150 ký tự; `body` 1–4000 ký tự. Tạo ticket + tin nhắn đầu (`sender_type=farmer`) |
| Farmer xem | Chỉ ticket của mình, **không** thấy tin `is_internal = true` |
| Farmer trả lời | Ticket `closed` → 409. Nếu đang `waiting_customer` hoặc `resolved` → chuyển về `open` |
| Staff trả lời | Tin công khai ⇒ đổi trạng thái thành `waiting_customer` (nếu đang `open`/`in_progress`), nếu chưa gán thì tự gán cho người trả lời, **gửi thông báo** `ticket_reply` cho nông dân (link `/tickets/{id}`). Tin `isInternal=true` thì không thông báo |
| Staff đổi trạng thái / ưu tiên / người xử lý (`PATCH`) | Ghi một tin `sender_type=system` ("Trạng thái chuyển từ X sang Y bởi {tên}"); đổi trạng thái ⇒ thông báo `ticket_status` cho nông dân; `closed` ⇒ đặt `closed_at`. `support` chỉ tự gán cho mình; `admin` gán cho bất kỳ ai |
| Đánh giá | Chỉ farmer chủ ticket, khi ticket `resolved`/`closed` và chưa có rating; `rating` 1–5, `comment` ≤ 500 |
| Tự đóng | `TicketAutoCloseService` chạy mỗi giờ: ticket `resolved` không có hoạt động > 72 giờ → `closed` |

### 6.2 Endpoint
- `POST /api/tickets` `{ policyId?, category, subject, body }`.
- `GET /api/tickets` — farmer: ticket của mình. Staff: hàng đợi với query `status`, `assignedTo` (`me|unassigned|{id}`), `category`, `priority`, `q` (khớp subject, ví, policyId, số điện thoại), `page`, `pageSize ≤ 50`; sắp theo `updated_at desc`. Trả `{ items, total }`, mỗi item có `lastMessagePreview`, `lastSenderType`, `farmerName` (cho staff).
- `GET /api/tickets/{id}` — kèm danh sách tin (lọc `is_internal` với farmer), và với staff: tóm tắt hồ sơ nông dân (đã che dữ liệu theo mục 6.3) + tóm tắt policy liên quan (từ `policies_cache`).
- `POST /api/tickets/{id}/messages` `{ body, isInternal? }`.
- `PATCH /api/tickets/{id}` `{ status?, priority?, assignedTo? }` (staff).
- `POST /api/tickets/{id}/rating` `{ rating, comment? }`.
- `GET/POST/PUT/DELETE /api/support/canned-replies` (admin, support): `{ title, body }`; xoá: người tạo hoặc admin.

### 6.3 Tra cứu cho CSKH
`GET /api/support/lookup?q=` (admin, support). Nhận diện `q`:
- bắt đầu `0x` ⇒ ví; chỉ gồm 1–9 chữ số ⇒ `policyId`; bắt đầu `0` hoặc `+84` và 9–11 chữ số ⇒ số điện thoại; còn lại ⇒ tên (`ilike`).
- Trả tối đa 20 kết quả: `{ profile, policies[] (từ policies_cache + tên sản phẩm), evidenceSummary { hasEvidence, exifWarning }, openTickets }`.
- **Che dữ liệu với `support`**: email → `a***@domain`, số điện thoại → `09** *** 123`. `admin` thấy đầy đủ. (CSKH liên hệ nông dân qua ticket/thông báo, không cần số đầy đủ.)
- CSKH chỉ xem hồ sơ (qua signed URL ở mục 4.3), **không** có quyền duyệt.

---

## 7. Thông báo

### 7.1 `NotificationService` (Singleton, dùng `IDbContextFactory`; implement `INotificationService` ở SPEC-00 mục 4.1)
1. Insert `notifications` (`is_read=false`).
2. Fan-out không chặn luồng gọi (`Task.Run` + try/catch + log):
   - **Telegram:** nếu hồ sơ có `notify_telegram` và `telegram_chat_id` → `sendMessage` (parse mode HTML, escape ký tự), nội dung = title + body + link.
   - **Email:** nếu có `email` và `notify_email` → gửi SMTP bằng MailKit, template HTML tiếng Việt đơn giản (tiêu đề, nội dung, nút "Xem chi tiết").
   - Chưa cấu hình `Smtp:*` hoặc `Telegram:BotToken` → bỏ qua kênh đó, chỉ log một lần.
3. Chống trùng: nếu đã có thông báo cùng `wallet + type + link` trong 60 giây thì bỏ qua.

### 7.2 API (farmer)
- `GET /api/notifications?unreadOnly=&page=&pageSize=20` → `{ items, total, unread }`.
- `GET /api/notifications/unread-count` → `{ unread }`.
- `POST /api/notifications/{id}/read` (chỉ của chính ví) · `POST /api/notifications/read-all`.

---

## 8. Quản lý nhân viên và nhật ký

- `IAuditLog.WriteAsync(actorType, actorRef, action, target, detail)` — A cũng dùng được.
- `GET /api/admin/staff` · `POST /api/admin/staff` `{ email, fullName, role, password }` (mật khẩu ≥ 10 ký tự) · `PATCH /api/admin/staff/{id}` `{ fullName?, role?, active?, password? }`.
  - Không được vô hiệu hoá/hạ quyền **admin cuối cùng đang hoạt động**; không được tự đổi role của chính mình.
  - Mọi thay đổi ghi `audit_logs`.
- `GET /api/admin/audit?page&action&actor&from&to` → phân trang, mới nhất trước.

---

## 9. Frontend

Giữ phong cách hiện tại: Angular standalone + `signal`, ethers v6, tiếng Việt, responsive cho điện thoại.
**Mọi route cần ví/localStorage dùng `RenderMode.Client`** trong `app.routes.server.ts` (tránh lỗi SSR/prerender). Mọi truy cập `localStorage`/`sessionStorage` bọc bằng `isPlatformBrowser`.

### 9.1 Nền tảng (giao cho A ở mốc H2, cuối ngày 1)

**`services/api.service.ts`** (A dùng ngay):
```ts
get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T>
post<T>(path: string, body?: unknown): Promise<T>
put<T>(path: string, body?: unknown): Promise<T>
patch<T>(path: string, body?: unknown): Promise<T>
del<T>(path: string): Promise<T>
postForm<T>(path: string, form: FormData): Promise<T>
```
- Gốc URL `environment.backendUrl`. Tự gắn `Authorization: Bearer`.
- Lỗi: ném `ApiError { status, code?, message, fields? }`, `message` lấy từ `{ error }` của server.
- `401` (trừ các endpoint `/api/auth/*`) ⇒ `auth.handleExpired()`: xoá phiên và điều hướng `/login?returnUrl=` (nông dân) hoặc `/staff/login?returnUrl=` (nhân viên).

**`services/auth.service.ts`**
- Signal: `token`, `role` (`farmer|admin|support|null`), `wallet`, `fullName`, `isLoggedIn` (computed).
- Lưu phiên: JWT nông dân ở `localStorage['wi_jwt']`; JWT nhân viên ở `sessionStorage['wi_staff_jwt']` (đóng tab là thoát). Đăng nhập vai trò này xoá phiên vai trò kia. Kiểm `exp` khi đọc, hết hạn thì bỏ.
- `register(profile)`, `loginWithWallet()`, `loginStaff(email, password)`, `changeStaffPassword(...)`, `logout({ forgetWallet })`, `restore()`, `handleExpired()`.
- `restore()` lúc khởi động: có JWT hợp lệ → dùng; JWT hết hạn mà ví còn trên thiết bị và **không có cờ `wi_logged_out`** → tự ký lại im lặng (ví nằm trong máy, không cần hỏi); còn lại → chưa đăng nhập.
- Lắng nghe `storage` event để đồng bộ đăng xuất/đăng nhập giữa các tab.
- Hàm tiện ích `safeReturnUrl(url)`: chỉ chấp nhận đường dẫn nội bộ bắt đầu bằng `/` và không phải `//` hay có scheme; sai thì dùng trang mặc định.

**`guards/`**
- `farmerGuard`: không có JWT farmer ⇒ **chuyển `/login?returnUrl=<url hiện tại>`** (không tự đăng nhập ngầm). Có JWT nhưng thiếu `wallet` trong máy ⇒ `/login` kèm thông báo "Cần khôi phục ví trên thiết bị này".
- `staffGuard(...roles)`: không có JWT staff hoặc sai vai trò ⇒ `/staff/login?returnUrl=` (sai vai trò: trang 403).
- `guestGuard`: đã đăng nhập mà vào `/login`, `/register`, `/staff/login` ⇒ chuyển về trang chủ của vai trò đó.
- `profileGuard`: chưa `isComplete` ⇒ `/profile?returnUrl=`.
- `homeRedirect` cho route `''`: chưa đăng nhập → `/login`; farmer → `/dashboard`; admin → `/admin/review`; support → `/support`.

**`services/web3.service.ts`** (sửa):
- **Bỏ việc tự tạo ví khi mở trang.** `init()` chỉ nạp ví nếu `localStorage['wi_wallet_pk']` đã có; không có thì `address = null`. Bỏ `DISCONNECTED_KEY` (thay bằng cờ `wi_logged_out` ở `AuthService`).
- Hàm mới: `hasStoredWallet(): boolean`, `storedAddress(): string | null`, `createWallet(): { address, privateKey }` (tạo trong bộ nhớ, **chưa lưu**), `saveWallet(privateKey)` (lưu và nạp), `importPrivateKey(pk)` (validate bằng `new Wallet(pk)`, hỗ trợ cả định dạng file backup JSON `{ address, privateKey }`; có/không tiền tố `0x`), `exportPrivateKey()`, `forgetWallet()` (xoá key khỏi máy).
- `ensureGas()` là hàm public và **chỉ gọi sau khi đăng nhập/đăng ký thành công**. Local (`devFaucet`) dùng `hardhat_setBalance`. Sepolia: `POST {backendUrl}/api/faucet` kèm Bearer (A cung cấp; 429 ⇒ "Đã nhận ETH gần đây, thử lại sau X giờ"; 503 ⇒ "Faucet tạm hết ETH").

**Khung ứng dụng** (`app.html`/`app.ts`)
- Thay `ConnectWalletButton` bằng **`AccountMenu`**: chưa đăng nhập ⇒ hai nút "Đăng nhập" và "Đăng ký" (và liên kết nhỏ "Nhân viên"); đã đăng nhập ⇒ tên + địa chỉ rút gọn + số dư ETH, menu: Hồ sơ, Sao lưu ví, Đăng xuất (nhân viên: Tài khoản, Đăng xuất). Xoá `connect-wallet-button` nếu không còn dùng.
- Thanh điều hướng theo vai trò; chuông thông báo (chỉ farmer); vùng toast (`services/toast.service.ts`).
- Farmer: Tổng quan · Mua bảo hiểm · Hỗ trợ · Góp vốn (LP) · Hồ sơ · Ví. Chưa đăng nhập: chỉ hiện logo + Đăng nhập/Đăng ký.
- Staff: Hỗ trợ · (admin thêm) Quản trị.

**`app.routes.ts`** (B sở hữu):
```
''                     → homeRedirect
'login'                guestGuard            (nông dân đăng nhập)
'register'             guestGuard            (nông dân đăng ký)
'staff/login'          guestGuard
'staff/account'        staffGuard(admin,support)
'dashboard'            farmerGuard
'buy-policy'           farmerGuard + profileGuard
'policies/:id'         farmerGuard
'profile'              farmerGuard
'tickets'              farmerGuard
'tickets/new'          farmerGuard + profileGuard
'tickets/:id'          farmerGuard
'notifications'        farmerGuard
'wallet'               farmerGuard           (sao lưu ví)
'lp'                   → LiquidityPage của A (farmerGuard)
'support'              staffGuard(admin,support) — hàng đợi
'support/ticket/:id'   staffGuard(admin,support)
'support/lookup'       staffGuard(admin,support)
'support/canned'       staffGuard(admin,support)
'admin'                staffGuard(admin) — AdminShell, children:
     'review', 'staff', 'audit', ...ADMIN_CHAIN_ROUTES (A: dashboard, products, system, oracle, payouts)
'**'                   NotFound
```
Mọi route dùng `RenderMode.Client` trong `app.routes.server.ts`; mọi truy cập storage bọc `isPlatformBrowser`.

### 9.2 Đăng nhập, đăng ký, đăng xuất

**Nguyên tắc**
- Không tự tạo ví nữa. Có ví trên thiết bị chỉ bằng 3 cách: **Đăng ký** (tạo mới), **Đăng nhập bằng ví đã lưu trên thiết bị**, **Khôi phục bằng private key / file backup**.
- Chưa có JWT ⇒ mọi route nông dân chuyển về `/login?returnUrl=...`. API trả 401 ⇒ xoá phiên và chuyển về trang đăng nhập đúng vai trò.
- `returnUrl` luôn qua `safeReturnUrl`.

**Trang `/login` (nông dân)** — thẻ căn giữa, có logo và tên hệ thống, một dòng ghi "Hệ thống thử nghiệm trên mạng Sepolia".
- *Trường hợp 1: thiết bị đã có ví.* Hiện "Ví trên thiết bị: `0x12ab…89cd`". Nút chính **"Đăng nhập bằng ví này"**. Liên kết phụ "Dùng ví khác (khôi phục từ private key)" và "Chưa có tài khoản? **Đăng ký**".
- *Trường hợp 2: thiết bị chưa có ví hoặc bấm "Dùng ví khác".* Khối **Khôi phục ví**: ô dán private key (mặc định ẩn, nút hiện/ẩn) **hoặc** nút "Chọn file backup (.json)". Nút **"Đăng nhập"**. Liên kết "Chưa có tài khoản? **Đăng ký**".
- *Luồng khi bấm đăng nhập:* (nếu khôi phục) validate key bằng `new Wallet(pk)`, **chưa lưu** vào máy → `GET /api/auth/nonce` → ký `message` → `POST /api/auth/login`.
  - 200: nếu là ví vừa khôi phục thì lưu key vào máy; lưu JWT; xoá cờ `wi_logged_out`; gọi `ensureGas()` (lỗi faucet chỉ hiện cảnh báo, không chặn); chuyển tới `returnUrl` hoặc `/dashboard`.
  - 404 `NOT_REGISTERED`: thông báo "Ví này chưa đăng ký" + nút **"Đăng ký với ví này"** → `/register` ở bước Hồ sơ (bỏ qua bước tạo ví, vẫn yêu cầu bước Sao lưu nếu ví chưa từng sao lưu).
  - 401 `NONCE_EXPIRED`: tự thử lại một lần. 429: "Thử quá nhiều lần, vui lòng đợi vài phút". Lỗi mạng/5xx: "Không kết nối được máy chủ" + nút Thử lại.
  - Key sai định dạng: "Private key không hợp lệ" (không gọi server).
- Trạng thái: nút vô hiệu hoá + spinner khi đang xử lý; nhấn Enter để gửi; có nhãn truy cập (label) cho ô nhập.
- Dòng trợ giúp: "Quên private key? Hệ thống không thể khôi phục. Hãy dùng file backup đã tải khi đăng ký."

**Trang `/register` (nông dân)** — wizard 4 bước có thanh tiến trình, nút Quay lại, **giữ nguyên dữ liệu đã nhập khi quay lại**.
1. **Tạo ví.** Giải thích 3 dòng: ví là tài khoản của bạn; ai giữ private key là giữ quyền; mất key không thể khôi phục. Nút **"Tạo ví mới"** → `Web3Service.createWallet()` (trong bộ nhớ, **chưa lưu**) → hiện địa chỉ. Nếu thiết bị đã có ví: hộp cảnh báo với hai lựa chọn "Dùng ví đang có (`0x…`)" hoặc "Tạo ví mới (thay thế ví hiện tại)"; chọn thay thế phải tick "Tôi đã sao lưu ví cũ". Nếu đến từ `NOT_REGISTERED` thì bỏ qua bước này.
2. **Sao lưu private key.** Key ẩn mặc định; nút "Giữ để hiện (2 giây)"; nút **Copy**; nút **"Tải file backup"** (`weather-insurance-wallet.json`: `address`, `privateKey`, `createdAt`, ghi chú mạng). Chỉ cho **Tiếp tục** khi: (a) đã bấm Copy hoặc Tải file, (b) nhập đúng **4 ký tự cuối của private key**, (c) tick "Tôi đã lưu private key ở nơi an toàn và hiểu rằng mất key là mất tài khoản".
3. **Hồ sơ.** Bắt buộc: họ tên, số điện thoại, tỉnh/thành, quận/huyện, loại cây trồng, diện tích (ha). Tùy chọn: email, xã/phường, vị trí ruộng (nút lấy GPS), bật/tắt thông báo email. Validate tại chỗ theo đúng quy tắc server (mục 3). Bắt buộc tick "Tôi hiểu đây là hệ thống thử nghiệm trên mạng Sepolia, không dùng tiền thật".
4. **Hoàn tất.** Bấm **"Tạo tài khoản"** thực hiện tuần tự: lưu key vào máy (`saveWallet`) → `GET /api/auth/nonce` → ký → `POST /api/auth/register` → lưu JWT → `ensureGas()` (lỗi faucet chỉ cảnh báo kèm nút "Nạp lại") → màn hình thành công (địa chỉ, số dư, nút **"Mua bảo hiểm"** và **"Về tổng quan"**).
   - 409 `ALREADY_REGISTERED`: "Ví này đã đăng ký" + nút Đăng nhập.
   - 400 `VALIDATION`: quay về bước 3 và gắn lỗi vào đúng ô theo `fields`.
   - 401 `NONCE_EXPIRED`: tự thử lại một lần. Lỗi mạng: giữ nguyên form, cho thử lại; key đã lưu trong máy nên không mất.
- Liên kết "Đã có tài khoản? **Đăng nhập**".

**Đăng xuất và phiên**
- Menu tài khoản có hai mục: **"Đăng xuất"** và **"Đăng xuất và xoá ví khỏi thiết bị"**.
  - "Đăng xuất": xoá JWT, đặt cờ `wi_logged_out=1` (chặn tự đăng nhập lại), **giữ ví trên máy** để lần sau chỉ cần bấm "Đăng nhập bằng ví này"; chuyển `/login`.
  - "Đăng xuất và xoá ví": hộp xác nhận, phải tick "Tôi đã sao lưu private key" và gõ chữ `XOA`; xoá `wi_wallet_pk`.
- JWT hết hạn (12 giờ) hoặc server trả 401: xử lý theo `restore()`/`handleExpired()` ở mục 9.1.

**Trang `/staff/login` (admin, CSKH)**
- Ô email, ô mật khẩu (có nút hiện/ẩn), nút Đăng nhập. Sai thông tin: "Sai email hoặc mật khẩu". 429: "Đăng nhập sai quá nhiều lần, thử lại sau 15 phút".
- Dòng ghi chú: "Tài khoản nhân viên do quản trị viên cấp. Quên mật khẩu: liên hệ quản trị viên." Liên kết "Bạn là nông dân? **Đăng nhập tại đây**".
- Thành công: admin tới `/admin/review`, support tới `/support` (hoặc `returnUrl` hợp lệ).
- **`/staff/account`**: hiện họ tên, email, vai trò; form **đổi mật khẩu** (hiện tại, mới ≥ 10 ký tự, nhập lại); nút Đăng xuất.

### 9.3 Trang nông dân

1. **Hồ sơ (`/profile`)** — chỉnh sửa hồ sơ đã đăng ký (đăng ký ban đầu ở `/register`, mục 9.2). Form 3 khối: Thông tin cá nhân · Vị trí & cây trồng (có nút "Lấy vị trí ruộng bằng GPS") · Thông báo (bật/tắt email, nút "Liên kết Telegram" hiện `deepLink` và trạng thái đã liên kết). Dùng chung bộ validate với bước 3 của đăng ký; lưu xong hiện toast.
2. **Mua bảo hiểm (`/buy-policy`)** — viết lại `buy-policy`:
   - Danh sách gói từ `GET /api/products` (thẻ: tên, loại rủi ro, ngưỡng hiển thị, phí, mức bồi thường, thời hạn) thay ô gõ id.
   - 4 bước: Chọn gói → Vị trí (GPS, giữ giới hạn sai số ≤ 200 m) → 3 ảnh (có xem trước) → Thanh toán & gửi.
   - Trước khi mua: kiểm tra số dư ≥ premium + gas, thiếu thì gọi faucet.
   - Sau `buyPolicy`, lấy `policyId` bằng cách **đọc event `PolicyCreated` từ receipt** (không dùng "id cuối cùng của danh sách").
   - Lưu `wi_pending_{wallet}` = `{ policyId, step }` vào localStorage để reload không mất; hỗ trợ `?resume={policyId}`: bỏ qua bước mua, vào thẳng bước ảnh (chỉ khi policy đang chờ xác minh và chưa có evidence on-chain).
   - Thứ tự: mua → upload (`POST /api/evidence/{id}`) → **so hash do server trả với SHA-256 tính cục bộ** → `submitVerificationEvidence(id, fieldHash, documentHash)` → màn hình thành công kèm link `/policies/{id}`.
   - Ánh xạ revert của contract sang tiếng Việt có dấu (`Pool khong du von` → "Quỹ bảo hiểm tạm hết hạn mức, vui lòng thử lại sau", `Premium khong dung`, `lat ngoai pham vi`…).
3. **Tổng quan (`/dashboard`)** — thẻ tổng hợp (số policy, đang hiệu lực, tổng bồi thường đã nhận), danh sách từ `GET /api/policies/mine`: tên gói, trạng thái (badge), mức bồi thường, hạn còn lại; policy `status=0` chưa có evidence hiện nút **"Gửi hồ sơ"** (`/buy-policy?resume=`); trạng thái trống có nút "Mua bảo hiểm".
4. **Chi tiết policy (`/policies/:id`)** — thông tin đầy đủ, liên kết bản đồ OpenStreetMap tới tọa độ, **timeline** dọc (Đã mua → Đã gửi hồ sơ → Được duyệt/Bị từ chối → Bồi thường/Hết hạn) lấy từ `timeline` của API, khung **lý do từ chối** (`rejectReason`), link tx Etherscan (`explorerTxBase`), ảnh hồ sơ của mình qua signed URL, nút "Tạo yêu cầu hỗ trợ" (`/tickets/new?policyId=`).
5. **Hỗ trợ**
   - `/tickets`: danh sách, chip trạng thái, mới cập nhật trước.
   - `/tickets/new`: loại yêu cầu, policy liên quan (chọn từ policy của mình, điền sẵn từ query), tiêu đề, nội dung.
   - `/tickets/:id`: luồng hội thoại dạng bong bóng, ô trả lời, trạng thái, **đánh giá sao 1–5 + nhận xét** khi `resolved/closed`. Polling 10 giây khi tab đang hiển thị (`document.visibilityState`).
6. **Thông báo** — component chuông trong thanh điều hướng: badge chưa đọc (polling 15 giây), dropdown 10 mục gần nhất, bấm vào = đánh dấu đã đọc + điều hướng theo `link`, nút "Đọc tất cả"; trang `/notifications` có phân trang.
7. **Sao lưu ví (`/wallet`)** — hiện địa chỉ; "Hiện private key" chỉ sau khi tick "Tôi hiểu đây là chìa khoá duy nhất" và giữ nút 2 giây; copy; tải file `weather-insurance-wallet.json`; form nhập key để khôi phục ví (có cảnh báo sẽ thay ví hiện tại). Cảnh báo to: mất key = mất quyền với policy.

### 9.4 Trang nhân viên

1. **`/staff/login` và `/staff/account`** — chi tiết ở mục 9.2 (đăng nhập, đổi mật khẩu, đăng xuất).
2. **Hàng đợi (`/support`)** — tab "Của tôi / Chưa gán / Tất cả", bộ lọc trạng thái, loại, ưu tiên, ô tìm kiếm `q`; bảng: #, thời gian, nông dân, chủ đề, loại, ưu tiên, trạng thái, người xử lý, cập nhật; phân trang; đếm số ticket theo tab.
3. **Chi tiết ticket (`/support/ticket/:id`)** — trái: hội thoại + ô soạn có công tắc **"Ghi chú nội bộ"**, danh sách **mẫu trả lời** (thay `{farmer_name}`, `{policy_id}` khi chèn); phải: tóm tắt nông dân (dữ liệu đã che với support), danh sách policy liên quan với trạng thái, link xem hồ sơ chỉ đọc (ảnh qua signed URL, cờ EXIF) và timeline, điều khiển trạng thái / ưu tiên / người xử lý, nút "Nhận ticket".
4. **Tra cứu (`/support/lookup`)** — ô nhập ví / policyId / số điện thoại / tên → kết quả dạng thẻ → mở rộng để xem policy, hồ sơ chỉ đọc, ticket đang mở, nút "Tạo ghi chú nội bộ" (vào ticket gần nhất).
5. **Mẫu trả lời (`/support/canned`)** — CRUD.
6. **Admin shell (`/admin`)** — thanh bên liệt kê: Duyệt hồ sơ, Nhân viên, Nhật ký (của B) và Dashboard, Sản phẩm, Hệ thống, Oracle, Payout (của A).
7. **Duyệt hồ sơ (`/admin/review`)** — viết lại `pages/admin`: bỏ ô nhập API key và `X-Admin-Key`; dữ liệu từ `GET /api/admin/pending-policies` (hiện tên nông dân, gói, loại rủi ro); mở hồ sơ ⇒ `meta` + **ảnh qua signed URL** (`<img [src]>`) + evidence on-chain; giữ các kiểm tra `hashMatch`, `distanceWarning`, `canApprove`; ô **ghi chú** (bắt buộc khi từ chối); sau khi gửi hiện link tx. `AdminService` viết lại trên `ApiService`.
8. **Nhân viên (`/admin/staff`)** — bảng, tạo nhân viên (dialog), bật/tắt, đổi vai trò, đặt lại mật khẩu; hiện lỗi từ các quy tắc ở mục 8.
9. **Nhật ký (`/admin/audit`)** — bảng phân trang, lọc theo hành động/người thực hiện/khoảng ngày.

### 9.5 Chung
- Trang 404 và 403; trạng thái đang tải/ trống/ lỗi cho mọi danh sách.
- Mọi thời gian hiển thị theo giờ Việt Nam; tiền hiển thị ETH tối đa 6 chữ số thập phân.
- Mọi link tx dùng `environment.explorerTxBase` (A thêm key này).
- Kiểm tra giao diện trên điện thoại thật (chiều rộng ~360 px).

---

## 10. Triển khai frontend và tài liệu

### 10.1 Deploy frontend
- `ng build --configuration production` phải ra thư mục **tĩnh** (tắt SSR hoặc dùng `outputMode: static` trong `angular.json`, kiểm tra theo phiên bản Angular đang dùng) rồi đưa lên Vercel / Netlify / Firebase Hosting.
- Thêm rewrite mọi route về `index.html` (`vercel.json` hoặc `netlify.toml` hoặc `firebase.json`).
- Host phải là **HTTPS** (camera, GPS, `crypto.subtle` cần HTTPS).
- Đặt URL production vào `Cors:Origins` của backend (nhờ A cập nhật biến môi trường) và `App:PublicUrl`.

### 10.2 Tài liệu và demo
- `README.md` đầy đủ: kiến trúc (sơ đồ), yêu cầu cài đặt, chạy local (Hardhat node → deploy → backend → frontend), biến môi trường (không kèm secret), cách deploy, tài khoản demo (admin/support do người dùng tự đặt), kịch bản demo từng bước.
- Báo cáo/slide: kiến trúc 3 tầng, luồng nghiệp vụ, vai trò (nông dân/admin/CSKH), lý do chọn Supabase, và **giới hạn đã biết** (bảo hiểm tham số theo vùng lưới ~22 km, xác minh thủ công một lần, off-ramp cần sàn trung gian, oracle tự vận hành nên phải tin backend, một key operator trên testnet, ví nông dân lưu trong localStorage, dữ liệu Open-Meteo là dữ liệu mô hình).
- Video demo (5–7 phút) quay theo checklist E2E ở SPEC-00 mục 6; quay sẵn bản dự phòng phòng khi mạng/testnet gặp sự cố khi bảo vệ.

---

## 11. Kế hoạch theo ngày (B)

### Ngày 1 — Nền tảng
1. Tạo project Supabase + secrets (1.1). Package, `AppDbContext` + factory + entity + **migrations `InitialCreate` và `EnableRowLevelSecurity`, áp dụng lên Supabase** (1.2). **Push H1 trước 12h.**
2. Kéo `AddChainServices` của A. Viết lại `Program.cs`, xoá AdminKey, CORS/rate limit/exception handler, `DatabaseInitializer`.
3. `AuthController`, JWT, `ProfileController`, `TelegramBotService` (khung), `IAuditLog`.
4. `IEvidenceStorage` + viết lại `EvidenceController`.
5. Frontend: `ApiService`, `AuthService`, guards, `Web3Service` (ensureGas/export/import), khung ứng dụng + `AccountMenu` + routes (kèm route trỏ tới trang của A), trang **`/login`, `/register`, `/staff/login`, `/staff/account`**, `/profile`. **Giao `ApiService` cho A ở mốc H2.**
6. **Chạy thử** (`backend.http` / Postman): nonce → ký bằng ví thử → `register` (tạo hồ sơ + token) → `login` lại cùng ví (token) → ví lạ `login` ⇒ 404 `NOT_REGISTERED` → `register` lần hai cùng ví ⇒ 409 `ALREADY_REGISTERED`; staff login, đổi mật khẩu; `PUT/GET profile`; upload 3 ảnh thấy file trong bucket và dòng `evidence_meta`; gọi API admin bằng token farmer → 403; upload bằng token ví khác → 403; upload hai lần sau khi đã khoá → 409.

### Ngày 2 — Nghiệp vụ và giao diện nông dân
1. Review API (mục 5), ticket + canned + lookup (mục 6), `NotificationService` + API + Telegram/email (mục 7), `TicketAutoCloseService`, staff + audit API (mục 8). **Mốc H3:** `NotificationService` bản thật để A thay stub.
2. Frontend: `buy-policy` (viết lại), `dashboard`, `policy-detail`, chuông thông báo + `/notifications`, `tickets` (3 trang), `/admin/review` (viết lại).
3. **Chạy thử** (Hardhat local + backend + frontend): điền hồ sơ → mua → upload → hash lên chain → admin duyệt → thông báo hiện (cần indexer A) → từ chối một policy khác có lý do → hiện ở chi tiết policy; tạo ticket ↔ staff trả lời (Postman) ↔ nông dân thấy; email/Telegram nhận được thử nghiệm.

### Ngày 3 — Giao diện CSKH/admin và hoàn thiện
1. Frontend: `/support` (hàng đợi, chi tiết, tra cứu, mẫu), Admin shell, `/admin/staff`, `/admin/audit`, `/wallet`, toast, trang 404/403, căn chỉnh giao diện điện thoại.
2. Nhận địa chỉ Sepolia và URL backend từ A (**H4**) → kiểm tra `environment.prod.ts` → deploy frontend (mục 10.1).
3. `README`, tài liệu, slide, video.
4. **E2E chung** với A theo SPEC-00 mục 6; sửa lỗi.

---

## 12. Tiêu chí hoàn thành của B

- [ ] Schema do **EF migrations** tạo (`InitialCreate`, `EnableRowLevelSecurity`), khớp mô hình SPEC-00 mục 3; backend khởi động trên DB trống tự dựng đủ bảng, bucket `evidence` (private) và 2 tài khoản staff.
- [ ] Không còn `Admin:ApiKey`, `AdminKeyAttribute`, `AdminApiKeyMiddleware`, `EvidenceStore/` trong repo; không có secret trong repo.
- [ ] **Có trang `/login` và `/register` (nông dân), `/staff/login` (nhân viên).** Đăng ký 4 bước (tạo ví → sao lưu bắt buộc → hồ sơ → hoàn tất); đăng nhập bằng ví trên máy hoặc khôi phục private key/file backup; ví chưa đăng ký được dẫn sang đăng ký.
- [ ] **Chưa có JWT thì mọi route nông dân/nhân viên redirect về trang đăng nhập** (có `returnUrl`); JWT hết hạn hoặc API trả 401 cũng vậy; đã đăng nhập vào `/login` bị chuyển về trang chủ.
- [ ] Đăng xuất giữ ví trên máy; "Đăng xuất và xoá ví" cần xác nhận; không còn tự tạo ví khi mở trang.
- [ ] Nonce dùng một lần; staff đăng nhập có giới hạn dò mật khẩu; nhân viên đổi được mật khẩu.
- [ ] Hồ sơ nông dân lưu trên Supabase; mua policy bị chặn khi chưa đủ hồ sơ.
- [ ] Ảnh bằng chứng nằm trong Supabase Storage; không ghi đè được sau khi hash lên chain; không upload hộ ví khác.
- [ ] Duyệt/từ chối kiểm tra hash phía server; lý do từ chối hiển thị cho nông dân.
- [ ] Ticket đầy đủ: tạo, trả lời, ghi chú nội bộ (nông dân không thấy), đổi trạng thái/ưu tiên/gán, đánh giá, tự đóng sau 72 giờ, mẫu trả lời, tra cứu.
- [ ] Thông báo trong app + Telegram + email hoạt động; không bắn lại thông báo cũ khi backfill.
- [ ] Quản lý nhân viên + nhật ký hoạt động; không thể khoá admin cuối cùng.
- [ ] Mọi trang trong mục 9 chạy trên điện thoại, trên URL production HTTPS.
- [ ] README, slide, video demo hoàn chỉnh.
