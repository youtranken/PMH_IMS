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
- **Break-glass:** ~~duyệt điện tử: SA bấm nút trong mail, đăng nhập, qua TOTP rồi bấm Duyệt~~ —
  **thay bằng duyệt bằng mã từ 20/10/2026, xem Q-30.** **Không cần chữ ký.**
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
- **Két sắt theo bốn màn của Q-22** (soát UX đợt 2, 05/10/2026, K-01/K-02): trang tổng Két có
  chip lọc riêng cho từng màn — Phần mềm · Tên miền & SSL · Hợp đồng bảo trì · Dịch vụ khác —
  thay cho một chip "Phần mềm" gom cả bốn; cột Loại ghi đúng màn. API trang tổng trả thêm màn của
  hồ sơ phần mềm (`softwareKind`, chỉ loại hồ sơ — không gì về nội dung két). Mã hồ sơ là link sang
  trang của chính màn đó (nút "Mở két" vẫn riêng).
- **Hạn đổi mật khẩu hiện ở mọi danh sách có két** (K-03): Thiết bị, bốn màn phần mềm, Đường
  truyền hiện dòng phụ "Đổi mật khẩu …" như Tài khoản dịch vụ (Admin/SA — Member không có bản đồ két).

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
- **Bỏ bản nháp, Xoá hẳn, ảnh lưu một lần (04/10/2026, chủ dự án chốt).** Sửa luật "phiên bản
  chỉ-thêm mãi mãi" của gạch Phiên bản ở trên. Lý do: mỗi lần lưu chép lại toàn bộ XML + ảnh xem,
  kể cả ảnh thật nhúng, nên kho phình theo số lần bấm Lưu; còn các lần lưu nháp sau bản chính thức
  phần lớn là bản vẽ dở, bỏ đi không mất gì của hồ sơ. Thứ phải giữ mãi vẫn giữ: bản chính thức,
  mọi phiên bản từng phát hành, phiên bản đã đặt tên; và `diagram_history` + `audit_log` ghi một
  dòng cho mỗi lần xoá (xoá từ số mấy tới số mấy, bao nhiêu lần lưu, ai xoá).
  - **"Bỏ bản nháp":** xoá mọi phiên bản có số SAU mốc giữ mà chưa đặt tên, chưa từng phát hành.
    Mốc giữ = bản chính thức; bản chưa có bản chính thức (bản trình bày, bản chưa phát hành) giữ
    phiên bản đầu tiên. Phiên bản giữ lại mà còn trỏ tới một bản nháp (`based_on` / khôi phục từ)
    thì bản nháp đó cũng giữ. Đang có yêu cầu phát hành chờ duyệt trỏ vào một bản sẽ xoá thì chặn,
    bảo người gửi rút yêu cầu trước. Bình luận ghim trên các bản bị xoá đi cùng. Ai được: Admin/SA;
    bản trình bày thì cả người tạo / phụ trách (cùng luật đổi tên, lưu trữ). Hỏi mã sơ đồ; hộp xác
    nhận nói rõ sẽ xoá bao nhiêu lần lưu.
  - **"Xoá hẳn":** chỉ bản vẽ CHƯA phát hành lần nào, không còn bản vẽ con (kể cả con đã lưu trữ),
    không có yêu cầu chờ duyệt. Admin/SA hoặc người tạo; hỏi mã sơ đồ; gõ đúng tên để xác nhận.
    Phiên bản, tên phiên bản, bình luận, lệch kho, người đang sửa bị xoá; riêng hàng `diagram` còn
    lại làm **bia mộ** (`deleted_at`, ẩn khỏi mọi màn, 404 khi mở) vì `diagram_history` chỉ-thêm trỏ
    khoá ngoại vào nó — lịch sử và nhật ký vẫn tra được bản vẽ tên gì, ai xoá.
  - DB vẫn chặn sửa/xoá phiên bản như cũ; chỉ hàm `diagram_delete_versions` (SECURITY DEFINER)
    mở được trong đúng transaction của nó, và trigger vẫn từ chối xoá bản chính thức, bản đã đặt
    tên, bản từng phát hành. `ims_app` vẫn không có quyền DELETE trên các bảng chỉ-thêm.
  - **Ảnh lưu một lần:** ảnh nhúng (`data:image/…;base64`) trong XML và ảnh xem SVG được tách ra bảng
    `diagram_image`, khoá bằng SHA-256 của chính ảnh; phiên bản chỉ giữ tham chiếu
    `ims-img:<dạng>:<sha>`. Mở bản vẽ, so sánh, xuất PNG/PDF đều ghép ảnh trở lại thành `data:` URI
    trước (xuất vẫn qua cổng kiểm lại trước resvg, không bao giờ tải URL). Phiên bản cũ không chuyển
    đổi gì, đọc được cả hai dạng. Ảnh nhỏ hơn 512 byte hoặc base64 không chuẩn để nguyên trong XML.
    `diagram.xml_max_kb` nay đo trên XML khô SAU khi tách ảnh; tổng cỡ kể cả ảnh vẫn bị trần XML
    ướt lúc nhận chặn như trước. Ảnh không còn phiên bản nào dùng bị xoá ngay trong transaction
    Bỏ bản nháp / Xoá hẳn.
- **Màn /diagrams là "bản đồ không gian" + bỏ nháp từ một bản chọn (04/10/2026, chủ dự án chốt
  sau khi xem mẫu; thay bố cục cây hai cột).** Bản vẽ gốc là băng tối trên cùng, bản vẽ con của
  nó là các KHU (tầng/site), con của khu là các Ô; ô có con thì bấm "▸ n bản vẽ con" để đi sâu
  (bản đồ lấy ô đó làm gốc, có đường dẫn quay lại). Dải "Cần làm" đếm bản có nháp chưa phát
  hành / chờ duyệt / lệch kho, bấm để lọc. Bấm một ô mở panel bên phải: chuyển nhanh giữa các
  bản vẽ cùng khu, nút Mở bản chính thức / Sửa, khu "Nháp chưa phát hành" và khu "Đã phát hành".
  Trạng thái luôn có CHỮ, không chỉ màu. Kiểu "Danh sách" (cây thụt lề) vẫn giữ cho người đọc
  màn hình và ai quen danh sách.
  - **Bỏ nháp TỪ một bản chọn trở về sau:** tick một bản nháp thì mọi bản nháp MỚI hơn được tick
    theo; "Xóa n bản nháp" xoá các lần lưu có số ≥ bản chọn (cùng loại trừ như "Bỏ bản nháp":
    bản đã đặt tên, từng phát hành, hay bị bản giữ lại trỏ tới thì giữ; có yêu cầu chờ duyệt trỏ
    vào bản sẽ xoá thì chặn). Số bắt đầu phải SAU mốc giữ, không thì từ chối. Không cho xoá riêng
    một bản nháp ở GIỮA: các lần lưu sau vẽ tiếp trên nó, xoá giữa chừng làm chuỗi lịch sử
    hụt một khúc mà bản sau vẫn mang dấu của nó.
  - Danh sách phiên bản trong panel vẫn là nội dung bản vẽ nên vẫn hỏi mã sơ đồ: panel hiện nút
    "Nhập mã để xem lịch sử" tại chỗ, không tự bật hộp hỏi mã khi chỉ bấm chọn một ô. Tên, trạng
    thái, số phiên bản / số nháp / số thiết bị trên bản đồ là thông tin của cây, không hỏi mã.
- **Góp ý sau khi test màn bản đồ (05/10/2026, chủ dự án):**
  - **Xem lại bản đã lưu trữ:** /diagrams có nút "Đã lưu trữ (n)" (cả kiểu Bản đồ lẫn Danh sách);
    bấm thì hiện khu liệt kê bản vẽ đã lưu trữ (tên, nằm dưới bản nào, ai lưu trữ, khi nào). Mở ra
    là CHỈ XEM — vẫn hỏi mã sơ đồ như mọi lần xem, không có Sửa. **"Bỏ lưu trữ"** cùng người được
    lưu trữ (Admin/SA; bản trình bày thì cả người tạo / phụ trách), ghi `diagram_history` +
    `audit_log` (`diagram.unarchived`). Chặn khi bản cha còn đang lưu trữ (bỏ lưu trữ bản cha
    trước — không để bản con treo dưới một bản đã cất), hay khi cùng nhánh đã có bản đang dùng
    trùng tên. Bia mộ của "Xoá hẳn" không bao giờ hiện ở khu này.
  - **Vị trí U của thiết bị tự giải thích:** dưới ô U hiện ngay câu "Thiết bị nằm ở U30" / "Chiếm
    U30–U31". Quy ước giữ như khung tủ và ràng buộc chồng U: U1 ở ĐÁY tủ, "U bắt đầu" là U thấp
    nhất, máy chiếm dần LÊN trên (U30 + 2U = U30–U31). Form kiểm chồng U với các máy đang ở tủ đó
    (trừ máy thanh lý và chính nó) TRƯỚC khi lưu, báo tại ô "U30 đang có SW-01"; server vẫn là
    trọng tài — lỗi chồng U của server cũng gắn vào ô đó. Nút **"Xem tủ"** cạnh ô Tủ mạng mở hình
    mặt đứng của tủ (mỗi U một dòng, mã máy đang chiếm); bấm một U trống thì điền "U bắt đầu".
    Màn 390px xem được, chỉ đọc.
  - **"Hình dùng trên sơ đồ" — MỖI máy đổi được ảnh của riêng nó (chủ dự án chốt lại 05/10):**
    - Thứ tự tra một nơi duy nhất (`DevicePhotosService.effectivePhotos` của `devices`): ảnh riêng
      của máy → ảnh chung của loại + model → biểu tượng của Loại thiết bị (SA đổi ở Danh mục). Dùng
      cho chèn từ "Thiết bị kho", hydrate lúc mở / xem / xuất, thẻ ảnh của trang thiết bị và **Bản đồ
      quan hệ** (nút của máy và các máy khác hiện trên đó) — không nơi nào chép ảnh ra bản riêng.
      Bản đồ quan hệ và hộp Thiết bị kho hiện ảnh bằng `<img>` trỏ endpoint ảnh đã thu nhỏ / đã vẽ
      lại của server, không nhúng nội dung người dùng tải lên.
    - Lưu trữ: KHÔNG thêm bảng. Ảnh riêng của máy vốn đã có chỗ — cột `device.photo_*_file_id`
      (migration 0054, chủ `devices`, AD-3) trỏ tệp `files` của chính máy; ảnh model ở
      `device_model`. Thiếu chỉ là giao diện: trước nay phải tải giấy tờ rồi chọn trong ô thả xuống
      ở cuối tab Giấy tờ.
    - Trang thiết bị có khu "Hình dùng trên sơ đồ" ở tab Tổng quan, nói rõ mức đang dùng ("Ảnh
      riêng của máy này" / "Ảnh chung của model X" / "Biểu tượng loại"). Việc: **Tải / thay ảnh
      riêng** cho từng mặt (tải thẳng, JPG/PNG, cùng giới hạn cỡ của giấy tờ — ảnh được giải mã và
      vẽ lại khi đưa vào sơ đồ như cũ), **Bỏ ảnh riêng** (về ảnh model / biểu tượng). Ai sửa được hồ
      sơ máy thì đổi được ảnh riêng (SA/Admin/Thành viên, máy chưa thanh lý). Ảnh model giữ dưới
      nhãn "Dùng cho mọi máy cùng model" và chỉ SA/Admin đổi (API `POST :id/model`, `PATCH
      :id/model-photos` thu về SA/Admin) — một lần đổi ở đây đổi hình của cả loạt máy.
    - Chèn máy từ "Thiết bị kho": máy có ảnh (riêng hay model) thì ô mới hiện ảnh mặt trước; không
      có thì biểu tượng. Ô đã đặt trên bản vẽ giữ lựa chọn của người vẽ (biểu tượng / mặt trước /
      mặt sau, `ims_photo`) nhưng ẢNH thì luôn là ảnh hiện hành: XML lưu khô (chỉ `ims_photo`), mở lại
      bản vẽ — kể cả phiên bản cũ — là thấy ảnh mới, đúng như ảnh model đang chạy hôm nay.
    - **Khu ảnh phải TRÔNG như chỗ tải ảnh, không phải một dòng chữ** (chủ dự án 05/10: "Biểu
      tượng loại Firewall / Tải ảnh riêng / Dùng cho mọi máy cùng model — chỉ là 1 dòng text, nhìn
      không nhận ra"). Mỗi mặt là một ô lớn "Mặt trước" / "Mặt sau" hiện đúng hình đang dùng (ảnh
      đã thu nhỏ của server, hoặc biểu tượng loại phóng to trên nền nhạt), kèm nhãn mức đang dùng.
      Cả ô là vùng thả ảnh + nút "Tải ảnh lên" / "Thay ảnh" (cùng vùng thả và giới hạn của giấy
      tờ); "Bỏ ảnh riêng" khi máy có ảnh riêng; SA/Admin có thêm, tách riêng bên dưới kèm một
      dòng giải thích, việc "Dùng ảnh này cho mọi máy cùng model". Máy thanh lý chỉ xem. 390px
      xếp hai ô chồng nhau.
    - **Form Thêm / Sửa thiết bị có khu "Ảnh thiết bị"** (không bắt buộc), cùng ô ảnh đó. Sửa:
      ghi thẳng như trang thiết bị. Thêm mới: ảnh chọn được giữ ở trình duyệt (xem trước ngay),
      máy lưu xong mới tải lên rồi đặt làm ảnh riêng. Bước ảnh hỏng thì máy VẪN được tạo; người
      dùng thấy câu báo rõ kèm nút mở hồ sơ để đặt lại ảnh — không mất ảnh trong im lặng.
    - **Ô ảnh trên bản vẽ ôm theo tỉ lệ ảnh** (chủ dự án 05/10: firewall 1U nằm giữa một ô vuông, trống
      trên dưới, nhãn rơi xa). Giữ bề rộng như hôm nay, cao = rộng × (cao/rộng của ảnh), tỉ lệ chặn
      trong 0,15…2. Cỡ ảnh lấy từ ảnh SERVER đã giải mã + thu nhỏ khi dựng ô (cùng lượt, có bộ nhớ
      đệm) — không thêm cột, không migration, và không tin cỡ do trình duyệt báo. Áp khi chèn từ
      "Thiết bị kho" và khi người vẽ đổi Biểu tượng ↔ Ảnh mặt trước/sau (về biểu tượng thì cao theo
      tỉ lệ của biểu tượng loại). Ô đã lưu KHÔNG bị sửa cỡ lúc mở bản vẽ — chỉ chỉnh khi người vẽ đổi
      hình lần nữa. Máy trong khung tủ ("Dựng lại mặt tủ") giữ cao đúng số U, đổi hình không đụng cỡ.
  - **Menu ⋮ của trình vẽ chia nhóm có tiêu đề** (Dây & kết nối · Khung, tủ & ảnh · Phiên bản &
    duyệt · Trợ giúp), mỗi mục có một dòng mô tả; "Hướng dẫn" đứng ĐẦU menu để không phải cuộn.
    Khai kết nối xong, lời báo có nút "Xem ở sơ đồ cổng của <máy>" (mở tab mới — không bỏ bản vẽ
    đang dở). Hướng dẫn (i) nói rõ dây nằm ở sơ đồ cổng của máy, và nhắc các nhóm trong menu.
  - **Nối thêm máy vào máy đã có dây — không cần khai số cổng:** gõ tên cổng mới là cổng được tạo
    khi bấm Khai. Lỗi chủ dự án gặp là gõ lại đúng cổng đã có cáp (luật một cổng một cáp) mà hộp
    chỉ báo một câu chung. Hộp Khai nay hiện cổng ĐANG DÙNG của từng máy, báo ngay tại ô khi gõ
    trùng ("Cổng 1 của SW-01 đã nối PC-01") kèm nút dùng cổng kế tiếp còn trống; lỗi 409 của server
    cũng gắn vào đúng ô.
  - **Nhân bản bản vẽ con chọn được phiên bản của bản cha:** mặc định bản chính thức (chưa phát
    hành thì bản mới nhất); chọn được bản nháp mới nhất ngay, các bản khác (đã phát hành, đã đặt
    tên) qua "Chọn phiên bản khác…" — danh sách phiên bản là nội dung nên hỏi mã sơ đồ. API nhận
    `versionId`, phải thuộc đúng bản cha; luật gỡ khung hỏng giữ nguyên.
  - **Bản đồ gọn hơn:** dòng nháp trong panel là "#15 · tóm tắt ngắn", người lưu / giờ ở dòng
    thứ hai, "lưu đè lên bản của …" là nhãn nhỏ; dải chuyển nhanh bản vẽ cùng khu cuộn được và
    luôn thấy tab đầu; bản vẽ gốc chưa có con là một băng một dòng kèm "+ Bản vẽ con".
- **Soát UX đợt 2 — Sơ đồ mạng (05/10/2026, chủ dự án duyệt toàn bộ danh sách soát):**
  - **Thuỷ vân GIỮ, chỉ nhẹ hơn ở tab Sửa** (V-06, chính sách bảo mật): thuỷ vân "tên · email ·
    giờ" vẫn bắt buộc ở mọi chế độ (AD-17), không có nút tắt. Ở tab Sửa: thưa còn 3 hàng, màu nhạt
    hơn (token riêng có cặp dark), chừa dải thanh menu + công cụ của trình vẽ ở trên cùng để vẽ
    không vướng. Tab Xem và mọi file xuất giữ nguyên như cũ.
  - **Thành viên chỉ gửi duyệt nháp do CHÍNH MÌNH lưu** (D-04): nháp mới nhất do người khác lưu
    thì Thành viên không thấy nút "Gửi duyệt", và server từ chối (403
    `DIAGRAM_SUBMIT_NOT_OWN_DRAFT`) — trước đây server cho Thành viên gửi duyệt bản vẽ dở của bất
    kỳ ai. Sửa tiếp nháp của người khác vẫn được (luật "bản lưu sau thắng" giữ nguyên) nhưng nút
    ghi rõ "Sửa tiếp nháp #n (của <tên>)". Admin/SA không đổi.
  - **Bản vẽ con lấy Site của bản cha; chỉ bản vẽ cấp tủ mới gắn tủ** (D-03): "Loại nút" đổi tên
    "Cấp bản vẽ". Ô Tủ chỉ hiện khi cấp là tủ, kèm một dòng nói gắn tủ để làm gì (dựng mặt tủ từ
    kho). Server từ chối (400 `DIAGRAM_CABINET_NEEDS_CABINET_LEVEL`) lượt gắn tủ cho bản vẽ không
    phải cấp tủ; lượt sửa cấp/tủ để lại bản vẽ không phải cấp tủ mà còn gắn tủ cũ thì tủ được bỏ
    gắn trong cùng lượt (dữ liệu cũ tự sạch khi có người sửa, không sửa ngầm lúc chưa ai đụng).
  - **Bản vẽ chờ duyệt phải có chỗ cho người duyệt thấy** (D-07): mục "Sơ đồ mạng" trên menu mang
    số bản vẽ đang chờ Admin/SA này duyệt (không tính yêu cầu do chính họ gửi — bốn mắt); màn
    "Duyệt" có khối "Bản vẽ chờ duyệt" (tên bản vẽ, người gửi, lúc gửi, bấm là mở; nay ở màn Sơ đồ mạng — Q-32). Bản đồ /diagrams
    giữ chip "Chờ duyệt" sẵn có. Chỉ tên / trạng thái — không nội dung, không hỏi mã sơ đồ (cùng
    mức với bản đồ).
  - **Tìm nhanh (Ctrl+K) có nhóm Sơ đồ** (D-08): tên bản vẽ khớp, và "mã máy → bản vẽ có máy đó"
    (mở bản vẽ, bay tới máy). Chỉ tên và trạng thái; mở nội dung vẫn hỏi mã như mọi lần xem.
  - **Tab Sửa trả chỗ cho trình vẽ** (E-04): ở tab Sửa thanh trên cùng của IMS (tên nhóm, nút tìm,
    đổi theme) ẩn đi — Ctrl+K vẫn mở Tìm nhanh; dòng "đã lưu" rút còn "Đã lưu #n · giờ", đủ chi
    tiết khi rê chuột.
  - **Lưu xong mời bước kế tiếp** (E-06): lời báo lưu xong có nút "Gửi duyệt #n" (Thành viên, nháp
    của chính mình) hoặc "Phát hành #n" (Admin/SA).
  - **Giấy bản vẽ luôn sáng thì màu dây trên giấy cũng là bộ màu sáng** (V-05): trình vẽ, trình
    xem và chú giải nổi trên trình xem dùng bộ màu dây của GIẤY (token `--paper-cable-*`, cặp dark
    giữ giá trị sáng), chú giải nổi nằm trên nền giấy. Danh mục, sơ đồ cổng (nền giao diện) vẫn
    theo theme.
  - **Biểu tượng loại có màu như bảng hình của draw.io** (V-10): hình thư viện mạng chèn kèm tô
    + viền (màu từ token qua `PALETTE`) thay cho nét đen trên nền trắng; loại chưa chọn hình là
    khối "thiết bị chung" in tên loại. Màn Danh mục đánh dấu loại chưa có hình trên sơ đồ.
- **Góp ý "Lỗi Sơ đồ mạng" (05/10/2026, chủ dự án; Claude chốt phương án an toàn ở các điểm còn
  mở, ghi rõ bên dưới để chủ dự án xác nhận):**
  - **Bẻ dây bằng điểm uốn của chính dây, không vẽ thêm nét nối.** Bản vẽ "PMH Tower" cho thấy
    nguyên nhân lỗi đỏ "Dây 3-AA-IT-001 ↔ ?": người vẽ kéo một đầu dây đã khai ra chỗ trống rồi vẽ
    thêm vài nét tự do cho vuông góc — dây mang kết nối nay một đầu thả nổi. Dây của kho là nét
    vuông góc (`orthogonalEdgeStyle`); muốn đi đường khác thì kéo điểm uốn trên chính dây. Khai
    từ một nét người vẽ cũng đổi nét đó sang vuông góc. Menu "Dây & kết nối" có **"Bẻ dây vuông
    góc"** (mọi dây của kho trên trang sang kiểu vuông góc, giữ điểm uốn người vẽ đã kéo) và **"Tự
    đi lại dây"** (bỏ điểm uốn, nối lại đầu dây lệch / thả nổi về đúng máy của kết nối khi máy đó
    có trên trang). Hai việc áp cho MỌI dây của kho trên trang đang mở: giao thức nhúng draw.io
    không báo đang chọn nét nào.
  - **Bản sao nét đã khai là nét tự do** (nhân bản, dán — kể cả dán từ bản vẽ khác: nét mới mang
    một kết nối không có ở lượt trước và IMS không biết tới thì gỡ gắn). Nét tự do chạm máy KHÔNG
    phải lỗi. Chỉ nét mang kết nối mà hai đầu không đúng hai máy của kết nối mới đỏ; câu báo nêu
    đủ hai máy + cổng của kết nối, đầu nào thả nổi / đang nối máy nào, và cách sửa: kéo đầu dây về
    đúng máy, "Tự đi lại dây", hoặc xoá nét (chọn "Chỉ xoá nét vẽ") rồi "Vẽ vào".
  - **Lưu mà không đổi gì không tạo phiên bản.** XML khô (sau dehydrate + tách ảnh, bỏ vị trí
    cuộn `dx`/`dy`) trùng phiên bản mới nhất VÀ thông tin thiết bị chụp lúc lưu cũng như cũ thì
    server không thêm phiên bản, không ghi lịch sử / nhật ký, trả phiên bản mới nhất kèm
    `unchanged: true`. Nét vẽ y nguyên mà kho đã đổi (IP, tủ, serial…) thì VẪN là một phiên bản
    "Chụp lại thông tin thiết bị theo kho" — lệch kho tính từ bản chụp, nên đó là cách xoá dấu lệch.
    Bản mới nhất chưa có ảnh xem (bản dựng tự động: dựng lại mặt tủ, dựng nháp từ sơ đồ cổng) thì
    lưu y nguyên cũng là một phiên bản "Tạo ảnh xem cho bản dựng tự động", và nút Lưu bật ngay.
    Web tắt nút Lưu khi chưa sửa gì; lượt lưu trùng báo "Không có thay đổi để lưu".
  - **"Xóa vĩnh viễn" bản vẽ đã lưu trữ — sửa luật 04/10 "bản chính thức, bản từng phát hành, bản
    đặt tên giữ mãi" CHỈ cho bản đã lưu trữ.** Ai: Admin/SA (Thành viên không — bản chưa phát hành
    của họ vẫn có "Xoá hẳn"). Ở khu "Đã lưu trữ". Điều kiện: bản vẽ đã được lưu trữ TRƯỚC đó (không
    lưu trữ và xoá trong một bước), hỏi mã sơ đồ, gõ đúng tên, không còn bản vẽ con nào chưa xoá
    vĩnh viễn (kể cả con đã lưu trữ — con treo dưới một bia mộ thì không bao giờ bỏ lưu trữ được),
    không có yêu cầu chờ duyệt. Xoá phiên bản, tên phiên bản, bình luận, lệch kho, người đang sửa,
    ảnh không còn ai dùng; giữ bia mộ + `diagram_history` + `audit_log` (`diagram.erased`: tên, số
    phiên bản đã xoá, từng phát hành không). Bản trình bày nhân bản từ nó không chặn (bản tách rời)
    — chỉ mất liên kết tới phiên bản nguồn. DB (0058): chế độ `erase` của `diagram_delete_versions`
    chỉ chạy khi bản vẽ là bia mộ VÀ đã lưu trữ trước lượt xoá; bản chính thức / đặt tên / từng phát
    hành của bản vẽ chưa lưu trữ vẫn không xoá được bằng bất kỳ đường nào.
  - **Tủ mạng.** Ô máy trong khung tủ cao đúng Số U × 1U và nằm theo U trong kho (U1 ở đáy) — ảnh
    thật nằm gọn trong ô U, tỉ lệ ảnh không đổi chiều cao. Kéo máy vào khung tủ thì IMS đặt lại
    ngay đúng U (máy mà kho ghi cùng tủ với khung). **Máy kho ghi tủ KHÁC (hay chưa gắn tủ) thì
    không đặt theo U, chỉ cảnh báo — IMS không bao giờ tự đổi tủ của máy trong kho** (câu hỏi cho
    chủ dự án: có cần nút "Chuyển máy sang tủ này" ghi vào kho không? Hiện phải sửa ở trang thiết
    bị). Nhãn máy trong khung tủ nằm bên PHẢI, một dòng (mã · IP), không đè lên U khác. "Chèn tủ
    mạng" mà máy của tủ đã có trên trang thì dời chính ô đó vào khung (giữ id — dây vẫn gắn).
    "Dựng lại mặt tủ" giữ id ô máy và giữ dây nối giữa các máy còn trên mặt tủ.
- **Chủ dự án trả lời các điểm còn mở của góp ý 05/10 (06/10/2026):**
  - **Có nút "Chuyển máy sang tủ này", ghi vào kho nhưng LUÔN hỏi trước.** Máy kho ghi tủ khác (hay
    chưa gắn tủ) với khung tủ nó đang nằm: lời cảnh báo và mục của máy trên trình vẽ có việc
    "Chuyển máy sang tủ này". Kéo một máy vào khung của tủ khác cũng mở hộp xác nhận (hộp dùng
    chung, không `window.confirm`) TRƯỚC khi ghi gì: "Chuyển <mã> từ <tủ cũ> sang <tủ mới>, U bắt đầu
    = <U nơi thả, hoặc U trống gần nhất>, Số U = n"; U sửa được, kiểm chồng U với các máy đang ở tủ
    mới như form thiết bị. Đồng ý → web gọi đúng API sửa thiết bị của `devices` (cùng quyền, cùng
    nhật ký như sửa ở trang thiết bị — sơ đồ không tự ghi bảng `device`, AD-3) rồi đặt lại ô theo
    U mới. Huỷ → ô về chỗ cũ, không ghi gì. Máy thanh lý không chuyển được. Lý do: kéo máy vào tủ là
    cách tự nhiên nhất để nói "máy này ở tủ này", nhưng đổi kho mà không hỏi là ghi ngầm.
  - **Khung tủ gắn nhầm tủ (bản vẽ "PMH Tower" khung TU-04):** người vẽ chọn lại tủ cho khung. Trước
    đây không có đường nào đổi tủ của một khung đã chèn ("Gắn khung" chỉ gắn bản vẽ con / dải IP,
    "Chèn tủ mạng" tạo khung thứ hai), nên hộp "Gắn khung" có thêm **"Đổi tủ của khung này"**: chỉ
    đổi bản vẽ (tủ + mã trong nhãn khung), giữ hình và máy bên trong, không ghi kho; máy kho ghi tủ
    khác thì được báo kèm "Chuyển máy sang tủ…".
  - **"Xóa vĩnh viễn" giữ luật phải xoá vĩnh viễn hết bản vẽ con trước**, câu báo nêu rõ còn con nào.
  - **Tủ mạng chỉ vẽ MẶT TRƯỚC.** "Chèn tủ mạng" và "Dựng lại mặt tủ" chỉ dựng mặt trước, bỏ mặt
    sau. Bản vẽ đã lưu có khung mặt sau thì giữ nguyên nội dung, nhưng đặt máy theo U và cảnh báo lệch
    tủ bỏ qua khung mặt sau.
  - **"Khôi phục" một phiên bản trùng hệt bản mới nhất không tạo phiên bản mới** (cùng cách so như
    lưu không đổi): giữ nguyên số, báo "Bản này trùng bản mới nhất — không tạo phiên bản mới".
  - **Bấm Lưu khi chưa đổi gì phải giữ nguyên số phiên bản, không sinh nháp** — ở MỌI đường lưu: nút
    Lưu, Ctrl+S, lưu lại sau khi nhập mã giữa chừng, "Vẽ vào" / các việc của IMS không đổi gì, bản
    trình bày, và lưu ngay sau khi mở một bản nháp cũ.
- **Năm cải tiến trình vẽ (06/10/2026, chủ dự án chọn; Claude chốt cách làm, giữ nguyên tư thế bảo
  mật của draw.io):** iframe vẫn `sandbox="allow-scripts"` nguồn gốc mờ, CSP `/drawio/` không đổi,
  vẫn `plugins=0` — KHÔNG thêm plugin hay tệp nào vào thư mục draw.io. Lý do: plugin chạy trong khung
  với toàn quyền trên mô hình bản vẽ; mọi việc dưới đây làm được bằng giao thức nhúng sẵn có.
  - **Kéo máy từ "Thiết bị kho" thả thẳng vào trình vẽ.** Dòng máy trong hộp kéo được (kéo-thả HTML
    chuẩn): dữ liệu kéo là một `<mxGraphModel>` chứa đúng ô server dựng cho máy đó (cùng ô của nút
    "Chèn"), draw.io tự nhận như dán và đặt ô ĐÚNG chỗ thả (có hoàn tác). Không cần đổi toạ độ ở
    IMS: giao thức nhúng không báo vị trí cuộn của khung nên toạ độ tính từ ngoài sẽ sai. Trình duyệt
    không giao cú thả cho khung (chặn kéo vào khung khác nguồn) thì IMS chèn theo lưới như nút
    "Chèn" — không mất máy. Tick + "Chèn" giữ nguyên làm đường thứ hai. Máy đã có trên bản vẽ không
    kéo được. Kéo một lượt một máy.
  - **Nhãn cổng ở HAI ĐẦU dây** ("Gi1/0/1" sát máy A, "Gi1/0/2" sát máy B) thay cho một nhãn
    "Gi1/0/1 ↔ Gi1/0/2" giữa dây. Nhãn đầu dây là ô nhãn con của nét do IMS dựng lúc mở (như nhãn
    giữa trước đây) và gỡ lúc lưu — XML lưu chỉ thêm cờ `ims_port_labels="ends"` trên nét. Dây mới
    (Khai, Nối hàng loạt, Vẽ vào, Dựng nháp từ sơ đồ cổng) mang cờ ngay; dây CŨ chỉ đổi khi người vẽ
    đụng tới nó bằng "Tự đi lại dây" — mở bản vẽ không tự đổi (không sinh phiên bản ngầm). Màu nhãn
    theo màu loại dây. Ảnh xem / PNG / PDF lấy đúng ảnh chụp lúc lưu, nên bản cũ giữ nhãn cũ.
  - **Thẻ thông tin máy và dây.** Tab Xem (trình xem SVG của IMS): rê chuột lên máy → thẻ nhỏ (mã,
    IP, model, tủ/U, cổng đang dùng/đã khai, trạng thái); rê lên dây → cả dây và hai máy hai đầu
    sáng lên + thẻ "A máy:cổng ↔ B máy:cổng · loại dây · trạng thái". Bấm vẫn mở thẻ chi tiết như cũ
    ("Mở hồ sơ" đi kèm). Tab Sửa: draw.io không báo rê chuột; IMS hỏi ô đang CHỌN bằng lệnh `export`
    định dạng `json` có sẵn (chỉ id + thuộc tính `ims_*`, hỏi vài lần mỗi giây khi khung đang có tiêu
    điểm) và hiện cùng thẻ ở góc trình vẽ, nút "Chi tiết" mở thẻ chi tiết NGAY trong màn sửa ("Mở hồ
    sơ" mở tab mới — không bỏ bản vẽ dở). Không có rê chuột trong tab Sửa (cần plugin — không làm).
    "Cổng đã khai" là số dòng sơ đồ cổng của máy; kho chưa có số cổng vật lý của máy.
  - **Giữ bản đang vẽ dở.** Đang sửa mà đóng tab, mất mạng hay hết phiên thì trình duyệt giữ một bản
    nháp cục bộ (IndexedDB) theo người + bản vẽ, MÃ HOÁ AES-GCM bằng khoá server cấp kèm nội dung
    tab Sửa (dẫn từ master key theo người + bản vẽ — tức chỉ lấy được sau khi nhập mã sơ đồ). Trên
    đĩa chỉ có bản mã; mở lại tab Sửa (nhập mã như mọi lần) thì hiện "Có bản đang vẽ dở lúc <giờ> —
    Khôi phục / Bỏ". Khôi phục nạp vào trình vẽ thành thay đổi CHƯA LƯU (lưu vẫn qua nút Lưu, ghi
    "lưu đè" nếu bản vẽ đã có phiên bản mới hơn) — không bao giờ tự ghi đè server. Bản nháp bị xoá
    khi lưu xong, khi bấm Bỏ, khi chọn "Bỏ thay đổi" lúc rời màn, khi bấm Đăng xuất, và tự hết hạn
    sau `diagram.draft_keep_hours` giờ (mặc định 24). Đổi master key thì bản nháp cũ không mở được
    và bị bỏ. Rời màn khi còn thay đổi chưa lưu vẫn hỏi như cũ (`useUnsavedGuard`, cả đóng tab).
- **Ảnh thiết bị và máy trong tủ (06/10/2026, chủ dự án chốt sau 5 ảnh chụp lỗi: ảnh 1U nhỏ xíu ở
  bản đồ quan hệ và ô ảnh, máy tủ khác thả vào khung TU-04 chiếm U33–U41, ảnh 1U thành vạch "—",
  máy trong tủ chồng nhau với nhãn 3 dòng).** Nguyên nhân chung: ảnh tải lên còn viền trong suốt /
  trắng và không theo tỉ lệ mặt tủ, khung hiển thị cố định vuông / cao 160px, và máy của tủ khác
  nằm lại trong khung với cỡ của trang tự do.
  - **A. Tải ảnh = tự cắt viền + hộp cắt.** Mọi chỗ tải ảnh thiết bị (ô ảnh của trang thiết bị,
    form Thêm/Sửa, "Dùng cho mọi máy cùng model") mở hộp cắt dùng chung (`ImageCropDialog`, web/src/ui
    — vẽ bằng canvas, không thêm thư viện). Viền trong suốt hoặc gần đồng màu (trắng) tự cắt trước.
    Máy có Số U = n > 0: khung cắt khoá theo mặt tủ 19" — rộng 482,6 mm : cao n × 44,45 mm (1U ≈
    10,86 : 1, 2U ≈ 5,43 : 1…); không có Số U thì cắt tự do. Ra PNG (giữ nền trong suốt) nếu ảnh gốc
    là PNG, không thì JPEG; tải lên qua đúng đường giấy tờ (cùng trần cỡ, server vẫn kiểm loại, cỡ,
    giải mã + vẽ lại). Ảnh cũ vẫn chạy; ô ảnh đo ảnh đã thu nhỏ ngay ở trình duyệt và hiện "Ảnh chưa
    cắt chuẩn — Cắt lại" khi còn viền hoặc lệch tỉ lệ n U (đổi Số U sau này cũng hiện câu này).
    "Cắt lại" mở cùng hộp trên tệp gốc rồi lưu như một lần tải ảnh mới cùng mức (ảnh riêng → ảnh
    riêng; ảnh model → ảnh model nếu là SA/Admin, không thì thành ảnh riêng của máy).
  - **B. Khung hiển thị theo tỉ lệ ảnh.** Ô ảnh ở trang thiết bị / form rộng hết ô, cao theo ảnh
    (ảnh 1U thành dải rộng và thấp). Hạch của Bản đồ quan hệ hiện ảnh rộng thành một dải hết bề
    rộng thẻ hạch, không nằm trong ô vuông.
  - **C. Trong khung tủ, máy đặt theo U của kho, không gì khác.** Ô máy LUÔN cao đúng n × 1U và rộng
    hết lòng tủ; ảnh thật lấp đầy ô U (kéo giãn — ảnh đã cắt đúng tỉ lệ thì không méo, ảnh cũ chưa cắt
    không còn thu nhỏ thành vạch). Nhãn một dòng bên phải ("mã · IP") ngay khi máy vào khung, không
    chờ mở lại; hai nhãn sát nhau thì nhãn sau dời sang làn bên để không chồng. Hai máy không bao
    giờ chung một U trên khung. Máy tủ khác thả vào khung: ô được đặt ngay cao n × U ở U trống gần
    chỗ thả rồi mở hộp "Chuyển máy sang tủ này" như 06/10; **Hủy → ô ra NGOÀI khung (cạnh khung)**,
    không bao giờ nằm lại trong khung với cỡ cũ — sửa gạch 06/10 "Huỷ → ô về chỗ cũ" (chỗ cũ có thể
    chính là trong khung). Lý do: một máy nằm trong khung mà không theo U là hình tủ sai. Bản vẽ ĐÃ
    LƯU có máy sai cỡ trong khung (ảnh 3): mở tab Sửa là ô được đặt lại ngay trên trình vẽ nhưng không
    tính là thay đổi của người vẽ (nút Lưu vẫn tắt, không sinh phiên bản); lần lưu sau giữ chỗ đúng.
    Hủy hộp chuyển mở từ lời báo / menu cũng đưa ô ra ngoài khung.
  - **D. Máy chưa khai U thả vào khung tủ của chính tủ nó** → hộp chọn U trống gần chỗ thả (cùng hộp,
    cùng mặt đứng tủ và U trống gần nhất), ghi kho qua API sửa thiết bị của `devices` sau khi người
    vẽ bấm đồng ý. Hủy → ô vào cột "Chưa khai U" của tủ (chưa có cột thì IMS dựng cột cạnh khung).
  - **E. Trang tự do: mọi máy cùng một bề rộng chuẩn** `diagram.device_width_px` (mặc định 160 —
    đúng lòng tủ, AD-11, màn Tham số); cao = rộng × tỉ lệ ảnh (hay tỉ lệ biểu tượng). Áp khi chèn,
    kéo thả từ "Thiết bị kho" và đổi Biểu tượng ↔ Ảnh; người vẽ vẫn kéo cỡ tay được. Ô đã có KHÔNG bị
    sửa lúc mở bản vẽ. Tỉ lệ cao/rộng của ô ảnh nới xuống 0,08 (gạch 05/10 chặn 0,15) để ảnh 1U ra
    đúng dải 1U thay vì một ô cao có hai dải trống.
  - **Dữ liệu "PMH Tower":** khung tủ đang gắn TU-04 trong khi máy thuộc TU-TOWER-01 — người vẽ đổi
    tủ của khung qua menu ⋮ → "Gắn khung" → "Đổi tủ của khung này" (IMS không tự sửa bản vẽ đó).
- **Quy trình vẽ và ba nguồn sự thật (06/10/2026 chiều, chủ dự án duyệt `docs/DE-XUAT-MODEL-THIET-BI.md`
  bản viết lại).** Lý do: các gạch trước xử lý từng tình huống chuột mà chưa nói luật chung, nên chủ
  dự án không thấy được quy trình "tủ lắp xong → bản vẽ chính thức".
  - **Ba nguồn, không chồng nhau.** L1: kho là nguồn duy nhất về VỊ TRÍ (tủ + U bắt đầu + Số U) —
    mặt tủ trên bản vẽ là ảnh chiếu của kho; mọi kéo-thả trong khung tủ là một thao tác kho có hộp
    xác nhận (gạch "Ảnh thiết bị và máy trong tủ" C, D ở trên là hệ quả của luật này). L2: sơ đồ cổng
    là nguồn duy nhất về DÂY (gạch 02–03/10 giữ nguyên). L3: Model là nguồn về đặc tính loại máy
    (Q-26); chưa có Model thì đọc trên từng máy như hiện nay.
  - **Thao tác kho từ màn vẽ ghi NGAY, có audit, không chờ duyệt bản vẽ** (khai U, chuyển tủ, khai
    dây) — cùng quyền và nhật ký như sửa ở trang thiết bị. Hủy duyệt, bỏ nháp hay khôi phục phiên
    bản bản vẽ KHÔNG hoàn tác các thao tác này. Lý do: nhất quán với gạch 02/10 (Thành viên sửa sơ
    đồ cổng trực tiếp); hộp xác nhận nói rõ là đang ghi vào kho.
  - **Hộp tạo bản vẽ hỏi "Bắt đầu từ" — SỬA gạch 04/10 "tạo bản vẽ con mặc định NHÂN BẢN nội dung
    bản cha".** Bản vẽ cấp tủ (đã gắn tủ): **"Dựng từ kho"** (mặc định — cùng cách "Dựng lại mặt
    tủ") / "Trang trắng" / "Chép nội dung bản vẽ cha". Cấp khác: **"Trang trắng"** (mặc định) /
    "Chép nội dung bản vẽ cha". "Chép nội dung bản vẽ cha" giữ đủ luật cũ (chọn phiên bản bản cha
    theo gạch 05/10, gỡ khung hỏng, hỏi mã sơ đồ) và hộp ghi rõ: chỉ chép một lần làm nội dung khởi
    đầu, không liên kết gì về sau. Lý do: chủ dự án thấy tự nhân bản khó hiểu; nhu cầu "chép để sửa
    mà không ảnh hưởng bản gốc" đã có hai cơ chế đúng việc — **nháp + Phát hành** (bản chính thức
    không đổi tới khi phát hành) và **Bản trình bày** (bản tách rời hẳn); còn bản vẽ tủ thì kho đã
    biết máy nào nằm U nào, nên mồi bằng kho đúng hơn mồi bằng hình tầng/phòng.
  - **Ô "Cấp bản vẽ" tự giải thích** (bổ sung D-03): dưới ô chọn có một câu "Chọn 'Tủ mạng' để gắn
    tủ kho và dựng mặt tủ từ kho; các cấp khác chỉ là nhãn trên bản đồ, không ràng buộc cây." Các
    cấp giữ nguyên: "Tủ mạng" là công tắc chức năng (gắn tủ, dựng mặt tủ); cấp còn lại là nhãn định
    hướng trên bản đồ không gian.
  - **Huy hiệu sẵn sàng trong panel "Thiết bị kho"** (làm ngay, không chờ Model): máy gắn tủ thiếu
    U → "thiếu U"; thiếu ảnh → "thiếu ảnh" (nhẹ, vì máy vẫn hiện bằng biểu tượng loại); ảnh chưa cắt
    chuẩn → "cắt lại"; kèm bộ lọc. Không chặn kéo vào — chỉ báo TRƯỚC khi vẽ.
  - **Thước đo:** tủ 20 máy đã nhập kho đủ (U + ảnh) → bản vẽ tủ hoàn chỉnh dưới 2 phút, 0 lần chỉnh
    ảnh/ô bằng tay; máy thứ hai cùng model nhập kho dưới 30 giây.
  - **Nhịp "đang mở sửa" (presence) KHÔNG đòi mã sơ đồ** (07/10/2026, chốt khi sửa rà soát mã): nó chỉ
    trả tên người đang sửa, không phải nội dung bản vẽ; đòi mã thì hết ân hạn 10 phút giữa lúc vẽ là
    cảnh báo hai người cùng sửa biến mất. Lưu / đặt tên / khôi phục vẫn đòi mã như gạch "Sửa cũng hỏi mã".
  - Để sau (không làm đợt này): vai trò mạng để tự xếp / tô màu; "Tự dựng sơ đồ từ kho" cho trang
    TỰ DO (mặt tủ thì tự dựng đã có và là bước chuẩn); nhập devicetype-library của NetBox; AI nội bộ
    chuyển sơ đồ cũ sang draw.io (không gửi dữ liệu mạng ra ngoài).

### Q-26 · Model thiết bị (06/10/2026, chủ dự án duyệt `docs/DE-XUAT-MODEL-THIET-BI.md` mục B, C, D)

Làm SAU các gạch 06/10 của Q-23. Cách hiển thị trên sơ đồ và trang thiết bị giữ nguyên; Model chỉ
thay CHỖ LẤY Số U, ảnh và cổng.

- **Model là đặc tính chung của một loại máy, Thiết bị là từng chiếc** (như "Vios 2024" và chiếc xe
  biển số cụ thể). Model gồm: Hãng, Mã model, Loại thiết bị; **Gắn tủ** Có (kèm Số U) / Không;
  **Cổng mẫu**; **Ảnh mặt trước** (cắt theo hộp cắt của Q-23 06/10 A). Dựng trên bảng `device_model`
  sẵn có (0054) bằng migration mới — không sửa file cũ. Mỗi model hiện số máy đang dùng; không xoá
  được khi còn máy dùng.
- **Quy trình: thiết bị trước, model tạo tại chỗ.** Form Thêm thiết bị có ô Model gợi ý; chưa có thì
  "+ Tạo model mới" ngay trong form (Gắn tủ? Số U? Cổng mẫu? Ảnh?), không phải sang Danh mục. Chọn
  model là tự có Số U, ảnh, cổng sinh sẵn; từng máy vẫn sửa đè được (thêm card mạng → thêm cổng).
  Model gắn tủ: form hỏi Tủ + U bắt đầu (câu "Chiếm U30–U31", nút "Xem tủ"). Model không gắn tủ
  (máy in, camera, AP, PC, máy chấm công…): ẩn Tủ/U, chỉ hỏi Site/phòng, và không bao giờ vào khung
  tủ. Lý do: máy không tủ vẫn cần model vì ảnh và cổng mẫu (máy in = 1 cổng `LAN`).
- **Ô U bắt đầu gợi ý dải U TRỐNG đủ n U** của tủ đã chọn; gõ tay thì báo trùng ngay (cùng ràng buộc
  `device_rack_u_no_overlap`, server vẫn là trọng tài).
- **Chống model tách đôi:** khoá chuẩn hoá (viết hoa, bỏ khoảng trắng và gạch — "C9300-48P" và
  "c9300 48p" cùng khoá) là UNIQUE; gõ trùng khoá thì gợi ý model có sẵn, không cho tạo bản thứ hai.
- **Cổng mẫu** gõ theo tên của hãng, `[a-b]` sinh dải (`Gi1/0/[1-48]` + `Te1/1/[1-4]`); mỗi nhóm có
  kiểu cổng (RJ45 / SFP / SFP+ / Console / Khác) để vẽ mặt cổng. Có mẫu dựng sẵn ("Switch 24 cổng",
  "Switch 48 + 4 uplink", "1 LAN").
- **Tab Cổng** có hình mặt cổng dạng lưới (đang dùng / trống, rê chuột thấy đầu kia); bảng mặc định
  chỉ hiện cổng đang dùng, nút "Hiện cả cổng trống (n)"; khai dây CHỌN cổng trống, không gõ tay.
- **Truy cập quản trị:** các dòng *kiểu* (Web / SSH / Telnet / RDP / Winbox / Khác) + *địa chỉ:cổng*;
  Web thành link, SSH hiện lệnh kèm nút chép. Mật khẩu vẫn ở Két.
- **Chuyển tiếp:** Model thành nguồn Số U; máy có ảnh cắt theo U cũ lệch U của model thì hiện lại
  "Ảnh chưa cắt chuẩn — Cắt lại", không tự co kéo ảnh. Dữ liệu thử cũ KHÔNG chuyển đổi: máy cũ để
  "chưa có Model", cổng khai tay cũ xoá cũng được — prod nhập dữ liệu thật từ đầu.
- **Góp ý sau khi thử Epic 11 (07/10/2026, chủ dự án chốt):**
  - **Ảnh model thắng ảnh riêng của máy.** Máy đã gắn model mà model có ảnh mặt nào thì mặt đó
    hiện ảnh model ở MỌI nơi (form Thêm/Sửa ngay khi chọn model, trang thiết bị, sơ đồ) và KHOÁ tải
    ảnh riêng cho mặt đó — server từ chối, không chỉ ẩn nút. Đổi ảnh thì sửa ở Danh mục › Model
    (SA/Admin), cả loạt máy đổi theo. Mặt model chưa có ảnh (mặt sau) vẫn tải ảnh riêng như cũ.
    Thay cho câu "từng máy vẫn sửa đè được" ở trên — câu đó còn đúng cho Số U và cổng.
    Mặt đang dùng ảnh model khoá hẳn ở trang thiết bị, kể cả với SA/Admin; ảnh model tải được ngay
    lúc tạo model (cả hộp "Tạo model mới" trong form thiết bị). Thay / bỏ ảnh (riêng hay model) thì
    tệp ảnh cũ tự xoá mềm — ảnh không đọng lại trong Giấy tờ; bỏ khu "chọn ảnh từ giấy tờ" ở tab
    Giấy tờ (ảnh chỉ quản lý ở "Hình dùng trên sơ đồ").
  - **Sửa cổng mẫu của model thì mọi máy cùng model được THÊM cổng còn thiếu**, trong cùng
    transaction, mỗi máy một dòng lịch sử. Không bao giờ xoá hay đổi tên cổng có sẵn của máy (cổng
    riêng, cổng đang cắm dây). Lý do: máy tạo trước khi model có cổng mẫu thì khai dây không chọn
    được cổng mẫu.
  - **Ô "Cổng đầu kia"** khi khai kết nối gợi ý cổng của máy đầu kia như ô "Cổng" (vẫn gõ được tên
    ngoài danh sách).
  - **Nhãn cổng ở hai đầu dây nằm SÁT đầu dây** (khoảng 20px, không theo tỉ lệ độ dài dây), chữ to
    hơn, có nền — dây đi vòng dài vẫn đọc được cổng nào ở máy nào.
  - **Ô "Cấp bản vẽ" đổi tên "Loại bản vẽ"**, giữ 6 loại làm nhãn phân loại; gợi ý nói rõ cây do
    "bản vẽ con" quyết định, chỉ "Tủ mạng" mở thêm chức năng. Bản vẽ con tự đề xuất loại kế tiếp
    (Tổng công ty → Site → Tầng → Phòng → Tủ mạng).
  - **Khung cắt ảnh vẫn khoá theo tỉ lệ thật của Số U** (482 × 44,45 mm mỗi U); không phóng to ô
    1U. Ảnh cao hơn khung là dấu hiệu Số U của model khai thiếu — hộp cắt nhắc kiểm lại Số U.
- **Góp ý đợt 2 sau khi thử Epic 11 (07/10/2026, chủ dự án chốt):**
  - **"Chỉ giữ bản này" — gộp nháp về một bản.** Ở khu "Nháp chưa phát hành", chọn MỘT bản nháp
    (vd #6) → mọi bản nháp chưa phát hành, chưa đặt tên bị xoá (kể cả #1 — mốc giữ chỉ còn là bản
    đã phát hành / đặt tên), nội dung bản chọn được ghi lại thành một lần lưu mới, nhận số kế tiếp
    sau các bản còn giữ — không còn bản nào thì là **#1**. Không SỬA phiên bản cũ (vẫn chỉ-thêm),
    nhật ký ghi "gộp #1–#6 thành #1". Bổ sung cho luật "không xoá bản nháp ở GIỮA" của Q-23: gộp
    không để chuỗi hụt vì bản mới không trỏ về bản nào đã xoá. Cùng chặn như Bỏ bản nháp (yêu cầu
    chờ duyệt trỏ vào bản sẽ xoá; danh sách đổi từ lúc xem trước).
  - **Gán model hàng loạt:** Danh mục › Model hiện số máy ghi CHỮ model này (cùng loại, cùng khoá
    chuẩn hoá) mà chưa gán, kèm nút "Gán model cho các máy này" (SA/Admin). Gán như gán từ form: máy
    nhận Số U, ảnh, cổng mẫu; máy không gán được (vd chồng U) được liệt kê kèm lý do, máy khác vẫn gán.
  - **Menu ⋮ khi vẽ:** gộp "Bẻ dây vuông góc" + "Tự đi lại dây" thành một mục "Sắp lại dây" (hỏi
    giữ điểm uốn hay đi lại từ đầu); bỏ "Phát hành / Gửi duyệt / Duyệt / Rút yêu cầu" và "Bình luận
    đã ghim" khỏi menu khi đang vẽ (đã có ở thông báo sau khi Lưu và ở chế độ xem).
  - Xoá nét dây có ba lựa chọn (Gỡ luôn kết nối / Chỉ xóa nét vẽ / Hủy = trả nét về); tên tủ nằm
    trong dải trên khung rack; đổi máy khi khai kết nối thì xoá ô cổng đầu đó.
- **Góp ý đợt 3 — menu ⋮ khi vẽ (08/10/2026, chủ dự án chốt):**
  - **Bỏ "Ảnh thật…"**: ảnh do model quản lý. Máy trong khung tủ hiện ảnh mặt trước của model,
    máy ngoài tủ hiện biểu tượng loại. Không còn công tắc mặt trước / mặt sau trên sơ đồ.
  - **Bỏ "Nối hàng loạt"**: làm rối menu. Nối dây bằng vẽ nét rồi khai, hoặc "Khai kết nối".
  - **"Chuyển máy sang tủ…" chỉ hiện khi có máy cần chuyển** (máy kho ghi tủ khác khung tủ nó nằm
    trên bản vẽ). Việc này vốn tự hỏi khi kéo máy vào khung tủ khác. Mục menu luôn hiện mà bấm
    vào chỉ báo "không có máy nào" làm người dùng không hiểu nó để làm gì.
  - **Bỏ "Gắn khung"** (kèm "Đổi tủ của khung này" trong cùng hộp) và **bỏ "Dây chưa khai"**: chủ dự
    án không có nhu cầu dùng (cùng ngày, thay cho bản "thêm dấu ↗ dưới khung" vừa làm). Vào bản vẽ
    con từ cây bản vẽ; chèn nhầm tủ thì xoá khung rồi "Chèn tủ mạng" lại. Khung đã gắn từ trước vẫn
    bấm được ở chế độ Xem (dữ liệu cũ giữ nguyên), chỉ không gắn mới được. Nét chưa khai vẫn tô
    vàng, nét mang kết nối đã gỡ vẫn tô đỏ khi mở.
  - **Thả máy ĐÈ lên khung tủ là thả vào tủ đó**: draw.io không phải lúc nào cũng nhận ô vào khung
    khi thả (ô vẫn thuộc trang, nằm đè lên khung) nên IMS không hỏi gì. Nay tâm ô nằm trong lòng
    khung tủ kho = đã thả vào tủ: IMS đưa ô vào khung, máy tủ khác thì hỏi "Chuyển máy sang tủ
    này?". Đồng ý = ghi site, tủ, U mới vào hồ sơ thiết bị (có trong lịch sử thiết bị); Hủy = đưa ô
    ra cạnh khung, không ghi gì.
  - Menu ⋮ đóng khi bấm vào bản vẽ (iframe draw.io không báo cú bấm lên trang IMS).

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
- **Soát UX đợt 2 — chữ và bộ lọc dùng chung (05/10/2026, chủ dự án duyệt):**
  - **Một tên cho tủ: "Tủ mạng"** (T-03) — ở mọi màn: form thiết bị, cấp bản vẽ, panel sơ đồ,
    bộ lọc, lệnh "Chèn tủ mạng", câu lỗi của API. Không còn "Tủ rack" hay "Tủ" đứng một mình làm
    nhãn. Bài `term-consistency.test.ts` khoá điều này.
  - **Ô "bỏ lọc" của mọi bộ lọc viết "Tất cả …"** (T-07): "Tất cả site / Tất cả tủ mạng / Tất cả
    loại / Tất cả nhà cung cấp / Tất cả kỳ hạn / Tất cả trạng thái…". Câu văn thường ("Mọi phiên
    khác của bạn…") không đổi — luật chỉ cho mục đầu của ô lọc.
- **Soát UX đợt 2 — Thiết bị (05/10/2026, chủ dự án duyệt):**
  - **Trang thiết bị giữ CÙNG một nút chính ở mọi cỡ màn: "Sửa hồ sơ"** (T-05). Trên điện thoại
    nút "Két sắt" thôi là nút chính — két đã là một tab của trang. Bảng phụ trong hồ sơ (Địa chỉ
    IP, Đường truyền ISP, NAT…) ở 390px là danh sách nhãn–giá trị hai cột, không gập thành thẻ
    có dòng trống nhãn.
  - **Gỡ dây giữ cổng** (T-02): bảng cổng có "Gỡ dây (giữ cổng)" trong ⋮ của dòng có dây — bỏ đầu
    kia, giữ VLAN / người dùng / ghi chú (endpoint `unlink` sẵn có, có nhật ký); hỏi xác nhận.
  - **Lọc danh sách thiết bị theo Phòng ban** (T-08), file xuất khớp bộ lọc (thêm `department`
    vào bộ lọc xuất).
- **Hộp mã sơ đồ cũng là hộp NHỎ như hộp mã két** (soát UX đợt 2, K-04, 05/10/2026): tiêu đề
  "Nhập mã 6 số để mở sơ đồ", một dòng nói đang mở gì, 6 ô mã, nút Hủy — bỏ đoạn giải thích dài.
  Phạm vi mã vẫn là `diagram` (mã két không mở sơ đồ), ân hạn và nhật ký như cũ.

### Q-25 · Thư gửi lỗi phải có người thấy và gửi lại được (05/10/2026, chủ dự án duyệt top 10 soát UX)

- Thư đã hết lượt gửi lại tự động (`outbox.max_relay_attempts`) trước nay nằm im trong `outbox`:
  không màn nào liệt kê, không ai gửi lại được. Thư duyệt break-glass, thư khoá tài khoản, bản tin
  hạn đều có thể mất như thế. Lý do chốt: break-glass trên điện thoại sống nhờ thư.
- Màn **Quản trị › Thư gửi lỗi** (CHỈ SA, cùng phạm vi với Tham số hệ thống): mỗi dòng là một thư
  chưa gửi được — loại thư, tạo lúc, số lần thử, lần lỗi cuối, lỗi cuối. Lỗi SMTP có thể chứa địa
  chỉ người nhận nên API che phần trước `@` (`a***@pmh.com.vn`). Không hiện payload của sự kiện.
- **"Gửi lại"**: xoá dấu lỗi + lượt thử để relay đẩy lại thư đó (`requeue`), trong transaction có
  một dòng `audit_log` `outbox.requeued`. Không hỏi mã 2 lớp: gửi lại chỉ gửi đúng thư hệ thống đã
  định gửi, không mở thêm gì. Thư đã gửi xong (hoặc đã dọn) thì báo "không còn để gửi lại".
- Có thư lỗi thì mục menu đó mang badge số (chỉ SA thấy mục và số).
- **Soát UX đợt 2 — Hệ thống (05/10/2026, chủ dự án duyệt):**
  - **Hai tham số nghiệp vụ lên màn Tham số** (X-02, AD-11): `nat.sensitive_ports` (danh sách cổng
    1–65535, cách nhau dấu phẩy, không trùng, không bắt tăng dần, tối đa 50 cổng) và
    `breakglass.recent_window_days` (1–365 ngày). Không còn phải sửa bằng SQL tay.
  - **SA xem "thiết bị đã biết" và IP đang tạm chặn** (X-04) — CHỈ ĐỌC: hộp Chi tiết tài khoản có
    khu "Thiết bị đã biết" (nhãn trình duyệt, thấy lần đầu / gần nhất — không lộ dấu vân tay máy) và
    cột "Lần sai gần nhất" ở bảng tạm chặn; màn Tài khoản có khối "Đang tạm chặn · n" cho toàn hệ
    thống. Gỡ chặn vẫn là "Gỡ tạm chặn" sẵn có (step-up + nhật ký). Chưa làm nút "Quên máy" ở Hồ sơ
    của tôi: cần một đường ghi mới, để đợt sau nếu chủ dự án muốn.
  - **Link thẳng tới một luật NAT** (X-05): `/nat?rule=<id>` mở sổ NAT, tô sáng dòng đó (kể cả khi
    nó nằm ở trang khác / bị bộ lọc ẩn — mở theo id), và menu dòng có "Sao chép link".

### Q-27 · Giao diện C — thiết bị, phần mềm, danh mục (08/10/2026, chủ dự án chốt trên mockup)

Mockup chạy thử: artifact "IMS thiết bị — mockup gọn", trang "Luồng đầy đủ (chạy thử)". Kế hoạch
port: `docs/KE-HOACH-GIAO-DIEN-C.md`. Lý do chung: tạo thiết bị có quá nhiều ô, dễ lẫn thiết bị /
phần mềm / danh mục, trang chi tiết mỗi máy một kiểu vì ô trống bị ẩn.

- **Menu:** "Danh mục" lên đầu nhóm **Tài sản** (trước Thiết bị, Phần mềm), bỏ khỏi nhóm Hệ thống
  — đúng thứ tự khai Danh mục → Thiết bị → Phần mềm. Quyền xem/sửa giữ nguyên.
- **Danh mục:** 9 tab gom 3 nhóm *Vị trí* (Site, Tủ mạng) / *Thiết bị* (Loại thiết bị, Model, Loại
  dây, Cổng dịch vụ) / *Đối tác & tổ chức* (Nhà cung cấp, Nhà mạng, Phòng ban). Đầu màn có thẻ
  "Khai trước khi thêm thiết bị" (đủ / còn thiếu, ví dụ model chưa có ảnh). Link `?tab=` cũ vẫn mở
  đúng nhóm và tab. Cột, bộ lọc, menu ⋮ của từng tab giữ như hiện tại.
- **Đổi nhãn** (bảng A4 của mockup): Hãng → Hãng sản xuất; Tên (thiết bị) → Tên gọi; Loại → Loại
  thiết bị / Loại hồ sơ; Mã → Mã thiết bị / Mã hồ sơ / Mã model; "Dịch vụ / Port" → "Cổng dịch vụ
  (port)"; nút thêm ở màn Dịch vụ có hạn → "Thêm dịch vụ có hạn"; tab "Hồ sơ" của phần mềm →
  "Tổng quan". Tiêu đề hộp thoại mang nhãn phân hệ (Thiết bị / Phần mềm / Danh mục).
- **Bảng thiết bị:** cột ▸ · Ảnh (ảnh model) · Mã thiết bị · Tên · IP quản trị · Vị trí · Trạng
  thái · Thao tác. **Bỏ** cột Người sử dụng, cột Bảo hành và dòng phụ loại · model · serial dưới
  tên (đã có trong hồ sơ). IP thành cột riêng (thay dòng phụ dưới mã), không có IP thì "—". Lọc,
  xuất Excel, dòng nhắc két, máy đã thanh lý, thẻ 390px giữ như cũ.
- **Khu bung dòng** (license đang cài của máy, ghế đang dùng của license) và tab tương ứng trong
  trang chi tiết: tiêu đề cột in đậm; mỗi dòng là một thẻ tách nhau, rê chuột thì nổi lên. Bổ sung
  cho Q-24: cột Ghi chú vẫn luôn có.
- **Form thiết bị:** Model đứng đầu, chọn bằng ảnh thu nhỏ (chọn xong tự điền Loại, Số U, ảnh). Hai
  khối luôn mở: *Máy gì* (Model, Mã, Tên gọi) và *Đặt ở đâu* (Site, Tủ mạng, U trống). Các khối còn
  lại gập, có đếm số ô đã khai: Người dùng & phòng ban · Mua sắm & bảo hành · Truy cập quản trị ·
  Ảnh & giấy tờ · Ghi chú. Không bỏ trường nào.
- **Trang chi tiết thiết bị và phần mềm dùng một khuôn:** đầu trang (mã, trạng thái, nhãn phân hệ)
  + dải 4 ô (thiết bị: Vị trí · Người sử dụng · IP quản trị · Bảo hành; phần mềm: Nhà cung cấp ·
  Hạn · Ghế/Tên miền · Hợp đồng hoặc Giấy tờ). Thiết bị có khung ảnh mặt trước (theo model) / mặt
  sau (riêng máy). Ô chưa khai vẫn đứng đúng chỗ và ghi "chưa khai" (bỏ cách ẩn ô trống). Thiết bị
  có **tab Phần mềm riêng** (thay khu "License đang cài" trong Tổng quan), có nút "Gán phần mềm vào
  máy này". Bản đồ quan hệ giữ, đổi kiểu: ô giữa có ảnh model. Băng báo, các khu IP/NAT/ISP, tab
  Sơ đồ cổng / Két / Lịch sử, hộp Thanh lý giữ nguyên.
- **Mỗi đợt mua license là một hồ sơ riêng** (mã riêng, giấy tờ riêng, key riêng trong két) dù cùng
  tên phần mềm — ví dụ Windows Server 2025 OEM mua 2 ghế, sau mua thêm 3 ghế với key khác: hai hồ
  sơ LIC-…-01, LIC-…-02. Trang chi tiết có dải "Cùng phần mềm, mua theo đợt" (gom hồ sơ license
  cùng tên); menu có "Mua thêm đợt mới…" mở form điền sẵn theo đợt trước, gợi ý mã kế tiếp.
- **Form Thêm phần mềm:** hàng 1 Tên · Mã hồ sơ · Nhà cung cấp; hàng 2 Kỳ hạn · Bắt đầu · Hết hạn;
  khối "Ghế và hợp đồng" có Số ghế (− / +) và ô tick **"Mỗi ghế có hợp đồng, giấy tờ và ghi chú
  riêng"** (chỉ bật được khi ≥ 2 ghế; bớt xuống dưới 2 thì tự tắt):
  - **Không tick:** các ghế dùng chung *Số hợp đồng / PO*, *Ghi chú* và *Giấy tờ* của hồ sơ.
  - **Có tick:** bảng Ghế 1…N, mỗi ghế có số hợp đồng, ghi chú, giấy tờ riêng; ô ghi chú và giấy tờ
    chung của hồ sơ bị ẩn. Đổi số ghế thì bảng thêm / bớt dòng (không bớt được ghế đang có máy).
  - Không có ô chi phí ở form. Nút chính "Lưu rồi gán vào máy".
  - Ba màn Tên miền & SSL / Hợp đồng bảo trì / Dịch vụ có hạn khác dùng cùng khuôn form, không có
    ghế và không có tick.
- **Gán license vào máy chỉ chọn máy** (theo Máy / Phòng ban / Người sử dụng, lý do khi vượt ghế).
  Bỏ các ô Chi phí, Hợp đồng, Bắt đầu, Kết thúc, Ghi chú khỏi hộp Gán. Hồ sơ có tick thì hộp Gán
  có bảng "Máy vào ghế nào": mặc định ghế trống theo thứ tự, đổi được.
- **Sửa ghế** (của một máy): Chi phí, Bắt đầu, Hết hạn, Ghi chú. **Bỏ ô Hợp đồng** (hợp đồng thuộc
  hồ sơ hoặc thuộc ghế ở form). Máy thuộc ghế riêng thì hộp hiện "đang ở Ghế n · HĐ … · giấy tờ",
  ghi chú của ghế sửa ở Sửa hồ sơ. Cột `license_assignment.contract` cũ giữ trong DB, không xoá.
- **Dữ liệu:** cần migration mới — bảng ghế của hồ sơ (số thứ tự, số hợp đồng, ghi chú; chủ là module
  software, AD-3), liên kết ghế ↔ lần gán máy, cột số hợp đồng chung và cờ "mỗi ghế riêng" trên
  `software`, loại chủ sở hữu file mới cho giấy tờ của ghế. Có `@Audited` + `@Roles` + lịch sử như
  mọi đường ghi.
- **Bổ sung 10/10/2026** (chủ dự án duyệt đợt soát UX sau khi port): **một thông tin chỉ nói một
  lần** trên trang chi tiết.
  - Thứ đã có ở dải 4 ô thì **không lặp** ở Thông số / Thông tin hay ở cột phải. Hạn (bảo hành của
    máy, hạn của phần mềm) nói ở ô của dải: huy hiệu còn bao lâu, khoảng ngày, thanh thời gian gọn.
  - Phần mềm **bỏ thẻ "Thẻ định danh"** ở cột phải; trạng thái lên dòng dưới mã. Cột phải chỉ còn
    khi có thẻ riêng (các đợt mua, tên miền); không có thì trang một cột.
  - Thiết bị: cột phải là "Trong tủ" + thẻ Nhà cung cấp (liên hệ gọi bảo hành, ngày tạo / sửa).
    Khu "Hình dùng trên sơ đồ" gập sẵn; dòng tiêu đề nói mỗi mặt đang dùng ảnh gì, lời giải
    thích dài chuyển vào nút (i). Trên máy tính, các khu
    Địa chỉ IP / NAT / Đường truyền **gập sẵn** vì bản đồ quan hệ đã tóm tắt; bấm nút trên bản đồ
    thì mở đúng khu. Trên điện thoại (không có bản đồ) vẫn mở sẵn.
- **Soát UX toàn portal 10/10/2026** (chủ dự án duyệt sửa hết danh sách soát U-01…U-40):
  - Một kiểu **chip bật/tắt bộ lọc** cho mọi màn (`FilterToggle`; ô tick trong thanh lọc cùng
    dáng). Ô "Sắp theo…" không tô xanh như bộ lọc; phạm vi mặc định của Sắp hết hạn cũng không.
  - Nút chính trong dòng bảng ("Sửa", "Cấp IP") là **nút có viền** như "Gia hạn" / "Mở két"; ô
    không có menu ⋮ vẫn giữ chỗ để cột thao tác thẳng hàng. Nút phân trang cao bằng ô "Số dòng".
  - Nhóm nút chọn trên điện thoại **một hàng, cuộn ngang, có bóng ở mép**; Két sắt và Kho thanh
    lý có lựa chọn "Tất cả" / "Mọi lúc". Ô thống kê 4 hoặc 6 ô chia 2 cột trên điện thoại.
  - Vai trò: Super Admin màu nhấn thương hiệu, Quản trị xanh thông tin — **không dùng đỏ / cam**
    (màu lỗi, cảnh báo). Ô ngày chỉ một biểu tượng lịch. Khung trống kết thúc bằng dấu chấm.
  - Gỡ đường `/documents` (chưa từng có màn; vào là 404 mà tiêu đề vẫn ghi "Tài liệu").
  - **Giữ nguyên có chủ ý:** nút thanh lưu Tham số cỡ nhỏ (Q-21); số + danh từ viết hoa (Q-24);
    thứ tự "Danh sách | Bản đồ" theo chế độ mặc định của từng màn; bố cục bản đồ Sơ đồ mạng
    (04/10); "›" chỉ ở ô thống kê là link (ô là bộ lọc thì không); màu chữ nút chính (token).
- **Soát bằng mắt 11/10/2026** (Claude lái Playwright qua 27 màn ở desktop và 390px; chủ dự án
  duyệt sửa hết, kể cả hai việc lớn):
  - **Đường truyền và Tài khoản dịch vụ theo khuôn C** như thiết bị / phần mềm: trạng thái lên
    dòng dưới mã; dải 4 ô (đường truyền: Hotline · IP WAN · Thiết bị đầu cuối · Số hợp đồng; tài
    khoản: Tên đăng nhập · Người phụ trách · Hết hạn · Dải IP được phép, tài khoản không phải VPN
    thì ô thứ tư là Giấy tờ); bỏ "Thẻ định danh" ở cột phải, trang một cột; khu Thông số / Thông
    tin liệt kê đủ ô theo thứ tự, ô trống ghi "chưa khai", nút "Bổ sung n ô" đếm đúng ô của khối
    đó (như thiết bị / phần mềm; ô trống ở dải 4 ô không tính). Phòng ban của tài khoản là một
    dòng của khu Thông tin, nên thiếu là thấy và được đếm. Lý do: hai trang
    này còn kiểu cũ — một thẻ bên phải chỉ để chứa mỗi trạng thái, và khu "Hồ sơ" rỗng chỉ có
    dòng "Chưa khai báo". Băng thông thành một dòng có nhãn trong Thông số (trước đứng trơn "400"
    dưới mã, không biết là gì). Tab "Hồ sơ" của đường truyền đổi thành "Tổng quan" như phần mềm.
  - **Nút "Sửa hồ sơ" luôn hiện ở đầu trang, cả trên điện thoại** (đường truyền trước giấu vào
    ⋯ trên điện thoại, các trang khác thì hiện) — một kiểu cho mọi trang chi tiết.
  - **Dải IP trống liền nhau gộp thành một dòng** ở chế độ "Tất cả" khi chuỗi từ 10 ô trở lên
    ("172.16.10.3 – 172.16.10.50 · 48 IP trống", nút "Cấp IP" cấp ô đầu, nút "Hiện từng IP" bung
    ra). Chế độ "Trống", ô tìm, và địa chỉ đang được trỏ tới (link `?ip=`) vẫn hiện từng ô. Chuỗi
    đã bung thì vẫn bung sau khi cấp một IP trong nó (cấp liền nhiều IP không phải bấm lại).
  - Một thông tin nói một lần: thanh ghế chỉ ở dải 4 ô (tab Máy đang dùng không vẽ lại); dải IP
    trên điện thoại chỉ còn ô chọn dải + menu ⋯ (thẻ dải lặp đúng những gì tiêu đề bên dưới nói).
  - **Thanh lọc trên điện thoại** (≤600px) tự gập sau nút "Bộ lọc (n)" khi có từ 3 ô lọc trở lên
    và màn đếm được bộ lọc đang bật (có "Xóa lọc"); 1–2 ô, hoặc màn không đếm, thì vẫn bày ra —
    nút "Bộ lọc" không số giấu mất việc danh sách đang bị lọc. Sổ NAT tính cả chip trạng thái
    khác mặc định vào số đó. Thẻ "Khai trước khi thêm thiết bị" gập thành một dòng khi cả 6 mục đã
    đủ. Danh mục trên điện thoại: nút chính đứng trước ⋯ như mọi màn.
  - Lọc trạng thái Sổ NAT (chọn được nhiều) dùng chip có ô tick (`FilterToggle`), không dùng dáng
    nhóm nút chọn-một. Hộp Đổi IP chọn sẵn dải của IP hiện tại; mã đối tượng ở Nhật ký là UUID
    thì luôn rút 8 ký tự (bản đầy đủ ở nút chép và khi rê chuột), mã khác (khoá cấu hình…) để
    nguyên vì nó là thứ duy nhất nói dòng đó về cái gì.
  - Lỗi vẽ: nhãn ô thống kê xuống dòng thay vì tràn ô; bảng dòng-là-thẻ (`table-cards`) khi xếp
    dọc trên điện thoại vẽ khung cho cả thẻ, không cho từng ô; dòng sọc của bảng IP tô cả thẻ.
  - **Giữ nguyên có chủ ý:** nhãn phân hệ ở đầu hộp thoại chỉ cho Thiết bị / Phần mềm / Danh mục
    (ba thứ hay bị lẫn — Q-27), không thêm cho hộp IP / NAT / két.

### Q-28 · Phiếu ISO đợt 1: chỉ 0203, 0206, 0208 (12/10/2026, chủ dự án chốt)

Thay phạm vi Epic 8–9 trong `epics.md` cho đợt này. Lý do: đối chiếu bộ mẫu thật
(`Epic8-9 Document/SP-IT02/`) cho thấy epics lệch mẫu nhiều chỗ. Chủ dự án chỉ cần ba phiếu
IT dùng hằng ngày.

- **Phạm vi:**
  - Đợt này làm 0203 (theo dõi backup), 0206 (ghi nhận sự cố) và 0208 (theo dõi antivirus).
  - Để sau: 0204, 0207, 0209, 0210, 0213, 0214, 0201, 0211, 0212, Documents.
  - Không làm: 0205 (phiếu gửi các phòng ban tự theo dõi và ký, IT không quản trên IMS).
- **Mẫu giữ nguyên như giấy:** cột, bố cục, ô ký. Tên job, tên máy, bộ phận đều gõ tay,
  không lấy từ kho thiết bị.
- **0203:**
  - Cột cố định: `No · Name Job Backup · Points NAS · Storage location · Points Cloud ·
    Storage location · 1…31`.
  - Danh sách job do IT thêm, sửa, sắp xếp, ngừng. Seed sẵn 30 job theo mẫu. Số điểm lưu và
    nơi lưu là thông tin của job.
  - Mỗi ô ngày nhận ✓ hoặc ✗; ngày tương lai bị khoá. Có nút đánh ✓ cả ngày cho mọi dòng chưa
    tick, rồi chỉ sửa ô lỗi thành ✗.
  - Bản in dùng ✓/✗ (máy chủ không có font emoji).
- **0206:**
  - Dùng cho mọi sự cố: lập từ ô ✗ của 0203 hoặc 0208, hoặc lập thẳng cho sự cố khác (sau này
    cả nâng cấp hệ thống).
  - Một phiếu cho một ngày, hoặc nhiều ngày của cùng một sự cố.
  - Detection Time và Resolution Time nhận ngày + giờ, chọn trên lịch theo khoảng.
  - Sự cố kéo dài (X → Y): IT thường lập phiếu khi đã sửa xong (ngoại lệ In Progress xem bên dưới).
  - Loại Backup có bảng "Detail Error Backup" (nhiều job một phiếu); bốn loại còn lại chỉ có
    phần chung, đúng mẫu.
  - Ô ✗ được coi là "đã có phiếu" khi nằm trong khoảng ngày của một 0206 có ghi đúng dòng đó.
- **0208:**
  - Mỗi dòng là **một lần issue**: một máy, một ngày phát hiện. Cùng máy có hai ngày issue
    trong tháng thì ghi hai dòng.
  - Dòng gom theo bộ phận. Bộ phận không cố định: chỉ thêm bộ phận nào có issue trong tháng.
  - Dòng cuối "Other Division" tick ✓ đủ 1–31, nghĩa là các phòng ban khác không có issue.
  - Ngày không có issue thì ✓; ✗ cũng phải có phiếu 0206 như 0203.
- **Chốt kỳ (cả ba phiếu):**
  - Không chốt được khi còn ô ✗ chưa có 0206.
  - Member gửi yêu cầu chốt; SA/Admin duyệt qua bộ máy xin – duyệt dùng chung (Q-05). Duyệt
    xong thì phiếu khoá.
  - Member in ra, ký tay, scan rồi đính kèm bản đã ký vào phiếu.
- **Mở lại kỳ đã chốt:** Member gửi yêu cầu kèm lý do bắt buộc; SA/Admin duyệt.
- **Quyền:** xem mục "Người phụ trách" bên dưới (thay luật cũ "mọi tài khoản IT tick phiếu").
- **Lưu và tra cứu:** giữ vĩnh viễn, tra theo năm / tháng / loại (FR-031). Quy trình SP-IT02
  không quy định thời hạn lưu.
- **Bổ sung sau khi duyệt thiết kế (12/10/2026, chủ dự án duyệt bản Claude Design
  `https://claude.ai/artifact/DPeb4R4GFzJKJ1y8UN6svp`):**
  - Lưới tháng là chỗ thao tác duy nhất của 0203: bấm ô để đổi ✓ / ✗ / trống, lập hoặc mở 0206;
    nút ✓ trên đầu mỗi cột đánh hết ô còn trống của ngày đó. Sửa được mọi ngày đã qua của kỳ đang
    ghi. Ô trống ở ngày đã qua là "bỏ sót" và được đếm riêng.
  - 0208 ghi theo ngày: mỗi ngày đã qua hoặc hôm nay phải có kết quả, là "không có issue" hoặc ít
    nhất một dòng issue. Form ghi issue chọn được ngày, có đủ cột của mẫu (Reported Date, Division,
    Computer Name, Incident Description, Resolution Date, Handled).
  - Danh sách job backup (0203) và danh sách bộ phận (0208) là hai danh sách do IT tự quản, nằm ở
    mục "Danh mục phiếu" riêng trong nhóm Phiếu ISO của sidebar (đổi 13/10/2026). Bộ phận chỉ để
    chọn nhanh; phiếu tháng vẫn chỉ hiện bộ phận có issue. Thêm, sửa, ngừng chỉ áp cho kỳ chưa chốt; kỳ đã chốt giữ danh sách lúc chốt.
  - Bốn trạng thái kỳ, dùng một tên ở mọi màn: **Đang ghi → Chờ duyệt → Đã chốt · chờ bản ký →
    Hoàn tất.** Chờ duyệt thì ô đã khoá; SA/Admin "Trả lại" thì kỳ về Đang ghi.
  - Trước khi gửi chốt 0203 / 0208 phải qua màn **Xem lại**: đúng bản in sẽ ký, cùng danh sách kiểm
    (đủ ngày, không còn ô bỏ sót, mọi ✗ đã có 0206). Còn mục chưa đạt thì không gửi được.
  - Lập 0206 cũng có bước Xem lại (bản phiếu dạng giấy + danh sách kiểm) trước khi lưu. Số phiếu
    `0206-YYYY-NNN` chỉ cấp khi lưu, đếm lại từ 001 mỗi năm.
  - 0206 khoá khi kỳ của nó được duyệt chốt, và có bản ký riêng của từng phiếu.
  - Màn Kỳ phiếu xếp theo năm rồi tháng; mỗi loại phiếu một cột, loại phiếu làm sau thêm cột mới.
  - Kỳ đã khoá vẫn mở xem được ở màn phiếu (dải "Đã chốt · chỉ xem", không bấm được ô).
  - Chỉ gửi chốt được từ ngày cuối tháng của kỳ trở đi (Check Date trên bản in là ngày cuối kỳ).
  - Member gửi chốt thì SA/Admin duyệt. SA/Admin tự gửi chốt thì được tự duyệt (có ghi nhật ký).
  - 0206 thuộc kỳ của tháng chứa Detection Time, không theo Date Report.
- **Trả lời câu hỏi trước khi code (13/10/2026, chủ dự án):**
  - Bộ phận 0208: không seed sẵn 5 bộ phận của mẫu, chỉ một bộ phận làm ví dụ; IT tự thêm bộ
    phận khác. Bản in 0208 chỉ có các dòng thực sự ghi, không in dòng trống cho bộ phận không có
    issue.
  - Dòng Note cuối mẫu 0208 giữ nguyên như giấy (0208 cũng dùng ✓ / ✗).
  - Số phiếu 0206 chỉ hiện trên IMS, không in lên bản giấy. Danh sách 0206 phải cho thấy sự cố
    thuộc phiếu nào (0203 / 0208 / khác) và xem theo năm.
  - Một sự cố chỉ một phiếu 0206. Sự cố bắt đầu tháng 10 kéo sang tháng 11 thì phiếu tính cho
    tháng 10; ô ✗ của tháng 11 gắn vào chính phiếu đó, không lập phiếu mới.
  - Sự cố chưa sửa xong lúc cuối tháng: được lập 0206 trước với Current Status = In Progress; sửa
    xong thì đổi trạng thái rồi in trình ký. Thường lệ vẫn là sửa xong mới lập.
  - Job thêm giữa tháng: các ngày trước ngày bắt đầu để trống và không tính là bỏ sót. Gần như mọi
    job chạy hằng ngày, không cần ô "không áp dụng".
  - Job #24–29 của mẫu là dòng dư, vẫn tick bình thường; không tạo các job này trên prod.
  - Mở lại kỳ thì các 0206 của kỳ đó mở theo; phiếu nào bị sửa thì bản ký cũ của nó bị đánh dấu
    cũ, phải in, ký và tải bản mới.
  - Nhóm Phiếu ISO trên sidebar thu gọn mặc định vì ít dùng, bấm mới mở; đang ở màn phiếu thì tự
    mở. Khi thu gọn, đầu nhóm hiện số việc cần làm.
  - Cột Division của 0208 khác nhau theo tháng: bộ phận có dòng trong tháng khi ghi issue cho bộ
    phận đó; form ghi issue cho thêm bộ phận mới ngay tại chỗ (lưu luôn vào danh mục).
  - Bắt đầu dùng từ tháng 11/2026. Kỳ phiếu tự sinh theo năm / tháng cho mọi năm sau, không nhập
    tay từng kỳ.
  - 0206 đang In Progress không chặn chốt kỳ: ô ✗ đã có phiếu là đủ để gửi chốt. Phiếu đó vẫn sửa
    được tới khi đổi sang Resolved, lúc đó mới khoá, in và tải bản ký riêng. Kỳ chỉ Hoàn tất khi
    mọi 0206 của kỳ đã có bản ký.
  - **Người phụ trách:** màn Danh mục có chỗ gán người phụ trách cho từng loại phiếu (0203, 0208,
    loại phiếu làm sau cũng dùng chỗ này): một người chính và một người dự phòng.
  - Chỉ người phụ trách (chính hoặc dự phòng) và SA/Admin được tick, ghi issue và gửi chốt phiếu
    đó; Member khác chỉ xem. 0206 lập từ ô ✗ theo quyền của phiếu chứa ô đó; 0206 lập thẳng thì
    mọi tài khoản IT lập được.
  - Email nhắc làm trong Epic 8, giờ gửi và số ngày nằm ở `system_config`:
    - Nhắc tick hằng ngày: sáng hôm sau, nếu ngày hôm qua còn ô trống thì gửi người phụ trách.
    - Nhắc gửi chốt: ngày cuối tháng, và nhắc lại nếu sau N ngày vẫn chưa gửi.
    - Báo duyệt: có kỳ chờ duyệt thì báo SA/Admin; trả lại hoặc đã duyệt thì báo người gửi; chờ
      duyệt quá N ngày thì nhắc lại.
    - Nhắc việc tồn: kỳ đã chốt quá N ngày chưa có bản ký; 0206 In Progress quá N ngày.
- **Chốt sau code review Epic 8 (14/10/2026, chủ dự án duyệt đề xuất của Claude):**
  - 0206 cũng khoá sửa từ lúc kỳ quản nó sang **Chờ duyệt**, không đợi tới lúc duyệt chốt. Lý do:
    ô lưới đã khoá từ Chờ duyệt, nếu phiếu vẫn sửa được thì SA có thể duyệt một bản vừa bị đổi.
    Cần sửa thì SA/Admin "Trả lại" để kỳ về Đang ghi. 0206 đang In Progress vẫn sửa được như cũ.
    Bản ký vẫn chỉ tải lên sau khi kỳ được duyệt chốt.
- **Chốt sau khi chủ dự án xem giao diện (14/10/2026):**
  - Points NAS / Points Cloud chỉ nhận số nguyên 0–9999 (API `ISO_JOB_POINTS`). Storage location
    không nhập tay: có Points NAS thì ghi `NAS`, có Points Cloud thì ghi `Cloud`, không có Points thì
    để trống như các dòng trống của mẫu. Lý do: ô chữ tự do đã cho lọt "c" vào phiếu in.
  - Lưới 0203 không hiện Points / Storage location (ít đổi, làm rối lưới); bản in giữ đủ cột mẫu.
  - Bấm ô 0203 đi vòng trống → ✓ → ✗ → trống, một lần bấm một bước; ô ✗ đã gắn 0206 bấm là mở
    phiếu (không đổi kết quả). 0208: bấm ô dòng Other Division để bật / tắt "không có issue".
  - Lập / sửa 0206 bằng hộp ngay tại lưới 0203, 0208 và danh sách sự cố, không chuyển trang. Form
    nhập là form gọn theo theme; bản phiếu đúng mẫu Word hiện ở bước Xem lại và bản in.
  - Nút "Xem lại & gửi chốt" đổi thành "Xem phiếu"; nút gửi ghi rõ "Gửi chốt phiếu tháng MM/YYYY".
  - (test tay lần 2) Detail Error Backup: Job Name chọn từ các dòng của lưới 0203 (job › đối tượng
    con), Storage Location chỉ NAS / Cloud — gõ tay thì tên trên 0206 lệch 0203. Trên bản phiếu,
    sáu cột Type Backup / Type Data là ô tick hẹp như mẫu Word.
  - Handled của 0208 = tên tài khoản ghi dòng issue, API tự ghi, không sửa được.
  - Dấu ✗ trên lưới không khung, như ✓: đỏ = chưa có 0206, cam = đã có 0206.
  - Job mới mặc định "Theo dõi từ" ngày 1 của tháng, để khai job giữa tháng vẫn đánh bù được
    những ngày đã qua.
  - 0208 giữ nguyên: ✗ chỉ ở ngày phát hiện (Reported Date), không kéo tới Resolution Date —
    Resolution Date đã có cột riêng trên phiếu.
- **0208 bấm từng dòng (15/10/2026, chủ dự án chốt):** thay luật "một ngày là không có issue HOẶC
  có dòng issue" và luật "chỉ ô Other Division bấm được" ở trên. Lý do: trên giấy mỗi dòng máy được
  tick riêng từng ngày, và Other Division chỉ nói về các bộ phận KHÔNG có dòng.
  - Ô của dòng máy có issue bấm được ở mọi ngày đã qua của tháng (kể cả trước Reported Date), đi
    vòng trống → ✓ → ✗ → trống như 0203. Ô ở đúng Reported Date luôn ✗, không bấm.
  - Other Division là dòng riêng, tick tay ở mọi ngày, kể cả ngày có issue. Ngày đã tick Other
    Division thì các dòng máy chưa bấm ở ngày đó hiện ✓.
  - Tháng chỉ có MỘT dòng máy: bấm ✓ ở dòng đó thì Other Division của ngày đó cũng tự ✓. Từ hai
    dòng trở lên thì Other Division tick tay.
  - Một ngày "có kết quả" khi Other Division đã ✓; nút "✓ Other Division cho N ngày còn trống" và
    danh sách kiểm gửi chốt đếm theo đó.
  - ✗ bấm ở ngày khác Reported Date chỉ là dấu trên phiếu; 0206 vẫn gắn theo dòng issue (ngày
    phát hiện).

### Q-29 · Chốt sau review toàn dự án (19/10/2026, chủ dự án duyệt đề xuất của Claude)

- **Bản scan đã ký của phiếu ISO:**
  - Kỳ đang khoá (Đã chốt · chờ bản ký, Hoàn tất) thì không ai xoá được bản ký, kể cả SA. Muốn
    thay thì xin mở lại kỳ (Q-28).
  - Lý do: bản ký là bằng chứng ISO. Xoá được thì kỳ "Hoàn tất" mất bằng chứng mà không ai duyệt.
  - Lưu SHA-256 của mọi file lúc tải lên, để đối chiếu được file chưa bị thay.
- **Danh mục phiếu (job 0203, bộ phận 0208):**
  - Chỉ người phụ trách của phiếu đó (chính hoặc dự phòng) và SA/Admin được thêm, sửa, sắp xếp,
    ngừng. Thay câu "do IT tự quản" ở Q-28.
  - Lý do: ngừng job hay dời ngày bắt đầu theo dõi làm ô trống không còn bị tính là bỏ sót, tức là
    đi vòng quyền ghi phiếu.
  - 0208 cho thêm bộ phận mới ngay trong form ghi issue (Q-28), nên chỗ đó theo quyền ghi 0208.
- **Import Excel lớn:** gộp truy vấn theo lô và nới thời gian chờ riêng cho route import. Không đưa
  sang worker; giao diện import giữ nguyên.
- **Nhật ký sửa hồ sơ tài khoản (NĐ 13/2023):** chỉ ghi tên trường đã đổi (`changed`), không ghi giá
  trị SĐT, ngày sinh, họ tên, mã nhân viên. Lý do: `audit_log` chỉ-thêm, giữ vĩnh viễn, nên giá trị
  ghi vào đó không bao giờ xoá được. Giới hạn: các dòng ghi trước thay đổi này vẫn còn giá trị cũ, vì
  bảng chỉ-thêm không sửa được; muốn xoá phải làm theo quy trình lưu trữ năm cũ của audit.

### Q-30 · "Xin mở két" duyệt bằng mã gửi qua mail (20/10/2026, chủ dự án chốt)

Sửa Q-05 (vế break-glass). Lý do: IMS chỉ chạy trong LAN, không mở ra Internet, nên người duyệt ở
ngoài không vào IMS bấm Duyệt được. Chủ dự án chấp nhận rủi ro vì người xin đã phải đăng nhập bằng
mật khẩu + mã 2 lớp, còn hộp mail SA/Admin có 2FA của Google Workspace.

- **Người xin chọn đúng một người duyệt** (SA/Admin đang hoạt động, không phải chính mình) khi gửi
  yêu cầu. Chỉ người đó nhận thư.
- **Thư mang mã 6 số ngẫu nhiên**, cùng đối tượng · lý do · số giờ xin. Người duyệt đồng ý thì đọc
  mã cho người xin (gọi điện, gặp trực tiếp); không đồng ý thì không báo mã.
- **Người xin nhập mã trong IMS = được duyệt.** Số giờ cấp đúng bằng số giờ xin (kẹp theo
  `breakglass.max_grant_hours`). Quyền gắn ngay vào phiên đã nhập mã (Q-15); bước Xem vẫn đòi mã
  2 lớp như cũ. Nhật ký ghi người duyệt là người nhận mã, kèm "duyệt bằng mã".
- **Mã sống 10 phút, viết cố định trong code, không đưa vào `system_config`.** Đây là ngoại lệ có
  chủ ý của AD-11: không ai nới được hạn mã từ màn Tham số.
- **"Gửi lại mã" tối đa 3 lần** cho một yêu cầu. Mã mới huỷ mã cũ. Quá 3 lần thì gửi yêu cầu mới.
- **Mã dùng một lần**, chỉ người xin nhập được, chỉ lưu dạng băm (HMAC). **Sai 5 lần** (cộng dồn cả
  các lần gửi lại) thì yêu cầu bị huỷ.
- **Bỏ nút Duyệt trong IMS.** Người duyệt vẫn **Từ chối** được trong IMS (khi đang ở LAN) và vẫn
  **Thu hồi sớm** quyền đã cấp. Người xin vẫn tự rút yêu cầu và tự trả quyền.
- Yêu cầu chờ quá `breakglass.pending_expire_hours` vẫn tự hết hạn (Q-15). Thư nhắc định kỳ
  (`approval.reminder_hours`) không gửi cho yêu cầu mở két nữa, vì người xin tự bấm "Gửi lại mã".

- **Gọn chữ (20/10/2026, chủ dự án chốt sau khi xem):** hộp Xin mở két chỉ còn ba ô — Người
  duyệt, Lý do, **"Mở trong"** (chọn nấc giờ, bỏ ô gõ số và các đoạn giải thích). Khung chờ mã
  chỉ một dòng "Đã gửi mã cho X · còn m:ss" + ô 6 số + Xác nhận / Gửi lại mã (N) / Rút yêu cầu;
  "còn N lần nhập" chỉ hiện sau khi nhập sai. Quyền đang chạy: "Đang mở két · còn h:mm" + Trả
  quyền. Phía người duyệt gọi số giờ là "Mở trong", hướng dẫn rút còn "Đồng ý → đọc mã trong
  thư cho người xin."

### Q-31 · Nhóm quyền cho Thành viên (16/10/2026 chốt hướng, 20/10/2026 duyệt mockup)

Lý do: chủ dự án muốn chia việc theo người (người lo mạng, người lo tài sản / phiếu). Hiện mọi
Member thấy như nhau.

- **Nhóm quyền đặt tên** (vd "Mạng", "Tài sản"). SA tạo, sửa, xoá; mỗi Member thuộc **tối đa một**
  nhóm. Member chưa gán nhóm = "Đủ quyền", thấy như trước Q-31. **Chỉ áp cho Member**: SA/Admin luôn
  đủ, không gán nhóm được.
- **Ô tick (7 ô):** Tổng quan · Tài sản · Mạng · Phiếu 0203 · Phiếu 0206 · Phiếu 0208 · Xin mở két.
  Nhóm phải có ít nhất một ô. Không có ô riêng cho "Kỳ phiếu & chốt kỳ" và "Danh mục phiếu": hai mục
  đó hiện khi nhóm có ≥1 phiếu, và chỉ liệt kê kỳ / danh mục của phiếu được tick.
- **Chỉ hai trạng thái: hiện / ẩn.** Ẩn nghĩa là:
  - mất khỏi sidebar, khỏi ô tìm nhanh (command palette) và khỏi số đếm trên menu;
  - gõ URL thì gặp màn "Không có quyền";
  - API riêng của mảng trả 403;
  - tab / khối của mảng nằm ở màn khác cũng ẩn (vd tab IP, NAT, sơ đồ trong chi tiết thiết bị;
    khối dải mạng, sự cố trên Bảng điều khiển; nút xin mở két trong khung két).
  - **Không** có mức "xem nhưng không ghi". Quyền ghi vẫn theo `@Roles` và người phụ trách phiếu ISO
    như cũ.
- **Tra cứu dùng chung vẫn chạy:** ô chọn thiết bị, danh mục (site, tủ, loại thiết bị, bộ phận),
  model, đường truyền, cổng. Ví dụ nhóm chỉ có Mạng vẫn chọn được thiết bị khi cấp IP. Màn Danh mục
  vẫn thuộc Tài sản, nhưng API đọc danh mục không bị chặn.
- **"Sắp hết hạn" cần cả Tổng quan lẫn Tài sản**, vì mọi dòng trên đó là dữ liệu Tài sản. Thiếu
  Tài sản thì ẩn, để không bấm vào một dòng rồi gặp màn "Không có quyền".
- **Màn mở đầu:** nhóm không có Tổng quan thì sau đăng nhập vào mục đầu tiên còn hiện trên menu.
- **Người phụ trách phiếu ISO phải thấy phiếu đó.** Hệ thống chặn khi lưu, báo một dòng nêu tên người:
  - không gán làm người phụ trách (chính / dự phòng) một Member mà nhóm của họ ẩn phiếu đó;
  - không bỏ tick một phiếu khỏi nhóm, không chuyển Member sang nhóm ẩn phiếu đó, khi người ấy đang
    phụ trách phiếu.
- **Tick 0203 hoặc 0208 thì kéo theo 0206** (21/10/2026). Lý do: ô ✗ trên phiếu 0203 / 0208 phải có
  phiếu sự cố 0206 thì kỳ mới chốt được; người phụ trách không thấy 0206 thì kẹt kỳ. Trên bảng tick,
  ô 0206 tự tick và khóa khi nhóm còn 0203 hoặc 0208. API cũng tự thêm 0206 khi lưu và khi tính
  quyền, nên nhóm lưu bằng đường khác vẫn không thiếu.
- **Không đòi mã 6 số** khi tạo / sửa / xoá nhóm hay đổi nhóm của một người: nhóm chỉ thu hẹp quyền
  Member, không bao giờ cho thêm. Mọi thao tác vẫn ghi nhật ký (AD-5, AD-9). Xoá nhóm còn người thì
  bị chặn.
- **Có hiệu lực ngay:** API đọc nhóm ở mỗi request. Màn đang mở của Member nhận thay đổi ở lần tải
  `me` kế tiếp.
- **Thư không đổi:** thư hạn (người nhận do SA khai từng luật), thư nhắc ISO (người phụ trách + SA /
  Admin), thư sơ đồ và thư mở két vẫn gửi như cũ.

### Q-32 · Soát giao diện doanh nghiệp (21/10/2026, chủ dự án duyệt mockup)

Chủ dự án duyệt mockup bố cục ngày 21/10/2026 và cho làm toàn bộ kế hoạch soát giao diện. Mục nào
đổi một quyết định cũ thì ghi ở đây, kèm quyết định bị đổi.

- **Dải nút chọn một trong FORM xuống hàng khi hẹp** (đổi một phần Q-24). Vẫn trải hết bề ngang
  ô và chia đều như Q-24, nhưng không đủ chỗ (điện thoại, phiếu 0206 có 5 lựa chọn) thì xuống hàng
  thành lưới các ô bằng nhau, thay vì cuộn ngang làm mất lựa chọn cuối ("Other") và cắt chữ ("In
  Pro…"). Dải nút LỌC trên thanh công cụ vẫn cuộn ngang như cũ.
- **Bỏ "Dòng thời gian" của bản vẽ** (đổi một phần FR-040, UX-E03). Thanh trượt "bản chính thức
  hiệu lực ngày X" là cách xem thứ ba cho cùng một câu hỏi: danh sách "Đã phát hành · n" và hộp
  Phiên bản đã trả lời ngày nào bản nào. Phiên bản, so sánh, khôi phục của FR-040 giữ nguyên.
- **Bỏ "Trình chiếu" cây bản vẽ** (đổi một phần FR-046, UX-E04). Ít dùng và dễ lẫn với "Bản trình
  bày". Tìm, chỉ đường, lớp, điện thoại chỉ xem của FR-046 giữ nguyên.
- **Bỏ ô "Tra IP hoặc máy…" ở màn Địa chỉ IP** (UX-E19). Trùng Tìm nhanh (Ctrl+K, cùng API, cùng
  đích — tra được cả IP trống). Ô "Lọc trong dải" chỉ đường khi gõ đủ một IP của dải khác.
- **Khối "Bản vẽ chờ duyệt" dời từ màn Duyệt sang đầu màn Sơ đồ mạng** (đổi một phần D-07,
  UX-E07). Màn Duyệt chỉ còn yêu cầu mở két; mục "Sơ đồ mạng" trên menu vẫn mang số bản vẽ chờ
  và nay dẫn thẳng tới khối đó. Ở tab "Chờ duyệt" của màn Duyệt, thẻ không đeo lại huy hiệu
  "Chờ duyệt"; huy hiệu "Chờ lâu" giữ nguyên.
- **Giao diện đổi ở một nơi trên thanh công cụ: menu tài khoản** (đổi một phần Q-20, UX-E18).
  Topbar bỏ nút sáng/tối; menu tài khoản chỉ còn "Hồ sơ của tôi · Giao diện · Đăng xuất" (bỏ hai
  mục "Đổi mật khẩu", "Xác thực 2 lớp" cùng dẫn vào Hồ sơ). Hồ sơ vẫn có thẻ Giao diện. Nút tài
  khoản mang một mũi tên lên, cùng màu ở mọi giao diện (PW-C26).

### Q-09 · Tài liệu

- Chỉ giữ tài liệu còn sống trong `docs/`. Biên bản, code review, rà soát theo ngày thì xoá khi đã
  gom phần còn mở vào checklist; lịch sử nằm trong git.
