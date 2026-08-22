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
**Then** 3 site và danh mục loại thiết bị cơ bản có sẵn sau cài đặt

**Given** Admin mở màn danh mục
**When** thêm/sửa/vô hiệu một mục
**Then** thay đổi ghi audit; mục đang được thiết bị tham chiếu không xóa được, chỉ vô hiệu
**And** Member chỉ xem, không sửa danh mục (@Roles enforce)

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
