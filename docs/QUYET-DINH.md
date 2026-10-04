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
- Trường giữ lại: mã, nhà mạng, băng thông, IP WAN (~~1 IP mỗi line~~ — nhiều IP, xem Q-20), site, thiết bị Draytek,
  hotline, số hợp đồng, ngày bắt đầu, ghi chú.
- **Bỏ ngày kết thúc. ISP không còn nằm trong mail nhắc hạn.** Line không có hạn; khi không dùng
  nữa thì thanh lý.
- Trạng thái: **Đang dùng / Tạm ngưng / Thanh lý**. Thanh lý ghi ngày và người thanh lý; lịch sử
  giữ nguyên.
- Draytek là một **thiết bị**. Một Draytek gắn được nhiều line (dual-WAN, ví dụ FPT + Viettel).
- **Làm rõ (30/09/2026, chủ dự án chốt):** "băng thông" là **tốc độ gói cước** của từng line —
  giao diện và file Excel gọi là **"Tốc độ gói cước"**. Nó thuộc đường truyền, không thêm cột tốc
  độ vào danh mục Nhà mạng (một nhà mạng bán nhiều gói khác tốc độ).

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
- **Chữ "Thanh lý" (28/09/2026, chủ dự án chốt):** nhãn TRẠNG THÁI luôn là **"Đã thanh lý"** (kết
  quả, kể cả khi hệ thống tự chuyển); **"Thanh lý"** chỉ là nhãn HÀNH ĐỘNG (nút bấm) đưa hồ sơ
  sang trạng thái đó. Áp cho thiết bị, phần mềm, đường truyền và Kho thanh lý — chỗ nào lấy
  "Thanh lý" làm nhãn trạng thái (kể cả file Excel xuất ra) hay "Đã thanh lý" làm nhãn nút thì sửa
  theo luật này. Làm rõ chữ trong Q-03/Q-04, không đổi vòng đời.
- **Phần mềm loại "Khác" có ngày hết hạn (28/09/2026, chủ dự án chốt):** "Khác" chỉ là một loại
  như mọi loại khác — hồ sơ có ngày hết hạn thì là **nguồn hạn**: hiện ở màn Sắp hết hạn, vào mail
  nhắc, và đi cùng vòng đời Q-03/Q-13 (Hết hạn → tự Đã thanh lý sau ân hạn). Lý do: trước đây nó
  bị lượt quét "xử" mà không hề được nhắc.

### Q-15 · Chốt sau đợt giao diện vừa + nhẹ (29/09/2026, chủ dự án chốt)

- **Tên gọi break-glass:** trên giao diện và email gọi là **"Xin mở két"** (người xin) và
  **"Duyệt mở két"** (người duyệt). Bỏ các tên "Break-glass", "Duyệt yêu cầu", "Xin quyền xem tạm
  thời", "Đập tủ kính" khỏi chữ người dùng đọc (mã, bảng, route giữ nguyên). Chữ "secret" trên giao
  diện, nhật ký và Excel đổi theo tên đang dùng ở màn két cho đồng bộ.
- **Quyền mở két gắn với PHIÊN đang dùng nó** (sửa lại 29/09/2026, chủ dự án chốt): yêu cầu
  **đang chờ** KHÔNG gắn phiên — người xin đăng xuất/hết phiên thì yêu cầu vẫn chờ, người duyệt
  vẫn duyệt được (trước đây lượt quét tự rút nó sau 30 phút ngồi chờ, mâu thuẫn với thư nhắc người
  duyệt sau `approval.reminder_hours` giờ). Khi được duyệt, người xin **không có bước nhận quyền
  riêng**: mở lại đúng thứ đã xin, bấm "Xem" và nhập mã 6 số như bình thường — **lần xem đầu tiên**
  gắn quyền với phiên đang xem. Từ lúc đó đăng xuất, hết phiên hay bị đóng phiên thì quyền hết,
  không chuyển sang phiên khác, muốn xem tiếp phải xin lại. Giờ được cấp tính từ lúc duyệt.
  Người xin tự "Trả quyền" sớm được. Yêu cầu chờ **quá 8 giờ** không ai quyết thì tự hết hạn
  (`breakglass.pending_expire_hours`, mặc định 8; thư nhắc người duyệt phải đến trước mốc này).
  Lý do: quyền xem mật khẩu không sống lâu hơn người đang ngồi trước máy, việc CHỜ duyệt không
  bắt người xin ngồi canh trang, và một yêu cầu treo lâu không được thành vé mở két lúc nào cũng
  dùng được.
- **Vô hiệu hóa tài khoản** tự rút mọi yêu cầu mở két đang chờ của người đó (cùng transaction,
  ghi nhật ký). Quyền két theo nhóm giữ nguyên để bật lại là như cũ.
- **Hồ sơ IP nhập nhầm:** nút là **"Xóa"** — xóa để nhập lại (không khôi phục trên giao diện; vết
  vẫn nằm trong nhật ký hệ thống).
- **Danh mục** dùng **"Ngừng dùng / Dùng lại"** như dải IP, tài khoản dịch vụ, luật NAT. Tài
  khoản người dùng IMS giữ "Vô hiệu hóa / Bật lại".
- **Gia hạn từ màn Sắp hết hạn** cũng ghi được số hợp đồng và chi phí vào sổ gia hạn. Không có
  nút Hoàn tác (sai ngày thì Sửa hồ sơ). Màn Sắp hết hạn không cần mốc "Tháng sau / Quý sau".
- **Lưu giá trị mới vào két:** không bắt tick "Tôi đã đổi trên thiết bị" — chỉ cảnh báo.
- **Thuật ngữ:** **"Ngừng dùng / Dùng lại"** cho dải IP, tài khoản dịch vụ, luật NAT; NAT dùng
  **"luật NAT"**, **"cổng ngoài"**, **"cổng trong"** thay cho rule/port. Mục menu Hệ thống
  "Tài khoản" đổi thành **"Người dùng IMS"**. Chữ tiếng Việt viết thống nhất kiểu **"khóa",
  "hóa"** (dấu trên chữ cái chính, đang chiếm đa số trong giao diện).
- **Mở lại thiết bị đã thanh lý:** về **"Đang dùng"** (như cũ). Đổi trạng thái thiết bị **không**
  bắt ghi lý do.
- **Gia hạn phần mềm:** số hợp đồng và chi phí của MỖI lần gia hạn ghi vào sổ lịch sử gia hạn
  (`renewal_history`), không thêm cột vào hồ sơ phần mềm.
- **Gán license:** có lối chọn nhanh máy theo phòng ban / người sử dụng.
- **Danh mục:** hiện số "đang dùng ở N thiết bị/hồ sơ" cho từng mục. KHÔNG tách ô "Email / người
  liên hệ" của nhà cung cấp.
- **Bảng điều khiển:** không tự làm mới định kỳ (mỗi lần đăng nhập đã tải mới).
- **"Bộ giao diện" (`/dev/components`) không có ở bản production** — chỉ bật trong stack dev/E2E.
- **Hạn đổi mật khẩu trong két: 180 ngày** (`dashboard.secret_stale_days`, giữ 180). Danh sách
  ngăn két và danh sách tài khoản dịch vụ có cột **"Đổi lần cuối"** (ngày) kèm đếm ngược "còn N
  ngày"; quá hạn thì "Quá N ngày — cần đổi". Đổi giá trị xong thì đếm lại từ đầu. Khi đổi giá trị
  luôn nhắc: IMS KHÔNG nối tới máy chủ/thiết bị — phải đổi trên hệ thống thật trước (ảnh hưởng
  prod), rồi mới lưu vào két.
- **Xem giá trị trong két:** gộp popup két, bước nhập mã 6 số và bước hiện giá trị thành MỘT hộp
  chạy theo bước (không chồng 3 lớp hộp, VLT-062).
- **SSL / tên miền (SW-043):** không thêm bộ trường SSL riêng. Chỉ cần ghi lại **website nào dùng
  chứng chỉ SSL nào, theo từng năm** — danh sách website trên hồ sơ SSL, và mỗi lần gia hạn lưu
  lại danh sách website của kỳ đó trong sổ lịch sử gia hạn.
- **Luật NAT không có hạn "rà lại"** (chủ dự án chốt, 29/09/2026).
- Chưa làm: lưới mặt trước switch (cần trường "số cổng" theo model).

### Q-16 · Chốt khi rà checklist go-live (29/09/2026, chủ dự án chốt)

- **Màn đăng nhập giữ mã lỗi riêng** cho tài khoản bị khóa / bị vô hiệu hóa (`ACCOUNT_LOCKED`,
  `ACCOUNT_DISABLED`), không gộp thành "sai email hoặc mật khẩu". Người dùng phải biết vì sao không
  vào được để gọi đúng người. Rủi ro chấp nhận: người ngoài dò được một email có tồn tại hay không
  (SEC-10 — không sửa).
- **Tên hành động của danh mục trong nhật ký giữ theo từng loại** (`catalog.site.created`,
  `catalog.vendor.created`…) dù API khai tên chung `catalog.created`: nhật ký phải nói rõ đã đụng
  loại danh mục nào (OLD-BE-03 — giữ như cũ).
- **VLAN của cổng thiết bị giữ kiểu chữ**: chỉ nhận để trống, `trunk`, hoặc số 1–4094. Không đổi sang
  kiểu số vì sẽ mất giá trị `trunk` hay gặp trên cổng uplink (OLD-DB-04).

### Q-17 · Gộp migration trước go-live (30/09/2026, chủ dự án chốt)

- **Gộp 96 file migration thành 34 file theo bảng** (`0000_extensions` … `0033_service_account`):
  mỗi file là trạng thái cuối của một bảng (hoặc bảng + bảng lịch sử của nó), gồm cột, ràng buộc,
  chỉ mục, trigger, quyền và dữ liệu gieo. Lý do: chưa có dữ liệu thật ở đâu cả, và muốn bản
  production gọn — đọc một file là biết một bảng, không phải lần qua chuỗi ALTER.
- Lược đồ cuối **trùng hệt** bộ cũ (so bằng `pg_dump` và catalog, cả khi migrate bằng superuser lẫn
  bằng `ims_owner`), trừ hai chỗ cố ý: khoá ngoại `device_cabinet_same_site_fkey` được xác nhận luôn
  (NOT VALID chỉ để khỏi quét dữ liệu cũ), và chú thích trong thân hàm `ip_address_within_subnet`.
- **Từ nay chỉ thêm file mới đánh số sau `0033`.** Luật "không sửa migration đã có, kể cả chú thích"
  áp lại nguyên vẹn cho 34 file này.
- **DB dựng trước khi gộp (chỉ có ở máy dev) phải dựng lại từ đầu.** Runner nhận ra journal cũ và
  dừng với câu nói rõ việc phải làm, không áp bộ mới lên trên.

### Q-18 · Góp ý giao diện "Fix lỗi IMS" (30/09/2026, chủ dự án chốt)

- **Màn đăng nhập bỏ nút "Quên mật khẩu?"** (sửa Q-14). Câu liên hệ quản trị vẫn hiện khi tài
  khoản bị khóa / vô hiệu hóa (Q-16); màn nhập mã 2 lớp vẫn giữ "Không lấy được mã?".
- **Không hiện dòng "Email đã nhớ trên máy này… Không phải tôi"**; ô Email vẫn được điền sẵn.
- **Nút xem mật khẩu (con mắt) tự che lại** khi rời ô hoặc sau 10 giây.
- **Luật mật khẩu giữ 3 trong 4 nhóm** (NFR-01). Bảng kiểm hiện riêng từng nhóm (thường, hoa, số,
  ký tự đặc biệt), độ dài và "nhập lại khớp".
- **Số điện thoại** (danh mục, đường truyền, người dùng IMS): nhận chữ số, dấu `+` ở đầu, và các
  dấu trình bày quen dùng — dấu cách, `-`, `.`, `(`, `)`; lưu thì bỏ hết các dấu trình bày, chỉ còn
  chữ số và `+` đầu. Chữ cái và ký tự khác vẫn bị từ chối. *(Sửa 01/10/2026: bản đầu từ chối
  `-`, `.`, `( )`, làm hồ sơ cũ nhập kiểu "(028) 3822-1234" không lưu lại được khi form gửi lại
  số không đổi — chuẩn hoá thay vì từ chối.)*
- **Giấy tờ đính kèm:** tối đa 25 MB mỗi file, tối đa 6 file mỗi lượt chọn (đưa vào
  `system_config`, AD-11). Nhận thêm Word/PowerPoint dạng mới (docx, pptx); loại có macro và file
  chạy được (exe, ps1, js…) vẫn bị chặn theo nội dung, không theo đuôi. File đã xoá giữ nội dung
  thêm `file.purge_after_days` ngày (mặc định 30) rồi mới gỡ khỏi ổ đĩa; tên file và nhật ký vẫn
  giữ (30/09/2026: xoá mềm giữ blob mãi thì ổ đĩa chỉ lớn lên).
- **Thuật ngữ:** "Phòng ban" thay cho "Bộ phận" trên toàn hệ thống; ô chọn trên hồ sơ thiết bị ghi
  "Phòng ban sử dụng". Import Excel vẫn nhận cột "Bộ phận" của file cũ.
- **Thao tác trên dòng / trang chi tiết:** nút "Sửa" để ngoài; mọi thao tác khác vào menu ⋮ (ba
  chấm dọc) — đổi đồng loạt mọi màn.
- **Két — loại ngăn "Mã 2 lớp"** (mở rộng FR-021): lưu chuỗi bí mật / `otpauth://` mã hoá như mọi
  ngăn; khi xem hiện chuỗi, mã QR sinh lại từ chuỗi và mã 6 số hiện tại. Không lưu ảnh QR thành
  file (ảnh QR chính là bí mật dạng rõ); có thể đọc ảnh QR ngay trên trình duyệt để điền chuỗi,
  ảnh không gửi lên.
- **Một lần xác thực mã 2 lớp dùng cho mọi thao tác két** trong `secret.stepup_grace_minutes`.
- **Ghi chú của ngăn két không được chứa mật khẩu:** server từ chối, không chỉ nhắc (FR-035).
- **Topbar không lặp tên màn:** tên màn chỉ là `<h1>` của trang; topbar hiện tên nhóm menu ("Tài
  sản", "Hệ thống"…) làm ngữ cảnh. Tab trình duyệt vẫn mang tên màn.
- **Menu gọn cho màn laptop:** bỏ mục "Tài liệu" (chưa có màn); nhóm "Hệ thống" mặc định khép,
  tự mở khi đang ở màn trong nhóm, nhớ lựa chọn trên từng máy. Menu SA khi khép phải vừa màn
  cao 768px không cuộn.

### Q-19 · Rà các màn còn lại theo góp ý Q-18 (01/10/2026, chủ dự án chốt)

- **Ghi chú / mô tả / lý do ngoài két** (thiết bị, đường truyền, NAT, IP, dải, tài khoản dịch vụ,
  ghế license, danh mục, nhập Excel) chứa chuỗi trông như mật khẩu thì **bị chặn** như ghi chú
  két (FR-035, SEC-20). Dữ liệu đang có: chạy một lượt quét **báo cáo** (không tự sửa) để SA rà.
- **Kho thanh lý:** màu trạng thái theo đúng màn gốc ("Đã ngừng dùng" đỏ). Thao tác "Dùng lại"
  cho thiết bị / tài khoản dịch vụ / đường truyền dẫn sang trang hồ sơ đó (không làm tại kho).
- **Thẻ dải IP** giữ "Sửa" trong menu ⋮ (thẻ hẹp) — ngoại lệ của luật "Sửa để ngoài".
- **"Thu hồi IP"** tô màu cảnh báo (cam), không phải đỏ: IP về pool và cấp lại được.
- **Trang chi tiết phần mềm:** "Gia hạn" giữ ngoài cạnh "Sửa" (việc chính); "Khôi phục" vào ⋮.
- **Màn Tham số hệ thống:** mô tả dài hơn ~80 ký tự chuyển vào nút (i).
- Số điện thoại hiển thị tách nhóm; tên công ty trên màn đăng nhập là "Phú Mỹ Hưng".
- **Thương hiệu PMH (01/10/2026, phương án B):** giữ nguyên hệ màu hiện tại (không đổi token
  màu), chỉ thêm logo PMH và ảnh nền đăng nhập. Màn đăng nhập: mảng ảnh bên trái RỘNG hơn form
  bên phải, khoảng 60/40, để ảnh lộ nhiều hơn; ≤720px bỏ ảnh, chỉ còn card có biểu tượng PMH.
  Sidebar, favicon và biểu tượng cài lên màn hình chính dùng biểu tượng PMH. Lý do: người mở
  link từ thư nhận ra ngay trang của PMH, mà không phải dựng lại bảng màu đã soát tương phản.

### Q-20 · Góp ý "Fix lỗi IMS_2" (01/10/2026, chủ dự án chốt)

- **Một thiết bị giữ tối đa MỘT IP đang cấp** (sửa ngầm định cũ "một máy nhiều IP"). DB chặn bằng
  chỉ mục duy nhất trên `ip_address(device_id)` cho hàng đang dùng. Máy đã có IP thì nút là
  **"Đổi IP"**: thu hồi IP cũ và cấp IP mới trong một transaction (AD-5), IP cũ về pool.
  IP gán cho người / phòng ban (không gắn máy) không bị luật này ràng.
- **Màn đăng nhập:** cột trái chỉ còn ảnh; logo PMH (giữa) + "IMS — Quản lý hệ thống IT" sang cột
  form. Ba dòng giới thiệu chỉ hiện ở màn đăng nhập; các bước mã 2 lớp / đổi mật khẩu chỉ có logo
  (sửa Q-19).
- **Bước nhập mã 2 lớp khi đăng nhập:** có nút "Quay lại" (đăng xuất phiên chờ rồi về
  `/login`); để trống thì báo "Vui lòng nhập mã xác thực."; bỏ câu gợi ý dưới ô. Phiên chờ mã
  sống tối đa `auth.totp_challenge_minutes` phút (mặc định 5, AD-11) tính từ lúc tạo; tải lại
  trang ở bước này cũng về `/login`. Không áp cho luồng cài 2 lớp bắt buộc.
- **Nhóm "Dành cho nhà phát triển"** bỏ khỏi menu kể cả bản dev; route `/dev/components` giữ.
- **Hồ sơ đã thanh lý / đã ngừng dùng** ẩn khỏi danh sách Thiết bị, Phần mềm, Đường truyền,
  Tài khoản dịch vụ theo mặc định; vẫn xem được khi lọc đích danh trạng thái đó, Ctrl+K vẫn tìm
  ra, và Kho thanh lý là nơi xem tập trung.
- **Mở lại thiết bị đã thanh lý** trên hồ sơ ghi "Đổi trạng thái"; Kho thanh lý giữ "Dùng lại".
- **"Dự phòng" và "Hỏng" chỉ là nhãn:** vẫn nhắc hạn bảo hành, vẫn giữ IP và license.
- **Dải IP:** nút "Thêm dải mạng" (VLAN chỉ là thuộc tính tuỳ chọn của dải); ô site của dải để
  trống nghĩa là "Tất cả site (dùng chung)"; màn IP có bộ lọc site; mọi bộ lọc ghi "Tất cả site".
  Cột Site của IP lấy từ hồ sơ thiết bị (làm rõ Q-01); IP không gắn máy hiện "—".
- **Xuất Excel màn IP:** menu "Xuất dải đang xem" / "Xuất tất cả".
- **Tra IP sai định dạng** (mỗi phần 0–255, đủ 4 phần): khung đỏ có nút ✕ dưới ô tra, không gọi
  tìm kiếm.
- **Két:** chữ đổi giá trị theo loại ngăn — "Đổi mật khẩu" / "Đổi license key" / "Đổi mã 2 lớp"
  / "Đổi giá trị". Gán / gỡ quyền ở ma trận hỏi mã 6 số khi hết thời gian ân hạn.
- **NAT / Đường truyền:** ô chọn thiết bị có **lọc theo loại** (Firewall, Core, Router… tuỳ người
  dùng chọn, mặc định các loại có cờ Router). Chọn máy không phải router chỉ cảnh báo, không chặn.
  "Thiết bị biên" đổi thành "Thiết bị".
- **Tài khoản dịch vụ có ngày hết hạn** (tuỳ chọn): cột "Hết hạn", nhắc trước như các hạn khác,
  có Gia hạn. Quá hạn chỉ nhắc, không tự ngừng dùng (IMS không nối tới VPN thật). Khác cột "Đổi
  lần cuối" (hạn đổi mật khẩu, Q-15).
- **Lịch sử** mọi màn dạng trục dọc "ga tàu"; desktop ngày ở cột trái, màn hẹp dưới dòng.
- Thuật ngữ: "Chưa khai báo", "Lưu và nhân bản", "Nhập tiếp"; nút bỏ file là dấu ✕ đỏ.
- **Mật khẩu tạm** (tạo tài khoản, đặt lại mật khẩu) hết hạn sau `auth.temp_password_hours` giờ
  (mặc định 24, AD-11); quá hạn thì đăng nhập bị từ chối, SA phải đặt lại. Lần đầu đăng nhập bằng
  mật khẩu tạm vẫn bắt đổi mật khẩu như cũ. **Mật khẩu thường không có hạn định kỳ:** chỉ bắt đổi
  khi SA đặt lại hoặc nghi lộ — đã có xác thực 2 lớp, ép đổi theo lịch chỉ sinh mật khẩu dễ đoán
  (NIST SP 800-63B §5.1.1.2).
- **Tham số trạng thái lạ trên URL** (`?status=abc`) coi như bộ lọc mặc định — hồ sơ đã thanh lý
  vẫn ẩn; muốn xem thì lọc đích danh hoặc vào Kho thanh lý.
- **Sơ đồ cổng:** mỗi cổng chỉ một sợi cáp, kiểm cả hai chiều (A:p1→B:g1 thì B:g1 không nối đi nơi
  khác); tên cổng không phân biệt hoa/thường.
- **IP WAN — sửa Q-04:** một đường truyền có **nhiều IP WAN** (nhà mạng có thể cấp 2–3 IP). Chỉ
  khai từng IP lẻ, không khai dải (nhà mạng chỉ gửi IP, không gửi mask). Lưu ở bảng riêng, mỗi
  hàng một IPv4. Không chặn
  trùng giữa các đường truyền; trong cùng một đường thì không lặp. Danh sách, tìm kiếm, Ctrl+K và
  Excel hiện / tìm theo mọi IP; nhập Excel nhận nhiều IP ngăn bằng dấu phẩy.
- **Người dùng IMS đã vô hiệu hoá** ẩn khỏi danh sách theo mặc định; lọc đích danh mới hiện.

### Q-21 · Góp ý "Fix lỗi IMS_3" (02/10/2026 — Claude đề xuất trong đêm, chủ dự án xác nhận cùng ngày)

Chủ dự án giao làm qua đêm "tương tự IMS_2"; các điểm dưới là đề xuất Claude tự chọn, đảo được
nếu chủ dự án không đồng ý.

- **Giao diện mặc định là SÁNG** cho người chưa chọn (chủ dự án đổi lại sau khi xem bản tối mặc
  định; lựa chọn đã lưu trên máy vẫn giữ). Bảng màu tối sáng lên khoảng 2 nấc (nền, mặt thẻ,
  viền), vẫn giữ tương phản chữ ≥ 4.5:1 và viền ô ≥ 3:1.
- **Hiệu ứng chuyển động nhẹ:** đổi màu nền / viền / bóng 150–200 ms khi rê chuột (mục menu, thẻ,
  chip, nút, dòng bảng), thẻ dashboard nhấc 1px. Không dùng chuyển động lớn; tắt hết khi hệ điều
  hành bật "giảm chuyển động" (`prefers-reduced-motion`).
- **Nút "Quay lại"** ở bước nhập mã 2 lớp: rê chuột tô đỏ nhạt (token `--danger-soft`).
- **Bảng điều khiển:** "Tổng hợp hết hạn cần xử lý", "Tổng hợp kho thanh lý (7 ngày)".
- **Luật két:** đưa vào một nút mở hộp đọc, không chiếm chỗ cố định trên trang.
- **Tham số hệ thống:** nút "Bỏ thay đổi" / "Lưu nhóm này" cỡ nhỏ, ở thanh dính đáy; còn thay đổi
  chưa lưu mà đổi tab, bấm sang màn khác trên menu / Ctrl+K / nút lùi của trình duyệt, đóng hoặc
  tải lại tab thì hỏi: Lưu nhóm này / Bỏ thay đổi / Ở lại.
- **Ma trận quyền két:** danh sách loại thiết bị dài thì chia 2 cột, không cuộn trong ô nhỏ; thẻ
  quyền theo người quá nhiều thì hiện vài thẻ + "+N" bấm để xem hết.
- **Người dùng IMS:** "Bắt buộc – chưa kích hoạt" thay "Bắt buộc – chưa cài"; dòng chỉ để nút chính,
  còn lại vào ⋮ (Q-18).
- Chữ mô tả dài trên màn rộng chạy một hàng (không ép xuống dòng khi còn chỗ).
- **Ô nhập mã 2 lớp là 6 ô riêng (03/10/2026, chủ dự án):** mỗi ô một số, áp cho mọi chỗ nhập mã
  (bước "Xác thực 2 lớp" lúc đăng nhập, cài/cài lại 2 lớp, hộp xác thực lại để xem két). Gõ một
  số tự sang ô kế; Backspace ở ô trống lùi về ô trước và xoá nó; ←/→/Home/End di chuyển; dán
  hoặc tự điền cả mã (kể cả "123 456") vào ô nào cũng đổ đủ 6 ô. Đủ 6 số vẫn tự gửi, đúng một
  lượt như trước. Lý do: người dùng chép từng số từ ứng dụng xác thực và soát được từng số.
- **6 ô mã chia đều + chuyển động (04/10/2026, chủ dự án):** 6 ô trải đều hết bề ngang khung (không
  dồn trái), ô đang gõ sáng viền + nhấc nhẹ + con trỏ nháy, gõ số thì ô "nảy". Đủ 6 số đang kiểm
  thì cả 6 ô cùng xoay chậm theo chiều kim đồng hồ, tối thiểu trọn một vòng (~1,2 giây, lặp tới
  khi server trả lời — chủ dự án 04/10 muốn thấy rõ vòng xoay); mã đúng thì 6 ô gộp
  thành 1 ô có dấu tích xanh, giữ một nhịp rồi mới vào (thêm ≤ ~0,9 giây); sai mã thì về 6 ô, cả
  hàng lắc + đỏ. "Giảm chuyển động": không xoay/gộp/lắc, hiện dấu tích và đi tiếp ngay. Lý do:
  góp ý "ô không đều", và chủ dự án muốn hiệu ứng như ứng dụng hiện đại (mẫu chủ dự án gửi).
- **Mã đúng theo mẫu "Glassy OTP" + công tắc chuyển động (04/10/2026, chủ dự án):** thay bullet
  trên ở phần đang kiểm/thành công. Đủ 6 số đang kiểm: 6 ô rời hàng, xếp lên một VÒNG TRÒN quanh
  tâm hàng ô rồi cả vòng quay theo chiều kim đồng hồ (ô nghiêng theo vòng, viền sáng ấm), tối
  thiểu trọn một vòng, lặp tới khi server trả lời và chỉ dừng ở mốc trọn vòng. Mã đúng: các ô
  đứng thẳng lại, hội tụ vào tâm thành MỘT ô trống, viền ô đổi màu nhấn, một vòng xanh loang ra
  quanh ô rồi hiện dấu tích; cùng lúc tiêu đề đổi thành "Đã xác thực thành công" (kèm dòng phụ)
  và nút chính chuyển xanh "Đã xác thực" — cả chuỗi ~2,5–3 giây rồi mới vào. Sai mã: bỏ vòng,
  ô bay về hàng, lắc + đỏ như cũ. Hộp xác thực lại (nhỏ hơn) dùng cùng hiệu ứng thu nhỏ.
  Thêm lựa chọn "Hiệu ứng chuyển động" trong Hồ sơ của tôi (cạnh Giao diện): Theo hệ thống
  (mặc định) / Luôn bật / Tắt, lưu ở trình duyệt như lựa chọn theme. "Luôn bật" thắng báo "giảm
  chuyển động" của máy; "Tắt" bỏ chuyển động kể cả khi máy cho phép. Lý do: máy của chủ dự án qua
  phiên từ xa / máy ảo luôn báo "giảm chuyển động" nên không bao giờ thấy hiệu ứng.
- **Vi chuyển động dùng chung (04/10/2026, chủ dự án):** làm một lần trong `web/src/ui` để mọi màn
  hưởng, chỉ dùng `transform`/`opacity` (và `background-position` cho vệt sáng khung chờ), màu qua
  token có cặp tối, thời lượng qua `--dur-*`: (1) nút Lưu chính của hộp thoại: lưu xong hiện dấu
  tích ~0,7 giây rồi trở lại; (2) duyệt / phát hành thành công (két, sơ đồ): vòng xanh loang + dấu
  tích, dùng lại kiểu vòng xanh của ô mã 2 lớp; (3) số KPI trên bảng điều khiển đếm từ 0 lên khi
  hiện lần đầu (~0,6 giây); (4) bảng đang tải hiện các dòng khung chờ có vệt sáng quét thay chữ
  "Đang tải…" (trình đọc màn hình vẫn đọc "Đang tải"); (5) hộp thoại mở/đóng mờ dần + phóng nhẹ;
  tab: vạch dưới trượt sang tab mới, nội dung tab mờ dần vào; (6) vùng thả tệp: kéo tệp vào thì
  viền nhấc + nhịp, biểu tượng nảy; thả xong loé xác nhận. Tất cả tắt khi "Hiệu ứng chuyển động"
  là Tắt hoặc máy báo giảm chuyển động (trừ khi chọn Luôn bật). Lý do: chủ dự án muốn giao diện
  "sống" như ứng dụng hiện đại nhưng không được làm chậm thao tác.

### Q-22 · Tách "Phần mềm" thành các màn riêng (02/10/2026, chủ dự án chốt)

- Nhóm **Tài sản** trên sidebar: Thiết bị · **Phần mềm** (chỉ license) · **Tên miền & SSL** ·
  **Hợp đồng bảo trì** · **Dịch vụ có hạn khác** · Kho thanh lý. Lý do: để chung trong "Phần mềm"
  rồi lọc theo loại khiến người dùng không tìm ra SSL / tên miền / hợp đồng.
- **Tên miền & SSL** có hai loại hồ sơ: *Tên miền* và *Chứng chỉ SSL*. Một hồ sơ = một hoặc nhiều
  tên miền **dùng chung một ngày hết hạn** (khác hạn thì tạo hồ sơ khác). Tìm theo bất kỳ tên miền
  nào trong hồ sơ.
- IMS **không lưu file cert / khoá** (`.crt .pem .key .pfx .jks`…): chủ dự án tự bảo quản. IMS chỉ
  theo dõi hạn.
- Lưu trữ giữ một bảng `software` với cột `kind` (không tách bảng): nhắc hạn, gia hạn, két, lịch sử,
  thanh lý dùng nguyên như cũ; chỉ tách màn và menu.

### Q-23 · Epic 10 — Sơ đồ mạng thay Visio (02/10/2026, chủ dự án chốt qua buổi brainstorm)

Biên bản: `_bmad-output/brainstorming/brainstorm-so-do-mang-2026-10-02/.memlog.md`.

- **Làm Epic 10 trước Epic 8–9.** Vẽ mới, không nhập file Visio cũ.
- **Sơ đồ tĩnh gắn dữ liệu:** mỗi hình thiết bị là một hồ sơ trong kho; vẽ dây = khai một dòng sơ
  đồ cổng (luật một cổng một cáp áp nguyên). Cộng lớp vẽ tự do (khung tòa nhà/tầng/phòng/VLAN,
  đám mây ISP, chữ, mũi tên). Không giám sát sống trong Epic 10; chừa sẵn API nhận trạng thái từ
  máy giám sát ngoài và lớp "trạng thái sống" để cắm sau.
- **Cây bản vẽ:** Tổng công ty → site chính → site phụ → tầng → phòng → tủ rack. Tầng/phòng chỉ là
  tên bản vẽ, không thêm danh mục vị trí mới.
- **Biểu tượng SVG theo Loại thiết bị** (SA chọn hoặc tải SVG, lọc mã độc); thêm **ảnh thật** theo
  model hoặc theo từng máy (lấy từ giấy tờ đính kèm).
- **Phiên bản:** mỗi lần lưu là một phiên bản, hai người cùng sửa thì bản lưu sau thắng; lịch sử
  tóm tắt một dòng; đặt tên phiên bản quan trọng; phiên bản chụp lại thông tin thiết bị lúc đó;
  khôi phục bản trước. **Bản trình bày:** nhân bản từ bản chính thức thành bản tách rời (không duyệt,
  có thiết bị dự kiến + ảnh tự do, PDF ghi "BẢN TRÌNH BÀY"), không ảnh hưởng bản chính thức.
- **Duyệt:** bản của Thành viên phải gửi Admin duyệt mới thành chính thức; gửi duyệt thì hệ thống
  tự kiểm (lỗi chặn, cảnh báo cho qua); trả về kèm ghi chú ghim trên bản vẽ. Bản Admin/SA vẽ tự
  thành chính thức. Không bắt Admin bấm qua từng thay đổi — có tóm tắt và nút xem so sánh.
- **TOTP:** mọi lần xem bản vẽ (chính thức, phiên bản cũ, trình bày) đều phải nhập mã; nhập một lần
  xem tiếp trong 10 phút (tham số riêng). Phạm vi tách riêng với két: nhập ở đâu tính ở đó. Mỗi lần
  mở ghi nhật ký.
- **Cảnh báo lệch kho, không ép sửa:** máy thanh lý / đổi IP / đổi cổng sau khi vẽ thì hiện dấu.
- Không liên kết Epic 9 / phiếu 0213; không xuất Excel danh sách dây.
- **Chốt thêm (02/10/2026):** dây vẽ trong bản nháp chỉ ghi vào sơ đồ cổng khi bản được phát hành;
  xem cây bản vẽ (tên, trạng thái) không cần mã, mở nội dung mới hỏi TOTP; Admin/SA lưu là bản nháp,
  bấm "Phát hành" mới thành chính thức; chồng U trong cùng tủ thì chặn; ảnh theo model định danh
  bằng loại thiết bị + chuỗi model; loại dây seed sẵn **Cat6, Fiber, DAC** (SA thêm được).
- **Trình vẽ và sơ đồ cổng (02/10/2026, chủ dự án chốt trình vẽ sau khi xem mẫu khung vẽ tự viết):**
  - Trình vẽ là **draw.io (diagrams.net) tự host**: image `jgraph/drawio` ghim tag + digest, nhúng
    iframe chế độ embed, phục vụ qua nginx tại `/drawio/`, chạy offline trong mạng nội bộ (không
    đám mây, CDN, plugin). Lý do: sơ đồ mạng thật cần đi dây tự do và thư viện hình Cisco/rack, chủ
    dự án đã quen draw.io. Thay React Flow của kế hoạch cũ.
  - Nâng phiên bản draw.io 1–2 lần/năm hoặc khi có cảnh báo bảo mật: đổi tag → dựng lại → chạy E2E
    sơ đồ, giữ tag cũ để lùi (RUNBOOK).
  - **Sửa gạch "Chốt thêm" ở trên: bản vẽ KHÔNG ghi sơ đồ cổng**, kể cả lúc phát hành. Dây trên bản
    vẽ chỉ gắn với một dòng sơ đồ cổng đã có. Kết nối mới, kể cả nối hàng loạt, khai qua hộp sơ đồ
    cổng dùng chung và ghi ngay như ở trang thiết bị.
  - Lý do: nét vẽ draw.io kéo rời, nhân bản, xoá được tự do, nên suy ra cổng từ nét vẽ là đoán. Một
    kết nối có mặt ở nhiều bản vẽ, nên xoá dây trên một bản vẽ không thể nghĩa là xoá kết nối. Thành
    viên vốn được sửa sơ đồ cổng trực tiếp, nên bắt nó chờ duyệt bản vẽ là không nhất quán. Tự kiểm
    và cảnh báo lệch kho vẫn so dây với sơ đồ cổng (ARCHITECTURE-SPINE AD-17, AD-18).
- **Góp ý sau khi vẽ thử bản spike (03/10/2026, chủ dự án):** vào màn sơ đồ thì sidebar tự thu nhỏ
  (chỉ còn biểu tượng); trình vẽ chiếm toàn bộ phần còn lại; tab Sửa / Xem và các nút của IMS đưa
  lên một thanh mảnh phía trên trình vẽ; panel "Thiết bị kho" thiết kế lại gọn (không chiếm một cột
  cố định). Phiên bản, tô sáng đường dây của một thiết bị và ảnh thật thuộc các story của Epic 10;
  spike chỉ để xem draw.io chạy thế nào.
- **Mã 2 lớp lúc đăng nhập KHÔNG mở két hay sơ đồ (03/10/2026, chủ dự án xác nhận):** xem két và
  mở sơ đồ mỗi bên phải nhập mã riêng, mỗi bên có ân hạn riêng (két đổi hành vi so với trước: lần xem
  secret đầu tiên sau đăng nhập cũng hỏi mã).
- **Dây: "vẽ là khai, có hỏi" (03/10/2026, chủ dự án chốt).** Sơ đồ cổng vẫn là nguồn duy nhất.
  Kéo nét dây nối hai thiết bị kho → IMS hỏi "Khai kết nối này vào sơ đồ cổng?" (cổng còn trống hai
  đầu + loại dây) → "Khai" ghi thẳng sơ đồ cổng qua API của `devices`, "Chỉ vẽ" để nét vẽ kèm cảnh báo
  vàng. Xoá nét đã khai thì hỏi "Chỉ xoá nét vẽ" (mặc định) / "Gỡ luôn kết nối". Chiều ngược lại: đổi
  cổng / loại dây hiện ngay khi mở bản vẽ; kết nối bị gỡ thì nét chuyển đỏ; kết nối mới giữa hai máy
  đã có trên bản vẽ thì báo "Có N kết nối mới chưa vẽ" + nút "Vẽ vào". Nút "Khai kết nối" vẫn giữ.
  Gạch này bổ sung gạch 02/10 ("bản vẽ không ghi sơ đồ cổng"): LƯU hay PHÁT HÀNH bản vẽ vẫn không
  ghi gì vào sơ đồ cổng; chỉ khi người dùng bấm "Khai" (hoặc "Gỡ luôn kết nối") thì web mới gọi API
  của `devices`.
- **Chốt chi tiết (03/10/2026, chủ dự án):** xoá bản vẽ thử (bảng `diagram_spike` bỏ bằng migration
  mới ở story 10.3); rời màn sơ đồ sang menu khác thì sidebar mở rộng lại; đóng hộp Khai (✕/Esc) =
  "Chỉ vẽ"; nhân bản nét dây đã khai thì bản sao chỉ là nét vẽ (như copy-paste). Chủ dự án cho chạy
  liền Epic 10 tới hết, kể cả E2E đầy đủ và code review.
- **Sửa cũng hỏi mã sơ đồ (03/10/2026):** lưu, đặt tên, khôi phục phiên bản đều cần mã phạm vi sơ
  đồ như khi xem; hết ân hạn giữa lúc vẽ thì hỏi mã tại chỗ rồi lưu lại đúng bản đang vẽ. Xem cây
  bản vẽ (tên, trạng thái) không hỏi mã.
- **Thành viên quản bản trình bày của mình (03/10/2026, chủ dự án duyệt):** Thành viên đổi tên và
  lưu trữ được bản trình bày do mình tạo hoặc đang phụ trách (`created_by` / `owner_email`); bản của
  người khác và mọi bản chính thức vẫn chỉ Admin/SA (403 `DIAGRAM_MANAGE_FORBIDDEN`). Chủ bản trình
  bày chỉ đổi TÊN, không đổi người phụ trách hay loại nút. Lý do: bản trình bày là bản nháp riêng để
  xin mua sắm, không qua duyệt — bắt Admin dọn hộ là thừa; bản chính thức là hồ sơ chung.
- **Trình vẽ chạy tạm container `drawio` như bản thử;** khi làm Epic 10 chuyển sang phát tệp tĩnh của
  draw.io (đúng tag đã ghim) ngay trong container `web`, bỏ Tomcat.
- **Góp ý sau khi test tay Epic 10 (04/10/2026, chủ dự án):** hộp "Thiết bị kho" KHÔNG liệt kê máy
  đã thanh lý (chèn vào là vô lý); chế độ Xem phải hiện ĐÚNG như lúc Sửa (mọi nét/hình draw.io, kể
  cả dây nối tới hình tự do); ghim bình luận phải hiện tên hình (mã máy/nhãn) và nội dung bình luận
  ngay trên bản vẽ, không hiện id kỹ thuật; tạo bản vẽ con mặc định NHÂN BẢN nội dung từ bản cha
  để sửa tiếp (04/10/2026, rà soát mã: bản sao qua đúng luật gắn khung của lần lưu; khung hỏng —
  trỏ bản vẽ không nằm dưới bản con mới, tức mọi bản vẽ con của bản cha, hay dải/tủ đã ngừng dùng —
  bị GỠ GẮN, giữ hình và chữ, chứ không làm hỏng lượt tạo. Lý do: lỗi do dữ liệu bản cha, người tạo
  bản con không sửa được nó; để nguyên thì bản con lưu được một khung trỏ ngược lên nhánh khác); màn sơ đồ phải dùng được ngay không cần học — mỗi thao tác có (i) hướng dẫn, màn
  trống có các bước gợi ý.

### Q-24 · Góp ý giao diện 04/10/2026 (chủ dự án)

- **Dải nút chọn một (Thuê bao / Vĩnh viễn…) trong FORM trải hết bề ngang ô, các nút chia
  đều** — không dồn bên trái. Áp cho mọi dải nút nằm trong một ô form (Loại & Thời hạn phần
  mềm, màu dây, giao thức NAT, đầu bên kia của sơ đồ cổng, bản vẽ con, chọn máy theo…). Dải
  nút LỌC trên thanh công cụ của danh sách giữ cỡ theo chữ như cũ.
- **Ô số nguyên nhỏ có nút − / +** (bước 1, gõ tay vẫn được, mũi tên ↑/↓ trên bàn phím cũng
  tăng/giảm). Số ghế: nút − dừng ở max(1, số ghế đang dùng) — không bấm xuống dưới số máy đang
  cài; ô trống vẫn nghĩa là "không giới hạn", bấm + từ ô trống ra số nhỏ nhất hợp lệ; muốn về
  "không giới hạn" thì xoá tay. Áp cả ô "Số U" của thiết bị/tủ khi đặt vừa.
- **Ghi chú là một CỘT riêng luôn hiện** ở bảng ghế license (trang phần mềm, khu bung dòng) và
  bảng license đang cài của thiết bị; chữ dài rút một dòng, rê chuột thấy đủ, bấm để mở. Hợp
  đồng chuyển xuống dòng phụ của cột Kỳ hạn để bảng vẫn vừa 1366px; ở 390px thẻ vẫn có dòng
  Ghi chú.
- **Xem két = một hộp NHỎ duy nhất**: tiêu đề "Nhập mã 6 số để xem", tên ngăn, 6 ô mã, nút Hủy
  (bỏ đoạn giải thích dài của hộp xác thực lại). Mã đúng → chạy hiệu ứng vòng như mọi ô mã rồi
  CHÍNH hộp đó chuyển sang hiện giá trị: chữ hiện dần từ mờ sang nét, vòng tròn đếm ngược thời
  gian tự ẩn (`secret.reveal_seconds`), có **nút sao chép** (đảo luật cũ "không nút chép" — chủ
  dự án cần dán vào phiên SSH/console; chỉ chép khi bấm, không tự vào clipboard; FR-026 chỉ cấm
  xuất HÀNG LOẠT). Còn trong ân hạn thì bấm Xem mở thẳng hộp ở bước giá trị. Áp ở mọi chỗ có
  nút Xem, kể cả popup Két tổng và thẻ thiết bị trên sơ đồ: hộp nhỏ chồng lên popup (thay cho
  bước thay chỗ danh sách của VLT-062 — hộp nhỏ không che mất danh sách). Phạm vi mã vẫn là
  `vault`, mỗi lần xem vẫn một dòng nhật ký.
- **Chữ số đứng đầu cụm thì danh từ theo sau viết HOA chữ đầu:** "1 Tủ mạng", "3 Phần mềm",
  "12 Tài khoản · 30 Dòng quyền". Áp cho nhãn đếm / chip / dòng tóm tắt ở đầu câu hoặc đầu một
  cụm ngăn bằng "·". KHÔNG áp cho đơn vị đo (giờ, phút, giây, ngày, tháng, năm, lần, %, MB…):
  "5 ngày trước", "2 giờ" giữ nguyên — đó là lượng, không phải danh từ đếm hồ sơ.
  **Chỉ ở ĐẦU cụm** (bổ sung 04/10, chủ dự án): cùng nhãn đếm ghép vào GIỮA câu thì danh từ viết
  thường — "Đang dùng ở 1 tủ mạng — hãy Ngừng dùng", "…, trong đó 1 nhóm chưa gán cho ai",
  "1 Mục ĐÃ QUÁ HẠN, 3 mục sắp hết hạn".

### Q-09 · Tài liệu

- Chỉ giữ tài liệu còn sống trong `docs/`. Biên bản, code review, rà soát theo ngày thì xoá khi đã
  gom phần còn mở vào checklist; lịch sử nằm trong git.
