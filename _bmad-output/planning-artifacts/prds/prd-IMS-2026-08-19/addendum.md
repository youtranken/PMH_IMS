---
title: Addendum — PRD IMS (chi tiết kỹ thuật cho downstream)
created: 2026-08-21
---

# Addendum — nội dung kỹ thuật cho Architecture/Solution Design

*(Phần này không thuộc PRD — dành cho bmad-architecture và dev. Nguồn: brainstorm-intent.md + 3 vòng thẩm định chuyên gia.)*

## 1. Bản đồ tái sử dụng source QLTS (bản đồ kiến trúc sư)

**Khởi động: REPO TRẮNG → copy module** (không fork-rồi-xóa). Migrations viết mới từ 0000. Cấu trúc thư mục theo module.

- **GIỮ NGUYÊN:** `database/migration-runner` (advisory lock + checksum); module `audit/` (có sẵn migration append-only); `outbox/` + `queue/` BullMQ (nền cho expiry report + sweep); `config/` SystemConfig + SMTP (secret mã hóa); `files/`; mail hạ tầng (transport, layout, recipients, consumer); bootstrap/worker 2-process; pino redact; toàn bộ `web/ui` + `web/lib`; docker skeleton 5 service (pg/redis/api/worker/web, không publish pg/redis).
- **SỬA NHẸ:** `roles.guard` RBAC 3 vai (trùng khớp member/admin/sa); bảng `sessions` + CSRF sẵn có (bỏ cột OIDC, thêm idle/absolute/regenerate/revoke-all); khung import/export xlsx (đổi cột); bảng software-seat có sẵn (đáp ứng FR-009 license↔device+seat); trang EOL → trang Expiry; registrar `eol-digest`/`license-digest` → báo cáo tổng hợp expiry; catalog/profile (profile thêm enroll TOTP).
- **VIẾT LẠI (mượn pattern):** `assets/` → Device/Software (chia read/write service, pg-error mapping, allocation-history append-only → lịch sử IP; tránh bê nguyên cycle import assets-write→software-license→assets.service); approval flow mới ~300 dòng theo pattern tickets (KHÔNG phẫu thuật gỡ booking khỏi tickets — bện chặt); login-screen (username+password → TOTP → đổi mật khẩu lần đầu); approval-queue UI.
- **BỎ:** booking/pool; toàn bộ OIDC (`openid-client`, `jose`, oidc-provider, backchannel-logout, jwt-verifier, group-access); directory-sync IdP; chatbot; các registrar mail booking.
- **Việc bắt buộc khi copy:** tách type `AuthedRequest` ra `auth/types.ts` thuần (god node 86 cạnh đang nằm trong file OIDC); viết lại `SessionAuthService` bỏ nhánh OIDC-refresh; grep quét `PMH_|oidc|openid|login_hint|booking` sau copy; `crypto-secret.ts` cũ chỉ dùng cho SMTP secret — vault viết riêng (file cũ là mã hóa phẳng 1 khóa, không envelope/version).

## 2. Xây mới hoàn toàn — thư viện đã chọn

| Hạng mục | Thư viện / kỹ thuật |
|---|---|
| Hash mật khẩu | `@node-rs/argon2` (Argon2id, OWASP m≥19MiB t=2 p=1) + pepper HMAC-SHA256 (pepper cạnh master key) |
| TOTP | `otplib`; window ±1 step; lưu `last_used_timestep` chống replay; rate-limit endpoint TOTP; secret mã hóa envelope |
| Session | Kế thừa bảng sessions QLTS (Postgres) hoặc `express-session` + `connect-pg-simple`; `csrf-csrf` |
| Vault | `node:crypto` `createCipheriv('aes-256-gcm')`; envelope: master key (docker secret file `/run/secrets/…`) mã hóa data-key per-record; AAD = `record_id + key_version + table`; nonce 96-bit random |
| HTTP hardening | `helmet` (CSP, HSTS, nosniff) |
| Form ISO in | CSS `@media print` tái tạo layout + `exceljs` (đã có trong QLTS) cho xuất xlsx |
| IPAM | Postgres native `inet`/`cidr` types |
| Phase sau — sơ đồ | `@xyflow/react` (React Flow) + `html-to-image` |
| Phase sau — scan | `fping`/`net-ping` trong worker (cap NET_RAW); ARP chỉ thấy cùng L2 → đa site cần probe per-site hoặc SNMP |

## 3. Kết quả thẩm định bảo mật (tóm tắt cho architect)

- Phán quyết: **đạt khung** — kiến trúc khớp thực hành Vaultwarden/HashiCorp Vault/Passbolt ở quy mô tương ứng.
- Trần rủi ro chấp nhận có chủ đích: server-side encryption nghĩa là **server app bị chiếm = vault lộ**. E2E kiểu Bitwarden bị bác vì mâu thuẫn yêu cầu break-glass/Admin xem. Hệ quả: trọng tâm phòng thủ = vá dependency (npm audit/Renovate), container non-root, secret qua docker secret file.
- Top rủi ro còn lại: (1) RCE/supply-chain trên server app; (2) endpoint 5 máy IT nhiễm malware; (3) insider SA — giảm bằng audit append-only + 2 SA + digest cho sếp; (4) mất chìa — đóng bằng restore drill; (5) mật khẩu thiết bị bất biến nhiều năm — nhắc đổi sau break-glass/nghỉ việc (backlog).
- Bài học CyberArk (backlog): đánh dấu secret "đã xem qua break-glass" → task nhắc đổi mật khẩu thiết bị trong X ngày.

## 4. Quyết định vận hành & lý do (rejected alternatives)

- **Ký tay trên bản in, không ký điện tử** — yêu cầu ISO.
- **Không dùng IdP/OIDC** — tự chủ auth, LAN-only, 5 user; QLTS dùng OIDC nhưng không mang theo.
- **Wildcard *.pmh.com.vn giữ nguyên** dù chuyên gia đề nghị cert SAN đơn — lý do: VM không ra internet, firewall vật lý chỉ mở 443; rủi ro blast-radius chấp nhận.
- **Lockout 1 tầng** (bỏ khóa cứng 2 tầng ban đầu) — tránh tự-DoS khi SA vắng; brute-force đã vô vọng vì Argon2 + rate-limit.
- **Bỏ ràng buộc phiếu 0213/0214 với cập nhật sơ đồ** — team 1-2 người làm, không cưỡng chế quy trình.
- **File scan hợp đồng ISP giữ as-is** dù có mật khẩu PPPoE in trên scan — rủi ro chấp nhận.
- **v1 không ping scan** — vòng đời IP thủ công; scan + sơ đồ + Wazuh/Meraki dồn về phase sau (sau khi dự án SIEM Wazuh xong).
- **Email là kênh duyệt break-glass duy nhất v1** — chưa cần Telegram/push.
- **Sơ đồ mạng:** node data-bound chọn từ kho thiết bị (không hình trôi nổi), vẽ dây = ghi bản ghi đấu nối port A↔B (sơ đồ và port map là MỘT dữ liệu) — thiết kế đã chốt cho phase sau.

## 5. Dữ liệu nguồn

- Brainstorm intent: `_bmad-output/brainstorming/brainstorm-quan-ly-he-thong-it-2026-08-19/brainstorm-intent.md`
- Sổ brainstorm đầy đủ (106 mục, gồm mọi quyết định + lý do bác): `.memlog.md` cùng thư mục
- Bộ phiếu ISO mẫu: `C:\Users\leminh\Documents\SP-IT02.7z` (0203/0204/0205/0208/0213 nhóm A; 0206/0207/0209/0210/0214 nhóm B; WI-IT01–07 → Documents)
