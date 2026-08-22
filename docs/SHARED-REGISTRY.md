# Sổ đăng ký tài sản dùng chung (AD-15)

> **Trước khi viết bất kỳ component / hook / service nào: đọc bảng dưới.**
> Có rồi thì dùng lại. Cần khác đi thì **thêm prop/tham số vào bản dùng chung**, cấm fork bản riêng.
> Sinh ra thứ dùng chung mới thì khai vào đây **ngay trong story đó**.
>
> Xem tận mắt: chạy app rồi mở `/dev/components`.

## Giao diện — `web/src/ui/`

| Tên | Đường dẫn | Dùng ở đâu | Khi nào KHÔNG dùng |
| --- | --- | --- | --- |
| `useConfirm` / `ConfirmProvider` | `ui/confirm-provider.tsx` | Mọi thao tác khóa/thu hồi/reset/gia hạn | Không bao giờ dùng `window.confirm` thay thế |
| `Dialog`, `DialogTitle` | `ui/dialog.tsx` | Mọi hộp thoại (Radix: focus trap, Esc, a11y) | Không tự dựng overlay bằng `createPortal` |
| `useToast` / `ToastProvider` | `ui/toast.tsx` | Báo kết quả thao tác ngắn | Lỗi cần người đọc kỹ → dùng `.alert` trong form |
| `DataTable` | `ui/data-table.tsx` | Bảng có sort/tìm/expand (TanStack) | Bảng tĩnh 3 dòng thì `<table class="table">` là đủ |
| `Pagination` | `ui/pagination.tsx` | Mọi danh sách server-side `{items,total}` | Danh sách tải hết một lần |
| `FilterBar` | `ui/filter-bar.tsx` | Thanh lọc phía trên danh sách | — |
| `PageHeader`, `FormSection`, `Field` | `ui/page-header.tsx` | Đầu trang + bố cục form | — |
| `ExpiryBadge` | `ui/expiry-badge.tsx` | Mọi chỗ hiển thị trạng thái hạn | Không tự so ngày rồi tự chọn màu |
| `ExportXlsxButton` | `ui/export-xlsx-button.tsx` | FR-028 — xuất bảng đang xem | Không tự sinh file phía trình duyệt |
| `SchedulePicker`, `describeSchedule` | `ui/schedule-picker.tsx` | Luật gửi email định kỳ (FR-013), sinh kỳ phiếu (FR-029) | — |
| `Tabs`, `TabPanel` | `ui/tabs.tsx` | Màn Danh mục (2.1), trang chi tiết thiết bị (2.5) | Hai tab thôi thì cân nhắc hiện cả hai |
| `FilePicker` | `ui/file-picker.tsx` | Mọi chỗ chọn file: import danh mục/thiết bị, đính kèm | Không tự dựng `<input type="file">` trần |
| `ImportPreview` | `ui/import-preview.tsx` | Bảng đối chiếu TRƯỚC khi ghi của mọi màn import | Màn import nào cũng phải có bước này |
| `HistoryPanel` | `ui/history-panel.tsx` | Lịch sử nghiệp vụ (AD-13) | Nhật ký an ninh → màn Audit riêng |
| `DatePicker`, `DateTimePicker` | `ui/date-picker.tsx`, `ui/date-time-picker.tsx` | Mọi ô chọn ngày/giờ | Không dùng `<input type="date">` trần |
| `Loading`, `LoadError`, `EmptyState`, `NotFound` | `ui/load-state.tsx` | Mọi màn có fetch: phân biệt tải ≠ rỗng ≠ lỗi | — |
| `Select`, `Combobox`, `ThemeSwitch`, `PhotoLightbox`, `NavIcon` | `ui/` | Theo tên | — |
| `OtpInput` | `features/auth/otp-input.tsx` | Nhập mã 6 số: đăng nhập, enroll, step-up | — |
| `AuthCard` | `features/auth/auth-card.tsx` | Màn ngoài shell (đăng nhập, TOTP, đổi mật khẩu) | Màn trong app → `AppShell` |
| `AppShell` | `shell/app-shell.tsx` | Khung sidebar + topbar của mọi màn nghiệp vụ | — |

## Logic dùng chung — `web/src/lib/`

| Tên | Đường dẫn | Dùng ở đâu | Ghi chú |
| --- | --- | --- | --- |
| `expiryLevel`, `expiryLabel`, `daysUntil` | `lib/expiry.ts` | **Luật "sắp hết hạn" duy nhất** của hệ thống | Tính theo ngày lịch, không theo 24 giờ |
| `nextStepPath` | `lib/me.ts` | Nơi DUY NHẤT quyết định bước tiếp theo của luồng đăng nhập | Màn không tự `navigate()` |
| `apiFetch`, `ApiError` | `lib/api-client.ts` | Mọi lời gọi API | Tự gắn CSRF; 401-phiên-chết mới đá về đăng nhập |
| `useMe`, `useApiMutation`, `errorMessage` | `lib/api.ts` | Query/mutation + đọc message lỗi tiếng Việt | Mutation tự làm mới `me` |
| `formatDateTime`, `formatDate`, `orDash` | `lib/format.ts` | Mọi chỗ hiện ngày giờ | Lưu UTC, hiện giờ VN |
| `downloadFile` | `lib/download-file.ts` | Tải file giữ đúng tên | — |
| `uploadFile` | `lib/upload.ts` | Gửi file lên endpoint multipart | Không tự đặt `Content-Type` (mất boundary) |
| Token màu | `css/tokens.css` | **Nguồn màu duy nhất** | Cấm hex ngoài file này |

## Hạ tầng API — `api/src/common/` và module nền

| Tên | Đường dẫn | Dùng ở đâu | Khi nào KHÔNG dùng |
| --- | --- | --- | --- |
| `EnvelopeCryptoService` | `common/crypto/envelope.service.ts` | Mọi thứ cần mã hóa: TOTP secret, két sắt (Epic 4) | Cấm tự gọi `createCipheriv` (eslint chặn) |
| `MasterKeyRing` | `common/crypto/master-key-ring.ts` | Chùm chìa + xoay version | — |
| `ExcelExportService` | `common/excel/excel-export.service.ts` | FR-028 — mọi bảng; `buildWorkbook` cho file nhiều sheet | Cấm import `exceljs` trực tiếp (eslint chặn) |
| `ExcelImportService` | `common/excel/excel-import.service.ts` | Nơi DUY NHẤT ĐỌC file xlsx (import danh mục 2.1, thiết bị 2.6) | Trả chuỗi thô; hiểu nghĩa là việc của lõi `plan*Import` thuần |
| `parsePageQuery`, `Page<T>` | `common/pagination.ts` | Mọi endpoint danh sách | Shape trả về luôn là `{ items, total }` |
| `Tx`, `WriteFn` | `common/tx.ts` | Mọi hàm ghi (AD-5) | `tx` là tham số đầu, không dùng ALS |
| `ExpirySource` | `common/expiry/expiry-source.ts` | Module có ngày hết hạn tự đăng ký (AD-7) | Vault KHÔNG đăng ký (AD-4) |
| `readSecretFile` | `common/secrets.ts` | Đọc docker secret | Cấm đọc bí mật từ env (AD-11) |
| `GlobalExceptionFilter` | `common/global-exception.filter.ts` | Một shape lỗi cho toàn API | — |
| `@Audited` + `AuditInterceptor` | `modules/audit/` | Mọi endpoint ghi (AD-9) | — |
| `@Roles` + `RolesGuard` | `modules/auth/roles.*` | Mọi controller — thiếu là bị chặn (AD-9) | Route công khai phải khai `@Public()` |
| `SessionGuard`, `CsrfGuard` | `modules/auth/` | Toàn cục | — |
| `PasswordService` | `modules/auth/password.service.ts` | Băm/kiểm mật khẩu | Cấm import `@node-rs/argon2` nơi khác |
| `TotpService` | `modules/auth/totp.service.ts` | TOTP + chống replay | — |
| `SystemConfigService` | `modules/config-sys/` | Mọi ngưỡng vận hành (AD-11) | Cấm hardcode hằng số nghiệp vụ |
| `OutboxService` | `modules/outbox/` | Mọi email/sự kiện (AD-5) | Cấm gọi `nodemailer` trong request |
| `MailTransportService`, `renderMail` | `modules/mail/` | Nơi duy nhất gửi và dựng HTML email | — |
| `UsersApiService` | `modules/users/users.api.ts` | Module khác cần dữ liệu user (AD-2) | Cấm query bảng `users` từ module khác |
| `CatalogApiService` | `modules/catalog/catalog.api.ts` | `devices` và mọi module cần site/tủ/loại/NCC | Cấm query bảng `site`/`cabinet`/`device_type`/`vendor` |
| `FilesService` | `modules/files/` | Đính kèm file (Epic 2+) | — |

## Cách CI ép luật (không trông vào review)

| Luật | Công cụ | Chạy bằng |
| --- | --- | --- |
| Đồ thị module acyclic, cấm import nội bộ xuyên module (AD-2) | dependency-cruiser | `npm --prefix api run depcruise` |
| Cấm `exceljs`/`nodemailer`/`argon2`/`createCipheriv` ngoài chỗ được phép (AD-15) | eslint `no-restricted-imports` / `no-restricted-syntax` | `npm --prefix api run lint` |
| Cấm hex màu ngoài `tokens.css` | rà bằng `grep -rE "#[0-9a-fA-F]{3,8}" web/src --include=*.css` | thêm vào CI khi dựng pipeline |
