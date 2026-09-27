# Kế hoạch ngày go-live IMS

Điền các ô `____` trước ngày go-live ít nhất 3 ngày làm việc, gửi cho mọi người có tên trong bảng.
Các bước kỹ thuật chi tiết nằm ở `docs/RUNBOOK-4.3-dong-dot-1.md`. File này trả lời: **ai, lúc
nào, và khi nào thì dừng lại**.

## 1. Điều kiện để được bắt đầu (tất cả phải tick)

- [ ] Mọi mục **P0** trong `docs/GO-LIVE-CHECKLIST.md` đã xong
- [ ] `bash ops/ci-local.sh --e2e` xanh trên đúng tag sẽ phát hành: tag `v____`
- [ ] Diễn tập khôi phục trên VM (runbook mục E) **ĐỖ**, có biên bản ký
- [ ] UAT xong: ≥ 3 ngày, ≥ 2 người dùng thật, không còn lỗi mức cao (xem mục 5)
- [ ] Người dùng đã được báo lịch và biết đầu mối hỗ trợ

## 2. Người và vai

| Vai | Người | Liên lạc |
| --- | --- | --- |
| Chỉ huy go-live (quyết định dừng/đi tiếp) | ____ | ____ |
| Người thao tác máy chủ | ____ | ____ |
| Người giữ phong bì chìa thứ hai | ____ | ____ |
| Người kiểm thử ở từng site | ____ | ____ |
| Đầu mối hỗ trợ người dùng tuần đầu | ____ | ____ |

## 3. Lịch

| Giờ | Việc | Runbook | Người |
| --- | --- | --- | --- |
| ____ | Dựng máy chủ, `.env`, secrets, cert | A | ____ |
| ____ | Deploy, tạo 2 SA, kiểm từ các site | B | ____ |
| ____ | In chìa/pepper/.env, niêm phong 3 phong bì | C | ____ |
| ____ | Mount NAS, backup tay, đặt cron | D | ____ |
| ____ | Nhập dải IP, nhập Excel thiết bị, đối chiếu | F | ____ |
| ____ | Backup tay sau nhập liệu | D2 | ____ |
| ____ | Mở cho người dùng, gửi thông báo | — | ____ |

Chọn giờ ngoài giờ cao điểm. Chừa ít nhất **2 giờ** dự phòng trước giờ mở cho người dùng.

## 4. Khi nào thì dừng / quay lại

Chỉ huy go-live **dừng và quay lại** nếu gặp một trong các điều sau:

- Không đăng nhập được từ một site sau 30 phút xử lý
- Mail hệ thống không tới hộp thư thật sau khi đã kiểm cấu hình SMTP
- Backup tay đầu tiên không in `✓ Xong`
- Nhập Excel báo lỗi mà không sửa được trong buổi

**Quay lại** nghĩa là: người dùng tiếp tục dùng Excel/cách làm cũ; giữ nguyên máy chủ IMS để tìm
lỗi; hẹn ngày go-live mới. Chưa có dữ liệu thật nào chỉ nằm trong IMS nên quay lại không mất gì.

## 5. Chạy song song tuần đầu

Tuần đầu sau go-live, **vẫn ghi song song vào Excel cũ**. Cuối tuần đối chiếu số thiết bị,
license, IP giữa hai bên. Khớp → bỏ Excel. Lệch → tìm nguyên nhân trước khi bỏ.

Ghi mọi lỗi người dùng báo vào một bảng: ngày · ai báo · màn nào · mô tả · mức (cao/vừa/thấp) ·
đã xử lý chưa. Lỗi **cao** = mất dữ liệu, sai quyền, không đăng nhập được, sai số trên dashboard.

## 6. Thông báo cho người dùng (mẫu)

> Từ ngày ____, bộ phận IT dùng hệ thống IMS tại https://ims.pmh.com.vn để quản lý thiết bị,
> phần mềm, địa chỉ IP và mật khẩu hệ thống. Lần đăng nhập đầu, bạn sẽ đổi mật khẩu tạm và cài
> ứng dụng xác thực 2 lớp (Google Authenticator hoặc Microsoft Authenticator) trên điện thoại.
> Cần hỗ trợ: liên hệ ____ (____).
