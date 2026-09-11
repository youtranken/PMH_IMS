---
title: PRD — IMS (Hệ thống quản lý IT nội bộ PMH)
status: final
created: 2026-08-19
updated: 2026-08-21
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
- **FR-022** Xem secret (SA/Admin): bấm xem → gõ TOTP (grace 10 phút, xem được nhiều secret) → hiện; UI tự ẩn sau **30 giây (cấu hình được)** `[ASSUMPTION]`; **hết hiệu lực → bấm xem lại phải gõ TOTP lại**; mỗi lần xem = một dòng audit.
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

## 4. NFR

- **NFR-01 Đăng nhập:** Argon2id + pepper; **rate-limit đăng nhập theo IP**; lockout sai 5 lần → khóa 15 phút tự mở + email báo SA, **khóa đặt lên cặp (tài khoản, IP) chứ không lên tài khoản** (sửa 11/09/2026 — xem addendum §4); mọi user đều enroll TOTP (Google Authenticator) khi kích hoạt account; việc **bắt buộc TOTP lúc đăng nhập** do SA/Admin bật/tắt per member; riêng step-up TOTP khi xem secret (FR-022/023) áp dụng mọi user, không có ngoại lệ; session server-side, idle 30 phút / tuyệt đối 12 giờ; **SA đá được phiên bất kỳ ai đang online**; **đăng nhập từ thiết bị mới → dòng audit + email báo chính chủ**; CSRF token + **kiểm tra header Origin**; regenerate session sau login; revoke mọi phiên khi đổi mật khẩu/đổi MFA; 2 account SA; SA tạo/reset account thủ công, không tự đăng ký.
- **NFR-02 Vault:** AES-256-GCM envelope per-record (master key → data-key), AAD = record_id + key_version + table, master key = randomBytes(32) trong docker secret (không env, không DB, không backup chung, không git); TOTP secret trong DB cũng mã hóa bằng envelope; chống TOTP replay (lưu last-used timestep); giải mã on-demand từng bản ghi; chìa giấy 2 phong bì 2 người giữ; restore drill định kỳ có biên bản.
- **NFR-03 Audit:** bảng audit append-only (REVOKE UPDATE/DELETE tầng DB), giữ vĩnh viễn; mọi login (thành công/thất bại kèm IP), mọi giải mã, mọi thay đổi dữ liệu; phase sau ship syslog sang Wazuh.
- **NFR-04 Triển khai:** LAN-only qua HTTPS 443, không NAT internet; TLS wildcard *.pmh.com.vn (rủi ro chấp nhận có chủ đích); docker 5 service (pg/redis/api/worker/web); app thiết kế zero-trust không dựa vào bảo mật mạng; helmet, Cache-Control no-store cho response chứa secret, UI tự ẩn secret theo FR-022.
- **NFR-05 Hiệu năng & vận hành:** 300+ thiết bị / 5 user đồng thời; màn danh sách < 2 giây; không yêu cầu HA; backup DB hằng ngày lưu tách khỏi server app; nghỉ việc → khóa account không xóa, phiên chết ngay.
- **NFR-06 Ngôn ngữ:** UI tiếng Việt; bản in phiếu theo đúng song ngữ của mẫu ISO gốc (vi/zh với 0204/0214, vi/en theo mẫu).

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

Sơ đồ mạng data-bound (React Flow, vẽ dây = nhập port map, phân theo site, xuất VI/EN) · ping/ARP scan + trạng thái sống tự động · SNMP · Meraki API · Wazuh connector (badge alert, đối chiếu 2 chiều sổ ↔ log) · render port lên canvas.

**Backlog chưa xếp lịch:** kỳ hạn nộp phiếu tự nhắc ("0208 tháng này ai chưa làm"), NCC/ISP entity riêng, file config thiết bị theo version, MAC address, field firmware link 0213, criticality thiết bị, tìm kiếm toàn cục, mobile responsive toàn diện.

## 8. Open items

- `[ASSUMPTION]` Trần thời hạn break-glass mặc định 24h (cấu hình được).
- `[ASSUMPTION]` FR-035 cảnh báo secret trong Documents ở mức nhắc nhở, không chặn cứng.
- `[NOTE FOR PM]` Cert wildcard cần xác nhận cover hostname nội bộ dự kiến (vd `ims.pmh.com.vn`).
- `[OPEN]` Chính sách "xóa hẳn" bản ghi nhập nhầm (khác thu hồi): đề xuất chỉ Admin/SA thao tác và hành động xóa vẫn để lại dòng audit — chưa chốt chính thức.
