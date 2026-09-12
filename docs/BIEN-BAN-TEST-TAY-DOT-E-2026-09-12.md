# Biên bản test tay — đợt B/C/D/E · 12/09/2026

Lái Chrome thật qua Playwright, trên stack dựng lại từ mã của đợt E. Biên bản này bù cho ba
đợt B, C, D — trước đó chỉ có E2E tự động, chưa có lượt người ngồi bấm (đợt A có biên bản
riêng: `BIEN-BAN-TEST-TAY-DOT-A-2026-09-12.md`).

Mọi hàng tạo ra mang chữ `E2E` trong tên (`PC-E2E-TAY-E1`, luật `E2E luat lai tay`), nên
`reset-e2e.mjs` với tới được.

| Mục | Soi gì | Kết quả |
| --- | --- | --- |
| 5 | câu lỗi validator ở ô không có hàng rào phía web | ✅ |
| 7 | tab Lịch sử trên DỮ LIỆU THẬT | ✅ |
| 8 | tiêu đề hộp hỏi lại nêu đối tượng | ✅ |
| 10 | Esc trên form đang gõ dở | ✅ |
| 16 | menu tài khoản theo trạng thái | ✅ |
| 17 | kho thanh lý: rỗng ≠ lọc không ra | ✅ |
| 19 | "Gửi thử" — kiểm bằng chính hộp thư | ✅ |
| 20 | câu trấn an dẫn tiếp sang ô nguy hiểm | ✅ |
| 21 | "Đưa lại vào dùng" cũng hỏi lại | ✅ |
| 22 | nút xám nói vì sao | ⚠️ vá một nửa — xem mục dưới |
| 24 | dấu `*` | ⚠️ khuyến nghị của bản rà soát SAI — xem mục dưới |
| 32 | hộp "Phiên đang mở" khi rỗng | ✅ |
| 37 | toast lỗi được đọc ngay | ✅ |

## Vì sao lượt lái tay này đáng giá: nó tìm ra ba thứ E2E không thấy

### 1. Gõ CHỮ vào ô số báo sai nguyên nhân

`POST /ipam/nat` với `internalPort: 'abc'` trả **"Port trong không được lớn hơn 65535."** Giá
trị không quá to — nó không phải số.

Nguyên nhân: với `stopAtFirstError: true`, class-validator báo ràng buộc **gần thuộc tính
nhất**, mà `@IsInt()` đang nằm TRÊN `@Max()`. `Number('abc')` ra `NaN`, và `NaN <= 65535` là
`false`, nên `max` hỏng trước.

**Bản tiếng Anh trước 12/09 cũng sai y như vậy** — `internalPort must not be greater than
65535`. Nó nằm đó từ đầu dự án mà không ai thấy, vì không ai đọc câu tiếng Anh. Đợt C dịch nó
sang tiếng Việt, và chính việc LÀM CHO NÓ ĐỌC ĐƯỢC đã khiến nó lộ ra ở lượt lái tay đầu tiên.
Đó là một lập luận đáng giữ cho việc dịch: câu người ta không đọc thì không ai sửa.

Đã đảo `@IsInt()` về sát tên trường ở **12 trường / 7 file**, và ghim bằng một CẶP ca kiểm:
gõ chữ → "phải là số nguyên", số quá to → "không được lớn hơn 65535". Thiếu ca đầu thì đảo thứ
tự vẫn xanh; thiếu ca sau thì bỏ hẳn `@Max` cũng xanh.

### 2. Tôi vá một nửa hộp Nhập Excel (#22)

Nút "Xác nhận ghi" nay nói lý do xám. Nút **"Đối chiếu"** ngay cạnh cũng xám — vì chưa chọn
file — và không nói gì. Bản vá #22 sửa nút thứ hai mà bỏ nút thứ nhất trong cùng một hộp. Đã
thêm `importDialog.needFile`.

### 3. Dấu `*` KHÔNG thuộc về màn đăng nhập (#24)

Bản rà soát ghi "4 màn `auth/` không có dấu nào" như một chỗ thiếu. Tôi đi theo, và làm ĐỎ
TOÀN BỘ bộ E2E: bốn nhãn ấy khiến `getByLabel('Mật khẩu', { exact: true })` trong `helpers.ts`
không khớp nữa, vì Playwright khớp theo TEXT của thẻ nhãn — kể cả phần `aria-hidden`.
`fillLogin` là helper cả bộ dùng, nên mọi bài đều đỏ.

Repo ĐÃ ghi chú đúng chuyện này ở hai chỗ (`accounts.spec.ts:32`, `nat.spec.ts:216`). Tôi có
dữ liệu trong tay và không đọc hết.

Nhưng lý do bỏ dấu không phải vì bài kiểm đỏ. Màn đăng nhập có hai ô, cả hai bắt buộc; màn
đổi mật khẩu có ba ô, cả ba bắt buộc. Đánh dấu MỌI ô thì dấu ấy không nói được gì — giá trị
của `*` đến từ việc nó TÁCH ô bắt buộc khỏi ô không bắt buộc. Form nghiệp vụ có trộn thật, và
đó là chỗ nó đáng có. Lập luận ghi ở `ui/page-header.tsx`.

Phần thật sự là lỗi của #24 thì GIỮ: `Field` vẽ `className="req"` trong khi stylesheet khai
`.field-req` — dấu `*` **chưa bao giờ được tô màu**. Đo trên trang thật sau khi vá:
`rgb(192, 57, 43)` = `--danger`.

## Chi tiết từng mục

**#7 — tab Lịch sử, thứ tôi muốn xem bằng mắt nhất.** Bài kiểm đơn vị so từng chuỗi với chữ
thật, nhưng nó không nói được liệu tab ấy CÓ DỮ LIỆU để hiện. Nên tôi tạo `PC-E2E-TAY-E1`, sửa
nó ba lượt (serial+ghi chú · trạng thái · bảo hành), rồi đọc:

```
Tạo hồ sơ   · mã: (trống) → PC-E2E-TAY-E1
Sửa hồ sơ   · ghi chú: Ghi chu ban dau → Ghi chu da sua; serial: SN-E2E-TAY-001 → SN-E2E-TAY-002
Sửa hồ sơ   · trạng thái: Đang dùng → Hỏng
Sửa hồ sơ   · bảo hành đến: (trống) → 2027-12-31
```

Cả ba họ khóa đều được dùng (nhãn thao tác · tên trường · nhãn trạng thái) cộng chữ nối
`(trống)`, và `/history\.[a-z]/` KHÔNG khớp ở đâu trên trang — không một khóa nào lọt ra.

**#10.** Gõ `PC-E2E-TAY-E1` vào form 15 ô rồi Esc → hộp "Bỏ những gì vừa nhập?" hiện ra, hộp
gốc còn nguyên bên dưới. Chọn "Ở lại nhập tiếp" → còn đúng 1 hộp, và ô Mã vẫn giữ nguyên chữ.

**#8 + #20.** `Thanh lý — PC-E2E-TAY-E1`, câu: *"…Hồ sơ vẫn còn trong sổ, chỉ khóa lại — nhưng
ô bên dưới thì KHÔNG hoàn tác được, đọc kỹ trước khi tick."* Ô tick: *"Dọn hết thứ liên quan
(không hoàn tác được)"*.

**#21.** `Đưa lại vào dùng — PC-E2E-TAY-E1` — nút cùng tọa độ với "Thanh lý" hôm trước nay
cũng hỏi lại. Trước đó nhánh này đi THẲNG vào `mutate`.

**#17.** Kho có hàng (máy vừa thanh lý). Gõ `khong-ton-tai-zzz` → *"Không có hồ sơ nào khớp bộ
lọc · Kho vẫn có hồ sơ — thử bỏ bớt lọc loại…"*, và chuỗi "Kho thanh lý đang trống" KHÔNG còn
xuất hiện trên trang.

**#32.** Hộp phiên của một tài khoản chưa đăng nhập bao giờ: *"Không còn phiên đăng nhập nào
đang mở."* Chuỗi "Chưa có dữ liệu" không còn.

**#37.** Dàn cảnh một lượt ghi hỏng, gài `MutationObserver` để bắt toast trước khi nó tự tắt:
`{ chu: 'Loi gia lap de xem toast', vai: 'alert', lop: 'toast toast-error' }`. Số phần tử
`[role="alert"]` trên trang: **1 khi có lỗi, 0 khi không** — đúng hai vế của bản sửa, và vế
thứ hai là vế bản vá ĐẦU của tôi làm sai (một vùng `alert` rỗng nằm thường trực ở mọi trang).

**#19.** Đếm hộp thư trước: 50 thư. Bấm "Gửi thử" → hộp hỏi nêu đích danh
`sep-e2e@pmh.com.vn`. Bấm **Hủy** → hộp thư vẫn đúng 50, không thư nào đi. Bấm lại, **xác
nhận** → `[Gửi thử] [IMS] 0 mục sắp hết hạn — E2E luat lai tay` → `sep-e2e@pmh.com.vn`.

**#16.** Menu tài khoản có đủ sáu việc kể cả "Vô hiệu hóa"; câu hỏi lại phân biệt rõ khóa TẠM
với vô hiệu hóa — đúng hai mã lỗi mà `auth.service.ts` cố ý tách.

**#5.** `internalPort: 99999` → *"Port trong không được lớn hơn 65535."* · trường lạ →
*"Yêu cầu chứa trường không hợp lệ: khongCoTruongNay. Đây là lỗi của phần mềm, hãy báo IT."*

## Cuối lượt

`login.rate_limit_per_ip` = 20. Hàng để lại: một thiết bị và một luật gửi báo cáo, cả hai mang
chữ `E2E` nên lượt dọn kế tiếp xoá được.
