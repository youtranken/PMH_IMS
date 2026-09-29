# Checklist go-live IMS (production trên Ubuntu + Docker)

Lập ngày 26/09/2026, trên HEAD `bcc5e46`. Nguồn: 8 đợt rà soát độc lập (Docker/hạ tầng, migration,
bảo mật, test/comment, nghiệp vụ lõi, nghiệp vụ kiểm kê, worker/sao lưu, frontend). Mọi mục đều
được đối chiếu với code chứ không dựa vào chú thích. Mục ghi **✔ đã tự kiểm** là mục đã mở code
xem tận mắt lần thứ hai.

**Rà lại ngày 29/09/2026 trên `cff0c86` (sau v1.4.2).** Mọi ô còn trống được đối chiếu lại với code.
Ô nào đã làm thì tick, kèm commit và bài kiểm. Ô làm dở thì giữ trống, ghi rõ phần đã xong và phần còn
thiếu (dòng **Rà 29/09**). Việc đã làm sau ngày lập mà chưa có mục nào thì thêm vào mục
**"Đã làm, bổ sung khi rà 29/09"** ở cuối từng phần, đều đã tick.

## Cách dùng file này

- **Mức ưu tiên**
  - **P0**: chặn go-live. Chưa xong thì chưa deploy.
  - **P1**: làm trong 2–4 tuần đầu sau go-live.
  - **P2**: làm khi rảnh, hoặc gộp vào epic sau.
- **Mỗi mục** ghi: vấn đề → hậu quả → cách sửa → cách kiểm là xong.
- **Quy trình cho mỗi mục** (đúng `CLAUDE.md`):
  1. Viết test đỏ.
  2. Sửa cho xanh.
  3. Chạy `npm --prefix api test`, `npm --prefix api run test:db`, `npm --prefix web run build`.
  4. Tick ô.
- Gom theo **cụm**, mỗi cụm một commit. Cuối mỗi cụm chạy `bash ops/ci-local.sh --e2e`. Sau khi hết
  P0, chạy `/code-review high`.
- **Không sửa file migration đã có (0000–0058), kể cả chú thích.** Checksum tính trên cả file, đổi
  một ký tự là API từ chối khởi động. Thay đổi schema luôn đi bằng file mới (`0059_…`, `0060_…`).

## Lộ trình tổng

| Giai đoạn | Nội dung | Ước lượng |
| --- | --- | --- |
| G0-a | Cụm Bảo mật: SEC-01..05 | 2–3 ngày |
| G0-b | Cụm Sao lưu và runbook: DR-01..05, DOC-01 | 1–2 ngày |
| G0-c | Cụm Hạ tầng: OPS-01..06, DB-01 | 1 ngày |
| G0-d | Cụm Dữ liệu: DB-02 (dải IP chồng), FE-01, FE-02 | 1 ngày |
| G0-d2 | Cụm Nghiệp vụ đã chốt: DOM-01 (rewrap), DOM-02..04 (IP, phần mềm, ISP) | 3–4 ngày |
| G0-e | Diễn tập trên VM Ubuntu trắng: dựng từ đầu → seed → backup → khôi phục → mở két | nửa ngày |
| G0-f | UAT: 2–3 người dùng thật làm việc thật 3–5 ngày trên máy staging | 1 tuần |
| Go-live | Story 4.3 (`docs/RUNBOOK-4.3-dong-dot-1.md`, sau khi đã sửa theo DOC-01) | nửa ngày |
| G1 | Toàn bộ P1 | 2–4 tuần |

---

## 1. Bảo mật (Security)

### P0

- [x] **SEC-01 · Admin chiếm được phiên đăng nhập của SA** ✔ đã tự kiểm
  - **Vấn đề:**
    - Cookie `ims_session` chính là `sessions.id` (`api/src/modules/auth/cookie.ts:21`).
    - Mã này bị ghi nguyên văn vào `audit_log.object_id` ở `auth.service.ts:230, 402, 645, 768`.
    - Admin được đọc `GET /api/v1/audit`.
    - `GET accounts/:id/sessions` còn trả cả `id` lẫn `csrfToken` của phiên.
  - **Hậu quả:** admin copy mã phiên của SA từ nhật ký, đặt vào cookie là thành SA. Nếu SA vừa qua
    TOTP thì mở được két.
  - **Sửa:**
    - Cookie mang token ngẫu nhiên 32 byte; DB chỉ lưu `sha256(token)`; khoá chính là uuid riêng.
    - Audit và API chỉ dùng uuid đó.
    - DTO danh sách phiên bỏ `csrfToken`.
    - Migration mới thu hồi mọi phiên đang mở.
  - **Kiểm:** test đơn vị "cookie ≠ mọi giá trị trong audit_log"; E2E "đặt cookie bằng objectId lấy
    từ audit → 401".

- [x] **SEC-02 · Dò được mã TOTP lúc đăng nhập** ✔ đã tự kiểm
  - **Vấn đề:**
    - Mỗi lần mật khẩu đúng, `login()` xoá cả hai bộ đếm sai (`auth.service.ts:254,262`) và cấp phiên
      chờ mới với bộ đếm bằng 0.
    - `auth.totp.failed` không nằm trong `PROBE_ACTIONS` (`audit/security-probe.service.ts:39`).
  - **Hậu quả:** kẻ đã có mật khẩu lặp "login → 5 mã → login" được khoảng 100 lần đoán/phút/IP và
    không sinh cảnh báo nào.
  - **Sửa:**
    - Đếm lần sai TOTP theo **tài khoản**, chỉ xoá khi TOTP đúng.
    - Thêm `auth.totp.failed` vào `PROBE_ACTIONS` và gọi probe ở nhánh sai.
    - Ngưỡng đưa vào `system_config`.
  - **Kiểm:** test "mật khẩu đúng không reset bộ đếm TOTP"; test "sai TOTP N lần → khoá + mail
    cảnh báo".

- [x] **SEC-03 · Khoá tài khoản chỉ theo cặp (tài khoản, IP)**
  - **Vấn đề:**
    - `users.locked_until` có được ghi nhưng `login()` không đọc để chặn.
    - `LoginRateGuard` đếm trong bộ nhớ theo IP.
  - **Hậu quả:** đổi IP là đoán mật khẩu không giới hạn.
  - **Sửa:**
    - Thêm trần theo tài khoản, dùng backoff tăng dần để tránh bị lợi dụng khoá người khác.
    - Sửa luôn khe L8: kiểm `isLocked` trong transaction.
  - **Kiểm:** test "N lần sai từ N IP khác nhau → tài khoản bị chặn tạm".

- [x] **SEC-04 · Tài khoản seed dùng chung mật khẩu `Pmh@1212`** ✔ đã tự kiểm
  - **Vấn đề:**
    - `api/scripts/seed-sa.mjs:20-24` tạo 5 tài khoản.
    - Script được copy vào image prod (`api/Dockerfile`).
    - Trong cửa sổ `totpEnrollReauthMinutes`, người vào trước cài TOTP của mình mà không cần nhập
      lại mật khẩu.
  - **Sửa:**
    - Chỉ tạo SA theo email truyền vào; mật khẩu tạm sinh bằng `crypto.randomBytes`, in ra đúng một
      lần.
    - Từ chối chạy nếu bảng `users` đã có SA.
    - Tài khoản còn lại tạo qua giao diện.
  - **Kiểm:** chạy script 2 lần, lần 2 phải báo "đã có SA, dừng".

- [x] **SEC-05 · Thư viện có lỗ bảo mật (npm audit: 3 high)**
  - **Vấn đề:** `multer` (qua `@nestjs/platform-express`) có 2 lỗi DoS multipart; `nodemailer` có
    lỗi bỏ qua `disableFileAccess` và lỗi IDN.
  - **Sửa:**
    - `npm audit fix` trong `api/`.
    - `uuid`/`exceljs` (moderate): xác nhận không dùng tham số `buf`, ghi nhận rủi ro chấp nhận.
  - **Kiểm:** `npm --prefix api audit --omit=dev` không còn high hay critical.
  - **Đã làm:** multer 2.4.0, nodemailer 9.1.1, qs 6.16.0. Còn 2 moderate `uuid` qua `exceljs`:
    `exceljs` chỉ gọi `uuid.v4()` không có `buf`, lỗ nằm ở v3/v5/v6 có `buf` nên không chạm tới —
    chấp nhận, xem lại khi `exceljs` ra bản dùng `uuid` ≥ 11.1.1.

### P1

- [x] **SEC-06 · `/auth/change-password` không đếm sai.** `auth.service.ts:780`. Dùng lại cơ chế của
  `startTotpEnrollment`: `registerStepUpFailure` + probe + thu hồi phiên khi chạm ngưỡng.
- [x] **SEC-07 · Logger có thể ghi `Set-Cookie`.** Thêm `res.headers["set-cookie"]` vào danh sách
  redact (`app.module.ts:61-71`). Kiểm bằng một dòng log thật.
- [x] **SEC-08 · Container api giữ mật khẩu superuser Postgres** (`MIGRATION_DATABASE_URL`). Làm cùng
  OPS-07.
- [x] **SEC-09 · Topology proxy.** Đã chốt (Q-08): không có proxy, giữ `trust proxy = 1`. Nếu có reverse proxy đứng trước container `web` trên Ubuntu, đổi
  `trust proxy` (`app.setup.ts:16`) từ số hop `1` sang IP/CIDR của proxy. Nếu không, mọi người dùng
  chung một IP: rate-limit đăng nhập thành một xô chung và cột IP trong audit vô nghĩa.

### P2

- [x] **SEC-10 · Dò được email có tồn tại hay không**, qua mã lỗi `ACCOUNT_DISABLED`/`LOCKED` và qua
  thời gian trả lời (email không có thì bỏ qua Argon2).
  - **Rà 29/09:** còn nguyên (`auth.service.ts:98-141`). Mã `ACCOUNT_LOCKED` được thêm có chủ ý để
    người dùng biết vì sao không vào được (32c3731), nên muốn đóng mục này phải chốt ở QUYET-DINH trước.
  - **Không sửa** — Q-16: giữ mã lỗi riêng, rủi ro dò email chấp nhận.
- [ ] **SEC-11 · Kiểm Origin bị bỏ qua khi thiếu header** (`csrf.guard.ts:66`), mở khả năng login-CSRF.
  - **Rà 29/09:** còn nguyên (`csrf.guard.ts:66` vẫn `if (!origin) return;`).
- [x] **SEC-12 · Member đính file được vào mọi đối tượng chỉ có quyền đọc**
  (`files.controller.ts`, `assertCanRead`). Cần chủ dự án xác nhận đây là chủ ý.
  - **Rà 29/09:** không sửa, Q-11 chốt là đúng chủ ý. Xoá file vẫn chỉ SA/Admin.
- [x] **SEC-13 · Quyền theo nhà mạng gắn theo tên** (`isp_provider` dùng `provider.name`). Đổi tên thì
  mất quyền, tên cũ dùng lại thì thừa kế sai người.
- [ ] **SEC-14 · Mật khẩu tạm không tự ẩn** (`accounts-screen.tsx:544-576`).
  - **Rà 29/09:** mới một phần. Đã có nút Ẩn/Hiện và nút chép (814ab86, ADM-048), nhưng chưa có hẹn
    giờ tự che (`accounts-screen.tsx:~981`).


### Đã làm, bổ sung khi rà 29/09

- [x] **SEC-15 · Vòng hỏi định kỳ không gia hạn phiên idle** (NFR-01): `@NoIdleTouch` cho route badge
  và verdict két, nên tab bỏ mở trên máy dùng chung vẫn hết phiên sau 30 phút. 28f8aea, v1.3.1.
- [x] **SEC-16 · Duyệt mở két không cấp quá số giờ đã xin**: API kẹp theo số giờ trên phiếu. e48e150,
  v1.3.1.
- [x] **SEC-17 · Vô hiệu hóa tài khoản rút yêu cầu mở két đang chờ VÀ thu hồi quyền đã duyệt** (Q-15).
  8a2dd5e (v1.4.1); vế thu hồi quyền đã duyệt chưa gắn phiên ở 35e8c97 (sau v1.4.2). Bài kiểm:
  `api/test/break-glass-session.spec.ts` ("quyền đã duyệt … bị thu hồi luôn").
- [x] **SEC-18 · SA "Đóng tất cả phiên" của một người**, có step-up (ADM-049). b9e91dc, v1.4.1.
- [x] **SEC-19 · Thư xin duyệt mở két không gửi cho chính người xin** (bốn mắt) và không ghi tên
  secret (VLT-015). 7bd87ee, v1.4.0.

---

## 2. Backend — logic nghiệp vụ

### P1

- [x] **BE-01 · Mail nhắc hạn nuốt lỗi mà vẫn chốt kỳ.**
  - **Vấn đề:** `common/expiry/expiry-registry.ts:49-60` catch rồi trả `[]`; `expiry-digest.service.ts`
    vẫn claim `lastSentAt`.
  - **Hậu quả:** một nguồn lỗi là mất lời nhắc cả tuần hoặc cả tháng.
  - **Sửa:** `collect` trả thêm danh sách nguồn lỗi; `runOne` ném lỗi trước khi claim; dashboard đặt
    `available:false`.
- [x] **BE-02 · Hai người sửa cùng lúc đè nhau (lost update).** Chỗ bị:
  - `devices.service.ts:189-218, 350-353`: sửa hồ sơ có thể mở lại máy vừa thanh lý.
  - `device-import.service.ts:129`.
  - `ip-address.service.ts:417-425`.
  - Luồng gia hạn `software.service.ts:179-222` và `isp-line.service.ts:233-263`: hạn có thể lùi,
    `renewal_history` ghi sai.
  - `service-account.service.ts:146,321`: bật lại tài khoản vừa bị vô hiệu hoá.

  **Sửa:** `SELECT … FOR UPDATE` trong transaction rồi kiểm lại, hoặc thêm điều kiện CAS
  (`updated_at`/`status`/`end_date`) vào `WHERE`. Viết một helper dùng chung ở `src/common` (AD-15).
- [x] **BE-03 · Két: UPDATE không kiểm `revoked_at`.** `vault.service.ts:249,284,316`: có thể xoay
  hoặc sửa một secret vừa bị thu hồi, và `revoke` chạy đúp. Thêm `AND revoked_at IS NULL` +
  `.returning()` → 404.
- [x] **BE-04 · Ghi chú thu hồi đè ghi chú của người duyệt.** `approvals.service.ts:152`: file export
  cho auditor gán sai lời cho sai người. Chỉ đặt `decisionNote` ở lần quyết định đầu.
- [x] **BE-05 · Dashboard "sắp hết hạn" hiện sai mục.** `dashboard.service.ts:192` cắt 8 mục đã sort
  theo ngày tăng dần, nên SSL còn 2 ngày có thể không lên. Sắp theo mức độ trước rồi mới cắt.
- [x] ~~**BE-06**~~ được thay bằng DOM-03.
- [x] **BE-07 · NAT đoán địa chỉ mạng/quảng bá theo octet cuối.** `nat-rules.ts:91` → `ip-rules.ts:155`
  sai với dải /25–/32. Tìm dải chứa IP rồi dùng `hostRoleIn`.
- [x] **BE-08 · Dời tủ mạng sang site khác làm kẹt thiết bị trong tủ.** `catalog.service.ts:497-514`.
  Chặn khi tủ còn thiết bị, hoặc dùng FK kép `(site_id, cabinet_id)`.
- [x] **BE-09 · Sửa phần mềm không xét ghế đang gán.** `software.service.ts:305-369` cho đổi kind,
  perpetual, giảm `seatTotal`, retire. `license-assignment.service.ts:226-245` vẫn gán được vào phần
  mềm đã retire.
- [x] **BE-10 · Query không LIMIT trên đường nóng.**
  - `approvals.service.ts:218-236` và `dashboard.service.ts:322` tải toàn bộ lịch sử break-glass mỗi
    lần mở trang chủ.
  - Thêm `since`/`limit` và lọc trong SQL.

### P2

- [ ] **BE-11 · Một số lỗi 400 lại trả 500:**
  - Ngày không có thật (`2026-02-30`) lọt qua regex `DATE_ONLY` → Postgres 22008.
  - `subnet.service.ts:235-276` đổi CIDR mà gateway cũ nằm ngoài dải → 23514.
  - `restore` (`:377-421`) trùng CIDR → 23505.
  - **Rà 29/09:** ý 3 xong (`restore` bọc `translate()` → 409 `SUBNET_OVERLAP`). Ý 1 còn: chỉ ngày
    sinh dùng `RealDateOrEmpty`, các ô `DATE_ONLY` ở devices/software/isp-line/ipam vẫn chỉ kiểm bằng
    regex. Ý 2 còn khi gọi API thẳng: PATCH chỉ gửi `cidr` thì gateway cũ không được kiểm → 500
    (màn web không dính vì luôn gửi gateway).
- [ ] **BE-12 · Import Excel:**
  - Quá 20.000 dòng thì bị cắt im lặng (`excel-import.service.ts:13,43`).
  - Ô công thức không có giá trị cache hoặc ô `#N/A` thành rỗng, xoá luôn dữ liệu đang có (`:91`).
  - **Rà 29/09:** còn nguyên cả hai ý (`excel-import.service.ts:44,95`).
- [x] **BE-13 · `renew` hồi sinh hồ sơ `terminated`/`retired`** khi gọi API thẳng.
- [x] **BE-14 · Gắn được thiết bị vào site/loại/NCC đã vô hiệu hoá** (`catalog.api.ts:51`).
  - **Rà 29/09:** xong (Q-14, ADM-015/DEV-027, 37c5180). `CatalogApiService.assertRefs` từ chối chọn
    MỚI mục đã ngừng dùng (`CATALOG_REF_INACTIVE`), cả ở thiết bị, phần mềm, dải, đường truyền, tủ mạng
    và nhập Excel. Kiểm: `api/test/catalog-inactive-ref.spec.ts`, E2E `form-kiem-tieng-viet.spec.ts`.
- [ ] **BE-15 · Audit port map thiếu thông tin** (`device-ports.service.ts:167-171`); vẫn cắm được port
  sang máy đã thanh lý.
  - **Rà 29/09:** còn nguyên cả hai ý (`device-ports.service.ts:142-190`, `prepare()` không kiểm máy
    đầu kia đã thanh lý).
- [x] **BE-16 · Sweep hết hạn grant dừng cả vòng khi gặp một hàng lỗi**
  (`approvals.service.ts:285-307`). Thêm try/catch cho từng hàng.
  - **Rà 29/09:** còn nguyên (`expireDueGrants`, `approvals.service.ts:~364-390`).
  - **Đã sửa:** `expireDueGrants` bọc try/catch từng hàng, log qua `redactMessage`, hàng lỗi rollback
    riêng và vòng sau thử lại. Kiểm: `api/test/approvals.spec.ts` (bài "một hàng lỗi không chặn").
- [x] **BE-17 · Xin break-glass chồng khi đang có grant còn hạn** (`break-glass.service.ts:230`).
  - **Rà 29/09:** mới một phần (8a2dd5e). API chặn khi còn phiếu chờ (`BREAK_GLASS_PENDING`) và khi
    có quyền đã duyệt chưa gắn phiên (`BREAK_GLASS_APPROVED`); màn hình chặn đủ. Còn hở: gọi API thẳng
    vẫn xin chồng được khi đang cầm quyền đã gắn CHÍNH phiên này. Thiếu bài kiểm cho
    `BREAK_GLASS_APPROVED`.
  - **Đã sửa:** `request()` thêm 409 `BREAK_GLASS_ACTIVE` khi đang cầm quyền gắn chính phiên này
    (`grantOf`); quyền gắn phiên khác vẫn xin lại được (Q-15). Kiểm: `api/test/break-glass-session.spec.ts`
    (nhóm "không xin chồng", có cả `BREAK_GLASS_APPROVED`).
- [x] **BE-18 · Người xin break-glass không nhận thông báo** khi được duyệt, từ chối hay thu hồi. Thêm
  outbox.
  - **Rà 29/09:** xong (Q-14, VLT-003..008, 858ba4d). Duyệt, từ chối, thu hồi ghi outbox
    `approval.decided` cùng transaction; thư dựng ở `mail.consumer.ts` (`buildDecidedMail`). Kiểm:
    `api/test/break-glass-decided.spec.ts`.
- [ ] **BE-19 · Audit ma trận quyền không ghi tầng cũ; gỡ quyền đọc ngoài transaction**
  (`access-list.service.ts`).
  - **Rà 29/09:** còn nguyên (`upsert` không đọc tầng cũ; `remove` đọc `before` ngoài transaction).
- [ ] **BE-20 · Tham số nghiệp vụ viết cứng, vi phạm AD-11:**
  - `MIN_PREFIX=24`, `WIDE_RANGE=1000`, `LOOK_BACK_DAYS=365`, `MAX_ITEMS=8`.
  - Các `@Throttle` 30 và 10 lần/phút.
  - `MAX_RELAY_ATTEMPTS=10`.
  - Múi giờ `'Asia/Ho_Chi_Minh'` ở `audit-query.service.ts:79,82`.
  - **Rà 29/09:** mới xong ý múi giờ (đọc `appTimezone`, 4541be6; kiểm ở
    `api/test/audit-query-filters.spec.ts`). Ba ý còn lại vẫn viết cứng; `MAX_RELAY_ATTEMPTS` nay là
    14 (9216723, OPS-11); thêm một `@Throttle` 20 lần/phút ở `files.controller.ts:107`.
- [x] **BE-21 · `audit-query`:** `actor`/`objectId` đưa vào `ILIKE` không qua `escapeLike`; `page`
  không có `@Max`.
  - **Rà 29/09:** xong (4541be6). `escapeLike` ở `audit-query.service.ts:137,146`; `@Max(COUNT_CAP)`
    ở `audit.controller.ts:67`. Kiểm: `audit-query-filters.spec.ts`, `audit.controller.spec.ts`.
- [x] **BE-22 · Phần mềm hết hạn chạy 4 truy vấn, mỗi kind một lần**
  (`software-expiry-sources.ts:149`).
  - **Rà 29/09:** xong (7eedd96). Mỗi nguồn hạn lọc đúng loại của nó ngay trong SQL. Kiểm:
    `api/test/software-auto-expire.spec.ts` ("lọc theo loại ngay trong câu truy vấn").


### Đã làm, bổ sung khi rà 29/09

- [x] **BE-23 · Sửa theo code review nhánh `g0-ra-soat-lai`:** SEC-03 xoá bộ đếm trong transaction,
  thứ tự khoá chống deadlock; mail không chết lúc khởi động khi thiếu `SMTP_HOST`; `.dockerignore`
  dùng `**/`. 640554e, 7572b61, v1.2.0.
- [x] **BE-24 · License đang vượt ghế vẫn sửa thông tin khác và vẫn thanh lý được** (không còn 409).
  591419d (SW-025), 35c6c11 (SW-035), v1.3.0.
- [x] **BE-25 · Sửa 10 finding code review `v1.3.1..v1.4.2`** (merge cff0c86): gia hạn chỉ kéo ghế hết
  trong [hạn cũ, hạn mới); chủ cũ trên ô IP lấy đúng lần về Trống gần nhất; `namesByEmails` tra không
  phân biệt hoa-thường; giờ trong file xuất `dd/mm/yyyy HH:mm`; bốn chỗ bớt truy vấn thừa (nhật ký
  gộp, rút phiếu, nguồn hạn, két "đang có hiệu lực"). Vế bảo mật ở SEC-17. Kiểm:
  `ops/ci-local.sh --e2e` xanh (E2E 673).

---

## 3. Database

Kết luận của đợt rà migration: chuỗi 0000–0058 đã được **chạy thật** trên Postgres 17 trắng.
Kết quả: 0 lỗi, đủ 37 bảng, chạy lần 2 áp 0 file. **Không squash**; gắn tag `v1.0-schema` lúc go-live.

### P0

- [x] **DB-01 · `ims_app` sửa và xoá được bảng `_migrations`.** Đã làm ở `0061_migrations_journal_acl.sql`:
  `REVOKE ALL ON _migrations FROM ims_app;` và thêm một ca vào `api/test/app-role-privileges.spec.ts`.
- [x] **DB-02 · Dải IP chồng được lên nhau.** ✔ đã tự kiểm: không có EXCLUDE ở migration nào,
  `subnet.service.ts` cũng không kiểm.
  - **Hậu quả:** một IP có hai chủ; NAT gắn ngẫu nhiên vào một trong hai (`nat-rule.service.ts:611`,
    `rows[0]` không có ORDER BY).
  - **Sửa:** migration mới `EXCLUDE USING gist (cidr inet_ops WITH &&) WHERE (voided_at IS NULL)`, có
    bước kiểm dữ liệu đang chồng trước (giống 0050); dịch lỗi 23P01 thành 409.
  - **Bắt buộc xong TRƯỚC khi import dữ liệu thật.**

### P1

- [ ] **DB-03 · Migration chạy bằng superuser.** Tạo role chủ sở hữu riêng (không superuser, có
  `CREATEROLE`, là owner DB). Cả 5 extension là loại trusted nên vẫn cài được. Làm cùng OPS-07.
  - **Rà 29/09:** còn nguyên. OPS-07 chỉ tách service `migrate` khỏi api; `migrate` vẫn dùng
    `POSTGRES_USER` (superuser) ở `docker-compose.yml:~129`.
- [x] **DB-04 · Gắn tag `v1.0-schema`** ngay trước go-live.
- [x] **DB-05 · Postgres tuning:** `shm_size: 256m`, `shared_buffers`, `work_mem`,
  `log_min_duration_statement=500ms`.

### Luật từ sau go-live (ghi vào `CLAUDE.md`)

- Index mới trên bảng có dữ liệu phải dùng `CREATE INDEX CONCURRENTLY` trong file có dòng đầu
  `-- ims:no-transaction`.
- `ALTER DEFAULT PRIVILEGES` (0048) cấp sẵn UPDATE/DELETE cho `ims_app` trên **mọi bảng mới**. Bảng
  chỉ-thêm mới phải tự REVOKE trong cùng file. Bài kiểm động hiện chỉ bắt tên `%_history`.
- `ims_norm` bọc `unaccent`: nâng major Postgres thì phải tính lại các cột `search_norm`.


### Đã làm, bổ sung khi rà 29/09

- [x] **DB-06 · Migration 0059 → 0241 đều chỉ-tiến, chạy sạch trên DB trắng** (AD-10). Đáng nhớ khi
  đối chiếu schema trước lúc gắn `v1.0-schema`: 0076 (ân hạn tự thanh lý), 0077 (liên hệ hỗ trợ),
  0085/0086 (tìm thiết bị theo người/bộ phận), 0088 (`device_type.is_router`), 0100/0101 (index hạn
  bảo hành, `CONCURRENTLY`), 0150 (`secret.value_changed_at`), 0170/0240/0241 (phiên xin mở két, hạn
  chờ 8 giờ), 0180/0181 (hợp đồng, chi phí, website trong sổ gia hạn).

---

## 4. Frontend / UI-UX

Build đã kiểm: không sourcemap, không `console.*`, không `window.confirm`/`alert`, không phụ thuộc
biến `VITE_*`. Chunk app 410 kB (105 kB gzip).

### P0

- [x] **FE-01 · Cả app không có ErrorBoundary.** Một màn lỗi render là trắng toàn trang.
  - Gắn `web/src/ui/chunk-error-boundary.tsx` (đã viết sẵn nhưng chưa dùng ở đâu).
  - Bọc `<Routes>` trong `AppShell` với `resetKeys={location.pathname}`, và bọc thêm ở gốc
    `main.tsx`.
- [x] **FE-02 · Đăng xuất không xoá cache react-query** (`shell/app-shell.tsx:69-71,164`). Người dùng
  kế tiếp trên cùng máy thấy dữ liệu người trước. Gọi `queryClient.clear()` trong `onSettled`.

### P1

- [x] **FE-03 · Phân trang không kẹp trang** khi xoá dòng cuối, hiện "41–40 của 40"
  (`ui/pagination.tsx`, `ui/use-list-url-state.ts`). Đưa `clampPage` của IPAM thành bản dùng chung.
- [x] **FE-04 · `uploadFile` không xử lý 401** (`lib/upload.ts:21-29`). Tách phần xử lý lỗi của
  `apiFetch` thành hàm dùng chung.
- [x] **FE-05 · API 502 lúc tải trang thì bị đá về màn đăng nhập** (`App.tsx:83,100-113`). Hiện
  `LoadError` kèm nút Thử lại.
- [x] **FE-06 · Chuỗi tiếng Việt viết cứng** (vi phạm DoD gạch 6):
  - `accounts-screen.tsx:471,648-649`
  - `import-preview.tsx:23-27,63-67`
  - `schedule-picker.tsx:16-22`
  - `catalog-form.tsx:415-463`
  - `catalog-import-dialog.tsx:19-21`
  - `lib/expiry.ts:80-84`
  - các fallback của `errorMessage`

  Thêm luật lint bắt ký tự có dấu trong JSX.
- [x] **FE-07 · Đăng xuất lỗi thì không có phản hồi.** Thêm `onError`, hoặc ép về màn đăng nhập.

### P2

- [ ] **FE-08 · `rgba()` viết thẳng ngoài `tokens.css`** ở 9 chỗ (`base.css`, `datepicker.css`,
  `form-layout.css:131`, `lightbox.css`, `shell.css`). Tạo token, có cặp dark. Sửa `ops/gate-hex.sh`
  bắt cả `rgb(`/`rgba(`.
  - **Rà 29/09:** còn 7 chỗ trong code: `datepicker.css:155,164,189`, `table.css:313,376,572`,
    `form-layout.css:162`. `base.css`, `lightbox.css`, `shell.css` đã sạch. Cổng vẫn chỉ bắt hex, và
    chú thích "20 chỗ đang nợ" ở `ops/gate-hex.sh:21` đã sai.
- [x] **FE-09 · "Bộ giao diện" (`/dev/components`) tắt ở prod** (Q-15). Cờ build `VITE_DEV_KIT`
  (`web/src/lib/dev-kit.ts`): chỉ `docker-compose.override.e2e.yml` truyền `'1'` (image tag riêng
  `ims-web:dev-kit`) và `vite` dev tự bật. Tắt thì không route (gõ URL ra 404), không mục menu,
  không có trong bảng lệnh, và mã trang không vào bundle. Kiểm: `npm --prefix web run build` rồi
  `grep -c -- --warm web/dist/static/index-*.js` ra 0 (chữ chỉ có trong trang dev); build với
  `VITE_DEV_KIT=1` ra 1. Lazy-load từng route còn lại chưa làm — chưa cần ở cỡ bundle hiện tại.
- [ ] **FE-10 · `retry: 1` áp cả cho 4xx** (`lib/api-client.ts:86`).
  - **Rà 29/09:** còn nguyên (`lib/api-client.ts:105`).
- [x] **FE-11 · Script inline đặt theme** (`index.html:9-18`) cần một hash trong CSP. Làm cùng OPS-04.
  - **Rà 29/09:** xong theo cách khác (1e53e7f): script chuyển ra `web/public/theme-init.js`, nên CSP
    `script-src 'self'` (`web/security-headers.conf:10`) không cần hash. Chưa có E2E kiểm header CSP.
- [x] **FE-12 · Xoá 4 file UI chết:** `date-time-picker`, `time-picker`, `time-field`,
  `photo-lightbox`. Sửa dòng tương ứng trong `SHARED-REGISTRY.md:60` và chú thích ở
  `ui/dialog.tsx:17,269`.


### Đã làm, bổ sung khi rà 29/09

- [x] **FE-13 · Đợt UX mức cao (69 mục) + duyệt mở két trên điện thoại:** bảng thành thẻ gọn trên điện
  thoại, cột dính, hộp thoại bottom sheet, `StickyActionBar`, kiểm form tiếng Việt dùng chung, Tìm
  nhanh (Ctrl+K) tra IP và dải, tìm thiết bị theo IP/người/bộ phận. b1c880f, 226eea4, 974c69e,
  1720a01 (v1.3.0), hoàn thiện 222b7e0 (v1.3.1).
- [x] **FE-14 · Đợt UX mức vừa + nhẹ (454 mục,** AUTH · SHELL · DEV · NET · SW · EX · DP · ADM · VLT ·
  DASH · MISC): bảng điều khiển, trang 403/404 có lối ra, xuất Excel danh mục (ADM-030), lịch sử thiết
  bị hợp nhất (DEV-086). 4fbb723, a565557, 885be2b, dcc09e4 (merge 84026ff, v1.4.0).
- [x] **FE-15 · Nhật ký hệ thống, mở rộng DOM-07:** nhãn hành động tiếng Việt, đối tượng có tên và link,
  lọc nhanh, chip "Chỉ sự kiện an ninh", gộp sự kiện lặp ×N, link "Nhật ký thao tác" từ tab Lịch sử.
  7128607 (v1.3.0), 023150d (v1.4.0), b56203c, ba8e8af, 96a3f62 (v1.4.1).
- [x] **FE-16 · Màn Quyền két theo người + tab Ma trận, "Sao chép quyền từ…", Admin mở được màn.**
  3726b99 (v1.3.0), 9fea00a, 2f1f213 (v1.3.1), 3138346 (v1.4.0).
- [x] **FE-17 · Soát chữ toàn hệ thống: 364 chuỗi** (sai nghĩa, quá dài, không nhất quán, văn phong) ở
  web, lỗi API, email và Excel. 1b00596, e48164e, 80afb8b (merge bda5dea, v1.4.2).

---

## 5. Hạ tầng Docker (Ubuntu)

### P0

- [x] **OPS-01 · `SMTP_HOST` mặc định `mailpit`** ✔ đã tự kiểm (`docker-compose.yml:31`).
  - Đổi thành `${SMTP_HOST:?bắt buộc}`, `${SMTP_PORT:?}`, và để trống trong `.env.example`.
  - Thêm `requireTLS` khi cổng là 587 (`mail-transport.service.ts:28-33`).
- [x] **OPS-02 · `/health` luôn trả ok** ✔ đã tự kiểm (`health/health.controller.ts`).
  - Chạy `SELECT 1` + Redis `PING`, có timeout.
- [x] **OPS-03 · Worker không có healthcheck, không có `on('error')`, SMTP không có timeout**
  (`worker.ts:50-63,83`).
  - Thêm `.on('error')` cho cả 4 đối tượng BullMQ.
  - `connectionTimeout`/`socketTimeout` 30 giây.
  - File heartbeat + healthcheck `find /tmp/hb -mmin -1`.
  - `stop_grace_period: 30s` cho api/worker (không phải 60s): worker tự giới hạn 20 giây chờ
    lượt relay đang chạy (OPS-14), nên 30s đã dư. Heartbeat + `on('error')` nằm trong bootstrap
    `worker.ts`, không có unit test riêng; được kiểm bằng healthcheck compose đang chạy.
- [x] **OPS-04 · nginx làm mất header bảo mật** ✔ đã tự kiểm.
  - `add_header` trong `location = /index.html` và `/static/` làm mất HSTS, `X-Frame-Options`,
    `nosniff`.
  - Đưa header vào một file include, include ở cả ba chỗ.
  - Thêm CSP cho SPA (có hash của script theme).
  - Thêm `server_tokens off`, `gzip on`, danh sách cipher Mozilla intermediate.
- [x] **OPS-05 · Chưa có `.dockerignore`.** `web/Dockerfile` chạy `COPY . .` nên chép `node_modules`
  của máy Windows đè lên kết quả `npm ci`. Thêm `.dockerignore` cho `api/` và `web/`: `node_modules`,
  `dist`, `.env*`, `coverage`, `*.test.*`.
- [x] **OPS-06 · Xoay log + giới hạn tài nguyên.**
  - `logging: json-file, max-size 20m, max-file 5` cho mọi service.
  - `mem_limit` cho api/worker (khoảng 1g), postgres, redis (kèm `--maxmemory`).

### P1

- [x] **OPS-07 · Tách service `migrate` chạy một lần** (`restart: "no"`).
  - `api` `depends_on: migrate: service_completed_successfully`.
  - Bỏ `MIGRATION_DATABASE_URL` khỏi `api`.
  - Có thể gộp luôn `ensureAppRole` vào đây: tránh race khi scale (L1) và không để api giữ quyền
    superuser (SEC-08).
- [x] **OPS-08 · Redis bật AOF** (`--appendonly yes --appendfsync everysec`). Mật khẩu Redis chuyển
  khỏi argv (dùng `REDISCLI_AUTH` hoặc file conf).
- [x] **OPS-09 · Ghim phiên bản image** (minor + digest). Image của app gắn tag theo git SHA để
  rollback được.
- [x] **OPS-10 · Hardening container:**
  - `security_opt: [no-new-privileges:true]`, `cap_drop: [ALL]`.
  - api/worker: `read_only: true` + `tmpfs: /tmp`.
  - web: `nginx-unprivileged`.
- [x] **OPS-11 · SMTP chết quá khoảng 50 phút là thư bỏ luôn** (`queue.constants.ts:16-17`,
  `outbox.service.ts:35,140`).
  - Backoff dài hơn, trần tính theo thời gian (24 giờ).
  - Thêm nút requeue hàng loạt.
- [x] **OPS-12 · CI:**
  - Thêm bước `docker build` cho cả hai image.
  - Thêm `npm audit --omit=dev`.
  - Thêm quét image (trivy).

### P2

- [ ] **OPS-13 · Chuyển lịch `repeat` + `jobId` sang `upsertJobScheduler`** (`worker.ts:88-92`).
  Đổi `SWEEP_EVERY_MS` hiện sẽ sinh ra hai nhịp chạy song song.
  - **Rà 29/09:** còn nguyên (`worker.ts:105-109`).
- [x] **OPS-14 · Worker shutdown không đợi `relayBatch` đang chạy xong.**


### Đã làm, bổ sung khi rà 29/09

- [x] **OPS-15 · `ops/install-ubuntu.sh`: cài prod bằng một lệnh** (RUNBOOK A→D: sinh `.env` và
  secrets, chown/chmod, cert, compose up, tạo 2 SA, cron sao lưu và giám sát; chạy lại không ghi đè).
  0130ec2, v1.0.0. Chưa chạy thật trên Ubuntu trắng — lần đầu sẽ là QA-02.

---

## 6. Sao lưu và khôi phục (DR)

### P0

- [x] **DR-01 · Bản dump khôi phục ra một API không đọc được bảng nào** ✔ đã tự kiểm
  (`ops/backup-nightly.sh:32` có `--no-privileges`).
  - Bỏ `--no-privileges`, **hoặc** thêm `ops/post-restore-grants.sql` chép khối GRANT/REVOKE của
    0048/0049.
  - Thêm vào `restore-drill.sh` phép kiểm `has_table_privilege('ims_app','secret','SELECT')`.
- [x] **DR-02 · Lần backup nào cũng báo HỎNG giả** ✔ đã tự kiểm.
  - `set -o pipefail` + `gzip -dc | grep -q` (`backup-nightly.sh:14,40`) cho SIGPIPE 141.
  - Hệ quả: dòng xoá bản cũ (`:46`) không bao giờ chạy, NAS đầy dần.
  - Sửa: `zgrep -q`, hoặc tắt `pipefail` cục bộ quanh dòng đó.
- [x] **DR-03 · Thiếu thứ cần để khôi phục.**
  - Backup volume `filesdata` (tar sang NAS).
  - In `password_pepper` vào phong bì cùng master key.
  - Cất `.env` (có `APP_DB_PASSWORD`, `POSTGRES_PASSWORD`) ở nơi an toàn.
- [x] **DR-04 · Backup chạy được khi NAS chưa mount.** Đổi `[ -d "$DEST" ]` (`:22`) thành
  `mountpoint -q "$DEST"`. Dump ra file `.tmp`, kiểm xong mới `mv`.
- [x] **DR-05 · Cron không nạp `.env`.** Chạy `pg_dump` bằng `sh -c` bên trong container để dùng
  `$POSTGRES_USER` của container. Sửa tương tự ở `restore-drill.sh:25,31-32,50`.

### P1

- [x] **DR-06 · Mã hoá bản dump trên NAS** (`age` hoặc `gpg`, khoá công khai). Bản dump có PII và
  hash mật khẩu.
  - **Rà 29/09:** không làm, Q-11 chốt không mã hoá, rủi ro chấp nhận.
- [x] **DR-07 · Báo động khi backup hỏng** (mail hoặc webhook).
- [x] **DR-08 · `restore-drill.sh`:** vòng `until pg_isready` cần sleep + timeout; `chown 1000:1000`
  cho `secrets/master_key`.
- [x] **DR-09 · Chặn chạy nhầm `seed-demo.sql`/`unseed-demo.sql` trên prod** (assert môi trường dev).

---

## 7. Giám sát và vận hành hằng ngày

Mảng này hiện gần như trống. Đây là thứ đội ít kinh nghiệm hay quên nhất.

### P1

- [x] **MON-01 · Có người được báo khi hệ thống chết.** Tối thiểu một cron trên host, 5 phút một lần
  gọi `https://ims.pmh.com.vn/health`, lỗi thì gửi mail hoặc Telegram. Tốt hơn: Uptime Kuma (một
  container).
- [x] **MON-02 · Cảnh báo đĩa đầy** (Postgres, log, NAS). Cron `df` quá 85% thì báo.
- [x] **MON-03 · Theo dõi hàng đợi mail:** số dòng outbox `processed_at IS NULL` quá lâu, DLQ khác 0.
- [x] **MON-04 · Hạn cert TLS `*.pmh.com.vn`.** Nhắc trước 30 ngày; có thể tự nhập cert của chính
  IMS vào màn Hạn.
- [x] **MON-05 · Sổ tay trực (1 trang):** xem log (`docker compose logs -f api worker`), khởi động lại
  một service, deploy bản mới, rollback về tag trước, xoay cert.

---

## 8. Test / QA

Test **không** vào image production (api build loại `*.spec.ts`, image web chỉ có nginx + `dist`).
**Không xoá test.** Chúng đang giữ lõi bảo mật: envelope, TOTP replay, lockout, CSRF, step-up.

- [x] **QA-01 (P0) · Mỗi mục P0 ở trên có test đỏ trước, xanh sau.** SEC-01, SEC-02, DB-02 phải có
  bài ở `api/test/` chạy DB thật.
- [ ] **QA-02 (P0) · Diễn tập trọn vòng trên VM Ubuntu trắng.** Dựng từ `.env` mới → seed → nhập 1
  secret + 1 file đính kèm → backup → xoá sạch → restore → mở được secret và tải được file.
- [ ] **QA-03 (P0) · UAT 3–5 ngày với 2–3 người dùng thật** trên staging, dữ liệu thật. Ghi lỗi vào
  một bảng; chỉ go-live khi không còn lỗi mức cao.
- [ ] **QA-04 (P2) · Tách `e2e/tests/di-khap-giao-dien.spec.ts`** (458 KB, khoảng 8.000 dòng) theo
  từng màn; đổi tên bài E2E bị trùng.
  - **Rà 29/09:** file đã lớn thêm, 487 KB, 9.184 dòng. Tên bài trùng: "sắp xếp theo cột chạy ở
    server…" ở `accounts.spec.ts`, `devices.spec.ts`, `software.spec.ts`.
- [ ] **QA-05 (P2) · Gỡ devDependency không dùng:** `supertest`, `@types/supertest`, `@nestjs/testing`,
  `ts-loader`, `tsconfig-paths`.
  - **Rà 29/09:** cả 5 gói vẫn còn và không chỗ nào dùng, gỡ được.

---

## 9. Vệ sinh code (comment, code chết)

Tỉ lệ dòng chú thích: api 30%, web 19%, e2e 28%, SQL 50%. Có hơn 600 chỗ mang tính nhật ký
("Trước 20/09…", "rà soát #N", "Story N.M").

- [x] **CLEAN-01 (P0) · Sửa 3 chú thích đang nói SAI so với code:**
  - `api/Dockerfile:18`: ghi `reset-e2e-user`, file thật là `reset-e2e.mjs`.
  - `SHARED-REGISTRY.md:60`: ghi `DateTimePicker` dùng mọi nơi, thực tế không ai import.
  - `ui/dialog.tsx:17,269`.
- [ ] **CLEAN-02 (P2) · Dọn chú thích kiểu nhật ký**, mỗi module một commit.
  - Bắt đầu từ các file chú thích nhiều hơn code: `security-probe.service.ts`,
    `use-list-url-state.ts`, `device-retirement.registry.ts`, `common/sql.ts`.
  - **Giữ:** chú thích nói VÌ SAO, ràng buộc không được phá, mã luật (AD-x, FR-x, NFR-x).
  - **Bỏ:** ngày tháng, story, "ai sửa", lịch sử. Lịch sử cần giữ thì chuyển vào commit message hoặc
    `EPIC-MAP.md`.
  - **Kiểm:** `api/dist/*.js` trước và sau phải giống hệt nhau, vì build bật `removeComments`.
  - **Không đụng file migration.**
  - **Rà 29/09:** mới dọn lẻ (1c00ba2, 2aefe44, b57775f, và chú thích "trước đây…" của đợt v1.4.2).
    Đếm thô còn khoảng 250 dòng (api 67, web 106, e2e 78).
- [ ] **CLEAN-03 (P2) · Xoá `.pyc` trong `.claude/` khỏi git**, thêm `__pycache__/` vào `.gitignore`.
  - **Rà 29/09:** còn 5 file trong `.claude/skills/bmad-retrospective/scripts/**/__pycache__/`.
- [ ] **CLEAN-04 (P2) · Bỏ `export` thừa:** 20 ở api, 18 ở web (theo knip).
  - **Rà 29/09:** chưa đếm lại — máy chưa cài knip.

---

## 10. Tài liệu và quy trình

- [x] **DOC-01 (P0) · Sửa `docs/RUNBOOK-4.3-dong-dot-1.md` cho đúng một máy Ubuntu trắng:**
  - Thứ tự hiện tại không đi được: A3/B1 cần hệ thống đang chạy, mà deploy lại nằm ở C2. Đổi thành
    **dựng máy → deploy → seed SA → chìa và phong bì → backup → diễn tập → import**.
  - Thêm phần dựng môi trường:
    - cài docker, clone vào `/opt/ims`;
    - tạo `.env` (mật khẩu mạnh, `NODE_ENV=production`, SMTP thật);
    - tạo `secrets/password_pepper` và `secrets/smtp_password`;
    - `chown 1000:1000 secrets/*`, `chmod 600`.
  - Sửa tên file cert: nginx đọc `fullchain.pem`/`privkey.pem` (`web/nginx.conf:16-17`), không phải
    `ims.crt`/`ims.key` (runbook dòng 168-169).
  - "Cả 5 service healthy" chỉ đúng sau khi xong OPS-02/03.
  - Bảng tra lỗi thêm triệu chứng `permission denied` (DR-01).
  - Chu kỳ diễn tập: runbook ghi 6 tháng, `secrets/README.md` ghi mỗi quý. Chọn một.
  - Thêm mục **"Khôi phục production thật"** (DB + `filesdata` + pepper + `.env` + cấp lại quyền).
  - Ghi chú: `shred` vô dụng trên SSD/VM; diễn tập xong thì xoá hẳn VM.
- [x] **DOC-02 (P0) · Kế hoạch ngày go-live:** mẫu ở `docs/KE-HOACH-GO-LIVE.md`, **chủ dự án điền người và giờ**. giờ bắt đầu, ai làm gì, điểm quyết định rollback,
  thông báo người dùng.
- [x] **DOC-03 (P1) · Cập nhật `CLAUDE.md`:**
  - Bỏ số liệu trạng thái đã sai ("7 epic done, 40 migration", thực tế epic 4 còn `in-progress` và
    có 59 migration); trỏ sang `sprint-status.yaml`.
  - Thêm luật chú thích (mục 9) và luật migration sau go-live (mục 3).
  - Thêm mục Production/Ubuntu: không chạy `ci-local.sh`, `seed-demo.sql`, `reset-e2e.mjs` trên máy
    prod.
  - Luật màu phải khớp cổng kiểm (FE-08).
  - Gộp phần graphify đang lặp giữa hai file `CLAUDE.md`.

---

## 11. Thay đổi nghiệp vụ đã chốt (xem `docs/QUYET-DINH.md`)

Đã chốt với chủ dự án ngày 26–27/09. DB production chưa có dữ liệu, nên đổi bây giờ là rẻ nhất.
**Làm trước khi import dữ liệu thật.**

### P0

- [x] **DOM-01 · Master key: công cụ rewrap** (Q-07).
  - Lệnh `node dist/ops/rewrap.main.js` (`--check` để đếm): chạy lại được nếu bị ngắt, xử lý theo lô, mỗi lô một transaction.
  - Có phép kiểm "còn N bản ghi dùng chìa X".
  - API không khởi động nếu thiếu chìa mà dữ liệu vẫn cần.
  - Test bảng dữ liệu cho `rewrap()` và một bài `api/test/` chạy trên DB thật.
  - Mục runbook "Xoay chìa khi nghi lộ".
- [x] **DOM-02 · IP còn 2 trạng thái: Trống / Đang dùng** (Q-02).
  - Migration đổi CHECK: `suspect_dead` → `assigned`, `reclaimed` → `free`.
  - Sửa `ip-lifecycle.ts`: nút Thu hồi đưa về Trống.
  - Sửa màn, i18n và E2E.
- [x] **DOM-03 · Phần mềm còn 3 trạng thái, tự chuyển** (Q-03).
  - Đổi nhãn: `expired_ok` thành "Hết hạn", `retired` thành "Thanh lý".
  - Job hằng ngày chuyển `active` → `expired_ok` khi `end_date < hôm nay`, có ghi `software_history`
    với actor `system`.
  - Gia hạn có ngày mới thì tự về `active`.
  - `expired_ok` không vào mail; vẫn hiện trên dashboard/màn Sắp hết hạn trong thời gian ân hạn
    (Q-13 thay cho câu cũ "không vào dashboard"). Thay thế BE-06.
- [x] **DOM-12 · Tự Thanh lý sau ân hạn, khôi phục bằng Sửa** (Q-13).
  - `software.auto_retire_grace_days` (0076, mặc định 30, 0 = tắt). Lượt quét của worker chuyển
    `expired_ok` quá ân hạn sang `retired`, gỡ mọi ghế, lịch sử `auto-retired` của `system`.
  - Sửa hồ sơ đã Thanh lý về Đang dùng chỉ được khi hạn mới từ hôm nay trở đi
    (`RESTORE_NEEDS_FUTURE_END`). Nút Gia hạn vẫn chặn hồ sơ đã Thanh lý (BE-13).
  - Kiểm: `api/test/software-auto-retire.spec.ts`, E2E `software.spec.ts` hai bài Q-13.
- [x] **DOM-04 · ISP bỏ ngày kết thúc** (Q-04).
  - Gỡ `ispSource` khỏi registry nhắc hạn (`software-expiry-sources.ts:58`) và bỏ gia hạn ISP.
  - Trạng thái `terminated` hiện là "Thanh lý", ghi ngày và người thanh lý.
  - Cột `end_date` giữ trong DB (migration chỉ tiến) nhưng không còn trên form hay màn.
- [x] **DOM-05 · Đăng nhập sai: chậm dần theo tài khoản** (Q-06). Gộp với SEC-03.

### P1

- [x] **DOM-08 · Nhãn IP "Đang cấp" → "Đang dùng"** (Q-10).
- [x] **DOM-09 · ISP đã Thanh lý hiện trong Kho thanh lý** (Q-10).
- [x] **DOM-10 · Gỡ loại `isp` khỏi luật mail nhắc hạn cũ** (Q-10).
- [x] **DOM-11 · Member được tạo/sửa mọi danh mục** (Q-12): mở `@Roles` tạo/sửa của catalog cho
  `member`; vô hiệu hoá/xoá/nhập Excel vẫn SA/Admin; web hiện nút Thêm/Sửa cho member; E2E.
- [x] **DOM-06 · Mail duyệt break-glass trỏ thẳng tới yêu cầu cụ thể** (`mail.consumer.ts:137`), thay
  vì mở cả màn duyệt. Vẫn phải đăng nhập và qua TOTP.
- [x] **DOM-07 · Màn Nhật ký (audit log) chưa có giao diện.** Menu đánh dấu `planned`
  (`shell/app-nav.ts:62`), route `/admin/audit-log` chưa được dựng. API thì đã có. Với hệ thống
  giữ két mật khẩu, SA cần xem được nhật ký mà không phải dùng psql.

### Đã làm, bổ sung khi rà 29/09

- [x] **DOM-13 · Bỏ tự đặt lại mật khẩu qua email và mã dự phòng** (Q-14): màn đăng nhập hướng dẫn liên
  hệ quản trị qua `auth.support_contact`. dd7249e, e81baca (v1.3.0, v1.3.1).
- [x] **DOM-14 · Hồ sơ của tôi** (Q-14): tự đổi mật khẩu, tự cài lại 2 lớp trên điện thoại mới, xem và
  đóng phiên khác của mình; đăng nhập xong về đúng trang đã mở. dd7249e, e673629, a115bec (v1.3.0).
- [x] **DOM-15 · Màn Tham số hệ thống `/admin/settings`** (Q-14, ADM-088): chỉ SA, có step-up, mọi lần
  sửa ghi nhật ký, chỉ sửa khoá có trong danh sách khai báo. 9e4584e (v1.3.0), 7a7705e. Kiểm: E2E
  `tham-so-he-thong.spec.ts`.
- [x] **DOM-16 · Hồ sơ IP phải có chủ; loại thiết bị có cờ Router/Firewall cho ô Router của NAT**
  (Q-14). 18a04c2 (NET-001..005), 3b9f9ee (NET-041), v1.3.0.
- [x] **DOM-17 · "Đã thanh lý" (trạng thái) và "Thanh lý" (nút); phần mềm loại "Khác" có hạn là nguồn
  hạn** (Q-14). 09f7280, de2c562, v1.4.0.
- [x] **DOM-18 · Thuật ngữ Q-15:** "Xin mở két / Duyệt mở két", "Ngừng dùng / Dùng lại", "luật NAT /
  cổng ngoài / cổng trong", "Người dùng IMS", viết "khóa/hóa" — ở web, lỗi API, email, Excel.
  29be501, 786b5f1, v1.4.1.
- [x] **DOM-19 · Quyền mở két gắn với phiên** (Q-15): yêu cầu chờ không gắn phiên, lần Xem đầu gắn
  quyền vào phiên đang xem, người xin tự Trả quyền, chờ quá `breakglass.pending_expire_hours` (8) thì
  tự hết hạn. f27c4e0, 8a2dd5e, fe7b5cb (v1.4.1). Kiểm: `api/test/break-glass-session.spec.ts`.
- [x] **DOM-20 · Hạn đổi mật khẩu két 180 ngày:** cột "Đổi lần cuối" + đếm ngược; gộp ba hộp xem két
  thành một hộp chạy theo bước (Q-15). ec94da0, 3160411, 7bd87ee (migration 0150), v1.4.0–v1.4.1.
- [x] **DOM-21 · Gia hạn ghi số hợp đồng và chi phí vào sổ gia hạn, kể cả từ màn Sắp hết hạn; SSL /
  tên miền ghi website theo từng kỳ** (Q-15). 8f08609, 3763601, 0872ab2, 62e2274 (v1.4.0–v1.4.1).
- [x] **DOM-22 · Các điểm nhỏ còn lại của Q-15:** Xóa hồ sơ IP nhập nhầm; danh mục "Ngừng dùng / Dùng
  lại" kèm số "đang dùng ở N …"; mở lại thiết bị đã thanh lý thì về "Đang dùng"; gán license chọn
  nhanh theo phòng ban hoặc người; luật NAT không có hạn rà lại. 0e16c5a, 3f74fe1, 93cf1ed, 1837027
  (v1.4.1).

### Còn chờ chủ dự án

- [x] **SEC-12:** (Q-11: đúng chủ ý) member có được đính file vào đối tượng mà họ chỉ có quyền đọc không?
- [x] **DR-06:** (Q-11: không mã hoá, rủi ro chấp nhận) mã hoá bản dump bằng công cụ gì, và ai giữ khoá?
- [x] **OLD-DB-01:** (Q-11: nhà mạng bắt buộc, phòng ban tự do) có bắt buộc chọn phòng ban và nhà mạng từ danh mục không? (liên quan FK, xem
  mục 12)
- [x] Màn Admin sửa `system_config` (hoãn 4 lần): làm, hay tiếp tục sửa qua psql? → **Đã làm** (Q-14,
  DOM-15).
- [x] Nút Xuất Excel cho `/service-accounts`, `/disposal`, `/admin/accounts`: thêm, hay ghi rõ lý do
  không có? → **Đã thêm cả ba** (7db34a1, 3edeb07, 3fe2912; v1.4.0). E2E mới phủ file xuất của
  `/service-accounts`; `/disposal` và `/admin/accounts` chưa có bài kiểm file xuất.

---

## 12. Nợ cũ còn mở từ các đợt rà soát trước

Các sổ nguồn đã xoá ngày 27/09 và vẫn còn trong lịch sử git. Một số chú thích trong `eslint.config.mjs`,
`e2e/` và `ops/` còn trỏ tới tên các sổ đó; sẽ dọn trong CLEAN-02.

Đối chiếu ngày 26/09 giữa code hiện tại và `RA-SOAT-UI-UX-2026-09-12.md`,
`NO-KY-THUAT-LOW-2026-09-19.md`, `RA-SOAT-TOAN-DIEN-2026-09-19.md`, `CAN-XAC-NHAN.md`:

- Sổ UI/UX: **38/39 mục đã xong thật**.
- Sổ toàn diện: đã mở code kiểm ngẫu nhiên khoảng 30 ô đã tick, cả 30 đều đúng.
- Những mục đã có ở các mục 1–10 (timeout SMTP, sweep grant, rewrap, tuning Postgres, lazy-load…)
  không lặp lại ở đây.

### P1

- [x] **OLD-DB-01 (CAO) · Không có FK cho `department`, `isp_provider`, `service_port`.** Không có
  `REFERENCES` nào; xoá danh mục luôn thành công và để lại chuỗi mồ côi. Cần một story riêng, kèm
  quyết định sản phẩm ở mục 11.
- [x] **OLD-DB-02 · `device_port` thiếu UNIQUE `(connected_device_id, connected_port)`**, trái AD-14.
- [ ] **OLD-DB-03 · `audit_log` chưa phân vùng theo tháng và chưa có đường lưu trữ.** Bảng này chỉ
  thêm, không bao giờ xoá; phân vùng lúc còn nhỏ rẻ hơn nhiều so với lúc đã lớn.
  - **Rà 29/09:** còn nguyên, chưa có phân vùng lẫn đường lưu trữ.
- [x] **OLD-BE-01 · Mail in giờ GỬI thay vì giờ sự kiện**; `toLocaleString` không ghim múi giờ
  (`mail.consumer.ts:227,281,323,352`).
- [x] **OLD-BE-02 · Kho thanh lý cắt im lặng ở 500 dòng** (`devices.api.ts:106`, `software.api.ts:54`,
  `service-accounts.api.ts:29`).
- [x] **OLD-FE-01 · `/admin/vault-access` rộng 2253px, không có dấu hiệu còn cột bị khuất.** Cần kiểm
  trên trình duyệt thật.
- [x] **OLD-FE-02 · Phân trang chỉ có ‹ x/y ›**, không nhảy được tới trang (`pagination.tsx:77`).
- [x] **OLD-A11Y-01 · Trợ năng mức vừa:**
  - Mục menu "sắp có" là `<span aria-disabled>` không có role (`app-shell.tsx:123-127`).
  - Lý do nút bị khoá chỉ nằm trong `title=` (`import-dialog.tsx:110,121`, `vault-panel.tsx:292`).
  - Date-picker: popover không có tên, không dời tiêu điểm vào, không điều hướng được bằng phím mũi
    tên (`date-picker.tsx:225`).
  - Ô Thao tác của NAT thiếu `data-label` ở 390px (`nat-screen.tsx:209`).
- [x] **OLD-QA-01 · `users` và `disposal` chưa có unit/DB test**; `approvals` gần như không có test.
- [x] **OLD-QA-02 · `history-action-rollcall.test.ts:57` chỉ quét `recordWithin(`**, bỏ sót
  `appendWithin` và `@Audited`.
- [x] **OLD-QA-03 · E2E sinh tên bằng `Date.now().toString().slice(-6)` ở 192 chỗ** (41 file); hai lượt
  chạy gần nhau có thể trùng tên.
- [x] **OLD-DOC-01 · Chú thích sai nguy hiểm** ở `date-picker.tsx:98` và `time-field.tsx:80` ("capture +
  stopPropagation chặn Radix Dialog"). Ai tin nó mà gỡ phần giữ form thì mất dữ liệu đang gõ.

### P2

- [ ] **OLD-FE-03 · Khoảng 550 dòng CSS chết:**
  - `primitives.css:37`, `detail-tabs.css:519`, `form-layout.css:531`, `table.css:375-386`.
  - `filters.css` và `profile.css` vẫn được `@import`.
  - **Rà 29/09:** còn nguyên. `filters.css` (50 dòng) và `profile.css` (224 dòng) chết toàn bộ, vẫn
    `@import` ở `web/src/index.css:15,17`; số dòng cũ ở trên đã lệch.
- [ ] **OLD-FE-04 · Icon kính lúp giữ màu xám ở dark mode** (`base.css:38`, `detail-tabs.css:379`,
  `shared-kit.css:916`).
  - **Rà 29/09:** còn nguyên, cả ba icon SVG vẫn `stroke='%238a908a'` (`base.css:48`,
    `detail-tabs.css:599`, `shared-kit.css:1592`), chưa có bản đè `html[data-theme='dark']`.
- [ ] **OLD-FE-05 · Lỗi nhỏ ở dialog:** thiếu Provider khi hộp không có title; `guardUnsaved` thành
  no-op trong trường hợp đó (`dialog.tsx:~400-437`).
  - **Rà 29/09:** còn nguyên (`dialog.tsx:422`).
- [ ] **OLD-FE-06 · Còn thiếu:**
  - `/nat` và `/disposal` chưa phân trang.
  - `/expiry` chưa sắp theo cột ở server.
  - `attachment-panel.tsx:103` dùng `getQueryData` thay vì `useMe()`.
  - Interval của `RevealDialog` bị dựng lại mỗi lần render.
  - **Rà 29/09:** xong 3/5 — `/disposal` phân trang (3edeb07), `/nat` phân trang phía client (126ba90),
    `/expiry` sắp theo cột ở server (dc08311). Còn `attachment-panel.tsx:124` (`getQueryData`) và
    interval `RevealDialog` (`reveal-dialog.tsx:143`).
- [ ] **OLD-FE-07 · Câu chữ:**
  - "Break-glass" còn để tiếng Anh ở KPI.
  - "Tất cả" lẫn với "Mọi".
  - Còn sót chữ "seat" (`vi.ts:606-607,1415,1420`).
  - Hai tiêu đề chồng nhau ở phần mềm (`device-detail.tsx:691`).
  - Câu `incidentsNotYet` nói một ý hai lần.
  - Thẻ dải đã tắt thiếu `voidedBy`.
  - **Rà 29/09:** xong 4/6 — "Break-glass" ở KPI, chữ "seat", hai tiêu đề chồng, `incidentsNotYet`
    (a565557, fb6c981, 6a780e1, 8bfa5c3). Còn "Tất cả loại" lẫn "Mọi loại" (`vi.ts:886,1147` với
    `629,1230`) và thẻ dải đã tắt ở danh sách (`ipam-screen.tsx:443`) chưa có người tắt.
- [ ] **OLD-A11Y-02 · Trợ năng mức nhẹ:**
  - `.segmented` dùng `aria-pressed` thay vì radiogroup.
  - Ma trận quyền thiếu `scope`.
  - Nhảy từ h1 xuống h3 (`port-map-panel.tsx`).
  - Nhãn `td::before` thừa hưởng font mono.
  - `.cell-note` chỉ đọc được nội dung đầy đủ qua `title`.
  - **Rà 29/09:** xong font `td::before` (af00c3a). Ma trận quyền mới có `scope="row"`, header cột còn
    thiếu `scope`. Ba ý còn lại còn nguyên.
- [ ] **OLD-BE-03 · Ghi nhật ký:**
  - `@Audited` khai sai tên (`accounts.controller.ts:167`, `catalog.controller.ts:146`).
  - `FIELD_LABEL` thiếu `token`/`currentPassword`/`newPassword` (`validation-messages.ts:37`).
  - `DevicePortsService` ghi lịch sử mà không kiểm hàng có bị sửa hay xoá thật không.
  - **Rà 29/09:** còn nguyên. Tên `@Audited` của catalog lệch có chủ ý (chú thích
    `catalog.controller.ts:102-106`) — cần chốt giữ hay đổi.
- [ ] **OLD-DB-04 · Dọn và chuẩn hoá DB:**
  - Bỏ index `audit_log_actor_trgm` (11 MB, 0 lượt quét).
  - `isp_line.wan_ip` đang là `text`.
  - `device_port.vlan` là `text` trong khi `subnet.vlan` là `integer`.
  - **Rà 29/09:** còn nguyên cả ba ý.
- [ ] **OLD-SEC-01 · Probe không gửi thư lần hai** khi kẻ dò vượt ≥3× ngưỡng trong thời gian nghỉ.
  - **Rà 29/09:** còn nguyên.
- [ ] **OLD-QA-04 · Thêm luật lint chặn chuỗi tiếng Việt cứng; đổi tên các định danh tiếng Việt
  còn lại** (9 tên tệp, khoảng 175 định danh test).
  - **Rà 29/09:** xong vế luật lint (`NO_VIETNAMESE_TEXT`, 25bf181; kiểm ở `web/src/lint-rules.test.ts`).
    Vế đổi tên còn: `quetNguon`, `timVaChoLoc`, `moTimNhanh`… ở 27 file.
- [ ] **OLD-QA-05 · Chưa có bài kiểm cho đường `onExpire` của `RevealDialog`.**
  - **Rà 29/09:** còn nguyên.

Chưa đối chiếu: 13 mục trong `_bmad-output/implementation-artifacts/deferred-work.md`. B-16 và B-19
cần người mở trình duyệt thật để đo.
