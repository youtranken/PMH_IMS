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
| **Thanh lý** | người bấm, **hoặc hệ thống tự chuyển sau 30 ngày Hết hạn (Q-13)** | không | **giải phóng ghế** |

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
- Sai mật khẩu nhiều lần vào một tài khoản (từ bất kỳ IP nào): **chậm dần**. Cứ mỗi 5 lần sai phải
  chờ 5, rồi 15, 30, 60 phút (bậc cuối lặp lại). Sai mã TOTP lúc đăng nhập cũng tính. Chủ tài khoản và SA nhận mail. Không khoá cứng, để kẻ xấu
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

### Q-10 · Chốt thêm ngày 27/09/2026

- Nhãn trạng thái IP đang có chủ là **"Đang dùng"** (không phải "Đang cấp"), cùng chữ với phần mềm
  và đường truyền.
- Đường truyền ISP đã **Thanh lý** hiện trong màn **Kho thanh lý** cùng thiết bị, phần mềm, tài
  khoản dịch vụ.
- Luật mail nhắc hạn có loại `isp` được gỡ loại đó; luật chỉ còn mỗi `isp` thì tắt.

### Q-11 · Chốt thêm ngày 27/09/2026 (đợt P1-2)

- **Bản sao lưu trên NAS không mã hoá** — NAS nội bộ, có phân quyền riêng. Rủi ro chấp nhận (DR-06).
- **Member được đính file** vào mọi hồ sơ họ xem được — người đi hiện trường chụp ảnh, biên bản
  (SEC-12, đúng chủ ý).
- **Nhà mạng bắt buộc chọn từ danh mục** (khoá ngoại thật); **người/bộ phận dùng** vẫn là ô chữ tự
  do có gợi ý (OLD-DB-01).
- **Thanh lý phần mềm khi còn ghế license: hệ thống tự gỡ các ghế đó**, mỗi ghế một dòng lịch sử
  (làm rõ Q-03 — không chặn, không bắt gỡ tay trước).

### Q-12 · Member được tạo và sửa danh mục (27/09/2026)

- **Mọi member được TẠO và SỬA mục trong tất cả danh mục**: site, tủ mạng, loại thiết bị, nhà
  cung cấp, phòng ban, nhà mạng, dịch vụ/port — không riêng nhà mạng.
- **Vô hiệu hoá, xoá và nhập hàng loạt từ Excel vẫn chỉ SA/Admin** (thao tác có thể làm hỏng dữ
  liệu hàng loạt). Chủ dự án muốn mở thêm thì sửa mục này trước.
- Đổi tên nhà mạng KHÔNG ghi vào lịch sử từng đường truyền — lịch sử danh mục đã ghi.

### Q-13 · Phần mềm Hết hạn quá 30 ngày thì hệ thống tự Thanh lý (27/09/2026)

Bổ sung Q-03. Lý do: hồ sơ đã hết hạn mà không gia hạn thì trên thực tế đã bỏ, để nó nằm mãi ở
dashboard và màn Sắp hết hạn chỉ làm nhiễu danh sách cần xử lý.

- Qua ngày hết hạn → **Hết hạn** (như Q-03). Trong **30 ngày ân hạn** hồ sơ vẫn hiện ở dashboard
  và màn Sắp hết hạn (màu quá hạn) để còn kịp gia hạn; nhập ngày hết hạn mới thì về Đang dùng.
- Hết hạn đủ 30 ngày mà chưa gia hạn → **hệ thống tự chuyển Thanh lý**: tự gỡ mọi ghế license
  (mỗi ghế một dòng lịch sử, người thực hiện là `system`), ghi ngày thanh lý. Từ đó hồ sơ chỉ
  nằm ở Kho thanh lý, không còn ở dashboard hay màn Sắp hết hạn.
- Số ngày ân hạn nằm trong `system_config` (AD-11), mặc định 30.
- Hồ sơ đã Thanh lý (tay hoặc tự động) **khôi phục được bằng Sửa hồ sơ**: chọn trạng thái Đang
  dùng và nhập ngày hết hạn mới từ hôm nay trở đi — vì thực tế có lúc gia hạn license trễ hơn 30
  ngày. Ghế đã gỡ KHÔNG tự gán lại; gán lại bằng tay. Nút Gia hạn vẫn không dùng cho hồ sơ đã
  Thanh lý (BE-13), để việc "hồi sinh" luôn là một thao tác Sửa có chủ ý.
- Bản ghi vĩnh viễn (không có ngày hết hạn) không bị ảnh hưởng.

### Q-14 · Đợt sửa giao diện mức cao (28/09/2026)

Chủ dự án giao Claude tự quyết các mục mức cao trong báo cáo soát UI/UX (ims.pmh.com.vn:8443).
Những điểm chạm nghiệp vụ/bảo mật chốt như sau:

- **Quên mật khẩu / mất điện thoại 2 lớp: KHÔNG làm tự đặt lại qua email** (chủ dự án chốt bỏ
  hẳn ngày 28/09/2026, không còn là việc hoãn). Màn đăng nhập và màn mã 2 lớp chỉ hướng dẫn liên
  hệ người quản trị; nội dung liên hệ nằm trong `system_config` (`auth.support_contact`, sửa ở màn
  Tham số hệ thống). Lý do: luồng đặt lại qua mail là một mặt tấn công mới, đội IT nhỏ, SA luôn ở
  gần. Mã dự phòng (backup codes) cũng không làm.
- **Hồ sơ của tôi**: người dùng tự đổi mật khẩu (phải nhập mật khẩu hiện tại), tự cài lại 2 lớp
  trên điện thoại mới (đang có 2 lớp thì phải nhập mã 2 lớp hiện tại trước), xem và đóng các
  phiên khác của chính mình.
- **Màn Tham số hệ thống** (`system_config`): chỉ SA, phải xác thực lại (step-up), mọi lần sửa ghi
  nhật ký. Chỉ các khoá có trong danh sách khai báo trong code mới sửa được (kiểu + khoảng hợp
  lệ); khoá kỹ thuật/bí mật không hiện.
- **Break-glass**: người xin nhận email khi được duyệt / bị từ chối / bị thu hồi sớm. Email xin
  duyệt ghi đối tượng (mã + tên) và số giờ xin, **không** ghi tên secret. Người xin tự rút được
  yêu cầu đang chờ. Đăng nhập xong thì quay về đúng trang đã mở (chỉ đường nội bộ).
- **Tạo tài khoản**: vẫn dùng mật khẩu tạm (chưa gửi mail mời); hộp kết quả có nút chép và các
  bước tiếp theo.
- **Hồ sơ IP phải gắn thiết bị hoặc người/bộ phận** (làm rõ Q-02: có hồ sơ là Đang dùng) — API
  từ chối hồ sơ trống.
- **Loại thiết bị có cờ "Router/Firewall"**; ô Router của NAT chỉ liệt kê loại có cờ này (có lựa
  chọn hiện mọi thiết bị).
- **Mục danh mục đã vô hiệu không chọn MỚI được** ở mọi form (UI ẩn, API từ chối). Hồ sơ đang trỏ
  tới mục đó giữ nguyên và hiện nhãn "(ngừng dùng)".
- Tìm thiết bị theo cả IP, người sử dụng và bộ phận; tìm nhanh (Ctrl+K) tìm được IP và dải mạng.
- **Không có khái niệm "mức nhạy cảm"** cho thiết bị/két (chip trên phiếu duyệt break-glass): chủ
  dự án chốt bỏ ngày 28/09/2026. Người duyệt đánh giá rủi ro qua mã · tên · site · loại của đối tượng.

### Q-09 · Tài liệu

- Chỉ giữ tài liệu còn sống trong `docs/`. Biên bản, code review, rà soát theo ngày thì xoá khi đã
  gom phần còn mở vào checklist; lịch sử nằm trong git.
