---
title: PRD — IMS (Hệ thống quản lý IT nội bộ PMH)
status: final
created: 2026-08-19
updated: 2026-10-02
source: _bmad-output/brainstorming/brainstorm-quan-ly-he-thong-it-2026-08-19/brainstorm-intent.md
---

# PRD — IMS

## 1. Tầm nhìn

**IMS là hệ thống quản lý hạ tầng IT nội bộ của PMH** — nơi duy nhất lưu toàn bộ thiết bị, IP, license, secret (credential) và phiếu ISO của 3 site. Nó tồn tại để: tri thức hạ tầng **không rời đi theo người**, bằng chứng **luôn sẵn sàng khi audit**, và team IT **tra cứu trong 30 giây thay vì mò Excel/giấy/Zalo**. Truy cập LAN-only, phân quyền SA/Admin/Member, mọi hành động đều để lại dấu vết.

## 2. Bối cảnh & quy mô

- Team IT 5 người, 3 site, ~300+ thiết bị mạng dùng IP static (switch Cisco C1300/C2960, Draytek, AP Meraki, máy in, UPS, camera, NAS, máy chấm công, server), 25+ đường truyền ISP.
- Hiện trạng: quản lý thủ công Excel + giấy; hợp đồng giấy thất lạc; license hết hạn không ai hay; không truy được IP cấp cho ai; key không biết đã nhập máy nào.
- Tuân thủ ISO với bộ phiếu SP-IT02xx (tái tạo y hệt, in ra ký tay).
- Vai trò: **SA** toàn quyền (2 account — dual control) · **Admin** (gồm sếp) xem secret · **Member** cập nhật, không xem secret (trừ whitelist/break-glass).
- Ngoài scope: quản lý tài khoản email, PC/laptop nhân viên (hệ thống khác), booking, phiếu 0201/0211/0212, ký điện tử.

## 3. Nhóm tính năng & FR

### F1 — Kho thiết bị

- **FR-001** Tạo/sửa/khóa hồ sơ thiết bị: tên, loại (switch, AP, printer, UPS, camera, NAS, chấm công, server, Draytek…), model, serial, vị trí 2 cấp **site → tủ mạng**, **người/bộ phận sử dụng**, NCC, ngày mua, bảo hành start/end (hệ thống tự tính còn/hết), ghi chú.
- **FR-002** Đính kèm nhiều file per thiết bị (scan giấy tờ mua, hợp đồng…).
- **FR-003** Import thiết bị từ Excel: template chuẩn + validate + xem trước lỗi trước khi ghi; export xlsx.
- **FR-004** Danh mục (loại thiết bị, site, tủ) do Admin quản trị.
- **FR-005** Trang chi tiết thiết bị hiển thị mọi thứ liên quan: IP đang giữ, secret (theo quyền), license đã gán, phiếu/sự cố lịch sử, file đính kèm.
- **FR-006** Port map dạng bảng trên trang thiết bị: port → cắm gì / nhãn / ai dùng.
- **FR-007** Lịch sử thay đổi từng hồ sơ (ai sửa gì, khi nào).

### F2 — Phần mềm & License

- **FR-008** Hồ sơ phần mềm theo loại: license phần mềm · SSL cert · tên miền · hợp đồng ISP · hợp đồng bảo trì — tất cả có start/end đổ vào cỗ máy expiry.
- **FR-009** Bảng gán license ↔ thiết bị với số seat: hiển thị "key này đang nhập máy nào", cảnh báo khi gán vượt seat **và khi cùng một key bị gán trùng nhiều máy ngoài số seat cho phép**.
- **FR-010** Hồ sơ ISP: nhà mạng, băng thông, IP WAN static, thiết bị Draytek gắn kèm, hotline, file scan hợp đồng.
- **FR-011** Màn danh sách mỗi loại có filter + cột tình trạng hạn (còn X ngày / đã hết).
- **FR-036** License key và valid key lưu trong **vault** (két sắt) như secret: SA/Admin xem trực tiếp (kèm TOTP theo FR-022), Member truy cập theo mô hình 3 tầng của FR-023.

### F3 — Cỗ máy Expiry

- **FR-012** Mọi bản ghi có start/end (bảo hành, license, SSL, domain, hợp đồng ISP/bảo trì) tự động vào lịch theo dõi hạn.
- **FR-013** Báo cáo email **tổng hợp** các mục sắp hết hạn theo **luật cấu hình** (loại đối tượng + cửa sổ ngày + người nhận + tần suất); mỗi dòng = thông tin + start + end. Ví dụ luật: "device hết hạn trong 30 ngày tới → mail sếp, tuần 1 lần". Không gửi mail lẻ từng món.
- **FR-014** Màn Expiry tổng hợp: lọc theo loại/trạng thái; thao tác "đã gia hạn" nhập end mới, giữ lịch sử các lần gia hạn.

### F4 — Quản lý IP

- **FR-015** Khai báo subnet/VLAN (`172.16.x.0/24`): tên, site, mô tả — khung để mọi IP treo vào. v1 chỉ quản **IP static** (DHCP tồn tại nhưng chưa quản).
- **FR-016** Hồ sơ IP: địa chỉ, subnet, thiết bị giữ, người/bộ phận dùng, ai cấp, ngày cấp, trạng thái *(trống / đang cấp / nghi chết / đã thu hồi — v1 đặt tay)*, ghi chú.
- **FR-017** Member xem danh sách IP tổng theo subnet (đang dùng + trống, có trạng thái); cần thì tạo thêm bản ghi IP; hệ thống chặn cấp trùng tuyệt đối.
- **FR-018** Thu hồi: member xác nhận → IP về pool dùng lại được; **lịch sử giữ vĩnh viễn** (không có xóa trắng — thao tác xóa cũng để lại log).
- **FR-019** Sổ NAT Draytek: rule = thiết bị Draytek + port ngoài → IP trong : port trong + ai dùng + lý do mở.
- **FR-020** View mức dùng subnet: % đã cấp, còn bao nhiêu IP trống.

### F5 — Vault & Break-glass

- **FR-021** Lưu secret (mật khẩu thiết bị + license key) mã hóa từng bản ghi, gắn vào thiết bị/phần mềm; một thiết bị có thể nhiều secret (admin web, SSH, SNMP…).
- **FR-022** Xem secret (SA/Admin): bấm xem → gõ TOTP (grace 10 phút, xem được nhiều secret) → hiện; **mã 2 lớp lúc đăng nhập không mở két** — lần xem secret đầu tiên sau đăng nhập cũng hỏi mã (Q-23, 03/10/2026; két và sơ đồ mỗi bên mã riêng, ân hạn riêng); UI tự ẩn sau **30 giây (cấu hình được)** `[ASSUMPTION]`; **hết hiệu lực → bấm xem lại phải gõ TOTP lại**; mỗi lần xem = một dòng audit.
- **FR-023** Truy cập secret của Member — mô hình 3 tầng theo *member × nhóm đối tượng* (nhóm thiết bị **hoặc nhóm phần mềm/license** — phủ mọi secret trong vault):
  - ⚪ **Whitelist**: xem thẳng không cần duyệt — vẫn TOTP + audit + giới hạn thời gian xem.
  - 🟡 **Cần duyệt**: chọn thiết bị → nhập lý do + chọn thời hạn (trần cấu hình, mặc định 24h `[ASSUMPTION]`) → email đến Admin/SA → duyệt → xem trong thời hạn, hết giờ tự đóng.
  - ⛔ **Ngoài danh sách**: không xin được.
- **FR-024** SA/Admin quản trị whitelist + danh sách cần duyệt (bảng phẳng member × nhóm đối tượng theo site/nhóm — gồm cả nhóm thiết bị lẫn nhóm phần mềm).
- **FR-025** Nhật ký break-glass đầy đủ: ai xin, lý do, ai duyệt, xem lúc nào — đổ vào dashboard.
- **FR-026** Không tồn tại chức năng xuất toàn bộ secret, ở mọi quyền.

### F6 — Dashboard

- **FR-027** Trang chủ theo vai; với Admin/sếp: ① sắp hết hạn ② sự cố tuần qua ③ break-glass tuần qua (ai, thiết bị, lý do) — 3 phút đọc xong.
- **FR-028** Tự xuất danh sách (xlsx) từ mọi bảng đang xem, không cần nhờ ai.

### F7 — Phiếu ISO & Sự cố

- **FR-029** Form phiếu số tái tạo **y hệt** phiếu ISO. Nhóm A định kỳ (0203, 0204, 0205, 0208, 0213) sinh kỳ theo chu kỳ (ngày/tháng/đợt), grid tick từng ngày, field tự điền từ dữ liệu hệ thống (tên job backup, tên server…).
- **FR-030** Nhóm B sự kiện (0206 sự cố, 0207 RCA, 0209 file server access, 0210 remote access, 0214 sửa chữa): tạo phiếu khi có việc; form 0206 động theo Type (Backup → section backup; Network → thiết bị liên quan, link vào Device).
- **FR-031** Xuất bản in đúng layout ISO để **ký tay**; phiếu đã chốt kỳ thì khóa; lưu trữ theo năm.
- **FR-032** Sự cố liên kết thiết bị: trang thiết bị hiện lịch sử sự cố + cách đã sửa; sự cố nặng nâng cấp thành RCA 0207 cùng mã.
- **FR-033** Luồng Reported By → Reviewed & Approved chạy qua approval flow (trạng thái trên hệ thống; chữ ký mực thật trên bản in).

### F8 — Documents

- **FR-034** Sidebar Documents: runbook xử lý sự cố, WI-IT, quy định — link 2 chiều tới thiết bị/phần mềm liên quan.
- **FR-035** Nguyên tắc cứng: Documents **không bao giờ chứa secret** — hệ thống cảnh báo khi phát hiện chuỗi giống mật khẩu (mức nhắc nhở, không chặn cứng `[ASSUMPTION]`).

### F9 — Sơ đồ mạng (thay Visio) — Epic 10, `docs/QUYET-DINH.md` Q-23

Sơ đồ = **lớp nhìn của dữ liệu kho** (thiết bị, sơ đồ cổng, dải IP, két) **+ lớp vẽ tự do**. Trình vẽ là **draw.io (diagrams.net) tự host**, nhúng vào IMS qua iframe (chế độ embed, giao thức postMessage JSON), ghim cứng một phiên bản, chạy hoàn toàn trong mạng nội bộ. Lý do chọn (chủ dự án chốt 02/10/2026 sau khi xem mẫu khung vẽ tự viết): sơ đồ mạng thật cần đi dây tự do (góc vuông, điểm uốn, bó dây) và thư viện hình Cisco/network/rack; chủ dự án đã quen draw.io. IMS bọc ngoài trình vẽ: cây bản vẽ, mã 2 lớp, phiên bản và duyệt, nhật ký, gắn dữ liệu kho, cảnh báo lệch kho. Vẽ mới, không nhập file Visio cũ.

- **FR-037** Cây bản vẽ Tổng công ty → site chính → site phụ → tầng → phòng → tủ rack (tầng/phòng chỉ là tên bản vẽ, không thêm danh mục vị trí). Một bản vẽ = một trang draw.io. **Sửa** trong draw.io nhúng (chỉ desktop); **xem** bằng trình xem của IMS dựng từ ảnh SVG đã làm sạch (không chạy trình vẽ). Bố cục màn sơ đồ (Q-23, góp ý bản thử 03/10/2026): vào màn thì sidebar tự thu còn biểu tượng; trình vẽ/trình xem chiếm toàn bộ phần còn lại; tab **Sửa / Xem** và các nút của IMS nằm trên **một thanh mảnh phía trên** trình vẽ — không có cột panel cố định. Nút **"Thiết bị kho"** trên thanh đó mở một **hộp tìm gọn** (popover) để chèn hình thiết bị gắn hồ sơ kho (thuộc tính ô `ims_device_id`), hình theo **loại thiết bị** (hình có sẵn của draw.io hoặc SVG riêng đã lọc, quản ở Danh mục loại thiết bị). Bấm thiết bị ở chế độ xem mở thẻ thông tin lấy từ kho (IP, model, serial, site/tủ/U, NCC + hotline, bảo hành, "có mặt trong bản vẽ nào"), nút **Mở két** (vẫn mã 2 lớp của két) — không gõ lại dữ liệu.
- **FR-038** Dây: **"vẽ là khai, có hỏi"** (Q-23, 03/10/2026). Sơ đồ cổng là nguồn duy nhất; dây gắn một dòng sơ đồ cổng qua thuộc tính `ims_link_id`, nhãn cổng hai đầu do IMS sinh. Kéo nét dây nối hai thiết bị kho → IMS hỏi **"Khai kết nối này vào sơ đồ cổng?"** (chọn cổng còn trống hai đầu + loại dây): **"Khai"** ghi ngay vào sơ đồ cổng qua endpoint của `devices` như ở trang thiết bị (luật một cổng một cáp — Q-20; cổng đã chiếm → báo lỗi trong hộp, không ghi) rồi gắn link vào nét; **"Chỉ vẽ"** giữ nét đồ hoạ kèm cảnh báo vàng "chưa khai". Xoá nét đã gắn link thì hỏi **"Chỉ xoá nét vẽ"** (mặc định, kết nối giữ nguyên) / **"Gỡ luôn kết nối"**. Chiều ngược lại, mỗi lần mở bản vẽ: đổi cổng / loại dây hiện ngay (nhãn, màu nạp lúc mở); kết nối đã bị gỡ khỏi sơ đồ cổng → nét chuyển đỏ; kết nối mới giữa hai máy đã có trên bản vẽ → "Có N kết nối mới chưa vẽ" + nút **"Vẽ vào"**. Nút "Khai kết nối" (hộp sơ đồ cổng dùng chung, kể cả nối hàng loạt N máy vào switch theo thứ tự cổng) vẫn giữ. Lưu hay phát hành bản vẽ **không** ghi gì vào sơ đồ cổng — chỉ thao tác người dùng xác nhận trong hộp mới ghi. Màu dây theo **loại dây** (Cat6, Fiber, DAC; SA thêm được) với chú giải tự sinh, người vẽ không tự chọn màu. Bấm thiết bị: tô sáng mọi dây + đầu kia; dây đi ra ngoài bản vẽ hiện "tới Core-01 (bản vẽ Phòng server)", bấm nhảy sang.
- **FR-039** Lớp vẽ tự do dùng sẵn của draw.io (khung tòa nhà/tầng/phòng, đám mây ISP, chữ, mũi tên, đường nối site). Khung VLAN gắn dải IP (bấm thấy dải, IP trống). Khung gắn **bản vẽ con** (bấm để xuống, thanh đường dẫn để lên). Chèn **tủ** từ danh mục tủ: dựng khung tủ bằng thư viện rack của draw.io, máy xếp theo U từ kho.
- **FR-040** Phiên bản: mỗi lần lưu là một phiên bản **chỉ-thêm** (XML + SVG + chỉ mục ô + ảnh chụp dữ liệu thiết bị lúc đó), hai người cùng sửa thì bản lưu sau thắng và có báo "Đang có Nguyễn A mở sửa"; lịch sử tóm tắt một dòng tính bằng so các ô ("Thêm 3 thiết bị, bỏ 1, đổi 37 dây"); đặt tên phiên bản; khôi phục bản trước (tạo phiên bản mới, không xoá lịch sử); so sánh hai phiên bản tô màu; thanh trượt thời gian về bản chính thức hiệu lực ngày X.
- **FR-041** Bản chính thức qua duyệt: Thành viên gửi duyệt (bắt ghi lý do), Admin/SA duyệt hoặc trả về; Admin/SA lưu là bản nháp, bấm **Phát hành** mới thành chính thức. Gửi/phát hành thì **tự kiểm**: lỗi đỏ chặn, cảnh báo vàng cho qua. Không bắt Admin bấm qua từng thay đổi — có tóm tắt + nút xem so sánh. Trả về kèm **bình luận ghim** trên hình/dây (IMS lưu; draw.io tự host không có bình luận), trả lời thành luồng.
- **FR-042** Mọi lần xem **nội dung** bản vẽ (chính thức, nháp, phiên bản cũ, trình bày) phải nhập mã 2 lớp **phạm vi sơ đồ**; nhập một lần xem tiếp trong ân hạn riêng (mặc định 10 phút), tách hẳn phạm vi két — nhập ở đâu tính ở đó, mã lúc đăng nhập không mở phạm vi nào. Xem cây bản vẽ (tên, trạng thái) không cần mã. Mỗi lần mở và mỗi lần xuất ghi nhật ký. Watermark tên người xem + giờ phủ trên màn hình (cả trình vẽ lẫn trình xem) và trên file xuất — răn đe, không chống được cắt ảnh.
- **FR-043** Cảnh báo lệch kho, **không ép sửa**: máy thanh lý / đổi IP / đổi site-tủ-U / dây gắn dòng sơ đồ cổng đã đổi hoặc biến mất / kết nối trong sơ đồ cổng giữa hai máy trên bản vẽ mà chưa vẽ → dấu "Có N thay đổi chưa vẽ" + nút "Kiểm tra khớp dữ liệu"; email người phụ trách khi số lệch tăng.
- **FR-044** Xuất PNG/PDF có chân trang (tên, đường dẫn cây, phiên bản, trạng thái, ngày duyệt, người vẽ, người duyệt) + chú giải màu dây + watermark người xuất — chân trang và watermark do **server** ghép, không lấy từ dữ liệu client tự có; bản nháp có dải "BẢN NHÁP — chưa duyệt". Nộp hồ sơ ISO được.
- **FR-045** **Bản trình bày** tách rời bản chính thức: nhân bản từ một phiên bản chính thức, không duyệt, thêm thiết bị dự kiến (viền đứt, giá, NCC) + ảnh tự do, file xuất có dải "BẢN TRÌNH BÀY — không phải sơ đồ chính thức", ghi rõ dựa trên phiên bản nào và báo khi bản gốc có phiên bản mới.
- **FR-046** Điều hướng ở chế độ xem: tìm thiết bị và bay tới (không có trong bản vẽ thì liệt kê bản vẽ khác chứa nó), bật/tắt lớp (lớp draw.io), chỉ đường giữa hai thiết bị trên đồ thị sơ đồ cổng, trình chiếu từ tổng xuống chi tiết, **điện thoại chỉ xem** (phóng hai ngón).
- **FR-047** Ảnh thật + vị trí U: thiết bị thêm **U bắt đầu + số U** (chặn chồng U trong cùng tủ, chặn vượt chiều cao tủ); ảnh thật theo model (loại thiết bị + chuỗi model) hoặc theo từng máy (chọn từ giấy tờ đính kèm), mặt trước/mặt sau; công tắc Biểu tượng / Ảnh thật trên từng hình; mặt tủ theo U.
- **FR-048** Dựng nháp từ sơ đồ cổng: chọn site/tủ/danh sách máy → IMS sinh bản nháp có thiết bị + dây đã gắn dữ liệu, người vẽ dùng **bố cục và kiểu dây góc vuông có sẵn của draw.io** (Arrange → Layout) để xếp gọn. Không viết thuật toán bố cục riêng.
- **FR-049** *(chỉ thiết kế, không làm trong Epic 10)* API nhận trạng thái thiết bị từ máy giám sát ngoài (khoá API riêng, chỉ ghi trạng thái) + lớp "trạng thái sống" bật/tắt ở trình xem. Epic 10 chỉ để lại tài liệu hợp đồng và chỗ trống trong mô hình lớp của trình xem; không có route, không có giao diện.

## 4. NFR

- **NFR-01 Đăng nhập:** Argon2id + pepper; **rate-limit đăng nhập theo IP**; lockout sai 5 lần → khóa 15 phút tự mở + email báo SA, **khóa đặt lên cặp (tài khoản, IP) chứ không lên tài khoản** (sửa 11/09/2026 — xem addendum §4); mọi user đều enroll TOTP (Google Authenticator) khi kích hoạt account; việc **bắt buộc TOTP lúc đăng nhập** do SA/Admin bật/tắt per member; riêng step-up TOTP khi xem secret (FR-022/023) áp dụng mọi user, không có ngoại lệ; session server-side, idle 30 phút / tuyệt đối 12 giờ; **SA đá được phiên bất kỳ ai đang online**; **đăng nhập từ thiết bị mới → dòng audit + email báo chính chủ**; CSRF token + **kiểm tra header Origin**; regenerate session sau login; revoke mọi phiên khi đổi mật khẩu/đổi MFA; 2 account SA; SA tạo/reset account thủ công, không tự đăng ký.
- **NFR-02 Vault:** AES-256-GCM envelope per-record (master key → data-key), AAD = record_id + key_version + table, master key = randomBytes(32) trong docker secret (không env, không DB, không backup chung, không git); TOTP secret trong DB cũng mã hóa bằng envelope; chống TOTP replay (lưu last-used timestep); giải mã on-demand từng bản ghi; chìa giấy 2 phong bì 2 người giữ; restore drill định kỳ có biên bản.
- **NFR-03 Audit:** bảng audit append-only (REVOKE UPDATE/DELETE tầng DB), giữ vĩnh viễn; mọi login (thành công/thất bại kèm IP), mọi giải mã, mọi thay đổi dữ liệu; phase sau ship syslog sang Wazuh.
- **NFR-04 Triển khai:** LAN-only qua HTTPS 443, không NAT internet; TLS wildcard *.pmh.com.vn (rủi ro chấp nhận có chủ đích); docker 5 service (pg/redis/api/worker/web) — trình vẽ draw.io của Epic 10 là **tệp tĩnh phát từ nginx của `web`**, không thêm service (NFR-07; container `drawio` chỉ là tạm của bản thử); app thiết kế zero-trust không dựa vào bảo mật mạng; helmet, Cache-Control no-store cho response chứa secret, UI tự ẩn secret theo FR-022.
- **NFR-05 Hiệu năng & vận hành:** 300+ thiết bị / 5 user đồng thời; màn danh sách < 2 giây; không yêu cầu HA; backup DB hằng ngày lưu tách khỏi server app; nghỉ việc → khóa account không xóa, phiên chết ngay.
- **NFR-06 Ngôn ngữ:** UI tiếng Việt; bản in phiếu theo đúng song ngữ của mẫu ISO gốc (vi/zh với 0204/0214, vi/en theo mẫu).
- **NFR-07 Sơ đồ mạng (draw.io):** trình vẽ chạy **offline hoàn toàn** — tệp tĩnh của draw.io chép từ image `jgraph/drawio` (đúng tag + digest đã ghim) vào image `web` lúc build, nginx của `web` phát tại `/drawio/`, không Tomcat, không service riêng (Q-23, 03/10/2026; bản thử dùng tạm container `drawio`); không ra Internet, không CDN, không plugin, không tích hợp đám mây (Google Drive/OneDrive); **ghim cứng phiên bản** (tag + digest), rà nâng cấp 1–2 lần/năm hoặc khi có cảnh báo bảo mật, mỗi lần nâng cấp chạy lại E2E sơ đồ, quy trình trong RUNBOOK; mã 2 lớp **có phạm vi** (két | sơ đồ) với ân hạn riêng; nhật ký mỗi lần mở và xuất; XML bản vẽ là **nội dung người dùng không tin cậy** — server kiểm cỡ (trần trong `system_config`), parse an toàn (tắt DTD/thực thể ngoài), từ chối thứ thù địch (script, thuộc tính `on*`, `javascript:`, tham chiếu ra ngoài), ảnh SVG làm sạch trước khi lưu và trước khi hiện; iframe trình vẽ chạy sandbox, kiểm nguồn postMessage cả hai chiều; bản vẽ 300 hình + 600 dây mở xong < 3 giây.

## 5. User Journeys

- **UJ-1 — Member trực sự cố site 2.** 2h chiều, tầng 3 site 2 mất mạng, member mới vào 2 tháng một mình xuống site. Trên đường: mở hệ thống, tra tủ mạng site 2 → xác định switch tầng 3 theo vị trí site→tủ, mở port map bảng xem cổng nào cắm gì. Tại chỗ: thiết bị nằm trong whitelist → gõ TOTP xem mật khẩu switch ngay (hoặc thiết bị "cần duyệt" → gửi yêu cầu, Admin duyệt qua email); xử lý xong tạo phiếu 0206 chọn Type=Network, link thiết bị, ghi cách sửa — lần sau ai gặp lỗi này mở hồ sơ thiết bị là thấy.
- **UJ-2 — Sếp sáng thứ Hai.** 3 phút trước họp: mở dashboard — thấy 2 license hết hạn trong 30 ngày (đã có mail tổng hợp tuần trước), 1 sự cố tuần qua đã Resolved, 3 lượt break-glass kèm lý do. Cần số liệu cho cấp trên → bấm export xlsx tại chỗ.

## 6. Success Metrics

- Tra cứu bất kỳ thông tin hạ tầng (thiết bị, IP, hạn license, hotline ISP): **< 30 giây**.
- **100%** secret thiết bị nằm trong vault sau 3 tháng vận hành — không còn file Excel chứa mật khẩu.
- **0** license/SSL/hợp đồng hết hạn "bất ngờ" — mọi mục hết hạn đều đã xuất hiện trong báo cáo tổng hợp trước đó.
- Phiếu ISO nhóm A nộp đúng kỳ; xuất trọn bộ phiếu một năm cho auditor **< 15 phút**.
- **Counter-metrics:** thời gian duyệt break-glass trung vị **< 15 phút** (bảo mật không làm chậm dập lửa); thay đổi thiết bị thực tế được cập nhật vào hệ thống trong vòng 1 tuần (dữ liệu không thối).

## 7. Phase sau (ngoài scope v1 — chờ Wazuh xong)

Giám sát sống cho sơ đồ mạng: ping/ARP scan, SNMP, LLDP/CDP tự dò kết nối — cắm vào **API trạng thái sống đã chừa sẵn** ở FR-049 (khoá API riêng, lớp "trạng thái sống" trên trình xem), không đổi kiến trúc sơ đồ · Meraki API · Wazuh connector (badge alert, đối chiếu 2 chiều sổ ↔ log).

*(Sơ đồ mạng data-bound đã rời mục này: nay là F9 / Epic 10, làm trước Epic 8–9 — Q-23.)*

**Backlog chưa xếp lịch:** kỳ hạn nộp phiếu tự nhắc ("0208 tháng này ai chưa làm"), NCC/ISP entity riêng, file config thiết bị theo version, MAC address, field firmware link 0213, criticality thiết bị, tìm kiếm toàn cục, mobile responsive toàn diện.

## 8. Open items

- `[ASSUMPTION]` Trần thời hạn break-glass mặc định 24h (cấu hình được).
- `[ASSUMPTION]` FR-035 cảnh báo secret trong Documents ở mức nhắc nhở, không chặn cứng.
- `[NOTE FOR PM]` Cert wildcard cần xác nhận cover hostname nội bộ dự kiến (vd `ims.pmh.com.vn`).
- `[OPEN]` Chính sách "xóa hẳn" bản ghi nhập nhầm (khác thu hồi): đề xuất chỉ Admin/SA thao tác và hành động xóa vẫn để lại dòng audit — chưa chốt chính thức.
- `[ĐÃ TRẢ LỜI]` draw.io chạy embed trong iframe sandbox **không** có `allow-same-origin` (origin mờ): bản thử 02/10/2026 chạy được (chèn, lưu, mở lại), cần thêm `Access-Control-Allow-Origin: *` trên tệp tĩnh `/drawio/`. Cờ sandbox thêm mà bản thử đang bật (`allow-downloads`, `allow-modals`) Story 10.2 phải chứng minh cần hay bỏ (ARCHITECTURE-SPINE AD-17).
