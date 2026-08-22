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
