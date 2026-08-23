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
