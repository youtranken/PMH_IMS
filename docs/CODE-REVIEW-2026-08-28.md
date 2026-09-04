# Rà soát toàn hệ thống — 28/08/2026

> **Trạng thái sửa chữa — cập nhật 28/08 tối.** Đợt 0 (bật cổng) và 7/9 finding Chặn đã sửa,
> mọi cổng xanh: `npm run lint` · `npm run test` (696 api + 246 web) · `npm run build`.
> Chi tiết ở [§8 Đã sửa những gì](#8-đã-sửa-những-gì) cuối tài liệu. Hai việc còn lại cần
> quyết định của chủ dự án: đẩy repo lên remote + bật branch protection, và tách vai DB
> `ims_app` (đổi cách triển khai).
>
> **Đính chính một khẳng định trong bản gốc:** finding #1 (`u.sub`) được mô tả là "màn Nhật ký
> 500 mỗi lần mở". Kiểm lại: `GET /api/v1/admin/audit` có thật và 500 thật, nhưng **màn web
> chưa dựng** — `nav.auditLog` còn `planned: true` trong `web/src/shell/app-nav.ts`. Lỗi vẫn
> là lỗi Chặn (endpoint hỏng hoàn toàn, không test nào chạm), nhưng nó chưa gây ảnh hưởng cho
> người dùng; nó sẽ cắn đúng lúc Story 6.2 dựng màn.

Bảy chuyên gia soi song song trên bản đồ `graphify-out/GRAPH_REPORT.md` (vừa dựng lại: 3452 node ·
7963 edge · 286 community, **lần đầu có 39 file migration SQL trong graph**) và toàn bộ 71 commit
nhánh `master`. Tất cả chạy chế độ chỉ-đọc. Mọi finding đều kèm `file:dòng` + trích code.

Quy mô soi: 204 file TS backend · 149 file web · 39 migration · 103 file test · 18 module API ·
13 feature web · 49 component dùng chung.

---

## 1. Bảng điểm

| Lĩnh vực | Điểm | Nhận định một dòng |
| --- | --- | --- |
| Bảo mật (auth · crypto · RBAC) | **8.5**/10 | Lõi mã hóa không một lỗi; `RolesGuard` deny-by-default là thật |
| Kiến trúc backend (AD-1..15) | **7.0**/10 | Đồ thị acyclic thật, không `forwardRef`; nhưng hàng rào CI đã chết |
| Kiến trúc frontend | **7.0**/10 | 0 hex ngoài token, 0 `confirm`, 0 `any`; web không có cổng lint nào |
| React · UX · a11y · responsive | **6.5**/10 | Kỷ luật cao; lỗi API biến thành "rỗng" ở 8 chỗ |
| Nghiệp vụ · transaction · outbox | **6.0**/10 | Outbox mẫu mực; một hình dạng lỗi lặp 5 lần |
| Cơ sở dữ liệu · migration | **6.0**/10 | Schema thuần đáng 8; hàng rào append-only là giấy |
| Kiểm thử · DoD · CI | **6.0**/10 | Test hàm thuần xuất sắc; tầng giữa rỗng, cổng chưa từng chạy |
| **Tổng hợp có trọng số** | **6.5**/10 | **Thiết kế tốt hơn mức thực thi. Chưa sẵn sàng cho dữ liệu thật.** |

Điểm 6.5 là điểm của một hệ thống **được thiết kế bởi người hiểu việc**, đang bị kéo xuống bởi
**các cơ chế tự bảo vệ chưa được bật**. Đây không phải codebase cẩu thả — nó là codebase mà phần
"nghĩ" đi trước phần "ép".

### Định nghĩa thang điểm
9-10 xuất sắc hiếm · 7-8 tốt, còn nợ · 5-6 chạy được nhưng có vấn đề hệ thống · dưới 5 lỗi nền tảng.

---

## 2. Năm hình dạng lỗi lặp lại

Bảy chuyên gia làm việc độc lập, không đọc kết quả của nhau. Năm mẫu dưới đây được **ít nhất hai
người tìm ra riêng rẽ** — đó là dấu hiệu chúng là bệnh hệ thống, không phải bug lẻ. Sửa theo mẫu
rẻ hơn sửa theo từng finding rất nhiều.

### M1 — Hàng rào tự động đã chết hoặc chưa từng chạy
*(Kiến trúc BE · Kiến trúc FE · QA — ba người, ba góc)*

- Luật eslint canh AD-2 ở `api/eslint.config.mjs:49-56` **khớp đúng 0 chuỗi**. Hai lỗi cộng dồn:
  pattern `**/modules/*/…` khớp vào chuỗi import như người ta gõ (`'../users/users.service'` —
  không có đoạn `modules/`), và `[!(index|*.api)]` là lớp ký tự phủ định chứ không phải extglob.
  Chuyên gia đã chạy thử engine `ignore` của chính ESLint để chứng minh.
- `.dependency-cruiser.cjs` **không có luật nào** cho nhánh nghiệp vụ→nền và nền→nền. Đã có 4 vi phạm
  thật đang sống, depcruise vẫn xanh.
- Phía **web không có eslint config, không có dependency-cruiser**. `lint = oxlint` chạy rule mặc
  định, không file cấu hình. Luật cấm `window.confirm` / dialog tự dựng trong `features/` (AC Story 1.5)
  **không tồn tại ở web**.
- **Repo không có git remote.** GitHub Actions chưa từng chạy một lần nào. 0 PR. Không có root
  `package.json` nên chính câu lệnh đóng epic trong `CLAUDE.md` (`npm run test && npm run test:e2e`)
  không chạy được.
- Job `e2e` trong CI **không thể xanh**: CI đặt `APP_BASE_URL=https://localhost` nhưng
  `playwright.config.ts:7` đọc `IMS_BASE_URL` (CI không bao giờ đặt) → mặc định `https://ims.pmh.com.vn`,
  host không tồn tại trong runner. Thêm 137 chỗ hardcode `Origin: 'https://ims.pmh.com.vn'` sẽ đụng
  `ORIGIN_MISMATCH` 403 hàng loạt.

**Hệ quả:** mọi con số "xanh 235/235" trong lịch sử commit là **tự khai trên máy dev**. Đây là lời
giải thích cho cả năm commit "sửa N finding của code review lượt 1..5", và đặc biệt cho `f35e2b3`
("một bản sửa lượt 3 KHÔNG hề vào file" mà vẫn commit thông điệp nói đã sửa) — đúng thứ một cổng
độc lập bắt được ngay.

### M2 — Kiểm ngoài transaction, rồi ghi vô điều kiện bên trong
*(Nghiệp vụ · DB — hai người, cùng kết luận)*

Mẫu chung: `SELECT`/đếm/kiểm chạy ngoài `db.transaction`, rồi `UPDATE ... WHERE id = ?` bên trong
mà không mang theo điều kiện đã kiểm.

| Chỗ | Hậu quả |
| --- | --- |
| `subnet.service.ts:295` `voidSubnet` | IP cấp xen giữa **mất dòng `ip_history`** — AC 5.2 hứa giữ vĩnh viễn |
| `ip-address.service.ts:368` `transition` | Hai người đổi trạng thái cùng lúc → mất cập nhật, `ip_history` ghi hai dòng cùng `fromStatus` |
| `license-assignment.service.ts:211` `assign` | 9/10 seat, hai người gán cùng lúc → **11/10, không ai phải khai `overSeatReason`** |
| `accounts.service.ts:241` `assertNotLastSa` | Còn đúng 2 SA, hai lệnh khóa song song → **0 SA, khóa cả công ty ra ngoài** |
| `expiry-digest.service.ts:176` chốt kỳ | Tx chốt kỳ commit riêng, tx enqueue hỏng → **kỳ báo cáo mất vĩnh viễn** |
| `license-assignment.service.ts:361` `release` | Gỡ hai lần cùng lúc → hai dòng `software_history` cho một lần gỡ |

Repo **đã có bản mẫu đúng ngay bên cạnh**: `approvals.service.ts:143-171` (CAS),
`approval-sweep.service.ts:64-73` (claim + outbox cùng tx), `break-glass.service.ts:231-265`
(để unique constraint làm trọng tài rồi bắt 23505). Việc cần làm là áp một khuôn đã có, không phải
phát minh gì mới.

### M3 — Lỗi biến thành "rỗng" một cách im lặng
*(React/UX · Nghiệp vụ · Kiến trúc BE — ba người)*

Loại lỗi **không bao giờ đỏ ở bất cứ đâu**: không test nào bắt, console không kêu, chỉ có người dùng
nhìn màn hình và tin một điều sai.

- `approvals-screen.tsx:99` — API break-glass trả 500 → `?? []` → màn hiện **"Chưa có yêu cầu nào
  chờ duyệt"**. Admin trực đêm tin là không có ai xin quyền khẩn cấp. Mọi màn khác đều import
  `LoadError`; riêng màn quan trọng nhất thì không.
- `accounts-screen.tsx:436` — API phiên chết → "tài khoản này không có phiên nào đang mở". SA tin là an toàn.
- `excel-import.service.ts:43` — file 25.000 dòng thì **5.000 dòng cuối bị bỏ đi không một lời nào**;
  audit ghi `totalRows: 20000`.
- `devices.api.ts:42` — `listRetired()` `limit: 500` rồi vứt `total`. Vượt 500 thiết bị đã thanh lý
  thì Kho thanh lý im lặng giấu phần còn lại, và số trên bảng điều khiển **sai** chứ không chỉ ngắn.
- `nat-rule.service.ts:533` — `.catch(() => null)` nuốt cả NotFound lẫn lỗi hạ tầng → sổ NAT xuất
  cho auditor có cột "Máy trong" rỗng, người đọc kết luận "port này không dẫn tới máy nào".

### M4 — Lời hứa trong comment/tài liệu mà không có code
*(Bảo mật · Nghiệp vụ · DB · Kiến trúc BE — cả bốn)*

- `envelope.service.rewrap()` được viết, được test, **và được ghi vào `secrets/README.md` như quy
  trình vận hành** — nhưng `grep` toàn repo: **không một nơi nào gọi nó**. Chìa v1 bị nghi lộ thì
  toàn bộ secret cũ vĩnh viễn ở v1, dòng chìa cũ không bao giờ được phép xóa. Xoay `key_version`
  hiện là một dòng tài liệu, không phải một năng lực.
- Role `ims_app` mà 9 khối `REVOKE` nhắc tới **chỉ tồn tại trong một dòng chú thích**. App nối bằng
  `POSTGRES_USER` = superuser + owner mọi bảng → `REVOKE` là no-op tuyệt đối.
- `audit_log.ip` được khai trong migration `0004` nhưng **không có trong bảng drizzle** → cột **luôn
  NULL trên mọi dòng**. Điều tra sự cố hỏi "từ đâu" thì câu trả lời vĩnh viễn là rỗng.
- `devices.service.ts:177` hứa `retired` = "hồ sơ khóa lại, không sửa được nữa". `grep`: **không một
  `throw` nào**. Máy đã thanh lý vẫn gán được license (chiếm seat thật), vẫn cấp được IP, vẫn nối port.
- `SystemConfigService.setWithin` **không có nơi gọi nào**, `config-sys` không có controller. Lời hứa
  "chỉnh qua UI Admin, không cần dựng lại ảnh docker" hiện chỉ làm được bằng cách vào thẳng `psql`.
- Break-glass **không chặn tự duyệt**: Admin tự gửi yêu cầu rồi tự bấm Duyệt → grant 24h hợp lệ,
  nhật ký in "ai xin / ai duyệt" là cùng một email. Nguyên tắc bốn-mắt mất sạch. (`cancel()` thì
  **có** kiểm tra đó — chỉ áp cho hủy, không áp cho duyệt.)

### M5 — Copy-paste đã đẻ ra hành vi lệch, không còn là nguy cơ lý thuyết
*(Kiến trúc BE · Kiến trúc FE)*

| Thứ bị chép | Số bản | Đã lệch ra sao |
| --- | --- | --- |
| `*OrderBy` (map cột + chốt hạ) | 5 | devices/software/isp bỏ chốt hạ khi `key==='code'`; users/service-accounts thì không |
| Bộ đọc lịch sử | 7 | Ba hành vi: `desc` trần 200 · `desc` trần 100 · **`asc` không trần** (ipam) |
| `recordWithin` → `audit_log.detail` | 6 | 5 module ghi `detail: changes` (phẳng), service-accounts ghi `detail: { changes }` (lồng) → mọi truy vấn báo cáo **im lặng trả rỗng** cho tài khoản dịch vụ, và bảng append-only nên không sửa lại được |
| `translate*` lỗi Postgres | 8 | Hai tên hàm cho cùng một việc; `SubnetService` thiếu 23514/23503 → 500 lộ chuỗi Postgres |
| `list()` phân trang | 5 | Chưa lệch, nhưng mỗi thay đổi phải sửa 5 chỗ |
| `safeIsoDate` vs `isoDateInTz` | 2 | Bản fork **nằm trong chính module đã import bản gốc** |
| `daysBetween` | 2 | `Math.round` (today.ts) vs `Math.floor` (dashboard-rules.ts) → "180 ngày" ở hai màn **không cùng một con số** |
| `buildFilterQuery` (web) | 3 | Chép cả JSDoc nguyên văn; lời hứa "file xuất khớp bảng đang xem (FR-028)" phụ thuộc ba bản không lệch |
| `*-history-entries.ts` (web) | 6 | `formatValue` chép 5 lần, `describeField` chép 3 lần |

---

## 3. Chín finding mức Chặn

Sắp theo thứ tự nên sửa. Bốn cái đầu tôi đã **tự xác minh lại** ngoài báo cáo của chuyên gia.

| # | Finding | Vị trí | Hậu quả |
| --- | --- | --- | --- |
| 1 | **`u.sub` — cột không tồn tại** ✅đã xác minh | `audit-query.service.ts:72` | `LEFT JOIN users u ON u.sub = a.actor`. `users` không có cột `sub` ở bất kỳ migration nào. **Màn Nhật ký 500 mỗi lần mở.** Raw SQL nên `npm run build` xanh. Mảnh sót OIDC của QLTS mà AD-12 dặn phải grep bỏ. |
| 2 | **Append-only là hàng rào giấy** ✅đã xác minh | `0005` + `docker-compose.yml:42` | `ims_app` chỉ có trong chú thích; app chạy bằng superuser → 9 khối `REVOKE` vô hiệu. Trigger chặn được UPDATE/DELETE từng dòng, nhưng **`TRUNCATE audit_log` đi lọt**, và `DISABLE TRIGGER`/`DROP TRIGGER` mở toang. NFR-03 nói nhật ký giữ vĩnh viễn. |
| 3 | **Argon2 + pepper: 0 test** ✅đã xác minh | `password.service.ts` | Không có `password.service.spec.ts`, không có `password-policy.spec.ts`. `CLAUDE.md` ghi thẳng "không test thì không được merge". `catch { return false }` ở `:47` nuốt mọi lỗi — pepper nạp rỗng thì hệ thống chỉ "sai mật khẩu" với tất cả mọi người, không gì đỏ. |
| 4 | **CI e2e không thể xanh + không remote** ✅đã xác minh | `ci.yml:80` ↔ `playwright.config.ts:7` | Sai biến base URL; 137 chỗ hardcode Origin. `git remote -v` rỗng, 0 PR, không root `package.json`. **DoD gạch 7 chưa từng được kiểm độc lập.** |
| 5 | **Rate-limit đăng nhập bị e2e tắt vĩnh viễn** | `e2e/tests/helpers.ts:56-61` | `relaxLoginRateLimit()` chạy trong mọi `beforeEach` của cả 45 spec, **không bao giờ khôi phục**. Unit test thì tiêm config giả. `grep 429` trong e2e: 3 kết quả, tất cả về trần mở két, **không một dòng nào cho đăng nhập**. NFR-01 chưa từng chạy thật một lần. DB dev/test vĩnh viễn ở ngưỡng 500. |
| 6 | **`voidSubnet` mất dòng lịch sử IP** | `subnet.service.ts:295` | Xem M2. Vi phạm đúng điều comment `:291` tự hứa. |
| 7 | **Màn duyệt break-glass báo "không có yêu cầu" khi API lỗi** | `approvals-screen.tsx:99` | Xem M3. |
| 8 | **Nút Lưu sáng lại giữa lúc cất mật khẩu vào két** | `service-account-form.tsx:96` | `busy` về `false` ngay khi mutation settle, trong khi IIFE còn `await` POST vào vault. Bấm lần hai → **tạo trùng tài khoản dịch vụ**. |
| 9 | **Luật eslint AD-2 khớp 0 chuỗi** | `api/eslint.config.mjs:49-56` | Xem M1. |

---

## 4. Phương án cải thiện — bốn đợt

Nguyên tắc xuyên suốt: **sửa cổng trước, sửa code sau**. Không có bước 0 thì mọi thứ ở bước 1-3 sẽ
trôi lại trong hai epic — đúng như đã trôi qua 5 lượt review vừa rồi.

### Đợt 0 — Bật cổng (1-2 ngày) · chặn mọi việc khác

Đây là đợt có đòn bẩy cao nhất trong toàn bộ báo cáo.

1. Đẩy repo lên remote, bật branch protection yêu cầu 3 job xanh mới merge.
2. Sửa job `e2e`: thêm `env: IMS_BASE_URL: https://localhost`; gom 137 chỗ hardcode Origin về
   một hằng trong `helpers.ts`.
3. Sửa luật eslint AD-2: bỏ glob, dùng `regex` — **hoặc** tốt hơn, chuyển hẳn việc này cho
   `dependency-cruiser` (nó khớp trên đường dẫn đã resolve, đúng công cụ). Thêm luật phủ nhánh
   nghiệp vụ→nền và nền→nền, kèm danh sách ngoại lệ **tường minh có bình luận**.
4. Thêm `web/.oxlintrc.json` + `web/.dependency-cruiser.cjs`: cấm `@/features/*` bên trong
   `features/`, chặn `confirm`/`alert`/`createPortal` trong `features/`, bật `react-hooks/exhaustive-deps`.
   Nối vào CI.
5. Thêm root `package.json` để câu lệnh đóng epic trong `CLAUDE.md` chạy được.
6. Thêm **test hình dạng cho AD-9**: quét `**/*.controller.ts`, bắt mọi `@Post/@Patch/@Put/@Delete`
   phải có `@Audited` (hoặc nằm trong allowlist tường minh). Repo đã có đúng khuôn này ở
   `vault-surface.spec.ts` — nó là lý do FR-026 không thể trôi.
7. Thêm `eslint.config.spec.ts` khẳng định `'../users/users.service'` **bị báo lỗi** — để luật chết
   không im lặng lần thứ hai.

### Đợt 1 — Chín finding Chặn (3-5 ngày)

Theo đúng thứ tự bảng mục 3. Ghi chú thực thi:

- **#1 và #2 gộp một migration `0039`**: tạo role `ims_app` thật + `GRANT`/`REVOKE` trên cả 10 bảng
  append-only (nhớ `service_account_history` — bảng duy nhất bị sót khối REVOKE), thêm trigger
  `FOR EACH STATEMENT` chặn `TRUNCATE`, đổi `DATABASE_URL` của api/worker sang `ims_app` và giữ
  `MIGRATION_DATABASE_URL` riêng cho owner. Kèm sửa `u.sub` → `u.email` và thêm `ip` vào
  `audit.schema.ts` + interceptor (cùng file, cùng buổi, cùng phục vụ NFR-03).
- **#3**: `password.service.spec.ts` — khứ hồi, **pepper sai thì mật khẩu đúng phải trượt** (đây là
  toàn bộ lý do pepper tồn tại), salt khác nhau, guard `<32` phải ném, hash rác trả `false` không ném.
  Cộng `password-policy.spec.ts` table-driven đủ 6 biên.
- **#5**: khôi phục `login.rate_limit_per_ip` trong `globalTeardown`; thêm một e2e đường-hỏng riêng
  (hạ ngưỡng xuống 5, bắn 6 lần, chốt 429 + `LOGIN_RATE_LIMITED`, rồi trả về).

### Đợt 2 — Ba mẫu lỗi hệ thống (1-2 tuần)

1. **Quét sạch M2.** Áp khuôn CAS của `approvals.service.ts:143-171` lên: `ip-address.transition/
   update/voidAddress`, `subnet.voidSubnet`, `nat-rule.voidRule`, `license-assignment.release/
   updateTerms/assign`, `expiry-digest.runOne`, `accounts.setStatus`. Cộng ba ràng buộc DB làm hàng
   rào cuối: `EXCLUDE USING gist (cidr inet_ops WITH &&)` chống dải chồng nhau (`btree_gist` đã bật
   sẵn từ `0022`), `FOR UPDATE` trên `software` khi đếm seat, `FOR UPDATE` trên tập SA khi đổi trạng thái.
   Và đưa `expiry.renew` về **một** transaction (`renewWithin(tx, …)` theo nếp `ApprovalsApiService.createWithin`).
2. **Bịt M3.** Bọc thành hook `useListQuery` trả `{ items, failed, retry }` để nhánh lỗi **không thể
   quên**; hoặc một lint rule cấm `?? []` trên `.data` của `useQuery`. Đổi trần import 20k dòng từ
   cắt lặng lẽ thành `throw` nêu rõ số dòng. Cho `listRetired` trả `{ items, total }`.
3. **Trả M4 về code.** Job xoay `key_version` (quét `key_version < current`, rewrap theo lô trong tx,
   audit số bản ghi đã xoay, + health-check đếm bản ghi còn ở version cũ). Guard dùng chung
   `assertWritable(id)` ném `DEVICE_RETIRED` gọi từ 6 điểm ghi. Cờ `forbidSelfApproval` cài ở tầng
   `ApprovalFlowSpec` để Epic 8/9 kế thừa thay vì mỗi module tự nhớ. Controller cho `system_config`.

### Đợt 3 — Nợ có cấu trúc (song song, không chặn)

- **Dựng tầng giữa (quan trọng nhất trong đợt này):** `api/test/` đang **rỗng**, `npm run test:db`
  trỏ vào `jest-db.json` không tồn tại, compose **không có profile `test`**. Hoặc dựng thật, hoặc sửa
  `CLAUDE.md` cho khớp — đang nói một đằng làm một nẻo là tệ nhất. Ba test đầu tiên nên là: hai relay
  outbox song song không đẩy trùng; hai `transition` song song trên cùng IP phải có đúng một cái thắng;
  import file lỗi giữa chừng rollback sạch.
- Nâng 4 tài sản chung còn thiếu vào `api/src/common` + khai registry: `pagedSelect`, `buildOrderBy`,
  `onUniqueViolation`+`requireOne`, `appendHistory`/`readHistory` — xóa đúng chỗ đã đẻ ra bốn hành vi lệch.
- Đưa ngưỡng an ninh vào `system_config`: `@Throttle` ba route nhạy cảm (mở két · step-up · upload),
  `PASSWORD_MIN_LENGTH`, ngưỡng hạn 7/30 (hiện có **hai bản, hai ngôn ngữ**, không bản nào đọc config).
- Web: debounce vào `FilterBar` (một file, sửa xong 8 màn hết bắn request mỗi ký tự);
  đổi `htmlFor?: string` thành **bắt buộc** trong `Field` để 56 label mồ côi thành 56 lỗi biên dịch;
  `dismissible={!busy}` + `disabled={busy}` cho nút Hủy ở 5 form.
- i18n: 6 file có bán kính ảnh hưởng lớn nhất trước — `lib/expiry.ts`, `lib/api.ts`,
  `ui/import-preview.tsx`, `ui/schedule-picker.tsx`, `ui/history-panel.tsx`, `ui/time-picker.tsx`.
  Riêng `ariaLabel="Giờ"/"Phút"` làm đầu tiên: nó là hợp đồng với trình đọc màn hình, không chỉ là nhãn.
- Index còn thiếu: `approval_pending_idx`, `outbox_failed_idx`, `nat_rule_ext_idx`,
  `file_uploaded_by_idx`, `audit_log_action_idx`. Xóa index trùng 100% `ip_address_subnet_idx`.
- Chữa N+1: `devices.getById()` = **8 round-trip** (1 + 7 câu danh mục). Gọi trong vòng lặp ở 12 chỗ
  → `/24` có 200 IP là ~1600 truy vấn. Cache `catalog.lists()` trong một request + `getManyByIds(ids)`.
- `disposal` và `service-accounts` đã ship mà **không có story, không có AC** trong `epics.md` — nên
  DoD gạch 1 không ràng buộc được gì. Bổ sung story, hoặc khai rõ ngoài phạm vi kèm mức test tối thiểu.
- Sửa `CLAUDE.md`: token dark là `html[data-theme='dark']` chứ không phải `.dark` (làm đúng câu chữ
  hiện tại sẽ viết ra một khối CSS hợp lệ mà không bao giờ chạy); framework test api là Jest chứ
  không phải Vitest; `api/test` đang rỗng.
- Mở rộng grep hex trong `ci.yml:50` để bắt luôn `rgba()` — 23 chỗ đang lách qua, trong đó 3 chỗ làm
  menu ba chấm mới mất viền nổi ở theme tối.

---

## 5. Trạng thái DoD 8 gạch — thẳng thắn

| # | Gạch | Đạt | Ghi chú |
| --- | --- | --- | --- |
| 1 | Mọi AC có test, tất cả xanh | ✗ | Argon2+pepper, regenerate session, rate-limit IP, email thiết bị mới, seed 2 SA — đều 0 test |
| 2 | Không vi phạm AD-1..15; depcruise + eslint xanh | ½ | api có thật (nhưng luật AD-2 chết); **web không có gì** |
| 3 | Endpoint ghi có `@Audited` + `@Roles` + tx | ~ | 71/72 `@Roles`, 66/72 `@Audited`. Cài đặt tốt, **không có kiểm tự động nào** |
| 4 | Khai vào `SHARED-REGISTRY.md` | ✓ | Không một mục chết nào trong 120 dòng qua 9 epic. Thiếu khai 6 thứ đang dùng |
| 5 | Migration 4 chữ số, chỉ tiến, DB trắng | ½ | Runner rất tốt (advisory lock + checksum + tx) nhưng spec chạy bằng **Pool giả** — migration sai cú pháp Postgres vẫn xanh |
| 6 | i18n; màn đọc pass 390px | ~ | 390px làm **thật** (14 spec, project `mobile-390`, helper `horizontalOverflow`). i18n thủng ~160 chuỗi, kể cả trong `ui/` và `lib/` |
| 7 | E2E xanh trên `docker compose up` | ✗ | Chỉ xanh trên máy dev, trong môi trường đã bị `relaxLoginRateLimit()` làm bẩn |
| 8 | Không hardcode tham số nghiệp vụ | ~ | 14 khóa seed, dùng đúng. Nhưng ~20 hằng số nghiệp vụ còn ngoài, và `SystemConfigService` có **0 test** |

**Thực đạt: 2,5 / 8 gạch.** Các story đang mang nhãn `done` chưa đạt định nghĩa `done` của chính dự án.

---

## 6. Những thứ làm tốt — đừng phá khi sửa

Phần này không phải xã giao. Đây là những quyết định mà nếu ai đó "dọn dẹp" nhầm trong lúc sửa các
finding trên thì dự án sẽ nghèo đi.

- **Envelope crypto (`common/crypto/`) không có một lỗi nào.** IV `randomBytes(12)` sinh mới mỗi lần
  `seal` **và** mỗi lần `wrapDek`. DEK riêng cho từng giá trị. AAD = `table|record_id|key_version`
  khiến ciphertext không bê được sang hàng khác. `rewrap` `fill(0)` plaintext trong `finally`.
  KEK đọc từ docker secret file, `main.ts` fail-fast nếu thiếu.
- **`RolesGuard` deny-by-default là hàng rào chạy được.** Thiếu `@Roles` → `ForbiddenException` với
  thông điệp gọi thẳng tên vấn đề: *"Đây là lỗi lập trình."* Rất nhiều dự án viết câu này vào tài
  liệu rồi implement thành "cho qua nếu đã đăng nhập".
- **Không một byte key material nào từng vào git.** `git log --all --diff-filter=A` trên **toàn bộ ref**
  chỉ trả về `secrets/README.md`. Commit `c804b9a` bịt lỗ *trước khi* thư mục cert được đưa vào.
- **Đồ thị phụ thuộc acyclic là thật** — không một `forwardRef` nào trong `api/src`. Nhiều modular
  monolith "acyclic" thực ra là vòng tròn được `forwardRef` che đi.
- **Ba sổ đăng ký đảo phụ thuộc** (`DevicePanelRegistry`, `ExpirySourceRegistry`, `ApprovalKindRegistry`)
  đặt ở `common/` chứ không ở module chủ nhà — nên `devices` không cần biết `ipam`/`software`/`vault`
  tồn tại mà trang thiết bị vẫn có đủ khu.
- **Outbox là phần tốt nhất của backend.** `enqueueWithin(tx, …)` ở **11/11** điểm gọi. Relay claim
  bằng `FOR UPDATE SKIP LOCKED` trong tx ngắn rồi mới `queue.add` **ngoài** tx. Payload chỉ mang id
  tham chiếu nên PII không lọt vào Redis.
- **Schema thuần:** 26 FK, **không một `ON DELETE CASCADE` nào**; `timestamptz` ở mọi cột thời điểm;
  `inet`/`cidr` thật; tiền là `bigint` VND — **không một `float` nào**; `citext` cho mọi mã so sánh
  không phân biệt hoa thường. `nat_rule_no_overlap` (`EXCLUDE USING gist` + `int4range`) là ràng buộc
  hay nhất repo — bắt được chồng lấn **một phần** mà UNIQUE hai cột không bao giờ thấy.
- **`common/today.ts` + `digest-schedule.ts`** xử lý +07 tinh tế hơn phần lớn hệ thống: `en-CA` cho
  ISO date, suy thứ **từ ngày đã tách** thay vì đọc tên viết tắt của Intl (bẫy small-icu), fallback
  UTC khi timezone sai thay vì ném.
- **UX-DR2 được đóng bằng hạ tầng, không bằng lời hứa:** project Playwright `mobile-390` riêng,
  14 file `*.mobile.spec.ts`, helper `horizontalOverflow()`.
- **`ui/row-actions.tsx` là component tham chiếu** — WAI-ARIA menu button đủ Enter/Space/↓/↑/Home/End,
  nhảy qua mục `disabled`, Esc trả focus về trigger. Và **lý do** được viết ra để người sau không phá.
- **0 hex ngoài `tokens.css`, 0 `window.confirm`, 0 dialog tự dựng trong `features/`, 0 `any`/`!`/`@ts-ignore`**
  — bốn luật cứng khó nhất, giữ được cả bốn. Đáng nể hơn vì `tsconfig.app.json` **không bật `strict`**,
  tức compiler không hề ép, đội tự giữ.
- **`docs/EPIC-MAP.md` là tài sản hiếm.** Nó tự ghi lại ba lần "test xanh mà hành vi sai". Đội **tự soi
  được** đúng lớp lỗi mà báo cáo này chỉ ra — thứ còn thiếu là **cơ chế** để nó không lặp lại, không
  phải nhận thức.
- **Chú thích trong code giải thích *vì sao*, kèm số hiệu finding và ngày.** `app.module.ts:43-50`
  kể lại vì sao thứ tự guard đổi và bản cũ hỏng ở đâu. Loại tài liệu sống này đáng giá hơn cả
  `GRAPH_REPORT.md` — giữ nếp đó.

---

## 7. Kết luận

Hệ thống này được thiết kế bởi người hiểu việc: lõi mã hóa sạch, outbox đúng chuẩn, schema không có
bẫy kiểu dữ liệu, mô hình module tách bạch thật. Cái thiếu không phải kiến thức — `EPIC-MAP.md`
chứng minh đội **biết** những lớp lỗi này. Cái thiếu là **cơ chế cưỡng chế**: luật eslint khớp 0 chuỗi,
depcruise thiếu nửa số nhánh, web không có cổng nào, CI chưa từng chạy, tầng test giữa rỗng.

Nói ngắn gọn: đây là một hệ thống **thiết kế 8 điểm, thực thi 6 điểm, và không có gì giữ cho thực thi
khỏi tụt thêm**. Đợt 0 rẻ nhất và có đòn bẩy lớn nhất — làm xong nó rồi thì bảy đợt còn lại mới có
chỗ chứng minh mình còn sống.

**Khuyến nghị về Story 4.3 (đóng đợt 1 dữ liệu thật):** chưa nên mở cho tới khi xong Đợt 0 + Đợt 1.
Lý do cụ thể: nhật ký audit hiện chưa thật sự bất biến (#2), đường xoay chìa mã hóa chưa tồn tại (M4),
và DB dev/test đang mang cấu hình `login.rate_limit_per_ip = 500` — nếu diễn tập khôi phục lấy dữ liệu
từ đó thì cấu hình bẩn đi thẳng vào production.

---

## 8. Đã sửa những gì

Ghi ngày 28/08 tối. Mọi thay đổi đều đã chạy qua `npm run lint` + `npm run test` + `npm run build`
ở gốc repo. E2E **chưa chạy được** ở đây (cần `docker compose up`), nên các spec mới là mã đã
viết và parse được (`npx playwright test --list`: 259 test / 47 file), chưa phải kết quả xanh.

### Đợt 0 — cổng đã bật

| Việc | Cách kiểm chứng nó THẬT SỰ sống |
| --- | --- |
| Luật eslint AD-2 viết lại bằng regex (`api/ad2-boundary.js`) | `api/src/ad2-boundary.spec.ts` — 36 test bảng dữ liệu, chốt cả "phải bắt" lẫn "phải cho qua" lẫn ngoại lệ `auth`↔`users`. Khi bật lên, luật bắt được 4 vi phạm đang sống. |
| Ngoại lệ hạ tầng gom về MỘT chỗ, có tên và lý do | `INFRA_PRIMITIVES` trong `ad2-boundary.js` — danh sách đóng; thêm một dòng là phải sửa file đó, tức phải giải thích trong PR. |
| depcruise: sửa lỗi escape `\.` → `\\.` ở 6 regex | Regex trước rộng hơn ý định (dấu chấm khớp mọi ký tự). |
| depcruise: luật mới `schema-only-in-owning-module` (AD-3) | Đã probe: bỏ ngoại lệ ra thì nó bắt `auth/sessions.schema.ts → users/users.schema.ts`; để lại thì im. |
| Selector `no-restricted-syntax` bắt được `crypto.createCipheriv(...)` | Bản cũ chỉ khớp lời gọi trần nên để lọt đúng cách viết phổ biến nhất. Thêm cả `node:crypto`/`crypto` vào `importNames`. |
| **web có cổng lint lần đầu**: `web/.oxlintrc.json` | Đã probe: tạo một file import chéo feature → oxlint báo error; xóa đi → exit 0. |
| Luật tầng web: `ui`/`lib`/`shell` không import ngược vào `features` | Cùng cơ chế `no-restricted-imports`. |
| `package.json` gốc | `npm run lint` / `test` / `build` / `check` — câu lệnh đóng epic trong `CLAUDE.md` giờ chạy được. |
| CI: `IMS_BASE_URL: https://localhost` cho job e2e | Khớp với `APP_BASE_URL` mà job dựng stack. |
| 137 chỗ hardcode `Origin` → hằng `APP_ORIGIN` | `e2e/tests/helpers.ts`. baseURL của Playwright và Origin gửi lên giờ đọc từ cùng một biến. |

**Vi phạm AD-2/AD-15 đã dọn để cổng có trạng thái sạch mà bảo vệ:**
`ApprovalRecord`/`CreateApprovalInput`/`TransitionInput` tái xuất từ `approvals.api.ts`;
`USER_SORT_*` tái xuất từ `users.api.ts`; `known_device` chuyển schema về `auth/` (đúng chủ,
AD-3); phía web `catalog-types` + `device-types` → `web/src/lib/`, `use-departments` →
`web/src/ui/`; quy ước mới: trong cùng một feature dùng đường dẫn tương đối, `@/features/…`
luôn nghĩa là xuyên feature.

### Đợt 1 — 7/9 finding Chặn

| # | Finding | Đã làm |
| --- | --- | --- |
| 1 | `u.sub` | Đổi sang `u.email` + chú thích lý do. **Thêm `e2e/tests/audit-log.spec.ts`** — endpoint này trước đó có **0** test; spec mới chốt cả join khớp thật (`actorName` không null), lọc theo actor/ngày, 403 với member, và append-only của `audit_log`. |
| 2 | Append-only là giấy | `0039_append_only_no_truncate.sql`: trigger **cấp câu lệnh** `BEFORE TRUNCATE` cho cả 10 bảng chỉ-thêm (trigger `FOR EACH ROW` cũ không chạy khi TRUNCATE). Đưa `service_account_history` — bảng lệch chuẩn duy nhất — về dùng `history_append_only()` chung. **Phần còn lại (tách vai `ims_app`) chưa làm** — xem "Còn lại". |
| 3 | Argon2 + pepper 0 test | `password.service.spec.ts` (14 test) + `password-policy.spec.ts` (15 test). Bài quan trọng nhất: **pepper sai thì mật khẩu đúng phải trượt** — nếu ai đó bỏ pepper khỏi `season()`, giờ có thứ đỏ lên. Kèm chốt tham số `m=65536,t=3,p=1` và `verify` với hash rác trả `false` chứ không ném. |
| 4 | CI e2e không thể xanh | Sửa biến base URL + Origin (xem Đợt 0). **Chưa có remote** — xem "Còn lại". |
| 5 | Rate-limit bị e2e tắt vĩnh viễn | `global-teardown.ts` trả `login.rate_limit_per_ip` về giá trị gốc (`global-setup` cất trước). **`login-rate-limit.spec.ts`** mượn trần xuống 3, chứng minh 429 `LOGIN_RATE_LIMITED` là thật trên stack thật, rồi trả lại. Đây là lần đầu NFR-01 được kiểm không qua mock. |
| 6 | `voidSubnet` mất dòng `ip_history` | Bỏ câu SELECT ngoài transaction; danh sách hàng bị ẩn lấy từ `.returning()` của chính câu UPDATE. `addressesVoided` trong audit cũng hết sai số. |
| 7 | Màn duyệt break-glass báo "không có yêu cầu" khi API lỗi | Thêm nhánh `LoadError` + nút Thử lại. Kèm sửa tab "Yêu cầu của tôi" đang mượn thông điệp rỗng của Nhật ký (khóa mới `approvals.emptyMine`). |
| 8 | Nút Lưu sáng lại giữa lúc cất mật khẩu | Khóa từ đầu khối `onSuccess` trong `try/finally`, không chỉ quanh bước tải tệp. Thêm `dismissible={!busy}` và `disabled={busy}` cho nút Hủy. |
| 9 | Luật eslint AD-2 khớp 0 chuỗi | Xem Đợt 0. |

**Sửa kèm (cùng file, cùng lớp lỗi):** `known-device.service.ts` đổi đọc-rồi-ghi thành một câu
`INSERT ... ON CONFLICT DO UPDATE ... RETURNING (xmax = 0)` chạy trong chính transaction đăng
nhập — hai tab đăng nhập cùng lúc từ một máy trước đây ném 23505 không ai bắt → 500 và rollback
cả lượt đăng nhập. `.gitignore` lưu lại đúng UTF-8 (graphify đang phải đọc fallback cp1252).

### Cập nhật 03/09 — chạy E2E thật, phát hiện thêm 3 lỗi mà rà soát tĩnh không thấy

Lần đầu chạy `npx playwright test` trên stack thật với code đã sửa: **256 bài cũ xanh** (tức
là refactor 137 chỗ `Origin` và mọi bản sửa không làm hỏng gì), **4 bài mới đỏ**. Cả 4 đều là
phát hiện thật, không phải test viết ẩu.

**Module `audit` hỏng ở BA tầng chồng lên nhau, mỗi lỗi che lỗi kế tiếp.** Đây là bài học đáng
giá nhất của cả đợt: rà soát tĩnh chỉ thấy được lớp trên cùng.

| Lớp | Lỗi | Chỉ lộ ra khi |
| --- | --- | --- |
| 1 | `LEFT JOIN users u ON u.sub = a.actor` — cột `sub` không tồn tại → 42703 | đọc code (đã tìm ra ở rà soát tĩnh) |
| 2 | `@Controller('admin/audit')` thiếu tiền tố `api/v1` — controller **duy nhất trong 17 cái**. nginx chỉ chuyển tiếp `/api/`, `= /api`, `= /health`; mọi đường khác rơi vào SPA fallback → endpoint **không tiếp cận được từ trình duyệt** | gọi thật qua nginx (E2E) |
| 3 | `created_at` **mơ hồ** giữa `audit_log` và `users` (cả hai bảng đều có cột đó) → 42702 mỗi khi lọc theo ngày. Điều kiện WHERE viết cột trần, không gắn bí danh | sửa xong lớp 1 mới chạm tới được |

Lớp 2 và 3 **không thể phát hiện bằng đọc code** một cách thực tế: lớp 2 cần biết cấu hình
nginx, lớp 3 bị lớp 1 che. Chúng chứng minh vì sao E2E chạm endpoint thật là bắt buộc chứ
không phải xa xỉ.

Đã thêm `api/src/route-prefix.spec.ts` — quét mọi `*.controller.ts`, bắt buộc tiền tố `api/v1`,
có ngoại lệ tường minh cho `/health`. Bài này chặn cả **lớp** lỗi chứ không chỉ một chỗ, và có
chốt sàn `files.length >= 15` để không "xanh vì không tìm thấy gì".

**Lỗi thứ tư — trong chính bài test của tôi, và nó cũng chỉ ra một sự thật về hệ thống:**
`login-rate-limit.spec.ts` bắn dồn dập để chờ cache config nhả, nên trúng **throttler toàn cục**
(300 req/phút) trước và nhận `TOO_MANY_REQUESTS` thay vì `LOGIN_RATE_LIMITED`. Hai hàng rào khác
nhau. Sửa bằng cách giãn cách 4 giây mỗi lần bắn.

Nhân đó, bài test **chứng minh bằng thực nghiệm** finding F-QA-12: `SystemConfigService` cache
30 giây trong bộ nhớ tiến trình và `setWithin` chỉ xóa cache trong tiến trình gọi nó — nên "đổi
cấu hình có hiệu lực ngay" là **không đúng**: có độ trễ tới 30 giây, và worker giữ cache riêng.
Đây là thứ cần ghi vào tài liệu vận hành trước khi ai đó siết một ngưỡng an ninh trong sự cố
và tưởng nó có tác dụng tức thì.

**Lỗi thứ năm — cũng của tôi:** `rate-limit-backup.ts` dùng `__dirname` trong khi gói `e2e` khai
`"type": "module"` → `globalSetup` chết và **không bài nào chạy**, trong khi lệnh vẫn thoát 0 vì
bị nối `| tail`. Nhắc lại một điều trong chính báo cáo này: "xanh" và "không chạy gì" trông
giống hệt nhau nếu không nhìn kỹ.

### Còn lại — cần quyết định của chủ dự án

1. **Đẩy repo lên remote + bật branch protection.** Tôi không tạo remote thay được. Cho tới
   khi có, CI vẫn chưa từng chạy và mọi kết quả test vẫn là tự khai trên máy dev — đây vẫn là
   finding có đòn bẩy lớn nhất trong cả báo cáo.
2. **Tách vai DB `ims_app`** (phần còn lại của #2). Nó cần: một docker secret mới cho mật khẩu
   `ims_app`, đổi `DATABASE_URL` của `api`/`worker`, và giữ một `MIGRATION_DATABASE_URL` riêng
   cho owner. Đây là thay đổi cách triển khai và sẽ làm `docker compose up` hỏng nếu thiếu
   bước tạo secret — nên tôi dừng lại chờ ý kiến thay vì làm nửa vời. Cho tới khi đó,
   `ALTER TABLE ... DISABLE TRIGGER` và `DROP TRIGGER` vẫn là đường vòng mở cho ai có quyền
   chạy SQL trực tiếp.
3. **Đợt 2 và Đợt 3 chưa động tới** — đặc biệt: quét sạch mẫu M2 ở 5 chỗ còn lại, guard
   `retired`, chặn tự duyệt break-glass, job xoay `key_version`, dựng `api/test/` với Postgres
   thật, debounce `FilterBar`, `htmlFor` bắt buộc.
