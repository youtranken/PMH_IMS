# Quyết định nghiệp vụ và kỹ thuật — IMS

Đây là sổ các quyết định **đã chốt với chủ dự án**. Code và test phải khớp với sổ này. Muốn đổi
một quyết định thì sửa ở đây trước (ghi ngày và lý do), rồi mới sửa code.

Sổ thay cho `CAN-XAC-NHAN.md` (đã xoá ngày 27/09/2026, còn trong lịch sử git).

---

## Chốt ngày 26–27/09/2026, trước go-live

### Q-01 · Mạng và dải IP

- Toàn công ty là **một mạng duy nhất**. Site chính có 2 dải (172.16.x.x/24 và 192.168.x.x/24).
  Các site phụ dùng chung một trong hai dải đó, không site nào có dải riêng trùng với nơi khác.
- **Hệ quả:** mỗi địa chỉ IP là duy nhất trên toàn hệ thống. Hai dải chồng nhau bị chặn ở mọi
  site (checklist DB-02).
- Cột `site` của dải là tuỳ chọn. Vị trí thật của máy nằm ở hồ sơ thiết bị.
- Chỉ quản lý **IPv4**. Không làm IPv6.

### Q-02 · Trạng thái địa chỉ IP: 2 trạng thái

- Chỉ có **Trống** và **Đang dùng**. Bỏ "Nghi chết" và "Đã thu hồi".
- Nút **Thu hồi** đưa IP về Trống. Lịch sử `ip_history` vẫn ghi ai thu hồi và lúc nào.
- Hiện không có ping tự động. Nếu cần, làm **sau go-live**, dưới dạng cột "Lần cuối thấy phản hồi"
  để tham khảo. Ping không tự đổi trạng thái, vì Windows mặc định chặn ping và sẽ báo sai.

### Q-03 · Trạng thái phần mềm/license: 3 trạng thái, hệ thống tự chuyển

| Trạng thái | Chuyển vào khi | Mail nhắc | Ghế license |
| --- | --- | --- | --- |
| **Đang dùng** | mặc định; **tự** quay về khi nhập ngày hết hạn mới (sau ngày hôm nay) | có, "Sắp hết hạn" theo ngưỡng | tính |
| **Hết hạn** (không gia hạn) | **hệ thống tự chuyển** khi qua ngày hết hạn mà chưa có ngày mới | **không**, vì mail "sắp hết hạn" đã gửi trước đó | tính (vẫn cài trên máy) |
| **Thanh lý** | người bấm | không | **giải phóng ghế** |

- "Sắp hết hạn", "còn hạn" là **nhãn màu tự tính** từ ngày hết hạn, không phải trạng thái.
- Không có trạng thái "Đang chờ gia hạn".
- Bản ghi vĩnh viễn (perpetual, không có ngày hết hạn) thì luôn ở "Đang dùng" cho tới khi thanh lý.

### Q-04 · Đường truyền ISP

- Có **màn riêng**, không khai như một loại phần mềm.
- Trường giữ lại: mã, nhà mạng, băng thông, IP WAN (**1 IP mỗi line**), site, thiết bị Draytek,
  hotline, số hợp đồng, ngày bắt đầu, ghi chú.
- **Bỏ ngày kết thúc. ISP không còn nằm trong mail nhắc hạn.** Line không có hạn; khi không dùng
  nữa thì thanh lý.
- Trạng thái: **Đang dùng / Tạm ngưng / Thanh lý**. Thanh lý ghi ngày và người thanh lý; lịch sử
  giữ nguyên.
- Draytek là một **thiết bị**. Một Draytek gắn được nhiều line (dual-WAN, ví dụ FPT + Viettel).

### Q-05 · Bộ máy xin – duyệt dùng chung; chữ ký

- Break-glass và phiếu ISO (Epic 9) **dùng chung** bảng `approval`/`approval_history`: ai xin, lý do,
  ai duyệt, lúc nào, hạn, lịch sử. Nghiệp vụ của từng loại vẫn tách biệt (AD-6).
- **Break-glass:** duyệt điện tử. SA bấm nút trong mail, đi tới màn duyệt, đăng nhập và qua TOTP,
  rồi bấm Duyệt. Hệ thống ghi họ tên và thời điểm. **Không cần chữ ký.**
  - Link trong mail **không** tự duyệt khi chưa đăng nhập. Nếu làm vậy, ai có mail là mở được két.
  - Cải tiến nhỏ: link nên trỏ thẳng tới yêu cầu cụ thể thay vì cả màn duyệt.
- **Phiếu ISO (Epic 9):** in đúng mẫu có ô ký tay, ký sống, scan rồi đính kèm vào phiếu. Phiếu đã
  duyệt thì khoá nội dung. Họ tên người lập và người duyệt được in sẵn trên mẫu.
- Mỗi lần mở két ghi `audit_log` kèm `grantId`. Bảng `approval` chỉ giữ vòng đời của yêu cầu.

### Q-06 · Tài khoản và đăng nhập

- Production seed **2 SA**: `sa@pmh.com.vn` và `caothuan@pmh.com.vn`. Mật khẩu tạm sinh ngẫu nhiên,
  in ra đúng một lần. Admin và member tạo qua giao diện.
- Sai mật khẩu nhiều lần vào một tài khoản (từ bất kỳ IP nào): **chậm dần**. Sau 5 lần sai phải
  chờ 1 phút, sau đó 5, 15 rồi 60 phút. Chủ tài khoản và SA nhận mail. Không khoá cứng, để kẻ xấu
  không cố ý khoá được tài khoản của người khác. Các ngưỡng nằm trong `system_config`.

### Q-07 · Master key: làm công cụ rewrap TRƯỚC go-live

- Làm lệnh vận hành `rewrap`: mở lại từng DEK bằng chìa cũ, khoá lại bằng chìa mới. Chạy được
  nhiều lần, chạy lại được nếu bị ngắt giữa chừng.
- API **từ chối khởi động** nếu keyring thiếu một chìa mà vẫn còn dữ liệu dùng tới nó.
- Runbook có mục "Xoay chìa khi nghi lộ". Chỉ huỷ chìa cũ sau khi rewrap báo còn 0 bản ghi.

### Q-08 · Hạ tầng production

- Máy chủ **Ubuntu**, chỉ chạy IMS. Container `web` nhận thẳng cổng 443/80, không có proxy đứng
  trước. Giữ `trust proxy = 1`.
- **SMTP production dùng Google Workspace** (`smtp.gmail.com:587`, STARTTLS). Máy dev vẫn dùng
  mailpit. Compose production **bắt buộc** khai SMTP, không được rơi về mailpit.

### Q-09 · Tài liệu

- Chỉ giữ tài liệu còn sống trong `docs/`. Biên bản, code review, rà soát theo ngày thì xoá khi đã
  gom phần còn mở vào checklist; lịch sử nằm trong git.
