---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-IMS-2026-08-19/prd.md
  - _bmad-output/planning-artifacts/prds/prd-IMS-2026-08-19/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-IT_IMS-2026-08-21/ARCHITECTURE-SPINE.md
  - "party-mode 2026-08-21: kế hoạch 3 đợt + điều kiện Murat/Mary/Sally"
---

# IT_IMS - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for IMS, decomposing the requirements from the PRD, Architecture Spine, and the approved 3-đợt release plan into implementable stories.

## Requirements Inventory

### Functional Requirements

FR-001: Tạo/sửa/khóa hồ sơ thiết bị (loại, model, serial, site→tủ, người/bộ phận sử dụng, NCC, ngày mua, bảo hành start/end tự tính, ghi chú)
FR-002: Đính kèm nhiều file per thiết bị
FR-003: Import thiết bị từ Excel (template + validate + preview lỗi) và export xlsx
FR-004: Danh mục loại thiết bị/site/tủ do Admin quản trị
FR-005: Trang chi tiết thiết bị tổng hợp (IP, secret theo quyền, license, phiếu/sự cố, file)
FR-006: Port map dạng bảng trên trang thiết bị
FR-007: Lịch sử thay đổi từng hồ sơ thiết bị
FR-008: Hồ sơ phần mềm theo loại (license, SSL, domain, hợp đồng ISP, hợp đồng bảo trì) có start/end
FR-009: Bảng gán license↔thiết bị theo seat; cảnh báo vượt seat và trùng key
FR-010: Hồ sơ ISP (nhà mạng, băng thông, IP WAN static, Draytek, hotline, file scan)
FR-011: Danh sách phần mềm có filter + cột tình trạng hạn
FR-012: Mọi bản ghi có start/end tự động vào lịch theo dõi hạn
FR-013: Báo cáo email tổng hợp sắp-hết-hạn theo luật cấu hình (loại + cửa sổ + người nhận + tần suất)
FR-014: Màn Expiry tổng hợp + thao tác "đã gia hạn" giữ lịch sử
FR-015: Khai báo subnet/VLAN; v1 chỉ IP static
FR-016: Hồ sơ IP (thiết bị giữ, người dùng, ai cấp, trạng thái 4 mức đặt tay)
FR-017: Danh sách IP tổng theo subnet; tạo thêm IP; chặn cấp trùng
FR-018: Thu hồi IP về pool; lịch sử giữ vĩnh viễn
FR-019: Sổ NAT Draytek (rule + ai dùng + lý do)
FR-020: View % sử dụng subnet
FR-021: Lưu secret mã hóa từng bản ghi, gắn thiết bị/phần mềm, nhiều secret/thiết bị
FR-022: Xem secret SA/Admin qua TOTP (grace 10', ẩn 30s cấu hình, hết hiệu lực gõ lại, audit mỗi lần)
FR-023: Truy cập secret của Member 3 tầng (whitelist / cần duyệt có thời hạn trần 24h / ngoài danh sách)
FR-024: SA/Admin quản trị whitelist + danh sách cần duyệt theo member × nhóm đối tượng
FR-025: Nhật ký break-glass đầy đủ đổ vào dashboard
FR-026: Không tồn tại chức năng xuất toàn bộ secret
FR-027: Dashboard theo vai (sắp hết hạn / sự cố tuần / break-glass tuần)
FR-028: Export xlsx từ mọi bảng đang xem
FR-029: Phiếu ISO nhóm A định kỳ tái tạo y hệt, sinh kỳ, grid tick ngày, autofill snapshot
FR-030: Phiếu nhóm B sự kiện; form 0206 động theo Type link Device
FR-031: Xuất bản in đúng layout ISO ký tay; khóa kỳ; lưu theo năm
FR-032: Sự cố liên kết thiết bị; nâng cấp RCA 0207
FR-033: Luồng Reported→Approved qua approval flow
FR-034: Sidebar Documents link 2 chiều thiết bị/phần mềm
FR-035: Documents không chứa secret (cảnh báo mức nhắc)
FR-036: License key lưu vault như secret (SA/Admin TOTP; Member theo 3 tầng)
FR-037: Cây bản vẽ (Tổng công ty → site → tầng → phòng → tủ); sửa trong draw.io tự host nhúng iframe, xem bằng SVG đã làm sạch; sidebar tự thu, trình vẽ chiếm phần còn lại, tab Sửa/Xem + nút IMS trên thanh mảnh phía trên; nút "Thiết bị kho" mở hộp tìm gọn chèn hình gắn hồ sơ (`ims_device_id`), hình theo loại thiết bị; thẻ thông tin từ kho + Mở két
FR-038: "Vẽ là khai, có hỏi" — kéo dây giữa hai máy kho thì hỏi "Khai kết nối này vào sơ đồ cổng?" (Khai → ghi qua endpoint `devices`; Chỉ vẽ → nét vàng); xoá nét đã khai hỏi "Chỉ xoá nét vẽ" (mặc định) / "Gỡ luôn kết nối"; lúc mở: đổi cổng/loại dây hiện ngay, link bị gỡ → nét đỏ, kết nối mới → "Vẽ vào"; lưu/phát hành KHÔNG ghi sơ đồ cổng; khai kết nối/nối hàng loạt qua hộp sơ đồ cổng dùng chung; màu theo loại dây + chú giải; bấm thiết bị tô sáng dây + nhảy bản vẽ
FR-039: Lớp vẽ tự do của draw.io; khung VLAN gắn dải IP; khung gắn bản vẽ con + thanh đường dẫn; chèn tủ dựng khung rack từ kho
FR-040: Phiên bản chỉ-thêm (XML + SVG + chỉ mục ô + snapshot thiết bị), tóm tắt tính phía server, đặt tên, khôi phục, báo đang có người sửa, so sánh tô màu, thanh trượt thời gian
FR-041: Bản chính thức qua duyệt: Thành viên gửi duyệt (tự kiểm: lỗi chặn, cảnh báo cho qua), Admin duyệt/trả về kèm bình luận ghim do IMS lưu; Admin/SA lưu nháp rồi bấm Phát hành
FR-042: Mọi lần xem nội dung bản vẽ nhập TOTP phạm vi sơ đồ (ân hạn riêng, tách két, mã đăng nhập không mở); xem cây không cần mã; nhật ký mở + xuất; watermark tên người xem + giờ
FR-043: Cảnh báo bản vẽ lệch kho + nút kiểm tra khớp + email khi số lệch tăng; chỉ cảnh báo, không ép sửa
FR-044: Xuất PNG/PDF do server ghép chân trang (phiên bản, ngày duyệt, người vẽ, người duyệt) + chú giải + watermark
FR-045: Bản trình bày tách rời bản chính thức (thiết bị dự kiến, ảnh tự do, dải chữ "BẢN TRÌNH BÀY")
FR-046: Điều hướng ở trình xem: tìm và bay tới, bật/tắt lớp, chỉ đường, trình chiếu, điện thoại chỉ xem
FR-047: Ảnh thật theo model/máy (mặt trước/sau) + vị trí U (U bắt đầu + số U, chặn chồng U) + mặt tủ
FR-048: Dựng nháp từ sơ đồ cổng; xếp gọn bằng bố cục có sẵn của draw.io (không viết thuật toán bố cục)
FR-049: (chỉ thiết kế, chưa làm) API nhận trạng thái sống từ máy giám sát ngoài + lớp "trạng thái sống"

> FR-037..FR-049 thêm theo `docs/QUYET-DINH.md` Q-23 (02/10/2026; bố cục màn, dây "vẽ là khai, có hỏi", mã đăng nhập không mở két, draw.io tĩnh trong `web` chốt thêm 03/10/2026): sơ đồ mạng vốn ở PRD §7 "Phase sau" nay là PRD F9 / Epic 10, làm trước Epic 8–9; viết lại cùng ngày cho trình vẽ draw.io tự host (ARCHITECTURE-SPINE AD-17/AD-18). Biên bản: `_bmad-output/brainstorming/brainstorm-so-do-mang-2026-10-02/`.

### NonFunctional Requirements

NFR-01: Đăng nhập — Argon2id+pepper, rate-limit IP, lockout 5 sai→15', TOTP enroll bắt buộc + cưỡng chế login theo toggle per member + step-up luôn bắt buộc, session idle 30'/absolute 12h, SA đá phiên, email thiết bị mới, CSRF+Origin, regenerate session, revoke khi đổi pass/MFA, 2 SA, không tự đăng ký
NFR-02: Vault — AES-256-GCM envelope, AAD=record_id+key_version+table, master key randomBytes(32) docker secret, TOTP secret mã hóa envelope, chống TOTP replay, giải mã on-demand, chìa giấy 2 phong bì, restore drill định kỳ
NFR-03: Audit — append-only (REVOKE UPDATE/DELETE), mọi login/giải mã/thay đổi, giữ vĩnh viễn
NFR-04: Triển khai — LAN-only 443, wildcard *.pmh.com.vn, docker 5 service, zero-trust, helmet, no-store cho secret
NFR-05: Hiệu năng — 300+ thiết bị/5 user, danh sách <2s, backup đêm tách máy, khóa account không xóa
NFR-06: Ngôn ngữ — UI tiếng Việt; bản in phiếu song ngữ theo mẫu ISO
NFR-07: Sơ đồ mạng — draw.io offline (tệp tĩnh trong image `web`, không Tomcat/service riêng, không CDN/plugin/đám mây), ghim phiên bản + nhịp nâng cấp, step-up có phạm vi, audit mở/xuất, trần cỡ XML + parse an toàn + làm sạch, iframe sandbox + kiểm nguồn postMessage, 300 hình + 600 dây mở < 3s

### Additional Requirements

- AR-1 (AD-12): Epic 1 Story 1 = khởi tạo repo trắng + copy module QLTS theo bản đồ (migration-runner, audit, outbox+queue, config, files, mail, web/ui+web/lib, docker skeleton); tách AuthedRequest ra auth/types.ts; grep quét PMH_|oidc|booking; bullmq pin ^5; drizzle-orm
- AR-2 (AD-2): CI có dependency-cruiser enforce ranh giới module public-api + đồ thị acyclic
- AR-3 (AD-10): Migration mới từ 0000, 4 chữ số, seed danh mục là migration
- AR-4 (AD-5): Mọi story ghi = transaction tường minh (tx param) + audit + outbox
- AR-5 (AD-6): Một module approvals dùng chung; hiệu lực grant = expires_at tại mỗi lần đọc
- AR-6 (AD-7): Expiry nhận ExpirySource provider; "đã gia hạn" gọi api module chủ
- AR-7 (AD-13): Lịch sử nghiệp vụ = bảng history append-only per module chủ
- AR-8 (AD-14): Port map 1 bản ghi/kết nối; phiếu autofill snapshot tại sinh kỳ
- AR-9 (party/Murat): Vault có test vector envelope (mã hóa→giải mã→xoay key_version) từ story vault đầu tiên; restore drill lần đầu chạy CUỐI Đợt 1 trước khi secret thật vào két
- AR-10 (party/Mary): Đợt 1 kết thúc bằng import 300 thiết bị thật từ Excel hiện có
- AR-11 (NFR-04): TLS terminate tại service web (nginx reverse proxy); mailhog ở dev

### UX Design Requirements

UX-DR1 (spine convention): UI theo design system QLTS — copy web/ui (Radix) + theme/token + layout shell (sidebar + command palette); màn mới không chế style riêng
UX-DR2 (party/Sally+Amelia): Mọi màn ĐỌC (device detail, danh sách IP, trang duyệt break-glass, dashboard) phải pass viewport 390px — ghi thành AC trên từng story đọc; màn NHẬP phức tạp (import, form phiếu, grid tick) desktop-only
UX-DR3 (FR-022/NFR-04): Màn hiển thị secret: tự ẩn sau N giây (system_config), Cache-Control no-store, không đưa secret vào URL
UX-DR4 (NFR-06): Toàn bộ UI tiếng Việt qua lib/i18n; bản in phiếu đúng song ngữ mẫu ISO (vi/zh 0204/0214)

### FR Coverage Map

FR-001: Epic 2 - Hồ sơ thiết bị
FR-002: Epic 2 - Đính kèm file thiết bị
FR-003: Epic 2 - Import/export Excel
FR-004: Epic 2 - Danh mục site/tủ/loại
FR-005: Epic 2 - Trang chi tiết tổng hợp
FR-006: Epic 2 - Port map bảng
FR-007: Epic 2 - Lịch sử hồ sơ
FR-008: Epic 3 - Hồ sơ phần mềm theo loại
FR-009: Epic 3 - Gán license↔thiết bị + seat + trùng key
FR-010: Epic 3 - Hồ sơ ISP
FR-011: Epic 3 - Danh sách + tình trạng hạn
FR-012: Epic 3 - Đăng ký expiry tự động
FR-013: Epic 3 - Báo cáo email theo luật
FR-014: Epic 3 - Màn Expiry + gia hạn
FR-015: Epic 5 - Khai báo subnet/VLAN
FR-016: Epic 5 - Hồ sơ IP
FR-017: Epic 5 - Danh sách IP + chặn trùng
FR-018: Epic 5 - Thu hồi IP + lịch sử
FR-019: Epic 5 - Sổ NAT Draytek
FR-020: Epic 5 - % sử dụng subnet
FR-021: Epic 4 - Lưu secret mã hóa
FR-022: Epic 4 - Xem secret TOTP + audit
FR-023: Epic 6 - Truy cập Member 3 tầng
FR-024: Epic 6 - Quản trị whitelist/allowlist
FR-025: Epic 6 - Nhật ký break-glass
FR-026: Epic 4 - Không xuất toàn bộ secret
FR-027: Epic 7 - Dashboard theo vai
FR-028: Epic 2 (pattern) + Epic 7 (toàn cục) - Export xlsx
FR-029: Epic 8 - Phiếu nhóm A định kỳ
FR-030: Epic 9 - Phiếu nhóm B sự kiện
FR-031: Epic 8 - Bản in ISO + khóa kỳ + lưu năm
FR-032: Epic 9 - Sự cố liên kết thiết bị + RCA
FR-033: Epic 9 - Reported→Approved qua approvals
FR-034: Epic 9 - Sidebar Documents
FR-035: Epic 9 - Cảnh báo secret trong Documents
FR-036: Epic 4 - License key trong vault
FR-037: Epic 10 - Cây bản vẽ, trình vẽ nhúng, trình xem, thiết bị từ kho (10.2, 10.3, 10.4)
FR-038: Epic 10 - Dây gắn sơ đồ cổng, loại dây, tô sáng/nhảy bản vẽ (10.5)
FR-039: Epic 10 - Bản vẽ con, khung VLAN, khung tủ (10.6)
FR-040: Epic 10 - Phiên bản, tóm tắt, khôi phục (10.3); so sánh, thanh trượt thời gian (10.10)
FR-041: Epic 10 - Duyệt, phát hành, tự kiểm, bình luận ghim (10.7)
FR-042: Epic 10 - TOTP phạm vi sơ đồ (10.1), nhật ký mở + watermark (10.2, 10.3)
FR-043: Epic 10 - Cảnh báo lệch kho (10.9)
FR-044: Epic 10 - Xuất PNG/PDF (10.10)
FR-045: Epic 10 - Bản trình bày (10.8)
FR-046: Epic 10 - Điều hướng, trình chiếu, điện thoại (10.12)
FR-047: Epic 10 - Ảnh thật + vị trí U + mặt tủ (10.11)
FR-048: Epic 10 - Dựng nháp từ sơ đồ cổng + bố cục draw.io (10.5)
FR-049: Epic 10 - Chừa chỗ trạng thái sống, chỉ thiết kế (10.12)

## Epic List

### Epic 1: Nền tảng & Đăng nhập an toàn (Đợt 1)
Team 5 người đăng nhập an toàn bằng mật khẩu + TOTP; SA tạo/khóa account, reset, đá phiên; hạ tầng dự án chạy được (repo mới + copy module QLTS, docker 5 service, CI dependency-cruiser, migration từ 0000).
**FRs covered:** NFR-01, AR-1, AR-2, AR-3, AR-4, AR-11, AD-15 (bộ dùng chung)

### Epic 2: Kho thiết bị (Đợt 1)
Tra cứu 300+ thiết bị theo site→tủ trong 30 giây: hồ sơ đầy đủ, port map, đính kèm giấy tờ, import từ Excel hiện có, export xlsx.
**FRs covered:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-028 (pattern)

### Epic 3: Phần mềm & Cảnh báo hết hạn (Đợt 1)
Không còn license/SSL/domain/hợp đồng hết hạn bất ngờ: hồ sơ theo loại, gán seat, cỗ máy expiry gửi báo cáo email theo luật cấu hình.
**FRs covered:** FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014

### Epic 4: Két sắt lõi (Đợt 1)
Mật khẩu thiết bị + license key rời Excel vào vault mã hóa; SA/Admin xem qua TOTP với audit từng lần. Đóng đợt 1: import 300 thiết bị thật + restore drill đầu tiên (AR-9, AR-10).
**FRs covered:** FR-021, FR-022, FR-026, FR-036

### Epic 5: Quản lý IP & NAT (Đợt 2)
Hết cảnh "IP này của ai?": subnet 172.16.x/24, hồ sơ IP có chủ, thu hồi giữ lịch sử vĩnh viễn, sổ NAT Draytek có người dùng + lý do.
**FRs covered:** FR-015, FR-016, FR-017, FR-018, FR-019, FR-020

### Epic 6: Break-glass & Phê duyệt (Đợt 2)
Member lấy được secret đúng lúc sự cố theo 3 tầng (whitelist / xin-duyệt qua email có thời hạn / cấm); module approvals dùng chung ra đời tại đây.
**FRs covered:** FR-023, FR-024, FR-025, AR-5

### Epic 7: Dashboard sếp (Đợt 2)
Sếp 3 phút sáng thứ Hai: sắp hết hạn, sự cố tuần, break-glass tuần; tự export xlsx mọi bảng.
**FRs covered:** FR-027, FR-028

### Epic 8: Phiếu ISO định kỳ (Đợt 3 — dự án con)
5 phiếu nhóm A (0203/0204/0205/0208/0213) sinh kỳ tự động, tick từng ngày trên máy, autofill snapshot, in ký tay y hệt layout ISO, khóa kỳ, lưu theo năm.
**FRs covered:** FR-029, FR-031, AR-8

### Epic 9: Sự cố, Phiếu sự kiện & Documents (Đợt 3)
Sự cố có hồ sơ gắn thiết bị và nâng cấp được thành RCA; phiếu nhóm B chạy qua approvals; runbook/WI-IT có nhà trong sidebar Documents.
**FRs covered:** FR-030, FR-032, FR-033, FR-034, FR-035

### Epic 10: Sơ đồ mạng (thay Visio) — làm trước Epic 8–9, Q-23
Bỏ Visio: bản vẽ hạ tầng vẽ bằng **draw.io tự host** nhúng trong IMS (ghim phiên bản, offline), gắn dữ liệu kho (thiết bị, sơ đồ cổng, dải IP, tủ) qua thuộc tính ô, cộng lớp vẽ tự do; cây bản vẽ Tổng công ty → site → tầng → phòng → tủ; phiên bản chỉ-thêm có duyệt, bản trình bày tách rời; mọi lần xem nhập mã 2 lớp phạm vi sơ đồ, nhật ký mở/xuất, watermark; cảnh báo lệch kho; xuất PNG/PDF nộp ISO. Lưu/phát hành bản vẽ không ghi sơ đồ cổng; vẽ dây giữa hai máy kho thì IMS hỏi có khai không, "Khai" mới ghi qua `devices` (AD-18).
**FRs covered:** FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049 (chỉ thiết kế), NFR-01 (step-up có phạm vi), NFR-03, NFR-05, NFR-07, AD-17, AD-18

## Epic 1: Nền tảng & Đăng nhập an toàn

Team 5 người đăng nhập an toàn bằng mật khẩu + TOTP; SA quản trị account và phiên; hạ tầng dự án chạy được từ xương QLTS.

### Story 1.1: Khởi tạo dự án từ xương QLTS

As a thành viên team IT,
I want một repo mới chạy được ngay với nền tảng đã kiểm chứng từ QLTS,
So that mọi story sau xây trên nền sạch, không mang theo rác booking/OIDC.

**Acceptance Criteria:**

**Given** repo trắng và source QLTS tại F:/PMH/Project_QLTS/qlts
**When** dev khởi tạo theo bản đồ AD-12 (copy migration-runner, audit, outbox+queue, config, files, mail hạ tầng, web/ui+web/lib, docker skeleton; bỏ booking/pool/OIDC/directory-sync/chatbot)
**Then** `docker compose up` chạy đủ 5 service (pg, redis, api, worker, web); pg/redis không publish port; api/worker non-root; TLS terminate tại web (nginx)
**And** `/health` trả 200; migration 0000-nền (users, sessions, audit_log append-only, outbox, file, system_config) chạy qua migration-runner với advisory lock + checksum
**And** grep `PMH_|oidc|openid|login_hint|booking` toàn repo trả 0 kết quả; `AuthedRequest` nằm ở `auth/types.ts` thuần type
**And** CI chạy lint + dependency-cruiser (đồ thị module acyclic, cấm import ngang ngoài `*.api.ts`) + build; bullmq pin ^5; drizzle-orm làm data access

### Story 1.2: Đăng nhập bằng mật khẩu với phiên an toàn

As a thành viên team IT,
I want đăng nhập bằng username/mật khẩu với phiên được bảo vệ đúng chuẩn,
So that chỉ người của team vào được hệ thống và phiên không bị chiếm dụng.

**Acceptance Criteria:**

**Given** user tồn tại với mật khẩu đã hash Argon2id + pepper (pepper đọc từ docker secret)
**When** đăng nhập đúng thông tin
**Then** tạo session server-side trong Postgres; cookie httpOnly+Secure+SameSite; session ID regenerate sau login; CSRF token theo phiên và mọi request ghi kiểm tra CSRF + header Origin
**And** phiên hết hạn idle 30 phút hoặc absolute 12 giờ (system_config)

**Given** đăng nhập sai
**When** sai lần thứ 5 liên tiếp
**Then** account tự khóa 15 phút (tự mở); email báo SA qua outbox; mọi lần đăng nhập thành công/thất bại đều ghi audit kèm IP
**And** rate-limit theo IP áp trên endpoint đăng nhập

### Story 1.3: Bật TOTP và lõi mã hóa envelope

As a thành viên team IT,
I want kích hoạt mã 6 số Google Authenticator cho tài khoản của mình,
So that tài khoản không thể bị chiếm chỉ bằng mật khẩu.

**Acceptance Criteria:**

**Given** util mã hóa envelope tại `common/crypto`: master key (docker secret, 32 byte) mã hóa data-key per-record, AES-256-GCM, AAD = record_id + key_version + table
**When** chạy bộ test vector cố định (mã hóa → giải mã → xoay key_version)
**Then** toàn bộ test vector pass trong CI (điều kiện AR-9)

**Given** user đăng nhập lần đầu bằng mật khẩu tạm
**When** kích hoạt tài khoản
**Then** bắt buộc đổi mật khẩu và enroll TOTP (QR otplib); TOTP secret lưu bằng envelope, không plaintext trong DB
**And** xác thực TOTP từ chối mã đã dùng (lưu last_used_timestep), window ±1 step, rate-limit riêng endpoint TOTP
**And** SA/Admin có toggle bắt buộc-TOTP-lúc-login per member

### Story 1.4: SA quản trị tài khoản và phiên

As a SA,
I want tạo/khóa/reset tài khoản và đá phiên bất kỳ ai,
So that vòng đời nhân sự được kiểm soát và không phiên nào sống ngoài tầm tay.

**Acceptance Criteria:**

**Given** SA đăng nhập
**When** tạo user mới (role member/admin/sa) với mật khẩu tạm
**Then** user mới buộc đổi mật khẩu + enroll TOTP lần đầu; seed có sẵn 2 account SA (dual control)

**Given** một user bị khóa hoặc đổi mật khẩu/reset MFA
**When** thao tác hoàn tất
**Then** mọi phiên đang mở của user đó chết ngay; account khóa không bao giờ bị xóa (giữ audit)

**Given** user đăng nhập từ thiết bị/trình duyệt mới
**When** phiên được tạo
**Then** ghi audit + email báo chính chủ qua outbox
**And** SA xem danh sách phiên đang mở và đá được từng phiên

### Story 1.5: Bộ dùng chung nền web (UI kit + hạ tầng chung)

As a dev của team,
I want bộ component/hook/service dùng chung có tên và có nhà TRƯỚC khi epic tính năng bắt đầu,
So that 8 epic sau ráp lại từ một bộ, không mỗi màn tự chế popup, bảng, lịch, export riêng.

**Acceptance Criteria:**

**Given** `web/ui` + `web/lib` đã copy từ QLTS (story 1.1)
**When** dev chuẩn hóa thành bộ dùng chung của IMS
**Then** tồn tại và có demo sống trên trang `/dev/components`: `ConfirmProvider` + `useConfirm` (mọi thao tác khóa/thu hồi/xóa/gia hạn), `Dialog`, `ToastProvider`, `DataTable` (phân trang `?page=&limit=` + sort + loading + empty), `FilterBar`, `ExportXlsxButton`, `DatePicker` + `SchedulePicker` (luật digest FR-013, sinh kỳ phiếu FR-029), `ExpiryBadge` (ok/warn/danger tính bằng **một** hàm duy nhất), `HistoryPanel` (render bảng history AD-13), `FormSection`/`form-grid`, `LoadState`/`EmptyState`
**And** phía API `src/common` có: pagination DTO `{ items, total }`, `global-exception.filter`, decorator `@Audited` + `@Roles`, `ExcelExportService` (FR-028 — dùng chung cho MỌI bảng, Epic 7 chỉ gắn thêm chỗ gọi), helper transaction `tx` (AD-5), interface `ExpirySource` (AD-7)
**And** mỗi mục được khai vào `docs/SHARED-REGISTRY.md` theo dòng: tên · đường dẫn · dùng ở đâu · khi nào KHÔNG dùng
**And** CI chặn được các vi phạm: `window.confirm|window.alert`, dialog tự dựng trong `features/`, hex màu ngoài `tokens.css`, logic phân trang/export/tính hạn viết lại — eslint `no-restricted-syntax`/`no-restricted-imports` chạy cùng chỗ với dependency-cruiser (AD-2, AD-15)
**And** `/dev/components` render đủ bộ ở light + dark + viewport 390px (UX-DR2)

## Epic 2: Kho thiết bị

Tra cứu 300+ thiết bị theo site→tủ trong 30 giây: hồ sơ đầy đủ, port map, đính kèm giấy tờ, import từ Excel hiện có.

### Story 2.1: Danh mục site, tủ, loại thiết bị, nhà cung cấp

As a Admin,
I want quản trị danh mục dùng chung (site, tủ mạng, loại thiết bị, NCC),
So that hồ sơ thiết bị nhập nhất quán, không ai gõ tay mỗi người một kiểu.

**Acceptance Criteria:**

**Given** module `catalog` (tầng nền) sở hữu bảng site/cabinet/device_type/vendor
**When** migration seed chạy
**Then** 12 loại thiết bị cơ bản có sẵn sau cài đặt (Switch, Firewall, Server, NAS, UPS, AP, PC, Laptop, Printer, Camera, Điện thoại IP, Khác)
**And** site / tủ mạng / nhà cung cấp KHÔNG seed sẵn — 2026-08-22 user xác nhận chưa chốt danh sách,
sẽ điền `mau-danh-muc.xlsx` rồi import (seed dữ liệu đoán mò chỉ tạo rác phải đi xóa)

**Given** Admin mở màn danh mục
**When** thêm/sửa/vô hiệu một mục
**Then** thay đổi ghi audit; mục đang được thiết bị tham chiếu không xóa được, chỉ vô hiệu
**And** Member chỉ xem, không sửa danh mục (@Roles enforce)

**Given** team chưa có danh mục sẵn trong hệ thống (2026-08-22: user xác nhận chưa có)
**When** Admin bấm "Tải file mẫu" ở màn Danh mục
**Then** tải về `mau-danh-muc.xlsx` 4 sheet (Site, Tủ mạng, Loại thiết bị, Nhà cung cấp) + sheet Hướng dẫn,
sinh bằng `ExcelExportService` dùng chung (AD-15) — KHÔNG phục vụ file tĩnh nằm trong repo
**And** file mẫu điền sẵn 12 loại thiết bị và vài dòng đánh dấu `VÍ DỤ`

**Given** Admin đã điền file mẫu
**When** import file đó
**Then** hiện bảng đối chiếu TRƯỚC khi ghi: dòng nào thêm mới / cập nhật / lỗi và lỗi vì sao (thiếu cột bắt buộc,
tủ trỏ tới site không tồn tại, mã trùng trong file…); bỏ qua dòng đánh dấu `VÍ DỤ`
**And** chỉ khi Admin xác nhận mới ghi, ghi trong MỘT transaction + audit + lịch sử (AD-5, AD-13)
**And** import lại cùng mã = CẬP NHẬT mục đó, không tạo bản sao

### Story 2.2: Hồ sơ thiết bị

As a Member,
I want tạo và cập nhật hồ sơ thiết bị đầy đủ trường theo PRD,
So that mọi thiết bị có một nguồn sự thật duy nhất.

**Acceptance Criteria:**

**Given** form thiết bị với các trường FR-001 (tên, loại, model, serial, site→tủ, người/bộ phận sử dụng, NCC, ngày mua, bảo hành start/end, ghi chú)
**When** lưu hợp lệ
**Then** cột còn/hết bảo hành tự tính từ start/end; bản ghi ghi audit; serial trùng bị cảnh báo
**And** thiết bị khóa được (không xóa); bảng device_history append-only ghi mọi thay đổi, hiển thị tab Lịch sử (FR-007)

**Given** danh sách 300+ thiết bị
**When** lọc theo site/tủ/loại/trạng thái hoặc tìm theo tên/serial
**Then** kết quả phân trang trả về < 2 giây; màn danh sách + chi tiết pass viewport 390px (UX-DR2)

### Story 2.3: Đính kèm giấy tờ theo thiết bị

As a Member,
I want đính kèm nhiều file scan (giấy mua, hợp đồng) vào từng thiết bị,
So that giấy tờ không bao giờ lạc nữa.

**Acceptance Criteria:**

**Given** trang chi tiết thiết bị
**When** upload file (module files kế thừa: uuid trên volume, validate loại/kích thước)
**Then** file gắn vào thiết bị, xem/tải lại được; xóa file ghi audit
**And** file đính kèm không render inline dạng HTML (chống XSS qua file)

### Story 2.4: Port map dạng bảng

As a Member,
I want ghi bảng port cho switch/Draytek (port → cắm gì, nhãn, ai dùng),
So that xuống site biết ngay cổng nào đi đâu.

**Acceptance Criteria:**

**Given** thiết bị loại có port
**When** thêm dòng port map (port_label, connected_device chọn từ kho hoặc text tự do, note, người dùng)
**Then** một kết nối = một bản ghi (AD-14); trang thiết bị ĐẦU KIA tự hiển thị chiều ngược bằng query, không tạo bản ghi đối xứng
**And** sửa/xóa dòng ghi audit; bảng pass 390px ở chế độ xem

### Story 2.5: Trang chi tiết thiết bị tổng hợp

As a Member,
I want một trang mở ra thấy mọi thứ về thiết bị,
So that không phải mò nhiều màn khi xử lý sự cố.

**Acceptance Criteria:**

**Given** trang chi tiết thiết bị
**When** mở
**Then** thấy: hồ sơ, tình trạng bảo hành, port map, file đính kèm, lịch sử — các panel IP/license/secret/phiếu là khu mở rộng: hiển thị qua public api của module tương ứng KHI module tồn tại, ẩn gọn khi chưa có (không lỗi, không phụ thuộc tương lai)
**And** trang pass 390px; mọi dữ liệu chéo qua `*.api.ts`, không SQL chéo (AD-2/AD-3)

### Story 2.6: Import thiết bị từ Excel và export

As a SA,
I want import 300 thiết bị từ file Excel hiện có theo template chuẩn,
So that không phải gõ tay lại những gì đã có.

**Acceptance Criteria:**

**Given** template xlsx tải từ hệ thống (cột khớp FR-001, cột danh mục nhận giá trị theo tên)
**When** upload file import
**Then** validate từng dòng, hiển thị PREVIEW lỗi (dòng, cột, lý do) trước khi ghi; chỉ ghi khi xác nhận; import là 1 transaction — lỗi giữa chừng rollback toàn bộ
**And** dòng danh mục chưa tồn tại được báo rõ (không tự tạo); kết quả import ghi audit kèm số dòng
**And** mọi màn danh sách có nút export xlsx tôn trọng filter hiện tại (pattern FR-028, exceljs)

## Epic 3: Phần mềm & Cảnh báo hết hạn

Không còn license/SSL/domain/hợp đồng hết hạn bất ngờ.

### Story 3.1: Hồ sơ phần mềm theo loại

As a Member,
I want quản lý hồ sơ phần mềm theo loại (license, SSL, domain, hợp đồng ISP, hợp đồng bảo trì),
So that mọi thứ có gia hạn nằm một chỗ.

**Acceptance Criteria:**

**Given** form phần mềm: loại + start/end + NCC + ghi chú + file đính kèm
**When** lưu
**Then** danh sách filter theo loại, cột tình trạng hạn (còn X ngày / đã hết — tự tính); pass 390px chế độ xem
**And** trường key/valid-key KHÔNG nằm trong bảng software — chỉ là liên kết sang vault (Epic 4; hiển thị "chưa có secret" khi trống)

### Story 3.2: Gán license cho thiết bị theo seat

As a Member,
I want gán license vào thiết bị và thấy ngay seat còn/đã dùng,
So that không bao giờ lặp lại vụ "key nhập máy nào không ai biết".

**Acceptance Criteria:**

**Given** license có seat = N và bảng license_assignment (chủ: software)
**When** gán vào thiết bị thứ N+1
**Then** cảnh báo vượt seat (cho ghi đè có lý do, ghi audit); màn license hiển thị danh sách máy đang dùng key
**And** cùng key gán trùng một máy bị chặn; gỡ gán giữ lịch sử (đánh dấu released, không xóa dòng)
**And** thiết bị khóa không làm mất bản ghi gán (convention Xóa)

### Story 3.3: Hồ sơ đường truyền ISP

As a Member,
I want quản lý 25+ đường ISP đầy đủ thông tin vận hành,
So that đứt cáp lúc 2h sáng có hotline + số hợp đồng trong 30 giây.

**Acceptance Criteria:**

**Given** form ISP: nhà mạng, băng thông, IP WAN static, thiết bị Draytek gắn (chọn từ kho qua devices.api), hotline, số hợp đồng, start/end, file scan
**When** lưu
**Then** danh sách ISP lọc theo site/nhà mạng, cột tình trạng hạn; file scan mở nhanh từ danh sách
**And** trang thiết bị Draytek hiển thị các đường ISP gắn với nó (qua public api)

### Story 3.4: Cỗ máy Expiry và màn tổng hợp

As a thành viên team IT,
I want mọi thứ có start/end tự vào một lịch theo dõi hạn chung,
So that không phải nhớ hạn của từng loại.

**Acceptance Criteria:**

**Given** module expiry (tầng nền) với ExpirySource provider do devices (bảo hành) + software (mọi loại) đăng ký
**When** mở màn Expiry tổng hợp
**Then** thấy mọi mục sắp/đã hết hạn, lọc theo loại + trạng thái; engine chỉ gọi provider, không SELECT bảng module khác (AD-7); vault không đăng ký
**And** thao tác "đã gia hạn" gọi api module chủ (vd software.api.renew) nhập end mới; lịch sử gia hạn lưu renewal_history append-only (AD-13)

### Story 3.5: Báo cáo email sắp-hết-hạn theo luật

As a Admin,
I want cấu hình luật gửi báo cáo tổng hợp (loại + cửa sổ ngày + người nhận + tần suất),
So that sếp và team nhận đúng thứ cần, không bị spam từng món.

**Acceptance Criteria:**

**Given** màn cấu hình luật digest (bảng expiry_rule), vd "device hết hạn trong 30 ngày → sếp, tuần 1 lần"
**When** sweep worker chạy đến kỳ
**Then** MỘT email tổng hợp gửi qua outbox: bảng các mục sắp hết hạn, mỗi dòng = tên, loại, start, end, link (FR-013); không mail lẻ từng món
**And** gửi email test được ngay từ màn cấu hình; mailhog nhận ở dev

## Epic 4: Két sắt lõi

Mật khẩu thiết bị + license key rời Excel vào vault mã hóa.

### Story 4.1: Lưu secret mã hóa gắn thiết bị/phần mềm

As a Admin,
I want nhập mật khẩu thiết bị và license key vào vault mã hóa,
So that DB hay backup bị trộm cũng chỉ là rác.

**Acceptance Criteria:**

**Given** module vault sở hữu bảng secret; dùng envelope util Story 1.3 (data-key per-record, key_version, AAD đủ 3 thành phần)
**When** tạo secret (loại: mật khẩu / license-key / khác) gắn thiết bị hoặc phần mềm — một thiết bị nhiều secret (admin web, SSH, SNMP…)
**Then** plaintext không chạm bảng nào ngoài đường mã hóa; không module nào ngoài vault SELECT bảng secret (AD-4 — kiểm bằng dependency-cruiser + review)
**And** không tồn tại endpoint/nút xuất toàn bộ secret ở mọi quyền (FR-026); test vector envelope chạy trong CI

### Story 4.2: Xem secret với TOTP step-up

As a Admin,
I want bấm xem một secret bằng cách gõ mã 6 số,
So that ngay cả phiên đăng nhập bị chiếm cũng không mở được két.

**Acceptance Criteria:**

**Given** Admin/SA trên trang thiết bị/phần mềm có secret
**When** bấm Xem và nhập TOTP đúng
**Then** secret hiện, tự ẩn sau N giây (system_config, mặc định 30); trong grace 10 phút xem tiếp secret khác trong quyền không cần gõ lại; hết grace → gõ lại
**And** mỗi lần giải mã = một dòng audit (ai, secret nào, lúc nào); response Cache-Control: no-store; secret không xuất hiện trong URL/log (pino redact)
**And** Member gọi endpoint xem secret nhận 403 (3 tầng chờ Epic 6 — chưa whitelist thì Member không có đường xem)

### Story 4.3: Đóng Đợt 1 — dữ liệu thật và diễn tập khôi phục

As a SA,
I want đưa 300 thiết bị thật vào hệ thống và chứng minh backup/chìa khôi phục được,
So that hệ thống chính thức thành nguồn sự thật với đường lui đã kiểm chứng.

**Acceptance Criteria:**

**Given** backup pg_dump hằng đêm sang NAS (tách máy, không kèm master key) đã cấu hình
**When** chạy restore drill: máy sạch + restore backup + nạp master key từ bản giấy + giải mã thử 1 secret test
**Then** drill thành công, có biên bản (theo văn hóa phiếu ISO); master key in 2 phong bì niêm phong, 2 người giữ (AR-9)
**And** import 300 thiết bị thật từ Excel (Story 2.6) hoàn tất, số liệu đối chiếu khớp file gốc (AR-10)
**And** deploy prod LAN qua HTTPS 443 với cert wildcard, truy cập được từ máy IT cả 3 site

## Epic 5: Quản lý IP & NAT

Hết cảnh "IP này của ai?": subnet 172.16.x/24, hồ sơ IP có chủ, thu hồi giữ lịch sử vĩnh viễn, sổ NAT Draytek có người dùng + lý do.

### Story 5.1: Khai báo subnet và hồ sơ IP

As a Member,
I want khai báo subnet và tạo hồ sơ IP static trong từng subnet,
So that mọi IP có chủ và không bao giờ cấp trùng.

**Acceptance Criteria:**

**Given** module ipam sở hữu bảng subnet (kiểu `cidr`) và ip_address (kiểu `inet`)
**When** Admin khai subnet (tên, dải 172.16.x.0/24, site, mô tả) và Member tạo IP trong subnet
**Then** hồ sơ IP có: địa chỉ, subnet, thiết bị giữ (chọn từ kho qua devices.api), người/bộ phận dùng, ai cấp (tự ghi), ngày cấp, trạng thái, ghi chú
**And** IP trùng trong cùng subnet bị CHẶN tuyệt đối (unique constraint tầng DB); IP ngoài dải subnet bị từ chối
**And** danh sách IP tổng theo subnet hiển thị cả đang dùng lẫn trống kèm trạng thái, phân trang < 2 giây, pass 390px chế độ xem

### Story 5.2: Vòng đời IP và mức sử dụng subnet

As a Member,
I want đổi trạng thái IP theo vòng đời và thu hồi khi thiết bị chết,
So that pool IP luôn phản ánh thực tế mà lịch sử không bao giờ mất.

**Acceptance Criteria:**

**Given** state machine khai báo: trống → đang cấp → nghi chết → đã thu hồi (v1 đặt tay)
**When** Member chuyển trạng thái qua transition() (không UPDATE status tự do)
**Then** chuyển trạng thái sai luồng bị từ chối; mỗi lần chuyển ghi bảng ip_history append-only (AD-13) — ai, từ trạng thái nào sang nào, lúc nào
**And** IP đã thu hồi cấp lại được cho thiết bị khác; lịch sử cũ giữ vĩnh viễn và xem được trên trang IP ("IP này từng là máy in kế toán")
**And** view subnet hiển thị % đã cấp + số IP trống còn lại (FR-020)

### Story 5.3: Sổ NAT Draytek

As a Member,
I want ghi sổ mọi rule NAT/port-forward trên các thiết bị Draytek,
So that auditor hỏi "port nào mở, vì sao, cho ai" là trả lời được ngay.

**Acceptance Criteria:**

**Given** thiết bị Draytek trong kho
**When** thêm rule NAT (port ngoài → IP trong : port trong, người dùng, lý do mở)
**Then** rule gắn với thiết bị Draytek + IP trong (link sang hồ sơ IP nếu có); sửa/xóa rule ghi audit
**And** trang thiết bị Draytek hiển thị danh sách rule của nó; danh sách NAT toàn cục lọc theo site/thiết bị, export xlsx

### Story 5.4: Panel IP trên trang thiết bị

As a Member,
I want thấy IP của thiết bị ngay trên trang chi tiết thiết bị,
So that một trang đủ thông tin khi xử lý sự cố.

**Acceptance Criteria:**

**Given** trang chi tiết thiết bị (Story 2.5) và ipam.api public
**When** thiết bị có IP gắn
**Then** panel IP hiển thị địa chỉ + subnet + trạng thái, click sang trang IP; gán/thu hồi IP từ trang thiết bị gọi ipam.api (không SQL chéo — AD-2/AD-3)
**And** panel pass 390px

## Epic 6: Break-glass & Phê duyệt

Member lấy được secret đúng lúc sự cố theo 3 tầng; module approvals dùng chung ra đời.

### Story 6.1: Module phê duyệt dùng chung

As a thành viên team IT,
I want một khung xin–duyệt thống nhất cho mọi loại yêu cầu,
So that break-glass hôm nay và phiếu ISO ngày mai dùng chung một bộ máy.

**Acceptance Criteria:**

**Given** module approvals (tầng nền) sở hữu bảng approval với từ vựng state đăng ký theo loại (AD-6)
**When** một loại yêu cầu đăng ký (vd break_glass: pending → approved/denied → expired)
**Then** state chỉ đổi qua transition() khai báo; chuyển sai luồng bị từ chối; mỗi transition ghi audit trong cùng transaction
**And** yêu cầu pending gửi email cho người duyệt qua outbox; reminder sweep nhắc yêu cầu quá X giờ chưa xử (system_config)

### Story 6.2: Quản trị whitelist và danh sách cần duyệt

As a SA,
I want gán cho từng member: nhóm đối tượng nào xem thẳng, nhóm nào phải xin,
So that quyền truy cập secret đúng người đúng việc, đặt một lần là chạy.

**Acceptance Criteria:**

**Given** bảng access_list (chủ: vault) dạng phẳng — member × nhóm đối tượng (nhóm thiết bị theo site/loại HOẶC nhóm phần mềm) × tầng (whitelist / cần duyệt)
**When** SA/Admin gán hoặc gỡ
**Then** thay đổi ghi audit; màn quản trị hiển thị ma trận theo member, lọc theo site
**And** đối tượng không thuộc tầng nào với member đó = tầng cấm mặc định (không xin được)

### Story 6.3: Break-glass — xin, duyệt, xem theo thời hạn

As a Member,
I want lấy được mật khẩu thiết bị đúng lúc sự cố theo đúng tầng quyền của mình,
So that dập lửa nhanh mà mọi truy cập vẫn nằm trong kiểm soát.

**Acceptance Criteria:**

**Given** member mở danh sách đối tượng trong quyền của mình
**When** đối tượng thuộc WHITELIST và member bấm xem + nhập TOTP
**Then** secret hiện theo đúng cơ chế Story 4.2 (ẩn 30s, grace 10', audit từng lần)

**Given** đối tượng thuộc tầng CẦN DUYỆT
**When** member gửi yêu cầu (lý do + thời hạn, trần theo system_config mặc định 24h)
**Then** Admin/SA nhận email, duyệt/từ chối (chỉnh được thời hạn khi duyệt); grant có expires_at; member xem secret khi và chỉ khi `expires_at > now()` — kiểm tại MỖI lần đọc (AD-6), hết giờ tự cắt không cần ai đóng
**And** trang duyệt của Admin pass 390px (duyệt được trên điện thoại — UX-DR2)
**And** nhật ký break-glass đầy đủ (ai xin, lý do, ai duyệt, xem lúc nào) lưu bảng access_grant + history, sẵn cho dashboard (FR-025)

## Epic 7: Dashboard sếp

Sếp 3 phút sáng thứ Hai tự trả lời mọi câu hỏi.

### Story 7.1: Dashboard theo vai

As a Admin (sếp),
I want mở trang chủ thấy ngay 3 khối: sắp hết hạn, sự cố tuần, break-glass tuần,
So that 3 phút trước giờ họp là nắm được tình hình.

**Acceptance Criteria:**

**Given** Admin/sếp đăng nhập
**When** mở trang chủ
**Then** thấy 3 khối: (1) sắp hết hạn (từ expiry.api) (2) sự cố tuần qua (từ incidents.api — hiển thị "chưa có dữ liệu" gọn gàng khi Epic 9 chưa deploy) (3) break-glass tuần qua: ai, thiết bị gì, lý do (từ vault.api)
**And** mọi số liệu qua public api các module (AD-2), không SQL chéo; trang pass 390px; Member thấy dashboard rút gọn theo vai (không có khối break-glass toàn cục)

### Story 7.2: Export xlsx mọi bảng

As a Admin (sếp),
I want tự bấm export ở bất kỳ bảng nào đang xem,
So that cần số liệu cho cấp trên không phải nhờ ai.

**Acceptance Criteria:**

**Given** pattern export từ Story 2.6
**When** bấm Export trên bất kỳ màn danh sách nào (thiết bị, phần mềm, IP, NAT, expiry, nhật ký break-glass)
**Then** file xlsx tải về tôn trọng filter hiện tại, cột đúng như đang hiển thị; hành động export ghi audit
**And** KHÔNG có export nào chứa secret/plaintext (FR-026 giữ nguyên hiệu lực)

## Epic 8: Phiếu ISO định kỳ

5 phiếu nhóm A sinh kỳ tự động, tick từng ngày trên máy, in ký tay y hệt ISO.

### Story 8.1: Template phiếu và sinh kỳ tự động

As a Member,
I want hệ thống tự sinh kỳ phiếu theo chu kỳ (ngày/tháng/đợt),
So that không ai phải nhớ "tháng này đến hạn phiếu nào".

**Acceptance Criteria:**

**Given** module sheets sở hữu sheet_template (5 phiếu nhóm A: 0203, 0204, 0205×5 bộ phận, 0208, 0213) + sheet_period; seed template là migration (AD-10)
**When** sweep worker chạy đầu chu kỳ
**Then** kỳ mới sinh tự động cho từng template theo chu kỳ khai báo (0203 theo tháng-grid-ngày, 0205/0208 theo tháng, 0213 theo đợt tạo tay)
**And** field autofill (tên job backup, tên server, danh mục) SNAPSHOT tại thời điểm sinh kỳ (AD-14/AR-8) — dữ liệu sống đổi sau đó không làm phiếu đã sinh thay đổi

### Story 8.2: Điền phiếu dạng grid tick ngày

As a Member,
I want tick kết quả từng ngày cho từng job trên phiếu 0203/0208,
So that việc theo dõi hằng ngày làm trong 30 giây trên máy thay vì tô giấy.

**Acceptance Criteria:**

**Given** kỳ phiếu 0203 (job backup × ngày trong tháng) hoặc 0208 (máy theo bộ phận × ngày)
**When** member tick ✓/✗ vào ô ngày và ghi note khi ✗
**Then** mỗi lần tick lưu ngay (autosave), ghi audit; ô của ngày tương lai bị khóa; màn grid là desktop-only (UX-DR2)
**And** phiếu hiển thị tiến độ kỳ (bao nhiêu ngày đã tick)

### Story 8.3: Phiếu kiểm tra định kỳ dạng checklist

As a Member,
I want điền phiếu kiểm tra 0204/0205 (checklist hợp lệ/không hợp lệ) và 0213 (update firmware) trên máy,
So that mọi phiếu nhóm A đều số hóa cùng một nếp.

**Acceptance Criteria:**

**Given** kỳ phiếu 0204/0205 với các mục kiểm tra theo đúng template gốc (song ngữ vi/zh giữ nguyên)
**When** member điền kết quả từng mục (hợp lệ/không hợp lệ + ghi chú)
**Then** phiếu lưu theo kỳ + bộ phận; mục "không hợp lệ" bắt buộc ghi chú
**And** phiếu 0213 tạo theo đợt: chọn thiết bị từ kho (devices.api), version hiện tại → version đích, downtime, kế hoạch backup/rollback — đúng các trường mẫu gốc

### Story 8.4: In đúng layout ISO, khóa kỳ, lưu theo năm

As a Member,
I want in phiếu ra giấy giống hệt mẫu ISO để ký tay,
So that auditor nhìn bản in không phân biệt được với phiếu giấy cũ.

**Acceptance Criteria:**

**Given** kỳ phiếu đã điền xong
**When** bấm In
**Then** bản in (@media print) tái tạo đúng layout mẫu ISO từng phiếu — mã phiếu, bảng, ô ký Reported/Approved, song ngữ đúng mẫu (UX-DR4); xuất được cả xlsx (exceljs)
**And** khi member đánh dấu "chốt kỳ": phiếu khóa không sửa được nữa (chỉ SA mở lại, ghi audit); phiếu cũ tra cứu theo năm/tháng/loại (FR-031)
**And** danh sách kỳ hiển thị trạng thái (đang điền / đã chốt / trễ)

## Epic 9: Sự cố, Phiếu sự kiện & Documents

Sự cố có hồ sơ gắn thiết bị; phiếu nhóm B chạy qua approvals; runbook có nhà.

### Story 9.1: Phiếu sự cố 0206 động theo loại

As a Member,
I want ghi nhận sự cố bằng form 0206 đúng mẫu ISO, động theo loại sự cố,
So that ghi 2 phút xong mà vẫn đủ chuẩn audit.

**Acceptance Criteria:**

**Given** form 0206: Date, Type (Backup/Server/Network/Database/Other), Detection/Resolution time, Severity (Low/Med/High), Description, Corrective Action, Status (Temp fix/Resolved/In progress)
**When** chọn Type
**Then** section chi tiết của Type đó hiện ra (Backup → Job/Full-Incr-Copy/DB-App-FileSV/Storage/Error; Network/Server → chọn thiết bị liên quan từ kho qua devices.api)
**And** sự cố lưu thành incident (chủ: incidents) gắn thiết bị; trang thiết bị hiển thị lịch sử sự cố + cách đã sửa (FR-032); màn tạo phiếu pass 390px

### Story 9.2: Nâng cấp RCA 0207 và luồng ký duyệt

As a Admin,
I want sự cố nặng được nâng cấp thành RCA 0207 và mọi phiếu chạy Reported→Approved,
So that sự cố lớn có phân tích gốc rễ và chữ ký đúng quy trình.

**Acceptance Criteria:**

**Given** incident Severity=High hoặc Admin chọn nâng cấp
**When** tạo RCA 0207 từ incident
**Then** RCA giữ cùng mã sự cố, form đúng mẫu (Summary, Team, Problem Definition IS/IS-NOT, Timeline)
**And** luồng Reported By → Reviewed & Approved chạy qua approvals (Story 6.1) — trạng thái trên hệ thống, bản in có ô ký tay (FR-033); phiếu đã duyệt khóa nội dung

### Story 9.3: Phiếu sự kiện 0209, 0210, 0214

As a Member,
I want tạo phiếu file-server-access, remote-access và sửa chữa đúng mẫu khi có việc,
So that toàn bộ phiếu nhóm B nằm trên hệ thống cùng một nếp.

**Acceptance Criteria:**

**Given** template 0209 (New/Revoke/Modify + mức quyền), 0210 (Internal/External + hệ thống + thời hạn truy cập), 0214 (phân loại sự cố mạng/thiết bị, song ngữ vi/zh, trạng thái chờ-bảo-hành)
**When** member tạo phiếu và điền
**Then** phiếu chạy luồng duyệt qua approvals; 0214 link được thiết bị liên quan; in đúng layout mẫu để ký tay
**And** phiếu lưu theo năm, tra cứu theo loại/tháng như phiếu nhóm A

### Story 9.4: Documents — runbook có nhà

As a Member,
I want sidebar Documents chứa runbook/WI-IT/quy định, link 2 chiều với thiết bị và phần mềm,
So that tri thức xử lý sự cố nằm cạnh đúng thiết bị cần nó.

**Acceptance Criteria:**

**Given** module documents (soạn thảo markdown/richtext đơn giản + đính kèm file)
**When** tạo tài liệu và gắn thiết bị/phần mềm liên quan
**Then** trang thiết bị hiển thị tài liệu liên quan và ngược lại (link 2 chiều, qua public api)
**And** khi nội dung chứa chuỗi giống mật khẩu/secret, hệ thống hiển thị cảnh báo nhắc chuyển vào vault (mức nhắc, không chặn — FR-035); tài liệu có lịch sử phiên bản đơn giản (ai sửa, khi nào)

## Epic 10: Sơ đồ mạng (thay Visio)

Bỏ Visio: sơ đồ là lớp nhìn của dữ liệu kho cộng lớp vẽ tự do. Trình vẽ là **draw.io tự host** nhúng trong IMS (Q-23, chốt 02/10/2026 sau khi xem mẫu khung vẽ tự viết); IMS bọc ngoài cây bản vẽ, mã 2 lớp phạm vi sơ đồ, phiên bản + duyệt, nhật ký, gắn dữ liệu kho và cảnh báo lệch kho. Làm trước Epic 8–9. Nguồn: `docs/QUYET-DINH.md` Q-23 (thắng khi lệch), PRD F9 + NFR-07, ARCHITECTURE-SPINE AD-17/AD-18, `_bmad-output/brainstorming/brainstorm-so-do-mang-2026-10-02/brainstorm-intent.md`.

**Đổi gì so với kế hoạch khung vẽ tự viết (React Flow):**
- **Dễ hơn / có sẵn:** đi dây góc vuông, điểm uốn, bó dây; thư viện hình Cisco / network / rack; lớp, nhóm, căn lề, hoàn tác, tìm trong trình vẽ; "Xếp gọn" và "Tự xếp" thành bố cục sẵn có của draw.io (Arrange → Layout) — không viết thuật toán; mặt tủ dùng thư viện rack; "ghim cổng trên ảnh mặt sau" thành điểm nối đặt tự do trên hình ảnh.
- **Khó hơn / việc mới:** giao thức embed không báo "đang chọn ô nào" hay "vừa nối dây" — cầu nối so XML hai lần `autosave` liên tiếp để phát hiện dây mới/dây bị xoá, mọi thao tác gắn dữ liệu đi qua thanh IMS phía trên trình vẽ và hộp/hộp tìm của IMS, đẩy hình vào bằng `merge`; bấm thiết bị, tô sáng, bay tới, so sánh tô màu làm trong **trình xem SVG của IMS**, không trong trình vẽ; bình luận ghim do IMS tự làm (draw.io tự host không có); bảo mật nhúng (sandbox, kiểm nguồn postMessage, làm sạch XML/SVG) là phần mới; xuất PDF có chân trang cần server ghép; E2E phải lái iframe (chậm) nên E2E trình vẽ giữ mức khói, logic dồn về hàm thuần phía server.
- **Đổi quyết định:** lưu/phát hành bản vẽ **không ghi sơ đồ cổng** (AD-18, Q-23 02/10/2026). Bổ sung 03/10/2026 — **"vẽ là khai, có hỏi"**: kéo dây giữa hai máy kho thì IMS hỏi có khai vào sơ đồ cổng không; "Khai" thì **web** gọi endpoint của `devices` ghi ngay, "Chỉ vẽ" để nét đồ hoạ cảnh báo vàng; nút "Khai kết nối" / "Nối hàng loạt" (hộp sơ đồ cổng dùng chung) vẫn giữ. `diagrams` vẫn không ghi `device_port`.
- **Sau bản thử (03/10/2026):** bố cục màn theo góp ý chủ dự án (sidebar tự thu, trình vẽ chiếm phần còn lại, thanh mảnh phía trên, "Thiết bị kho" là hộp tìm gọn); mã đăng nhập không mở két hay sơ đồ; draw.io chuyển từ container `drawio` tạm sang tệp tĩnh trong `web`. Code bản thử (`diagrams-spike`, bảng `diagram_spike` của migration 0043) bị thay trong Story 10.2–10.3.
- **Bỏ:** `DiagramCanvas` / `@xyflow/react` / `html-to-image`; lưu nội dung dạng `content jsonb`; dây đề xuất trong bản nháp chờ phát hành mới ghi kho.

**Luật chung cho mọi story của epic (khỏi nhắc lại từng story):**
- Module mới `diagrams` (tầng nghiệp vụ) là chủ duy nhất `diagram`, `diagram_version`, `diagram_version_label`, `diagram_history`, `diagram_comment` (AD-3, AD-18). Đọc kho CHỈ qua `devices.api`, `ipam.api`, `catalog.api`, `files.api`; duyệt qua `approvals.api` (AD-2, AD-6). `diagrams` **không gọi `vault`** và **không ghi `device_port`** — mọi ghi sơ đồ cổng từ màn sơ đồ là web gọi endpoint của `devices` sau một xác nhận tường minh trong hộp IMS (AD-18). Không module nào import `diagrams`.
- Mọi endpoint ghi: `@Audited` + `@Roles` + `tx` tường minh, nghiệp vụ + audit + outbox cùng transaction (AD-5, AD-9). Route đọc NỘI DUNG bản vẽ khai `@RequiresStepUp('diagram')` và ghi audit `diagram.viewed`; route SỬA một bản vẽ có sẵn (lưu phiên bản, đặt tên, khôi phục, nhịp "đang sửa") cũng khai `@RequiresStepUp('diagram')` (chủ dự án chốt: xem VÀ sửa đều hỏi mã); cây (tạo nút, đổi tên, lưu trữ) thì không; route còn lại khai `@NoStepUp()` rõ ràng.
- Bảng phiên bản/lịch sử chỉ-thêm: trigger `history_append_only` + `REVOKE UPDATE, DELETE, TRUNCATE ... FROM ims_app` và `FROM CURRENT_USER` ngay trong file tạo bảng, thêm vào `api/test/app-role-privileges.spec.ts`. Migration mới đánh số tiếp sau file cuối đang có, không sửa file cũ (AD-10).
- XML/SVG bản vẽ là dữ liệu không tin cậy: chỉ vào kho qua cổng kiểm của server, chỉ hiện qua trình xem SVG đã làm sạch hoặc trình vẽ trong iframe sandbox (AD-17). Hợp đồng thuộc tính ô `ims_*`, XML "khô" + hydrate/dehydrate theo AD-18.
- Tham số nghiệp vụ vào `system_config` có mặc định + khai `EDITABLE_SETTINGS` (AD-11).
- Cầu nối trình vẽ `web/src/ui/drawio-frame`, trình xem `web/src/ui/diagram-viewer` và mọi khối dùng ở ≥2 màn khai `docs/SHARED-REGISTRY.md` trong story sinh ra nó (AD-15). Màu thiết bị/dây/khung/watermark chỉ qua token `tokens.css` có cặp `html[data-theme='dark']`, đọc lúc chạy — không hex trong mã nguồn.
- Bố cục màn sơ đồ (Q-23, 03/10/2026): sidebar tự thu còn biểu tượng khi vào màn; trình vẽ/trình xem chiếm toàn bộ phần còn lại; tab Sửa / Xem và nút của IMS nằm trên một thanh mảnh phía trên — KHÔNG có cột panel cố định; chức năng phụ (thiết bị kho, dây chưa khai, ghim, bản vẽ con, tủ…) mở dạng hộp tìm gọn / hộp thoại dùng chung từ thanh đó.
- Màn SỬA chỉ desktop (≥ 1024px); màn XEM pass 390px. Mọi hàng bài kiểm tạo ra mang chữ `E2E` trong tên bản vẽ; `api/scripts/reset-e2e.mjs` dọn được mọi bảng mới (bảng chỉ-thêm dọn bằng đường của role chủ sở hữu như các bảng lịch sử khác).

### Story 10.1: Step-up có phạm vi — két và sơ đồ

As a SA,
I want mã 2 lớp nhập cho sơ đồ và mã nhập cho két được tính riêng, mỗi bên một thời gian ân hạn,
So that mở sơ đồ không vô tình mở luôn két, và ngược lại (Q-23: nhập ở đâu tính ở đó).

**Acceptance Criteria:**

**Given** step-up hiện là một mốc chung `sessions.stepped_up_at`
**When** dev thêm phạm vi `diagram` (migration thêm `sessions.diagram_stepped_up_at timestamptz`, chủ `auth`) và khoá `diagram.stepup_grace_minutes` (mặc định 10, sửa được 1–60 trên màn Tham số hệ thống)
**Then** `@RequiresStepUp()` không tham số giữ nghĩa két (ân hạn `secret.stepup_grace_minutes`); `@RequiresStepUp('diagram')` chỉ đọc `diagram_stepped_up_at` với ân hạn `diagram.stepup_grace_minutes` (AD-17)
**And** `POST /auth/step-up` bắt buộc nhận `scope: 'vault' | 'diagram'` và chỉ đóng dấu cột của phạm vi đó; thiếu/sai `scope` → 400; audit step-up (thành công và thất bại) ghi kèm phạm vi
**And** bộ đếm gõ sai `stepup_failures` dùng CHUNG cho hai phạm vi — sai đủ `secret.stepup_max_failures` ở bên nào cũng thu hồi phiên
**And** mã 2 lớp lúc đăng nhập KHÔNG mở phạm vi nào: `completeTotpWithin` của đường đăng nhập thôi đóng dấu `stepped_up_at` (AD-17, Q-23 chủ dự án xác nhận 03/10/2026)

**Given** người dùng vừa đăng nhập bằng mật khẩu + mã 2 lớp (két đổi hành vi so với trước)
**When** bấm xem một secret lần đầu tiên trong phiên, hoặc mở nội dung một bản vẽ
**Then** hộp nhập mã hiện ra (phạm vi két / phạm vi sơ đồ tương ứng); không phạm vi nào được mở sẵn bởi mã đăng nhập
**And** bài kiểm đơn vị/`test:db`: ngay sau đăng nhập có TOTP, `stepped_up_at` và `diagram_stepped_up_at` đều `NULL`; đỏ khi gieo lại đột biến "đăng nhập đóng dấu `stepped_up_at`"
**And** E2E két: đăng nhập (có mã) → bấm xem secret → THẤY hộp hỏi mã (bài cũ đi thẳng tới giá trị phải sửa theo); nhập mã → hiện; trong ân hạn xem secret khác không hỏi lại
**And** E2E sơ đồ (vừa nhập mã cho két xong, mở bản vẽ vẫn hỏi mã phạm vi sơ đồ) làm ở Story 10.3 — story này chưa có route/màn nội dung bản vẽ thật; chiều đó được dựng lại ở `api/test/step-up-scope.spec.ts` bằng một route thử khai `@RequiresStepUp('diagram')` qua guard + `sessions` thật

**Given** phiên vừa nhập mã cho két (còn trong ân hạn két)
**When** gọi một route khai `@RequiresStepUp('diagram')`
**Then** 401 `STEPUP_REQUIRED` kèm `scope: 'diagram'` và `graceMinutes` của sơ đồ; chiều ngược lại (mới nhập cho sơ đồ, gọi route két) cũng 401 với `scope: 'vault'`
**And** bài kiểm guard dạng bảng dữ liệu (phạm vi × mốc × ân hạn) đỏ khi gieo đột biến "đọc nhầm cột"; `step-up-surface.spec.ts` biết phạm vi mới; `test:db` `step-up-scope.spec.ts` dựng lại đúng đòn: phiên chỉ có ân hạn két gọi route khai `@RequiresStepUp('diagram')` → bị chặn (và ngược lại); E2E `security.spec.ts` dựng lại chiều có route thật: mã đăng nhập không mở két, phiên chỉ có ân hạn sơ đồ gọi thẳng API két → 401 `scope: 'vault'` (chiều gọi API nội dung sơ đồ thêm vào `security.spec.ts` ở Story 10.3)

**Given** web gặp `STEPUP_REQUIRED`
**When** `StepUpDialog` / `StepUpStep` / `useStepUpRetry` mở hộp nhập mã
**Then** hộp nhận prop `scope` và gửi đúng phạm vi server trả về; câu chữ nói rõ "xem sơ đồ" hay "mở két" qua `lib/i18n`; hết ân hạn thì hỏi lại TẠI CHỖ, không đá người dùng ra ngoài
**And** `docs/SHARED-REGISTRY.md` cập nhật dòng `@RequiresStepUp`, `StepUpDialog`, `useStepUpRetry` (thêm phạm vi, khi nào dùng phạm vi nào)

### Story 10.2: Trình vẽ draw.io tự host và cầu nối nhúng

As a SA,
I want trình vẽ draw.io chạy trong mạng nội bộ ở một phiên bản ghim cứng, nhúng vào IMS qua một cầu nối duy nhất đã khoá bảo mật,
So that có trình vẽ mạng chuyên nghiệp mà không mở đường ra Internet hay cửa XSS vào IMS.

**Acceptance Criteria:**

**Given** `web/Dockerfile` có một stage nguồn `jgraph/drawio` ghim đúng tag + digest đang khoá ở bản thử, chép thư mục webapp tĩnh của draw.io vào cây tệp nginx của image `web`; service `drawio` (Tomcat) của bản thử bị gỡ khỏi `docker-compose.yml` (Q-23, 03/10/2026)
**When** dựng compose dev và prod
**Then** `https://<host>/drawio/` trả trình vẽ từ nginx của `web`; compose KHÔNG còn service `drawio`, không thêm cổng; các đường servlet cũ (`/drawio/proxy`, `/drawio/export`, `/drawio/log`, `service-worker.js`) trả 404; location `/drawio/` chỉ GET/HEAD (phương thức khác 403) tệp có đuôi biết trước, trang HTML duy nhất là `index.html`
**And** stage draw.io của image `web` dựng được KHÔNG cần Internet khi đã có sẵn image nguồn đúng digest (`docker save`/`load` như RUNBOOK; phần `npm ci` của `web` cần mạng như trước — máy không mạng thì mang cả image `ims-web` sang); RUNBOOK mục draw.io viết lại: phiên bản đang khoá nằm ở `web/Dockerfile`, nâng cấp = rà 1–2 lần/năm hoặc khi có cảnh báo bảo mật, đổi tag + digest → dựng lại `web` → chạy E2E sơ đồ → giữ tag cũ để lùi; bỏ mọi chỉ dẫn về container `drawio`
**And** mở màn sửa: E2E bắt mọi request, khẳng định không request nào ra ngoài host IMS (thay bài "container không ra được Internet" của kiểu container)
**And** header của location `/drawio/`: CSP riêng (`connect-src 'self'`, `img-src 'self' data: blob:`, `frame-ancestors 'self'`, không host ngoài); app IMS thêm `frame-src 'self'` và giữ `frame-ancestors 'none'` cho chính nó (AD-17)

**Given** component dùng chung `web/src/ui/drawio-frame` (khai `SHARED-REGISTRY.md`)
**When** một màn mở trình vẽ với XML đầu vào
**Then** iframe trỏ `/drawio/?embed=1&proto=json&offline=1&stealth=1&plugins=0&pages=0&configure=1&lang=vi` với `sandbox="allow-scripts"` (không `allow-same-origin`); cầu nối trả sự kiện có kiểu (`init`, `autosave`, `save`, `export`, `exit`; thêm `load`, `openLink`, `getDiff`, `patch` cho màn bản thử) và lệnh (`load`, `merge`, `export`, `configure`; thêm `patch`, `getDiff`, `save` để chèn một hình không đụng phần chưa lưu) — không màn nào tự `postMessage` với trình vẽ
**And** cầu nối bỏ qua mọi tin có `event.source` khác `iframe.contentWindow` hoặc sai hình dạng giao thức (test đơn vị: tin giả từ cửa sổ khác bị bỏ qua và không gọi callback)
**And** sự kiện `configure` đẩy cấu hình: tắt mọi nguồn đám mây/thư viện ngoài, `compressXml: false`, bảng màu dây đọc từ token lúc chạy; không nhận `init` trong `diagram.editor_init_timeout_seconds` (mặc định 20) → màn báo "Trình vẽ chưa sẵn sàng" kèm nút thử lại, không treo
**And** watermark "tên người xem · email · giờ phút" phủ lên iframe (lớp `pointer-events: none`, token màu có cặp dark), không tắt được bằng giao diện

**Given** người dùng vào màn sơ đồ trên desktop (bố cục theo góp ý bản thử — Q-23, 03/10/2026)
**When** màn mở
**Then** sidebar của shell tự thu còn biểu tượng (rời màn sang menu khác thì sidebar mở rộng lại như bình thường — Q-23 03/10); trình vẽ/trình xem chiếm toàn bộ phần còn lại của màn hình; tab **Sửa / Xem** và các nút của IMS nằm trên MỘT thanh mảnh phía trên trình vẽ; không có cột panel cố định
**And** thu sidebar làm bằng prop/trạng thái của shell dùng chung (khai `SHARED-REGISTRY.md`), không tự dựng sidebar riêng trong `features/` (AD-15, UX-DR1)
**And** E2E (desktop): sau khi mở màn, sidebar ở dạng thu gọn, iframe trình vẽ rộng bằng phần còn lại của khung (không có cột bên cạnh), thanh trên có tab Sửa/Xem (`getByRole('tab')`)

**Given** bản thử 02/10/2026 đã chạy được draw.io embed ở origin mờ, nhưng đang bật thêm `allow-downloads allow-modals` trên sandbox (cả thẻ iframe lẫn CSP `sandbox` của `/drawio/`)
**When** story đóng
**Then** mỗi cờ thêm hoặc bị bỏ (E2E sơ đồ vẫn xanh), hoặc được ghi vào ARCHITECTURE-SPINE AD-17 kèm lý do; AD-17 ghi kết quả; nếu KHÔNG chạy được thì chuyển sang origin riêng `drawio.ims.pmh.com.vn` (cùng cert, cùng nginx) và kiểm `event.origin` đúng origin đó — **không** thêm `allow-same-origin`

**Given** cổng kiểm XML/SVG phía server (hàm thuần trong `diagrams`, test bảng dữ liệu)
**When** đưa vào XML có `<script>`, `onerror=`, `javascript:`, `<!DOCTYPE`/thực thể ngoài, thuộc tính `link`, ảnh trỏ URL ngoài, nhiều trang, XML nén, vượt `diagram.xml_max_kb` (mặc định 2048) hoặc `diagram.max_cells` (mặc định 5000)
**Then** từ chối kèm lý do tiếng Việt; nhãn HTML lọc theo allowlist thẻ định dạng; SVG làm sạch bỏ script, `on*`, `foreignObject` (hoặc allowlist XHTML hẹp nếu spike chứng minh nhãn không xuất được dạng text — ghi vào AD-17), `href` ra ngoài
**And** E2E dựng lại đúng đòn: bản vẽ chứa nhãn `<img src=x onerror=…>` gửi thẳng qua API bị từ chối; bài kiểm đỏ khi gỡ bộ lọc; E2E bắt mọi request của trang sửa sơ đồ, khẳng định không request nào ra ngoài host IMS

### Story 10.3: Cây bản vẽ, lưu phiên bản, lịch sử và nhật ký mở

As a Thành viên,
I want tạo bản vẽ trong cây công ty → site → tầng → phòng → tủ, vẽ trong draw.io, mỗi lần lưu thành một phiên bản có tóm tắt, đặt tên và khôi phục được,
So that sơ đồ mạng có nhà trong IMS thay file Visio rải rác, và 1–2 năm sau vẫn xem lại đúng bản lúc đó.

**Acceptance Criteria:**

**Given** module `diagrams` với `diagram` (id, `parent_id`, tên, loại nút: `company`/`site`/`floor`/`room`/`cabinet`/`other`, `site_id?`, `cabinet_id?`, người phụ trách (`owner_email`, API nhận; form chưa có ô — thêm khi cần), `kind` = `official`/`presentation`, `official_version_id?` (cờ "chính thức" nằm ở cây vì phiên bản không UPDATE được — Story 10.7 đổi cột này), `archived_at?`), `diagram_version` chỉ-thêm (id, `diagram_id`, số thứ tự, `xml text`, `svg text`, `cell_index jsonb`, `device_snapshot jsonb`, `summary` + `summary_detail`, `based_on_version_id`, `restored_from_version_id`, người lưu, lúc lưu), `diagram_version_label` và `diagram_history` chỉ-thêm, cộng `diagram_presence` (nhịp "đang mở sửa", bảng thường) — migration `0046_diagram.sql`
**When** migration chạy trên DB trắng
**Then** ba bảng chỉ-thêm không UPDATE/DELETE/TRUNCATE được bằng `ims_app` (có trong `app-role-privileges.spec.ts`); tầng/phòng chỉ là tên bản vẽ — KHÔNG thêm danh mục vị trí (Q-23); `site_id`/`cabinet_id` kiểm qua `catalog.api` (mục ngừng dùng không chọn mới được, Q-14)

**Given** người dùng bất kỳ vai
**When** mở màn "Sơ đồ mạng" (menu nhóm Mạng, thay mục "Sơ đồ mạng (thử)")
**Then** thấy cây dạng thư mục: CHỈ tên + loại + trạng thái (chưa vẽ / bản nháp / chính thức / chính thức · có bản nháp; "chờ duyệt" thêm ở Story 10.7, "lệch kho" ở Story 10.9), không ảnh thu nhỏ, không cần mã 2 lớp
**And** mọi vai tạo được bản vẽ con và vẽ; đổi tên, chuyển nhánh, lưu trữ chỉ Admin/SA (`@Roles`), Thành viên gọi API → 403; không có xoá cứng

**Given** bản thử để lại bảng `diagram_spike` (migration `0043_diagram_spike.sql`), API/màn `/diagrams-spike` và E2E `diagrams-spike.spec.ts`
**When** story này thêm bảng thật
**Then** bằng một migration MỚI đánh số tiếp sau file cuối đang có — `0043` KHÔNG bị sửa, kể cả chú thích (checksum) — tạo các bảng ở trên và `DROP TABLE diagram_spike` (bản vẽ thử không chuyển sang; bản thử chỉ để xem draw.io chạy — Q-23)
**And** gỡ code bản thử (controller/service/schema `diagram-spike`, route và mục menu "Sơ đồ mạng (thử)", `reset-e2e.mjs` dòng `diagram_spike`, E2E bản thử thay bằng E2E của story); migration chạy sạch trên DB trắng và trên DB đã áp `0043` (`test:db`)

**Given** người dùng mở NỘI DUNG một bản vẽ (xem hoặc sửa, bất kỳ phiên bản)
**When** chưa trong ân hạn sơ đồ
**Then** hộp mã 2 lớp phạm vi sơ đồ hiện (Story 10.1); trong ân hạn thì chuyển giữa các bản vẽ không hỏi lại
**And** LƯU cũng đòi mã phạm vi sơ đồ: ân hạn hết giữa lúc vẽ thì bấm Lưu → hộp hỏi mã tại chỗ → nhập xong lưu lại đúng XML đang giữ trong bộ nhớ (không xin trình vẽ xuất lại, không mất nét) — vitest `diagram-screens.test.tsx` + E2E `diagrams.spec.ts`
**And** E2E (chuyển từ Story 10.1): vừa nhập mã cho két xong, mở bản vẽ vẫn hỏi mã phạm vi sơ đồ; `security.spec.ts` thêm đòn phiên chỉ có ân hạn két gọi thẳng API nội dung bản vẽ → 401 `scope: 'diagram'`
**And** MỖI lần tải nội dung ghi một dòng audit `diagram.viewed` (ai, bản vẽ, phiên bản, chế độ xem/sửa) — NFR-03
**And** chế độ xem dùng `web/src/ui/diagram-viewer` hiện SVG đã làm sạch (không nạp draw.io), có watermark như Story 10.2, zoom/pan; chế độ sửa dùng `drawio-frame`; màn sửa ở bề ngang < 1024px hiện "Sửa sơ đồ chỉ làm trên máy tính" kèm lối sang chế độ xem

**Given** người vẽ bấm Lưu trong trình vẽ
**When** cầu nối nhận `save`, xin trình vẽ xuất SVG rồi gửi XML + SVG lên server
**Then** server chạy cổng kiểm (Story 10.2) + soi chữ từng hình trông như mật khẩu (`textLooksLikeSecret`, Q-19), dựng `cell_index`, chụp `device_snapshot` (mã, tên, loại, model, serial, IP, site, tủ, U — `null` tới Story 10.11, trạng thái của mọi `ims_device_id`; id không còn trong kho ghi `missing`). Dehydrate (AD-18) bắt đầu ở Story 10.4 — story này chưa hydrate gì nên XML lưu nguyên như trình vẽ gửi và tạo MỘT hàng `diagram_version` + `diagram_history` + audit trong cùng transaction; bản lưu sau thắng (Q-23)
**And** tóm tắt MỘT dòng so với phiên bản trước tính phía server từ `cell_index` ("Thêm 3 thiết bị, bỏ 1, đổi 37 dây, 5 hình tự do"); bấm xem chi tiết nhóm theo loại — hàm thuần dùng chung với so sánh (Story 10.10) và tự kiểm (Story 10.7), test bảng dữ liệu
**And** lịch sử hiển thị bằng `HistoryPanel` trục dọc (Q-20), đọc `diagram_history` (AD-13), không đọc `audit_log`
**And** rời màn khi còn thay đổi chưa lưu thì hỏi qua bộ hỏi dùng chung (không `window.confirm`)

**Given** Nguyễn A đang mở sửa bản vẽ
**When** người thứ hai mở cùng bản vẽ ở chế độ sửa
**Then** thấy "Đang có Nguyễn A mở sửa bản vẽ này" (nhịp có mặt `diagram.presence_ttl_seconds`, mặc định 60); người thứ hai vẫn lưu được, tóm tắt ghi "lưu đè lên bản của Nguyễn A" khi `based_on_version_id` khác bản mới nhất

**Given** một phiên bản quan trọng
**When** người vẽ hoặc Admin đặt tên ("Sau khi thay core 2026")
**Then** tên ghi một hàng `diagram_version_label` (tên mới nhất thắng) — `diagram_version` không bị UPDATE; danh sách phiên bản lọc được "chỉ phiên bản có tên"

**Given** Admin/SA bấm "Khôi phục phiên bản này"
**When** xác nhận qua `useConfirm`
**Then** tạo một phiên bản MỚI chép XML của bản được chọn (không xoá gì); Thành viên không có nút, gọi API → 403
**And** bản vẽ 300 hình + 600 dây: API trả nội dung < 1 giây, trình xem hiện xong < 3 giây trên máy dev (NFR-05, NFR-07)

### Story 10.4: Panel "Thiết bị kho" — hình theo loại, thẻ thông tin, Mở két

As a Thành viên,
I want chèn thiết bị có sẵn trong kho vào bản vẽ bằng một hộp tìm gọn mở từ thanh phía trên trình vẽ, hiện đúng hình theo loại, và ở chế độ xem bấm vào thấy đủ thông tin,
So that không gõ lại tên/IP/model và bản vẽ luôn trỏ đúng hồ sơ thật.

**Acceptance Criteria:**

**Given** `device_type` thêm `diagram_shape` (chọn từ danh sách hình draw.io có sẵn mà IMS cho phép, vd `mxgraph.cisco.switches.workgroup_switch`; CHECK giữ dạng tên stencil) và bảng `device_type_icon` (SVG riêng ĐÃ LỌC, cất dạng chữ — không qua `files`: tệp `files` nằm trên volume phải đọc lại từ đĩa mỗi lần mở bản vẽ, còn biểu tượng nhỏ và cần đi cùng một câu SELECT; bảng riêng để danh sách danh mục không kéo SVG theo) — migration `0047`, chủ `catalog`; loại có sẵn từ đầu được gán hình hợp tên
**When** người sửa được danh mục (Q-12) chọn hình cho một loại ở màn Danh mục loại thiết bị, hoặc SA tải SVG riêng
**Then** loại chưa chọn gì dùng hình "Thiết bị khác"; không có ô nhập style tự do (chặn chèn `image=` ra ngoài); chỉ SA tải SVG, vai khác gọi API → 403
**And** SVG tải lên lọc phía server (`common/svg-sanitize.ts`, dùng chung với cổng bản vẽ): `<script>`, `on*`, `href`/`url()` ra ngoài, `javascript:`, DOCTYPE/thực thể ngoài → TỪ CHỐI cả tệp kèm lý do; `<foreignObject>`, `<style>`, metadata bị gỡ; quá `diagram.icon_svg_max_kb` (mặc định 100) hoặc không hợp lệ → từ chối; bài kiểm dựng lại SVG có script đỏ khi gỡ bộ lọc

**Given** trình vẽ đang mở
**When** người vẽ bấm nút **"Thiết bị kho"** trên thanh IMS phía trên trình vẽ — mở một hộp tìm gọn (popover neo vào nút, KHÔNG chiếm cột cố định, đóng bằng Esc/bấm ra ngoài, không che toàn trình vẽ — Q-23 góp ý bản thử 03/10/2026) — tìm thiết bị (theo mã/tên/IP, lọc site/tủ/loại — dùng lại `DeviceCombobox`/popover dùng chung sẵn có, thiếu thì thêm vào `web/src/ui` và khai registry) và bấm Chèn (một hoặc nhiều máy)
**Then** cầu nối gửi `patch` (không `merge`: `merge` so cả tệp với mốc draw.io đang giữ nên xoá được phần người vẽ chưa lưu — kết quả bản thử) chèn `UserObject` mang `ims_device_id` + `ims_device_code`, nhãn "mã · IP · Site · Tủ · U" (tên máy ở thẻ thông tin), hình theo loại (stencil draw.io; SVG riêng thành data URI) — ô chèn do server dựng (`GET /diagrams/device-info?ids=`, một lượt cho cả lô, cùng luật hydrate); máy đã thanh lý hiện nhưng không chèn được (kèm lý do); máy đã có trên bản vẽ (đọc từ XML `autosave`/`getDiff` + máy vừa chèn) hiện "đã có" thay vì chèn lần hai
**And** đổi hình của một loại ở Danh mục thì lần mở SỬA sau mọi bản vẽ hiện hình mới (XML lưu "khô" — AD-18: lưu gỡ hình/nhãn IMS, mở sửa hydrate lại từ kho); ảnh xem (chế độ Xem) là SVG chụp lúc lưu nên đổi theo từ lần lưu kế tiếp

**Given** chế độ xem
**When** bấm một thiết bị
**Then** thẻ thông tin hiện mã, tên, loại, model, serial, IP (qua `ipam.api`), site/tủ/U (U `null` tới Story 10.11), NCC + hotline, bảo hành bằng `ExpiryBadge`, "Có mặt trong các bản vẽ" (bấm nhảy sang — `GET /diagrams/by-device/:id`, phiên bản mới nhất, bỏ bản đã lưu trữ); link "Mở hồ sơ"
**And** nút "Mở két" mở `VaultPanel` dùng chung (như popup Két tổng) cho máy đó: VẪN đòi mã phạm vi két (đang trong ân hạn sơ đồ không đủ), Thành viên theo 3 tầng quyền (Epic 6); thẻ không chứa giá trị két, `diagrams` không gọi `vault` (AD-4, AD-18)
**And** ô có `ims_device_id` không còn tồn tại hiện dấu đỏ "Không tìm thấy trong kho" thay vì lỗi trang
**And** tóm tắt phiên bản đếm thiết bị theo `ims_device_id` (xoá ô rồi chèn lại đúng máy, hay nhân bản ô của một máy, không là "thêm thiết bị")
**And** E2E (`diagrams-stock.spec.ts`): bấm "Thiết bị kho" → hộp tìm gọn hiện, trình vẽ vẫn rộng như trước (không có cột chen vào); tìm + bàn phím chèn một thiết bị `E2E`, hộp đóng, lưu (kho giữ XML khô), mở chế độ xem, bấm thấy thẻ đúng (desktop + 390px); Mở két hỏi mã phạm vi két; đường hỏng: tìm máy đã thanh lý → hiện nhưng ô chọn tắt kèm lý do; ô trỏ máy không còn trong kho → dấu đỏ; SVG có script bị từ chối, Thành viên tải biểu tượng → 403

### Story 10.5: Dây gắn sơ đồ cổng — loại dây, màu, tô sáng

As a Thành viên,
I want kéo dây giữa hai thiết bị kho là được hỏi có khai vào sơ đồ cổng không, màu dây theo loại dây, và bấm một thiết bị là thấy mọi dây của nó đi đâu,
So that vẽ xong là sơ đồ cổng cũng đúng mà không phải khai hai lần, nhưng không có kết nối nào lọt vào kho khi tôi chưa đồng ý (Q-23 "vẽ là khai, có hỏi", 03/10/2026).

**Acceptance Criteria:**

**Given** danh mục `cable_type` (chủ `catalog`: tên, ô màu `color_slot` 1..N, mô tả, `active`) seed đúng 3 loại chủ dự án chốt (Cat6, Fiber, DAC; SA thêm được — Q-23) — và cột `device_port.cable_type_id?` (chủ `devices`) — migration
**When** quản trị loại dây ở màn Danh mục
**Then** màu chọn từ bảng ô màu (token `--diagram-cable-1..N` có cặp dark), không có ô nhập hex; chú giải màu tự sinh từ danh mục; vô hiệu loại đang dùng → dây cũ giữ màu + "(ngừng dùng)", không chọn mới (Q-14)
**And** màu dây trên bản vẽ do IMS hydrate từ `ims_cable_type_id` theo theme hiện tại, không lấy `strokeColor` từ XML (AD-18)

**Given** cầu nối `drawio-frame` nhận hai lần `autosave` liên tiếp
**When** so hai XML (hàm thuần phía web, test bảng dữ liệu: thêm cạnh, xoá cạnh, kéo đầu cạnh sang ô khác, nhân bản cạnh, cạnh một đầu là hình tự do, hoàn tác)
**Then** trả đúng danh sách "cạnh mới có hai đầu là ô `ims_device_id` và chưa có `ims_link_id`" và "cạnh có `ims_link_id` vừa biến mất"; cạnh nối hình tự do hoặc nối một máy với chính nó KHÔNG sinh câu hỏi; nhân bản một cạnh đã có `ims_link_id` → bản sao bị bỏ `ims_link_id` và coi là cạnh mới (không để hai nét cùng một link)

**Given** người vẽ kéo một nét dây nối hai thiết bị kho (đường hạnh phúc)
**When** cầu nối phát hiện cạnh mới
**Then** IMS mở hộp dùng chung "Khai kết nối này vào sơ đồ cổng?" (không `window.confirm`): tên hai máy, ô chọn cổng hai đầu chỉ liệt kê **cổng còn trống** (đọc qua endpoint đọc của `devices`), ô chọn loại dây (mặc định loại dùng gần nhất), nút **"Khai"**, **"Chỉ vẽ"**
**And** bấm "Khai": **web** gọi endpoint ghi sơ đồ cổng của `devices` (`@Audited` + `@Roles` + `tx`, luật một cổng một cáp hai chiều không phân biệt hoa/thường — Q-20); thành công thì gắn `ims_link_id` + `ims_cable_type_id` vào nét bằng `merge`, nhãn cổng "Gi0/24 ↔ Te1/0/1" và màu hydrate ngay; trang thiết bị của hai máy thấy kết nối mới (E2E)
**And** module `diagrams` không có đường nào ghi `device_port` và không gọi endpoint ghi của `devices` (depcruise + bài kiểm bề mặt route: `diagrams` không có route ghi cổng); lưu/phát hành bản vẽ không ghi gì vào sơ đồ cổng (AD-18)

**Given** cổng đã chọn vừa bị người khác chiếm (hoặc người dùng không có quyền sửa sơ đồ cổng)
**When** bấm "Khai"
**Then** endpoint `devices` trả lỗi (409 cổng đã có cáp / 403) và hộp hiện lỗi đỏ tiếng Việt ngay trong hộp, danh sách cổng trống nạp lại; KHÔNG ghi gì, KHÔNG gắn `ims_link_id` vào nét; người dùng chọn cổng khác hoặc bấm "Chỉ vẽ"
**And** E2E đường hỏng: khai một kết nối vào cổng đã có cáp (dựng sẵn bằng API) → thấy lỗi trong hộp, sơ đồ cổng không đổi

**Given** người vẽ bấm "Chỉ vẽ" (hoặc đóng hộp)
**When** hộp đóng
**Then** nét ở lại trên bản vẽ không có `ims_link_id`, hiện dấu/viền **vàng** "Chưa khai vào sơ đồ cổng" (token có cặp dark); tự kiểm khi gửi duyệt/phát hành coi là cảnh báo vàng cho qua (Story 10.7); nút "Dây chưa khai" trên thanh trên liệt kê các nét này, bấm một nét mở lại đúng hộp khai, hoặc gắn vào một dòng sơ đồ cổng có sẵn giữa đúng hai máy

**Given** người vẽ xoá một nét đã có `ims_link_id`
**When** cầu nối phát hiện cạnh có link vừa biến mất
**Then** IMS hỏi bằng hộp dùng chung: **"Chỉ xoá nét vẽ"** (nút mặc định — Enter/đóng hộp chọn nó) / **"Gỡ luôn kết nối"**
**And** "Chỉ xoá nét vẽ" (và đóng hộp): KHÔNG gọi gì, kết nối trong sơ đồ cổng giữ nguyên (E2E: trang thiết bị vẫn thấy kết nối); "Gỡ luôn kết nối": web gọi endpoint gỡ của `devices` (`@Audited`), lỗi thì báo và không gỡ
**And** xoá nhiều nét một lần → một hộp liệt kê đủ các kết nối, cùng hai lựa chọn

**Given** bản vẽ được mở (chiều ngược lại — sơ đồ cổng đổi ngoài bản vẽ)
**When** IMS hydrate XML trước khi nạp vào trình vẽ / trình xem
**Then** nhãn cổng và màu dây đọc từ `device_port` hiện tại (đổi cổng / loại dây ở trang thiết bị hiện ngay, không cần sửa bản vẽ)
**And** nét có `ims_link_id` mà kết nối đã bị gỡ → nét chuyển **đỏ** + chú "Kết nối đã bị gỡ khỏi sơ đồ cổng" (không tự xoá nét); bấm nét ở chế độ sửa cho chọn xoá nét hoặc khai lại
**And** kết nối trong sơ đồ cổng giữa hai máy cùng có mặt trên bản vẽ mà chưa có nét → thanh trên hiện "Có N kết nối mới chưa vẽ" + nút **"Vẽ vào"**: chèn các nét bằng `merge`, đã gắn `ims_link_id` + `ims_cable_type_id`, không ghi gì vào kho; người vẽ tự đi dây/xếp bằng công cụ draw.io
**And** dữ liệu so (link còn/mất, kết nối mới) là bộ hàm thuần dùng chung với Story 10.9 (một bộ luật)
**And** E2E: gỡ kết nối ở trang thiết bị → mở bản vẽ thấy nét đỏ; thêm kết nối giữa hai máy `E2E` đã có trên bản vẽ → thấy "Có 1 kết nối mới chưa vẽ", bấm "Vẽ vào" → nét xuất hiện đúng nhãn cổng

**Given** cần khai kết nối không bắt đầu từ nét vẽ
**When** bấm "Khai kết nối" hoặc "Nối hàng loạt" (một switch + N máy, cổng bắt đầu, loại dây) trên thanh trên
**Then** mở hộp sơ đồ cổng DÙNG CHUNG với trang thiết bị (dời sang `web/src/ui` nếu đang ở `features/`, khai registry); ghi NGAY qua endpoint của `devices` như trên
**And** nối hàng loạt hiện bảng xem trước "máy → cổng" theo thứ tự, bỏ qua cổng đã chiếm; cổng không đủ → lỗi đỏ, không ghi gì (một transaction)
**And** ghi xong thì dây tương ứng được chèn vào bản vẽ đã gắn link (máy chưa có trên bản vẽ thì chỉ ghi kho)

**Given** chế độ xem
**When** bấm một thiết bị
**Then** mọi dây của nó + thiết bị đầu kia sáng lên, phần còn lại mờ đi; kết nối trong sơ đồ cổng có đầu kia KHÔNG nằm trên bản vẽ hiện mũi tên "tới Core-01 (bản vẽ Phòng server)" — bấm nhảy sang và bay tới (trong ân hạn không hỏi lại mã)
**And** bấm dây mở thẻ dây: cổng hai đầu, loại dây, VLAN, ghi chú (đọc qua `devices.api` theo `ims_link_id`); nét "Chỉ vẽ" hiện "Chưa khai vào sơ đồ cổng"
**And** E2E kiểm màu dây, nét vàng, nét đỏ và tô sáng cả light lẫn dark

**Given** chọn site / tủ / danh sách máy và bấm "Dựng nháp từ sơ đồ cổng" (FR-048)
**When** phạm vi ≤ `diagram.autolayout_max_nodes` (mặc định 300)
**Then** tạo một phiên bản nháp MỚI có các thiết bị + dây đã gắn dữ liệu xếp lưới đơn giản; người vẽ dùng Arrange → Layout của draw.io để xếp gọn — IMS không viết thuật toán bố cục; vượt trần → từ chối kèm gợi ý thu hẹp

### Story 10.6: Bản vẽ con, khung VLAN và khung tủ

As a Thành viên,
I want gắn khung tòa nhà/tầng/phòng với bản vẽ con, gắn khung VLAN với dải IP, và chèn cả một tủ là ra khung tủ chứa sẵn máy,
So that đi từ bản vẽ tổng xuống tận tủ bằng vài cú bấm, không dựng tay hàng chục khung như Visio.

**Acceptance Criteria:**

**Given** người vẽ chọn một khung đã vẽ và bấm "Gắn bản vẽ con" trên thanh IMS phía trên trình vẽ (chọn từ cây; khung nhận diện qua id ô trong XML `autosave`)
**When** lưu
**Then** khung mang `ims_child_diagram_id`; ở chế độ xem bấm/nháy đúp khung mở bản vẽ con, thanh đường dẫn "Tổng > Tower > Tầng 3 > Phòng server" bấm lên được từng cấp, trong ân hạn không hỏi lại mã
**And** gắn với bản vẽ không cùng nhánh cây, đã lưu trữ hoặc là bản trình bày → từ chối kèm lý do; bản vẽ con bị lưu trữ sau đó → khung hiện dấu, không vỡ trang

**Given** khung VLAN
**When** gắn với một dải IP (chọn qua `ipam.api`)
**Then** khung mang `ims_subnet_id`; ở chế độ xem bấm khung hiện CIDR, VLAN, site, số IP đã cấp / còn trống và vài IP trống đầu tiên; dải ngừng dùng hiện "(ngừng dùng)"

**Given** người vẽ chọn "Tủ R1" trong hộp tìm gọn mở từ thanh trên và bấm Chèn tủ
**When** IMS dựng khung
**Then** chèn bằng `merge` một khung tủ dùng hình rack của draw.io (cao theo `cabinet.u_height`) mang `ims_cabinet_id`, chứa sẵn mọi máy đang gắn tủ đó (qua `devices.api`, bỏ máy thanh lý) — máy có U xếp đúng U (Story 10.11), máy chưa khai U xếp ở cột "Chưa khai U" bên cạnh
**And** máy sau này được gắn thêm vào tủ trong kho KHÔNG tự chui vào bản vẽ — hiện thành cảnh báo lệch kho (Story 10.9)
**And** hình tự do (khung, đám mây ISP, chữ, mũi tên, đường nối site) là đồ hoạ thuần của draw.io, không ghi bảng kho nào

### Story 10.7: Gửi duyệt, phát hành, tự kiểm và bình luận ghim

As a Thành viên,
I want gửi bản nháp cho Admin duyệt, được hệ thống tự kiểm trước, và nhận lại ghi chú ghim ngay trên hình/dây sai,
So that bản chính thức luôn qua người có thẩm quyền mà không ai phải đọc từng thay đổi.

**Acceptance Criteria:**

**Given** loại yêu cầu `diagram_publish` đăng ký vào `approvals` (AD-6): `pending → approved | returned | withdrawn`, đổi trạng thái chỉ qua `transition()`
**When** Thành viên bấm "Gửi duyệt" (bắt ghi lý do)
**Then** server chạy tự kiểm (bộ hàm thuần AD-18, test bảng dữ liệu): LỖI ĐỎ chặn — `ims_device_id`/`ims_link_id` không tồn tại, máy đã thanh lý, dây gắn link mà hai đầu link khác hai máy ở hai đầu dây, hai dây gắn cùng một link; CẢNH BÁO VÀNG cho qua — dây giữa hai máy kho chưa gắn link, máy đặt trong khung tủ khác tủ trong kho, dây giữa hai site không có đường nối site
**And** gửi được thì tạo `approval` (payload ghim đúng phiên bản được gửi — mặc định bản đã lưu mới nhất) + email Admin/SA trừ người gửi qua outbox (`approval.requested`), nhắc theo `approval.reminder_hours` (sweep chung); một bản vẽ chỉ một yêu cầu chờ (khoá hàng `diagram`, kể cả người gửi khác → 409); người gửi tự rút được
**And** khung tự kiểm ở `diagram-selfcheck.ts` (luật thiết bị: máy không còn/thanh lý = đỏ, máy trong khung tủ — ô con hoặc nằm gọn trong khung — khác tủ trong kho = vàng); luật dây là `checkCables` của `diagram-checks.ts` (Story 10.5), kiểu chung ở `diagram-finding.ts`; lỗi chặn trả 400 `DIAGRAM_CHECK_FAILED` kèm danh sách đỏ/vàng, web liệt kê và bay tới ô

**Given** Admin/SA mở yêu cầu chờ
**When** xem trang duyệt
**Then** thấy tóm tắt một dòng (so với bản chính thức hiện hành) + cảnh báo vàng + nút "Xem so sánh với bản chính thức" (tuỳ chọn; tắt kèm lý do tới Story 10.10) — KHÔNG bắt bấm qua từng thay đổi (Q-23). Trang duyệt nằm ngay trên bản vẽ (`/diagrams/:id`, nút "Duyệt…"), thư duyệt và nhãn nhật ký trỏ về đó (`ApprovalSubject.detailPath`)
**And** bấm Duyệt: trong MỘT transaction tự kiểm chạy lại, phiên bản thành chính thức (`official_version_id` + `diagram_history` sự kiện phát hành), `approval` → `approved`, audit, email báo người gửi — **không ghi gì vào `device_port`** (AD-18); có lỗi đỏ mới phát sinh (vd máy vừa thanh lý) thì không duyệt được và báo rõ
**And** Thành viên gọi API duyệt hay phát hành → 403; Admin không duyệt được bản do chính mình gửi (đi đường Phát hành)

**Given** Admin/SA tự vẽ
**When** lưu
**Then** vẫn là bản nháp; bấm "Phát hành" mới thành chính thức, chạy cùng bộ tự kiểm (đỏ chặn, vàng cho qua), không qua `approvals` (Q-23); "Khôi phục phiên bản" (Story 10.3) + Phát hành = lùi bản chính thức, không xoá lịch sử — hộp phiên bản có thêm "Khôi phục làm chính thức" trên phiên bản từng chính thức: khôi phục + phát hành trong MỘT transaction

**Given** Admin trả về
**When** ghim bình luận lên hình/dây (theo id ô; draw.io tự host không có bình luận nên IMS tự lưu) hoặc ghi chú chung rồi bấm "Trả về"
**Then** phải có ít nhất một bình luận/ghi chú; `approval` → `returned`, email người gửi; người gửi thấy ghim trên trình xem và danh sách ghim mở từ thanh trên trình vẽ (bấm ghim → trình xem bay tới ô), sửa rồi gửi lại
**And** `diagram_comment` (migration `0049_diagram_comment.sql`, chỉ-thêm: trigger + REVOKE, có trong `app-role-privileges.spec.ts`) gắn phiên bản + id ô + toạ độ ô trên ảnh xem lúc ghim + lượt duyệt đang chờ, `parent_id` để trả lời thành luồng; không sửa/xoá nội dung, "Đã xử lý"/"Mở lại" là hàng sự kiện (`kind`) + audit; ô bị xoá ở phiên bản sau → ghim hiện ở vị trí cũ kèm "(hình đã bỏ)"
**And** ghi chú trông như mật khẩu bị chặn (FR-035, Q-19)
**And** cây hiện "Chờ duyệt" và "Chính thức vN"; test: `api/test/diagram-review.spec.ts` (DB), `diagram-selfcheck.spec.ts`, `mail-diagram-review.spec.ts`, vitest `diagram-review.test.tsx` + `diagram-viewer.test.tsx`, E2E `diagrams-review.spec.ts`

### Story 10.8: Bản trình bày

As a Admin,
I want nhân bản bản chính thức thành bản trình bày để thêm thiết bị dự kiến, ảnh báo giá rồi xuất PDF xin mua sắm,
So that trình nội bộ thoải mái mà không đụng tới bản chính thức.

**Acceptance Criteria:**

**Given** một bản chính thức
**When** bất kỳ vai bấm "Tạo bản trình bày"
**Then** tạo `diagram` mới `kind = 'presentation'` ghi `source_diagram_id` + `source_version_id`, chép XML phiên bản đó; không có Gửi duyệt/Phát hành; nhiều bản trình bày cho một bản chính thức; xem vẫn đòi mã phạm vi sơ đồ và ghi `diagram.viewed`

**Given** đang sửa bản trình bày
**When** thêm "thiết bị dự kiến" từ thanh trên trình vẽ (tên, model, giá, NCC — không cần có trong kho) hoặc ảnh tự do (tải qua `files`, chỉ jpeg/png/webp theo kiểm nội dung sẵn có)
**Then** thiết bị dự kiến mang `ims_planned="1"`, viền đứt, nhãn "Dự kiến"; không bao giờ lọt vào kho hay bản chính thức
**And** file xuất có dải "BẢN TRÌNH BÀY — không phải sơ đồ chính thức" + "Dựa trên bản chính thức phiên bản N" (Story 10.10)

**Given** bản gốc có phiên bản chính thức mới sau khi nhân bản
**When** mở bản trình bày
**Then** hiện "Bản gốc đã có phiên bản mới (N+k)" kèm link; không tự cập nhật

**Given** XML có `ims_planned` gửi vào bản `official` qua API
**When** lưu
**Then** 400 — chỉ hợp lệ trong `kind = 'presentation'`

### Story 10.9: Cảnh báo lệch kho và kiểm tra khớp

As a Admin,
I want bản vẽ tự báo khi dữ liệu kho đã đổi khác lúc vẽ,
So that biết bản vẽ nào đã cũ mà hệ thống không tự sửa hay ép sửa (Q-23).

**Acceptance Criteria:**

**Given** bản chính thức có `device_snapshot` + `cell_index`
**When** mở bản vẽ
**Then** server so với dữ liệu hiện tại qua `devices.api`/`ipam.api`: máy thanh lý, đổi IP, đổi site/tủ/U, dây gắn link đã bị xoá hoặc đổi đầu, kết nối trong sơ đồ cổng giữa hai máy cùng có mặt trên bản vẽ mà chưa vẽ, máy mới gắn vào tủ có khung trên bản vẽ
**And** có lệch thì hiện "Có N thay đổi chưa vẽ" + dấu trên từng ô trong trình xem; bấm = "Kiểm tra khớp dữ liệu" liệt kê từng mục, bấm mục bay tới ô; cây bản vẽ hiện dấu cho bản lệch
**And** KHÔNG có thao tác nào tự sửa bản vẽ hay sơ đồ cổng; bộ luật dùng chung với tự kiểm Story 10.7 và với nét đỏ / "Có N kết nối mới chưa vẽ" của Story 10.5 (một bộ hàm thuần — story này thêm các mục máy/IP/U/tủ và danh sách "Kiểm tra khớp", không dựng lại phần dây)

**Given** lượt quét hằng ngày của worker
**When** số lệch của một bản chính thức tăng so với lần quét trước
**Then** email người phụ trách qua outbox (`diagram.drift_notify_enabled`, mặc định bật); số không đổi không gửi lại; khử job đúp BullMQ có bài `test:db`
**And** `devices` không phụ thuộc `diagrams` (depcruise xanh)

### Story 10.10: Xuất PNG/PDF, so sánh phiên bản và thanh trượt thời gian

As a Admin,
I want xuất bản vẽ có chân trang và watermark để nộp ISO, so sánh hai phiên bản bằng tô màu và kéo về một ngày bất kỳ,
So that có bằng chứng in được, thấy ngay đã đổi gì, và trả lời auditor "ngày X sơ đồ trông thế nào".

**Acceptance Criteria:**

**Given** người dùng đang xem một bản vẽ (trong ân hạn sơ đồ)
**When** bấm "Xuất PNG" hoặc "Xuất PDF"
**Then** gọi `POST /diagrams/:id/versions/:v/exports` (`@Audited`, `@RequiresStepUp('diagram')`, ghi `diagram.exported`: ai, phiên bản, định dạng); **server** dựng ảnh từ SVG đã lưu (không nhận ảnh từ client), ghép chân trang (tên, đường dẫn cây, phiên bản số + tên, trạng thái, ngày duyệt, người vẽ, người duyệt), chú giải màu dây và watermark "người xuất · giờ phút" lặp toàn hình; thư viện rasterize/PDF chọn trong story, khai addendum + registry
**And** bản nháp có dải "BẢN NHÁP — chưa duyệt", bản trình bày có dải của Story 10.8
**And** hết ân hạn giữa chừng → hỏi lại mã tại chỗ; huỷ thì không có file, không có dòng audit

**Given** hai phiên bản bất kỳ của cùng bản vẽ
**When** bấm "So sánh"
**Then** trình xem tô: ô THÊM xanh, BỎ đỏ (khung đứt tại vị trí cũ từ `cell_index` bản cũ), ĐỔI (link/loại dây/vị trí/nhãn) vàng — token có cặp dark, E2E kiểm light + dark; có chú giải và bộ đếm; phép so là hàm thuần của Story 10.3

**Given** thanh trượt thời gian
**When** kéo về ngày X
**Then** hiện bản CHÍNH THỨC hiệu lực ngày X (từ sự kiện phát hành trong `diagram_history`), nhãn "Bản chính thức hiệu lực ngày X — phiên bản N"; mỗi lần đổi phiên bản ghi `diagram.viewed`; trước bản chính thức đầu tiên → "Chưa có bản chính thức vào ngày này"

### Story 10.11: Ảnh thật, vị trí U và mặt tủ

As a Thành viên,
I want đổi hình thiết bị sang ảnh thật và có mặt tủ xếp đúng U từ kho,
So that xuống tủ là nhận ra đúng máy, đúng lỗ cắm.

**Acceptance Criteria:**

**Given** thiết bị thêm `rack_u_start` và `rack_u_size` (cùng có hoặc cùng trống, 1–60; migration, chủ `devices`)
**When** lưu hồ sơ có U
**Then** API chặn U vượt `cabinet.u_height` (qua `catalog.api`) và chặn hai máy chồng U trong cùng tủ (Q-23), báo tên máy đang chiếm; lịch sử thiết bị ghi thay đổi U; nhập/xuất Excel có thêm "U bắt đầu", "Số U" (không bắt buộc)
**And** máy có U vượt chiều cao tủ (dữ liệu cũ) hiện cảnh báo trong khung tủ, không vỡ khung

**Given** ảnh thật hai mức
**When** chọn ảnh mặt trước/mặt sau từ giấy tờ đính kèm của thiết bị (mức máy) hoặc tải ảnh cho model (mức model = loại thiết bị + chuỗi model, Q-23; `files.owner_type` thêm `device_model` — migration)
**Then** ảnh mức máy đè ảnh mức model; chỉ jpeg/png/webp theo kiểm nội dung của `files`; ảnh vào bản vẽ qua `ims_photo_file_id` + hydrate, không lưu cứng trong XML
**And** thanh trên có công tắc Biểu tượng / Ảnh thật cho ô đang chọn trong danh sách; không có ảnh thì công tắc tắt kèm lý do (`useDisabledReason`)
**And** ghim cổng trên ảnh mặt sau = điểm nối draw.io đặt tại vị trí cổng, dây gắn link nối vào đó — IMS không lưu ghim riêng

**Given** bản vẽ loại tủ
**When** bấm "Dựng lại mặt tủ"
**Then** sinh phiên bản nháp mới với khung rack đúng U từ kho (mặt trước / mặt sau là hai khung cạnh nhau), máy chưa khai U ở cột "Chưa khai U"; E2E có trường hợp chồng U bị chặn

### Story 10.12: Xem trên điện thoại, tìm, lớp, chỉ đường và trình chiếu

As a Thành viên trực đêm,
I want mở sơ đồ trên điện thoại, tìm một máy là bay tới, tắt bớt lớp, chỉ đường giữa hai máy và trình chiếu cho người mới,
So that lúc sự cố 2 giờ sáng thấy ngay đường đi từ máy hỏng tới Internet.

**Acceptance Criteria:**

**Given** điện thoại 390px
**When** mở cây bản vẽ và một bản chính thức
**Then** trình xem SVG chạy được: phóng hai ngón, bấm thiết bị ra thẻ, tô sáng dây, tìm; KHÔNG nạp draw.io, không có công cụ sửa/gửi duyệt; mở đường dẫn sửa trên điện thoại → chế độ xem kèm "Sửa sơ đồ chỉ làm trên máy tính"; E2E có assertion 390px

**Given** ô tìm trên trình xem
**When** gõ mã/tên/IP
**Then** có trong bản vẽ thì bay tới và tô sáng (khung bao từ `cell_index`); không có thì liệt kê bản vẽ khác chứa nó (bấm mở rồi bay tới)

**Given** bản vẽ có nhiều lớp draw.io
**When** bật/tắt lớp ở trình xem
**Then** ẩn/hiện các ô thuộc lớp đó (theo `cell_index`); watermark KHÔNG nằm trong danh sách lớp

**Given** chọn thiết bị A và B rồi bấm "Chỉ đường"
**When** server tìm đường ngắn nhất trên đồ thị sơ đồ cổng (qua `devices.api`, hàm thuần test bảng dữ liệu)
**Then** tô sáng đoạn nằm trên bản vẽ hiện tại, đoạn ở bản vẽ khác hiện mũi tên nhảy sang; không có đường → "Không có đường nối giữa A và B trong sơ đồ cổng"

**Given** chế độ trình chiếu
**When** chọn một nút cây và bấm "Trình chiếu"
**Then** đi lần lượt bản chính thức từ tổng xuống chi tiết, toàn màn hình, phím ← → / Esc; hết ân hạn giữa chừng hỏi lại mã tại chỗ, không thoát; mỗi trang ghi `diagram.viewed`

**Given** chừa chỗ trạng thái sống (FR-049 — CHỈ thiết kế)
**When** story đóng
**Then** `docs/` có mục thiết kế theo AD-18: hợp đồng `POST /api/v1/device-status` (khoá API riêng, chỉ ghi trạng thái, không đọc), nơi lưu (module mới, không phải `diagrams`), lớp "trạng thái sống" bật/tắt trong mô hình lớp của `diagram-viewer`
**And** mã KHÔNG có route nhận trạng thái và giao diện KHÔNG hiện lớp đó (bài kiểm bề mặt route xác nhận vắng mặt)
