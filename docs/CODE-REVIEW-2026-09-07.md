# Rà soát toàn hệ thống — 07/09/2026

Bảy chuyên gia soi song song, chỉ-đọc, mỗi người một góc, không ai đọc kết quả của ai. Tất cả
đều bắt đầu từ bản đồ `graphify-out/` vừa dựng lại (**3548 node · 8129 edge · 276 community**)
và đều được dặn đọc `docs/CODE-REVIEW-2026-08-28.md` trước để không báo lại thứ đã biết.

Đây là lượt rà soát thứ hai, chạy **sau** khi nhánh `fix/code-review-2026-08-28` đã gộp vào
`master` (`89ed924`) và đã đẩy lên GitHub. Nên nó trả lời được một câu mà lượt trước không trả
lời được: **những hàng rào vừa dựng có thật sự canh được không.**

Câu trả lời ngắn: **hai trong số chúng có lỗ, và lỗ nằm đúng chỗ dễ đi vào nhất.**

---

## 1. Bảng điểm

| Lĩnh vực | 28/08 | 07/09 | Điều đã đổi |
| --- | --- | --- | --- |
| Bảo mật (auth · crypto · RBAC) | 8.5 | **7.5** | Lõi mã hóa vẫn không một lỗi, `RolesGuard` phủ đủ **135/135** route. Nhưng hai lỗ ở *rìa* xác thực nay đã được xác minh, không còn là nghi ngờ |
| Kiến trúc backend (AD-1..15) | 7.0 | **7.0** | Cổng AD-2 sống lại thật, nhưng **lách được bằng `../../modules/x/y`** — hàng rào có thể chết lần hai |
| Kiến trúc frontend | 7.0 | **7.0** | web có cổng lint lần đầu; nhưng luật cấm `window.confirm` **khớp 0 chuỗi** — lặp đúng lỗi cũ ở phía web |
| React · UX · a11y · responsive | 6.5 | **6.5** | M3 sửa 1 chỗ, còn **6 chỗ**; thêm 2 lỗi a11y nặng ở component dùng chung |
| Nghiệp vụ · transaction · outbox | 6.0 | **6.5** | 5 chỗ M2 đã sửa và **có E2E chứng minh**; nhưng tìm thêm 6 chỗ Chặn mới ở tầng auth/import |
| Cơ sở dữ liệu · migration | 6.0 | **6.5** | 40/40 migration chạy sạch trên DB trắng (đã dựng container tạm kiểm thật); 0039 bịt được cả đường vòng CASCADE |
| Kiểm thử · DoD · CI | 6.0 | **6.0** | Có remote + CI thật. Nhưng phát hiện **4 bài test xanh mà không kiểm gì** |
| **Tổng hợp** | **6.5** | **6.8** | **Đã tốt lên thật, nhưng chưa sẵn sàng cho dữ liệu thật.** |

Điểm nhích lên là điểm thật: outbox, envelope crypto, schema, `RolesGuard`, 260 bài E2E, cổng
AD-2 regex — tất cả đều đứng vững qua lượt soi thứ hai. Cái kéo điểm xuống không phải chất lượng
code, mà là **những hàng rào tưởng đã dựng xong nhưng chưa canh được**.

---

## 2. Bốn hình dạng lỗi lặp lại (mới)

Năm mẫu M1..M5 của bản 28/08 vẫn đúng. Bốn mẫu dưới đây là **mới**, mỗi mẫu được ít nhất hai
chuyên gia tìm ra độc lập.

### N1 — Hàng rào dựng ở một chỗ, không áp cho chỗ tương đương ngay bên cạnh
*(Bảo mật · Nghiệp vụ — hai người, cùng ví dụ)*

| Cửa được canh | Cửa tương đương bị bỏ quên |
| --- | --- |
| `POST /auth/step-up` — `@Throttle 10/phút` + đếm sai + thu hồi phiên | `POST /auth/login/totp` — **không có gì cả**, chỉ vướng trần chung 300/phút |
| `POST /vault/secrets/:id/reveal` — `StepUpGuard` + `@RequiresStepUp` | `POST :id/rotate`, `DELETE :id` — **ghi đè** mật khẩu két không cần step-up |
| `break-glass.cancel()` — kiểm người hủy ≠ người xin | `break-glass.approve()` — **không kiểm**, tự duyệt được |
| Ma trận `access_list` ba tầng cho két | `GET /files/:id/download` — **không kiểm chủ thể**, member tải được mọi đính kèm |
| `nat-rule.update()` — có `isNull(voidedAt)` + 8 dòng giải thích | `nat-rule.voidRule()` — **thiếu**, ngay dưới nó |

Đây là mẫu M4 của bản cũ ("lời hứa không có code") ở dạng nguy hiểm hơn: **code có thật, chỉ là
không được áp đủ chỗ**. Người đọc thấy hàng rào ở cửa A rồi tin cả nhà đã khóa.

### N2 — Cổng tự động khớp 0 chuỗi, lần thứ hai
*(Kiến trúc · Kiểm thử — hai người, hai cổng khác nhau)*

- `web/.oxlintrc.json:30-42` cấm `confirm`/`alert` bằng `no-restricted-globals` — rule đó chỉ
  khớp **định danh trần**, không khớp `window.confirm(...)`. Đã probe thật: file có
  `window.confirm('x') && window.alert('y')` → **oxlint exit 0**, không một dòng cảnh báo. Mà
  `window.confirm` chính là cách `CLAUDE.md` viết ra khi cấm.
- `api/ad2-boundary.js:36` neo `^\.\./[^./]` nên `'../../modules/users/users.service'` **lọt**.
  Đã chạy thẳng engine ESLint để chứng minh, và đã dựng project TS riêng để xác nhận cách viết
  đó **biên dịch và chạy thật**. depcruise không đỡ được nhánh này (không luật nào phủ
  nghiệp-vụ→nền). Đường lách: dev bị eslint chặn → thêm `../` → CI xanh toàn tập.

Bản 28/08 đặt tên mẫu này là M1 và bảo đã sửa. Nó quay lại ở hai cổng mới dựng.

### N3 — Transaction thứ nhất commit, transaction thứ hai hỏng, dữ liệu mất vĩnh viễn
*(Nghiệp vụ · Kiểm thử — hai người)*

Cùng họ với M2 nhưng khác cơ chế: không phải đua, mà là **hai transaction rời** cho một việc
không tách được.

| Chỗ | Mất gì khi tx thứ hai hỏng |
| --- | --- |
| `auth.service.ts:107-124` khóa tài khoản | `locked_until` đã commit, **email báo SA không bao giờ gửi** — và không có đường bù, lần sau bị chặn trước khi tới `justLocked` |
| `expiry.service.ts:109-127` `renew` | `end_date` đã đổi, `renewal_history` + audit không có |
| `expiry-digest.runOne` | **đã sửa trong lượt này** |

### N4 — `catch` rỗng làm bài test xanh cả khi hạ tầng không tồn tại
*(Kiểm thử — một người, nhưng đủ nặng để tách riêng)*

`e2e/tests/audit-log.spec.ts:104-113` và bản sao ở `ip-lifecycle.spec.ts:170-179`:

```ts
try { execSync(`${COMPOSE} exec -T postgres psql ... -c "${sql}"`); }
catch { blocked = true; }
expect(blocked).toBe(true);
```

`catch` rỗng nuốt **mọi** nguyên nhân: docker chưa chạy, sai tên container, không có `psql`, gõ
sai tên bảng. Đây là bài **duy nhất** giữ migration `0039` (trigger chặn `TRUNCATE audit_log`)
khỏi bị gỡ ra — và nó xanh cả khi Postgres không tồn tại. Chú thích ngay trên nó tự viết *"bài
này là thứ giữ cho nó không bị gỡ ra"*.

---

## 3. Finding mức Chặn

Sắp theo thứ tự nên sửa. Ba cái đầu tôi **tự xác minh lại** ngoài báo cáo của chuyên gia.

| # | Finding | Vị trí | Hậu quả |
| --- | --- | --- | --- |
| 1 | **`X-Forwarded-For` giả mạo được** ✅đã xác minh | `auth.controller.ts:196` ↔ `web/proxy-api-headers.conf:5` | nginx dùng `$proxy_add_x_forwarded_for` (**nối thêm**), code lấy phần tử **trái nhất** = đúng thứ client tự khai. Kẻ có mật khẩu gửi kèm `X-Forwarded-For: 192.168.1.77` + UA phổ thông → băm thiết bị trùng → **không có email "đăng nhập từ thiết bị mới"**. Đó là cái chuông duy nhất nạn nhân được nghe. Cộng: mọi `audit_log.detail.ip` và `sessions.ip` mang giá trị nghi phạm tự điền. `X-Real-IP` (nginx **ghi đè** bằng `$remote_addr`, không giả được) đang có sẵn mà không dùng. |
| 2 | **Cổng 2FA lúc đăng nhập không có bộ đếm, không trần riêng** ✅đã xác minh | `auth.controller.ts:63-65` vs `:124` | `/auth/step-up` có `@Throttle 10/phút` + `registerStepUpFailure` + thu hồi phiên, kèm 5 dòng chú thích giải thích vì sao. `/auth/login/totp` **không có gì**. `markLoginSuccess` đã reset `failed_attempts` nên lockout không liên quan. 300 lần đoán/phút vào đúng một tài khoản, phiên chờ không bao giờ chết. Nặng thêm: `verifyLoginTotp` **không kiểm `session.totpPending`**, và `completeTotpWithin` đóng dấu `steppedUpAt` → đây là **cửa step-up thứ hai, không được canh**. |
| 3 | **`audit_log.ip` vẫn NULL trên 100% số dòng** ✅đã xác minh | `0004_audit_log.sql:8` ↔ `audit.schema.ts` | Cột có trong migration, **không có trong bảng drizzle** → `toRow()` không map, interceptor **đang cầm `request` trong tay** mà không ghi, `SELECT` không lấy. Bản 28/08 ghi rõ việc này nằm trong `0039`; thực tế chỉ phần `u.sub` được làm. Bảng chỉ-thêm nên **không vá ngược được** — mỗi ngày trôi là thêm một ngày "từ đâu" vĩnh viễn rỗng. NFR-03. |
| 4 | **Audit của việc mở két đi qua hàm nuốt lỗi** | `vault.service.ts:296` → `audit-writer.service.ts:25-34` | `append()` bọc `try/catch` chỉ log rồi đi tiếp. Controller khai `writtenByService: true` nên interceptor bỏ qua → **đây là writer duy nhất**. INSERT hỏng thì `reveal()` vẫn trả plaintext, dấu vết chỉ còn một dòng log container. Cùng lỗi ở `files.service.ts:115,154`. Chú thích ngay trên nó hứa *"ghi TRƯỚC khi trả giá trị"*. |
| 5 | **Bộ đếm sai mật khẩu là read-modify-write ngoài tx** | `auth.service.ts:63` → `:100-110` | Argon2 mất ~200ms. Bắn 20 request song song cùng email: cả 20 đọc `failed_attempts = 0`, cả 20 ghi `1`. **20 lần đoán tốn 1 lượt đếm.** Repo đã làm đúng ở `session.service.ts:92` (`SET stepup_failures = stepup_failures + 1`) — chỉ đường login không áp. |
| 6 | **Thu hồi IP không kiểm rule NAT đang sống** | `ip-address.service.ts` ↔ `nat-rule` (0 dòng nối) | Rule `TCP 8080 → 172.16.10.5` "camera tầng 2". Camera chết → thu hồi `.5` (không cảnh báo). Tuần sau `.5` cấp cho laptop kế toán. **Port 8080 vẫn mở và giờ trỏ vào laptop kế toán.** FK là `SET NULL` nhưng ẩn/thu hồi là soft-delete nên không bao giờ bắn. AC 5.3. |
| 7 | **Gia hạn từ màn hồ sơ không ghi `renewal_history`** | `software.service.ts:194` · `isp-line.service.ts:242` | Web có **hai** nút gia hạn; đường `/expiry/renew` ghi đúng, đường `/software/:id/renew` **không**. `end_date` đổi, toast xanh, mọi thứ trông đúng — nhưng báo cáo cuối năm và khối dashboard trả rỗng. Bảng append-only. AC 3.4. |
| 8 | **Cổng web không bắt được `window.confirm`** | `web/.oxlintrc.json:30-42` | Xem N2. Đã probe: exit 0. |
| 9 | **Cổng AD-2 lách được bằng `../../modules/`** | `api/ad2-boundary.js:36` | Xem N2. Ghép với ngoại lệ `users.schema.ts` quá rộng ở `.dependency-cruiser.cjs:83` (không ràng buộc `from`) thì `import { usersTable } from '../../modules/users/users.schema'` **qua sạch cả hai cổng** → đường ngắn nhất phá AD-3. |
| 10 | **Import: đối chiếu ngoài tx + `updateWithin` không kiểm 0 dòng** | `catalog-import.service.ts:58` · `catalog.service.ts:428` · `device-import.service.ts:92` | A bấm "Kiểm tra" (plan nói *cập nhật 1*), B xóa bản ghi đó, A bấm "Xác nhận ghi" → `UPDATE ... WHERE id = <đã chết>` khớp 0 dòng, **không lỗi**, `updated += 1`, audit ghi một sự kiện **chưa từng xảy ra**. Ở devices còn tệ hơn: `{...undefined}` không ném, `diffDevice` so với object rỗng → `device_history` ghi "mọi trường đổi từ trống", nội dung lịch sử **bịa ra**. |
| 11 | **Bảng điều khiển: khối lỗi biến mất, không một lời nào** | `dashboard.service.ts:142,300` · `dashboard-screen.tsx:172` | Một cờ `available` mang **hai** nghĩa: "Member không có quyền" và "khối này hỏng". Web chỉ ẩn hẳn. SA mở bảng thấy 4 khối thay vì 6 → tin là tuần qua không có yêu cầu break-glass nào. `unavailableText` ở hai chỗ là **code chết**. Đúng finding #7 của 28/08 ở màn khác. |
| 12 | **Màn phiên đăng nhập nuốt lỗi API** | `accounts-screen.tsx:436` | **Đã báo 28/08, chưa sửa.** SA nghi tài khoản bị chiếm, mở "Phiên đăng nhập", API 500 → hiện **"Chưa có dữ liệu"** → kết luận kẻ tấn công đã bị đá ra. `LoadError` đã import sẵn ở dòng 13. |
| 13 | **Khu mở rộng của trang thiết bị nuốt lỗi** | `device-detail.tsx:74` | `/devices/:id/panels` lỗi → biến mất **toàn bộ** khu Phần mềm / IP / Két, trang vẫn trông hoàn chỉnh. Người dùng cấp lại IP đã cấp, mua thêm seat máy đã có. |
| 14 | **Migration runner test chạy bằng Pool GIẢ** | `migration-runner.spec.ts:23-33` | Fake `query` luôn trả `{rows:[], rowCount:0}` và không bao giờ ném. `CREAT TABEL` vẫn xanh. **40 file SQL chưa từng được Postgres parse trong bất kỳ bài test nào**, và CI GitHub không dựng Postgres. DoD gạch 5 có **0 cơ chế kiểm chứng**. Ba nhánh nguy hiểm nhất của runner (checksum drift · ROLLBACK · index INVALID) chưa chạy một dòng. |
| 15 | **`OutboxService` có 0 test** | `api/src/modules/outbox/` | Không một file spec nào. `relayBatch` (`FOR UPDATE SKIP LOCKED` + lease), `markProcessed`, `markFailed`, `requeue` — toàn bộ ngữ nghĩa exactly-once chưa từng được chứng minh, trong khi AD-5 bắt **mọi** ghi phải đi qua nó. Bản 28/08 khen outbox là "phần tốt nhất của backend" — nó tốt vì **đọc** đúng, không vì có ai kiểm. |
| 16 | **`e2e/` không có cổng nào** | `e2e/` | Không `tsconfig.json`, không lint, không nằm trong `npm run lint` lẫn `npm run build`. Mọi luật E2E trong `CLAUDE.md` (không `sleep`, cấm CSS class selector, ưu tiên `getByRole`) có **0 cưỡng chế** — và cả ba đều đã bị vi phạm nhiều chỗ. Đây là cơ chế đã để lọt `__dirname` trong gói ESM hôm 03/09. |

---

## 4. Bẫy đáng sợ nhất, tuy chưa nổ

**`.gitattributes` — một dòng có thể làm production không boot được.**

`migration-runner.ts:63` băm **byte thô** của file; lệch checksum thì `throw`, và migration chạy
**trước** `app.listen`. Trạng thái repo hiện tại:

```
git config core.autocrlf   → false
ls .gitattributes          → không có
git ls-files --eol         → 39 file i/lf,  1 file i/crlf (0003_sessions.sql)
```

Hôm nay an toàn vì git lưu byte y nguyên. Nhưng repo đang **trộn kiểu xuống dòng** và **không có
gì khóa nó lại**. Một người dọn dẹp thêm `.gitattributes` với `* text=auto` — việc rất thường
gặp — thì `0003_sessions.sql` đổi CRLF→LF, checksum đổi, và **mọi DB đã chạy migration đó không
khởi động lại được**. Thông điệp lỗi khuyên "tạo migration mới": đúng cho mọi trường hợp khác,
**sai hoàn toàn** cho trường hợp này. Đường thoát duy nhất là `UPDATE _migrations` bằng tay trên
production.

**Sửa: một dòng.** `api/src/migrations/*.sql -text` trong `.gitattributes`. **Không** đổi hàm
checksum — đổi là làm hỏng đúng thứ định bảo vệ.

---

## 5. Đã sửa trong lượt này — mẫu M2, 5 đường ghi

Xem `git log 12d982a..84d851f`. Tóm tắt phương pháp vì nó là phần đáng giữ lại:

**Tài sản dùng chung mới (AD-15):** `api/src/common/cas.ts` — `requireCas(rows, conflict)`, rút
từ bản mẫu `approvals.service.ts:143-171`. 8 test bảng dữ liệu, gồm cả nhánh "trúng nhiều hàng =
lỗi lập trình, phải nổ 500" để không ai im lặng lấy hàng đầu.

| # | Chỗ | Cách sửa |
| --- | --- | --- |
| 1 | `ip-address.transition` | `status = from` + `voided_at IS NULL` vào chính câu UPDATE |
| 2 | `license-assignment.assign` | Đếm seat **chuyển vào tx**, sau `SELECT ... FOR UPDATE` trên hàng `software`. UNIQUE `(software_id, device_id)` không cứu được vì nó canh trùng **thiết bị**, không canh **số ghế** |
| 3 | `license-assignment.release` + `updateTerms` | CAS trên `released_at IS NULL` |
| 4 | `accounts.setStatus` | `assertNotLastSa` vào trong tx, dùng `countActiveSaWithin` có `FOR UPDATE`. Bản chạy trên pool đã **xóa** khỏi `UsersService` để không ai cầm nhầm cái tiện tay |
| 5 | `expiry-digest.runOne` | Chốt kỳ và enqueue outbox về **cùng một** transaction (mẫu N3) |

**Bài học đắt nhất của lượt này — bản sửa #4 tự đẻ ra deadlock.** Bản đầu chỉ khóa các SA
*khác* (`ne(id, target)`) rồi mỗi transaction UPDATE hàng đích của mình: T1 giữ B đòi A, T2 giữ A
đòi B → Postgres bắn 40P01, người dùng nhận **500** thay vì câu tiếng Việt. E2E bắt được ngay.
Sửa đúng là khóa **cả** tập SA hoạt động theo `ORDER BY id` (thứ tự toàn cục, không có vòng chờ),
loại hàng đích ra lúc **đếm** chứ không lúc `WHERE`.

**Và bài học về chính bài test.** `e2e/tests/m2-concurrency.spec.ts` bắn 6 request đồng thời rồi
chốt "đúng một cái thắng", cộng đếm thẳng dòng lịch sử trong DB. Đã chạy **pha đỏ thật** trên
image cũ trước khi sửa:

- gỡ ghế → `[200, 200, 200, 200, 200, 200]` — sáu dòng `software_history` cho một lần ngồi ghế
- SA cuối cùng → cả hai lệnh khóa lọt, hệ thống tụt từ 3 SA xuống **1**

Bài SA lúc đầu chạy **một** vòng và **xanh cả khi đã gỡ bản sửa ra** — cửa sổ hỏng chỉ vài trăm
micro giây, hai request không chồng nhau đủ. Phải nâng lên **12 vòng** nó mới đỏ (ở vòng 2). Đây
đúng thứ mà mẫu N4 nói: một bài test không đỏ được khi code sai thì nó không canh gì cả, và nhìn
từ bảng kết quả thì hai thứ đó giống hệt nhau.

---

## 6. Nên sửa — gom theo nhóm

**Bảo mật.** Cất/xoay/thu hồi mật khẩu vào két không đòi step-up (`vault.controller.ts:125-149`)
— đọc thì phải gõ TOTP, **ghi đè** thì không. · Ma trận quyền két không phủ tới file đính kèm
(`files.controller.ts:83,117`) — member bị `denied` trên một tài khoản dịch vụ vẫn tải được biên
bản bàn giao của chính hồ sơ đó, và `DELETE` thì bất kỳ member nào cũng gọi được. · SQL kèm tham
số (hash argon2, PII) chảy vào log qua `global-exception.filter.ts:31` (body trả client thì
sạch). · Đăng nhập bằng TOTP tự cấp luôn step-up mở két (`session.service.ts:70`). · `login`
không chặn `status === 'locked'` → ghi `auth.login.ok` cho tài khoản đang khóa **và** xóa
`failed_attempts`.

**Nghiệp vụ.** Chống replay TOTP ghi **ngoài và sau** tx cấp phiên. · `setPassword` của SA là
đường ghi **duy nhất** không enqueue outbox — người bị đổi mật khẩu không nhận email nào. ·
`killSession` ghi audit ngoài tx (ghép với #4 thành: hành động quản trị không để lại vết). ·
`getNumber` nhận `""` thành `0` không cảnh báo → lưu nhầm chuỗi rỗng cho `session.absolute_hours`
là **cả công ty không đăng nhập được**, không một dòng lỗi. · `subnet.update` đếm IP ngoài tx rồi
đổi `cidr` vô điều kiện (M2 còn sót). · Xóa một luật digest để lại job kẹt **vĩnh viễn** ở badge
"gửi lỗi".

**Miền nghiệp vụ.** "Xác nhận vẫn dùng" **xóa trắng** chủ IP (ô trong hộp thoại không nạp giá trị
cũ, `'' || null`). · Ẩn hồ sơ IP là **cửa một chiều**: không có `restore`, `findOne` trả 404,
không màn nào bày ra — trong khi AC 5.2 hứa "xem được trên trang IP", và web đã có sẵn nhãn
`'ip.restored': 'Bật lại'` không đường nào sinh ra được. · Thiết bị `retired`: **8 điểm ghi** đang
hở (sửa hồ sơ, import ghi đè, nối cổng, gán license, cấp IP, tạo NAT, đính kèm, tạo secret), cộng
hai hệ quả chưa ai nêu — máy đã thanh lý **vẫn ăn seat** (thanh lý 10 máy cũ, gán máy mới đầu tiên
đã bị `SEAT_LIMIT_REACHED` và bắt khai một lý do **sai sự thật pháp lý**), và vẫn nằm trong 4 ô
chọn thiết bị. Nguyên nhân gốc: `devices.api.exists()` không mở đường để kiểm mà vẫn giữ AD-2. ·
Digest gửi lại mục **đã quá hạn** mãi mãi (thiếu `includeExpired`, `undefined === false` sai → nhìn
lùi 365 ngày) — 52 email liên tiếp cho một tên miền đã bỏ. · Chip tổng và badge **trên cùng một
dòng** nói ngược nhau (`summarize` không có trần `warningDays`). · Ngưỡng 7/30 hardcode **3 chỗ**,
`system_config` không có khóa nào — DoD gạch 8. · Chốt kỳ digest so với **nửa đêm UTC** của ngày
địa phương → mọi luật có `hour ≤ 6` mất hàng rào chống gửi trùng.

**Web.** Còn **6 chỗ** M3 (`expiry-screen` kinds · `devices-screen` installedCounts ·
`use-departments` — tài sản dùng chung 6 màn, trả `string[]` nên nơi gọi **không có đường nào**
biết đã hỏng · `['catalog','lists']` ở 10 nơi · các Combobox). · **7 form** đóng được bằng Esc
giữa lúc đang ghi; nặng nhất là `nat-screen` NatForm ghi **nối tiếp** một POST mỗi chip port →
bấm Esc thì vòng lặp **vẫn mở nốt các port còn lại ra Internet**, và mất sạch cơ chế cứu hộ mà
chú thích ngay đó viết ra. · `combobox.tsx` + `select.tsx`: `role="listbox"` portal ra `body`,
**không `aria-controls`, không `aria-activedescendant`** → người dùng NVDA bấm ↓ không nghe thấy
gì rồi Enter gán nhầm thiết bị. · `date-picker.tsx:177` có `<span role="button">` **lồng trong**
`<button>`. · Focus không trả về sau khi đóng lịch/đồng hồ (`select.tsx:86` làm đúng, là bản mẫu).
· `combobox.tsx:57` effect chạy mỗi render khi nơi gọi truyền `.filter(...)` → ở "Nối port", bấm
Esc xong menu **tự bung lại** đè lên ô đang gõ.

**Kiểm thử.** `vault-surface.spec.ts:171` thiếu chốt sàn số file → teo danh sách là xanh vĩnh
viễn. · `global-setup.ts:33` ghi đè backup rate-limit **vô điều kiện** → một lần `Ctrl-C` giữa
chừng là giá trị gốc `20` biến mất và mọi lượt sau "khôi phục" về 500. · Assertion nằm trong
`if (...)` có thể không bao giờ chạy (`devices.spec.ts:206`, `vault-access.spec.ts:149` — bài tên
*"nhiều luật cùng áp thì lấy tầng rộng nhất"* có thể không kiểm gì về ưu tiên tầng). · 7 hàm
`DISABLE TRIGGER` trong `helpers.ts` **không có `try/finally`** → `execSync` ném giữa chừng là
trigger append-only ở lại DISABLED và hai bài giữ NFR-03 cho kết quả giả. · `expireStepUp()` đụng
**mọi** phiên trong DB. · 25 chỗ dùng CSS class selector, **4 trong helper dùng chung** (kể cả
`firstLogin` mà mọi bài đều đi qua). · 12 endpoint ghi có **0 test** — gồm `reset-password`,
`reset-totp`, `totp-login-required` (công tắc hạ mức bảo vệ đăng nhập), break-glass `deny` và
`revoke`. · 3 luồng email bảo mật không có assertion hộp thư nào.

**Kiến trúc.** `eslint.config.mjs:145` dùng `'off'` cho 2 file → tắt **cả** AD-2 chứ không chỉ
luật cấm thư viện. · `INFRA_PRIMITIVES` có 1 mục **chết** (`system-config.keys`, 0 nơi dùng) và 2
mục chỉ **một** module dùng (nên là ngoại lệ riêng cho `vault`). · 5 module không có `*.api.ts`
nào (`auth`, `audit`, `config-sys`, `outbox`, `queue`) — danh sách ngoại lệ đang **thay thế cho
những cánh cửa chưa được dựng**. · Trùng lặp AD-15 **không đứng yên, nó tăng**: `*OrderBy` 5→10,
bộ đọc lịch sử 7→10, dịch lỗi Postgres 8→12. · `ip-address.history()` là bản lệch duy nhất người
dùng **nhìn thấy được**: `asc` + không trần, trong khi 9 bản kia `desc` + `limit 200` → panel lịch
sử của IP hiện cũ-nhất-trên-đầu, 9 màn kia ngược lại. · `SHARED-REGISTRY.md` thiếu 6 tài sản lớn,
đứng đầu là `auth/types.ts` (**18 file / 11 module**, hub số 2 của cả codebase, và còn nằm trong
`modules/auth/` chứ không phải `common/`).

**CSDL.** Màn Nhật ký **quét toàn bảng mỗi lần mở**: `actor ILIKE '%x%'` khiến
`audit_log_actor_idx` không bao giờ dùng được; đo trên 80.000 dòng là 52,8ms cho riêng câu `count`
chạy song song mỗi lần mở màn, và bảng chỉ lớn lên vì NFR-03 nói giữ **vĩnh viễn**. ·
`DISTINCT action` quét cả bảng để nạp dropdown — nên lấy từ tập đóng các chuỗi `@Audited`. · 5
index thừa 100% + 1 index (`nat_rule_internal_idx`) **không câu nào dùng được**. ·
`service_account.code` là bảng **duy nhất** lệch khỏi nếp `citext`, và biến TS tên `citext` lại
khai `'text'`. · `file.owner_type` thiếu `CHECK` — trong khi `secret.owner_type` có, và chú thích
của `0033` viết thẳng bài học đó ra.

---

## 7. Những thứ vẫn tốt — và đã đứng vững qua lượt soi thứ hai

Phần này không phải xã giao. Bảy người soi độc lập, không ai tìm được lỗi ở đây:

- **Envelope crypto vẫn không một lỗi.** IV `randomBytes(12)` mới ở cả `seal` lẫn `wrapDek`; DEK
  riêng mỗi giá trị; AAD = `table|record_id|key_version` nên ciphertext không bê được sang hàng
  khác **cũng không** sang `key_version` khác; `rewrap` `fill(0)` trong `finally`.
- **`RolesGuard` deny-by-default phủ đủ 135/135 handler.** Quét toàn bộ 18 controller: **0 route
  thiếu `@Roles` và thiếu `@Public`**. Đúng 2 route `@Public`: `/health` và `/auth/login`.
- **0 SQL injection.** 0 `sql.raw`, 0 chuỗi ghép, sort key qua allowlist `===` đóng.
- **Outbox vẫn là phần tốt nhất của backend.** `enqueueWithin(tx,…)` ở mọi điểm; `queue.add` duy
  nhất nằm **ngoài** tx claim đúng chủ ý; `jobId = event.id`; `markProcessed` check-and-set.
- **40/40 migration chạy sạch trên DB trắng** — đã dựng Postgres 17 container tạm kiểm thật. Và
  `0039` bịt được cả `TRUNCATE device CASCADE` (đường vòng chưa ai nghĩ tới).
- **Kiểu dữ liệu sạch tuyệt đối:** 0 cột `float`, tiền là `bigint`, **mọi** cột thời điểm là
  `timestamptz`, 27 FK không một `ON DELETE CASCADE` nào.
- **Múi giờ +07 phía API sạch.** Không chỗ nào so `end_date` với `new Date()` UTC.
- **Đồ thị acyclic là thật** — 0 vi phạm `no-circular` trên 197 module / 882 cạnh, **0
  `forwardRef`**.
- **Không có `it.skip`/`.only`/`test.fixme`** ở cả api lẫn web lẫn e2e.
- **`envelope.service.spec.ts` là bài test mẫu mực của repo** — AAD chặn bê ciphertext sang bảng
  khác, sửa 1 bit hỏng auth tag, rewrap v1→v2, mất chìa cũ báo lỗi rõ.
- **Đính chính một khẳng định của bản 28/08:** dòng "`daysBetween` → *180 ngày ở hai màn không
  cùng một con số*" **không đúng**. `common/today.ts` ép cả hai mốc về `T00:00:00Z` nên `round` và
  `floor` cho cùng kết quả; `dashboard-rules.ts` nhận `Date` thật nên `floor` ở đó là bắt buộc
  đúng. Đây là **hai hàm khác nhau trùng tên** — rủi ro là import nhầm, không phải lệch số. (Riêng
  `safeIsoDate` vẫn là bản chép từng dòng của `isoDateInTz` — vẫn còn.)

---

## 8. `CLAUDE.md` đang mô tả sai repo — 6 chỗ

Đây là finding thật, không phải chuyện tài liệu: nó khiến người sau viết code sai chỗ, hoặc viết
test **không bao giờ chạy**.

| Dòng | Nói | Thực tế |
| --- | --- | --- |
| :15 | *"kế hoạch xong, **code chưa khởi tạo**"* | 7 epic `done`, 204 file TS, 40 migration, 260 test E2E. Đây là câu **đầu tiên** người mới đọc |
| :52 | *"Unit/integration: **Vitest** (`api/test`)"* | api dùng **Jest**; `api/test` **rỗng**; `jest.config.js` đặt `rootDir: 'src'` → file bỏ vào `api/test` **không bao giờ chạy** |
| :53 | *"Postgres thật (compose profile `test`)"* | **không tồn tại** profile `test`. Và `npm run test:db` trỏ vào `./test/jest-db.json` **không có thật** |
| :33 | *"cặp dark trong `.dark`"* | `tokens.css:127` dùng `html[data-theme='dark']`; không có selector `.dark` nào. Làm đúng câu chữ hiện tại sẽ viết ra khối CSS hợp lệ **không bao giờ chạy**. Đã nêu 28/08, chưa sửa |
| :71 | *"Mailpit `http://mailpit:8025`"* | `helpers.ts:437` dùng `localhost:8025` — Playwright chạy **ngoài** docker nên hostname `mailpit` không phân giải được |
| :20 | *"AD-1..**AD-14**"* | AD-15 tồn tại và có hẳn một mục riêng trong chính `CLAUDE.md` |

Cộng: `sprint-status.yaml` ghi `last_updated: 08-23-2026` trong khi epic 5/6/7 đã đóng và công
việc chạy tới 07/09.

Trạng thái "nói có mà không có" của `api/test/` là tệ nhất trong nhóm này: **chọn một** — dựng
thật, hoặc xóa script `test:db` và sửa `CLAUDE.md`.

---

## 9. Thứ tự đề nghị

### ✅ Đã làm ngay trong ngày 07/09

| # | Việc | Kết quả |
| --- | --- | --- |
| 1 | `.gitattributes` với `api/src/migrations/*.sql -text` | Kiểm chứng: thêm xong `git status` trên `api/src/migrations/` **rỗng** — không file nào bị đổi byte, đúng ý định (mục 4) |
| 2 | `clientIp()` trả thẳng `req.ip` | `trust proxy = 1` khiến Express bỏ đúng một hop ĐẾM TỪ PHẢI, nên nó lấy phần nginx nối chứ không phải phần client tự khai. Gom luôn hai khái niệm "IP client" trong repo về một (`LoginRateGuard` vốn đã dùng `request.ip`) (#1) |
| 3 | **Web chuyển từ oxlint sang ESLint** | Xem khung dưới — đây là việc lớn nhất trong nhóm |
| 4 | Chốt sàn + regex rộng hơn cho `vault-surface.spec.ts` | `expect(scanned.length).toBeGreaterThanOrEqual(120)`; và bắt cả nháy kép/backtick/`import()`/`require()` chứ không chỉ `from '...'` nháy đơn |
| 5 | Bỏ `catch {}` rỗng ở `audit-log.spec.ts` + `ip-lifecycle.spec.ts` | Nay soi `stderr` phải khớp `/chỉ-thêm\|append_only\|no_truncate\|no_delete\|no_update\|permission denied/` — bị chặn bởi HÀNG RÀO, không phải bởi sự cố hạ tầng (N4) |
| 6 | `global-setup.ts` không ghi đè bản cất | Hai chốt: file đã có thì giữ; và không bao giờ cất chính con số bộ test tự đặt (`E2E_LOGIN_RATE_LIMIT`) — đó là dấu hiệu lượt trước chết giữa chừng |
| 7 | Sửa 5 chỗ sai trong `CLAUDE.md` | "code chưa khởi tạo" → trạng thái thật · `AD-1..AD-14` → `AD-15` · `.dark` → `html[data-theme='dark']` · Vitest/`api/test` → Jest + ghi thẳng rằng tầng test DB **chưa có** · `mailpit:8025` → `localhost:8025` |
| — | `docker-compose.yml`: cổng host của `web` đọc từ biến | `${WEB_HTTPS_PORT:-443}` / `${WEB_HTTP_PORT:-80}`. Production giữ nguyên; máy dev có proxy khác giữ cổng 80 thì đặt `WEB_HTTP_PORT=8080` là `ops/ci-local.sh --e2e` chạy được |

> ### Web: oxlint → ESLint (quyết định 07/09)
>
> **Vì sao.** `oxlint` vào `web/package.json` từ **Epic 1** (`f728245`), chạy rule mặc định
> không cấu hình cho tới 28/08. Nó nhanh hơn ESLint nhiều, nhưng **không cùng bộ rule** — và
> điều đó cắn thật ngay khi vá finding #8: luật viết bằng `no-restricted-syntax` (đúng cú pháp
> `api/eslint.config.mjs` đang dùng cho `crypto.createCipheriv`) bị oxlint trả về
> `Rule 'no-restricted-syntax' not found in plugin 'eslint'`. Một luật viết đúng ở api là luật
> **chết** ở web. Mỗi luật phải viết hai lần theo hai cách, và không gì báo khi bản thứ hai sai.
>
> **Đã làm.** `web/eslint.config.mjs` (cùng phương ngữ với api) · **`web/.dependency-cruiser.cjs`
> — web chưa từng có, nên vòng lặp phụ thuộc bên web chưa từng có ai canh** · gỡ `oxlint` khỏi
> `package.json`, xóa `.oxlintrc.json`, đổi mọi tham chiếu trong `ci-local.sh`, `ci.yml`,
> `SHARED-REGISTRY.md`.
>
> **Bài canh ngược: `web/src/lint-rules.test.ts`** — 9 test chạy **thẳng eslint** trên file
> probe rồi xóa, chốt rằng luật BẮT ĐƯỢC cả 6 cách viết (`window.confirm`, `confirm` trần,
> `globalThis.confirm`, …), KHÔNG bắt nhầm `useConfirm()`, và hai luật ranh giới tầng còn sống.
> Khác `ad2-boundary.spec.ts` ở một chỗ quan trọng: bài kia kiểm **biểu thức regex**, bài này
> kiểm **cái cổng đang chạy** — nên nó không còn cửa "regex đúng nhưng không cắm vào rule nào".
>
> **Bản thân bài test đó cũng từng có chế độ xanh-giả** và đã bịt: `npx`/`npx.cmd` không phân
> giải được trong tiến trình con của vitest trên Windows → `ENOENT` → `err.stdout` là
> `undefined` → bài thấy "output rỗng + có ném" và kết luận SAI là luật đã bắt được. Nay gọi
> thẳng `node node_modules/eslint/bin/eslint.js` và ném to khi `ENOENT`.
>
> **Nợ ESLint vừa lộ ra:** 20 chỗ dùng `!` (`no-non-null-assertion`), oxlint chưa bao giờ bắt vì
> nó không nằm trong category `correctness`. Để `warn`, chưa chặn merge. **Đính chính bản
> 28/08:** mục "0 `any` / `!` / `@ts-ignore`" đúng hai vế, **sai vế `!`**. (`any` và
> `@ts-ignore` xác nhận đúng 0, nên hai luật đó để `error`.)

> ### e2e: có cổng kiểm kiểu lần đầu
>
> `e2e/tsconfig.json` + `npm --prefix e2e run typecheck`, nối vào `npm run lint` gốc,
> `ops/ci-local.sh`, và một job `e2e-typecheck` riêng trong GitHub Actions (chạy được ở CI vì
> nó chỉ cần `tsc`, không cần stack). Chạy lần đầu ra **4 lỗi thật** — 1 import thừa và 3 biến
> chết còn sót từ đợt đổi sang menu ba chấm hôm 28/08 — đã dọn.
>
> **Giới hạn phải biết:** cổng này **không** bắt được đúng lỗi `__dirname` hôm 03/09, vì
> `@types/node` khai `__dirname` là biến toàn cục vô điều kiện nên `tsc` thấy nó hợp lệ kể cả
> trong gói ESM. Muốn bắt hẳn thì cần một luật lint cho `e2e/` — chưa làm, vẫn nằm ở #16.

### Còn lại

**Đợt Chặn còn lại (theo thứ tự bảng mục 3):** #2 (2FA) → #3 (`audit_log.ip`) → #4 (audit nuốt
lỗi) → #5 (đếm sai mật khẩu, gộp với N3 khóa tài khoản) → #6 (NAT ↔ thu hồi IP) → #7
(`renewal_history`) → #9 (regex AD-2 + thu hẹp ngoại lệ `users.schema`) → #10 (import) →
#11/#12/#13 (ba màn nuốt lỗi, cùng một khuôn `LoadError`).

Ghi chú: **#8 và #16 đã đóng** (xem hai khung trên). **#9 vẫn mở** — việc hôm nay là ở phía web;
lỗ regex `../../modules/` bên api chưa đụng tới.

**Đòn bẩy lớn nhất, đắt hơn:** dựng `api/test/` với Postgres thật. Nó là tầng lẽ ra bắt được
**#14** (40 migration chưa từng parse), **#15** (outbox), toàn bộ mẫu M2 và N3, và các kịch bản
đua mà chuyên gia nghiệp vụ phải ghi "chưa xác minh bằng thực nghiệm" vì không có chỗ để viết bài
chứng minh.

---

## 10. Ghi chú về mức độ tin cậy

- **Tôi tự xác minh lại:** #1, #2, #3 (mục 3), toàn bộ mục 5, và 0039 ↔ 0032 không trùng tên trigger.
- **Chuyên gia tự xác minh, tôi chưa kiểm lại:** phần còn lại. Mỗi báo cáo đều kèm `file:dòng` +
  trích code thật; ba chuyên gia còn chạy probe thực nghiệm (dựng Postgres 17 container tạm cho
  40 migration; chạy engine ESLint với chính regex của repo; tạo file probe cho oxlint rồi xóa).
- **Được ghi rõ là chưa xác minh:** các kịch bản đua ở tầng auth (#5) và import (#10) đúng về
  **cấu trúc** transaction và câu SQL, nhưng chưa tái hiện bằng thực nghiệm — `api/test/` rỗng nên
  không có chỗ để viết bài chứng minh. Đó chính là lý do mục 9 xếp nó là đòn bẩy lớn nhất.
- **Branch protection trên `origin/master` chưa xác minh** — máy không có `gh` CLI.
