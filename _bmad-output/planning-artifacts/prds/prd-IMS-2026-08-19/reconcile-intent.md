---
title: Đối chiếu Intent ↔ PRD — QLMgmtIP (tìm ý bị rơi)
date: 2026-08-21
source-intent: _bmad-output/brainstorming/brainstorm-quan-ly-he-thong-it-2026-08-19/brainstorm-intent.md
target: prd.md + addendum.md (cùng thư mục)
---

# Đối chiếu brainstorm-intent ↔ PRD + Addendum

**Phương pháp:** đọc trọn intent, dò từng ý (tính năng + nguyên tắc/ràng buộc định tính) sang prd.md và addendum.md. Các khác biệt do PRD **cố ý cập nhật sau intent** không tính là gap (FR-013 gộp báo cáo expiry thành mail tổng hợp theo luật thay leo thang 30-14-7; mô hình whitelist 3 tầng ⚪🟡⛔ mới thêm; license key vào vault).

**Kết quả: 12 gap** — 7 gap chính (G1–G7) + 5 gap phụ/mờ nghĩa (M1–M5).

---

## A. GAP CHÍNH (ý bị rơi hẳn hoặc bị hạ cấp)

### G1 — Rate-limit theo IP cho đăng nhập (Tường 1)
- **Intent §5:** "Lockout 1 tầng: sai 5 lần → khóa 15 phút + email báo SA. **Rate-limit theo IP.**"
- **PRD:** NFR-01 chỉ có lockout 5 lần/15 phút. Addendum chỉ có rate-limit cho **endpoint TOTP** (§2). Rate-limit theo IP cho login **không xuất hiện ở đâu**.
- **Hệ quả nếu bỏ:** addendum §4 biện luận "brute-force đã vô vọng vì Argon2 + rate-limit" — nhưng chính rate-limit đó lại không được đặc tả. Lockout theo account không chặn được spray nhiều account từ 1 IP.
- **Đề xuất:** thêm vào NFR-01: "rate-limit đăng nhập theo IP nguồn".

### G2 — SA có nút đá phiên (kick session thủ công) (Tường 3)
- **Intent §5:** "**SA có nút đá phiên**; regenerate session ID sau login; revoke mọi phiên khi đổi pass/đổi MFA…"
- **PRD:** NFR-01 giữ regenerate + revoke-khi-đổi-pass/MFA, nhưng **nút đá phiên chủ động của SA bị rơi**. Addendum ghi "thêm idle/absolute/regenerate/revoke-all" cho bảng sessions — revoke-all gần nghĩa nhưng không nói rõ đây là thao tác SA chủ động trên UI, nhắm 1 user cụ thể.
- **Đề xuất:** thêm FR/NFR: SA xem danh sách phiên đang hoạt động + chấm dứt phiên của 1 user bất kỳ ngay lập tức (đây cũng là cơ chế thực thi "nghỉ việc → phiên chết ngay" của NFR-05).

### G3 — Đăng nhập từ thiết bị mới → audit + email báo chính chủ (Tường 3)
- **Intent §5:** "đăng nhập thiết bị mới → audit + email báo chính chủ."
- **PRD:** NFR-03 audit mọi login, nhưng **phát hiện thiết bị/trình duyệt mới và email cảnh báo cho chính chủ tài khoản** không có trong NFR-01/03 lẫn addendum.
- **Đề xuất:** thêm vào NFR-01 hoặc NFR-03.

### G4 — Origin check bên cạnh CSRF token (Tường 3)
- **Intent §5:** "CSRF token **+ Origin check**."
- **PRD:** NFR-01 chỉ ghi "CSRF token"; addendum chỉ ghi thư viện `csrf-csrf`. Lớp kiểm tra Origin/Referer header bị rơi.
- **Đề xuất:** thêm "kiểm tra Origin header" vào NFR-01 (1 dòng, chi phí gần 0).

### G5 — Gắn người sử dụng vào THIẾT BỊ (cơ chế ngang số 3)
- **Intent §3:** 4 cơ chế ngang áp lên cả 2 entity, trong đó "**Gắn người sử dụng: ai đang dùng thiết bị**/IP/NAT rule."
- **PRD:** IP có "người/bộ phận dùng" (FR-016), NAT có "ai dùng" (FR-019), port map có "ai dùng" (FR-006) — nhưng **hồ sơ thiết bị FR-001 không có field người/bộ phận sử dụng/phụ trách**. Cơ chế ngang bị áp thiếu lên chính entity Device.
- **Đề xuất:** thêm field "người/bộ phận sử dụng hoặc phụ trách" vào FR-001 (quan trọng với thiết bị không gắn IP theo người như máy in, camera, máy chấm công).

### G6 — Cảnh báo trùng key license
- **Intent §7 + §9 (vụ toang #2):** "cảnh báo **vượt seat/trùng key**"; "key bị dùng trùng nhiều máy."
- **PRD:** FR-009 chỉ có "cảnh báo khi gán **vượt seat**" + hiển thị key nhập máy nào. **Cảnh báo trùng key** (cùng 1 key xuất hiện ở nhiều bản ghi license, hoặc gán chồng ngoài dự kiến) bị rơi — đây là nửa còn lại của đúng "vụ toang" làm nên động lực dự án.
- **Đề xuất:** bổ sung vào FR-009.

### G7 — Chính sách "xóa hẳn" bản ghi nhập nhầm (open item bị rơi)
- **Intent §10 (Gap cũ còn lại):** "Chính sách 'xóa hẳn' bản ghi nhập nhầm: đề xuất cần quyền Admin/SA và hành động xóa vẫn vào audit log — **chưa chốt chi tiết**."
- **PRD:** mục 8 Open items chỉ còn 2 `[ASSUMPTION]` + 1 `[NOTE FOR PM]` — câu hỏi mở này **biến mất**, không được chốt cũng không được ghi là còn treo. FR-018 chỉ xử lý cho IP (thu hồi có log), không trả lời câu hỏi tổng quát cho Device/Software/phiếu nhập nhầm.
- **Đề xuất:** đưa lại vào PRD §8 Open items.

---

## B. GAP PHỤ / MỜ NGHĨA (ý còn dấu vết nhưng yếu đi hoặc chỉ nằm gián tiếp)

### M1 — Nhắc đổi pass thiết bị sau break-glass và khi nhân sự nghỉ: bị hạ cấp thành backlog
- **Intent §5 (Vận hành bảo mật):** liệt kê như một cơ chế vận hành của v1: "Nhắc đổi pass thiết bị sau break-glass và khi nhân sự nghỉ."
- **PRD/Addendum:** addendum §3 ghi "nhắc đổi sau break-glass/nghỉ việc **(backlog)**" và §3 bài học CyberArk cũng gắn nhãn backlog; PRD chính không nhắc. Intent không gắn MoSCoW cho mục này nên việc hạ cấp có thể là chủ đích — nhưng **không có dấu vết quyết định hạ cấp**, nên ghi nhận để PM xác nhận.

### M2 — Pass tạm buộc đổi lần đầu + enroll TOTP ngay: chỉ nằm gián tiếp trong addendum
- **Intent §5 (Tường 5):** yêu cầu tường minh.
- **PRD:** NFR-01 không nói; chỉ suy ra được từ addendum §1 ("login-screen: username+password → TOTP → đổi pass lần đầu", "profile thêm enroll TOTP") — tức là mô tả cách copy code chứ không phải requirement. Nên nâng thành 1 vế trong NFR-01 để không bị rơi khi dev đọc mỗi PRD.

### M3 — Member mở thẳng danh sách thiết bị trong allowlist của mình để xin (không đi qua runbook)
- **Intent §4:** ràng buộc UX tường minh cho luồng break-glass.
- **PRD:** FR-023 chỉ ghi "chọn thiết bị → nhập lý do…" — không nói member có **màn danh sách allowlist của riêng mình** làm điểm vào, và nguyên tắc "không đi qua runbook" không xuất hiện. Nên thêm 1 câu vào FR-023.

### M4 — 0213 tổ chức "theo kỳ + thiết bị" (thay folder tháng)
- **Intent §7:** "0213 update firmware/system: số hóa **tự tổ chức theo kỳ + thiết bị** thay vì folder tháng."
- **PRD:** FR-029 gom 0213 vào nhóm A "sinh kỳ theo chu kỳ" — vế "tổ chức theo **thiết bị**" (mỗi dòng/kỳ gắn thiết bị cụ thể) không được nói riêng. Chi tiết nhỏ nhưng là quyết định cấu trúc dữ liệu đã chốt.

### M5 — Phân nhóm phiếu A/B/C: nhóm C không được định nghĩa
- **Intent §7:** "Phân nhóm phiếu A/B/C đã duyệt."
- **PRD:** FR-029/030 + addendum §5 chỉ còn nhóm A (định kỳ) và nhóm B (sự kiện). Nhóm C không xuất hiện — nhiều khả năng C = nhóm loại khỏi scope (0201/0211/0212) hoặc WI → Documents, nhưng PRD không nói. Nên ghi rõ 1 dòng để tránh downstream hỏi lại.

---

## C. CÁC MỤC ĐÃ KIỂM — KHÔNG PHẢI GAP (xác nhận đủ)

Đối chiếu đầy đủ, các ý sau của intent ĐÃ có mặt đúng tinh thần trong PRD/addendum:

- **3 mục đích + 3 vụ toang:** PRD §1–2 + Success Metrics phản ánh đủ (tra cứu 30 giây, 0 hết hạn bất ngờ, 100% credential vào vault).
- **2 entity + 4 cơ chế ngang:** Device/Software ✓; expiry ✓ (FR-012–014); file đính kèm ✓ (FR-002, FR-010); audit ✓ (FR-007, NFR-03); gắn người — thiếu 1 phần, xem G5.
- **RBAC 3 vai, 2 SA dual-control, allowlist theo nhóm/site, member chọn thời hạn, dashboard break-glass tuần:** ✓ (§2, FR-023–025, FR-027, NFR-01).
- **Nguyên tắc "Documents tuyệt đối không chứa credential":** giữ ở FR-035; mức thực thi "nhắc nhở, không chặn cứng" đã được đánh dấu `[ASSUMPTION]` tường minh — không tính gap.
- **Auth 5 tường:** Argon2id+pepper, lockout 1 tầng, TOTP toàn bộ + toggle per member, step-up TOTP grace 10 phút, chống replay TOTP, session server-side idle 30'/absolute 12h, khóa-không-xóa khi nghỉ việc, phong bì 2 người, restore drill có biên bản: ✓ (trừ G1–G4).
- **Vault:** AES-256-GCM envelope per-record, AAD, key_version, master key docker secret, giải mã on-demand từng bản ghi, không endpoint xuất toàn bộ (FR-026), mỗi giải mã 1 dòng audit, trần rủi ro "server bị chiếm = két lộ" chấp nhận có chủ đích: ✓ (NFR-02, addendum §3).
- **MoSCoW:** toàn bộ MUST/SHOULD có FR tương ứng; WON'T + phase sau (sơ đồ data-bound, ping/ARP, SNMP, Meraki, Wazuh) ✓ PRD §7 + addendum §4.
- **Quản lý IP:** subnet 172.16.x.0/24 làm khung sinh IP trống, chỉ static v1, 4 trạng thái đặt tay ("người chốt"), member tự chọn IP trống, chặn cấp trùng, không xóa trắng — lịch sử vĩnh viễn, NAT Draytek: ✓ (FR-015–020).
- **Phiếu ISO:** tái tạo y hệt, in ký tay không ký điện tử, grid tick từng ngày, field tự điền, 0206 form động theo Type, giữ cả 0204 và 0205, loại 0201/0211/0212, Reported/Approved qua approval flow, bác ràng buộc 0213/0214-với-sơ đồ, song ngữ bản in: ✓ (FR-029–033, NFR-06, addendum §4).
- **Vị trí 2 cấp site→tủ; port map bảng từ v1; break-glass duyệt qua email; scan hợp đồng as-is; TLS wildcard giữ nguyên; LAN-only 443 + zero-trust:** ✓.
- **Không cần (QR label, lịch bảo trì, kênh realtime) + ngoài scope (email, PC/laptop, booking):** PRD không chứa các mục này — đúng.
- **Bản đồ tái dùng QLTS + thư viện + việc-phải-làm-khi-copy (AuthedRequest, grep quét, crypto-secret.ts chỉ cho SMTP):** ✓ addendum §1–2, chi tiết hơn cả intent.
- **Backlog §10:** 8/9 mục có mặt trong PRD §7 backlog; mục thứ 9 (xóa hẳn bản ghi) rơi — xem G7.
- **Các khác biệt cố ý (không tính):** FR-013 mail tổng hợp theo luật thay leo thang 30-14-7; whitelist 3 tầng; license key vào vault; NFR-05 backup hằng ngày (bổ sung mới, hợp lý).

---

## D. Tóm tắt khuyến nghị sửa PRD

| Gap | Sửa ở | Nội dung 1 dòng cần thêm |
|---|---|---|
| G1 | NFR-01 | Rate-limit đăng nhập theo IP nguồn |
| G2 | NFR-01 (hoặc FR mới F5/F6) | SA xem + chấm dứt phiên bất kỳ ngay lập tức |
| G3 | NFR-01/03 | Login từ thiết bị mới → audit + email báo chính chủ |
| G4 | NFR-01 | Kiểm tra Origin header cạnh CSRF token |
| G5 | FR-001 | Field người/bộ phận sử dụng hoặc phụ trách thiết bị |
| G6 | FR-009 | Cảnh báo trùng key (1 key xuất hiện nhiều nơi) |
| G7 | §8 Open items | Đưa lại câu hỏi mở "xóa hẳn bản ghi nhập nhầm" (Admin/SA + audit, chưa chốt) |
| M1 | Addendum §3 / PRD §7 | PM xác nhận việc hạ "nhắc đổi pass sau break-glass/nghỉ việc" xuống backlog |
| M2 | NFR-01 | Pass tạm buộc đổi lần đầu + enroll TOTP ngay khi kích hoạt account |
| M3 | FR-023 | Member có màn danh sách allowlist của mình làm điểm vào xin break-glass |
| M4 | FR-029 | 0213 tổ chức theo kỳ + thiết bị |
| M5 | FR-029/030 | Định nghĩa (hoặc xóa hẳn khái niệm) nhóm C |
