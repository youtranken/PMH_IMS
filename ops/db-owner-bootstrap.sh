#!/usr/bin/env bash
# DB-03: giao database cho role chủ sở hữu `ims_owner` (không superuser) trên một nơi cài ĐÃ CÓ
# dữ liệu, hoặc ngay sau khi nạp dump.
#
#   bash ops/db-owner-bootstrap.sh
#
# Cụm mới không cần script này: image postgres tự chạy `ops/db/initdb-owner.sh` lúc initdb.
# Cụm đã có thì initdb không bao giờ chạy lại, và mọi bảng đang thuộc superuser, nên service
# `migrate` (giờ đăng nhập bằng `ims_owner`) sẽ không lên cho tới khi chạy script này.
#
# Chạy lại được bao nhiêu lần cũng được. Nó KHÔNG dừng api/worker; chỉ tạo lại container
# postgres nếu cấu hình của nó đổi (lần đầu sau khi nâng cấp: thêm biến + mount) — vài giây.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -f .env ] || die "Không thấy .env ở $(pwd)."
grep -qE '^MIGRATION_DB_PASSWORD=.+' .env ||
  die ".env chưa có MIGRATION_DB_PASSWORD. Thêm: echo \"MIGRATION_DB_PASSWORD=\$(openssl rand -hex 24)\" >> .env"

# `up` chứ không `restart`: container cũ không có biến MIGRATION_DB_PASSWORD lẫn mount /ims-db.
docker compose up -d --wait postgres
docker compose exec -T postgres sh /ims-db/initdb-owner.sh
