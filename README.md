# IMS — Quản lý hệ thống IT (PMH)

Hệ thống nội bộ LAN-only quản lý thiết bị, phần mềm/license, địa chỉ IP, két sắt mật khẩu,
phiếu ISO và sự cố. Kiến trúc: **modular monolith** NestJS + React (Vite) + Postgres + Redis,
5 service docker, TLS terminate tại `web`.

| Cần gì | Đọc ở đâu |
| --- | --- |
| Luật kiến trúc AD-1..AD-15 | `_bmad-output/planning-artifacts/architecture/architecture-IMS-2026-08-21/ARCHITECTURE-SPINE.md` |
| Yêu cầu FR/NFR | `_bmad-output/planning-artifacts/prds/prd-IMS-2026-08-19/prd.md` |
| Epic & story + AC | `_bmad-output/planning-artifacts/epics.md` |
| Thứ dùng chung (đọc TRƯỚC khi viết mới) | `docs/SHARED-REGISTRY.md` |
| Epic trước để lại gì | `docs/EPIC-MAP.md` |
| Quy tắc làm việc (TDD, DoD, đóng epic) | `CLAUDE.md` |

## Cài lên production (Ubuntu)

```bash
git clone https://github.com/youtranken/PMH_IMS.git /opt/ims && cd /opt/ims
git checkout <tag-phát-hành>
bash ops/install-ubuntu.sh
```

Chi tiết và các việc phải làm tay (phong bì chìa, diễn tập khôi phục, nhập dữ liệu):
`docs/RUNBOOK-4.3-dong-dot-1.md`.

## Chạy lần đầu (dev)

```bash
# 1. Bí mật (AD-11 — file, không phải env). Xem thêm secrets/README.md
mkdir -p secrets ops/certs
echo "1=$(openssl rand -hex 32)" > secrets/master_key
openssl rand -hex 32 > secrets/password_pepper
: > secrets/smtp_password

# 2. Chứng chỉ dev tự ký (prod: copy cert wildcard *.pmh.com.vn vào ops/certs)
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout ops/certs/privkey.pem -out ops/certs/fullchain.pem \
  -subj "/CN=ims.pmh.com.vn" \
  -addext "subjectAltName=DNS:ims.pmh.com.vn,DNS:localhost,IP:127.0.0.1"

# 3. Cấu hình
cp .env.example .env      # sửa mật khẩu Postgres/Redis, APP_BASE_URL

# 4. Dựng (profile dev kèm mailpit — hộp thư giả)
docker compose --profile dev up -d --build

# 5. Tạo tài khoản đầu tiên
docker compose exec api node dist/ops/seed-sa.main.js   # in mật khẩu tạm MỘT lần
```

Mở https://localhost (dev) hoặc https://ims.pmh.com.vn (prod). Hộp thư dev: http://localhost:8025

Lần đăng nhập đầu: nhập mật khẩu tạm → quét QR cài xác thực 2 lớp → đổi mật khẩu.

## Kiểm tra

```bash
bash ops/ci-local.sh          # lint + ranh giới module + test đơn vị + build (đúng bộ CI)
bash ops/ci-local.sh --e2e    # kèm E2E Playwright trên stack đang chạy
```

| Lệnh | Làm gì |
| --- | --- |
| `npm --prefix api test` | Test đơn vị API (Jest) — lockout, phiên, TOTP, envelope, phân trang, export |
| `npm --prefix web test` | Test đơn vị web (Vitest) — luật hạn, điều hướng đăng nhập, api-client |
| `npm --prefix api run depcruise` | Ép ranh giới module acyclic (AD-2) |
| `cd e2e && npx playwright test` | E2E trên stack thật, gồm 3 kịch bản viewport 390px |

## Cấu trúc

```
api/          NestJS — modules/{auth,users,audit,outbox,queue,files,config-sys,mail} + common/ + migrations/
web/          React (Vite) — ui/ (bộ dùng chung), lib/, shell/, features/, css/ (tokens.css = nguồn màu duy nhất)
e2e/          Playwright — chạy trên docker compose thật
ops/          ci-local.sh, certs/
docs/         SHARED-REGISTRY.md, EPIC-MAP.md, mau-du-lieu/
secrets/      master_key, password_pepper, smtp_password (KHÔNG commit)
```

## Vận hành

| Việc | Lệnh / ghi chú |
| --- | --- |
| Xem log | `docker compose logs -f api worker` |
| Backup | `pg_dump` đêm ra NAS tách máy — **không kèm master key** (NFR-02) |
| Xoay chìa mã hóa | Thêm dòng version mới vào `secrets/master_key`, giữ dòng cũ — xem `secrets/README.md` |
| Restore drill | Mỗi quý, có biên bản (NFR-02) |
| Đá phiên / khóa tài khoản | SA vào màn **Quản trị › Tài khoản** |
