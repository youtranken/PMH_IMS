# Soát UI/UX Epic 1–7 — 2026-08-24

Năm chuyên gia soát song song (khung/điều hướng, màn dữ liệu, IPAM+két sắt, hệ thiết kế+a11y,
responsive 390px). Mọi phát hiện trong file này đã được kiểm lại bằng grep/đo đạc thật, không
lấy nguyên lời báo cáo.

## 1. Một nguyên nhân gốc, không phải một mớ lỗi rời

Hầu hết lỗi nặng đều cùng một họ: **bản port từ QLTS lấy một nửa**.

| Kiểu | Ví dụ | Hậu quả |
| --- | --- | --- |
| TSX gọi tên lớp mà CSS chưa từng có | `.shell`, `.row`, `.spinner`, `.empty`, `.error-state`, `.sub`, `.span-3`, `.badge.brand` | Layout/hiển thị chết lặng — **không có lỗi nào trong console** |
| CSS có sẵn mà TSX không dùng | `.sidebar.is-drawer`, `.drawer-backdrop`, `.nav-fab` | Mất hẳn drawer mobile |
| Token `var()` gọi mà không khai | `--accent` | Màu rơi về mặc định |

Vì lỗi loại này **không ném exception**, cả 152 test cũ vẫn xanh. Bài học kiểm thử: `toBeVisible()`
chỉ đòi phần tử có kích thước, **không** đòi nó nằm trong tầm nhìn hay đúng chỗ. Muốn bắt lỗi bố
cục phải đo hình học (`toBeInViewport`, `boundingBox`, so bề ngang với viewport).

## 2. Đã sửa trong lượt này

| # | Lỗi | Sửa ở đâu | Bằng chứng |
| --- | --- | --- | --- |
| 1 | **S1** `.shell` không có luật CSS → nội dung bị đẩy xuống dưới 100vh, mọi trang trống bên phải | `web/src/shell/app-shell.tsx` → `app-shell` | Đo được: lớp cũ `main` ở y=776 (viewport 720); lớp mới y=56, x=236. `e2e/tests/shell.spec.ts` |
| 2 | **S1** 390px không dùng được: sidebar 236px ăn 60% màn hình, không có cách mở/đóng | Drawer + nút trong topbar: `app-shell.tsx`, `css/shell.css`, khoá `app.openNav/closeNav` | `e2e/tests/shell.mobile.spec.ts` (3 kịch bản: mở, tự khép khi chọn, thoát bằng backdrop/Esc) |
| 3 | **S1** `.row` (47 chỗ / 26 file) không có luật → `justify-content`/`gap` viết inline vô tác dụng, nút chân dialog dồn trái và dính nhau | `css/primitives.css` | grep 47 chỗ dùng, 0 luật khớp trước khi sửa |
| 4 | **S1** `.spinner`, `.empty*`, `.error-state`, `.error-code` rớt khi port → vòng xoay không xoay, khối rỗng thành chữ trôi, trang 404 mất số lớn | `css/shared-kit.css` (port lại từ QLTS `auth.css:266-332`) | grep: 0 luật khớp trước khi sửa |
| 5 | **S2** `PageHeader` bọc `.grow`/`.row` làm `margin-right:auto` của h1 mất tác dụng → tiêu đề + nút dồn cụm bên trái ở 16 màn | `css/base.css` | — |
| 6 | **S2** `.sub` (phụ đề mọi trang) không có style | `css/base.css` | — |
| 7 | **S2** `--accent` không tồn tại → nút "xem chi tiết phiên" mất màu nhấn | `css/table.css` → `--primary-ink` | grep tokens.css: không khai ở đâu |
| 8 | **S2** `.badge.brand` không tồn tại → badge vai trò (Member/Admin/SA) hiện như chữ thường | `css/table.css` | — |
| 9 | **S3** `.span-3` không tồn tại → ô Ghi chú khai `span={3}` vẫn chỉ chiếm 1 cột | `css/form-layout.css` | — |
| 10 | Bản chép `logout()` trong spec treo 60s ở 390px (nút nằm trong drawer) | Gom về `e2e/tests/helpers.ts` (AD-15) | Suite 390px: 19/19 xanh |

Nguyên tắc khi sửa: **không thêm hex mới** — mọi luật mới chỉ dùng `var(--…)` đã có trong
`tokens.css`; chuỗi mới (`Mở menu`/`Đóng menu`) vào `locales/vi.ts`.

## 3. Còn lại — xếp theo (đau × rẻ)

### Cần anh quyết trước khi làm

**A. Nút chính (Đăng nhập/Lưu/Tạo mới) không đạt WCAG AA ở giao diện SÁNG — S1.**
`button.primary` dùng `color: var(--on-accent)` (#fff) trên nền `var(--grad)` = gradient
`--primary` (#0e9f6e) → `--warm` (#f59e0b). Tương phản tính theo công thức WCAG: **3.39:1 ở đầu
xanh, 2.15:1 ở đầu cam**, trong khi chữ 14px đậm cần 4.5:1. Giao diện TỐI thì ngược lại, rất tốt
(9.7–11.2:1). Đây là lỗi chỉ có ở theme sáng, và nằm ngay nút đầu tiên người dùng bấm.

Sửa được theo hai hướng, cả hai đều **đổi diện mạo thương hiệu** nên tôi không tự quyết:
1. Làm đậm `--primary`/`--warm` ở theme sáng cho tới khi đạt 4.5:1 (giữ nguyên dark).
2. Đổi chữ nút chính sang tông tối (`--ink` hoặc token mới `--on-accent-warm`).

**B. `DataTable` (bảng sort được) đã viết, đã khai trong `SHARED-REGISTRY.md`, nhưng KHÔNG màn nào
dùng — S2.** 6 bảng danh sách chính (thiết bị, phần mềm, đường truyền, sắp hết hạn, tài khoản, danh
mục) đều tự dựng `<table>` tĩnh, nên **không sắp xếp được cột nào**. Hoặc chuyển 6 màn sang
`DataTable`, hoặc gỡ nó khỏi registry để không ai tưởng đã có sort.

**C. Dải IP không phân trang — S1 tiềm ẩn.** `subnet-detail.tsx` tải toàn bộ host của dải; validate
cho phép prefix từ /8. Gõ nhầm `/16` thay `/24` là 65.000 dòng, `/8` là 16 triệu → treo tab. Cần
phân trang server-side (đã có `ui/pagination.tsx`) và/hoặc siết prefix tối thiểu. Đây là quyết định
nghiệp vụ: siết tới /22 hay /24?

### Làm được ngay, không cần quyết

| Mức | Việc | Vị trí |
| --- | --- | --- |
| S1 | Form dài bị `.sheet{overflow:hidden}` cắt cụt, không cuộn tới nút Lưu — mọi form nghiệp vụ đều thiếu lớp `.sheet-body` (chỉ `confirm-dialog.tsx` làm đúng) | `ui/dialog.tsx`, 6 form + `ui/import-dialog.tsx` |
| S2 | `<th>` thiếu `scope="col"` — 114/114 chỗ | `ui/data-table.tsx` (3 chỗ, phủ mọi bảng TanStack) + ~14 file bảng tĩnh |
| S2 | Lịch sử IP hiện mã máy: "ip.created", "ip.updated" thay vì tiếng Việt. Test không bắt được vì fixture tự đặt sẵn chuỗi Việt | `web/src/features/ipam/ip-history-entries.ts`, fixture test tương ứng |
| S2 | ~28 chuỗi Việt hardcode, nặng nhất là trong `web/src/ui/` (phân trang, toast, ThemeSwitch, DataTable) vì lan ra mọi màn dùng chúng | `ui/*`, `features/admin/accounts-screen.tsx`, các form |
| S2 | Sổ NAT không lọc theo thiết bị; ma trận quyền không lọc theo site — cả hai đều là AC đã viết trong `epics.md` | `features/ipam/nat-screen.tsx`, `features/vault/access-matrix-screen.tsx` |
| S2 | `useDebounce` bị chép y hệt 3 bản (250ms) | `port-map-panel.tsx`, `isp-form.tsx`, `license-assignments-panel.tsx` |
| S2 | Trạng thái rỗng vẽ hai kiểu: 4 màn dùng `EmptyState`, còn accounts/catalog nhét `<tr><td>` thô | `accounts-screen.tsx`, `catalog-screen.tsx` |
| S2 | Badge "Dự phòng" (`spare: 'plain'`) không có tone màu → hiện ra như ô trống giữa cột có màu | `features/devices/device-types.ts` |
| S3 | Break-glass bị kẹp giờ nhưng toast không nói số giờ thật đã kẹp | `ui/vault-panel.tsx` |
| S3 | Copy sai cơ chế: `tierNote_whitelist` nói "vẫn phải gõ mã mỗi lần", thực tế có grace 10 phút | `locales/vi.ts` |
| S3 | Lúc hiện mật khẩu không nhắc "lượt xem này đã được ghi nhật ký" | `ui/reveal-dialog.tsx` |
| S3 | Cột số không canh phải (`.num` chưa dùng ở đâu): "Chỗ dùng" 3/10, "Số U" | `software-screen.tsx`, `catalog-screen.tsx` |
| S3 | 9 lớp CSS nữa được gọi mà không có luật: `.cell-sub`, `.is-planned`, `.lead`, `.lead-col`, `.load-error`, `.req`, `.row-no`, `.pick`, `.temp-password`, `.totp-qr` | rải rác `ui/`, `features/` |
| S3 | `.ims`, `.shell-root` là lớp rỗng; `--z-sticky`/`--z-dropdown` khai mà không dùng; 6 rgba hover-tối + 4 scrim nên gom thành token | `app-shell.tsx`, `tokens.css`, `shell.css`… |
| S3 | Sidebar không bọc `<nav>`/landmark điều hướng | `shell/app-shell.tsx` |
| S3 | Command palette: 231 dòng CSS chết, chưa có component, chưa khai registry | `css/command-palette.css` |

## 4. Ba việc đang làm tốt (giữ)

1. **Kỷ luật token màu**: 0 hex ngoài `tokens.css` trong toàn bộ `web/src`; trạng thái ok/warn/danger
   trên nền soft đều đạt AA ở cả hai theme; badge luôn có chấm + chữ, không phân biệt chỉ bằng màu.
2. **Không có `window.confirm/alert` nào**, không dialog tự dựng trong `features/`; `ExpiryBadge` là
   nguồn luật duy nhất tính hạn; phân trang/export/format ngày đều dùng bản dùng chung đúng registry.
3. **`RevealDialog` xử lý đúng bài toán "2 giờ sáng"**: đếm ngược neo theo mốc thời gian tuyệt đối
   (tab bị hãm nhịp vẫn đóng đúng lúc), chữ to giãn ký tự, cố ý không tự copy vào clipboard.

## 5. Việc kiểm thử cần đổi

Thêm một tầng test **hình học** cho khung, vì tầng `toBeVisible()` mù với loại lỗi này. Đã có:
`e2e/tests/shell.spec.ts` (desktop) và `e2e/tests/shell.mobile.spec.ts` (390px). Lưu ý cấu hình:
`playwright.config.ts` chỉ nạp `*.mobile.spec.ts` vào project `mobile-390` — đặt tên file sai là
bài kiểm 390px sẽ lặng lẽ không bao giờ chạy.

---

# Đợt 2 — soát chi tiết & bảng điểm (25/08/2026)

12 chuyên gia soi song song từng ngóc ngách: popup, nút, hover/con trỏ/focus, form, bảng,
phản hồi hệ thống, điều hướng & URL, chữ nghĩa & i18n, hệ thống thị giác + chế độ tối,
trạng thái biên, trợ năng, và một lượt soi giao diện thật bằng ảnh chụp trên stack đang chạy.

**Bản đọc được:** https://claude.ai/code/artifact/9ac81652-8adb-49c8-910e-bcf27363ae53

## Bảng điểm (thang: 0–3 chưa có/hỏng · 4–6 thô · 7–8 tốt · 9–10 mẫu mực)

| Hạng mục | Điểm |
| --- | --- |
| Trạng thái biên (đụng độ, hết phiên, dữ liệu bất thường) | 6,5 |
| Hover · con trỏ · focus | 6,5 |
| Chữ nghĩa & i18n | 6,5 |
| Hệ thống thị giác (chữ, khoảng cách, màu, dark mode) | 5,9 |
| Nút & hành động | 5,5 |
| Form & nhập liệu (9 form) | 4,9 |
| Bảng & mật độ dữ liệu (17 bảng) | 4,8 |
| Popup / hộp thoại (30 dialog) | 4,5 |
| Trợ năng (~40% tiêu chí WCAG 2.2 AA) | 4,4 |
| Điều hướng & URL | 3,9 |
| Phản hồi hệ thống | 3,8 |
| **Trung bình** | **5,2** |

Điểm của 8 hạng mục do chuyên gia phụ trách tự chấm kèm trọng số; ba hạng mục (hover, chữ
nghĩa, nút) do tổng hợp quy đổi từ phát hiện của họ theo cùng thang.

## Khuôn hình lặp lại: xây rồi không nối dây

Đây là kết luận chung của cả 12 báo cáo, quan trọng hơn từng điểm số riêng lẻ. Tài sản dùng
chung được viết tử tế, có khi khai cả vào `SHARED-REGISTRY.md`, rồi không màn nào dùng —
người sau nhìn vào tưởng đã có nên không làm lại:

`DataTable` (6 bảng chính vẫn tự dựng `<table>` tĩnh, không sort được) · `.skip-link`
(Tab qua 14 mục nav mỗi trang) · `.sheet-body` (29/30 dialog) · `.cell-note` · `.num` ·
`.active-filters` (không có nút xoá lọc) · command palette (231 dòng CSS, chưa có component) ·
`confirmLabel` (mọi hộp xác nhận đều ghi "Đồng ý") · `vault.requestReasonRequired` ·
`auth.stepUpValidFor` · `accounts.confirmResetTotp` · 4 khoá lịch sử thiết bị.

## Đã sửa trong đợt 2

| Lỗi | Sửa ở đâu |
| --- | --- |
| **S1** Form dài bị `.sheet{overflow:hidden}` cắt — đo thật ở 1366×768: hộp cao 722px, nút Lưu ở y=807, không cuộn tới được → **không thêm được thiết bị bằng chuột** | `css/form-layout.css` (`overflow-y: auto`) |
| **S1** `DatePicker` bắt Esc không `stopPropagation` → đóng lịch là đóng luôn form đang gõ. `TimeField` đã vá đúng cách từ trước, comment còn ghi "giống DatePicker" | `ui/date-picker.tsx` |
| **S3** `.is-planned` không có style → mục nav chưa mở trông y hệt mục thật, còn sáng lên khi rê chuột | `css/shell.css`, khoá `nav.plannedHint` |

## Còn lại — xếp theo (đau × rẻ)

1. **S1** Hết phiên giữa lúc gõ = mất trắng: `api-client.ts:60` hard redirect, không toast, không
   lưu nháp; `state.from` ghi ở `App.tsx:60` mà không nơi nào đọc lại.
2. **S1** Thiếu quyền hiện như hệ thống hỏng: 403 ở Accounts/Ma trận quyền rơi vào "Không tải
   được + Thử lại" vô hạn. Mẫu đúng có sẵn ở `vault-panel.tsx:148`.
3. **S2** Bấm hai lần ghi hai lần: hộp xác nhận đóng trước khi lệnh chạy, nút gốc không khoá
   theo `isPending` (7 chỗ; `accounts-screen.tsx` không có một chữ `isPending` nào).
4. **S2** Toast không nêu tên đối tượng (20/22 hành động) và 10 màn có nút trùng tên tuyệt đối
   với trình đọc màn hình.
5. **S2** Bộ lọc/trang/tab không vào URL — F5 hay gửi link là mất ngữ cảnh.
6. **S2** Sửa thiết bị không có optimistic lock: hai người sửa cùng lúc thì người lưu sau ghi đè
   âm thầm, cả hai đều thấy "Lưu thành công". Mẫu đúng có sẵn ở `approvals.service.ts:163`.
7. **S2** `.card`/`.dash-card` không có padding; `.dashboard` dùng `auto-fit` trong khi số thẻ
   đổi theo vai — nên 3 thẻ không đều. Mẫu đúng: `.profile-stat-grid`, `.stat-grid-5`.
8. **S2** Viền UI dưới ngưỡng WCAG 1.4.11 ở cả hai theme: `--border-2`/`--surface` = 1,7:1;
   viền cảnh báo `--border-warn/danger` = 1,2:1.
9. **S2** Drawer mobile (thêm ở đợt 1) chưa bẫy tiêu điểm; `photo-lightbox` khai `aria-modal`
   nhưng không có bẫy thật.
10. **S2** `TimePicker`/`TimeField` chạy ngoài thang chữ (10 cỡ px rời); 9 cỡ icon, 6 độ dày nét.

## Ba quyết định chờ chốt

1. Nút chính không đạt WCAG AA ở theme sáng (3,39:1 và 2,15:1) — làm đậm gradient hay đổi màu chữ?
2. Màn Két sắt cho Admin/SA — danh mục **tên gọi** toàn hệ thống (đề xuất, hợp FR-026) hay bảng
   giá trị (phải sửa FR-026)?
3. Dải IP: phân trang + siết prefix tối thiểu về /22 hay /24? Và `DataTable`: chuyển 6 màn sang
   dùng, hay gỡ khỏi registry?
