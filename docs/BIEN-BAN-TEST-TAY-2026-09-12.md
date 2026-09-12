# Biên bản test tay — 11/09/2026
Tài khoản lái: e2e-sa@pmh.com.vn (SA). Dữ liệu tạo mang chữ E2E để lượt dọn với tới được.
Origin: https://ims.pmh.com.vn

| # | Mục | Trạng thái | Ghi chú |
|---|-----|-----------|---------|
| 0 | Đăng nhập lần đầu (mật khẩu tạm → 2 lớp → đổi mật khẩu) | [x] | 3 đường hỏng chặn đúng: email lạ vs sai mk cùng 1 câu; mk yếu; 2 ô lệch |
| 1 | Trang chủ / Dashboard | [x] | 6 khối hiện đủ. "1 — 1" ở khối hạn là rác dữ liệu cũ (software code=1), không phải lỗi |
| 2 | Hệ thống → Danh mục (7 tab) | [x] | Tạo đủ 7 loại. Chặn đúng: trùng mã, số U ngoài 1–60, dải port viết ngược, port ngoài 1–65535 |
| 3 | Thiết bị — tạo 3 máy, port map, đấu chéo | [x] | Chặn đúng: bảo hành đến < từ, trùng mã cổng. Tủ lọc theo site. Chiều ngược port map hiện đúng (AD-14). Loại không port map thì ẩn tab. **Lỗi nhỏ: VLAN là text tự do, nhận cả 9999** |
| 4 | Phần mềm — tạo hồ sơ license | [x] | Seat/hạn tính đúng. Chi phí chặn chữ. **Lỗi nhỏ: trang thiết bị có 2 tiêu đề chồng nhau cùng nghĩa** |
| 5 | GẮN: license → thiết bị (2 chiều) | [x] | Gán 3 máy / 2 seat: không chặn cứng mà bắt ghi "Lý do vượt seat", ghi lại trên dòng. Chiều ngược hiện ở trang thiết bị |
| 6 | Dải IP — khai dải, cấp IP, gán vào thiết bị | [x] | /29 ra đúng 6 host. Chặn đúng: CIDR sai, VLAN ngoài 1–4094, gateway ngoài dải (câu lỗi nêu cả 2 giá trị). Chiều ngược hiện ở trang thiết bị |
| 7 | Sổ NAT — tạo rule, thiếu router, trùng port | [x] | Tạo OK, tự suy máy đích từ hồ sơ IP. Trùng port chặn đúng. **LỖI: bỏ trống Router ra câu sai** (xem #4) |
| 8 | Đường truyền ISP — tạo, cắm vào router | [x] | Lưu đủ trường, hạn tính đúng (Còn 9 ngày), device_id gắn đúng |
| 9 | Sắp hết hạn + Gia hạn | [x] | Gom đủ 4 loại (bảo hành/license/hợp đồng ISP). Lịch gia hạn **khóa hẳn** ngày sớm hơn hạn cũ. Lịch sử ghi hạn cũ→mới→ai |
| 10 | Tài khoản dịch vụ + cất/mở secret | [x] | Cất mật khẩu phải xác thực lại (step-up). DB lưu ciphertext, không lộ chuỗi gốc. Mở ra: tự ẩn 55s, và nhật ký tăng đúng 1 dòng `vault.secret.revealed` |
| 11 | Két sắt (trang tổng) | [x] | Chỉ liệt kê CHỦ THỂ giữ két, không hiện tên/giá trị ngăn — đúng FR-026 |
| 12 | Duyệt yêu cầu (vòng 2 vai) | [x] | Thành viên thấy "Xin quyền xem" đúng theo ma trận · xin 100h bị kẹp còn 24h · email bắn cho 4 người duyệt · SA cấp 2h · `expires_at` đúng +2h · Thành viên mở được két, có đồng hồ đếm ngược. **2 lỗi nhỏ: #6, #7** |
| 13 | Thanh lý — chặn rồi dọn (bản vá nhóm 3) | [x] | **ĐẠT TRỌN VẸN.** Chặn 409 + toast nêu đích danh 4 thứ vướng. Tick "Dọn hết": cổng giữ chữ `RT-E2E-TAY-01 (đã thanh lý)`, ISP rời máy mà hợp đồng còn nguyên, NAT gỡ hiệu lực, ghế license trả về |
| 14 | Kho thanh lý | [x] | Router vào kho đúng ngày, có cảnh báo "không còn tính hạn" |
| 15 | Hệ thống → Tài khoản | [x] | Đúng 7 hàng, không rác. **LỖI: cột "Đăng nhập lần cuối" sai** (xem #5) |
| 16 | Ma trận quyền két sắt | [x] | Mặc định-đóng, tự nhận danh mục mới. Gán 1 quyền `needs_approval` ghi đủ ai-gán-gì |
| 17 | /dev/components | [x] | 16 mục dùng chung hiện đủ, 9 token màu lấy từ tokens.css |
| 18 | Mục `planned` + phân quyền theo vai | [x] | "Tài liệu"/"Nhật ký" là `<span>` không bấm được; gõ URL ra 404 tiếng Việt. Vai Thành viên ẩn đúng 5 mục, API trả 403 `FORBIDDEN_ROLE`. **Lỗi #8: 2 route admin không gác ở router** |

| 19 | 390px (UX-DR2) + chế độ tối | [x] | 10/11 màn không cuộn ngang. **`/disposal` tràn 27px — lỗi #9.** Dark đổi đúng `html[data-theme=dark]`, đủ 8 token |

## Lỗi phát hiện
1. **VLAN không kiểm hình dạng** — `device_port.vlan` là text, API chỉ `@Length(0,40)`. Gõ `9999` (ngoài dải 1–4094) lưu tuột, dù gợi ý dưới ô nói "số VLAN hoặc trunk". Đề xuất: chặn theo `^(trunk|[1-9]\d{0,3})$` và ≤4094.
2. **Hai tiêu đề chồng nhau** — trang chi tiết thiết bị, tab Hồ sơ: `<h2 class="form-section-title">LICENSE ĐANG CÀI</h2>` rồi ngay dưới `<div class="seat-head">PHẦN MỀM ĐANG CÀI (1)</div>`. Bỏ một trong hai.
4. **NAT thiếu router ra sai câu lỗi — và bài E2E không bắt được** (lỗi của chính bản vá nhóm 3, commit 8b6592d).
   Bỏ trống ô Router rồi Lưu → nhận `Mã thiết bị không hợp lệ.` thay vì `Chọn thiết bị (router) cho rule NAT này.`
   Nguyên nhân: `nat-screen.tsx:278` khởi tạo `deviceId` bằng `''` và `:473` gửi nguyên, nhưng `NatBodyDto.deviceId`
   (`ipam.controller.ts:102`) chỉ có `@IsOptional() @IsUUID(...)` — thiếu `@ValidateIf((_o,v)=>v!=='')` mà HAI DTO anh em
   (`IpBodyDto:76`, `TransitionDto:92`) đều có. class-validator chặn `''` trước, nên `requireDeviceId()` (`:562`) là code chết
   trên đường mà giao diện thật đi. Bài `nat-guard-cua-con-lai.spec.ts:336` gửi **thiếu hẳn** `deviceId` nên không chạm đường này.
   Phần 500→400 thì đã vá đúng. Sửa: thêm `@ValidateIf` vào dòng 102, và sửa bài E2E gửi `deviceId: ''`.

5. **Đăng nhập LẦN ĐẦU không đóng dấu `last_login_at`** (lỗ còn lại của story 2.2, commit bcaf345).
   Đo được: tôi đăng nhập trọn vẹn lúc 23:17:09, `audit_log` ghi `auth.login.ok {"viaTotpEnroll": true}`,
   nhưng `users.last_login_at` vẫn đứng ở 20:38 của lượt trước. Màn Tài khoản của SA hiển thị sai theo.
   Nguyên nhân: có BA đường dẫn tới phiên đã-xác-thực-đủ, 2.2 chỉ đóng dấu hai.
   `login()` khi `!needsTotp` (`auth.service.ts:238`) ✓ · `verifyLoginTotp()` (`:359`) ✓ ·
   `confirmTotpEnrollment()` (`:439`) tạo phiên mới + ghi `auth.login.ok` (`:505-521`) nhưng **không** gọi
   `markLoginCompletedWithin`. Chú thích ở `:234` viết "Nhánh CÒN LẠI do verifyLoginTotp đóng dấu" — tưởng có hai nhánh, thực ra ba.
   Hệ quả: tài khoản mới vừa vào lần đầu thì cột "Đăng nhập lần cuối" vẫn là "—", SA đọc thành "người này chưa từng đăng nhập".
   Sửa: thêm `await this.users.markLoginCompletedWithin(tx, user.id);` cạnh dòng ghi `auth.login.ok` trong khối `if (!session.totpPending)`.

3. **Bộ lọc không vào URL** — màn Thiết bị: chọn site/tủ/loại xong, `location.search` vẫn rỗng. F5 là mất lọc, không gửi link đã lọc cho người khác được. (Nhỏ, nhưng gặp ở mọi màn danh sách.)

6. **Kẹp giờ break-glass không báo lại tại chỗ** — gợi ý dưới ô ghi "Vượt trần hệ thống thì sẽ được kẹp xuống **và báo lại**". Xin 100 giờ → DB lưu `{"hours": 24}`, không toast nào. Số cuối có hiện ở tab "Yêu cầu của tôi" nên không mất thông tin, nhưng lời hứa không giữ đúng chỗ. (Nhẹ.)

7. **Màn duyệt không hiện TÊN đối tượng** — người duyệt chỉ thấy `Thiết bị · 847e1f9a`, một mẩu UUID. Họ đang quyết định có trao mật khẩu một cái máy hay không mà không biết máy nào. Gốc ở API: `GET /vault/break-glass/pending` chỉ trả `subjectType` + `subjectId`, không kèm code/name — giao diện không có gì để hiện. Vá bằng đúng kiểu `getByIds` mà nhóm 4 đã dùng cho 4 màn kia.

8. **Hai route admin không gác quyền ở router** — vai Thành viên gõ `/admin/accounts` hoặc `/admin/vault-access` thì được dựng nguyên khung màn admin rồi báo "Không tải được dữ liệu. Thử lại". Trong khi `/vault` và `/dev/components` trả 404 đúng. **Không rò rỉ dữ liệu** (API vẫn 403 `FORBIDDEN_ROLE`), nhưng chính chú thích trong `app-nav.ts` đã gọi tên trạng thái này: *"Member bấm vào và nhận một màn lỗi 'thử lại' — bày ra một cánh cửa khóa còn tệ hơn không bày."*

9. **`/disposal` cuộn ngang ở 390px** (UX-DR2) — `scrollWidth` 417 so với khung 390. Thủ phạm là thanh lọc `.segmented` rộng 384px trong khung 358px; chip cuối "Tài khoản dịch vụ 0" đẩy tràn. Các màn khác dùng cùng kiểu nhưng nhãn ngắn hơn nên chưa lộ. Ảnh: `disposal-390px-tran-ngang.png`.

10. **Câu lỗi tiếng Anh lọt ra giao diện** — xin break-glass 9999 giờ nhận `hours must not be greater than 168` (class-validator thô). Vi phạm DoD gạch 6. Các `@Min/@Max` anh em cùng file đều có `message` tiếng Việt (vd `ipam.controller.ts:58`), riêng `break-glass.controller.ts:27,31` thì không. Bản thân việc CHẶN 9999 là đúng thiết kế (chốt "số vô lý" ở cửa vào, khác trần cấu hình) — chỉ câu chữ là sai.

## Dữ liệu đã tạo
Toàn bộ mang chữ `E2E` nên `reset-e2e.mjs` với tới được — lượt E2E kế tiếp tự dọn.
**Đừng chạy `reset-e2e.mjs` bằng tay**: nó nâng `login.rate_limit_per_ip` lên 500 và chỉ có teardown của Playwright mới trả về 20.

1 site · 1 tủ · 2 loại TB · 1 NCC · 1 bộ phận · 1 nhà mạng · 1 dịch vụ/port · 3 thiết bị (1 đã thanh lý) ·
2 cổng port map · 1 hồ sơ license (3 ghế/2 seat) · 1 dải /29 + 1 IP đã cấp · 1 rule NAT (đã gỡ) ·
1 đường truyền ISP (đã gia hạn) · 1 tài khoản dịch vụ + 1 secret · 1 secret trên switch · 1 dòng quyền két · 1 yêu cầu đã duyệt.
