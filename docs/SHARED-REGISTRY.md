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
| `DataTable` | `ui/data-table.tsx` | **Mọi màn danh sách** (thiết bị, phần mềm, đường truyền, sắp hết hạn, tài khoản, danh mục) | Bảng tĩnh 3 dòng thì `<table class="table">` là đủ. Cột muốn sắp được PHẢI có `accessorKey` — cột chỉ có `id`+`cell` không bao giờ sắp được (bẫy TanStack). Danh sách CÓ phân trang thì bắt buộc `manualSorting` + sắp ở server: sắp client chỉ đảo chỗ trang đang xem |
| `Pagination`, `PAGE_SIZES` | `ui/pagination.tsx` | Mọi danh sách server-side `{items,total}` | Danh sách tải hết một lần. Truyền `onLimitChange` thì hiện ô chọn 10/20/50/100 — màn nào phân trang trên dữ liệu đã nằm sẵn trong bộ nhớ thì đừng truyền, đổi `limit` ở đó không có nghĩa gì. Đổi số dòng PHẢI kéo `limit` vào `queryKey`, không thì chọn xong màn hình đứng im |
| `Chevron` | `ui/chevron.tsx` | MỌI mũi tên: dropdown, lịch, caret bung dòng, phân trang, cột sắp xếp | Không viết ký tự `›` `‹` `▲` `▼` — chúng theo cỡ chữ nên ở 14px mảnh như dấu ngoặc, và đứng cạnh chevron SVG thì đọc ra hai hệ thống khác nhau. Luật `.chevron` nằm ở `css/base.css` (KHÔNG phải primitives.css) để `.fsel-caret`/`.combo-caret`/`.dp-trigger .chev` còn đè được kích thước riêng |
| `FilterBar` | `ui/filter-bar.tsx` | Thanh lọc phía trên danh sách | — |
| `PageHeader`, `FormSection`, `Field` | `ui/page-header.tsx` | Đầu trang + bố cục form | `columns={1\|2\|3}` sinh `data-columns`, và luật CSS cho nó nằm ở `css/form-layout.css`. **Từ 26/08/2026 thuộc tính này mới thật sự có tác dụng** — trước đó không có luật nào đọc nó nên mọi form rơi về `auto-fill`, số cột do bề rộng hộp quyết định chứ không phải do người viết chọn. Ô rộng hơn dùng `span={2\|3}`; ở lưới 3 cột thì `span={2}` là đúng hai cột, `span={3}` mới trải hết hàng |
| `ExpiryBadge` | `ui/expiry-badge.tsx` | Mọi chỗ hiển thị trạng thái hạn | Không tự so ngày rồi tự chọn màu |
| `WarrantyTimeline`, `warrantyProgress` | `ui/warranty-timeline.tsx`, `ui/warranty-progress.ts` | Bảo hành thiết bị · hạn license/SSL/tên miền · hợp đồng đường truyền | Đọc ngưỡng từ `expiryLevel()` nên thanh và badge không bao giờ nói khác nhau. Không có hạn → trả `null`, đừng vẽ thanh rỗng. Thiếu mốc đầu → thanh "chỉ có đích", KHÔNG bịa điểm bắt đầu |
| `DetailHeader`, `StatGrid`, `Stat`, `BlankFields` | `ui/detail-header.tsx` | Đầu MỌI trang chi tiết: thiết bị · phần mềm · tài khoản dịch vụ · đường truyền | Thay `PageHeader` + nút "Về danh sách" ở riêng trang chi tiết. Thứ đã nằm ở `StatGrid` thì **bỏ khỏi lưới bên dưới** — lặp hai chỗ cách nhau 40px là lỗi bản cũ. Mỗi trang chọn bốn chỉ số riêng (ISP là hotline, phần mềm là ghế). Mã hồ sơ **không** kèm nút chép (bỏ 28/08/2026): nó là tiêu đề trang, bôi đen chép được như mọi chữ khác, còn cái nút thì cắt hàng tiêu đề làm ba mảnh |
| `DisposeButton`, `useDispose` | `ui/dispose-button.tsx` | Đưa hồ sơ vào kho thanh lý: phần mềm (thiết bị dùng nút Thanh lý sẵn có) | MỘT khái niệm cho người dùng, bốn cái tên cho hệ thống (`retired`/`terminated`/`disabled`) — gọi đúng đường của MODULE CHỦ, không hợp nhất thành một cờ chung. **Không dùng cho tài khoản dịch vụ**: nó có đường riêng BẮT ghi lý do, bọc vào đây là mất phần quan trọng nhất. Trong menu ba chấm thì dùng bản HOOK `useDispose` (mục menu là dữ liệu `{label,onSelect}`, không phải component) — **cấm** chép lại phần hỏi-lại + gọi API |
| `RowActions`, `RowAction` | `ui/row-actions.tsx` | Cột "Thao tác" của MỌI bảng danh sách: phần mềm · danh mục · tài khoản · tài khoản dịch vụ · NAT · dải mạng · hồ sơ IP · port map · lịch gửi email · két sắt | Nút ba chấm, portal ra body, bàn phím theo chuẩn menu button. Việc `danger` TỰ ĐỘNG xuống cuối — đừng tự sắp lại. **KHÔNG dùng khi chỉ có MỘT việc** (danh sách thiết bị chỉ có "Sửa", panel giấy tờ chỉ có "Xóa"): menu một mục là thêm một cú bấm mà không giấu được gì. **KHÔNG dùng cho hành động CHÍNH của màn** — "Duyệt"/"Từ chối" ở màn phiếu duyệt, "Xem" ở két sắt: để nút chính bên ngoài, phần còn lại vào menu. Nhãn PHẢI kèm định danh dòng qua `common.actionsOf` |
| `CopyButton` | `ui/copy-button.tsx` | Serial, IP WAN, tên đăng nhập — những giá trị người ta dán thẳng vào terminal | **Không dùng cho giá trị secret** — két sắt cố ý không có nút chép (clipboard sống qua cả phiên đăng nhập) |
| `ExportXlsxButton` | `ui/export-xlsx-button.tsx` | FR-028 — xuất bảng đang xem | Không tự sinh file phía trình duyệt |
| `SchedulePicker`, `describeSchedule` | `ui/schedule-picker.tsx` | Luật gửi email định kỳ (FR-013), sinh kỳ phiếu (FR-029) | — |
| `Tabs`, `TabPanel` | `ui/tabs.tsx` | Màn Danh mục (2.1), trang chi tiết thiết bị (2.5) | Hai tab thôi thì cân nhắc hiện cả hai |
| `initialTab`, `useVisibleTab` | `ui/tabs.tsx` | Chi tiết thiết bị · phần mềm · tài khoản dịch vụ | Trang có tab CỐ ĐỊNH thì `initialTab` là đủ, khỏi `useVisibleTab`. Trang có tab hiện theo dữ liệu (Port map, Máy đang dùng) thì phải dùng CẢ HAI — và gọi `useVisibleTab` trước mọi nhánh `return` sớm, nó là hook |
| `useTabCounts` | `ui/tab-counts.ts` | Số bên phải nhãn tab của MỌI trang chi tiết ("Giấy tờ 3 · Két sắt 2"): thiết bị · phần mềm · đường truyền · tài khoản dịch vụ | Đếm ở WEB, không phải ở API: `vault.module` đã import `devices`/`software`/`service-accounts`, nên cho module chủ gọi ngược `vault.api` để đếm là vòng phụ thuộc và depcruise chặn (`no-circular`). Trả `undefined` (không phải 0) khi chưa biết hoặc không có quyền — nhãn đề "0" cho một két đầy là nói dối. Là hook: gọi trước mọi nhánh `return` sớm |
| `useOwnerAttachments`, `attachmentsKey` | `ui/attachment-panel.tsx` | Truy vấn giấy tờ của một chủ thể — panel dùng, `useTabCounts` dùng | Cấm khai lại truy vấn/khóa cache ở nơi khác: lệch một phần tử trong khóa là cùng một câu hỏi đi hai lượt mạng và cho hai con số khác nhau |
| `useOwnerSecrets`, `secretsKey` | `ui/vault-panel.tsx` | Truy vấn két + phán quyết quyền của một chủ thể — panel dùng, `useTabCounts` dùng | Giữ luật "được xem danh sách hay không" ở MỘT chỗ. Bản sao thứ hai sẽ quên `enabled: allowed` và mỗi lần mở trang chi tiết là một cú 403 cho Member không có quyền |
| `FilePicker` | `ui/file-picker.tsx` | Mọi chỗ chọn file: import danh mục/thiết bị, đính kèm | Không tự dựng `<input type="file">` trần |
| `ImportPreview` | `ui/import-preview.tsx` | Bảng đối chiếu TRƯỚC khi ghi của mọi màn import | Màn import nào cũng phải có bước này |
| `ImportDialog` | `ui/import-dialog.tsx` | Hộp thoại nhập Excel hai bước (đối chiếu → ghi): danh mục 2.1, thiết bị 2.6 | Không tự dựng luồng import riêng |
| `AttachmentPanel` | `ui/attachment-panel.tsx` | Giấy tờ đính kèm của MỌI chủ thể ĐÃ TỒN TẠI (`ownerType`/`ownerId`): thiết bị 2.3, đường truyền 3.3, phần mềm 3.1, tài khoản dịch vụ 0032, phiếu Epic 8, sự cố Epic 9 | Không tự viết upload riêng — sẽ quên luật "tải về, không mở inline". Thêm `ownerType` mới phải sửa **hai** đầu: union `AttachmentOwnerType` ở đây và whitelist `FILE_OWNER_TYPES` trong `api/src/modules/files/files.service.ts`; thiếu một bên là 400 lúc upload |
| `useAttachmentDraft`, `AttachmentDraftSection` | `ui/attachment-draft.tsx` | Giấy tờ chọn ngay trong form THÊM MỚI (chưa có id): thiết bị 2.2, phần mềm 3.1, đường truyền 3.3 | Giữ `File` trong bộ nhớ, hồ sơ lưu xong mới đẩy lên. `upload()` KHÔNG ném lỗi — bản ghi đã ghi xuống DB rồi, ném ra là màn hình báo "lưu thất bại" trong khi hồ sơ vẫn nằm đó; nó trả về danh sách câu lỗi để nơi gọi báo riêng. Form SỬA thì không dùng: tab Giấy tờ ở trang chi tiết mới là chỗ xem và xóa cả danh sách |
| `SecretStrengthMeter`, `checkSecretStrength` | `ui/secret-strength-meter.tsx`, `ui/secret-strength.ts` | Mọi ô nhập GIÁ TRỊ secret: cất secret, xoay mật khẩu, popup thêm tài khoản dịch vụ | CẢNH BÁO chứ không chặn, và đừng đổi thành chặn: phần lớn secret là mật khẩu của thiết bị NGOÀI đã có sẵn (Draytek, camera, NAS) — chặn cứng chỉ đẩy người dùng ghi mật khẩu thật vào ô Ghi chú, chỗ không mã hóa. Hàng rào thật cho mật khẩu ĐĂNG NHẬP IMS là `api/.../password-policy.ts` |
| `countdownTone` | `ui/countdown-tone.ts` | Đồng hồ đếm ngược của hộp hiện secret | Ngưỡng tính theo PHẦN TRĂM + sàn giây, vì cùng component đếm cả 60s (một secret) lẫn 600s (grace step-up) — "còn 10 giây" nói hai điều khác nhau ở hai thang đó |
| `VaultPanel` | `ui/vault-panel.tsx` | Két sắt của MỌI chủ thể (`ownerType`/`ownerId`): thiết bị 4.1, phần mềm 4.1, tài khoản dịch vụ 0032, và trang tổng `/vault` | Không tự dựng bảng secret riêng — mỗi bản tự viết là một lần có thể lỡ hiện giá trị ra bảng, và cấm thêm nút "xuất tất cả" ở bất kỳ đâu (FR-026) |
| `UsageBar` | `ui/usage-bar.tsx` | Thanh mức sử dụng: dải IP 5.1 (FR-020), seat license, ô bảng điều khiển Epic 7 | Ngưỡng màu 70/90 là quy ước ĐỌC, không phải tham số vận hành — đừng đưa vào `system_config` |
| `StepUpDialog` | `ui/step-up-dialog.tsx` | Hộp gõ TOTP mở quyền xem bí mật (FR-022): két sắt 4.2, break-glass Epic 6 | Không tự tính "còn trong grace hay chưa" ở client — cứ gọi việc, gặp `STEPUP_REQUIRED` thì mở hộp này rồi thử lại |
| `RevealDialog` | `ui/reveal-dialog.tsx` | Hiện một giá trị bí mật rồi tự ẩn sau `secret.reveal_seconds` | Cấm tự dựng hộp hiện secret: sẽ quên đếm ngược theo MỐC (tab nền bị hãm nhịp) và quên bỏ nút sao chép |
| `OtpInput` | `ui/otp-input.tsx` | Ô nhập mã 6 số: đăng nhập, enroll, step-up | Chuyển từ `features/auth/` sang `ui/` ở story 4.2 — `ui` không được import ngược vào `features` |
| `HistoryPanel` | `ui/history-panel.tsx` | Lịch sử nghiệp vụ (AD-13) | Nhật ký an ninh → màn Audit riêng |
| `DatePicker`, `DateTimePicker` | `ui/date-picker.tsx`, `ui/date-time-picker.tsx` | Mọi ô chọn ngày/giờ | Không dùng `<input type="date">` trần |
| `Loading`, `LoadError`, `EmptyState`, `NotFound` | `ui/load-state.tsx` | Mọi màn có fetch: phân biệt tải ≠ rỗng ≠ lỗi | — |
| `SuggestInput` | `ui/suggest-input.tsx` | Ô chữ CÓ gợi ý từ danh mục nhưng vẫn gõ tự do: "Người / bộ phận dùng" (IP 5.1, NAT 5.3, port map 2.4), "Nhà mạng" (ISP 5.4) | Dùng khi danh mục nên HƯỚNG chứ không được ép. Ô nào chỉ nhận đúng một mục trong danh sách thì dùng `Select`; ô nào là khóa ngoại thật thì dùng `Combobox` + id. Lưu ý: nó là `role="combobox"`, không phải `textbox` — bài kiểm phải bám đúng vai |
| `Select`, `Combobox`, `ThemeSwitch`, `PhotoLightbox`, `NavIcon` | `ui/` | Theo tên | `Combobox` chỉ mở menu SAU KHI người dùng chạm vào ô (focus/gõ/bấm mũi tên) — không tự bung lúc hộp thoại vừa hiện. Truyền `action` để ghim một dòng "＋ tạo mới" ở đầu menu (sổ NAT dùng cho "Thêm router mới") |
| Danh mục dùng chung | `/quan-tri/danh-muc` · `api/src/modules/catalog` | **Bảy** loại: site · tủ mạng · loại thiết bị · nhà cung cấp · **bộ phận** · **nhà mạng** · **dịch vụ/port** (ba loại sau từ migration 0028) | Ô nào lặp lại ở ≥2 màn thì khai vào đây, đừng để gõ tay. Thêm loại mới phải sờ **ba** chỗ: bảng dữ liệu, danh sách trắng `catalog_history_entity_check` (0030 — chỗ đã sập), và `CATALOG_ENTITIES`. Chỉ bốn loại gốc có sheet trong file mẫu Excel (`IMPORTABLE_ENTITIES`) |
| `PortChipsField` + `port-chips.ts` | `features/ipam/` | Ô nhập NHIỀU khoảng port dạng chip, mỗi chip một ✕ (form sổ NAT) | `parsePortChip` là bản đọc của `parsePortRange` phía API — sửa luật port phải sửa cả hai. Trả về MỘT hình dạng `{chip, reason}` chứ không phải union phân biệt bằng cờ `ok`: web không bật `strict` nên TS không thu hẹp được union theo boolean |
| `slot-paging.ts` | `features/ipam/` | Lọc + đếm + cắt trang cho bảng IP của một dải | Cắt trang Ở CLIENT là hợp lệ ĐÚNG VÌ `MIN_PREFIX = 24` chặn dải ở 254 host. Nới trần đó thì phải đẩy phân trang xuống server trước |
| `ServicePortPicker` | `features/ipam/service-port-picker.tsx` | DROPDOWN chọn dịch vụ/port đặt ngay dưới ô nhập port (sổ NAT, cả port ngoài lẫn port trong) | Chọn một dịch vụ ở ô PORT NGOÀI kéo theo cả giao thức — đó là ý nghĩa của nó. Ô port trong chỉ lấy số đầu dải (đích chuyển tiếp là một port duy nhất). Từ 26/08/2026 nó là dropdown chứ không còn là bảng luôn mở: hai ô port thành hai bảng chiếm quá nửa hộp thoại |
| Lưới ghế `.seat-list` | `css/primitives.css` | Khu bung dòng hiển thị "một dòng một bản ghi con": ghế license ở /phan-mem, phần mềm đang cài ở /thiet-bi | Lưới thẻ chứ KHÔNG phải `<table>` lồng: hàng bung nằm trong một ô của bảng cha, bảng lồng bảng thì cột trong ngoài giằng nhau và ở ≤960px bảng cha đã gập còn bảng con thì chưa. Mỗi ô phải có `data-label` — nhãn cột hiện qua `::before` khi lưới gập ở 390px |
| `SeatEndCell`, `SeatTerm` | `features/software/seat-cells.tsx` | Ô "hết hạn"/"kỳ hạn" của một ghế license: khu bung ở /phan-mem, khu bung ở /thiet-bi, tab Máy đang dùng | Ba chỗ này PHẢI trả lời giống nhau: ghế của license mua đứt mà chỗ ghi "—" chỗ ghi "Vĩnh viễn" là kiểu sai không ai báo lỗi |
| `AssignDialog` | `features/software/license-assignments-panel.tsx` | Gán license vào máy VÀ sửa kỳ hạn/chi phí của ghế đã gán | Một hộp cho cả hai vì các ô là MỘT BỘ (chi phí · hợp đồng · kỳ hạn · ghi chú). Truyền `seat` = chế độ sửa (khóa máy, PATCH). Đổi máy KHÔNG phải sửa ghế — phải gỡ rồi gán lại để lịch sử không mất một chặng |
| `AuthCard` | `features/auth/auth-card.tsx` | Màn ngoài shell (đăng nhập, TOTP, đổi mật khẩu) | Màn trong app → `AppShell` |
| `useDepartments` | `ui/use-departments.ts` | Danh sách bộ phận cho ô chọn: form NAT, panel port map, form tài khoản dịch vụ | Chuyển ra khỏi `features/ipam/` ngày 28/08 — hook hỏi dữ liệu của **catalog** mà lại nằm trong ipam, và bị 3 feature dùng (sai chủ ở cả hai chiều). Giữ nguyên `queryKey: ['catalog','lists']` để dùng chung cache với các màn khác |
| `AppShell` | `shell/app-shell.tsx` | Khung sidebar + topbar của mọi màn nghiệp vụ | Lớp bọc PHẢI là `app-shell` (lớp duy nhất có `display:flex`). Ở ≤900px sidebar thành drawer: mở bằng nút `.nav-toggle` trong topbar, tự khép khi chọn mục / bấm backdrop / Esc — màn mới không được tự dựng nút mở menu riêng |

## Logic dùng chung — `web/src/lib/`

| Tên | Đường dẫn | Dùng ở đâu | Ghi chú |
| --- | --- | --- | --- |
| `expiryLevel`, `expiryLabel`, `daysUntil` | `lib/expiry.ts` | **Luật "sắp hết hạn" duy nhất** của hệ thống | Tính theo ngày lịch, không theo 24 giờ |
| `nextStepPath` | `lib/me.ts` | Nơi DUY NHẤT quyết định bước tiếp theo của luồng đăng nhập | Màn không tự `navigate()` |
| `PATHS`, `LEGACY_ROUTES` | `lib/routes.ts` | **Nguồn duy nhất của mọi đường dẫn**: router, sidebar, mọi `<Link to>` | Cấm gõ chuỗi đường dẫn thẳng trong màn — đổi một đường mà sót một chỗ là link chết không lỗi nào báo. URL bằng tiếng Anh, giao diện vẫn tiếng Việt. Đường tiếng Việt cũ khai vào `LEGACY_ROUTES` để link đã ghim còn mở được; đường của luồng đăng nhập nằm ở `lib/me.ts` (`LEGACY_AUTH_ROUTES`) |
| `OWNER_PATH` | `lib/routes.ts` | Dựng link từ một cặp `(ownerType, id)`: kho thanh lý, khối "vừa thanh lý" và khối "két lâu chưa đổi" trên bảng điều khiển | Bốn loại của `SECRET_OWNER_TYPES`. `Record` bắt đủ khóa nên thiếu một loại là TS đỏ — chép tay ở từng màn thì chỗ quên hiện ra một link chết, không phải lỗi biên dịch |
| `DISPOSAL_KINDS`, `DISPOSAL_KIND_KEY` | `lib/disposal-kinds.ts` | Ba loại vào kho thanh lý + nhãn i18n: màn `/disposal` và khối "vừa thanh lý" trên bảng điều khiển | Khớp `DISPOSAL_KINDS` bên API — thêm loại thứ tư phải sửa cả hai đầu. Không để bản gốc trong `features/disposal/` rồi import chéo: thứ dùng ở ≥2 màn không thuộc về màn nào |
| `apiFetch`, `ApiError` | `lib/api-client.ts` | Mọi lời gọi API | Tự gắn CSRF; 401-phiên-chết mới đá về đăng nhập |
| `useMe`, `useApiMutation`, `errorMessage` | `lib/api.ts` | Query/mutation + đọc message lỗi tiếng Việt | Mutation tự làm mới `me` |
| `formatDateTime`, `formatDate`, `orDash` | `lib/format.ts` | Mọi chỗ hiện ngày giờ | Lưu UTC, hiện giờ VN |
| `formatMoney` | `lib/format.ts` | **Mọi chỗ hiện tiền**: chi phí ghế license (3.2), giá mua tài sản về sau | Tự ghép " ₫" chứ không dùng `style:'currency'` (bản vi-VN chèn dấu cách không ngắt). `null` ra dấu gạch, KHÔNG ra "0 ₫" — "chưa khai" khác "được tặng" |
| `downloadFile` | `lib/download-file.ts` | Tải file giữ đúng tên | — |
| `sortQuery` | `lib/sort-query.ts` | Nối `?sort=&dir=` từ trạng thái sắp xếp của `DataTable` | Không màn nào tự ghép chuỗi này. Phía API có cửa đối ứng: `parseSortQuery` trong `api/src/common/sorting.ts`, luôn kẹp về whitelist cột của module chủ |
| `uploadFile` | `lib/upload.ts` | Gửi file lên endpoint multipart | Không tự đặt `Content-Type` (mất boundary) |
| `CATALOG_ENTITIES`, `CatalogLists`, `SiteRow`, `CabinetRow`, … | `lib/catalog-types.ts` | Hợp đồng kiểu của danh mục — dùng ở 10 file thuộc `devices`, `ipam`, `isp`, `software`, `catalog` | Chuyển ra khỏi `features/catalog/` ngày 28/08: thứ bị 5 feature dùng thì không thuộc về feature nào (AD-15). Khớp `CatalogEntity` phía API — thêm loại danh mục phải sửa cả hai đầu |
| `DeviceRow`, `DeviceStatus`, … | `lib/device-types.ts` | Hợp đồng kiểu của thiết bị — dùng ở `isp/isp-form`, `software/license-assignments-panel`, `devices` | Chuyển ra khỏi `features/devices/` ngày 28/08, cùng lý do trên |
| Token màu | `css/tokens.css` | **Nguồn màu duy nhất** | Cấm hex ngoài file này |

## Hạ tầng API — `api/src/common/` và module nền

| Tên | Đường dẫn | Dùng ở đâu | Khi nào KHÔNG dùng |
| --- | --- | --- | --- |
| `EnvelopeCryptoService` | `common/crypto/envelope.service.ts` | Mọi thứ cần mã hóa: TOTP secret, két sắt (Epic 4) | Cấm tự gọi `createCipheriv` (eslint chặn) |
| `MasterKeyRing` | `common/crypto/master-key-ring.ts` | Chùm chìa + xoay version | — |
| `ExcelExportService` | `common/excel/excel-export.service.ts` | FR-028 — mọi bảng; `buildWorkbook` cho file nhiều sheet | Cấm import `exceljs` trực tiếp (eslint chặn) |
| `ExcelImportService` | `common/excel/excel-import.service.ts` | Nơi DUY NHẤT ĐỌC file xlsx (import danh mục 2.1, thiết bị 2.6) | Trả chuỗi thô; hiểu nghĩa là việc của lõi `plan*Import` thuần |
| `requireXlsx`, `sendXlsx`, `XLSX_UPLOAD_LIMIT` | `common/excel/xlsx-http.ts` | Endpoint nhận/gửi file xlsx (danh mục, thiết bị, và mọi màn export sau này) | Không copy hàm kiểm magic-byte ra controller riêng |
| `import-plan.ts` (`pickCell`, `parseDateCell`, `normalizeKey`…) | `common/import-plan.ts` | Nền chung của MỌI bộ import: khớp tên cột, đọc ngày kiểu VN, nhận dòng VÍ DỤ | Không tự viết lại parser cột/ngày cho từng màn |
| `parsePageQuery`, `Page<T>` | `common/pagination.ts` | Mọi endpoint danh sách | Shape trả về luôn là `{ items, total }` |
| `Tx`, `WriteFn` | `common/tx.ts` | Mọi hàm ghi (AD-5) | `tx` là tham số đầu, không dùng ALS |
| `ExpirySource` + `ExpirySourceRegistry` (@Global) | `common/expiry/` | Module có ngày hết hạn tự gọi `register(this)`; engine chỉ đọc sổ (AD-7) | Vault KHÔNG đăng ký (AD-4) |
| `isoDateInTz`, `addDays`, `daysBetween` | `common/today.ts` | "Hôm nay" theo múi giờ ứng dụng | Cấm `new Date().toISOString()` để lấy ngày — lệch một ngày suốt buổi sáng giờ VN |
| `DevicePanelRegistry` (+ `DevicePanelsModule` @Global) | `common/device-panels.registry.ts` | Module chủ gọi `register(this)` lúc khởi động để góp một khu vào trang thiết bị | Đặt sổ này trong `devices` là mọi module góp panel phải chạm nội bộ `devices` (AD-2) |
| `DevicePanelProvider` | `common/device-panels.ts` | Module muốn góp một khu vào trang chi tiết thiết bị (IP, license, secret, phiếu) | Cấm `devices` import thẳng module đó (AD-2) |
| `readSecretFile` | `common/secrets.ts` | Đọc docker secret | Cấm đọc bí mật từ env (AD-11) |
| `GlobalExceptionFilter` | `common/global-exception.filter.ts` | Một shape lỗi cho toàn API | — |
| `@Audited` + `AuditInterceptor` | `modules/audit/` | Mọi endpoint ghi (AD-9) | — |
| `@Roles` + `RolesGuard` | `modules/auth/roles.*` | Mọi controller — thiếu là bị chặn (AD-9) | Route công khai phải khai `@Public()` |
| `@RequiresStepUp()` + `StepUpGuard` | `modules/auth/step-up.guard.ts` | Route đòi vừa gõ TOTP xong: mở két 4.2, break-glass Epic 6 | Cấm viết `if (steppedUpAt…)` trong service — mỗi chỗ tự viết là mỗi chỗ có thể quên, và cái quên đó không làm test nào đỏ |
| `SessionGuard`, `CsrfGuard` | `modules/auth/` | Toàn cục | — |
| `PasswordService` | `modules/auth/password.service.ts` | Băm/kiểm mật khẩu | Cấm import `@node-rs/argon2` nơi khác |
| `TotpService` | `modules/auth/totp.service.ts` | TOTP + chống replay | — |
| `SystemConfigService` | `modules/config-sys/` | Mọi ngưỡng vận hành (AD-11) | Cấm hardcode hằng số nghiệp vụ |
| `OutboxService` | `modules/outbox/` | Mọi email/sự kiện (AD-5) | Cấm gọi `nodemailer` trong request |
| `MailTransportService`, `renderMail` | `modules/mail/` | Nơi duy nhất gửi và dựng HTML email | — |
| `UsersApiService` | `modules/users/users.api.ts` | Module khác cần dữ liệu user (AD-2) | Cấm query bảng `users` từ module khác |
| `CatalogApiService` | `modules/catalog/catalog.api.ts` | `devices` và mọi module cần site/tủ/loại/NCC | Cấm query bảng `site`/`cabinet`/`device_type`/`vendor` |
| `FilesApiService` | `modules/files/files.api.ts` | Module khác hỏi "chủ thể này có file gì" (AD-2) | Cấm query bảng `file` từ module khác |
| `DevicesApiService` | `modules/devices/devices.api.ts` | ipam/vault/software/phiếu tham chiếu thiết bị | Cấm query bảng `device` từ module khác |
| `VaultApiService` | `modules/vault/vault.api.ts` | Module khác hỏi "chủ thể này có mấy secret, tên gì" (AD-2/AD-4); `listOwners()` cho khối "két lâu chưa đổi" của bảng điều khiển | CỐ Ý không có hàm trả plaintext — muốn mở két phải đi endpoint riêng có TOTP step-up (4.2); cấm mọi module khác chạm bảng `secret`. Danh sách hàm bị `vault-surface.spec.ts` ghim: thêm hàm phải sửa bài kiểm VÀ ghi lý do. `listOwners()` không tự gác vai — bên gọi phải tự giới hạn SA/Admin |
| `IpamApiService` | `modules/ipam/ipam.api.ts` | Module khác hỏi "thiết bị này có IP gì" (AD-2): panel IP 5.4, sổ NAT 5.3, bảng điều khiển 7.1, phiếu bàn giao Epic 8 | Cấm query bảng `subnet`/`ip_address` từ module khác. `listSubnets()` trả TẤT CẢ dải kèm `percent` — ngưỡng "thế nào là sắp đầy" là luật của bên gọi, không nhét tham số lọc vào đây |
| `DisposalApiService` | `modules/disposal/disposal.api.ts` | Bảng điều khiển hỏi "vừa bỏ những gì" (AD-2) | Cấm tự hỏi ba module rồi tự gộp lại — bản gộp thứ hai sẽ thiếu một loại đúng hôm có ai thêm loại thứ tư, và không test nào đỏ |
| `ApprovalKindRegistry` (@Global) + `ApprovalFlow` | `common/approvals/` | Loại yêu cầu tự mang máy trạng thái của mình tới (AD-6): break-glass 6.3, phiếu ISO Epic 8, sự cố Epic 9 | Đặt sổ trong module `approvals` là mọi module muốn đăng ký phải chạm ruột nó — đúng lỗi depcruise bắt ở Epic 2 |
| `ApprovalsApiService` | `modules/approvals/approvals.api.ts` | Tạo yêu cầu, chuyển trạng thái, hỏi "grant còn hiệu lực không" | Cấm query bảng `approval` từ module khác; cấm UPDATE `state` ngoài `transition()` (AD-6) |
| `isGrantActive` | `common/approvals/approval-flow.ts` | MỌI đường đọc có kiểm quyền tạm thời | Cấm tin `status`; hiệu lực tính bằng `expires_at > now()` tại mỗi lần đọc (AD-6) |
| `AccessListService.tierFor` | `modules/vault/access-list.service.ts` | Trả lời "người này có tầng gì trên đối tượng kia" — story 6.3 xoay quanh hàm này | Cấm tự suy quyền ở nơi khác; CẤM là mặc định (AD-9 áp vào dữ liệu) |
| `BreakGlassService.assertCanReveal` | `modules/vault/break-glass.service.ts` | Hàng rào ở MỌI đường đọc secret của Member (story 6.3) | Gọi tại MỖI lần đọc, cấm cache vào phiên — hiệu lực tính bằng đồng hồ (AD-6) |
| `DashboardService` | `modules/dashboard/` | Module ĐỌC thuần, không sở hữu bảng nào — gom số liệu qua public api của module chủ | Cấm tuyệt đối JOIN chéo ở đây: dashboard mà chạm bảng của mọi module thì không module nào đổi được lược đồ nữa (AD-2) |
| `IpDevicePanel`, `NatDevicePanel` | `modules/ipam/*-device-panel.ts` | Cắm khu IP và khu NAT vào trang thiết bị (story 5.3/5.4) qua `DevicePanelRegistry` | `devices` KHÔNG được import ipam — chiều phụ thuộc chỉ đi một hướng (AD-2) |

## Cách CI ép luật (không trông vào review)

Cổng chia hai nơi (quyết định 03/09):

- **GitHub Actions** (`.github/workflows/ci.yml`) — lint · depcruise · test đơn vị · build.
  Đây là cổng **tự động** chặn merge vào `master` qua branch protection.
- **Máy nội bộ** (`bash ops/ci-local.sh --e2e`) — E2E Playwright trên docker compose thật.
  E2E cần dựng cả stack nên chạy ở đây nhanh hơn và không ăn hạn mức Actions của repo private.

Đánh đổi phải biết: **E2E không còn là cổng tự động.** Thứ duy nhất giữ nó sống là luật đóng
epic trong `CLAUDE.md` — `--e2e` phải xanh trước khi chuyển story sang `done`. Nếu nếp đó trôi,
cách rẻ nhất để đóng lại là một self-hosted runner trong LAN rồi bỏ comment job `e2e`.

| Luật | Công cụ | Chạy bằng |
| --- | --- | --- |
| Đồ thị module acyclic, cấm import nội bộ xuyên module (AD-2) | dependency-cruiser | `npm --prefix api run depcruise` |
| Cấm `exceljs`/`nodemailer`/`argon2`/`createCipheriv` ngoài chỗ được phép (AD-15) | eslint `no-restricted-imports` / `no-restricted-syntax` | `npm --prefix api run lint` |
| Bảng `secret` chỉ dùng trong module `vault` (AD-4) | dependency-cruiser luật `secret-table-only-in-vault` | `npm --prefix api run depcruise` |
| Không có đường xuất toàn bộ két ở mọi quyền (FR-026) | Jest `vault-surface.spec.ts` + E2E `vault.spec.ts` | `npm --prefix api test` / `npm run test:e2e` |
| Sổ NAT chỉ có MỘT câu trả lời cho mỗi port | `EXCLUDE USING gist` (migration 0022) + `protocolsOverlap` ở service | `npm run test:e2e` |
| IP trong sổ NAT phải là MÁY, không phải địa chỉ mạng/quảng bá | `hostRole` ở `ip-rules.ts`, gọi trong `validateNatRule` | `npm --prefix api test` / `npm run test:e2e` |
| Chi phí ghế license không lặng lẽ sai chữ số cuối | `validateAssignmentTerms` chặn quá `Number.MAX_SAFE_INTEGER` (cột là bigint) | `npm --prefix api test` |
| Mở két phải step-up + `no-store` + một id mỗi lần (FR-022) | Jest `vault-surface.spec.ts` + E2E `vault-reveal.spec.ts` | `npm --prefix api test` / `npm run test:e2e` |
| Cấm hex màu ngoài `tokens.css` | rà bằng `grep -rE "#[0-9a-fA-F]{3,8}" web/src --include=*.css` | `.github/workflows/ci.yml` job `web` (chưa bắt `rgba()` — 23 chỗ đang lách, xem CODE-REVIEW F-FE-03) |
| **Luật AD-2 còn SỐNG** (không khớp 0 chuỗi như bản glob cũ) | Jest `api/src/ad2-boundary.spec.ts` — 36 ca, chốt cả "phải bắt" lẫn "phải cho qua" | `npm --prefix api test` |
| Mỗi bảng một chủ: chỉ module sở hữu import `*.schema.ts` của nó (AD-3) | dependency-cruiser luật `schema-only-in-owning-module` | `npm --prefix api run depcruise` |
| **Một feature web không import ruột feature khác** (AD-15) | oxlint `no-restricted-imports` trong `web/.oxlintrc.json` | `npm --prefix web run lint` |
| Tầng nền web (`ui`/`lib`/`shell`) không import ngược vào `features` | oxlint `no-restricted-imports`, override theo thư mục | `npm --prefix web run lint` |
| Cấm `window.confirm` / `window.alert` phía web | oxlint `no-restricted-globals` | `npm --prefix web run lint` |
| Argon2 + pepper làm đúng việc (pepper sai ⇒ mật khẩu đúng phải trượt) | Jest `password.service.spec.ts` | `npm --prefix api test` |
| Rate-limit đăng nhập theo IP là THẬT, không phải mock | E2E `login-rate-limit.spec.ts` (mượn trần rồi trả lại) | `npm run test:e2e` |
| `audit_log` chỉ-thêm kể cả với TRUNCATE (NFR-03) | migration `0039` (trigger cấp câu lệnh) + E2E `audit-log.spec.ts` | `npm run test:e2e` |
