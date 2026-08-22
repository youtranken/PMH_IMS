# Review: Tech Currency & Reality-Check — ARCHITECTURE-SPINE.md

- **Đối tượng:** `_bmad-output/planning-artifacts/architecture/architecture-IT_QLMgmtIP-2026-08-21/ARCHITECTURE-SPINE.md`
- **Lens:** mọi quyết định công nghệ phải được kiểm chứng (npm/web/codebase QLTS) thay vì khẳng định từ trí nhớ model.
- **Ngày kiểm:** 2026-08-21. Phương pháp: `npm view <pkg> version|time|engines` chạy thật; đọc mã nguồn QLTS tại `F:\PMH\Project_QLTS\qlts\`; web search/fetch changelog chính thức.

## Verdict

Phần **version number** của spine kiểm chứng nghiêm túc và chính xác 100% so với npm hôm nay; các khẳng định về migration-runner và bảng sessions QLTS là **thật**. Nhưng có **2 điểm chưa reality-check chéo với chính QLTS**: (1) BullMQ 6.x là major mới có breaking changes làm hỏng code `worker.ts`/`queue` copy nguyên từ QLTS (đang ở v5 API), (2) mô tả "raw SQL qua `common/sql.ts`, không ORM — pattern assets QLTS" sai thực tế QLTS (63 file dùng drizzle-orm, kể cả module `assets`; `sql.ts` chỉ là helper `escapeLike`). Ngoài ra exceljs đúng version nhưng đã ngừng bảo trì từ 12/2024 — rủi ro chưa được ghi nhận.

## Bảng kiểm chứng version (npm, chạy thật 2026-08-21)

| Package | Spine ghi | npm latest hôm nay | Khớp | Publish gần nhất | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| `@node-rs/argon2` | 2.1.0 | 2.1.0 | ✅ | 2026-08-13 | Active. Prebuilt: `win32-x64-msvc`, `linux-x64-gnu`, `linux-x64-musl`, `linux-arm64-*` → chạy tốt Windows dev + container Debian/Alpine. `engines: node >= 10`. |
| `otplib` | 13.4.1 | 13.4.1 | ✅ | 2026-05-30 | Đã maintained trở lại (dòng 13.x publish đều đặn: 13.1→13.4); hết trạng thái "ngủ đông v12" trước đây. OK. |
| `csrf-csrf` | 4.0.3 | 4.0.3 | ✅ | 2025-05-27 | v4 là major hiện hành, ổn định 15 tháng. Đây là **adoption mới** (QLTS không dùng lib này — csrf.guard tự viết), nên breaking v3→v4 không ảnh hưởng; chỉ lưu ý tài liệu/ví dụ trên mạng phần lớn còn theo API v3 (`getTokenFromRequest`/`getSessionIdentifier` đổi ở v4). |
| `helmet` | 8.3.0 | 8.3.0 | ✅ | 2026-07-12 | OK, `engines: node >=18`. |
| `exceljs` | 4.4.0 | 4.4.0 | ✅ | **2024-12-20** | Version đúng nhưng xem F-3. |
| `bullmq` | 6.1.2 | 6.1.2 | ✅ | 2026-08-16 | Version đúng nhưng xem F-1 (breaking vs code QLTS copy). |
| `@xyflow/react` | 12.11.3 | 12.11.3 | ✅ | — | Phase sau, ghi đúng. |
| `pino` | (không pin) | 10.3.1 | — | — | QLTS đang `pino ^10.3.1` → convention copy sang là hiện hành. |
| NestJS | (không pin) | `@nestjs/core` 11.2.1 | — | — | QLTS đang `^11.0.1` — cùng major hiện hành, copy skeleton không lệch. |
| Vite / React | (không pin) | vite 8.2.2 / react 19.x | — | — | QLTS web đang `vite ^8.1.1`, `react ^19.2.7` — hiện hành. |
| express-session / connect-pg-simple | không nêu | 1.19.0 / 10.0.0 | — | — | Spine không dùng (session tự quản bảng `sessions` Postgres theo kiểu QLTS) — nhất quán, không flag. |

## Reality-check khẳng định về QLTS

| Khẳng định trong spine | Thực tế kiểm tra | Kết quả |
| --- | --- | --- |
| AD-10: "`migration-runner` QLTS (advisory lock + checksum)" | `qlts/api/src/database/migration-runner.ts`: có `pg_advisory_lock($1)` + cột `checksum` SHA-256, fail khi file đã apply bị sửa, backfill journal cũ | ✅ ĐÚNG |
| AD-8: "kế thừa bảng sessions QLTS, bỏ cột OIDC" | `qlts/api/src/modules/auth/sessions.schema.ts`: bảng `sessions` có thật (id uuid, user_sub, csrf_token, created_at, last_seen_at) + đúng là có cột OIDC cần bỏ (`refresh_token`, `access_token_exp`, `claims`, `id_token`) | ✅ ĐÚNG |
| AD-12: các module copy tồn tại | `audit/` (7 file, có `audited.decorator.ts` + `audit.interceptor.ts`), `outbox/`, `queue/`+`worker/`, `web/src/ui`, `common/sql.ts`, `common/crypto-secret.ts` đều tồn tại | ✅ ĐÚNG |
| AD-12: "viết lại `SessionAuthService` bỏ OIDC-refresh" | `session-auth.service.ts` tồn tại, auth QLTS là OIDC (jwt-verifier, oidc-provider, backchannel-logout) — mô tả rác cần bỏ là chính xác | ✅ ĐÚNG |
| AD-1: "raw SQL qua `common/sql.ts` — không ORM (pattern `assets` QLTS)" | **SAI về QLTS**: xem F-2 | ❌ |

## Findings

### F-1 · MAJOR — BullMQ 6.1.2 mâu thuẫn với "copy nguyên `outbox/`+`queue/`" từ QLTS (đang v5)

- **Bằng chứng:** QLTS `api/package.json` ghi `"bullmq": "^5.79.2"` + `"ioredis": "^5.11.1"`. `qlts/api/src/worker/worker.ts` dùng `new Queue(..., { connection })` và `repeat: { every: SWEEP_EVERY_MS }` (dòng 52–111).
- **Breaking v6 (changelog chính thức docs.bullmq.io):** (a) tham số `connection` bị thay bằng `BackendFactory` — "High-level classes no longer expose Redis internals"; (b) **legacy repeatable jobs bị xóa hẳn** — option `repeat` trên `Queue#add`, `getRepeatableJobs()`, `removeRepeatable*()` không còn (phải chuyển sang Job Scheduler); (c) `ioredis` không còn là dependency trực tiếp, thành optional peer dependency; (d) `Worker#resume()` thành async.
- **Hệ quả:** AD-12 "copy nguyên `outbox/`+`queue/`" + Seed pin `bullmq 6.1.2` không thể cùng đúng — code copy sẽ không chạy trên v6.
- **Đề nghị:** hoặc pin `bullmq ^5` (đồng bộ QLTS, đường copy sạch nhất — v5 vẫn được maintain), hoặc giữ 6.1.2 và ghi rõ trong AD-12/Seed rằng `worker.ts` phải port sang API v6 (BackendFactory + Job Scheduler + cài `ioredis` tường minh) — chi phí port hiện chưa được ghi nhận ở đâu.

### F-2 · MAJOR — "Raw SQL, không ORM — pattern `assets` QLTS" mô tả sai thực tế QLTS

- **Bằng chứng:** 63 file trong `qlts/api/src` import `drizzle-orm`; `database.module.ts` khởi tạo `drizzle(node-postgres)`; chính module `assets` được viện dẫn (`assets-query.ts`) dùng query builder drizzle (`and/eq/ilike/or/sql`) trên `assetsTable`/`usersTable`. `common/sql.ts` thực tế chỉ là helper `escapeLike()` cho LIKE/ILIKE, không phải tầng data-access raw SQL.
- **Hệ quả:** (a) khẳng định nền tảng của AD-1 dựa trên một pattern QLTS **không tồn tại như mô tả**; (b) mâu thuẫn nội tại với AD-12: copy nguyên `audit/` (audit.schema.ts, audit-query.service.ts), `outbox/` (outbox.service.ts), `sessions.schema.ts` sẽ kéo `drizzle-orm` vào repo — vi phạm ngay rule "không ORM" của chính spine.
- **Đề nghị:** chọn một trong hai và ghi tường minh: (1) chấp nhận drizzle-orm như QLTS (đường copy rẻ nhất, sửa lại phát biểu AD-1), hoặc (2) giữ "raw SQL thuần pg" thì AD-12 phải đổi từ "copy nguyên" thành "port bỏ drizzle" cho audit/outbox/files/sessions — chi phí viết lại này chưa được ghi nhận.

### F-3 · MEDIUM — exceljs 4.4.0 đúng version nhưng là package ngừng bảo trì

- **Bằng chứng:** publish cuối 2024-12-20 (~20 tháng); GitHub có discussion chính thức "Issues with the maintaining of ExcelJS" (#2884), "Intent to fork — maintainers attention required" (#2764) và community fork "ExcelJS Community Fork — Fixing Critical Bugs" (#2987); các fork active như `devextreme-exceljs-fork` (publish 8/2026, API-compatible).
- **Hệ quả:** import/export Excel là đường dữ liệu chính (FR-003) mà lib nền không nhận bugfix/security fix upstream.
- **Đề nghị:** chấp nhận rủi ro có ghi chú (QLTS cũng đang dùng 4.4.0 nên tương thích copy), hoặc pin fork maintained API-compatible; tối thiểu thêm một dòng nhận rủi ro vào Seed.

### F-4 · MINOR — Redis version chưa pin trong compose

- BullMQ khuyến nghị tối thiểu Redis 6.2 (docs "Redis™ Compatibility"; dưới ngưỡng chỉ là warning). Seed ghi "Redis/BullMQ, docker-compose 5 service" nhưng không pin image. Đề nghị ghi `redis:7-alpine` (hoặc 7.x cụ thể) để khỏi trôi theo `latest`.

### F-5 · MINOR — csrf-csrf là adoption mới, khác pattern csrf hiện có của QLTS

- QLTS không dùng `csrf-csrf` (không có trong package.json) — csrf của QLTS là guard tự viết + cột `csrf_token` trong bảng `sessions`. Spine vừa "kế thừa bảng sessions QLTS" vừa dùng lib `csrf-csrf` 4.x (mô hình double-submit cookie, HMAC theo session identifier) — hai cơ chế chống CSRF khác nhau. Không sai, nhưng nên nói rõ chọn một: dùng `csrf-csrf` thì cột `csrf_token` kế thừa trở thành thừa; hoặc giữ pattern guard QLTS thì không cần lib. Lưu ý thêm: ví dụ/tài liệu trên mạng phần lớn theo API v3, v4 đã đổi chữ ký cấu hình.

## Xác nhận đạt (không flag)

- Toàn bộ 7 version trong Seed khớp `npm view` ngày 2026-08-21 — dòng "đã kiểm chứng npm 2026-08-21" là thật, không phải số bịa từ trí nhớ.
- `otplib` 13.x đã hoạt động trở lại (publish 5/2026) — lo ngại "otplib bỏ hoang" của thời v12 không còn đúng.
- `@node-rs/argon2` 2.1.0: active (8/2026), có prebuilt cho Windows x64 và linux gnu/musl → dev Windows + container Linux đều OK, không cần toolchain build.
- `csrf-csrf` 4.0.3 và `helmet` 8.3.0 là major hiện hành.
- Migration-runner QLTS thật sự có advisory lock + checksum SHA-256 (AD-10 đúng); bảng `sessions` QLTS thật, cột OIDC cần bỏ liệt kê đúng (AD-8 đúng).
- NestJS 11 / Vite 8 / React 19 / pino 10 của QLTS đều là major hiện hành → copy skeleton không mang theo stack lỗi thời.
