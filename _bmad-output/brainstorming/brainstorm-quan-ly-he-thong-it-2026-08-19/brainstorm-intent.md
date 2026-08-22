---
title: Brainstorm Intent — IMS (Hệ thống quản lý IT nội bộ PMH)
date: 2026-08-19
source: F:\PMH\IT_IMS\_bmad-output\brainstorming\brainstorm-quan-ly-he-thong-it-2026-08-19\.memlog.md
status: approved-moscow
updated: 2026-08-19 (bản cuối — sau rà soát domain + bản đồ tái dùng QLTS)
---

# Brainstorm Intent — IMS

## 1. Bối cảnh & mục tiêu

Hệ thống quản lý IT nội bộ cho PMH: thiết bị, IP, license, credential, vị trí, VPN, phiếu theo dõi định kỳ.

3 mục đích:
1. Tri thức không mất khi người rời đi.
2. Bằng chứng phục vụ audit.
3. Chấm dứt mò Excel/giấy/Zalo.

Quy mô: 300+ thiết bị (switch, máy in, wifi, UPS, camera, NAS, máy chấm công, server, Draytek...), 3 site, team IT 5 người. Hiện trạng: quản lý thủ công bằng Excel + giấy; 25+ đường truyền ISP, hợp đồng giấy thường bị lạc mất.

## 2. Nền tảng kỹ thuật

Tái dùng xương sống dự án QLTS: NestJS + React + Postgres, audit log, RBAC, approval/ticket flow, outbox mail, import/export xlsx. Chi tiết lấy gì/bỏ gì: xem mục "Tái sử dụng source QLTS".
**BỎ toàn bộ module đặt máy/booking** (Booking UI, BookingController...) — hệ này không có khái niệm booking.
**KHÔNG dùng IdP/OIDC như QLTS** (QLTS dùng openid-client/jose/oidc-provider) — IMS **TỰ XÂY quản lý account** với thư viện bảo mật (chi tiết ở mục "Auth & Két sắt").

## 3. Mô hình dữ liệu cốt lõi

Toàn hệ quy về **2 entity lớn**:
- **Thiết bị (Device)**: mọi thứ có IP + username/password (switch, AP, printer, UPS, camera, NAS, máy chấm công, server, Draytek...). Server + dịch vụ chạy ngầm = Device + Phần mềm, không cần entity riêng.
- **Phần mềm/License (Software)**: license, SSL cert, tên miền (pmh.com.vn tại PA), hợp đồng ISP... — mọi thứ có gia hạn.

Cộng **4 cơ chế ngang** áp lên cả hai:
1. **Cỗ máy expiry chung**: mọi thứ có start/end (bảo hành, license, SSL, domain, hợp đồng) → tự tính còn/hết hạn; cảnh báo chủ động đẩy ra ngoài (email/notify leo thang 30-14-7 ngày + digest tuần cho sếp), không chỉ nằm chờ trên dashboard.
2. **File đính kèm**: scan hợp đồng, giấy tờ mua, hồ sơ NCC gắn theo thiết bị/phần mềm.
3. **Gắn người sử dụng**: ai đang dùng thiết bị/IP/NAT rule.
4. **Audit log mọi hành động**.

Entity phụ lộ ra từ persona sếp: **Sự cố (Incident)** — số hóa từ phiếu SP-IT0206.

## 4. RBAC & Break-glass

- **SA**: toàn quyền.
- **Admin** (gồm sếp): xem được credential.
- **Member**: cập nhật dữ liệu nhưng KHÔNG xem credential.
- **Break-glass "đập tủ kính"**: member xin pass khẩn 1 thiết bị + lý do → Admin/SA duyệt qua notify → thấy pass trong thời gian giới hạn. Ràng buộc:
  - Allowlist định nghĩa trước theo **nhóm/site** (không theo từng thiết bị lẻ), vd "Member site 2 = mọi switch/AP site 2, trừ firewall core".
  - Member phải **chọn thời gian hiệu lực** khi xin.
  - Member mở thẳng danh sách thiết bị trong allowlist của mình để xin — KHÔNG đi qua runbook.
  - Tất cả vào audit log; dashboard sếp tổng hợp ai đập tủ kính trong tuần + lý do.
- Nguyên tắc an ninh: **Documents/runbook TUYỆT ĐỐI không chứa credential** — pass chỉ sống trong vault.

## 5. Auth & Két sắt (đã thẩm định chuyên gia)

Toàn bộ quyết định dưới đây ĐÃ CHỐT sau phiên đào sâu batch 3 + thẩm định chuyên gia bảo mật (đối chiếu Passbolt/NetBox/Bitwarden).

**Triển khai:** LAN-only, không NAT ra internet, chỉ mở 443; firewall vật lý user tự lo. App vẫn thiết kế **zero-trust** — bảo mật app không dựa vào bảo mật mạng.

**Tường 1 — Đăng nhập:**
- Argon2id + **pepper HMAC** trước khi hash.
- Lockout **1 tầng**: sai 5 lần → khóa 15 phút tự mở + email báo SA. Rate-limit theo IP. Audit mọi login.
- SA tạo/reset account thủ công, **không tự đăng ký**. SMTP vẫn dùng gửi thông báo expiry (chỉ *quản lý* tài khoản email là ngoài scope).

**Tường 2 — MFA:**
- TOTP (Google Authenticator) cho toàn bộ user; SA/Admin có toggle **bắt buộc MFA per member**.
- Step-up: **MỌI user gõ TOTP khi xem pass**, grace 10 phút (gõ 1 lần xem được nhiều pass trong allowlist của mình).
- Chống TOTP replay (lưu last-used timestep). TOTP secret trong DB mã hóa bằng envelope như credential.

**Tường 3 — Session:**
- Server-side session + cookie httpOnly/Secure/SameSite (không JWT localStorage); idle 30 phút, absolute 12 giờ.
- SA có nút đá phiên; regenerate session ID sau login; **revoke mọi phiên khi đổi pass/đổi MFA**; CSRF token + Origin check; đăng nhập thiết bị mới → audit + email báo chính chủ.

**Tường 4 — Két sắt:**
- AES-256-GCM per-record + **envelope encryption** (master key mã hóa data-key từng bản ghi → xoay chìa không phải mã hóa lại cả két); AAD = record_id + key_version; key_version per-record từ v1.
- Master key = randomBytes(32), nằm trong **docker secret trên server app** — không nằm DB, không chung backup DB, không commit git.
- Giải mã **on-demand từng bản ghi**, KHÔNG có endpoint xuất toàn bộ pass; mỗi lần giải mã = 1 dòng audit.
- **Trần rủi ro chấp nhận có chủ đích**: server app bị chiếm = két lộ — E2E kiểu Bitwarden mâu thuẫn yêu cầu break-glass/Admin xem.

**Tường 5 — Vòng đời account:**
- Pass tạm buộc đổi lần đầu + enroll TOTP ngay.
- Nghỉ việc → **KHÓA không xóa** (giữ audit), khóa = mọi phiên chết ngay.
- **2 account SA** (dual control); chìa giấy chia **2 phong bì 2 người giữ**; **restore drill định kỳ có biên bản**.

**Vận hành bảo mật:**
- Audit table **append-only** (REVOKE UPDATE/DELETE) + ship syslog sang Wazuh.
- helmet + Cache-Control no-store cho response chứa pass + UI ẩn pass sau N giây.
- Nhắc đổi pass thiết bị sau break-glass và khi nhân sự nghỉ.

**TLS:** dùng wildcard *.pmh.com.vn đã mua — GIỮ dù chuyên gia cảnh báo blast-radius; rủi ro tồn dư chấp nhận có chủ đích vì VM không ra internet, firewall chặt.

**Thư viện đề xuất:** @node-rs/argon2, otplib, express-session + connect-pg-simple (hoặc adapt bảng sessions sẵn có của QLTS), csrf-csrf, helmet, node:crypto AES-256-GCM.

## 6. Phạm vi MoSCoW (đã duyệt — bản cuối)

- **MUST**: Kho thiết bị; **Import Excel dữ liệu hiện có cho thiết bị** (tái dùng khung import/export xlsx của QLTS — thay quyết định cũ "user tự nhập tay 300 thiết bị"); License + seat; Expiry engine; Quản lý IP; Vault + break-glass; Dashboard sếp.
- **SHOULD**: Phiếu ISO số hóa; Sự cố (incident); Documents/runbook.
- **COULD (v1)**: — (trống; các mục cũ dời phase sau).
- **WON'T (v1)**: Wazuh connector (chỉ chừa cổng); ping scan; sơ đồ mạng.
- **Phase sau (sau khi Wazuh xong)**: sơ đồ mạng data-bound, ping/ARP scan, SNMP, Meraki API, Wazuh connector, badge alert trên sơ đồ.

## 7. Quyết định ràng buộc quan trọng

**Phiếu ISO:**
- Phiếu ISO là chuẩn cố định — hệ thống phải tái tạo **Y HỆT form**, không chế lại.
- Ký duyệt: **in ra ký tay** (yêu cầu ISO), KHÔNG ký điện tử — hệ thống điền sẵn dữ liệu + export bản in đúng layout ISO cho auditor.
- Phiếu số phải **tick được từng ngày** + điền trực tiếp trên form giống hệt phiếu giấy (grid tick theo ngày cho 0203/0208); field tự điền sẵn từ dữ liệu hệ thống (tên job, tên server).
- Phân nhóm phiếu A/B/C đã duyệt. Chỉ quan tâm phiếu liên quan HỆ THỐNG. Bộ SP-IT02 gồm 14 phiếu + 7 WI: 0203 checklist backup/storage (Veeam/NAS/Cloud theo job), 0204 kiểm tra hệ thống (vi/zh), 0205 kiểm tra định kỳ theo bộ phận (giữ CẢ 0204 và 0205), 0206 sự cố hằng ngày, 0207 RCA, 0208 antivirus Sophos theo tháng, 0209 file server access, 0210 remote access (= danh sách VPN), 0213 update firmware/system (số hóa tự tổ chức theo kỳ + thiết bị thay vì folder tháng), 0214 sửa chữa mạng & thiết bị.
- **LOẠI khỏi scope: 0201 (tạo account), 0211 (xin cấp thiết bị), 0212 (bàn giao PC)** — dính PC/nhân viên.
- Form sự cố 0206 động: chọn Type nào hiện section chi tiết type đó (Backup → fields backup; Network → thiết bị liên quan); Reported/Approved map vào approval flow sẵn có từ QLTS.
- BÁC ý tưởng ràng phiếu 0213/0214 với cập nhật sơ đồ — team nhỏ, không cưỡng chế quy trình.

**Quản lý IP:**
- Hạ tầng: VLAN riêng dạng **172.16.x.0/24**.
- **v1 chỉ theo dõi IP STATIC** — có DHCP tồn tại nhưng chưa quản.
- Hồ sơ IP: thiết bị giữ, VLAN/subnet, site, ai cấp, ngày cấp, trạng thái sống/chết.
- Vòng đời 4 trạng thái: trống → đang cấp → nghi chết → thu hồi về pool. **v1 chạy HOÀN TOÀN THỦ CÔNG, không phụ thuộc ping scan** — member tự xác định nghi chết và chốt; scan chỉ hỗ trợ ở phase sau. Máy không tự quyết, **người chốt**.
- Cấp IP: member **tự chọn từ danh sách IP trống** (không auto-gợi ý).
- **Không có xóa trắng**: "xóa" IP = IP dùng lại được, nhưng LOG luôn ghi lại — thực chất là thu hồi có audit; lịch sử giữ vĩnh viễn ("IP này từng là máy in kế toán").
- **Subnet/VLAN — ghi chú thiết kế nội bộ module IP**: subnet là cấu trúc dữ liệu để sinh danh sách IP trống theo dải 172.16.x.0/24 (không phải feature riêng).

**Sơ đồ mạng (dời PHASE SAU — sau khi Wazuh xong):**
- Rút khỏi v1. Khi làm: vẽ tay nhưng node **chọn từ kho thiết bị đã nhập** (data-bound), kéo thả không vỡ data; phân theo **site**, mỗi site nhiều loại sơ đồ độc lập; đổi màu node = ping + badge Wazuh; xuất song ngữ **VI/EN**; **vẽ dây = nhập liệu** (nối 2 node + nhãn port hai đầu → ghi luôn bản ghi đấu nối A↔B, sơ đồ và port map là MỘT dữ liệu).
- **Port map dạng bảng** trong trang thiết bị vẫn có từ v1 (rẻ, độc lập với canvas); render port trên canvas để phase sau nữa.

**Vị trí thiết bị:**
- **2 cấp: site → tủ mạng** (không sâu hơn rack U/patch panel).

**Break-glass — kênh duyệt:**
- **Duyệt qua email** (chưa cần kênh realtime).

**File đính kèm:**
- File scan hợp đồng ISP **upload as-is**, chấp nhận pass (PPPoE) in trên scan — rủi ro chấp nhận có chủ đích, không bắt che.

**License:**
- Key có **số seat**, bảng gán **license↔máy** theo dõi máy nào tiêu thụ; cảnh báo vượt seat/trùng key.

**Giám sát (toàn bộ dời phase sau — sau khi Wazuh xong):**
- Ping/ARP scan, SNMP, Meraki API, Wazuh connector: **không nằm trong v1**; kiến trúc chừa cổng sẵn.
- Nguyên tắc giữ nguyên khi làm: sổ thiết bị = nguồn sự thật về cái NÊN tồn tại; đối chiếu 2 chiều sổ↔thực tế; thiết bị trong sổ im re = cảnh báo "chưa trỏ syslog/đã chết".
- Switch PMH: **Cisco C1300 và C2960** — đều hỗ trợ SNMP + syslog + port-security (khả thi cho phase sau).

**Không cần (đã chốt):** QR label cho thiết bị; lịch bảo trì định kỳ (khi làm thì làm phiếu sau); kênh duyệt realtime.

**Ngoài scope:** email (đã có hệ thống riêng); PC/laptop nhân viên (hệ thống khác quản lý — nhưng cùng mô hình Device/Software, khả năng mở rộng sau); phiếu 0201/0211/0212; module booking.

**Khác:** dữ liệu 300 thiết bị ban đầu nạp qua **import Excel** (khung xlsx tái dùng từ QLTS). Runbook/Documents là sidebar riêng, link 2 chiều tới Device/Software.

## 8. Tái sử dụng source QLTS (bản đồ kiến trúc sư)

**Khởi động:** REPO TRẮNG → copy module (không fork-rồi-xóa). Migrations viết mới từ 0000. Cấu trúc thư mục dự án mới tổ chức **theo module**.

- **GIỮ NGUYÊN**: migration-runner (advisory lock + checksum); module audit (đã có sẵn migration append-only); outbox + queue BullMQ (nền cho expiry engine); config/SMTP; files; mail hạ tầng; bootstrap/worker; toàn bộ web/ui + web/lib; docker skeleton 5 service.
- **SỬA NHẸ**: RBAC roles.guard 3 vai (trùng khớp SA/Admin/Member); bảng sessions + CSRF sẵn có (adapt cho Tường 3); import/export xlsx (đổi cột); bảng software-seat sẵn có (đáp ứng license↔device + seat); trang EOL → Expiry; catalog/profile.
- **VIẾT LẠI MƯỢN PATTERN**: assets → Device/Software (chú ý cycle import); approval flow mới ~300 dòng (KHÔNG gỡ tickets-booking cũ — bện chặt, viết mới rẻ hơn).
- **BỎ**: booking/pool; toàn bộ OIDC (openid-client/jose); directory-sync; chatbot.
- **XÂY MỚI**: vault envelope (node:crypto, master key qua docker secret file); Argon2id + pepper + TOTP (otplib, chống replay); break-glass trên khung approval + outbox; IPAM (Postgres inet/cidr, allocation history append-only); form ISO in @media print + exceljs; incident entity. (Canvas React Flow → phase sau.)
- **Việc phải làm khi copy**: tách type AuthedRequest (god node) ra auth/types.ts thuần; viết lại SessionAuthService bỏ OIDC-refresh; grep quét `PMH_|oidc|booking` sau copy; crypto-secret.ts cũ chỉ dùng cho SMTP — vault viết riêng.

## 9. Ba "vụ toang" thật (bằng chứng động lực)

1. License/SSL/hợp đồng **hết hạn không ai hay** vì không ai theo dõi → expiry engine + cảnh báo là tính năng sống còn.
2. **Không biết license key đã nhập cho máy nào**, key bị dùng trùng nhiều máy → bảng gán license↔device với seat.
3. **Không truy được IP đã cấp cho ai** → hồ sơ IP gắn người + thiết bị + lịch sử.

## 10. Backlog để sau

Nhóm SHOULD bị park (từ rà soát domain — chưa làm bây giờ):
- Kỳ hạn nộp phiếu ISO (khóa kỳ + lưu năm).
- NCC/ISP entity riêng (hotline tra 30 giây).
- File config thiết bị theo version.
- MAC address.
- Field firmware + link phiếu 0213.
- Criticality thiết bị (nền cho allowlist + DR).
- Tìm kiếm toàn cục.
- Mobile responsive (duyệt break-glass trên phone).

Gap cũ còn lại:
- Chi tiết tích hợp Wazuh (mới test agent Windows + 2-3 thiết bị syslog ở dự án khác) — thiết kế cổng connector nhưng chưa có spec.
- Chính sách "xóa hẳn" bản ghi nhập nhầm: đề xuất cần quyền Admin/SA và hành động xóa vẫn vào audit log — chưa chốt chi tiết.
