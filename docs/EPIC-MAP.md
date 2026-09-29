# Bản đồ epic — mỗi epic để lại gì cho epic sau

`graphify-out/GRAPH_REPORT.md` được **sinh lại** mỗi lần `graphify update .` nên không ghi tay
vào đó được. File này là phần ghi tay đi kèm: đọc cặp `GRAPH_REPORT.md` (cấu trúc thật của code)
+ `EPIC-MAP.md` (ý định và hợp đồng giữa các epic).

**Quy trình đóng epic** (xem `CLAUDE.md`):

```bash
npm --prefix api test && npm --prefix web test && (cd e2e && npx playwright test)
/code-review high            # sửa hết finding trước khi đóng
graphify update .            # cập nhật GRAPH_REPORT.md
graphify god-nodes --top 15  # hub mới phải là *.api.ts / service dùng chung, không phải file nội bộ
```

Rồi thêm một mục vào đây.

---

## Epic 1 — Nền tảng & Đăng nhập an toàn (đóng 2026-08-22)

### Bảng mới và ai sở hữu (AD-3)

| Bảng | Module chủ | Ghi chú cho epic sau |
| --- | --- | --- |
| `users`, `known_device` | `users` | Module khác đọc qua `UsersApiService`, cấm query trực tiếp |
| `sessions` | `auth` | Phiên server-side; `totp_pending`, `stepped_up_at` phục vụ FR-022 |
| `audit_log` | `audit` | Append-only ở tầng DB (REVOKE + trigger) — chỉ INSERT |
| `outbox` | `outbox` | Mọi email đi qua đây, ghi trong transaction nghiệp vụ |
| `file` | `files` | Sẵn cho FR-002 (đính kèm thiết bị) ở Epic 2 |
| `system_config` | `config-sys` | Mọi ngưỡng vận hành (AD-11) — thêm khóa thì khai ở `system-config.keys.ts` |

### Hợp đồng epic sau sẽ dùng

| Thứ | Ở đâu | Epic dùng |
| --- | --- | --- |
| `EnvelopeCryptoService` (AES-256-GCM + xoay key_version, có test vector) | `api/src/common/crypto/` | **Epic 4** két sắt, **Epic 6** break-glass |
| `ExpirySource` (interface provider) | `api/src/common/expiry/expiry-source.ts` | **Epic 3** — module chủ tự đăng ký, engine không quét bảng ai (AD-7) |
| `ExcelExportService` | `api/src/common/excel/` | **Epic 2** export thiết bị, **Epic 7** export mọi bảng (FR-028) |
| `Tx` + mẫu `db.transaction(tx => …)` | `api/src/common/tx.ts` | Mọi story ghi (AD-5) |
| `@Audited` + `@Roles` + guard | `api/src/modules/audit`, `modules/auth` | Mọi controller (AD-9) |
| `SessionService.markSteppedUp` + `isStepUpValid` | `modules/auth` | **Epic 4** FR-022: xem secret cần step-up TOTP còn hiệu lực |
| Bộ UI dùng chung + `/dev/components` | `web/src/ui`, `docs/SHARED-REGISTRY.md` | Mọi màn từ Epic 2 trở đi (AD-15) |
| `expiryLevel/expiryLabel` | `web/src/lib/expiry.ts` | **Epic 2** bảo hành, **Epic 3** license/SSL/ISP |
| `nextStepPath` | `web/src/lib/me.ts` | Router — màn không tự điều hướng |

### God node sau Epic 1 (đối chiếu AD-2)

`UsersService`, `AuthedRequest`, `Database`, `SessionService`, `Roles()`, `Tx`, `OutboxService`,
`AuthService`, `SystemConfigService`, `AccountsService` — **đều là tài sản dùng chung hoặc service
của module chủ**. Chưa có file nội bộ nào trở thành hub, tức chưa có import lậu xuyên module.

### Nợ kỹ thuật cố ý mang sang

| Việc | Vì sao hoãn | Hạn chót |
| --- | --- | --- |
| CI đã có file `.github/workflows/ci.yml` + `ops/ci-local.sh` nhưng **chưa gắn runner** | Chưa chốt chạy CI ở đâu (GitHub hay máy nội bộ) | Trước khi có người thứ hai commit |
| `audit.controller` (màn xem nhật ký) chưa dựng UI | Không nằm trong AC Epic 1 | Epic 6 (nhật ký break-glass) |
| Restore drill lần đầu (AR-9) | Phải chạy **cuối Đợt 1**, trước khi secret thật vào két | Cuối Epic 4 |
| `system_config` chưa có màn Admin để sửa | AC Epic 1 chỉ yêu cầu seed + đọc | Epic 3 (luật digest cần UI) |

### Code review đóng epic — 7 finding, đã sửa hết

| # | Mức | Vấn đề | Cách sửa |
| --- | --- | --- | --- |
| 1 | Nghiêm trọng | `/auth/totp/enroll/confirm` cấp phiên đã xác thực mà **không kiểm chống-replay và không kiểm đã enroll chưa** → kẻ có mật khẩu + một mã đã dùng đi vòng qua `/login/totp` | Chặn khi `totpEnrolledAt != null`, truyền `totpLastTimestep`, ghi audit khi thất bại. E2E `security.spec.ts` giữ hàng rào này |
| 2 | Cao | Nút Khóa/Mở khóa luôn 400 (`id` lọt vào body, `forbidNonWhitelisted` chặn) | `useApiMutation` thêm `body` mapper; E2E khóa→mở lại |
| 3 | Cao | Script reset tài khoản test chỉ **cảnh báo** ở prod và đã nằm trong image runtime | Bắt buộc `ALLOW_E2E_RESET=1` mới chạy; bỏ script khỏi image, E2E mount qua `docker-compose.override.e2e.yml` |
| 4 | Trung bình | `sessions.revoke()` chạy ngoài transaction bao quanh → rollback là user mất phiên cũ mà không có phiên mới | Thêm `revokeWithin(tx, …)`, dùng ở cả 2 chỗ |
| 5 | Trung bình | Ô tìm kiếm tài khoản chỉ lọc 20 dòng đang xem, tổng số vẫn báo 137 | Chuyển `?search=` xuống API, reset trang khi đổi từ khóa, thêm dòng "Chưa có dữ liệu" |
| 6 | Thấp–TB | Danh sách 401 "phiên chết" là allowlist, sót `TOTP_REQUIRED`/`UNAUTHORIZED`/lỗi không JSON → kẹt màn hỏng | Đảo thành danh sách loại trừ: chỉ mã do người dùng nhập sai mới ở lại tại chỗ |
| 7 | Thấp | `/dev/components` mọi vai đều vào được | Gắn `roles: ['sa']` ở nav **và** gác route; E2E kiểm member nhận 404 |

### Bẫy đã gặp — đừng lặp lại

1. **`apiFetch` redirect mọi 401** → màn đăng nhập không hiện nổi lỗi "sai mật khẩu".
   Giờ chỉ redirect khi `code` thuộc nhóm phiên chết. Có test hồi quy.
2. **Điều hướng rải rác ở từng màn** → đua với router khi `me` được nạp lại, đá người dùng
   vòng vòng. Giờ chỉ `nextStepPath` quyết định.
3. **Enroll TOTP xong nhưng phiên vẫn `totp_pending`** → user kẹt. Enroll trong luồng đăng nhập
   giờ cấp lại phiên như đã qua bước 2.
4. **E2E dùng lại mã TOTP cũ** → bị chống-replay chặn, dễ tưởng là bug. Helper `freshTotpCode`
   chờ sang chu kỳ 30 giây mới.

---

## Epic 2 — Kho thiết bị (đóng 2026-08-23)

### Bảng mới và ai sở hữu (AD-3)

| Bảng | Module chủ | Ghi chú cho epic sau |
| --- | --- | --- |
| `site`, `cabinet`, `device_type`, `vendor` | `catalog` (tầng nền) | Module khác đọc qua `CatalogApiService`. Xóa bị FK RESTRICT chặn → dịch thành 409 kèm gợi ý vô hiệu hóa |
| `catalog_history` | `catalog` | Append-only (trigger `history_append_only`) |
| `device` | `devices` | KHÔNG có cột xóa và KHÔNG có endpoint xóa — chỉ đổi trạng thái, `retired` khóa hồ sơ |
| `device_history` | `devices` | Append-only; port map cũng ghi vào đây |
| `device_port` | `devices` | AD-14: một kết nối một bản ghi, chiều ngược dựng bằng query |
| `file` (sửa lại cho khớp migration 0007) | `files` | `owner_type`/`owner_id` phục vụ mọi chủ thể; xóa mềm |

### Hợp đồng epic sau sẽ dùng

| Thứ | Ở đâu | Epic dùng |
| --- | --- | --- |
| `CatalogApiService` (`lists`, `snapshot`, `validateRefs`, `hasPortMap`) | `modules/catalog/catalog.api.ts` | Mọi module cần site/tủ/loại/NCC |
| `DevicesApiService` (`getById`, `exists`, `search`) | `modules/devices/devices.api.ts` | **Epic 3** license theo seat, **Epic 4** secret gắn thiết bị, **Epic 5** IP gắn thiết bị, **Epic 9** phiếu sự cố |
| `FilesApiService` | `modules/files/files.api.ts` | **Epic 8** đính kèm phiếu, **Epic 9** ảnh sự cố |
| **`DevicePanelProvider` + token `DEVICE_PANEL_PROVIDERS`** | `common/device-panels.ts` | **Epic 3/4/5**: góp một khu vào trang chi tiết thiết bị mà `devices` không cần biết module đó tồn tại |
| `ExcelImportService` + `common/import-plan.ts` | `common/` | Mọi màn import về sau (license, IP) — đừng viết lại parser cột/ngày |
| `ImportDialog`, `ImportPreview`, `FilePicker`, `AttachmentPanel`, `Tabs` | `web/src/ui/` | Mọi màn có import hoặc đính kèm |
| `pgErrorCode` + `PG_*` | `common/sql.ts` | Dịch lỗi ràng buộc DB thành câu tiếng Việt |

### God node sau Epic 2 (đối chiếu AD-2)

`Roles()`, `AuthedRequest`, `Database`, `Tx`, `Audited()`, `UsersService`, `DevicesService`,
`CatalogService`, `SessionService`, `AuditWriterService`, `SystemConfigService`,
`CatalogEntity`, `DevicesController` — **đều là tài sản dùng chung hoặc service của module
chủ**. Chưa có file nội bộ nào trở thành hub, tức chưa có import lậu xuyên module.

### Đo hiệu năng (AC 2.2 "< 2 giây" với 300+ thiết bị)

Nạp 400 thiết bị vào DB rồi đo thẳng trên stack docker (2026-08-23):

| Truy vấn | Thời gian |
| --- | --- |
| Trang 1, 20 dòng | 71 ms |
| Trang 10 (offset 180) | 37 ms |
| Tìm theo tên | 26 ms |

Cách xa trần 2 giây. Chỉ mục theo site/tủ/loại/trạng thái đã có sẵn ở migration 0012;
khi kho vượt ~5.000 thiết bị thì xem lại `ILIKE '%…%'` (cân nhắc `pg_trgm`).

### Nợ kỹ thuật cố ý mang sang

| Việc | Vì sao hoãn | Hạn chót |
| --- | --- | --- |
| CI vẫn chưa gắn runner (mang từ Epic 1) | Chưa chốt chạy ở đâu | Trước khi có người thứ hai commit |
| Blob của file xóa mềm chưa có job dọn đĩa | Chưa đáng, dung lượng nhỏ | Khi ổ file vượt ~50% |
| `devices` chưa đăng ký `ExpirySource` cho bảo hành | Engine expiry mới ra đời ở story 3.4 | Epic 3 |
| Bảng port map chưa có chế độ nhập nhanh nhiều cổng | 300 thiết bị nhưng port map làm dần | Khi có switch 48 cổng cần khai đủ |

### Code review đóng epic — 8 finding, đã sửa hết

| # | Mức | Vấn đề | Cách sửa |
| --- | --- | --- | --- |
| 1 | Trung bình | Import thiết bị ghi thẳng, **bỏ qua `validateRefs`** → file chỉ có cột Site (không có cột Tủ) mà đổi site thì thiết bị giữ tủ của site CŨ. Sai lặng lẽ, DB không có ràng buộc nào chặn; form nhập tay thì chặn | Lõi đối chiếu ghép giá trị file với hồ sơ ĐANG CÓ rồi mới kiểm cặp site/tủ. 2 test hồi quy |
| 2 | Trung bình | Kiểm khoảng bảo hành chỉ chạy khi file có ĐỦ hai cột ngày → sửa một đầu vẫn tạo được khoảng ngược, rơi xuống `CHECK` của DB thành 500 không rõ dòng nào | Cũng ghép với giá trị đang có; câu lỗi nêu cả hai ngày. Test hồi quy |
| 3 | Thấp | Ô "Trạng thái" để TRỐNG bị ép về `in_use` → file sửa tay âm thầm hồi sinh thiết bị đã thanh lý, đẩy nó về lại danh sách nhắc bảo hành | Cột có mà ô trống = không đụng tới; thiết bị mới thì DB dùng mặc định. 2 test |
| 4 | Thấp | Lịch sử của dòng import ghi `mã: SW-01 → SW-01` — dòng tồn tại mà vô dụng, FR-007 không trả lời được "đổi gì" | Dùng `diffDevice` như luồng sửa tay; context dựng một lần, dùng cho cả đối chiếu lẫn lịch sử |
| 5 | Trung bình | `requireXlsx`/`sendXlsx`/trần dung lượng bị **copy y hệt** sang hai controller (vi phạm AD-15) và đã kịp lệch nhau: 5MB vs 10MB, một bên có header còn bên kia không | Tách `common/excel/xlsx-http.ts`, khai vào SHARED-REGISTRY |
| 6 | Thấp | Import thiết bị tự dựng lại map danh mục thay vì dùng `CatalogApiService.snapshot()` — hai bản luật đặt khóa | Dùng thẳng `snapshot()` |
| 7 | Thấp | `stripDiacritics` viết dải dấu phụ bằng KÝ TỰ TỔ HỢP TRẦN trong khi chú thích bảo là escape — editor nào nuốt mất là mọi màn import ngừng khớp tên cột không dấu, im lặng | `new RegExp('[̀-ͯ]', 'g')` |
| 8 | Trung bình (tự phát hiện) | Mỗi thao tác ghi đẻ **hai dòng audit** (interceptor + service), đôi khi khác tên (`device.status.changed` vs `device.status-changed`) → màn nhật ký Epic 6 sẽ thấy mọi việc lặp đôi | `@Audited(..., { writtenByService: true })`: service ghi dòng chi tiết trong transaction, interceptor đứng ngoài. Route vẫn khai để giữ AD-9. 3 test |

### Bẫy đã gặp — đừng lặp lại

1. **`@Param()` bằng DTO thiếu tham số** → `forbidNonWhitelisted` chặn, MỌI route `:entity/:id`
   trả 400. Cùng họ với bẫy body ở story 1.4: DTO phải khai ĐỦ tham số của route.
2. **drizzle bọc lỗi pg vào `cause`** → `error.code` ở lớp ngoài luôn `undefined`, mọi câu
   "dịch lỗi DB" rơi xuống 500. Giờ đào bằng `pgErrorCode` dùng chung, có test.
3. **Luật depcruise `biz-cross-only-via-api` viết `` thay vì `$1`** → bắt nhầm mọi import
   nội bộ ngay khi module nghiệp vụ đầu tiên ra đời. Group matching dùng `$1`.
4. **Named volume lấy quyền từ image lúc khởi tạo** → `/data/files` không có sẵn trong image
   nên volume ra root, container uid 1000 không ghi được, mọi upload 500 EACCES.
5. **Trần đăng nhập viết cứng trong `@Throttle`** trong khi `system_config` có khóa cho nó —
   khóa cấu hình để trưng bày. Bộ E2E lớn dần đâm vào trần mới lộ ra (AD-11).
6. **Locator E2E bám vào nhãn có dấu `*`** (aria-hidden) hoặc vào chuỗi số sinh theo
   timestamp → đỏ ngẫu nhiên. Dùng `getByRole(..., { exact: true })` và mã có tiền tố cố định.
7. **Dữ liệu E2E không tự dọn** → bảng tràn sang trang 2, locator bắt trúng bản ghi lần chạy
   trước. Quy ước: mọi mã do E2E tạo đều chứa chuỗi `E2E`, `resetDevices`/`resetCatalog` xóa theo đó.

---

## Epic 3 — Phần mềm & Cảnh báo hết hạn (đóng 2026-08-23)

### Bảng mới và ai sở hữu (AD-3)

| Bảng | Module chủ | Ghi chú cho epic sau |
| --- | --- | --- |
| `software`, `software_history` | `software` | KHÔNG có cột key/mật khẩu — chìa khóa nằm ở két sắt (AD-4) |
| `license_assignment` | `software` | Gỡ gán = `released_at`, không xóa dòng. Unique index CÓ ĐIỀU KIỆN nên gỡ rồi gán lại cùng máy vẫn được |
| `isp_line`, `isp_line_history` | `software` | Cùng nhà vì đều là "hợp đồng có ngày gia hạn"; spine chỉ khai 8 module nghiệp vụ |
| `renewal_history` | `expiry` | Tham chiếu LỎNG (`object_kind` + `object_id`), không FK — engine không được biết bảng nào tồn tại |
| `expiry_rule` | `expiry` | Luật gửi digest; `last_sent_at` là mốc chống gửi trùng |

### Hợp đồng epic sau sẽ dùng

| Thứ | Ở đâu | Epic dùng |
| --- | --- | --- |
| `ExpirySourceRegistry` (@Global) + `ExpirySource` | `common/expiry/` | **Bất kỳ** module nào có ngày hết hạn: gọi `register(this)` là tự xuất hiện ở màn Expiry, ở bộ lọc và trong email digest. Không sửa gì trong `expiry` |
| `DevicePanelRegistry` (@Global) | `common/device-panels.registry.ts` | Đã dùng thật 2 lần (license, ISP). **Epic 4** cắm panel secret, **Epic 5** cắm panel IP y hệt |
| `SoftwareApiService`, `ExpiryApiService` | `modules/*/*.api.ts` | **Epic 4** gắn secret vào hồ sơ phần mềm, **Epic 7** dashboard đếm sắp-hết-hạn |
| `common/today.ts` (`isoDateInTz`, `addDays`, `daysBetween`) | `common/` | Mọi phép tính ngày. **Cấm** `new Date().toISOString()` để lấy "hôm nay" |
| `common/record-diff.ts` | `common/` | Lịch sử của mọi bảng (AD-13) — module chủ chỉ khai danh sách trường của mình |
| `digest-schedule.ts` (`shouldSendNow`) | `modules/expiry/` | Mẫu "đến kỳ chưa" cho mọi thứ chạy định kỳ: **Epic 6** nhắc yêu cầu quá hạn, **Epic 8** sinh kỳ phiếu |

### God node sau Epic 3 (đối chiếu AD-2)

`Roles()`, `AuthedRequest`, `Audited()`, `Database`, `Tx`, `AuditWriterService`,
`SoftwareService`, `DevicesService`, `UsersService`, `IspLineService`, `CatalogService`,
`SessionService`, `SystemConfigService`, `DRIZZLE_DB` — **đều là tài sản dùng chung hoặc
service của module chủ**. Chưa có file nội bộ nào thành hub. `depcruise` sạch hoàn toàn
(0 vi phạm, kể cả cảnh báo orphan trước đây).

### Nợ kỹ thuật cố ý mang sang

| Việc | Vì sao hoãn | Hạn chót |
| --- | --- | --- |
| CI vẫn chưa gắn runner (từ Epic 1) | Chưa chốt chạy ở đâu | Trước khi có người thứ hai commit |
| Chưa có màn Admin sửa `system_config` | Chưa story nào cần; digest đã có màn riêng | Epic 6 (trần grant break-glass) |
| `expiry_rule` chưa gửi được theo VAI (chỉ theo email) | Sếp có thể không có tài khoản IMS; email đơn giản và đủ | Khi có yêu cầu "gửi cho mọi Admin" |
| Import hàng loạt cho phần mềm/ISP | Đợt 1 nhập tay vài chục dòng là xong; bộ khung `import-plan` đã sẵn | Khi số hồ sơ vượt ~100 |

### Code review đóng epic — 9 finding, đã sửa hết

| # | Mức | Vấn đề | Cách sửa |
| --- | --- | --- | --- |
| 1 | Trung bình | Luật đang chạy mà KHÔNG có người nhận: sweep mỗi phút lại thấy "đến kỳ", lại bỏ qua, lại ghi cảnh báo — ~960 dòng rác/ngày, mãi mãi | Luật `active` bắt buộc có ≥1 người nhận; muốn để dành thì tắt. Kỳ vẫn được chốt nên dữ liệu cũ chỉ cảnh báo một lần |
| 2 | Trung bình | Một nguồn hạn ném lỗi làm lỗi thoát khỏi `runDue` → **mọi luật xếp sau ngừng gửi**, tín hiệu duy nhất là một dòng log | Bọc try/catch quanh TỪNG luật |
| 3 | Trung bình | `last_sent_at` đọc-rồi-ghi, không nguyên tử → hai worker cùng lọt, người nhận lãnh hai thư giống hệt | `UPDATE … WHERE last_sent_at < đầu ngày RETURNING` — ai chốt được kỳ thì người đó gửi, đúng lối outbox đã dùng |
| 4 | Trung bình | Email người nhận + tên hồ sơ nằm trong payload outbox, trái hợp đồng "chỉ id tham chiếu, không PII" (AD-11/NFR-04) — và relay copy sang cả job data của Redis | Outbox chỉ giữ `ruleId`; consumer dựng lại nội dung qua `ExpiryApiService.buildDigest` |
| 5 | Trung bình | E2E đếm số mục chính xác nhưng KHÔNG dọn thiết bị — một cái máy sót lại từ spec khác là số đếm lệch, test đỏ ngẫu nhiên | Thêm `resetDevices()` và khoanh luật vào đúng hai loại vừa tạo |
| 6 | Thấp | Tiêu đề gọi tất cả là "sắp hết hạn" trong khi thân thư ghi "ĐÃ QUÁ HẠN 200 ngày" → mất tin vào tiêu đề, và thứ quá hạn (gấp nhất) bị chìm | Tiêu đề tách hai con số: "N mục ĐÃ QUÁ HẠN, M mục sắp hết hạn" |
| 7 | Thấp | Thứ trong tuần tra theo TÊN VIẾT TẮT của Intl + `?? 1`: bản Node small-icu trả "Mon." là mọi ngày thành Thứ Hai — luật "hằng tuần" gửi cả bảy ngày, không một dòng lỗi | Suy thứ TỪ NGÀY bằng số học, không đọc tên |
| 8 | Thấp | `localNowIn` thiếu lưới an toàn múi giờ mà `isoDateInTz` đã có → cấu hình sai là màn Expiry vẫn chạy còn digest im lặng không bao giờ gửi | Bọc try/catch, lùi về UTC như hàm anh em |
| 9 | Thấp | `@Matches(/^[0-9a-fA-F-]{36}$/)` nhận cả 36 dấu gạch ngang → xuống tới Postgres và bung **500** thay vì 400 | Dùng `@IsUUID()` như mọi controller khác |

### Bẫy đã gặp — đừng lặp lại

1. **Đặt sổ đăng ký bên trong module đọc nó.** Lần đầu tôi để `DevicePanelsService` trong
   `devices` — thành ra mọi module muốn góp panel đều phải chạm ruột `devices`. depcruise bắt
   ngay. Sổ đăng ký thuộc về `common`, vì cả bên ghi lẫn bên đọc đều cần.
2. **Luật depcruise viết chặt quá cũng là lỗi.** `biz-cross-only-via-api` cấm luôn cả
   `import ... from '../devices/devices.module'` — mà trong Nest đó là cách duy nhất để DI
   cấp api service. Cấm hết thì hai module nghiệp vụ không bao giờ gọi nhau được.
3. **`new Date().toISOString()` KHÔNG phải "hôm nay".** Nó là hôm nay theo UTC. Với giờ VN
   (+07), từ 0h đến 7h sáng nó trả về HÔM QUA — mọi phép "còn bao nhiêu ngày" lệch một ngày
   suốt buổi sáng. E2E chạy lúc 6 giờ sáng mới lộ ra.
4. **Thư đầu tiên trong hộp mailpit không phải thư mình vừa gửi.** Luồng đăng nhập lần đầu
   cũng gửi email "thiết bị mới". Test phải tìm theo TIÊU ĐỀ, không lấy `messages[0]`.
5. **Sweep chạy mỗi phút + so "đúng giờ hẹn" = mất kỳ.** Lỡ một phút vì restart là mất cả
   tuần. So "đã qua giờ hẹn" + mốc `last_sent_at` mới vừa gửi bù được vừa không gửi trùng.
6. **`Field` thiếu `htmlFor` là ô nhập không có tên** với trình đọc màn hình — và cũng là lý
   do `getByRole('textbox', { name })` của Playwright không tìm thấy. Test trợ năng bắt hộ.

## Epic 4 — Két sắt (code xong 2026-08-23; story 4.3 chờ diễn tập khôi phục)

### Bảng mới và ai sở hữu (AD-3)

| Bảng | Module chủ | Ghi chú cho epic sau |
| --- | --- | --- |
| `secret` | `vault` | **Chỉ `vault` được đụng** — depcruise có luật `secret-table-only-in-vault`. Tham chiếu chủ thể LỎNG (`owner_type` + `owner_id`, không FK): vault không được biết bảng của module khác |

### Hợp đồng epic sau sẽ dùng

| Thứ | Ở đâu | Epic dùng |
| --- | --- | --- |
| `@RequiresStepUp()` + `StepUpGuard` | `modules/auth/step-up.guard.ts` | **Epic 6** break-glass, và mọi cửa cần "vừa gõ TOTP xong". Cấm viết `if (steppedUpAt…)` trong service |
| `VaultApiService` | `modules/vault/vault.api.ts` | Module khác hỏi "chủ thể này có mấy secret". CỐ Ý không có hàm trả plaintext |
| `StepUpDialog`, `RevealDialog`, `OtpInput` | `web/src/ui/` | Bất cứ màn nào cần gõ TOTP hoặc hiện một bí mật rồi tự ẩn |

### Nợ kỹ thuật cố ý mang sang

| Việc | Vì sao hoãn | Hạn chót |
| --- | --- | --- |
| Story 4.3 (diễn tập khôi phục, dữ liệu thật, deploy LAN) | Cần TAY NGƯỜI: mở phong bì niêm phong, máy sạch, bấm deploy | Xem `docs/RUNBOOK-4.3-dong-dot-1.md` |
| Chưa có màn xoay `key_version` hàng loạt | `rewrap()` đã có và có test; chưa có secret nào cần xoay | Lần xoay chìa đầu tiên |

### Code review đóng epic — 5 finding, đã sửa hết

| # | Mức | Vấn đề | Cách sửa |
| --- | --- | --- | --- |
| 1 | Trung bình | `UserThrottlerGuard` đếm theo `req.user.email` nhưng đăng ký TRƯỚC `SessionGuard` → `req.user` chưa có → **lặng lẽ lùi về đếm theo IP**, sau nginx là cả văn phòng chung một bucket. Đúng thứ epic review 2 sinh ra để sửa lại không chạy, mà không có gì đỏ | Đổi thứ tự Session → Throttler. Kèm: gõ sai step-up đủ ngưỡng thì THU HỒI PHIÊN (không khóa tài khoản — khóa thì kẻ tấn công lại khóa được người dùng thật) |
| 2 | Trung bình | Hình dạng route "một id mỗi lần" một mình không giữ nổi FR-026: phiên đã step-up cứ liệt kê rồi mở lần lượt là rút cả két trong vài phút | Trần theo USER: 30/phút cho mở két, 10/phút cho step-up. Audit là hàng rào PHÁT HIỆN, trần là hàng rào PHÒNG |
| 3 | Thấp | Nút Xem không chặn bấm đúp → một cú đúp = hai lần giải mã, hai dòng audit, đồng hồ tự ẩn khởi động lại | Chốt bằng `ref` (không phải state): hai lần bấm cùng nhịp render đều đọc state cũ |
| 4 | Thấp | Thiếu phiên mà trả `STEPUP_REQUIRED` → UI mở hộp nhập mã người dùng không bao giờ thoát được | Trả `SESSION_MISSING` |
| 5 | Thấp | Chưa có assertion 390px cho hộp nhập mã và hộp hiện giá trị — đúng cảnh dùng thật (2 giờ sáng, trước tủ rack) | Thêm test với mật khẩu dài đầy ký tự đặc biệt |

### Bẫy đã gặp — đừng lặp lại

1. **Thứ tự guard toàn cục là một hợp đồng ngầm, và nó im lặng khi sai.** Guard đọc
   `req.user` phải nằm SAU guard dựng ra `req.user`. Sai thì `?? req.ip` nuốt gọn, không log,
   không test đỏ — chỉ có một hàng rào an ninh âm thầm yếu đi.
2. **"Không có endpoint xuất hàng loạt" không phải một lời hứa, nó là hình dạng route.**
   Bỏ `GET /secrets` trần và bắt buộc `ownerType`+`ownerId` thì không còn gì để lỡ gọi. Nhưng
   hình dạng thôi chưa đủ — phải có trần rate mới thành hàng rào phòng.
3. **Đếm ngược phải tính từ MỘT MỐC, không trừ dần mỗi nhịp.** Trình duyệt hãm
   `setInterval` của tab nền xuống ~1 lần/phút; trừ dần thì đi họp về mật khẩu vẫn nằm trên
   màn hình.
4. **Input `type="password"` không phải `role=textbox` với `getByLabel`.** Dùng
   `getByRole('textbox', { name })` — snapshot của Playwright vẫn gọi nó là textbox.
5. **Tài khoản do test tạo ra cũng là rác cần dọn.** 27 tài khoản `e2e-tao-moi-…` tích lại
   đẩy tài khoản vừa tạo sang trang 2 và làm `accounts.spec` đỏ — không phải vì sản phẩm sai.

---

## Epic 5 — Quản lý IP & NAT (đóng 2026-08-23)

### Bảng mới và ai sở hữu (AD-3)

| Bảng | Module chủ | Ghi chú cho epic sau |
| --- | --- | --- |
| `subnet` | `ipam` | Kiểu `cidr` THẬT của Postgres. Dải đã có IP thì không sửa được dải — ẩn cái cũ, khai cái mới |
| `ip_address` | `ipam` | Kiểu `inet`. Unique CÓ ĐIỀU KIỆN `(subnet_id, address) WHERE voided_at IS NULL`; trigger `ip_address_within_subnet` chặn IP ngoài dải ở tầng DB |
| `ip_history` | `ipam` | APPEND-ONLY (AD-13). Giữ VĨNH VIỄN — đây là chỗ trả lời "IP này từng là máy in kế toán" |
| `nat_rule` | `ipam` | `EXCLUDE USING gist` chặn chồng port ngoài, kể cả chồng MỘT PHẦN. `ip_address_id` là liên kết MỀM (ON DELETE SET NULL) |

### Hợp đồng epic sau sẽ dùng

| Thứ | Ở đâu | Epic dùng |
| --- | --- | --- |
| `IpamApiService` | `modules/ipam/ipam.api.ts` | **Epic 8** phiếu bàn giao cần IP của máy; **Epic 9** phiếu sự cố trỏ tới IP |
| `ip-lifecycle.ts` (máy trạng thái thuần) | `modules/ipam/` | Mẫu cho MỌI vòng đời sau: khai bảng chuyển, `canTransition`, lỗi CHỈ ĐƯỜNG. **Epic 6** dùng lại cho vòng đời yêu cầu phê duyệt |
| `ip-rules.ts` (số học IPv4) | `modules/ipam/` | Bất cứ chỗ nào đụng địa chỉ mạng. **Cấm** tự parse IP bằng `split('.')` ở nơi khác |
| `UsageBar` | `web/src/ui/usage-bar.tsx` | **Epic 7** ô "dải nào sắp đầy" trên bảng điều khiển; seat license |
| `IpDevicePanel`, `NatDevicePanel` | `modules/ipam/` | Mẫu cắm khu vào trang thiết bị — lần thứ ba dùng cơ chế của story 2.5, `devices` vẫn chưa phải sửa một dòng nào |

### Nợ kỹ thuật cố ý mang sang

| Việc | Vì sao hoãn | Hạn chót |
| --- | --- | --- |
| Chỉ IPv4 | PMH chạy 172.16.x/24, chưa có IPv6. Nhận nửa vời tệ hơn từ chối thẳng | Khi thật sự có IPv6. Bảng đã dùng `inet`/`cidr` nên chỉ phải sửa `ip-rules.ts` + bỏ 2 ràng buộc `family(...) = 4` |
| Vòng đời IP đặt tay, chưa quét mạng tự động | AC 5.2 ghi rõ "v1 đặt tay" | Khi có nhu cầu phát hiện IP chết tự động |
| Chưa import hàng loạt hồ sơ IP | Bộ khung `import-plan` đã sẵn, nhưng Đợt 1 nhập tay là đủ | Khi số IP vượt ~200 |
| `nat_rule` chưa có lịch sử riêng | Audit đã ghi đủ ai-đổi-gì; rule NAT ít đổi hơn IP nhiều | Khi có yêu cầu tra "rule này từng trỏ đi đâu" |

### Code review đóng epic — 8 finding, đã sửa hết

| # | Mức | Vấn đề | Cách sửa |
| --- | --- | --- | --- |
| 1 | **Cao** | "Mở dải hơn 1000 cổng" được viết là CẢNH BÁO trong comment, trong thông điệp (*"nếu đúng ý thì cứ lưu"*) và trong tên test — nhưng code lại NÉM. Người dùng đọc được lời khuyên mà không làm theo được; dải port camera (50000-52000, đúng ví dụ trong chính comment) không bao giờ vào nổi sổ. **Test cũ chỉ đếm `errors.length === 1` nên nó XANH trong khi hành vi sai** | Tách kiểu: `{ errors, warnings }`. Chỉ `errors` chặn; `warnings` trả về cho UI hiện toast. Kiểu dữ liệu tách bạch làm chuyện này không lặp lại được |
| 2 | Trung bình | `validateNatRule` không kiểm khoảng port NGOÀI (biên 1–65535, from ≤ to) — chỉ bộ phân tích chuỗi của controller kiểm. `NatRuleService.create` là hàm công khai: import Excel về sau, seed, module khác gọi lại đều không qua DTO HTTP → rơi xuống ràng buộc DB và bung **500** | Kiểm trong hàm thuần, và map `23514` sang 400 tiếng Việt |
| 3 | Trung bình | Lọc theo site không tra ra được (site đã xóa, bookmark cũ) trả `null` rồi lọc `siteCode === null` → trả về rule của router KHÔNG gắn site: một tập khác hẳn, KHÔNG rỗng, mà auditor đọc thành "đây là rule của site X". Export dùng chung đường này | Site không tra được → trả RỖNG |
| 4 | Trung bình | `EXCLUDE` của DB so `protocol WITH =` nên `both` và `tcp` cùng port không đụng nhau — trong khi `both` theo định nghĩa phủ cả hai. Sổ có HAI câu trả lời cho TCP/8080. Comment còn ghi "service cảnh báo chỗ đó" mà service **không hề có** đoạn nào như vậy | Thêm `protocolsOverlap`/`rangesOverlap` thuần + kiểm ở service trước khi ghi |
| 5 | Thấp/TB | `internalIp` là trường text duy nhất không chuẩn hóa: `linkIp` so chuỗi thô với `host(address)` nên một dấu cách thừa là mất liên kết sang hồ sơ IP dù hồ sơ có thật. Ở tầng DTO thì `"172.16.10.5 "` dài 16 ký tự và bị `@Length(1,15)` từ chối bằng một câu vô nghĩa | `@Transform(trimText)` ở DTO (chạy trước `@Length`) + trim lại trong service cho các đường không qua HTTP |
| 6 | Thấp/TB | Tìm kiếm chỉ so `external_from::text` → rule `8000-8010` không tìm thấy khi gõ `8005`, người tra kết luận port đang trống. Người tạo rule còn được 409 cứu; auditor chỉ đọc thì nhận thẳng câu trả lời sai | Gõ một SỐ thì tìm theo khoảng chứa (`from <= p AND to >= p`) và cả `internal_port` |
| 7 | Thấp | `listNat`/`exportNat` nhận `@Query()` trần → `?deviceId=abc` xuống Postgres thành `22P02` và bung 500 | Thêm `NatQueryDto` |
| 8 | Thấp | `update` có `requireAlive` nhưng câu `UPDATE` thiếu `voided_at IS NULL`: A gỡ rule, B bấm Lưu → bản sửa của B ghi đè hàng đã gỡ, đẻ dòng audit cho rule không còn trong sổ, và biến mất vĩnh viễn | Đưa điều kiện vào chính câu UPDATE + kiểm `rows.length` → 409 để người thua thấy lỗi ngay |

### Bẫy đã gặp — đừng lặp lại

1. **Đếm "đang dùng" theo SỐ HÀNG là sai.** IP đã thu hồi vẫn còn hàng (lịch sử giữ vĩnh
   viễn) nhưng đã trả chỗ về pool. Đếm cả nó thì mức sử dụng chỉ tăng không bao giờ giảm, và
   sau một năm màn hình báo dải đầy trong khi còn quá nửa. Đếm theo TRẠNG THÁI CHIẾM CHỖ.
2. **UNIQUE hai cột không bắt được chồng MỘT PHẦN.** `8000-8010` và `8005-8020` là hai cặp
   số khác nhau nên UNIQUE cho qua — trong khi port 8005 có hai chủ. Cần `EXCLUDE USING gist`
   với `int4range &&`.
3. **Dịch bit trong JS làm việc trên số CÓ DẤU.** `(a << 24) | …` với `255.x.x.x` ra số ÂM.
   Phải `>>> 0`. Không có test bảng dữ liệu thì lỗi này chỉ lộ ra ở đúng một dải địa chỉ.
4. **`172.16.010.5` không phải `172.16.10.5`.** Nhiều thư viện đọc số có 0 đứng đầu theo hệ
   bát phân → thành `172.16.8.5`. Cấp một IP mà tưởng là cấp IP khác. Từ chối ở cửa vào.
5. **Địa chỉ mạng và địa chỉ quảng bá NẰM TRONG dải nhưng không cấp được.** Trigger "nằm
   trong dải" cho cả hai qua; service phải chặn thêm, nếu không máy nhận IP đó không ra mạng.
6. **Quy chuẩn dải ngay lúc nhận.** Người ta gõ `172.16.10.37/24`. Không quy về địa chỉ mạng
   thì hai người khai cùng một dải ra hai bản ghi, và ràng buộc "không trùng dải" vô dụng
   ngay từ đầu.
7. **Kiểm luật trên giá trị ĐÃ TRỘN với bản ghi cũ.** Sửa mỗi `externalTo` mà kiểm riêng nó
   thì "8010 hợp lệ" — trong khi hàng sau khi sửa là `8020-8010`, ngược đầu. (Đúng bài học của
   import thiết bị ở Epic 2, lặp lại ở một hình dạng khác.)
8. **Test có thể XANH trong khi hành vi sai — nếu nó chỉ đếm.** `expect(errors.length).toBe(1)`
   không phân biệt "cảnh báo" với "chặn". Khi ý định là *"cho qua nhưng nói ra"*, kiểu dữ liệu
   phải nói được điều đó (`{ errors, warnings }`) — không thì comment, thông điệp và code trôi
   khỏi nhau mà không có gì đỏ.
9. **Comment mô tả hành vi KHÔNG TỒN TẠI là nợ nguy hiểm hơn không comment.** Hai chỗ trong
   epic này: "service cảnh báo chỗ đó" (không có đoạn nào), và "kiểm trên giá trị đã trộn nên
   bắt được 8020-8010" (hàm kiểm không hề đụng tới khoảng port ngoài). Người đọc sau tin
   comment và không kiểm lại.
10. **Hàm public của service là một cửa vào thật, không chỉ là chỗ controller gọi.** Đẩy hết
    việc kiểm lên DTO thì mọi đường khác (import, seed, module khác) đi thẳng xuống DB và bung
    500. Luật nghiệp vụ thuộc về hàm thuần, DTO chỉ là lớp chuyển kiểu.

## Epic 6 — Break-glass & Phê duyệt (đóng 2026-08-23)

### Bảng mới và ai sở hữu (AD-3)

| Bảng | Module chủ | Ghi chú cho epic sau |
| --- | --- | --- |
| `approval`, `approval_history` | `approvals` (tầng nền) | **KHÔNG có CHECK về từ vựng state** — mỗi loại tự mang máy trạng thái tới (AD-6). Đổi lại, `transition()` là đường DUY NHẤT ghi cột `state` |
| `access_list` | `vault` | Chỉ chứa `whitelist` và `needs_approval`. CẤM là mặc định (không có dòng), không phải một lời gán |

### Hợp đồng epic sau sẽ dùng

| Thứ | Ở đâu | Epic dùng |
| --- | --- | --- |
| `ApprovalKindRegistry` (@Global) + `ApprovalFlowSpec` | `common/approvals/` | **Epic 8** phiếu ISO, **Epic 9** phiếu sự cố: khai từ vựng state của mình rồi `register()`, không sửa gì trong `approvals` |
| `ApprovalsApiService` | `modules/approvals/approvals.api.ts` | Tạo yêu cầu (trong tx của mình), chuyển trạng thái, hỏi "grant còn hiệu lực không" |
| `isGrantActive` | `common/approvals/approval-flow.ts` | MỌI đường đọc có kiểm quyền tạm thời. **Cấm** tin `status` |
| `overdueSince` | `common/approvals/approval-flow.ts` | Mẫu "treo quá lâu thì nhắc" — dùng lại cho phiếu quá hạn ở Epic 8 |
| `AccessListService.tierFor` | `modules/vault/` | Bất cứ chỗ nào cần "người này có tầng gì trên đối tượng kia" |
| `BREAK_GLASS_FLOW` | `modules/vault/break-glass.service.ts` | Mẫu khai một loại yêu cầu: `initial` + bảng `transitions` + nhãn tiếng Việt cho từng bước |

### Nợ kỹ thuật cố ý mang sang

| Việc | Vì sao hoãn | Hạn chót |
| --- | --- | --- |
| Chưa có màn Admin sửa `system_config` (từ Epic 3) | `breakglass.max_grant_hours` và `approval.reminder_hours` sửa bằng SQL được | Khi anh Thuận muốn tự đổi trần mà không cần tôi |
| Nhắc yêu cầu treo chỉ nhắc MỘT lần | Nhắc lặp là cách nhanh nhất để người duyệt lọc thư hệ thống vào thùng rác | Nếu thực tế có yêu cầu bị bỏ quên qua đêm |
| Chưa gửi thông báo cho người XIN khi được duyệt | Họ đang ngồi chờ và sẽ tự mở màn "Yêu cầu của tôi" | Khi có phản hồi là bất tiện |
| Ma trận quyền chưa lọc theo site trên UI | Ba site, vài chục người — cuộn là thấy hết | Khi số tài khoản vượt ~30 |

### Code review đóng epic — 7 finding, đã sửa hết

| # | Mức | Vấn đề | Cách sửa |
| --- | --- | --- | --- |
| 1 | **Cao** | `cancel()` không kiểm người gọi có phải người xin. Bất kỳ ai biết id (nhìn qua vai, ảnh chụp màn hình, URL bị chia sẻ) đều **giết được yêu cầu của người khác** — người xin ngồi chờ tiếp lúc 2 giờ sáng, còn `approval_history` ghi sai tên người hủy | Chỉ người gửi mới hủy được (403). SA muốn chặn thì dùng "Từ chối", để lịch sử ghi đúng việc |
| 2 | Trung bình | Member mở màn duyệt: `tab` khởi tạo `'pending'` nhưng `Tabs` ép `value='mine'` → nút sáng ở một tab, dữ liệu render của tab khác (đang disable, nên rỗng). Họ vừa gửi yêu cầu xong mà màn hình nói "không có yêu cầu nào" | `useState(canDecide ? 'pending' : 'mine')`, bỏ chỗ ép `value` |
| 3 | Trung bình | `canVault = true` (story 6.3) mở tab cho Member, nhưng `canEdit` vẫn là `!retired` → Member thấy đủ nút **Cất secret / Sửa / Xoay / Thu hồi**, bấm cái nào cũng 403 | `canEdit={canVaultWrite && !retired}` |
| 4 | Trung bình | `approve/deny/revoke/cancel` không kiểm `kind`. Hôm nay chỉ có một loại nên vô hại — nhưng Epic 8/9 cắm phiếu ISO và phiếu sự cố vào cùng bảng `approval`, và khi đó endpoint két sắt thành **cửa hậu lái yêu cầu của module khác**, bỏ qua luật riêng của họ, để lại dòng audit `iso_form.approved` phát ra từ `/vault/break-glass/...` | `requireBreakGlass(id)` — sai loại thì 404 |
| 5 | Thấp/TB | `clampHours` mất sàn 1 giờ ở nhánh short-circuit: đặt `breakglass.max_grant_hours = 0` thì mọi grant hết hạn **đúng lúc sinh ra** — duyệt xong vẫn không xem được, trông y như hệ thống hỏng và không có dòng lỗi nào | Sàn 1 giờ cho CẢ trần cấu hình lẫn số giờ xin. Muốn tắt break-glass thì gỡ quyền ở ma trận, không hạ trần về 0 |
| 6 | Thấp/TB | Luật "một yêu cầu treo cho mỗi chủ thể" chỉ có một câu `SELECT` chạy NGOÀI transaction canh giữ → hai cú bấm cùng lúc lọt cả hai; người duyệt quyết hai lần cho một việc, cái thứ hai treo mãi | Partial unique index `approval_one_pending_key` (migration 0025) + bắt `23505` thành 409. **Bộ E2E đầy đủ lộ thêm một chuyện nữa**: câu kiểm sớm ném 400 còn DB ném 409 — cùng một sai lầm mà hai mã tùy nhịp. Đã gộp về 409 |
| 7 | Thấp/TB | `tierFor` nằm trên ĐƯỜNG NÓNG (mỗi lần mở két, mỗi lần đọc metadata, mỗi lần dựng verdict) nhưng đi qua `list()` → `scopeLabels()` → `catalog.lists()`: kéo cả danh mục site + loại thiết bị + loại phần mềm về **chỉ để vứt nhãn đi** | Thêm `rulesOf()` truy vấn thẳng `access_list`, không dựng nhãn |

### Bẫy đã gặp — đừng lặp lại

1. **Một lỗi 404 giả dạng lời từ chối quyền.** Web gọi sai đường dẫn verdict → query lỗi →
   `data` undefined → panel hiện "Chỉ Quản trị xem được". Thông điệp đó nghe hợp lý tới mức che
   hẳn một lỗi 404. Từ đó: **sai vì THIẾU QUYỀN và sai vì HỎNG phải là hai nhánh render khác
   nhau** — đừng để `undefined` rơi xuống nhánh "không có quyền".
2. **Câu chữ cũng hết hạn.** "Chỉ Quản trị và Super Admin xem được két sắt" đúng ở Epic 4 và
   thành nói dối ở Epic 6. Mở rộng quyền cho một vai thì phải đi soát lại mọi câu nói về vai đó.
3. **`str.replace` không khớp thì im lặng.** Một patch tự động vào `vault-panel.tsx` không khớp
   anchor và không đổi gì cả — build vẫn xanh, chỉ E2E mới lộ. Patch tự động phải `assert` là
   anchor có tồn tại.
4. **Hàm helper trong test tự gọi chính nó.** Thay thế hàng loạt chuỗi "bấm Đăng xuất" cũng
   thay luôn thân hàm `logout()` vừa viết → đệ quy vô hạn, cả 6 test đỏ. Thay hàng loạt thì phải
   trừ chỗ định nghĩa ra.
5. **Bảng dài che mất nút ở sidebar.** Playwright báo "intercepts pointer events". Đăng xuất từ
   một trang trung tính (`/`) là hết — và cũng đúng thói quen người dùng hơn.
6. **Đừng cho gán "cấm".** Nó lập tức sinh ra câu hỏi "dòng cấm có thắng dòng cho phép không",
   và câu trả lời nào cũng làm ma trận khó đọc hơn. Cấm = không có dòng nào.
7. **Mở quyền cho một vai là phải soát lại MỌI thứ gắn với vai đó.** Story 6.3 đổi
   `canVault` thành `true` cho mọi vai — và lập tức Member nhìn thấy bốn cái nút GHI mà API
   chặn. Nới một cổng thì phải đi hết các cổng còn lại trong cùng màn.
8. **Một bảng dùng chung cần kiểm `kind` ở MỌI cửa.** `approval` phục vụ nhiều loại (AD-6).
   Endpoint của loại A nhận id của loại B mà không kiểm là một cửa hậu — vô hại hôm nay, thành
   lỗ hổng đúng ngày Epic 8 cắm phiếu ISO vào.
9. **Test dài sát trần thời gian là test sẽ đỏ ngẫu nhiên.** Đường hạnh phúc break-glass đi
   qua bốn luồng đăng nhập đầy đủ, mất ~50 giây trên trần 60. Nới trần (và nói rõ vì sao trong
   comment) thay vì cắt bớt bước — chính chuỗi đổi người đó là thứ story phải chứng minh.
10. **Hai hàng rào cho cùng một luật thì phải trả CÙNG một lỗi.** Câu kiểm sớm (cho thông
    điệp tử tế) và ràng buộc DB (cho đúng đắn) đều chặn "xin trùng" — nhưng một cái ném 400,
    một cái ném 409. Client không xử lý tử tế được một API đổi mã theo nhịp gõ phím, và test
    thì đỏ ngẫu nhiên. Chạy riêng một bài thì luôn trúng một nhánh; chỉ bộ đầy đủ mới lộ ra.

## Epic 7 — Dashboard sếp (đóng 2026-08-23)

### Bảng mới và ai sở hữu (AD-3)

| Bảng | Module chủ | Ghi chú cho epic sau |
| --- | --- | --- |
| _(không có)_ | `dashboard` | Module ĐỌC thuần — không sở hữu bảng nào. Đây là chỗ dễ phá AD-2 nhất hệ thống: một cái JOIN ở đây thì dashboard thành nơi mọi bảng của mọi module gặp nhau, và từ đó không module nào đổi được lược đồ của mình nữa |

### Hợp đồng epic sau sẽ dùng

| Thứ | Ở đâu | Epic dùng |
| --- | --- | --- |
| `DashboardBlock<T>` với cờ `available` | `modules/dashboard/dashboard.service.ts` | **Epic 9** bật khối sự cố: đổi `available: false` thành gọi `incidents.api`. Không phải sửa web |
| Mẫu export: `ExcelExportService.build` + `sendXlsx` + `@Audited('*.exported')` | `common/excel/` | Mọi bảng mới. Ba thứ đi cùng nhau — thiếu `@Audited` là mất vết "ai kéo cả kho ra file" |
| `ExportXlsxButton` | `web/src/ui/export-xlsx-button.tsx` | Mọi màn danh sách. Truyền nguyên query của bộ lọc đang xem |

### Nợ kỹ thuật cố ý mang sang

| Việc | Vì sao hoãn | Hạn chót |
| --- | --- | --- |
| Khối "sự cố tuần qua" mới là chỗ trống có khai báo | Epic 9 chưa mở; khối vẫn HIỆN và nói rõ "hệ thống CHƯA theo dõi mục này" | Epic 9 |
| Export không ghi bộ lọc vào audit | `AuditInterceptor` cố ý chỉ ghi method + path, không ghi query string (nơi dễ lọt thứ không nên ghi) | Khi cần biết chính xác ai xuất bộ lọc nào |
| Trần 5000 dòng mỗi lần xuất, im lặng | Quy mô PMH còn xa mới chạm | Khi một bảng vượt ~4000 dòng thì phải báo cho người xuất biết là đã cắt |
| Dashboard chưa cache | Ba khối, mỗi khối một truy vấn nhẹ | Khi có người phàn nàn trang chủ chậm |

### Code review đóng epic — 11 finding, đã sửa hết

Không finding nào tsc hay eslint thấy được. Bốn cái đầu cùng một họ: **file xuất nói khác
màn hình** — mà file xuất mới là thứ đem đi trình auditor.

| # | Mức | Vấn đề | Cách sửa |
| --- | --- | --- | --- |
| 1 | **Cao** | `STATUS_LABEL` tự chế trong controller có khóa KHÔNG TỒN TẠI (`expired_no_renew`, `dropped`) trong khi trạng thái thật là `expired_ok`/`retired`. Kiểu `Record<string, string>` nên TS im, `?? r.status` nuốt nốt → mọi hồ sơ hết hạn/đã bỏ in ra MÃ MÁY. `software-rules.ts` đã có sẵn bản đúng, doc ghi rõ "dùng cho file export" | Import bản canon. Kiểu `Record<SoftwareStatus, string>` biến sai sót này thành lỗi biên dịch |
| 2 | Trung bình | `KIND_LABEL` chép lại bản canon và ĐÃ TRÔI: `'License'` ở đây vs `'License phần mềm'` ở kia — email digest và file xlsx gọi cùng một thứ bằng hai tên (AD-15) | Import bản canon, xoá bản chép |
| 3 | Trung bình | File sắp-hết-hạn in `warranty` trong khi màn hình hiện "Bảo hành thiết bị" — auditor cầm hai tờ giấy nói hai thứ khác nhau về cùng một dòng | Tra nhãn từ `expiry.kinds()` (đã inject sẵn) |
| 4 | Trung bình | Nhét `Date` thô vào ô Excel: ExcelJS quy về serial theo giờ **UTC**, còn màn hình format theo `Asia/Ho_Chi_Minh`. Yêu cầu lúc 2 giờ sáng hiện thành 19 giờ HÔM TRƯỚC trong file | Ghi thành chuỗi theo múi giờ ứng dụng (AD-11) |
| 5 | Trung bình | Cột trạng thái nhật ký break-glass đọc thẳng `state`, bỏ qua `active` — grant đã quá hạn mà sweep chưa dọn thì file ghi "Đã duyệt". Chính là điều AD-6 cấm, và màn duyệt đã xử đúng rồi | Đọc theo đồng hồ như mọi chỗ khác |
| 6 | Thấp/TB | `@Audited('ip.exported', 'ip_address')` trên route theo DẢI: interceptor ghi `objectId = params.id` (id của subnet) nhưng `objectType` nói `ip_address` → dòng audit trỏ tới một uuid không tồn tại ở bảng đó | Đổi thành `'subnet'` |
| 7 | Thấp/TB | Export phần mềm cắt im lặng ở 5000 dòng, trong khi `SoftwareService.listAll` đã có sẵn và doc ghi "chỉ dùng cho export xlsx (FR-028)" — tôi không đọc trước khi viết | Dùng `listAll` |
| 8 | Thấp/TB | ISP y hệt, kèm số 5000 viết cứng lần hai | Dùng `listAll` |
| 9 | Thấp/TB | Nút Xuất ở màn duyệt hiện trên MỌI tab nhưng luôn tải toàn bộ lịch sử — người đang xem "Chờ duyệt" bấm Xuất và im lặng nhận cả kho, trái luật "xuất đúng bộ lọc đang xem" | Chỉ hiện ở tab Nhật ký |
| 10 | Thấp | Bài kiểm audit đọc số ngay sau `await request.get()`. Handler `@Res()` gọi `res.end()` trong thân hàm, còn interceptor ghi SAU khi emit — response bay đi trước khi INSERT commit. Xanh hôm nay chỉ vì khởi động `psql` chậm hơn cái INSERT | `expect.poll` |
| 11 | Thấp | So kích thước file zip để suy ra số dòng. Deflate không đơn điệu theo đầu vào — 1 dòng và 2 dòng có thể nén ra bằng nhau hoặc ngược nhau | Mở sheet bằng exceljs, khẳng định dòng nào CÓ và dòng nào KHÔNG |

### Bẫy đã gặp — đừng lặp lại

1. **Một global interceptor khai ở hai module thì Nest áp CẢ HAI.** `AuditInterceptor` được
   khai `APP_INTERCEPTOR` ở cả `app.module.ts` lẫn `audit.module.ts` → mọi route dựa vào
   interceptor ghi audit đều đẻ ra hai dòng. Ẩn suốt **sáu epic** vì gần như mọi endpoint ghi
   đều dùng `writtenByService: true` (service tự ghi, interceptor bỏ qua), nên không có route
   nào thật sự đi qua đường đó. Story 7.2 là chỗ đầu tiên có, và bài kiểm "ghi MỘT dòng" đếm
   ra 2. Bài học rộng hơn: **một nhánh code không ai đi qua là một nhánh không ai kiểm** — dù
   nó nằm ở tầng hạ tầng và trông như đã chạy suốt.
2. **Đổi chữ trên trang đích là đổi mốc chờ của cả bộ E2E.** Dashboard thay trang đáp cũ, mà
   `firstLogin` chờ đúng chữ "Xin chào". Đổi tiêu đề thành "Chào" là 130 bài đỏ theo. Giữ
   nguyên lời chào — vừa tự nhiên hơn vừa không phá gì.
3. **"Chưa có phần này" ≠ "không có gì".** Khối sự cố phải nói rõ là hệ thống CHƯA theo dõi.
   Một ô trống gọn gàng là cách nhanh nhất để sếp yên tâm nhầm. Có test khẳng định câu
   "tuần qua không có sự cố nào" KHÔNG xuất hiện khi module chưa mở.
4. **Rút gọn theo vai phải làm ở SERVER.** Ẩn khối ở web thì dữ liệu vẫn đi qua dây và Member
   mở tab mạng ra là đọc được nhật ký break-glass toàn công ty. Test kiểm thẳng payload API,
   không chỉ kiểm giao diện.
5. **Route tĩnh phải khai TRƯỚC route `:id`.** `export.xlsx` để sau `@Get(':id')` thì bị `:id`
   nuốt và trả 400 vì không phải uuid. Nest khớp theo thứ tự khai báo.
6. **Bản chép của một hằng số sẽ trôi, và trôi im lặng.** Hai map nhãn tự chế trong controller
   khi bản canon đã có sẵn ở `software-rules.ts` — một cái sai hẳn khóa, một cái đổi chữ. Cả
   hai lọt qua tsc vì kiểu là `Record<string, string>`. Ràng buộc kiểu theo union
   (`Record<SoftwareStatus, string>`) biến đúng loại sai sót này thành lỗi biên dịch.
7. **File xuất là một MÀN HÌNH THỨ HAI, và nó phải nói y hệt màn thứ nhất.** Bốn finding của
   epic này cùng một họ: mã máy thay vì nhãn, giờ UTC thay vì giờ VN, trạng thái đọc từ cột
   thay vì tính theo đồng hồ. Trên màn hình thì đúng cả — nhưng thứ đem đi trình auditor là
   cái file.
8. **`await request.get()` KHÔNG có nghĩa là mọi hệ quả đã ghi xong.** Interceptor ghi audit
   sau khi response đã bay đi. Đọc DB ngay sau đó là đọc trước khi commit; test xanh vì may.
9. **Đừng suy ra nội dung từ kích thước file nén.** Mở file ra mà đọc — exceljs đã là
   dependency sẵn có.

---

## Đợt UI/UX 3 — góp gì (26/08/2026)

Không phải một epic: một đợt sửa theo phản hồi trực tiếp của chủ dự án. Ghi lại vì mấy phát
hiện dưới đây là loại bẫy sẽ lặp lại.

### Tài sản mới, dùng chung

| Thứ | Ở đâu | Ai sẽ cần |
| --- | --- | --- |
| `PATHS`, `LEGACY_ROUTES` | `web/src/lib/routes.ts` | Mọi màn mới. Cấm gõ chuỗi đường dẫn thẳng vào `<Link to>` |
| `useAttachmentDraft`, `AttachmentDraftSection` | `web/src/ui/attachment-draft.tsx` | Mọi form THÊM MỚI cần đính kèm giấy tờ (phiếu Epic 8, sự cố Epic 9) |
| `PortChipsField`, `port-chips.ts` | `web/src/features/ipam/` | Ô nhập nhiều giá trị rời dạng chip |
| `slot-paging.ts` | `web/src/features/ipam/` | Bảng cắt trang ở client khi tập dữ liệu có TRẦN chắc chắn |

### Hợp đồng cho đợt sau

- **Đường dẫn là tiếng Anh, giao diện là tiếng Việt.** Màn mới lấy đường từ `PATHS`; đổi đường
  cũ thì thêm dòng vào `LEGACY_ROUTES` chứ không xoá.
- **`FILE_OWNER_TYPES` phía API và `AttachmentOwnerType` phía web phải sửa CÙNG nhau.** Thiếu
  một bên là 400 lúc upload, không phải lỗi biên dịch.
- **`/vault` là cửa vào, KHÔNG phải danh sách secret.** FR-026 cấm mọi đường lấy secret qua
  nhiều chủ thể, và `vault-surface.spec.ts` canh hình dạng route. Ai định thêm "trang tổng hợp
  két sắt" thì đọc chỗ này trước.

### Bẫy đã gặp

1. **`npx tsc --noEmit` ở `web/` không kiểm gì cả.** `tsconfig.json` là file references với
   `"files": []`. Lỗi kiểu chỉ lộ ra ở `tsc -b` trong `npm run build` — tôi phát hiện khi
   `docker compose build` đỏ sau ba lần "typecheck xanh". **Cổng thật là `npm run build`.**
2. **`tsconfig.app.json` không bật `strict`**, nên TS không thu hẹp được union phân biệt bằng
   cờ boolean. `if (!r.ok) r.reason` là lỗi biên dịch dù logic đúng. Hàm thuần bên web trả
   MỘT hình dạng `{ value, reason }`.
3. **Thuộc tính có mặt trong TSX không có nghĩa là CSS đọc nó.** `data-columns` được viết ở
   15+ chỗ suốt bảy epic mà **không có một luật CSS nào** — mọi form rơi về `auto-fill`, số cột
   do bề rộng hộp quyết định. Không exception, không test nào đỏ. Cùng họ với những `.shell`,
   `.row`, `.span-3` của đợt soát trước: **lớp/thuộc tính viết ra rồi quên khai luật là lỗi
   câm.** Cách bắt: grep tên lớp/thuộc tính trong `css/` trước khi tin nó có tác dụng.
4. **Khai trùng tên lớp CSS đè lên bản có sẵn mà không ai báo.** Tôi thêm `.chip` vào
   `shared-kit.css` trong khi `form-layout.css` đã có — và `shared-kit.css` nạp SAU. Trước
   khi đặt tên lớp mới: `grep -rn "\.tên-lớp" web/src/css/`.
5. **Bài kiểm đếm TỔNG số nút trong một dòng sẽ đỏ vì lý do chẳng liên quan.** Thêm cột Thao
   tác làm đỏ bài "license chưa gán thì không có mũi tên bung dòng". Bám đúng nút cần kiểm
   (`getByRole('button', { name: 'Mở rộng dòng' })`), đừng đếm tổng.
6. **`required` của trình duyệt chặn submit TRƯỚC lỗi của form.** Bài kiểm "thiếu port thì báo
   lỗi" đỏ vì các ô bắt buộc khác còn trống — thông điệp của form không bao giờ tới.

---

## Đợt UI/UX 4 — góp gì (26/08/2026, tiếp theo đợt 3)

### Tài sản mới

| Thứ | Ở đâu | Ai sẽ cần |
| --- | --- | --- |
| Module `service-accounts` | `api/src/modules/service-accounts/`, `web/src/features/service-accounts/` | Chỗ đứng cho mọi tài khoản KHÔNG phải máy và KHÔNG phải license |
| `GET /vault/owners` + `VaultOwnersService` | `api/src/modules/vault/` | Trang tổng két sắt. Ranh giới: chỉ CHỦ THỂ, không nội dung két |
| `PATCH /accounts/:id/profile` | `api/src/modules/auth/` | Sửa hồ sơ tài khoản (tên · SĐT · mã NV · ngày sinh) |
| `GET /ipam/devices/:id/addresses` | `api/src/modules/ipam/` | Ô chọn IP theo thiết bị (form NAT dùng) |

### Hợp đồng cho đợt sau

- **Thêm một `ownerType` mới cho két sắt phải sờ BA chỗ**: `SECRET_OWNER_TYPES`
  (`vault.service.ts`), `SecretOwnerType` (`vault-panel.tsx`), và **CHECK constraint** trong
  DB. Giấy tờ đính kèm thì hai chỗ (`FILE_OWNER_TYPES` + `AttachmentOwnerType`) — bảng `file`
  không có CHECK.
- **`tierFor` phải có nhánh cho mọi `ownerType`.** Nó đang là ternary device/else; loại mới rơi
  vào `else` là đi tra id trong bảng `software`.
- **Module nghiệp vụ mới phải khai vào `BIZ` trong `.dependency-cruiser.cjs`**, không thì luật
  AD-2 không áp cho nó và không ai biết.
- **Trang tổng két sắt là ngoại lệ DUY NHẤT được liệt kê qua nhiều chủ thể**, và chỉ tới mức
  "có mấy ngăn". `vault-surface.spec.ts` khoá danh sách trường của `VaultOwnerSummary` lại —
  thêm trường mới phải sửa test, tức là phải có người nhìn xem nó có lộ gì không.
- **Đổi trạng thái một hồ sơ = endpoint RIÊNG bắt ghi lý do, không phải một ô trong DTO sửa.**
  `service_account` làm mẫu: `PATCH :id/disable` + `PATCH :id/enable`, và `status` bị bỏ hẳn
  khỏi `ServiceAccountBodyDto`. `ValidationPipe` bật `forbidNonWhitelisted` nên gửi `status`
  vào đường sửa là 400 — cửa sau đóng ở tầng API, không chỉ ẩn nút ở giao diện. Hai chiều phải
  đối xứng: có đường đóng mà không có đường mở thì ô Trạng thái chỉ-đọc thành cái bẫy.
- **Kiểm luật của một lần `PATCH` phải chạy trên bản ĐÃ GHÉP với dòng trong DB**, không trên
  body. Ô không gửi = giữ nguyên, nên kiểm trên body là bỏ sót đúng những ô người ta không
  đụng tới — và `warnings: []` đọc thành "kiểm rồi, sạch". Xem `mergeServiceAccount`
  (`service-account-rules.ts`), tách riêng để test bảng dữ liệu.

### Bẫy đã gặp

1. **Whitelist ở ba tầng, tầng DB là tầng bị quên.** Thêm `service_account` vào két: TS xanh,
   `npm run build` xanh, 557 unit test xanh — rồi 500 lúc chạy thật vì
   `secret_owner_type_check`. Bài học: whitelist nào có bản sao trong migration thì grep
   `CHECK (.*IN (` trước khi tin là đã sửa đủ.
2. **Trang tổng vừa dựng đã tìm ra rác cũ.** `/vault` hiện 10 dòng "hồ sơ đã bị xoá — còn
   secret treo lại": `resetDevices`/`resetSoftware` của E2E xoá chủ thể mà không xoá secret.
   Một màn tổng hợp tốt là một màn tự tố cáo được dữ liệu hỏng.
3. **Bài kiểm canh code đừng soi cả chú thích.** Test "service không được nhắc tới `label`"
   đỏ vì chính câu chú thích *"không `label`, không `kind`"*. Bóc comment trước khi soi.
4. **Jest không nhận tham số thứ hai của `expect`** (Vitest thì có). Muốn thông điệp lỗi nói
   rõ mục nào sai thì đưa mục đó vào chính giá trị so sánh.
5. **Bảng dịch vụ luôn mở × hai ô port = quá nửa hộp thoại.** Thứ làm form NAT dài không phải
   ô nhập mà là hai bảng gợi ý giống hệt nhau. Dropdown giữ nguyên phần đúng (tên · giao thức
   · port trên một dòng) mà không chiếm chỗ.

---

## Đợt UI/UX 5 — góp gì (28/08/2026: nhóm B + số trên nhãn tab)

Bảng điều khiển từ **hai** khối lên **năm**, và trang chi tiết trả lời được "trong tab đó có gì"
mà không phải bấm vào. Không bảng mới, không cột mới — toàn bộ dựng trên dữ liệu đã có từ lâu
nhưng chưa ai nhìn thấy cùng lúc.

### Tài sản mới

| Thứ | Ở đâu | Ai sẽ cần |
| --- | --- | --- |
| `dashboard-rules.ts` | `api/src/modules/dashboard/` | Luật chọn dòng của mọi khối — hàm thuần, `now` là tham số, không hàm nào nhận `limit` |
| `IpamApiService.listSubnets()` | `api/src/modules/ipam/ipam.api.ts` | Ai cần mức sử dụng dải mà không được chạm bảng `subnet` |
| `VaultApiService.listOwners()` | `api/src/modules/vault/vault.api.ts` | Ai cần "hồ sơ nào có két, đổi lần cuối bao giờ". **Không tự gác vai** |
| `DisposalApiService` | `api/src/modules/disposal/disposal.api.ts` | Ai cần "vừa bỏ những gì" — một cửa cho cả ba loại |
| `useTabCounts` | `web/src/ui/tab-counts.ts` | Số bên phải nhãn tab của mọi trang chi tiết |
| `useOwnerAttachments` · `useOwnerSecrets` | `web/src/ui/attachment-panel.tsx` · `vault-panel.tsx` | Truy vấn dùng chung giữa panel và số đếm — một khóa cache, một luật quyền |
| `OWNER_PATH` | `web/src/lib/routes.ts` | Dựng link từ cặp `(ownerType, id)` |
| `DISPOSAL_KINDS` · `DISPOSAL_KIND_KEY` | `web/src/lib/disposal-kinds.ts` | Ba loại vào kho + nhãn i18n, dùng ở hai màn |
| `dashboard.subnet_full_percent` · `dashboard.secret_stale_days` | migration 0038 | Hai ngưỡng nghiệp vụ, siết bằng `UPDATE` chứ không dựng lại ảnh |

### Hợp đồng cho đợt sau

- **`vault.module` đã import `devices` · `software` · `service-accounts`.** Nên MỌI ý tưởng
  "cho module chủ hỏi ngược két sắt" đều là vòng phụ thuộc và `dependency-cruiser` chặn thẳng
  (`no-circular`). Cần số secret ở trang chi tiết thì đếm ở **web**, qua chính truy vấn panel
  dùng — xem `useTabCounts`. Cách này còn đúng hơn về quyền: số đi qua `verdict` nên Member
  không được thấy két thì cũng không thấy số.
- **`VaultApiService` bị `vault-surface.spec.ts` ghim từng tên hàm.** Thêm hàm là bài kiểm đỏ —
  cố ý. Sửa nó phải kèm lý do viết ở CẢ HAI đầu (`vault.api.ts` và chính bài kiểm). Thứ vĩnh
  viễn không được thêm: hàm trả giá trị, hàm trả nhãn ngăn, hàm nhận nhiều chủ thể rồi trả kèm
  nội dung (FR-026).
- **Hàm thuần chọn dòng KHÔNG nhận `limit`.** Nhận `limit` thì nơi gọi vẫn phải đếm tổng, và
  cách nhanh nhất là chép lại điều kiện lọc ra ngoài — hai bản của một luật, rồi một hôm sửa
  một bản. Lọc một lần, `.length` ra tổng, `.slice()` ra số dòng hiện.
- **Khối mới trên bảng điều khiển đọc dữ liệu hạn chế theo vai thì phải cắt ở TẦNG SERVICE**,
  không phải để web ẩn khối đi. Ẩn ở web thì dữ liệu vẫn đi qua dây. Mẫu: `staleSecrets` cắt
  đúng bằng quyền của `GET /vault/owners`.
- **Ngưỡng nghiệp vụ vào `system_config`, số dòng hiển thị thì không.** "Bao nhiêu phần trăm
  gọi là sắp đầy" là thứ IT sẽ siết dần; "hiện mấy dòng" là bày biện. Trộn hai loại vào một
  chỗ là làm bảng cấu hình đầy những thứ không ai chỉnh.
- **Module ĐỌC thuần thứ ba đã ra đời** (`dashboard`, `disposal`, và mọi thứ tiếp theo). Luật
  chung: không sở hữu bảng, chỉ gom qua `*.api.ts`, và **không tự gộp lại thứ module khác đã
  gộp** — `dashboard` gọi `disposal.api`, không tự hỏi lại ba module chủ.

### Bẫy đã gặp

1. **Tên khả truy cập ghép thẳng hai node văn bản.** `{label}<span>{count}</span>` cho ra
   `"Giấy tờ0"` — trình đọc màn hình đọc thành một từ, và mọi selector theo tên tab cũng phải
   viết dính nhau mới khớp. Khoảng cách bằng CSS chỉ có nghĩa với mắt. Lỗi này sống từ Epic 3
   (tab "Máy đang dùng" đã có `count`) tới 28/08 mới lộ, vì tới lúc đó mới có bài kiểm nào đọc
   tên tab kèm số. Đã chốt lại bằng unit test trong `tabs.test.tsx`.
2. **`Tabs` đã có `count?: number` và CSS `.tab-count` từ story 2.1 — chưa màn nào truyền vào.**
   Trước khi dựng thứ mới thì đọc `docs/SHARED-REGISTRY.md` và chính component: ở đây thứ cần
   dùng đã nằm sẵn hai epic rồi.
3. **`service_account` KHÔNG có cột `end_date`.** Kiểm lược đồ trước khi hứa "chỉ cần nối dây":
   đưa tài khoản dịch vụ vào luồng hạn là thêm cột + migration + ô trên form + một
   `ExpirySource`, không phải một dòng đăng ký. Và khi làm thì cột đó phải cho **cả hai**
   `kind` — `groupName`/`allowedIps` bị gác VPN-only vì với tài khoản dùng chung chúng *vô
   nghĩa*, còn ngày hết hạn thì có nghĩa với mọi tài khoản. Gác vì vô nghĩa là đúng; gác vì ít
   gặp là sai.
4. **Không có endpoint sửa `system_config`.** E2E muốn dựng trạng thái phụ thuộc ngưỡng thì đi
   đường SQL (`sql()` trong `helpers.ts`) chứ đừng tìm API — và nhớ `SystemConfigService` cache
   30 giây (`CONFIG_CACHE_MS`).

---

## Đợt UI/UX 6 — góp gì (28/08/2026: menu ba chấm · vô hiệu hóa dải · màu nút nguy hiểm)

Năm việc từ phản hồi trực tiếp của người dùng trên hai ảnh màn hình. Không epic mới, không
bảng mới; một cột mới trên đường ĐỌC và một tài sản dùng chung.

### Tài sản dùng chung mới (AD-15)

| Tài sản | Đường dẫn | Thay cho |
| --- | --- | --- |
| `RowActions`, `RowAction` | `web/src/ui/row-actions.tsx` | Dãy nút phẳng ở cột "Thao tác" của 9 bảng |
| `useDispose` | `web/src/ui/dispose-button.tsx` | Bản hook của `DisposeButton`, để đưa được vào menu |
| `rowAction`, `rowActionNames` | `e2e/tests/helpers.ts` | `getByRole('button', { name: 'Sửa' })` ở 26 chỗ |
| `actionLabel` | `web/src/features/ipam/ip-history-entries.ts` | Bảng lịch sử IP hiện lẫn `ip.voided` với "Thu hồi" |

### Hợp đồng cho epic sau

- **`GET /ipam/subnets` mặc định CHỈ trả dải đang dùng.** `?includeVoided=true` là cửa riêng
  của màn dải mạng. `IpamApiService.listSubnets()` gọi mặc định — bảng điều khiển không được
  lôi một dải đã tắt lên nhắc sếp.
- **`SubnetService.cidrOf` (đường GHI) từ chối dải đã tắt; `frameOf` (đường ĐỌC) thì không.**
  Thêm IP vào một dải đã cất đi là tạo dữ liệu không màn nào chịu trách nhiệm; còn xem lại
  bảng IP của nó thì phải được, đó là thứ người ta đọc trước khi quyết định bật lại hay xóa.
- **`PATCH /ipam/subnets/:id/restore`** bật lại dải + đúng những hồ sơ IP tắt CÙNG nó, nhận ra
  bằng `ip_address.voided_at = subnet.voided_at`. Dấu thời gian là khóa chính xác vì
  `voidSubnet` đóng cả hai bằng một `now` trong một transaction.
- **Nhãn nút ba chấm PHẢI kèm định danh dòng** qua `common.actionsOf`. Dùng chung một chữ
  "Thao tác" thì hai chục nút mang cùng một tên: trình đọc màn hình đọc y hệt nhau và
  `getByRole` của bài kiểm khớp cả hai chục dòng.

### Bẫy đã gặp

1. **Hai khối CSS không liên quan trùng tên lớp `.stat-grid`.** `detail-tabs.css` định nghĩa
   nó hai lần: một cho dải chỉ số trang chi tiết (gap 1px + nền `--border` = các ô liền nhau),
   một cho KPI của một bản dựng Bảng điều khiển đã bỏ. Khối sau đè `grid-template-columns`
   (`auto-fit` → `auto-fill`) và `gap`, nhưng KHÔNG đè `background` — nên hai thẻ chỉ số ngồi
   trên một tấm nền xám kéo hết chiều ngang. Đó là hình 34 người dùng gửi. Khối KPI ấy chết từ
   lâu mà không ai biết, vì `stat-card`/`stat-num` không còn ai gọi. **Đặt tên lớp theo màn**
   như `profile.css` đã làm với `.profile-stat-card`.
2. **"Vô hiệu hóa" mà bản ghi biến khỏi danh sách thì người dùng đọc là "đã xóa".** Và họ
   không sai — không còn chỗ nào trên giao diện nói nó tồn tại. Với dải mạng thì tệ hơn: mấy
   chục cái máy vẫn cắm IP tĩnh của dải đó, còn màn hình vẽ 254 ô "Trống" sẵn sàng cấp lại.
   Luật rút ra: **ẩn mềm phải NHÌN THẤY được ở đúng chỗ nó vừa biến mất**, gạch ngang và nói
   rõ ai tắt, khi nào, vì sao. Danh sách khác đang ẩn mềm nên soi lại theo luật này.
3. **`sort()` trên mảng của TanStack Query là sửa cache dùng chung.** Sắp dải đã tắt xuống
   cuối phải làm trên bản sao (`[...rows].sort(...)`), không thì mọi nơi khác đọc cùng
   `queryKey` nhận về thứ tự đã bị đổi.
4. **Mảng mới mỗi render trong deps của `useEffect`.** Bản đầu của `RowActions` đưa danh sách
   mục (đã `sort`) vào deps của effect "mở menu thì focus mục đầu" — effect chạy lại sau mọi
   lần render và kéo focus về đầu, nên phím ↓ trông như chết. Giữ qua `useRef`, effect chỉ
   nghe `open`.
5. **Nhãn bước chuyển IP có HAI bản.** API `transitionLabel` viết "Đánh dấu nghi chết", web
   `ipam.trSuspect` viết "Nghi chết". Cả hai đều hiện ra người dùng (một cái trên nút, một cái
   trong dòng lịch sử) — bài kiểm bám nhầm bản là đỏ mà chẳng nói lên điều gì.
6. **"Hủy" trong dự án này là nút HỦY BỎ HỘP THOẠI (`common.cancel`), không phải "hủy phiếu".**
   Tô đỏ nó là dạy người dùng bỏ qua màu đỏ, rồi tới nút thật sự nguy hiểm họ cũng không đọc
   nữa. Màu đỏ chỉ dành cho việc LẤY ĐI thứ gì đó.

## Đợt rà soát 19/09/2026 — góp gì (nhánh `feat/ui-chi-tiet-v2`)

Không epic mới, không bảng mới. Một đội bảy chuyên gia đọc lại toàn bộ 16 commit của nhánh
(kiến trúc · bảo mật · React · UI/UX · trợ năng · chất lượng bài kiểm · ops), rồi sửa theo kết
quả — thành 20 commit. Con số đáng nhớ không phải số finding mà là **thành phần** của chúng:

> Phần lớn mục HIGH không phải lỗi mới. Chúng là **bản vá của đợt trước KHÔNG CHẠY** — code
> trông đúng, chú thích giải thích rành mạch, bài kiểm xanh, cơ chế chết.

### Tài sản dùng chung mới (AD-15)

| Tài sản | Đường dẫn | Thay cho |
| --- | --- | --- |
| `DetailSection` | `web/src/ui/detail-layout.tsx` | Vỏ khu "Hồ sơ" chép nguyên văn vào 4 file `features/` |
| `quetNguon` | `web/src/test/quet-nguon.ts` | Ba bản `walk()` chép tay trong ba bài điểm danh |
| `ops/gate-hex.sh` | (script) | Hai bản luật cấm hex: một `perl` ở `ci-local.sh`, một `grep` thô ở `ci.yml` |

`levelFromDays`, `openCommandPalette`/`OPEN_PALETTE_EVENT` sinh ra ở đợt trước nhưng chưa khai —
đã bổ sung vào `docs/SHARED-REGISTRY.md` trong đợt này.

### Hợp đồng cho epic sau

- **Một cổng chất lượng = MỘT file, nhiều nơi gọi.** `ops/gate-hex.sh` là bản duy nhất; cả
  `ci-local.sh` lẫn `.github/workflows/ci.yml` gọi vào đó. Chép luật sang nơi thứ hai là tái
  tạo đúng sự cố 18–19/09: bản nội bộ được sửa, bản chặn merge thì không, và nhánh xanh ở máy
  mà đỏ ở cổng.
- **Cổng phải FAIL-CLOSED khi thiếu công cụ.** `perl … | grep -q` nằm trong điều kiện `if` nên
  `set -e` không áp: thiếu `perl` thì mọi file "sạch" và script vẫn in "Tất cả kiểm tra đã
  xanh". Mọi cổng mới phải kiểm sự tồn tại của công cụ nó dựa vào.
- **File migration đã apply là BẤT BIẾN.** `database/migration-runner.ts` băm SHA-256 nội dung
  và *fail to* khi lệch. Chú thích sai trong một migration đã chạy KHÔNG sửa được — đính chính
  phải đi chỗ khác (`docs/NO-KY-THUAT-*.md`).
- **`DetailSection` có prop `compact`, và nó nói một điều CÓ THẬT.** Bật khi các khu anh em
  trên cùng màn là `device-panel` (hiện chỉ trang chi tiết thiết bị); ba màn kia khu này đứng
  một mình nên `.card` trần mới khớp với thẻ định danh bên phải. Đừng bật "cho đều".
- **Ở mẫu combobox, `role="listbox"` chỉ được chứa `option` và `group`.** Dải cảnh báo, khối
  rỗng, tên nhóm đều phải nằm ngoài hoặc bọc bằng `role="group"`. Và listbox phải LUÔN có mặt
  kể cả khi rỗng, vì `aria-controls` trên ô nhập cần một đích thật.
- **`timVaChoLoc` chờ đúng GIÁ TRỊ của `q=`, không chờ "có `q=`".** Màn `/expiry` KHÔNG dùng
  được helper này: nó có `useListUrlState` nhưng không khai `searchKey` nên không có ô tìm nào.

### Bẫy đã gặp

1. **Bản vá có thể tự vô hiệu hoá chính nó, và chú thích càng hay thì càng khó thấy.** Cơ chế
   "giữ lựa chọn theo đích đến" trong `command-palette.tsx` có 20 dòng chú thích mô tả đúng
   cảnh hỏng — nhưng hai `useEffect` khai SAI THỨ TỰ, nên effect ghi neo chạy trước effect đọc
   neo và đè nó bằng phần tử ở chỗ ngồi cũ. Toàn bộ cơ chế là một no-op. React chạy effect theo
   thứ tự khai trong cùng một commit: **thứ tự khai là ngữ nghĩa, không phải phong cách**.
2. **Chú thích của chính mình có thể làm hỏng bài kiểm đứng cạnh.** `vault-surface.spec.ts`
   khẳng định `expect(body).toContain('assertCanReveal')` trên lát cắt THÔ của source. Trong
   lát ấy có một dòng chú thích nhắc tên hàm — nên khẳng định được thỏa bởi chú thích, không
   phải bởi hàng rào. Gỡ trắng break-glass: 9/9 vẫn xanh. **Bài kiểm đọc source phải lột chú
   thích trước, và so HÌNH DẠNG lời gọi chứ không so cái tên.**
3. **Bài kiểm có thể xanh vì lý do sai.** `command-palette-guard.test.tsx` dùng
   `getByRole('dialog')` để khẳng định palette KHÔNG mở. Nhưng hộp Radix đặt `aria-hidden` lên
   mọi nhánh anh em, nên truy vấn ấy luôn trả `null` — kể cả khi palette đang phủ kín màn hình.
   Vô hiệu hoá bản vá: 2/2 vẫn xanh. **Thứ che mất màn hình là DOM, không phải cây trợ năng.**
4. **Hai bản vá đúng, ghép vào nhau thành một chốt chết.** `use-list-url-state.ts`: bản vá
   "không nuốt dấu cách đang gõ" cố ý giữ `searchInput = "máy in "` trong khi `search` là
   `"máy in"`; chốt của effect debounce là `searchInput === search` nên **không bao giờ đúng**.
   Effect sống mãi, và mỗi lần `location.search` đổi là 250ms sau `page` bị xoá — bảng nhảy về
   trang 1 dưới tay người đang đọc trang 3. Gõ không dấu cách thì không sao, nên rất khó lần.
5. **Một cổng vặt ở tầng rẻ âm thầm vô hiệu hoá mọi tầng đắt phía sau.** Cổng cấm hex đỏ vì một
   mã màu nằm trong CHÚ THÍCH; nó ở tầng một nên `--e2e` không bao giờ chạy tới. Bảy story đóng
   lại với DoD gạch 7 hổng, trong khi mọi cổng khác báo xanh. **Chưa có quyết định** về việc
   chuyển loại cổng ratchet (hex, `--max-warnings=0`) xuống sau khối E2E — mục duy nhất của đợt
   này còn treo.
6. **Bài kiểm chập chờn không tên là thứ đắt nhất: nó dạy người ta chạy lại thay vì đọc.** Một
   file Vitest đỏ rồi tự xanh qua ba lượt; chỉ khi giữ TRỌN log mới thấy
   `ENOENT: open 'web/src/__lint-probe__ImooEl/probe.tsx'` — `lint-rules.test.ts` tạo/xoá thư
   mục dò ngay trong `src`, Vitest chạy song song, bài nào quét cây có thể đọc trúng thư mục
   vừa biến mất. `dead-keys-rollcall` đã được vá 18/09; hai bản `walk()` còn lại thì không.
   **Vá bản thứ hai rồi chờ bản thứ ba là sai AD-15** — nay một `quetNguon`, ba nơi gọi (bản
   đầu chỉ đấu được HAI: `dead-keys-rollcall` — chính file lấy làm dẫn chứng — vẫn giữ bản sao
   riêng, lượt rà soát cùng ngày đếm ra). Bỏ qua
   theo TÊN chứ không `try/catch`: nuốt ENOENT là nuốt mọi lỗi đọc thật.
7. **"Đang tải" không phải "hỏng".** `isUnknown` gộp `isPending` với `isError`, mà câu đi kèm là
   một CẢNH BÁO có chỉ dẫn ("đừng dựa vào nó để quyết định thanh lý"). Mọi lượt mở trang chi
   tiết thiết bị đều nháy cảnh báo sai đó, và vì nằm trong `role="status"` nên trình đọc màn
   hình đọc trọn nó lên rồi nó biến mất.
8. **`role="status"` trên node được TẠO RA cùng nội dung thì câm.** Trình đọc màn hình chỉ theo
   dõi vùng sống đã có mặt TRƯỚC khi nội dung đổi. Khu "cắt gì" của bản đồ quan hệ là mẫu
   DISCLOSURE, không phải thông báo — đúng vai là `aria-expanded` trên nút + khu thường trực
   mang `hidden`, và bỏ hẳn `role="status"`.

---

## Đợt UX v1.3 → v1.4.2 — góp gì (tag `v1.3.1..v1.4.2`, 29/09/2026)

Không epic mới, không bảng mới. Đợt soát UX (cao · vừa · nhẹ · trau chuốt), các quyết định
Q-15 trong `docs/QUYET-DINH.md`, và đợt soát chữ toàn hệ thống (364 chuỗi). Code review `high`
của cả khoảng tag ra 10 finding, đã sửa hết trên nhánh `fix/review-v142`.

### Cột / tham số mới và chủ sở hữu (AD-3)

| Migration | Thay đổi | Chủ |
| --- | --- | --- |
| 0100, 0101 | Index sắp theo hạn bảo hành (`CREATE INDEX CONCURRENTLY`, `-- ims:no-transaction`) | `devices` |
| 0140 | `system_config` `nat.sensitive_ports` | `config-sys` (sổ NAT đọc) |
| 0150 | `secret.value_changed_at`, `value_changed_by` — cột "Đổi lần cuối" | `vault` |
| 0170 | `approval.requester_session_id` — chỉ để tra vết | `approvals` |
| 0180 | `renewal_history.contract`, `cost` — hợp đồng + chi phí của TỪNG lượt gia hạn | `expiry` |
| 0181 | `software.websites`, `renewal_history.websites` — website của SSL/tên miền theo kỳ | `software` / `expiry` |
| 0240 | `approval.claimed_session_id`, `claimed_at` — quyền mở két gắn phiên ở lần Xem đầu | `approvals` |
| 0241 | `system_config` `breakglass.pending_expire_hours` (8) | `config-sys` (vault đọc) |

### Tài sản dùng chung mới (AD-15)

Đã khai hết trong `docs/SHARED-REGISTRY.md`. Đáng nhớ nhất cho epic sau:
`RenewDialog` (một hộp Gia hạn cho mọi cửa, kèm hợp đồng/chi phí/website), `ChipToggleGroup`,
`SecretDue`, `MoneyInput`/`parseMoneyInput`, `DeviceTimelineRegistry`, `withActorNames` +
`latestStatusEvents`, `dateTimeInTz` (giờ trong file xuất), `formatDateTime` (giờ trên màn),
và bộ break-glass dùng chung ở `ui/break-glass*`.

### Hợp đồng cho epic sau

- **Quyền mở két gắn PHIÊN, không gắn người** (Q-15). Grant chưa xem lần nào thì chưa gắn phiên;
  lần Xem đầu tiên gắn nó vào phiên đó (`claimWithin`, `UPDATE … WHERE claimed_session_id IS
  NULL`). Phiên chết là quyền chết, lượt quét chỉ dọn nhật ký.
- **Vô hiệu hóa tài khoản rút MỌI phiếu còn sống** của người đó trong cùng transaction.
  `ApprovalFlowSpec.withdrawOnRequesterDisabled` là bảng state → state; loại duyệt mới phải
  khai cả state "đã duyệt", không chỉ state chờ (xem finding 1 bên dưới). Chỉ KHÓA thì giữ.
- **`UsersApiService.namesByEmails` trả map tra không phân biệt hoa-thường.** Nơi gọi tra
  thẳng bằng email thô, đừng tự `toLowerCase()` rồi quên ở chỗ khác.
- **Giờ trong file Excel: `dateTimeInTz`, giờ trên màn: `formatDateTime`.** Cả hai ghép từ
  `formatToParts`; `Intl` `vi-VN` in giờ TRƯỚC ngày.
- **Nguồn hạn (`ExpirySource`) lọc loại trong SQL.** Đăng ký một nguồn mỗi loại thì mỗi nguồn
  phải tự thu hẹp truy vấn, không kéo mọi loại rồi lọc JS.

### Code review đóng đợt — 10 finding, đã sửa hết

| # | Mức | Ở đâu | Sửa |
| --- | --- | --- | --- |
| 1 | Bảo mật | `accounts.service` / `approvals.service` | Vô hiệu hóa chỉ rút phiếu chờ; quyền ĐÃ duyệt chưa gắn phiên sống qua lần đá phiên, bật lại tài khoản là mở két không cần duyệt lại → thu hồi luôn |
| 2 | Đúng | `license-assignment.service` | Gia hạn license kéo cả ghế có hạn riêng NGẮN hơn hạn cũ → chỉ kéo ghế hết trong [hạn cũ, hạn mới); hộp Gia hạn đếm cùng luật |
| 3 | Đúng | `users.service` | Tra tên theo email hụt với tài khoản gõ hoa → map tự hạ chữ thường |
| 4 | Đúng | `ip-address.service` | Ô IP hiện chủ của chu kỳ cũ khi lần thả gần nhất không có chủ |
| 5 | Đúng | `common/today.ts` | File xuất in `HH:mm dd/mm/yyyy`; file mở két dùng định dạng thứ ba |
| 6 | Hiệu năng | `audit-query.service` | Chế độ gom chạy trọn CTE hai lần mỗi trang → một câu |
| 7 | Hiệu năng | `approvals.service` | Rút phiếu kéo mọi phiếu cũ về lọc JS lúc đang giữ khóa → lọc SQL |
| 8 | Hiệu năng | `software-expiry-sources` | 5 nguồn × trọn câu + decorate → lọc loại trong SQL |
| 9 | Hiệu năng | `break-glass.service` | Nhóm "Đang có hiệu lực" kéo cả quyền đã hết → `effectiveState` |
| 10 | Luật | nhiều file | Chú thích "trước đây…" → viết lại thành lý do |

### Bẫy đã gặp

1. **Build trong Docker khác build trên máy.** `tsbuildinfo` còn trên máy làm `tsc -b` bỏ qua
   file đã đổi, nên build máy xanh mà image vẫn đỏ (hoặc ngược lại). Kiểm kiểu của web là
   `npm run build` trong đúng môi trường sẽ đóng image, và tầng giữa phải `--build`.
2. **E2E đo ngay sau cú bấm thì đỏ chập chờn.** Khẳng định chạy trước khi lượt nạp lại đổ về
   (debounce, invalidate query) sẽ xanh nhờ may. Chờ đúng giá trị (`waitForResponse`, chờ `q=`
   mang đúng giá trị), không chờ "có phần tử".
3. **Hai nhánh cùng làm một prop.** Hai worktree song song cùng thêm một prop vào cùng một
   component dùng chung, mỗi bên một nghĩa; merge xong không xung đột dòng nào nhưng một bên
   hỏng. Chia việc theo component dùng chung, không theo màn.
4. **Worktree của agent tạo từ `master`, không từ nhánh đang đứng.** Agent làm trên nền cũ và
   "sửa" lại thứ nhánh hiện tại đã sửa. Giao việc cho agent trong worktree thì nói rõ nhánh gốc
   và kiểm `git log -1` của worktree trước khi nhận kết quả.
5. **Lọc bỏ hàng "không có dữ liệu" để lấy "hàng gần nhất" là lấy nhầm chu kỳ cũ** (finding 4).
   "Gần nhất" phải chọn trên đúng loại sự kiện, rồi mới hỏi sự kiện đó có dữ liệu không.
6. **Rút quyền theo "state ban đầu" bỏ sót state đã duyệt** (finding 1). Mỗi lần thêm một
   đường kết thúc tài khoản, liệt kê mọi state còn mang quyền, không chỉ state đang chờ.
