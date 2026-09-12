# Rà soát UI/UX — IMS · 12/09/2026

Rà toàn bộ `web/src/` (204 file) + tầng DTO của API. **Không lặp lại** 10 lỗi ở
`BIEN-BAN-TEST-TAY-2026-09-12.md`.

> **Bảng theo dõi nằm ngay dưới đây, trong CHÍNH file này** — cố ý không tách ra file riêng.
> Hai file phải giữ đồng bộ bằng tay thì sớm muộn lệch nhau, và bản lệch là bản người đọc tin.
> Sửa xong một mục thì tick vào bảng, ngay cạnh phần mô tả của nó.

## Bảng theo dõi — 39 mục

**Xong 11 · Làm một phần 1 · Còn lại 27.**

Đợt A xong 12/09, đã lái tay qua trình duyệt thật (biên bản:
`docs/BIEN-BAN-TEST-TAY-DOT-A-2026-09-12.md`). Đợt B và C xong 12/09.

Cột **Kiểm**: `✓` = tôi đã tự mở code xác minh lại, không chỉ tin báo cáo. **13 mục** đã kiểm —
#10 và #20 kiểm thêm trong lúc chờ E2E của đợt A, và cả hai đều đúng như bản rà soát mô tả.
Cột **Đợt**: nhóm đã đề xuất làm cùng nhau — xem "Thứ tự đề xuất" ở cuối file.

| # | Mục | Mức | Kiểm | Đợt | Xong |
|---|---|---|---|---|---|
| 1 | Bảng điều khiển in mã máy tiếng Anh (`warranty`, `license`) | cao | ✓ | — | **[x]** `d016847` |
| 2 | Két sắt + Duyệt yêu cầu mù loại "Đường truyền" — 3 hỏng cùng gốc | cao | ✓ | A | **[x]** đợt A |
| 3 | Mật khẩu tạm: một phím Esc là mất vĩnh viễn | cao | ✓ | — | **[x]** `d016847` |
| 4 | "Thu hồi sớm" cắt quyền đang chạy, không hỏi lại | cao | ✓ | B | **[x]** đợt B |
| 5 | Câu lỗi tiếng Anh lọt ra giao diện (354/434 validator + lỗi 500) | cao | ✓ | C | **[x]** đợt C |
| 6 | `LoadError` vứt câu giải thích của API — 38 chỗ gọi | cao | ✓ | A | **[x]** đợt A |
| 7 | Nhãn lịch sử: mã thao tác không có nhãn + 123 nhãn cứng | cao | ✓ | D | **[~]** `d016847` |
| 8 | 15/19 hộp xác nhận đội tiêu đề trống "Xác nhận" | cao | — | D | [ ] |
| 9 | Tiêu đề hộp sửa chỉ một chữ "Sửa" (dùng chung cho 7 tab danh mục) | cao | — | D | [ ] |
| 10 | Đóng hộp giữa chừng là mất trắng; 8 hộp thiếu hẳn `dismissible` | cao | ✓ | B | **[x]** đợt B |
| 11 | Câu lỗi hiện ra là cái NHÃN của ô ("Hết hạn") | vừa | — | D | [ ] |
| 12 | Ba form gốc, ba câu lỗi cứng khác nhau, hiện ngoài màn hình | vừa | — | D | [ ] |
| 13 | Hint ô "Tủ mạng" nói "Không nằm trong tủ" | vừa | — | D | [ ] |
| 14 | Viết tắt và tiếng lóng: NCC · SA · "đá phiên" · "Cửa sổ" · pool | vừa | — | D | [ ] |
| 15 | Chữ "epic" hiện ở 3 nơi người dùng nhìn thấy | vừa | — | D | [ ] |
| 16 | Nút "Mở khóa" hiện trên tài khoản đang bị **vô hiệu hóa** | vừa | ✓ | A | **[x]** đợt A |
| 17 | Kho thanh lý báo "đang trống" khi chỉ là lọc không ra | vừa | — | D | [ ] |
| 18 | Tiêu đề hứa "cả hệ thống" nhưng đường truyền không vào kho được | vừa | — | D | [ ] |
| 19 | "Gửi thử" bắn email THẬT cho người nhận, không hỏi lại | vừa | ✓ | B | **[x]** đợt B |
| 20 | Ba việc không hoàn tác được mà không một chữ cảnh báo | vừa | ✓ | B | **[x]** đợt B |
| 21 | Nút nguy hiểm sát nút hay bấm nhất, và đổi nghĩa tại chỗ | vừa | — | D | [ ] |
| 22 | Nút mờ không nói vì sao (5 chỗ) | vừa | — | D | [ ] |
| 23 | `Field` giấu gợi ý đúng lúc người dùng cần nó nhất | vừa | — | D | [ ] |
| 24 | Dấu `*` có hai hành vi khác nhau; 4 màn `auth/` không có dấu nào | vừa | — | D | [ ] |
| 25 | Từ vựng lệch: Seat/ghế · Máy/Thiết bị · Gỡ/Xóa/Thu hồi · … | vừa | — | D | [ ] |
| 26 | `stateDenied: 'Từ chối'` lệch thì với 5 khóa anh em | nhẹ | — | D | [ ] |
| 27 | Giá trị trống ghép thành cụm vô nghĩa ("— giờ") | nhẹ | — | D | [ ] |
| 28 | Nút nhấn mạnh rơi vào "Đóng", việc thật thành nút xám | nhẹ | — | D | [ ] |
| 29 | Nhãn "IP WAN" mà nút chép ghi "Chép IP tĩnh" | nhẹ | — | D | [ ] |
| 30 | `railTitle: 'Subnet / VLAN'` — tiếng Anh ở tiêu đề cột | nhẹ | — | D | [ ] |
| 31 | "auditor" trong câu văn tiếng Việt (2 chỗ) | nhẹ | — | D | [ ] |
| 32 | "Chưa có dữ liệu" dùng cho hộp "Phiên đang mở" | nhẹ | — | D | [ ] |
| 33 | `emptyText` ghép máy móc hai câu hoàn chỉnh bằng gạch ngang | nhẹ | — | D | [ ] |
| 34 | "Sửa trong hồ sơ" nằm ở cột Thao tác, trông như nút hỏng | nhẹ | — | D | [ ] |
| 35 | "Ghi chú" in hai lần chồng nhau | nhẹ | — | D | [ ] |
| 36 | 46 khóa chết trong `vi.ts` | nhẹ | — | D | [ ] |
| 37 | `toast` dùng `aria-live="polite"` cho cả thông báo lỗi | nhẹ | — | D | [ ] |
| 38 | Nội dung toast đến thẳng từ server, không qua `t()` | nhẹ | — | D | [ ] |
| 39 | 17 placeholder ví dụ viết cứng | nhẹ | — | D | [ ] |

### Mục 7 vì sao là `[~]` chứ không `[x]`

Đã làm: khai hai nhãn thiếu (`port-unlinked`, `device-detached` — cả hai do bản vá nhóm 3
đẻ ra), và dựng cửa điểm danh `web/src/features/history-action-rollcall.test.ts` đọc thẳng
mã nguồn API nên lớp lỗi này không tái diễn âm thầm được nữa.

CHƯA làm: dời 123 nhãn viết cứng vào `vi.ts`. Chúng đã là tiếng Việt và hiện đúng; dời đi
là thay đổi cơ học trên 7 file có sẵn bài kiểm mà người dùng không thấy khác gì.

### Thứ tự đề xuất

- **Đợt A — #2, #6, #16.** Cùng một lớp lỗi: hệ thống nói một đằng làm một nẻo. #2 có một
  link dẫn sang trang SAI trên chính màn bản-đồ-bí-mật; #6 làm 403, 404, mất mạng và máy
  chủ sập ra cùng một câu; #16 gọi sai tên việc ở màn quản trị tài khoản.
- **Đợt B — #4, #19, #10, #20.** Hàng rào cho việc phá và việc không hoàn tác được.
- **Đợt C — #5.** Quét ngôn ngữ. ~349 validator thiếu `message`. Cơ học và lớn, nên làm
  một lượt riêng kèm một cửa canh chứ không sửa tay từng chỗ.
- **Đợt D — phần còn lại.** Nhất quán, nhãn, từ vựng. Thật, nhưng không ai làm sai việc vì
  chúng.

## MỨC CAO

### 1. Bảng điều khiển in mã máy tiếng Anh
`features/dashboard/dashboard-screen.tsx:123` gọi `t("expiry.kind_" + item.kind, item.kind)`.
`locales/vi.ts` KHÔNG có khóa `expiry.kind_*` nào (chỉ có 3 khóa `vault.kind_*` ở dòng 642-644),
nên i18next rơi về chính mã: mỗi dòng đọc ra `warranty · 21/09/2026`, `license · 27/08/2026`.
Màn `/expiry` làm đúng qua `kindLabel()` (`expiry-screen.tsx:78`) lấy nhãn từ API.
**Sửa**: dùng lại `GET /expiry/kinds`, hoặc khai 7 khóa `expiry.kind_warranty/license/ssl/domain/maintenance/isp/other`.

### 2. Két sắt và Duyệt yêu cầu không biết loại "Đường truyền" — 3 hỏng cùng gốc
`features/vault/vault-home-screen.tsx:14` khai `OwnerType` chỉ có `device | software | service_account`,
trong khi API có BỐN (`api/src/modules/vault/vault.service.ts:24` — thêm `isp`), và `isp-detail.tsx:218`
render hẳn `<VaultPanel ownerType="isp">`. Hậu quả khi cất mật khẩu vào đường truyền:
(a) cột "Loại" trống (`OWNER_LABEL['isp']` undefined); (b) bật chip lọc bất kỳ → dòng ISP biến mất im lặng;
(c) "Mở hồ sơ đầy đủ" dẫn sang trang PHẦN MỀM với id đường truyền (nhánh vét `:39`).
Cùng gốc ở `approvals-screen.tsx:184`: `vi.ts` chỉ có `subject_device`/`subject_software`.
**Sửa**: dùng `Record<SecretOwnerType, string>` như `lib/disposal-kinds.ts:16` đã làm — ở đó thiếu nhãn là lỗi biên dịch.
**ĐÃ VÁ (đợt A)**: gom cả BỐN bản chép tay về `web/src/lib/secret-owner-kinds.ts` (`SECRET_OWNER_TYPES` ·
`SecretOwnerType` · `SECRET_OWNER_KIND_KEY`), khai vào sổ AD-15. Trang tổng két nay duyệt thẳng
`SECRET_OWNER_TYPES` để sinh nút lọc (thêm loại là tự có nút), và dùng `OWNER_PATH` thay chuỗi `if`
tự dựng nên "Mở hồ sơ đầy đủ" hết dẫn nhầm. `ApprovalRow.subjectType` đổi từ `string` sang
`SecretOwnerType` — đó mới là chỗ bản cũ lọt. Khóa dịch dồn về namespace trung tính `ownerKind.*`;
`vaultHome.kind*` và `approvals.subject_*` xóa hẳn, kèm ba khóa chết `vaultHome.devices/software/serviceAccounts`.
Cửa canh: `web/src/lib/secret-owner-rollcall.test.ts` đọc thẳng `vault.service.ts` bên API rồi so danh sách.

### 3. Mật khẩu tạm: một phím Esc là mất vĩnh viễn
`features/admin/accounts-screen.tsx:377` — `<Dialog>` KHÔNG truyền `dismissible={false}`
(mặc định `ui/dialog.tsx:31` là `true`). Chính nội dung hộp ghi "Hệ thống sẽ không hiển thị lại"
nhưng hộp đóng dễ nhất trong cả app. Không có nút Sao chép. Tiêu đề không nêu tài khoản nào.

### 4. "Thu hồi sớm" cắt quyền đang chạy, không hỏi lại
`features/vault/approvals-screen.tsx:236` — đi thẳng vào `revoke.mutate()`. Là hành động phá DUY NHẤT
trong cụm Két sắt không qua `askConfirm({ danger: true })` (so với `access-matrix-screen.tsx:118`
và `ui/vault-panel.tsx:316` đều có).
**ĐÃ VÁ (đợt B)**: qua `askConfirm({ danger: true })`, và câu hỏi nói rõ thứ đang bị cắt —
*"Quyền này ĐANG chạy — nếu họ đang mở két giữa lúc xử sự cố thì lượt xem kế tiếp bị chặn."*
Bài E2E chốt cả vế phủ định: mới mở hộp hỏi lại thì `approval.state` PHẢI còn `approved` —
một bản vá dựng hộp lên rồi vẫn gọi API ngay cũng làm vế khẳng định xanh.

### 5. Câu lỗi tiếng Anh không chỉ ở break-glass
`api/src/modules/ipam/ipam.controller.ts:110` `internalPort` không có `message`; ô "Port trong"
(`nat-screen.tsx:608`) không kiểm gì phía web. Gõ `99999` → `internalPort must not be greater than 65535`.
Ô "Port ngoài" CÙNG FORM lại báo tiếng Việt (`vi.ts:829`). Hai ô cạnh nhau, hai ngôn ngữ.
Toàn hệ (đo lại 12/09): **80 `message:` trên 434 validator** trong `*.controller.ts` — tức ~354
validator câm, nhiều hơn con số 81/237 mà lượt rà đầu ước.
Thêm: `api/src/common/global-exception.filter.ts:105` trả `'Internal server error'` cho mọi 500,
và `lib/api.ts:11` bê thẳng vào toast. LƯU Ý khi vá: chuỗi đó CỐ Ý chung chung để không lộ nội
bộ (đọc chú thích ngay trên nó) — dịch sang tiếng Việt thì giữ nguyên tính chất ấy, đừng thêm
chi tiết kỹ thuật vào.

**ĐÃ VÁ (đợt C) — và KHÔNG bằng cách đi gõ 354 câu `message`.**

Gõ tay 354 câu là bản vá cho HÔM NAY: cửa vẫn mở mặc định, nên người viết DTO thứ 435 quên
`message` thì lại lọt một câu tiếng Anh và không có gì đỏ. Thay vào đó, `ValidationPipe` nhận
một `exceptionFactory` đi qua `api/src/common/validation-messages.ts` — mọi validator, kể cả
cái viết năm sau, đều ra tiếng Việt mà không cần ai nhớ gì. DTO nào có câu riêng thì câu đó
vẫn THẮNG: nó biết chuyện cụ thể, còn bản dịch chung chỉ biết tên trường và loại ràng buộc.

Cách phân biệt "câu mặc định" với "câu người viết": câu của class-validator TOÀN ASCII, câu
tiếng Việt của repo luôn có dấu. Đó là một quy ước, nên nó có cửa canh riêng — bài điểm danh
đọc mọi `message:` trong controller và đỏ nếu có câu nào không dấu.

Ví dụ đúng cái ô đã nêu ở trên, `internalPort` không khai `message`:
· trước: `internalPort must not be greater than 65535`
· sau:   `Port trong không được lớn hơn 65535.`

Các mốc (độ dài, min/max, danh sách cho phép) đọc NGƯỢC ra từ chính câu mặc định —
`ValidationError` chỉ đưa câu đã dựng, không đưa tham số decorator. Vì thế
`validation-messages.spec.ts` cho `ValidationPipe` THẬT chạy trên DTO mẫu rồi so câu đầu ra,
thay vì tin vào một giả định về thư viện: nâng cấp class-validator mà câu mặc định đổi chữ
thì chỗ đó đỏ ngay, kèm đúng câu sai.

Bốn cửa canh, ba trong số đó có sàn chống regex hụt:
· mọi loại ràng buộc đang dùng trong controller đều có bản dịch;
· mọi trường CÓ validator đều có nhãn tiếng Việt (`FIELD_LABEL`, 95 mục);
· mọi câu `message` khai tay đều có dấu;
· và vế bao trùm: không câu nào đi ra khỏi pipe mà còn là tiếng Anh.

Câu 500 cũng đã dịch, GIỮ NGUYÊN tính chung chung — `global-exception.filter.spec.ts` chốt
đúng chuỗi ấy để không ai "tiện tay" thêm chi tiết nội bộ vào.

### 6. `LoadError` vứt bỏ câu giải thích tiếng Việt mà API vừa gửi về (38 chỗ gọi)
`ui/load-state.tsx:63` — `LoadError({ onRetry })` KHÔNG nhận `error`, nên 403 / 404 / 500 / mất mạng
đều ra đúng một câu "Không tải được dữ liệu." + nút "Thử lại". `lib/api.ts:8 errorMessage()` đã có sẵn
câu tiếng Việt của API. Khóa `app.serverUnreachable` (`vi.ts:12`) là khóa chết, không nơi nào dùng.
(Con số 68 của lượt rà đầu là số LẦN xuất hiện chữ `LoadError`, tức đã đếm cả dòng `import`.
Đếm lại 12/09: **38 khối `<LoadError>` thật**, 36 trong đó ở màn, 2 trong bài kiểm.)
**ĐÃ VÁ (đợt A)**: `error` thành prop **bắt buộc** — để tùy chọn thì 38 chỗ gọi sẽ cứ thế bỏ qua như
suốt từ đầu dự án; bắt buộc thì mỗi chỗ là một lỗi biên dịch cho tới khi có người nối lỗi thật vào.
Bảng nguyên nhân → câu chữ tách ra hàm thuần `web/src/lib/load-error-text.ts` (có bảng test riêng):
câu của API đi trước, rồi 403 → thiếu quyền · 404 → không tìm thấy · ≥500 → máy chủ sự cố · không
phải `ApiError` → mất kết nối (`app.serverUnreachable` sống lại). 500 KHÔNG mượn câu của
`global-exception.filter.ts`: chuỗi đó cố ý chung chung, ta thay bằng câu tiếng Việt của mình và
không thêm chi tiết nội bộ. Khối lỗi thêm `role="alert"` — nó thay chỗ nội dung vừa biến mất.

### 7. 123 nhãn viết cứng ngoài i18n — và `port-unlinked` đang lọt ra màn Lịch sử
7 file map nhãn: `devices/device-history-entries.ts:12,31,42` · `software/software-history-entries.ts:10,28,39,47,52` ·
`service-accounts/service-account-history-entries.ts:10,24,31,36` · `isp/isp-history-entries.ts:6,21,27` ·
`ipam/nat-history-entries.ts:18,29` · `ipam/ip-history-entries.ts:23,45` · `ipam/ipam-types.ts:96` ·
`lib/expiry.ts:63-68`.

**Đã hỏng thật**: API ghi action `port-unlinked` (`api/src/modules/devices/port-device-retirement.ts:93`)
khi thanh lý máy có máy khác cắm vào, nhưng `device-history-entries.ts:31` không có khóa đó,
và mọi file kết bằng `?? row.action`. Mở tab Lịch sử của máy đầu kia là đọc thấy `port-unlinked`.
Đây là hệ quả trực tiếp của bản vá nhóm 3 (11/09) — chưa ai mở tab Lịch sử của máy còn lại.

### 8. 15/19 hộp xác nhận đội tiêu đề "Xác nhận"
`ui/confirm-provider.tsx:73` mặc định `t('app.confirmTitle')`. Không truyền `title`:
`accounts-screen.tsx:209,238,267,477` · `catalog-screen.tsx:323,353` · `devices/device-detail.tsx:211` ·
`devices/port-map-panel.tsx:164` · `expiry/digest-rules-panel.tsx:167` · `software/license-assignments-panel.tsx:166` ·
`software/license-seats-expand.tsx:139` · `vault/access-matrix-screen.tsx:118` · `ui/attachment-panel.tsx:207` ·
`ui/vault-panel.tsx:316`.
Nặng nhất `accounts-screen.tsx:477`: tiêu đề "Xác nhận", nội dung "Đá phiên đăng nhập này?" —
bảng nhiều dòng phiên, hộp không nêu IP/trình duyệt/giờ của phiên nào.

### 9. Tiêu đề hộp bằng một chữ "Sửa"
`catalog/catalog-form.tsx:138` (dùng chung cho CẢ BẢY tab danh mục) · `devices/port-map-panel.tsx:319` ·
`expiry/digest-rules-panel.tsx:261` · `ipam/subnet-form.tsx:46` · `ipam/nat-screen.tsx:430`.
Trong khi `device-form.tsx:160` và `account-form.tsx:79` đã làm đúng (kèm mã/email).

### 10. Đóng hộp giữa chừng là mất trắng
`dismissible={!save.isPending}` chỉ chặn lúc ĐANG GHI. Chưa bấm Lưu thì Esc/bấm nền/✕ đóng thẳng:
`device-form.tsx:156` (15 ô) · `software-form.tsx:123` · `isp-form.tsx:117` · `nat-screen.tsx:425` ·
`service-account-form.tsx:113` (có ô Mật khẩu!) · `catalog-form.tsx:132` · `account-form.tsx:74` ·
`port-map-panel.tsx:322` · `subnet-form.tsx:41` · `digest-rules-panel.tsx:256`.

**Thiếu `dismissible` hoàn toàn** (đóng được cả lúc đang ghi → tin là đã hủy trong khi đã vào sổ):
`approvals-screen.tsx:311` · `access-matrix-screen.tsx:457,593,742` · `software-detail.tsx:348` ·
`isp-detail.tsx:288` · `expiry-screen.tsx:277` · `service-accounts-screen.tsx:333`.

Kiểm lại 12/09 bằng cách quét MỌI `<Dialog>` trong `web/src`: đúng 8 hộp như trên, cộng ba hộp
nữa cũng không có `dismissible` nhưng **đúng là không cần** — danh sách phiên, lịch sử hồ sơ IP,
popup két: chỉ đọc, đóng không mất gì. Bản rà soát đã loại đúng ba cái này.

**ĐÃ VÁ (đợt B) — hai lớp, hai prop:**

1. Tám hộp trên nhận `dismissible={!…isPending}`.
2. Lớp còn lại, lớn hơn nhiều, cần một cửa MỚI: `Dialog guardUnsaved` (bật ở 18 hộp). Esc /
   bấm nền / ✕ nay chỉ vứt form khi thật sự không có gì đã gõ.

**Vì sao đo ở DOM, không bắt mỗi form tự khai "dirty":** bắt 18 nơi gọi cùng dựng một đối tượng
`values` rồi so với ảnh chụp là 18 chỗ phải nhớ cập nhật khi thêm ô mới — và chỗ thứ mười chín
sẽ quên, đúng cách 17/18 hộp đã quên `disabled` nút Hủy. Một lần đọc `input/textarea/select`
trong thân hộp thì phủ mọi form, kể cả form viết sau.

**Đánh đổi đã biết và chấp nhận:** ô chọn ngày, combobox và `Select` render ra `<button>` nên đổi
RIÊNG chúng thì cửa không thấy. Bù lại nó KHÔNG BAO GIỜ báo động giả — mà báo động giả mới là thứ
bào mòn cửa canh nhanh nhất: hỏi thừa mỗi lần sẽ dạy người dùng bấm "Bỏ và đóng" theo phản xạ,
rồi họ bấm nó cả vào hôm có dữ liệu thật. Nút "Hủy" ở chân hộp cố ý KHÔNG canh: bấm Hủy là cố ý.

**Hai chuyện học được khi làm:**
· `ui/dialog.tsx` cần `useConfirm`, mà `confirm-provider → confirm-dialog → dialog` — import ngược
  là vòng phụ thuộc, depcruise chặn thẳng. Tách context ra `ui/confirm-context.ts`; `confirm-provider`
  re-export nên hơn 30 chỗ gọi không sửa dòng nào.
· Ảnh chụp gốc phải chờ `portalEl` khác `null`. `RD.Portal` dựng thùng chứa trong một layout
  effect, nên ở lượt effect ĐẦU thân hộp chưa vào tài liệu: chữ ký chụp được là chuỗi rỗng và
  MỌI hộp bị coi là đang gõ dở. Bài kiểm đơn vị bắt ngay ở lần chạy đầu.

## MỨC VỪA

11. **Câu lỗi là cái nhãn của ô** — `isp-detail.tsx:317` `setError(t("isp.endDate"))` → khối đỏ hiện chữ "Hết hạn".
    `software-detail.tsx:377` hiện lại đúng câu hint đang nằm xám ngay trên. Dùng `t('expiry.pickDate')` (`vi.ts:540`).
12. **Ba form gốc, ba câu lỗi cứng khác nhau** — `device-form.tsx:123` / `software-form.tsx:138` / `isp-form.tsx:132`,
    đều ngoài `t()`, đều không nói ô nào trống, đều hiện ở CUỐI form (dưới khối Giấy tờ = ngoài màn hình).
    `Field` đã có prop `error` (`ui/page-header.tsx:63`) mà không form nào dùng.
13. **Hint ô "Tủ mạng" nói "Không nằm trong tủ"** — `device-form.tsx:266` đem nhãn lựa-chọn-rỗng làm hint cho cả ô.
14. **Viết tắt và tiếng lóng** — `"NCC"` (`device-form.tsx:308`, trong khi `devices.noVendor` viết sẵn không ai dùng) ·
    `"SA"` + `"đá phiên"` (`vi.ts:578,595`) · `"Cửa sổ"` dịch máy từ *window* (`vi.ts:530,560`) ·
    `"pool"` (`vi.ts:782`) · `"v1 chỉ quản IP tĩnh · DHCP để sau"` (`vi.ts:692`).
15. **Chữ "epic" hiện ở 3 nơi người dùng thấy** — `vi.ts:15,169,1089`.
16. **Nút "Mở khóa" hiện trên tài khoản đang bị vô hiệu hóa** — `accounts-screen.tsx:177` chỉ có 2 nhánh cho 3 trạng thái.
    `accounts.disable` (`vi.ts:603`) là khóa chết.
    **ĐÃ VÁ (đợt A)**: `STATUS_ACTIONS: Record<AccountStatus, StatusAction[]>` — mỗi trạng thái khai
    thẳng những việc hợp lệ của nó, nên trạng thái thứ tư sẽ là lỗi biên dịch. `disabled` nay có
    "Kích hoạt lại" (hỏi lại) thay vì "Mở khóa"; `active` và `locked` có thêm "Vô hiệu hóa", tức khóa
    dịch chết kia sống lại và trạng thái thứ ba thôi phải đặt bằng `curl` — API đã nhận `disabled` từ
    lâu, có `assertNotLastSa` canh trong transaction. Badge tách màu: khóa là `warn` (tạm), vô hiệu
    hóa là `danger` (dứt), đúng như `auth.service.ts` đã cố ý tách `ACCOUNT_LOCKED`/`ACCOUNT_DISABLED`.
17. **Kho thanh lý báo "đang trống" khi chỉ là lọc không ra** — `disposal-screen.tsx:114` dùng `rows` SAU lọc.
    Hint còn thiếu chữ "có": *"Chưa hồ sơ nào…"*.
18. **Tiêu đề hứa "cả hệ thống" nhưng đường truyền không bao giờ vào kho** — `vi.ts:967`;
    `isp-detail.tsx:105-122` không có nút ngừng dùng nào, nên hợp đồng "Đã cắt" (`vi.ts:502`) không hiện ở đâu.
19. **"Gửi thử" bắn email thật cho sếp, không hỏi lại** — `digest-rules-panel.tsx:141`.
    **ĐÃ VÁ (đợt B)**: hỏi lại, và câu hỏi NÊU ĐÍCH DANH người nhận — đó mới là thứ giúp người
    dùng dừng đúng lúc, chứ không phải chữ "chắc chưa?". Đây là chỗ hiếm hoi phải hỏi lại dù
    thao tác không ghi gì xuống DB: cái không hoàn tác được là email đã rời đi. Bài E2E chốt
    bằng chính HỘP THƯ — bấm Hủy xong mà Mailpit nhận thêm thư thì câu hỏi chỉ là trang trí.
20. **Việc không hoàn tác được mà không một chữ cảnh báo** — `vi.ts:298` (ô tick "Dọn hết" thả ra 3 thao tác phá) ·
    `vi.ts:229` (nửa sau nói về tình huống KHÔNG xảy ra → yên tâm nhầm) · `vi.ts:634` (không nói giá trị mật khẩu mất luôn).
    **ĐÃ VÁ (đợt B)** — viết lại cả ba để chúng nói đúng thứ sắp mất:
    · thanh lý thiết bị thêm *"…nhưng ô bên dưới thì KHÔNG hoàn tác được, đọc kỹ trước khi tick"*,
      và nhãn ô tick thành "Dọn hết thứ liên quan (không hoàn tác được)";
    · vô hiệu danh mục bỏ vế trấn an về hồ sơ cũ, nói thẳng *"Từ giờ KHÔNG form nào chọn được mục này nữa"*;
    · thu hồi ngăn két nói *"GIÁ TRỊ mật khẩu bị xoá vĩnh viễn — không có cách nào xem lại, kể cả
      Super Admin. Nhật ký chỉ giữ vết ai đã cất và lúc nào."* — câu cũ đọc ra như mật khẩu còn
      nằm đâu đó lấy lại được.
21. **Nút nguy hiểm sát nút hay bấm nhất, và đổi nghĩa tại chỗ** — `device-detail.tsx:185-238`: "Thanh lý" (đỏ)
    sát "Sửa hồ sơ", và CÙNG tọa độ chuột hôm sau là "Đưa lại vào dùng" (xám).
    Cùng vấn đề `license-assignments-panel.tsx:151` và `license-seats-expand.tsx:122`, trong khi
    `software-screen.tsx:352` cùng module lại dùng `RowActions` (tự đẩy mục đỏ xuống cuối).
22. **Nút mờ không nói vì sao** — `ui/import-dialog.tsx:114` · `ui/vault-panel.tsx:273` (mở 1 ngăn thì 7 nút "Xem"
    còn lại xám hết mà vẫn ghi "Xem") · `accounts-screen.tsx:176` (mọi dòng cùng xám) · `port-chips-field.tsx:158` ·
    `totp-challenge.tsx:38`. Mẫu đúng để chép: `device-detail.tsx:188`.
    Phụ: nút đang chạy giữ nguyên chữ ("Gỡ", "Xóa") trong khi mọi nút Lưu đổi sang "Đang tải…".
23. **`Field` giấu gợi ý đúng lúc cần nhất** — `ui/page-header.tsx:82`: lỗi và hint loại trừ nhau.
24. **Dấu `*` có hai hành vi** — `Field` chỉ vẽ dấu (`page-header.tsx:75`), chặn thật nằm ở `required` của `<input>`,
    mà `Select`/`SuggestInput` không nhận. 4 màn `auth/` tự dựng `<label>` nên không ô nào có `*`.
25. **Bảng từ vựng lệch**: Seat/ghế · Máy/Thiết bị · hồ sơ/bản ghi · Gỡ/Xóa/Thu hồi ·
    Vô hiệu/Vô hiệu hóa/Ẩn · secret/ngăn/bí mật · Super Admin (Anh) cạnh Quản trị, Thành viên (Việt).

## MỨC NHẸ

26. `vi.ts:1074 stateDenied: 'Từ chối'` lệch thì với 5 khóa anh em ("Đã duyệt", "Đã hủy"…) → `'Đã từ chối'`.
27. Giá trị trống ghép thành cụm vô nghĩa: `"— giờ"` (`approvals-screen.tsx:189`) ·
    `"Bạn được xem tới —. Hết giờ là tự cắt."` (`ui/vault-panel.tsx:216`).
28. Nút nhấn mạnh đặt nhầm chỗ — `vault-home-screen.tsx:219`: `btn primary` rơi vào nút "Đóng".
29. `isp-detail.tsx:98`: nhãn "IP WAN", nút chép ngay cạnh ghi "Chép IP tĩnh" (`vi.ts:476`).
30. `vi.ts:694 railTitle: 'Subnet / VLAN'` — tiếng Anh, trong khi dòng dưới đã viết "Danh sách dải mạng".
31. `vi.ts:798,854` — *"auditor sẽ hỏi"* → "người rà soát".
32. `common.empty` = "Chưa có dữ liệu" dùng cho cả hộp "Phiên đang mở" (`accounts-screen.tsx:450`),
    nơi đó chính là CÂU TRẢ LỜI của màn.
33. `catalog-screen.tsx:450` ghép máy móc hai câu hoàn chỉnh bằng gạch ngang.
34. `vi.ts:541 expiry.notRenewable: 'Sửa trong hồ sơ'` nằm ở ô cột Thao tác, trông như nút hỏng.
    `row.original.link` đã có sẵn → nên là `<Link>`.
35. "Ghi chú" in hai lần chồng nhau — `service-account-form.tsx:406` + `service-account-detail.tsx:124,154`.
36. **46 khóa chết trong `vi.ts`** — đáng chú ý `app.serverUnreachable:12` ·
    `accounts.neverLoggedIn:604` ("Chưa đăng nhập lần nào" — cột lại hiện "—" y như mọi ô trống,
    nên "chưa từng đăng nhập" và "không rõ" trông giống hệt) · `accounts.disable:603` · `devices.noVendor:287`.
37. `ui/toast.tsx:124` dùng `aria-live="polite"` cho cả thông báo lỗi → nên `assertive` khi `tone === 'error'`.
38. Nội dung toast đến thẳng từ server không qua `t()` — 7 chỗ, `for (const warning of warnings) toast(...)`.
39. 17 placeholder ví dụ viết cứng, trong khi ô port của chip lại đi qua `t('nat.portPlaceholder')`.

## Ba thứ nên sửa trước

1. **Mục 1** — bảng điều khiển in `warranty`/`license`. Màn đầu tiên mọi người mở mỗi ngày.
   Sửa rẻ nhất (7 khóa i18n), thu nhiều nhất. Biên bản test tay 12/09 đi qua đúng màn này và
   đọc nhầm `license · 27/08/2026` thành rác dữ liệu — đủ khó nhận ra để sống thêm nhiều tháng.
2. **Mục 3** — hộp mật khẩu tạm đóng bằng Esc. Mục DUY NHẤT mà một phím sai làm mất hẳn thứ
   không lấy lại được, và hậu quả rơi vào người thứ ba. Sửa bằng một dòng `dismissible={false}`.
3. **Mục 2** — két sắt mù loại "Đường truyền". Ba hỏng cùng gốc trên chính màn mà FR-026 dựng ra
   để trả lời "công ty giữ bí mật ở đâu". Cách sửa đã nằm sẵn trong repo (`lib/disposal-kinds.ts:16`).
