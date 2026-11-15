# SPEC-00 — Phần chung (A và B đều đọc)

Dự án: `weather-insurance` (blockchain/ + backend/ + frontend/).
Thời hạn: **3 ngày**, 2 người, **không cắt việc**. Không viết test mới, chạy thử thủ công sau mỗi bước.

- **Người A** = contract + oracle + backend tầng blockchain + indexer + deploy + trang admin/LP → file `SPEC-A-chain-oracle.md`
- **Người B** = Supabase + auth + hồ sơ + bằng chứng + CSKH + thông báo + frontend nông dân/CSKH → file `SPEC-B-backend-frontend.md`

---

## 1. Quy ước bắt buộc (sai là hỏng oracle/payout)

| Mục | Quy ước |
|---|---|
| `perilType` | `0` = hạn hán (kích hoạt khi `value < threshold`), `1` = lũ (`value > threshold`), `2` = gió mạnh (`value > threshold`) |
| Giá trị oracle | **scale ×100** (`SCALE = 100`). Mưa: mm×100. Gió: km/h×100. `threshold` của product cùng thang |
| Hạn hán | `value` = tổng mưa 30 ngày gần nhất (mm×100) |
| Lũ | `value` = tổng mưa 3 ngày gần nhất (mm×100) |
| Gió | `value` = gió giật cao nhất trong 3 ngày gần nhất (km/h×100) |
| `regionId` | Giữ nguyên công thức trong `region-hashing.md` (lưới 0.2°, scale 1e6, keccak256 pack). **Không đổi** |
| Tọa độ | Lưu on-chain dạng `int256` đã ×1e6. Chỉ hỗ trợ toạ độ dương |
| `PolicyStatus` | `0` PendingVerification, `1` Active, `2` PaidOut, `3` Closed |
| Địa chỉ ví | Lưu DB và so sánh luôn ở dạng **lowercase** |
| Thời gian | Unix giây UTC. DB dùng `timestamptz` |
| Tiền | wei ở backend/DB (`numeric(78,0)` hoặc string), ETH ở UI |
| Ngôn ngữ UI | Tiếng Việt |
| Key trên chain | **1 key operator** (deployer = owner = verifier = oracle signer) + 1 key faucet riêng. Chỉ để trong `dotnet user-secrets` / biến môi trường, **không commit** |

---

## 2. Config backend (user-secrets / env)

Mỗi key lấy từ `IConfiguration`. B tạo class `Options` tương ứng, A và B dùng chung.

```
ConnectionStrings:Supabase        # Postgres connection string, dùng Session pooler (port 5432) hoặc kết nối trực tiếp
Database:AutoMigrate              # true: backend tự áp dụng migration khi khởi động
Supabase:Url
Supabase:ServiceRoleKey
Supabase:EvidenceBucket           # "evidence"
Jwt:Secret                        # >= 32 ký tự
Jwt:Issuer / Jwt:Audience
Jwt:ExpiryMinutes                 # 720
Cors:Origins:0..n                 # http://localhost:4200, URL frontend production
App:PublicUrl                     # URL frontend (dùng trong thông báo)
App:ExplorerTxBase                # https://sepolia.etherscan.io/tx/

Blockchain:RpcUrl
Blockchain:ChainId                # 31337 local, 11155111 Sepolia
Blockchain:OperatorPrivateKey     # thay OracleBackendPrivateKey và VerifierPrivateKey
Blockchain:PolicyManagerAddress
Blockchain:LiquidityPoolAddress
Blockchain:PayoutEngineAddress
Blockchain:SelfHostedOracleAddress
Blockchain:OracleIntervalMinutes  # 30
Indexer:StartBlock                # block deploy PolicyManager
Indexer:PollSeconds               # 10
Indexer:BlockChunk                # 10 nếu Alchemy Free (getLogs tối đa 10 block/lần); tối đa 10000 nếu gói Pay As You Go
Indexer:Confirmations             # 2

Faucet:PrivateKey
Faucet:AmountEth                  # 0.05
Faucet:CooldownHours              # 24
Demo:EnableSimulate               # true/false, bật endpoint giả lập oracle

Seed:Admin:Email / Seed:Admin:Password
Seed:Support:Email / Seed:Support:Password

Telegram:BotToken / Telegram:BotUsername
Smtp:Host / Smtp:Port / Smtp:User / Smtp:Password / Smtp:From
```

**RPC (Alchemy) — dùng hai key riêng:**
- **Key backend** (`Blockchain:RpcUrl`, bí mật, chỉ ở user-secrets/biến môi trường): operator gửi tx, oracle, indexer.
- **Key frontend** (`rpcUrl` trong `environment*.ts`, công khai vì nằm trong bundle): bật **Allowlist domain** trong Alchemy Dashboard (chỉ cho URL frontend production và `localhost`). Frontend chỉ dùng key này để ký-gửi tx của người dùng và đọc dữ liệu đơn lẻ; **không** dùng `getLogs`.

Việc phải làm ngay: xoá `Admin:ApiKey`, `OracleBackendPrivateKey`, `VerifierPrivateKey` khỏi `appsettings*.json`. `appsettings.json` chỉ giữ giá trị không bí mật (RPC local, interval, tên bucket...).

---

## 3. Mô hình dữ liệu Supabase (tạo bằng EF Core migrations)

**Cách tạo bảng:** EF Core migrations. B viết entity + cấu hình Fluent API trong `AppDbContext`, tạo migration `InitialCreate` (**tất cả bảng, kể cả bảng của A**) và `EnableRowLevelSecurity`, rồi áp dụng lên Supabase bằng `dotnet ef database update` hoặc tự động khi backend khởi động (`Database:AutoMigrate = true`). Khối SQL dưới đây là **đặc tả mô hình tham chiếu**: entity + migration phải tạo ra đúng tên bảng/cột (snake_case), kiểu dữ liệu, khoá, ràng buộc `check`, chỉ mục và khoá ngoại ghi ở đây (không cần giống từng ký tự DDL).

**Quy tắc migration (cả hai người đều tuân thủ):**
- Cả hai dùng **chung một Supabase project**. **Chỉ B tạo migration** (thư mục `backend/Data/Migrations`). A cần đổi schema thì nhờ B; A **không** tự tạo migration.
- **Không sửa migration đã push hoặc đã áp dụng**; mọi thay đổi mới = một migration mới. Luôn `git pull` trước khi tạo migration.
- Chạy migration qua **Session pooler** (port 5432) hoặc kết nối trực tiếp, **không** dùng Transaction pooler (port 6543) vì EF cần advisory lock.
- Sau khi pull code có migration mới: chạy backend (tự áp dụng) hoặc `dotnet ef database update`.

**Phân công:** B sở hữu `AppDbContext` và toàn bộ entity + migration (xong và **đã áp dụng lên Supabase trước 12h ngày 1** để A dùng). A chỉ ghi vào `chain_events`, `policies_cache`, `products_cache`, `indexer_state`, `oracle_logs`.

```sql
create extension if not exists pgcrypto;

-- ===== Người dùng =====
create table farmer_profiles (
  wallet_address text primary key check (wallet_address = lower(wallet_address)),
  full_name text not null,
  phone text not null,
  email text,
  province text not null,
  district text not null,
  commune text,
  crop_type text not null,
  farm_area_ha numeric(10,2) not null check (farm_area_ha > 0),
  farm_lat numeric(9,6),
  farm_lng numeric(9,6),
  notify_email boolean not null default true,
  notify_telegram boolean not null default false,
  telegram_chat_id bigint,
  telegram_link_code text,
  telegram_link_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  full_name text not null,
  role text not null check (role in ('admin','support')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table auth_nonces (
  wallet_address text primary key,
  nonce text not null,
  expires_at timestamptz not null
);

-- ===== Hồ sơ xác minh =====
create table evidence_meta (
  policy_id bigint primary key,
  holder text not null,
  declared_lat double precision not null,
  declared_lng double precision not null,
  gps_accuracy double precision not null,
  exif_gps_present boolean not null,
  exif_lat double precision,
  exif_lng double precision,
  distance_meters double precision,
  selfie_hash text not null,
  field_hash text not null,
  document_hash text not null,
  selfie_path text not null,
  field_path text not null,
  document_path text not null,
  locked boolean not null default false,   -- true khi hash đã lên chain, cấm upload lại
  uploaded_at timestamptz not null default now()
);

create table review_logs (
  id bigserial primary key,
  policy_id bigint not null,
  staff_id uuid references staff(id),
  approved boolean not null,
  note text,
  tx_hash text,
  created_at timestamptz not null default now()
);
create index on review_logs(policy_id, created_at desc);

-- ===== CSKH =====
create table tickets (
  id bigserial primary key,
  wallet_address text not null references farmer_profiles(wallet_address),
  policy_id bigint,
  category text not null check (category in ('review_rejected','payout_missing','policy_info','technical','other')),
  subject text not null,
  status text not null default 'open' check (status in ('open','in_progress','waiting_customer','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  assigned_to uuid references staff(id),
  rating smallint check (rating between 1 and 5),
  rating_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index on tickets(wallet_address);
create index on tickets(status, updated_at desc);

create table ticket_messages (
  id bigserial primary key,
  ticket_id bigint not null references tickets(id) on delete cascade,
  sender_type text not null check (sender_type in ('farmer','staff','system')),
  sender_ref text,                               -- wallet hoặc staff id
  body text not null,
  is_internal boolean not null default false,    -- ghi chú nội bộ CSKH, nông dân không thấy
  created_at timestamptz not null default now()
);
create index on ticket_messages(ticket_id, created_at);

create table canned_replies (
  id bigserial primary key,
  title text not null,
  body text not null,
  created_by uuid references staff(id),
  created_at timestamptz not null default now()
);

create table notifications (
  id bigserial primary key,
  wallet_address text not null,
  type text not null,
  title text not null,
  body text not null,
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index on notifications(wallet_address, is_read, created_at desc);

-- ===== Dữ liệu chain (A ghi) =====
create table chain_events (
  id bigserial primary key,
  block_number bigint not null,
  tx_hash text not null,
  log_index int not null,
  contract text not null,                        -- policyManager | pool | payoutEngine | oracle
  event_name text not null,
  policy_id bigint,
  wallet_address text,
  args jsonb not null,
  block_time timestamptz not null,
  unique (tx_hash, log_index)
);
create index on chain_events(policy_id);
create index on chain_events(event_name, block_number desc);

create table products_cache (
  product_id bigint primary key,
  name text not null,
  peril_type smallint not null,
  threshold numeric(78,0) not null,
  duration_days int not null,
  premium_wei numeric(78,0) not null,
  coverage_wei numeric(78,0) not null,
  active boolean not null,
  updated_at timestamptz not null default now()
);

create table policies_cache (
  policy_id bigint primary key,
  product_id bigint not null,
  peril_type smallint not null,
  holder text not null,
  lat_e6 bigint not null,
  lng_e6 bigint not null,
  region_id text not null,
  status smallint not null,
  start_time bigint not null,
  end_time bigint not null,
  premium_wei numeric(78,0) not null,
  coverage_wei numeric(78,0) not null,
  rejected boolean not null default false,
  created_tx text,
  verified_tx text,
  payout_tx text,
  closed_tx text,
  updated_at timestamptz not null default now()
);
create index on policies_cache(holder);
create index on policies_cache(status);

create table indexer_state (
  id int primary key default 1 check (id = 1),
  last_block bigint not null
);

create table oracle_logs (
  id bigserial primary key,
  region_id text not null,
  peril_type smallint not null,
  value_scaled numeric(78,0),
  data_ts bigint,
  tx_hash text,
  status text not null check (status in ('ok','error')),
  error text,
  created_at timestamptz not null default now()
);
create index on oracle_logs(region_id, peril_type, created_at desc);

create table audit_logs (
  id bigserial primary key,
  actor_type text not null,                      -- staff | farmer | system
  actor_ref text,
  action text not null,
  target text,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- RLS (làm trong migration `EnableRowLevelSecurity` bằng migrationBuilder.Sql, áp dụng cả cho "__EFMigrationsHistory"):
-- bật cho tất cả bảng, KHÔNG tạo policy (frontend không gọi Supabase trực tiếp;
-- backend dùng connection string role postgres/service nên bypass RLS)
alter table farmer_profiles enable row level security;
alter table staff enable row level security;
alter table auth_nonces enable row level security;
alter table evidence_meta enable row level security;
alter table review_logs enable row level security;
alter table tickets enable row level security;
alter table ticket_messages enable row level security;
alter table canned_replies enable row level security;
alter table notifications enable row level security;
alter table chain_events enable row level security;
alter table products_cache enable row level security;
alter table policies_cache enable row level security;
alter table indexer_state enable row level security;
alter table oracle_logs enable row level security;
alter table audit_logs enable row level security;
```

**Storage:** bucket private `evidence` (backend **tự tạo** lúc khởi động qua `EnsureBucketAsync`, không cần tạo tay), đường dẫn `{policyId}/{kind}.{ext}` với `kind ∈ selfie|field|document`.

---

## 4. Giao diện giữa A và B

### 4.1 `INotificationService` (B cài, A gọi từ indexer)

```csharp
namespace backend.Services.interfaces;

public interface INotificationService
{
    Task NotifyAsync(string walletAddress, string type, string title, string body,
                     string? link = null, CancellationToken ct = default);
}
```

- Cho đến khi B xong, A dùng bản stub chỉ `LogInformation`. B thay thế bằng bản thật (insert `notifications` + Telegram + email) mà A không phải sửa code.
- `type` hợp lệ: `evidence_received`, `policy_approved`, `policy_rejected`, `payout_sent`, `policy_expired`, `ticket_reply`, `ticket_status`.
- **Indexer (A) là nơi duy nhất sinh thông báo từ sự kiện chain.** Review API của B **không** tự gửi thông báo duyệt/từ chối, chỉ ghi `review_logs` (lý do) trước khi gửi tx. Khi indexer thấy `PolicyVerified(approved=false)`, nó lấy `note` mới nhất trong `review_logs` của policy đó đưa vào nội dung thông báo.

### 4.2 Danh sách endpoint

Tất cả (trừ ghi chú) yêu cầu header `Authorization: Bearer <jwt>`. Claim: `sub`, `role` (`farmer|admin|support`), `wallet` (với farmer).

| Endpoint | Role | Chủ |
|---|---|---|
| `GET /health` | public | A |
| `GET /api/auth/nonce?address=` | public | B |
| `POST /api/auth/register` `{address, signature, profile}` | public | B |
| `POST /api/auth/login` `{address, signature}` (ví chưa đăng ký ⇒ 404 `NOT_REGISTERED`) | public | B |
| `POST /api/auth/staff/login` `{email, password}` | public | B |
| `POST /api/auth/staff/change-password` `{currentPassword, newPassword}` | admin, support | B |
| `GET /api/auth/me` | any | B |
| `GET /api/profile/me` · `PUT /api/profile/me` | farmer | B |
| `POST /api/profile/telegram-link` | farmer | B |
| `POST /api/evidence/{policyId}` | farmer (đúng chủ policy) | B |
| `GET /api/evidence/{policyId}/meta` | admin, support, farmer (đúng chủ) | B |
| `GET /api/evidence/{policyId}/{kind}` → `{url, expiresIn}` | admin, support, farmer (đúng chủ) | B |
| `GET /api/admin/pending-policies` | admin, support | A (đọc `policies_cache`) |
| `POST /api/admin/review/{policyId}` `{approved, note}` | admin | B |
| `GET /api/products` | public | A |
| `GET /api/policies/mine` | farmer | A |
| `GET /api/policies/{id}` (kèm `timeline`) | farmer (đúng chủ), admin, support | A |
| `POST /api/faucet` `{address}` | farmer | A |
| `GET /api/admin/stats` | admin | A |
| `GET /api/admin/pool` | admin | A |
| `POST /api/admin/system/pause` · `/unpause` `{target}` | admin | A |
| `POST /api/admin/products` · `PATCH /api/admin/products/{id}/active` · `POST /api/admin/cooling-off` | admin | A |
| `GET /api/admin/oracle-status` · `POST /api/admin/oracle/run-now` · `POST /api/admin/oracle/simulate` | admin | A |
| `GET /api/admin/payouts` | admin | A |
| `GET/POST/PATCH /api/admin/staff` | admin | B |
| `GET /api/admin/audit` | admin | B |
| `POST /api/tickets` · `GET /api/tickets` · `GET /api/tickets/{id}` | farmer / staff | B |
| `POST /api/tickets/{id}/messages` · `PATCH /api/tickets/{id}` · `POST /api/tickets/{id}/rating` | farmer / staff | B |
| `GET/POST/PUT/DELETE /api/support/canned-replies` | admin, support | B |
| `GET /api/support/lookup?q=` | admin, support | B |
| `GET /api/notifications` · `GET /api/notifications/unread-count` · `POST /api/notifications/{id}/read` · `POST /api/notifications/read-all` | farmer | B |

Quy ước lỗi: JSON `{ "error": "mô tả tiếng Việt", "code": "MÃ_TÙY_CHỌN", "fields": { ... } }` kèm đúng mã HTTP (400, 401, 403, 404, 409, 429, 500). `code` dùng cho lỗi mà UI cần xử lý riêng: `INVALID_SIGNATURE`, `NONCE_EXPIRED`, `NOT_REGISTERED`, `ALREADY_REGISTERED`, `VALIDATION` (kèm `fields`), `RATE_LIMITED`.

### 4.3 Hình dạng JSON mà hai bên phải khớp

`GET /api/products` →
```json
[{ "productId": 1, "name": "Hạn hán Cần Thơ", "perilType": 0, "threshold": "15000",
   "thresholdDisplay": "150 mm / 30 ngày", "durationDays": 90,
   "premiumWei": "1000000000000000", "coverageWei": "10000000000000000", "active": true }]
```

`GET /api/policies/{id}` →
```json
{ "policyId": 7, "productId": 1, "productName": "...", "perilType": 0, "holder": "0x..",
  "latE6": 10045000, "lngE6": 105787000, "regionId": "0x..", "status": 1,
  "startTime": 1760000000, "endTime": 1767776000,
  "premiumWei": "...", "coverageWei": "...",
  "rejectReason": null,
  "timeline": [
    { "type": "created",   "time": 1759990000, "txHash": "0x..", "data": {} },
    { "type": "evidence",  "time": 1759990100, "txHash": "0x..", "data": {} },
    { "type": "verified",  "time": 1759990900, "txHash": "0x..", "data": { "approved": true } },
    { "type": "payout",    "time": 1760500000, "txHash": "0x..", "data": { "amountWei": "..." } },
    { "type": "expired",   "time": 1767776100, "txHash": "0x..", "data": { "refunded": false } }
  ] }
```

`GET /api/admin/pending-policies` → mỗi phần tử gồm field cũ (`policyId, holder, lat, lng, coverageAmountWei, endTime`) **cộng thêm** `productName, perilType, hasEvidence, evidenceSubmittedAt, farmerName, farmerPhone`.

---

## 5. Mốc bàn giao

| Mốc | Ai giao cho ai | Nội dung |
|---|---|---|
| H1 — trưa ngày 1 | B → A | Migration `InitialCreate` + `EnableRowLevelSecurity` **đã áp dụng lên Supabase**, `AppDbContext` + entity đủ bảng, push lên nhánh chung |
| H2 — cuối ngày 1 | A → B | ABI mới ở `frontend/src/assets/abi/*.json` (PolicyManager, LiquidityPool, PayoutEngine, SelfHostedOracle); địa chỉ contract local; script chạy hardhat local |
| H3 — giữa ngày 2 | A ↔ B | A có `policies_cache`/`chain_events` chạy được; B có `INotificationService` bản thật |
| H4 — sáng ngày 3 | A → B | Địa chỉ Sepolia + URL backend production để B đặt `environment.prod.ts` |
| H5 — chiều ngày 3 | A + B | Chạy E2E chung (mục 6), sửa lỗi, quay video |

Git: mỗi người một nhánh (`feat/chain`, `feat/app`), merge vào `main` sau mỗi mốc H. Không sửa file của người kia; cần sửa thì nhắn.

---

## 6. Nghiệm thu E2E (làm trên Sepolia, ngày 3)

1. Mở app chưa đăng nhập → bị chuyển về `/login`. **Đăng ký** (tạo ví → sao lưu private key → hồ sơ) → faucet nạp ETH → mua gói → upload 3 ảnh → hash lên chain. Đăng xuất rồi đăng nhập lại bằng ví trên máy, và bằng khôi phục private key / file backup.
2. Admin xem hồ sơ (hash khớp, EXIF) → duyệt → policy `Active`, nông dân nhận thông báo (app + Telegram + email).
3. Qua cooling-off → oracle đạt ngưỡng cho **cả 3 peril** → payout tự động, UI hiện link tx Etherscan.
4. Từ chối một hồ sơ khác → refund → lý do hiện cho nông dân.
5. Một policy hết hạn → `expirePolicy` chạy (cả trạng thái chờ duyệt và đang active).
6. Nông dân tạo ticket → CSKH trả lời → nông dân nhận thông báo → đánh giá hài lòng.
7. Admin tạo sản phẩm mới, pause/unpause, LP góp và rút vốn.
8. Bảo mật: truy cập `/dashboard` khi chưa đăng nhập → về `/login?returnUrl=`; ví lạ đăng nhập → `NOT_REGISTERED`; nông dân gọi API admin → 403; CSKH bấm duyệt → 403; upload đè ảnh policy người khác → 403; upload lại sau khi hash đã lên chain → 409.
