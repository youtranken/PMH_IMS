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
FR-037: Cây bản vẽ (Tổng công ty → site → tầng → phòng → tủ) + khung vẽ; hình thiết bị là hồ sơ kho, biểu tượng SVG theo loại thiết bị, thẻ thông tin lấy từ kho
FR-038: Vẽ dây = khai sơ đồ cổng (một cổng một cáp); màu theo loại dây với chú giải chung; bấm thiết bị tô sáng dây + nhảy bản vẽ
FR-039: Lớp vẽ tự do (khung tòa nhà/tầng/phòng/VLAN gắn dải IP, đám mây ISP, chữ, mũi tên, đường nối site), khung tủ tự sinh, nháy đúp xuống bản vẽ con
FR-040: Phiên bản bản vẽ: mỗi lần lưu một phiên bản, tóm tắt, đặt tên, snapshot dữ liệu thiết bị, khôi phục, so sánh tô màu, thanh trượt thời gian
FR-041: Bản chính thức qua duyệt: Thành viên gửi duyệt (tự kiểm: lỗi chặn, cảnh báo cho qua), Admin duyệt/trả về kèm bình luận ghim; Admin/SA tự phát hành
FR-042: Mọi lần xem bản vẽ nhập TOTP phạm vi sơ đồ (ân hạn riêng, tách két); nhật ký mỗi lần mở; watermark tên người xem + giờ
FR-043: Cảnh báo bản vẽ lệch kho + nút kiểm tra khớp; chỉ cảnh báo, không ép sửa
FR-044: Xuất PNG/PDF có chân trang (phiên bản, ngày duyệt, người vẽ, người duyệt) + watermark
FR-045: Bản trình bày tách rời bản chính thức (thiết bị dự kiến, ảnh tự do, dải chữ "BẢN TRÌNH BÀY")
FR-046: Điều hướng: phóng to hiện chi tiết, bật/tắt lớp, tìm và bay tới, chỉ đường, trình chiếu, xem trên điện thoại chỉ xem
FR-047: Ảnh thật theo model/máy (mặt trước/sau, ghim cổng) + mặt tủ theo U (thiết bị thêm U bắt đầu + số U)
FR-048: Tự xếp sơ đồ từ sơ đồ cổng, Xếp gọn, nối hàng loạt
FR-049: (chỉ thiết kế, chưa làm) API nhận trạng thái sống từ máy giám sát ngoài + lớp "trạng thái sống"

> FR-037..FR-049 thêm theo `docs/QUYET-DINH.md` Q-23 (02/10/2026): sơ đồ mạng vốn ở PRD §7 "Phase sau" nay kéo vào Epic 10, làm trước Epic 8–9. Biên bản: `_bmad-output/brainstorming/brainstorm-so-do-mang-2026-10-02/`.

### NonFunctional Requirements

NFR-01: Đăng nhập — Argon2id+pepper, rate-limit IP, lockout 5 sai→15', TOTP enroll bắt buộc + cưỡng chế login theo toggle per member + step-up luôn bắt buộc, session idle 30'/absolute 12h, SA đá phiên, email thiết bị mới, CSRF+Origin, regenerate session, revoke khi đổi pass/MFA, 2 SA, không tự đăng ký
NFR-02: Vault — AES-256-GCM envelope, AAD=record_id+key_version+table, master key randomBytes(32) docker secret, TOTP secret mã hóa envelope, chống TOTP replay, giải mã on-demand, chìa giấy 2 phong bì, restore drill định kỳ
NFR-03: Audit — append-only (REVOKE UPDATE/DELETE), mọi login/giải mã/thay đổi, giữ vĩnh viễn
NFR-04: Triển khai — LAN-only 443, wildcard *.pmh.com.vn, docker 5 service, zero-trust, helmet, no-store cho secret
NFR-05: Hiệu năng — 300+ thiết bị/5 user, danh sách <2s, backup đêm tách máy, khóa account không xóa
NFR-06: Ngôn ngữ — UI tiếng Việt; bản in phiếu song ngữ theo mẫu ISO

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
FR-037: Epic 10 - Cây bản vẽ + khung vẽ + thiết bị từ kho
FR-038: Epic 10 - Dây = sơ đồ cổng + chú giải màu + tô sáng/nhảy bản vẽ
FR-039: Epic 10 - Lớp vẽ tự do + khung tự sinh + bản vẽ con
FR-040: Epic 10 - Phiên bản, snapshot, khôi phục, so sánh, thanh trượt thời gian
FR-041: Epic 10 - Duyệt bản chính thức qua approvals
FR-042: Epic 10 - TOTP phạm vi sơ đồ + nhật ký mở + watermark
FR-043: Epic 10 - Cảnh báo lệch kho
FR-044: Epic 10 - Xuất PNG/PDF
FR-045: Epic 10 - Bản trình bày
FR-046: Epic 10 - Điều hướng, trình chiếu, xem trên điện thoại
FR-047: Epic 10 - Ảnh thật + mặt tủ theo U
FR-048: Epic 10 - Tự xếp, xếp gọn, nối hàng loạt
FR-049: Epic 10 - Chừa chỗ trạng thái sống (chỉ thiết kế)

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
Bỏ Visio: bản vẽ hạ tầng gắn dữ liệu kho (thiết bị, sơ đồ cổng, dải IP, két) cộng lớp vẽ tự do; cây bản vẽ Tổng công ty → site → tầng → phòng → tủ; phiên bản có duyệt, bản trình bày tách rời; mọi lần xem nhập mã 2 lớp phạm vi sơ đồ, nhật ký mở, watermark; cảnh báo lệch kho; xuất PNG/PDF nộp ISO.
**FRs covered:** FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049 (chỉ thiết kế), NFR-01 (step-up có phạm vi), NFR-03, NFR-05

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

Bỏ Visio: sơ đồ là lớp nhìn của dữ liệu kho cộng lớp vẽ tự do. Dây là DỮ LIỆU (một dòng sơ đồ cổng hai đầu), nên tô sáng, nhảy bản vẽ, tự kiểm, cảnh báo lệch kho và chỉ đường làm được. Làm trước Epic 8–9 (Q-23). Nguồn: `docs/QUYET-DINH.md` Q-23 (thắng khi lệch), `_bmad-output/brainstorming/brainstorm-so-do-mang-2026-10-02/brainstorm-intent.md`.

**Luật chung cho mọi story của epic (khỏi nhắc lại từng story):**
- Module mới `diagrams` (tầng nghiệp vụ) là chủ duy nhất các bảng `diagram`, `diagram_version`, `diagram_version_label`, `diagram_history`, `diagram_comment` (AD-3). Đọc/ghi dữ liệu khác CHỈ qua `devices.api`, `ipam.api`, `catalog.api`, `approvals.api`, `files.api` (AD-2). KHÔNG module nào gọi ngược `diagrams` — đồ thị giữ acyclic; trang thiết bị muốn hiện "có mặt trong bản vẽ nào" thì web tự gọi endpoint của `diagrams`, không phải `devices` gọi sang.
- Mọi endpoint ghi: `@Audited` + `@Roles` + `tx` tường minh, nghiệp vụ + audit + outbox cùng transaction (AD-5, AD-9). Mọi endpoint đọc NỘI DUNG bản vẽ khai `@RequiresStepUp('diagram')`; route còn lại khai `@NoStepUp()` rõ ràng (guard mặc định đóng).
- Bảng lịch sử/phiên bản là chỉ-thêm: trigger `history_append_only` + `REVOKE UPDATE, DELETE, TRUNCATE ... FROM ims_app` và `FROM CURRENT_USER` ngay trong file tạo bảng, và thêm tên bảng vào `api/test/app-role-privileges.spec.ts` (mục "Migration & DB" của CLAUDE.md). Migration mới đánh số tiếp sau file cuối đang có, không sửa file cũ (AD-10).
- Tham số nghiệp vụ vào `system_config` có mặc định + khai `EDITABLE_SETTINGS` (AD-11).
- Thư viện vẽ: `@xyflow/react` 12.x + `html-to-image` (addendum PRD §2). Story 10.2 cập nhật `ARCHITECTURE-SPINE.md`: thêm `diagrams` vào cây module + bảng chủ sở hữu AD-3, gỡ "sơ đồ React Flow" khỏi mục Deferred.
- Khung vẽ (canvas) và các khối dùng ở ≥2 màn (sửa, duyệt, so sánh, trình bày, trình chiếu, điện thoại) nằm ở `web/src/ui`, khai `docs/SHARED-REGISTRY.md` trong story sinh ra nó (AD-15). Màu thiết bị/dây/khung chỉ qua token trong `tokens.css` có cặp `html[data-theme='dark']`.
- Màn SỬA bản vẽ chỉ desktop; màn XEM pass 390px ở Story 10.12. Mọi hàng bài kiểm tạo ra mang chữ `E2E` trong tên bản vẽ; `api/scripts/reset-e2e.mjs` dọn được mọi bảng mới.

### Story 10.1: Step-up có phạm vi — két và sơ đồ

As a SA,
I want mã 2 lớp nhập cho sơ đồ và mã nhập cho két được tính riêng, mỗi bên một thời gian ân hạn,
So that mở sơ đồ không vô tình mở luôn két, và ngược lại (Q-23: nhập ở đâu tính ở đó).

**Acceptance Criteria:**

**Given** step-up hiện là một mốc chung `sessions.stepped_up_at` dùng cho két, tài khoản, tham số hệ thống
**When** dev thêm phạm vi `diagram` (migration thêm cột `sessions.diagram_stepped_up_at timestamptz`, chủ: `auth`) và khoá `diagram.stepup_grace_minutes` (mặc định 10, sửa được 1–60 trên màn Tham số hệ thống)
**Then** `@RequiresStepUp()` không tham số giữ nghĩa cũ (phạm vi két, ân hạn `secret.stepup_grace_minutes`); `@RequiresStepUp('diagram')` chỉ đọc `diagram_stepped_up_at` với ân hạn `diagram.stepup_grace_minutes`
**And** `POST /auth/step-up` bắt buộc nhận `scope: 'vault' | 'diagram'` và chỉ đóng dấu đúng cột của phạm vi đó; thiếu hoặc sai `scope` → 400; dòng audit step-up (thành công và thất bại) ghi kèm phạm vi
**And** bộ đếm gõ sai `stepup_failures` dùng CHUNG cho hai phạm vi — sai đủ `secret.stepup_max_failures` ở bên nào cũng thu hồi phiên
**And** nhập mã 2 lớp lúc đăng nhập KHÔNG mở phạm vi sơ đồ (chỉ giữ hành vi hiện có với phạm vi két)

**Given** phiên vừa nhập mã cho két (còn trong ân hạn két)
**When** gọi một route khai `@RequiresStepUp('diagram')`
**Then** 401 `STEPUP_REQUIRED` kèm `scope: 'diagram'` và `graceMinutes` của sơ đồ; chiều ngược lại (mới nhập cho sơ đồ, gọi route két) cũng 401 với `scope: 'vault'`
**And** bài kiểm guard dạng bảng dữ liệu (phạm vi × mốc × ân hạn) đỏ khi gieo đột biến "đọc nhầm cột"; `step-up-surface.spec.ts` biết phạm vi mới; E2E `security.spec.ts` dựng lại đúng đòn: phiên có ân hạn két gọi thẳng API sơ đồ → bị chặn

**Given** web gặp `STEPUP_REQUIRED`
**When** `StepUpDialog` / `StepUpStep` / `useStepUpRetry` mở hộp nhập mã
**Then** hộp nhận prop `scope` và gửi đúng phạm vi server trả về; câu chữ nói rõ "xem sơ đồ" hay "mở két" qua `lib/i18n`; hết ân hạn thì hỏi lại TẠI CHỖ, không đá người dùng ra ngoài
**And** `docs/SHARED-REGISTRY.md` cập nhật dòng `@RequiresStepUp`, `StepUpDialog`, `useStepUpRetry` (thêm phạm vi, khi nào dùng phạm vi nào)

### Story 10.2: Cây bản vẽ, khung vẽ và nhật ký mở

As a Thành viên,
I want tạo bản vẽ trong một cây theo công ty → site → tầng → phòng → tủ và vẽ trên khung zoom/pan được,
So that sơ đồ mạng có nhà trong IMS thay cho file Visio rải rác.

**Acceptance Criteria:**

**Given** module `diagrams` với bảng `diagram` (id, `parent_id`, tên, loại nút cây: `company`/`site`/`floor`/`room`/`cabinet`/`other`, `site_id?`, `cabinet_id?`, người phụ trách, `kind` = `official`/`presentation`, `official_version_id?`, `archived_at?`) và `diagram_version` chỉ-thêm (id, `diagram_id`, số thứ tự, `content jsonb`, `based_on_version_id`, người lưu, lúc lưu)
**When** migration chạy trên DB trắng
**Then** `diagram_version` không UPDATE/DELETE/TRUNCATE được bằng `ims_app` (trigger + REVOKE, có trong `app-role-privileges.spec.ts`); tầng/phòng chỉ là tên bản vẽ — KHÔNG thêm danh mục vị trí mới (Q-23)
**And** `site_id`/`cabinet_id` kiểm qua `catalog.api` (mục ngừng dùng không chọn mới được, Q-14)

**Given** người dùng bất kỳ vai (Thành viên, Admin, SA)
**When** mở màn "Sơ đồ mạng" (menu mới, nhóm Tài sản)
**Then** thấy cây bản vẽ dạng thư mục: CHỈ tên + loại + trạng thái (chính thức / có bản nháp / chờ duyệt), không ảnh thu nhỏ, không cần mã 2 lớp
**And** mọi vai tạo được bản vẽ con và vẽ; đổi tên, chuyển nhánh, lưu trữ bản vẽ chỉ Admin/SA (`@Roles`), Thành viên gọi API → 403; không có xoá cứng (chỉ lưu trữ)

**Given** người dùng mở NỘI DUNG một bản vẽ
**When** chưa trong ân hạn sơ đồ
**Then** hiện hộp nhập mã (Story 10.1); nhập đúng mới tải nội dung; trong ân hạn thì chuyển giữa các bản vẽ không hỏi lại
**And** MỖI lần mở nội dung (bản chính thức, bản nháp, phiên bản cũ, bản trình bày) ghi một dòng audit `diagram.viewed` (ai, bản vẽ, phiên bản, lúc nào) — NFR-03
**And** khung vẽ phủ watermark mờ lặp lại "tên người xem · email · giờ phút" (token màu riêng có cặp dark), không tắt được bằng giao diện

**Given** người vẽ mở bản nháp trên desktop
**When** kéo thả, zoom, pan, dùng bản đồ thu nhỏ (minimap) rồi bấm Lưu
**Then** mỗi lần Lưu tạo một hàng `diagram_version` mới (bản lưu sau thắng — Q-23); rời màn khi còn thay đổi chưa lưu thì hỏi lại qua bộ hỏi dùng chung (không `window.confirm`)
**And** khung vẽ là component dùng chung `DiagramCanvas` ở `web/src/ui` (chế độ `edit` / `view`), khai `SHARED-REGISTRY.md`; màn sửa ở bề ngang < 1024px hiện "Sửa sơ đồ chỉ làm trên máy tính" kèm lối sang chế độ xem
**And** bản vẽ 300 hình + 600 dây mở xong < 3 giây trên máy dev, API trả nội dung < 1 giây (NFR-05)

**Given** lưu với `content` sai hình dạng (thiếu khoá, kiểu nút lạ, quá kích thước cho phép)
**When** gọi API lưu
**Then** 400 với thông báo tiếng Việt, không tạo phiên bản; ARCHITECTURE-SPINE cập nhật cây module + bảng AD-3

### Story 10.3: Thiết bị từ kho với biểu tượng theo loại

As a Thành viên,
I want kéo thiết bị có sẵn trong kho vào bản vẽ, hiện bằng biểu tượng đúng loại, bấm vào thấy đủ thông tin,
So that không phải gõ lại tên/IP/model và bản vẽ luôn trỏ đúng hồ sơ thật.

**Acceptance Criteria:**

**Given** `device_type` thêm `icon_key` (biểu tượng có sẵn trong thư viện ~20 SVG tĩnh của web) và `icon_file_id?` (SVG riêng) — migration, chủ `catalog`
**When** người sửa được danh mục (Q-12) chọn biểu tượng có sẵn cho một loại, hoặc SA tải SVG riêng
**Then** loại mới chưa chọn gì hiện biểu tượng "Thiết bị khác"; chỉ SA tải SVG được (Admin/Thành viên gọi API → 403)
**And** SVG tải lên được LỌC phía server trước khi lưu: bỏ `<script>`, `<foreignObject>`, thuộc tính `on*`, `href`/`xlink:href` trỏ ra ngoài hoặc `javascript:`, thực thể XML ngoài; file quá `diagram.icon_svg_max_kb` (mặc định 100) hoặc không phải SVG hợp lệ → từ chối; SVG chỉ hiện qua `<img>`/data trong canvas, phục vụ với `Content-Type: image/svg+xml` + `Content-Security-Policy: sandbox` (bài kiểm dựng lại SVG có script phải đỏ khi bỏ bộ lọc)

**Given** khung vẽ ở chế độ sửa
**When** người vẽ tìm thiết bị theo mã/tên/IP (dùng `DeviceCombobox` sẵn có) và thả vào bản vẽ
**Then** hình mang `device_id`, không có ô nhập tên/IP riêng; một thiết bị chỉ xuất hiện MỘT lần trong một bản vẽ (thả lần hai thì bay tới hình đã có); thiết bị đã thanh lý không thả được
**And** dưới hình có nhãn vị trí "Site · Tủ · U" lấy từ kho, rê chuột thấy đầy đủ

**Given** người xem bấm một thiết bị
**When** thẻ thông tin mở
**Then** thẻ hiện mã, tên, loại, model, serial, IP (qua `ipam.api`), site/tủ/U, NCC + hotline, bảo hành bằng `ExpiryBadge`, và danh sách "Có mặt trong các bản vẽ" (bấm nhảy sang); có link "Mở hồ sơ"
**And** nút "Mở két" mở luồng két sẵn có của thiết bị đó: VẪN đòi mã phạm vi két (đang trong ân hạn sơ đồ không đủ), Thành viên theo 3 tầng quyền (Epic 6); thẻ không bao giờ chứa giá trị két

### Story 10.4: Vẽ dây là khai sơ đồ cổng

As a Thành viên,
I want kéo dây từ máy A sang máy B, chọn cổng hai đầu và loại dây, rồi bấm một thiết bị là thấy mọi dây của nó đi đâu,
So that bản vẽ và sơ đồ cổng là MỘT dữ liệu, đọc là hiểu, không phải đoán màu dây.

**Acceptance Criteria:**

**Given** danh mục mới `cable_type` (chủ `catalog`: tên, ô màu `color_slot` 1..N, mô tả, `active`) seed vài loại cơ bản (Cat6, Cat5e, Quang single-mode, Quang multi-mode, DAC) và cột `device_port.cable_type_id?` (chủ `devices`) — migration
**When** Admin/Thành viên quản trị loại dây ở màn Danh mục
**Then** màu chọn từ bảng ô màu có sẵn (token `--diagram-cable-1..N` trong `tokens.css`, có cặp dark) — không có ô nhập hex; chú giải màu trên mọi bản vẽ tự sinh từ danh mục này, người vẽ không tự chọn màu
**And** vô hiệu loại dây đang dùng: dây cũ giữ màu + nhãn "(ngừng dùng)", không chọn mới được (Q-14)

**Given** người vẽ kéo dây từ A sang B
**When** hộp chọn cổng mở
**Then** mỗi đầu chỉ liệt kê cổng còn trống của thiết bị đó (hoặc gõ tên cổng mới), chọn loại dây, VLAN (trống / `trunk` / 1–4094 — Q-16), ghi chú
**And** dây trong bản nháp là ĐỀ XUẤT lưu trong `content`; chỉ khi bản được phát hành (Story 10.8) mới ghi vào `device_port` qua `devices.api` trong cùng transaction — luật một cổng một cáp, kiểm hai chiều, không phân biệt hoa/thường (Q-20) áp nguyên
**And** cổng đã có dây trong sơ đồ cổng được chọn lại thì dây trỏ tới dòng `device_port` đó (một kết nối = một bản ghi, AD-14), không tạo bản ghi đối xứng

**Given** chọn một cổng mà đầu kia đã bị chiếm (trong kho hoặc trong chính bản nháp)
**When** bấm Nối
**Then** báo lỗi đỏ ngay trong hộp, không tạo dây

**Given** người xem bấm vào một thiết bị
**When** chế độ tô sáng bật
**Then** mọi dây của thiết bị + thiết bị đầu kia sáng lên, phần còn lại mờ đi; dây có đầu kia KHÔNG nằm trên bản vẽ này hiện mũi tên "tới Core-01 (bản vẽ Phòng server)" — bấm nhảy sang bản vẽ đó và bay tới thiết bị (vẫn trong ân hạn sơ đồ, không hỏi lại)
**And** nhãn trên dây hiện cổng hai đầu (vd `Gi0/24 ↔ Te1/0/1`); bấm dây mở thẻ dây: cổng hai đầu, loại dây, VLAN, ghi chú
**And** màu dây/tô sáng kiểm cả light lẫn dark trong E2E

### Story 10.5: Hình tự do, khung tự sinh và bản vẽ con

As a Thành viên,
I want vẽ khung tòa nhà/tầng/phòng/VLAN, đám mây ISP, chữ, mũi tên, kéo cả một tủ vào là ra khung chứa sẵn máy, và nháy đúp khung để xuống bản vẽ con,
So that không phải dựng tay hàng chục khung và đường như trong Visio.

**Acceptance Criteria:**

**Given** khung vẽ ở chế độ sửa
**When** người vẽ thêm hình tự do (khung chữ nhật có tên, đám mây ISP, chữ, mũi tên, đường nối site: cáp quang / VPN site-to-site)
**Then** hình tự do chỉ nằm trong `content` của phiên bản, không ghi bảng kho nào; màu khung chọn từ bảng token, không hex

**Given** khung loại VLAN
**When** người vẽ gắn khung với một dải IP (chọn qua `ipam.api`)
**Then** bấm khung hiện dải (CIDR, VLAN, site), số IP đã cấp / còn trống và vài IP trống đầu tiên; dải đã ngừng dùng hiện nhãn "(ngừng dùng)"

**Given** người vẽ kéo "Tủ R1" từ danh mục tủ vào bản vẽ
**When** thả
**Then** sinh khung tủ chứa sẵn mọi thiết bị đang gắn tủ đó trong kho (qua `devices.api`, bỏ máy đã thanh lý); thêm máy vào khung thì khung tự giãn
**And** máy sau này được gắn thêm vào tủ trong kho KHÔNG tự chui vào bản vẽ — hiện thành cảnh báo lệch kho (Story 10.9)

**Given** một khung tòa nhà/tầng/phòng/tủ được nối với bản vẽ con trong cây
**When** người xem nháy đúp khung
**Then** mở bản vẽ con; thanh đường dẫn "Tổng > Tower > Tầng 3 > Phòng server" bấm lên được từng cấp; trong ân hạn sơ đồ không hỏi lại mã
**And** nối khung với bản vẽ không cùng nhánh cây hoặc đã lưu trữ → từ chối kèm lý do

### Story 10.6: Phiên bản, lịch sử tóm tắt và khôi phục

As a Admin,
I want mỗi lần lưu thành một phiên bản có tóm tắt một dòng, đặt tên được, và khôi phục bản trước bằng một bấm,
So that 1–2 năm sau vẫn xem lại đúng bản vẽ lúc đó, kể cả máy đã thanh lý.

**Acceptance Criteria:**

**Given** người vẽ bấm Lưu
**When** phiên bản mới được tạo
**Then** cùng transaction chụp `device_snapshot` (mã, tên, loại, model, serial, IP, site, tủ, U, trạng thái của mọi thiết bị trên bản vẽ) và `cable_snapshot` (cổng hai đầu, loại dây, VLAN) vào phiên bản — AD-14: phiên bản là bằng chứng thời điểm, không đổi theo dữ liệu sống
**And** sinh tóm tắt MỘT dòng so với phiên bản trước: "Thêm 3 thiết bị, bỏ 1, đổi 37 dây"; bấm xem chi tiết nhóm theo loại (thiết bị / dây / hình tự do) — không liệt kê phẳng hàng trăm dòng
**And** lịch sử hiển thị bằng `HistoryPanel` dạng trục dọc (Q-20), đọc từ `diagram_history` chỉ-thêm (AD-13: lưu, phát hành, khôi phục, đặt tên), không đọc `audit_log`

**Given** xem một phiên bản cũ có máy đã thanh lý
**When** mở phiên bản đó
**Then** máy hiện đúng tên/IP lúc vẽ lấy từ snapshot, kèm dấu "đã thanh lý sau ngày vẽ"

**Given** một phiên bản quan trọng
**When** người vẽ hoặc Admin đặt tên ("Sau khi thay core 2026")
**Then** tên ghi thành một hàng mới ở `diagram_version_label` chỉ-thêm (tên mới nhất thắng) — `diagram_version` không bị UPDATE; danh sách phiên bản lọc được "chỉ phiên bản có tên"

**Given** Admin/SA bấm "Khôi phục bản chính thức trước"
**When** xác nhận qua `useConfirm`
**Then** tạo một phiên bản MỚI có nội dung của bản được chọn và phát hành nó, ghi `diagram_history` + audit; không xoá phiên bản nào; dây của bản khôi phục đi qua tự kiểm (Story 10.8) như mọi lần phát hành
**And** Thành viên không có nút này, gọi API → 403

**Given** Nguyễn A đang mở sửa bản vẽ
**When** người thứ hai mở cùng bản vẽ ở chế độ sửa
**Then** thấy "Đang có Nguyễn A mở sửa bản vẽ này" (nhịp báo có mặt sống `diagram.presence_ttl_seconds`, mặc định 60); người thứ hai vẫn sửa và lưu được (bản lưu sau thắng — Q-23), tóm tắt của bản lưu sau ghi "lưu đè lên bản của Nguyễn A" khi `based_on_version_id` khác bản mới nhất

### Story 10.7: So sánh tô màu và thanh trượt thời gian

As a Admin,
I want so sánh hai phiên bản bằng tô màu và kéo thanh thời gian về một ngày bất kỳ,
So that thấy ngay đã đổi gì, và trả lời auditor "ngày X sơ đồ trông thế nào".

**Acceptance Criteria:**

**Given** hai phiên bản bất kỳ của cùng bản vẽ
**When** bấm "So sánh"
**Then** khung vẽ chế độ xem tô: thiết bị/dây THÊM màu xanh, BỎ màu đỏ, ĐỔI cổng/loại dây màu vàng (token có cặp dark, E2E kiểm light + dark); có chú giải và bộ đếm từng loại
**And** phép so sánh là hàm thuần dùng chung với tóm tắt Story 10.6 (test bảng dữ liệu), không viết hai lần

**Given** thanh trượt thời gian trên bản vẽ
**When** kéo về ngày X
**Then** hiện bản CHÍNH THỨC đang hiệu lực ngày X (tính từ sự kiện phát hành trong `diagram_history`), nhãn rõ "Bản chính thức hiệu lực ngày X — phiên bản N"; mỗi lần đổi phiên bản đang xem ghi `diagram.viewed`
**And** ngày X trước bản chính thức đầu tiên → báo "Chưa có bản chính thức vào ngày này", không hiện bản nháp

### Story 10.8: Gửi duyệt, tự kiểm và bình luận ghim

As a Thành viên,
I want gửi bản nháp cho Admin duyệt, được hệ thống tự kiểm trước, và nhận lại ghi chú ghim ngay trên hình/dây sai,
So that bản chính thức luôn qua người có thẩm quyền mà không ai phải đọc từng thay đổi.

**Acceptance Criteria:**

**Given** loại yêu cầu `diagram_publish` đăng ký vào module `approvals` (AD-6): `pending → approved | returned | withdrawn`, đổi trạng thái chỉ qua `transition()`
**When** Thành viên bấm "Gửi duyệt" (bắt ghi lý do thay đổi)
**Then** hệ thống chạy tự kiểm (hàm thuần, test bảng dữ liệu): LỖI ĐỎ chặn gửi — cổng không tồn tại, một cổng hai dây (trong bản hoặc va với sơ đồ cổng hiện tại), máy đã thanh lý; CẢNH BÁO VÀNG cho qua — máy đặt trong khung tủ khác tủ ghi trong kho, dây giữa hai site không có đường nối site
**And** gửi được thì tạo `approval` + email cho Admin/SA qua outbox, nhắc lại theo `approval.reminder_hours`; một bản vẽ chỉ có một yêu cầu chờ của một người (chỉ mục duy nhất `approval_one_pending_key` sẵn có); người gửi tự rút được

**Given** Admin/SA mở yêu cầu chờ duyệt
**When** xem trang duyệt
**Then** thấy tóm tắt một dòng + danh sách cảnh báo vàng + nút "Xem so sánh với bản chính thức" (tuỳ chọn, Story 10.7) — KHÔNG bắt bấm qua từng thay đổi (Q-23)
**And** bấm Duyệt: trong MỘT transaction phiên bản thành chính thức, dây đề xuất ghi vào `device_port` qua `devices.api`, `approval` → `approved`, `diagram_history` + audit + email báo người gửi; tự kiểm chạy LẠI tại lúc duyệt — có lỗi đỏ mới phát sinh (vd cổng vừa bị chiếm) thì không duyệt được và báo rõ
**And** Thành viên gọi API duyệt → 403; chỉ Admin/SA duyệt

**Given** Admin/SA tự vẽ
**When** bấm "Phát hành"
**Then** chạy cùng bộ tự kiểm (đỏ chặn, vàng cho qua), phát hành ngay không qua `approvals` (Q-23), ghi `diagram_history` + audit

**Given** Admin trả về
**When** ghim bình luận lên hình/dây sai (hoặc ghi chú chung) rồi bấm "Trả về"
**Then** phải có ít nhất một bình luận hoặc ghi chú; `approval` → `returned`, email người gửi; người gửi mở bản nháp thấy các ghim, sửa rồi gửi lại
**And** bình luận lưu ở `diagram_comment` (gắn phiên bản + id hình/dây, `parent_id` để trả lời thành luồng); không sửa/xoá nội dung bình luận, chỉ "Đã xử lý" (ghi audit); mọi vai bình luận được ngoài luồng duyệt
**And** chuỗi ghi chú bị chặn nếu trông như mật khẩu (FR-035, Q-19)

### Story 10.9: Cảnh báo lệch kho và kiểm tra khớp

As a Admin,
I want bản vẽ tự báo khi dữ liệu kho đã đổi khác lúc vẽ,
So that biết bản vẽ nào đã cũ mà hệ thống không tự sửa hay ép sửa (Q-23).

**Acceptance Criteria:**

**Given** bản chính thức có snapshot (Story 10.6)
**When** mở bản vẽ
**Then** so snapshot với dữ liệu hiện tại qua `devices.api`/`ipam.api`: máy đã thanh lý, đổi IP, đổi site/tủ/U, dây trên bản vẽ không còn trong sơ đồ cổng, dây trong sơ đồ cổng giữa hai máy cùng có mặt trên bản vẽ mà chưa vẽ
**And** có lệch thì hiện nhãn "Có N thay đổi chưa vẽ" và dấu trên từng hình/dây liên quan; bấm nhãn = "Kiểm tra khớp dữ liệu" liệt kê từng mục, bấm mục bay tới hình
**And** KHÔNG có thao tác nào tự sửa bản vẽ hay sơ đồ cổng; cây bản vẽ hiện dấu cho bản đang lệch
**And** phép so dùng chung bộ luật với tự kiểm Story 10.8 (một bộ hàm thuần, test bảng dữ liệu)

**Given** lượt quét hằng ngày của worker
**When** số lệch của một bản chính thức tăng so với lần quét trước
**Then** email người phụ trách bản vẽ qua outbox (bật/tắt bằng `diagram.drift_notify_enabled`, mặc định bật); số không đổi thì không gửi lại; khử job đúp BullMQ có bài `test:db`
**And** `devices` không phụ thuộc `diagrams` — phát hiện lệch là việc của `diagrams` đọc qua public api (depcruise xanh)

### Story 10.10: Xuất PNG/PDF có chân trang và watermark

As a Admin,
I want xuất bản vẽ ra PNG/PDF có chân trang phiên bản, người vẽ, người duyệt và watermark người xuất,
So that nộp hồ sơ ISO được, và ảnh lọt ra ngoài vẫn mang tên người đã lấy nó.

**Acceptance Criteria:**

**Given** người dùng đang xem một bản vẽ (trong ân hạn sơ đồ)
**When** bấm "Xuất PNG" hoặc "Xuất PDF"
**Then** web gọi `POST /diagrams/:id/exports` (`@Audited`, ghi `diagram.exported`: ai, phiên bản, định dạng, lúc nào); server trả dữ liệu chân trang + chữ watermark — không dựng chân trang từ dữ liệu client tự có
**And** file có chân trang: tên bản vẽ, đường dẫn cây, phiên bản số + tên, trạng thái (Chính thức / Nháp / Trình bày), ngày duyệt, người vẽ, người duyệt; và watermark mờ "người xuất · giờ phút" lặp trên toàn hình (Q-23)
**And** xuất bản nháp có dải "BẢN NHÁP — chưa duyệt"; chú giải màu dây đi kèm trong file
**And** thư viện PDF chọn trong story, khai addendum/registry; phần dựng ảnh dùng chung với chế độ xem (`DiagramCanvas`), không vẽ lại lần hai

**Given** hết ân hạn sơ đồ giữa chừng
**When** bấm xuất
**Then** hỏi lại mã tại chỗ rồi xuất tiếp; huỷ nhập mã thì không có file, không có dòng audit xuất

### Story 10.11: Bản trình bày

As a Admin,
I want nhân bản bản chính thức thành bản trình bày để thêm thiết bị dự kiến, ảnh báo giá rồi xuất PDF xin mua sắm,
So that trình nội bộ thoải mái mà không đụng tới bản chính thức.

**Acceptance Criteria:**

**Given** một bản chính thức
**When** bất kỳ vai bấm "Tạo bản trình bày"
**Then** tạo `diagram` mới `kind = 'presentation'` ghi `source_diagram_id` + `source_version_id`, chép nội dung phiên bản đó; bản trình bày không nằm trong chuỗi chính thức, không có Gửi duyệt/Phát hành, không bao giờ ghi `device_port`
**And** một bản chính thức có nhiều bản trình bày; xem bản trình bày vẫn đòi mã phạm vi sơ đồ và ghi `diagram.viewed`

**Given** đang sửa bản trình bày
**When** thêm "thiết bị dự kiến" (tên, model, giá, nhà cung cấp — không cần có trong kho) và ảnh tự do (báo giá, ảnh sản phẩm — tải qua `files`, lọc loại file như đính kèm)
**Then** thiết bị dự kiến vẽ viền đứt, nhãn "Dự kiến"; không bao giờ lọt vào kho hay bản chính thức
**And** PDF/PNG của bản trình bày có dải "BẢN TRÌNH BÀY — không phải sơ đồ chính thức" (Story 10.10) và dòng "Dựa trên bản chính thức phiên bản N"

**Given** bản gốc có phiên bản chính thức mới sau khi nhân bản
**When** mở bản trình bày
**Then** hiện "Bản gốc đã có phiên bản mới (N+k)" kèm link; không tự cập nhật

**Given** thử thêm thiết bị dự kiến hoặc ảnh tự do vào bản chính thức qua API
**When** lưu
**Then** 400 — loại nút này chỉ hợp lệ trong `kind = 'presentation'`

### Story 10.12: Điều hướng, trình chiếu và xem trên điện thoại

As a Thành viên trực đêm,
I want phóng to là hiện chi tiết, tắt bớt lớp, tìm một máy là bay tới, chỉ đường giữa hai máy, và mở được trên điện thoại,
So that lúc sự cố 2 giờ sáng thấy ngay đường đi từ máy hỏng tới Internet.

**Acceptance Criteria:**

**Given** bản vẽ đang xem
**When** phóng to/thu nhỏ
**Then** xa: chỉ biểu tượng + tên; vừa: thêm nhãn vị trí; gần: thêm nhãn cổng trên dây và VLAN
**And** bật/tắt lớp theo loại thiết bị, loại dây, hình tự do; watermark KHÔNG nằm trong danh sách lớp

**Given** ô tìm trên bản vẽ
**When** gõ mã/tên/IP
**Then** có trong bản vẽ thì bay tới và tô sáng; không có thì liệt kê các bản vẽ khác chứa nó (bấm mở rồi bay tới)

**Given** người xem chọn thiết bị A và B rồi bấm "Chỉ đường"
**When** hệ thống tìm đường ngắn nhất trên đồ thị sơ đồ cổng (qua `devices.api`, hàm thuần có test bảng dữ liệu)
**Then** tô sáng đường trên bản vẽ hiện tại, đoạn nằm ở bản vẽ khác hiện mũi tên nhảy sang; không có đường thì báo "Không có đường nối giữa A và B trong sơ đồ cổng"

**Given** chế độ trình chiếu (bàn giao người mới)
**When** chọn một nút cây và bấm "Trình chiếu"
**Then** đi lần lượt bản chính thức từ tổng xuống chi tiết, toàn màn hình, phím ← → / Esc; hết ân hạn giữa chừng thì hỏi lại mã tại chỗ, không thoát trình chiếu; mỗi trang ghi `diagram.viewed`

**Given** điện thoại 390px
**When** mở cây bản vẽ và một bản chính thức
**Then** xem được: cây, bản vẽ (phóng bằng hai ngón), bấm thiết bị ra thẻ, tô sáng dây, tìm; KHÔNG có công cụ sửa/gửi duyệt; mở đường dẫn sửa trên điện thoại → chế độ xem kèm "Sửa sơ đồ chỉ làm trên máy tính"; E2E có assertion 390px

**Given** thiết kế chừa chỗ trạng thái sống (FR-049 — CHỈ thiết kế, không làm trong Epic 10)
**When** story đóng
**Then** `docs/` có mục thiết kế: hợp đồng API nhận trạng thái thiết bị từ máy giám sát ngoài (khoá API riêng, chỉ ghi trạng thái, không đọc gì), cách lưu, lớp "trạng thái sống" bật/tắt trong danh sách lớp; mô hình lớp của `DiagramCanvas` có chỗ cho lớp đó
**And** mã KHÔNG có route nhận trạng thái và giao diện KHÔNG hiện lớp đó (bài kiểm bề mặt route xác nhận vắng mặt)

### Story 10.13: Ảnh thật, mặt tủ theo U và ghim cổng

As a Thành viên,
I want đổi hình thiết bị sang ảnh thật, xem mặt trước/sau của tủ xếp đúng U, và ghim số cổng lên ảnh mặt sau,
So that xuống tủ là nhận ra đúng máy, đúng lỗ cắm.

**Acceptance Criteria:**

**Given** thiết bị thêm `rack_u_start` và `rack_u_size` (cùng có hoặc cùng trống, 1–60; migration, chủ `devices`)
**When** lưu hồ sơ thiết bị có U
**Then** API chặn U vượt `cabinet.u_height` (đọc qua `catalog.api`) và chặn hai máy chồng U trong cùng tủ, báo tên máy đang chiếm; lịch sử thiết bị ghi thay đổi U; nhập/xuất Excel thiết bị có thêm cột "U bắt đầu", "Số U" (không bắt buộc)

**Given** ảnh thật ở hai mức
**When** người dùng chọn ảnh mặt trước/mặt sau từ giấy tờ đính kèm của thiết bị (mức máy) hoặc tải ảnh cho model (mức model: loại thiết bị + model, `files.owner_type` thêm `device_model` — migration)
**Then** ảnh mức máy ghi đè ảnh mức model; chỉ nhận ảnh (jpeg/png/webp) theo kiểm nội dung sẵn có của `files`
**And** mỗi hình trên bản vẽ có công tắc Biểu tượng / Ảnh thật; không có ảnh thì công tắc tắt kèm lý do (`useDisabledReason`)

**Given** một bản vẽ loại tủ
**When** bấm "Mặt tủ"
**Then** tự sinh mặt tủ theo U từ kho (máy có U xếp đúng chỗ, máy chưa khai U nằm ở cột "Chưa khai U"), xem được mặt trước / mặt sau
**And** máy có U vượt chiều cao tủ (dữ liệu cũ) hiện cảnh báo, không vỡ khung

**Given** ảnh mặt sau
**When** người dùng ghim chấm số lên vị trí cổng trên ảnh, gắn với tên cổng
**Then** ghim lưu theo ảnh (mức model hoặc mức máy, chủ `devices`); trên bản vẽ chấm cổng nối với dây tương ứng; ghim tên cổng không có trên thiết bị → cảnh báo vàng

### Story 10.14: Tự xếp sơ đồ, xếp gọn và nối hàng loạt

As a Thành viên,
I want hệ thống dựng sẵn bản nháp từ sơ đồ cổng đã khai, làm thẳng dây, và nối 24 máy vào switch một lượt,
So that không mất buổi chiều kéo từng hình, từng dây như Visio.

**Acceptance Criteria:**

**Given** một site hoặc một tủ đã có sơ đồ cổng
**When** bấm "Tự xếp sơ đồ" và chọn phạm vi (site / tủ / danh sách thiết bị)
**Then** tạo một phiên bản nháp MỚI: thiết bị trong phạm vi + dây từ sơ đồ cổng, xếp tầng (tường lửa / lõi / switch / thiết bị cuối) bằng thư viện bố cục chọn trong story; phiên bản trước giữ nguyên nên "hoàn tác" = mở lại bản cũ
**And** phạm vi > `diagram.autolayout_max_nodes` thiết bị (mặc định 300) → từ chối kèm gợi ý thu hẹp

**Given** một bản vẽ có dây chéo nhau
**When** bấm "Xếp gọn" (cả bản hoặc vùng chọn)
**Then** dây đổi sang đường thẳng/góc vuông, giảm cắt nhau; chỉ đổi vị trí/đường đi trong `content`, không đổi dữ liệu dây

**Given** chọn một switch và N thiết bị
**When** bấm "Nối hàng loạt", chọn cổng bắt đầu và loại dây
**Then** hiện bảng xem trước "thiết bị → cổng" theo thứ tự cổng, BỎ QUA cổng đã chiếm; cổng không đủ cho N máy → lỗi đỏ, không nối gì
**And** chỉ khi xác nhận mới thêm dây đề xuất vào bản nháp (ghi sơ đồ cổng khi phát hành — Story 10.4/10.8)
