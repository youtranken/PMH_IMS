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
| Chưa có pipeline CI thật (mới có script `lint`/`depcruise`/`test`) | Chưa chốt nơi chạy CI (máy nội bộ hay GitHub) | Trước khi có người thứ hai commit |
| `audit.controller` (màn xem nhật ký) chưa dựng UI | Không nằm trong AC Epic 1 | Epic 6 (nhật ký break-glass) |
| Restore drill lần đầu (AR-9) | Phải chạy **cuối Đợt 1**, trước khi secret thật vào két | Cuối Epic 4 |
| `system_config` chưa có màn Admin để sửa | AC Epic 1 chỉ yêu cầu seed + đọc | Epic 3 (luật digest cần UI) |
| `web` chưa có `oxlint` chạy trong CI | — | Cùng lúc dựng CI |

### Bẫy đã gặp — đừng lặp lại

1. **`apiFetch` redirect mọi 401** → màn đăng nhập không hiện nổi lỗi "sai mật khẩu".
   Giờ chỉ redirect khi `code` thuộc nhóm phiên chết. Có test hồi quy.
2. **Điều hướng rải rác ở từng màn** → đua với router khi `me` được nạp lại, đá người dùng
   vòng vòng. Giờ chỉ `nextStepPath` quyết định.
3. **Enroll TOTP xong nhưng phiên vẫn `totp_pending`** → user kẹt. Enroll trong luồng đăng nhập
   giờ cấp lại phiên như đã qua bước 2.
4. **E2E dùng lại mã TOTP cũ** → bị chống-replay chặn, dễ tưởng là bug. Helper `freshTotpCode`
   chờ sang chu kỳ 30 giây mới.
