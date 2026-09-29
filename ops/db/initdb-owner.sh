#!/bin/sh
# DB-03: chạy `owner-bootstrap.sql` bằng superuser, BÊN TRONG container postgres.
#
# Hai đường gọi, cùng một file:
#   - Cụm mới: image postgres tự chạy nó từ /docker-entrypoint-initdb.d, đúng một lần lúc initdb.
#   - Cài đã có, hoặc sau khi nạp dump: `bash ops/db-owner-bootstrap.sh` trên host gọi nó qua
#     `docker compose exec`.
#
# Entrypoint của image SOURCE file .sh không có bit thực thi, nên file này không được `exit`:
# `exit 0` giữa chừng sẽ thoát luôn entrypoint trước khi Postgres khởi động thật.
#
# Mật khẩu đi qua biến môi trường của container và `\getenv`, không qua tham số dòng lệnh
# (không hiện trong `ps`). `\o /dev/null` vì `set_config` trả lại chính giá trị vừa đặt.
#
# Không `set -eu`: khi bị source, nó đổi luôn tuỳ chọn của entrypoint. Lỗi được trả ra bằng
# `false` ở nhánh hỏng — đúng cả khi bị source (entrypoint có `set -e`) lẫn khi được thực thi.
: "${MIGRATION_DB_PASSWORD:?thiếu MIGRATION_DB_PASSWORD trong môi trường container postgres}"
if psql -v ON_ERROR_STOP=1 --no-psqlrc -q --username "$POSTGRES_USER" --dbname "${POSTGRES_DB:-$POSTGRES_USER}" <<'EOSQL'
\getenv owner_password MIGRATION_DB_PASSWORD
\o /dev/null
SELECT set_config('ims.owner_role', 'ims_owner', false);
SELECT set_config('ims.owner_password', :'owner_password', false);
\o
\i /ims-db/owner-bootstrap.sql
EOSQL
then
  echo "owner-bootstrap: role ims_owner sở hữu database ${POSTGRES_DB:-$POSTGRES_USER}."
else
  echo "owner-bootstrap THẤT BẠI — xem lỗi psql ở trên." >&2
  false
fi
