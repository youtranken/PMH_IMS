# Biên bản test tay — đợt A · 12/09/2026

Lái Chrome thật qua Playwright trên stack vừa dựng lại từ `fd0995a` + `1b7595b`.
Không dùng API tắt, trừ MỘT chỗ ghi rõ ở mục 6.

Mọi hàng tạo ra đều mang chữ `E2E` trong tên, nên `reset-e2e.mjs` với tới được. Đối chiếu
cuối lượt: `users 8 · isp_line 1 · secret 1 · approval 1`, `login.rate_limit_per_ip = 20`
(KHÔNG chạy `reset-e2e.mjs` bằng tay — nó nâng trần lên 500 và chỉ `global-teardown` trả lại).

| # | Việc | Kết quả |
| --- | --- | --- |
| 0 | Đăng nhập lần đầu: cài 2 lớp → đổi mật khẩu → vào bảng điều khiển | ✅ |
| 1 | Nhãn loại hạn trên bảng điều khiển (hồi quy `d016847`) | ✅ |
| 2a | Cột "Loại" của dòng đường truyền ở trang tổng két | ✅ |
| 2b | Bốn nút lọc; bật "Thiết bị" → dòng ISP đi, bật thêm "Đường truyền" → quay lại | ✅ |
| 2c | "Mở hồ sơ đầy đủ" trỏ `/isp-lines/<id>` | ✅ |
| 2d | Màn Duyệt yêu cầu: "Đối tượng — Đường truyền" | ✅ |
| 3 | Hộp mật khẩu tạm: Esc KHÔNG đóng (hồi quy `d016847`) | ✅ |
| 6a | 403 thật → in câu của API | ✅ |
| 6b | Mất mạng → `app.serverUnreachable` sống lại | ✅ |
| 16 | Vô hiệu hóa ↔ Kích hoạt lại, và "Mở khóa" biến mất | ✅ |

## 1. Bảng điều khiển — nhãn loại hạn

Gieo một hợp đồng đường truyền hết hạn 25/09 (còn 13 ngày). Khối "SẮP HẾT HẠN (30 NGÀY)" đọc ra:

```
Quá hạn 16 ngày   · License phần mềm · 27/08/2026
Còn 13 ngày       · Hợp đồng đường truyền · 25/09/2026
```

Trước `d016847` hai dòng này ghi `license` và `isp` — chính mã máy của API.

## 2. Đường truyền là chủ két — bốn chỗ, một gốc

Dựng đúng tình huống sinh ra lỗi: `ISP-E2E-TAY-01` (FPT Telecom), rồi cất mật khẩu PPPoE
vào tab Két sắt của nó. Tab đổi thành "Két sắt 1", dòng secret hiện đủ sáu cột metadata.

**(a) Cột "Loại"** ở `/vault` ghi **"Đường truyền"**. Trước bản vá: ô trống, vì
`OWNER_LABEL['isp']` là `undefined`.

**(b) Nút lọc.** Bốn nút, cả bốn `aria-pressed="false"` lúc mới vào:

```
Thiết bị=false · Phần mềm=false · Tài khoản dịch vụ=false · Đường truyền=false
```

Bật "Thiết bị" → dòng ISP biến mất và màn nói **"Không có hồ sơ nào khớp bộ lọc"**. Bật thêm
"Đường truyền" → dòng quay lại. Trước bản vá nút thứ tư KHÔNG TỒN TẠI, nên bật bất kỳ nút nào
là dòng đường truyền mất và không có đường nào lấy lại — người dùng đọc ra "đường truyền không
có két", còn két thì vẫn nằm đó.

**(c) "Mở hồ sơ đầy đủ"** trong popup trỏ `/isp-lines/a8c74c88-…`. Trước bản vá chuỗi `if` kết
bằng `return PATHS.softwareItem(...)`, nên nút này mở trang PHẦN MỀM với id của đường truyền —
một trang trắng mà không lỗi nào báo.

**(d) Màn Duyệt yêu cầu.** Gieo một phiếu break-glass `subject_type='isp'` thẳng vào DB (đúng
cách `leo-thang-quyen.spec.ts` vẫn làm — đây là chỗ DUY NHẤT của lượt này không đi qua giao
diện, vì để member xin được quyền phải gán trước tầng "Cần duyệt", mà việc đó không kiểm thêm
điều gì cho mục này). Phiếu đọc ra:

```
Chờ duyệt · e2e-member@pmh.com.vn · Đối tượng: Đường truyền · a8c74c88 · Xin 2 giờ
```

Trước bản vá: chữ `approvals.subject_isp`, vì `vi.ts` chỉ có hai trên bốn loại.

Phụ đề màn cũng đã sửa: "Yêu cầu xem tạm thời **mật khẩu đang cất trong két**" thay cho
"mật khẩu thiết bị và phần mềm".

## 3. Mật khẩu tạm — Esc không còn giết nó

Tạo tài khoản `e2e-tao-moi-qt-tay@pmh.com.vn`. Hộp hiện ra:

- tiêu đề **"Mật khẩu tạm — e2e-tao-moi-qt-tay@pmh.com.vn"** (nêu rõ của ai),
- nút ✕ **disabled**,
- **bấm Esc → hộp vẫn mở, mật khẩu còn nguyên trên màn**,
- chỉ nút "Tôi đã ghi lại mật khẩu này" mới đóng được.

Không có nút Sao chép, và đó là cố ý — `ui/copy-button.tsx` ghi rõ clipboard sống qua cả phiên
đăng nhập.

## 6. `LoadError` nói đúng nguyên nhân

**(a) 403 thật.** Đăng nhập bằng vai **Quản trị** rồi gõ thẳng `/admin/accounts` — route này
không gác vai ở web, hàng rào là `@Roles('sa')` ở API. Khối lỗi:

> Bạn không có quyền thực hiện thao tác này.  ·  [Thử lại]

Đúng câu `roles.guard.ts` gửi về. Trước bản vá: "Không tải được dữ liệu." — một câu mời người
ta bấm "Thử lại" cho một lượt sẽ 403 y hệt, mãi mãi. Khối này nay là `role="alert"`.

**(b) Mất mạng.** Vá `window.fetch` ngay trong trang để lượt gọi `/api/v1/accounts` ném
`TypeError` — đúng thứ trình duyệt ném khi đứt mạng — rồi bấm "Thử lại":

> Không kết nối được máy chủ. Kiểm tra mạng nội bộ rồi thử lại.

Đây là khóa `app.serverUnreachable`, nằm chết trong `vi.ts` từ đầu dự án vì không ai có đường
dẫn tới nó. Chọn cách vá `fetch` thay vì hạ container `api`: cùng chứng minh một điều, mà không
làm rung cả stack.

## 16. Ba trạng thái, ba câu chữ

Trên chính tài khoản Quản trị vừa tạo:

| Bước | Thấy gì |
| --- | --- |
| Đang hoạt động | menu có **sáu** việc, "Vô hiệu hóa" xếp cuối (cờ `danger`) |
| Bấm "Vô hiệu hóa" | hộp hỏi lại nói rõ đây là trạng thái *"dành cho người đã nghỉ hẳn"*, nút ghi "Vô hiệu hóa" chứ không phải "Đồng ý" |
| Sau khi vô hiệu hóa | huy hiệu **"Vô hiệu hóa"** (`badge danger`), tách khỏi "Đang khóa" (`badge warn`) |
| Mở lại menu | **"Mở khóa" KHÔNG còn**, thay bằng **"Kích hoạt lại"** — đây là lỗi #16 |
| Bấm "Kích hoạt lại" | hộp hỏi lại nhắc *"nếu nghi mật khẩu đã lộ thì đặt lại mật khẩu trước"* |
| Sau khi bật lại | "Đang hoạt động" (`badge ok`), và tài khoản đăng nhập được thật (mục 6 dùng chính nó) |

## Còn mở, không thuộc đợt A

Hai hộp hỏi lại gặp trong lượt này đều đội tiêu đề trống **"Xác nhận"** — đúng mục **#8** của
bản rà soát, đã xếp đợt D. Ghi lại ở đây để khỏi phát hiện lại lần nữa.
