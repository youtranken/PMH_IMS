#!/usr/bin/env bash
# Diễn tập khôi phục (NFR-02) — chạy trên MÁY SẠCH (hoặc VM mới), không phải máy đang chạy IMS.
#
#   bash ops/restore-drill.sh /nas/ims-20260823-013000.sql.gz [/nas/files-20260823-013000.tgz]
#
# Việc script làm: dựng stack trắng, nạp dump + file đính kèm, kiểm quyền của ims_app, rồi
# CHỨNG MINH chìa in trên giấy mở được két. Việc script KHÔNG làm: gõ hộ chìa — người giữ phong
# bì phải tự gõ, vì đó chính là thứ đang được diễn tập.
#
# Cần có sẵn trên máy diễn tập: repo, `.env` (mật khẩu RIÊNG của máy diễn tập, không dùng mật khẩu
# prod), `secrets/password_pepper`, `secrets/smtp_password`. Pepper KHÔNG cần là pepper thật: diễn
# tập chỉ mở két, không đăng nhập.
#
# Biến môi trường (chỉ dùng khi tự động hoá bài thử, KHÔNG dùng trong buổi diễn tập thật):
#   IMS_DRILL_KEY_FILE   đọc master key từ file thay vì gõ tay
#   COMPOSE_PROJECT_NAME tách stack diễn tập khỏi stack khác trên cùng máy
#
# Điều kiện đỗ: bước cuối in ra ĐÚNG chuỗi bí mật đã ghi ở biên bản lần cất.
set -euo pipefail
cd "$(dirname "$0")/.."

DUMP="${1:?Thiếu đường dẫn file dump .sql.gz}"
FILES="${2:-}"
[ -f "$DUMP" ] || { echo "Không thấy file $DUMP" >&2; exit 1; }
[ -z "$FILES" ] || [ -f "$FILES" ] || { echo "Không thấy file $FILES" >&2; exit 1; }
for s in password_pepper smtp_password; do
  [ -f "secrets/$s" ] || { echo "Thiếu secrets/$s — tạo trước (xem secrets/README.md)." >&2; exit 1; }
done

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
die() { echo "DỪNG: $*" >&2; exit 1; }
# psql/pg_isready dùng user/DB từ môi trường CỦA CONTAINER, không phụ thuộc shell của người chạy.
pg() { docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 $*"; }

step "1/6 Kiểm đây KHÔNG phải máy đang chạy IMS"
if [ -n "$(docker compose ps -q postgres 2>/dev/null)" ]; then
  live=$(pg "-t -A -c 'SELECT count(*) FROM users'" 2>/dev/null || echo 0)
  [ "${live:-0}" -eq 0 ] || die "postgres của project này đang chạy và có $live tài khoản — đây là máy thật. Diễn tập trên máy/VM khác."
fi
echo "    Sẽ XOÁ mọi volume của project '$(basename "$PWD")${COMPOSE_PROJECT_NAME:+ ($COMPOSE_PROJECT_NAME)}' trên máy này."
read -r -p "    Gõ 'MAY SACH' để tiếp tục: " confirm
[ "$confirm" = "MAY SACH" ] || die "không xác nhận."
docker compose down -v
docker compose up -d postgres
for _ in $(seq 1 60); do
  docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER"' >/dev/null 2>&1 && break
  sleep 1
done
docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER"' >/dev/null || die "postgres không lên sau 60 giây."

step "2/6 Nạp dump"
# Dump mang GRANT cho ims_app, nên role phải có trước khi nạp. api sẽ đặt mật khẩu khi khởi động.
pg "-q -c \"DO \\\$\\\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ims_app') THEN CREATE ROLE ims_app NOLOGIN; END IF; END \\\$\\\$;\""
gzip -dc "$DUMP" | pg "-q" >/dev/null
rows=$(pg "-t -A -c 'SELECT count(*) FROM secret'")
echo "    Bảng secret có $rows dòng (ciphertext)."
[ "$rows" -gt 0 ] || die "không có secret nào để giải — dump sai hoặc két rỗng."
granted=$(pg "-t -A -c \"SELECT has_table_privilege('ims_app', 'secret', 'SELECT')\"")
[ "$granted" = "t" ] || die "ims_app KHÔNG có quyền đọc bảng secret — dump thiếu GRANT (tạo bằng bản backup-nightly cũ?)."
echo "    ims_app có quyền đọc bảng: đúng."
# DB-03: dump nạp bằng superuser với --no-owner nên mọi bảng đang thuộc superuser; `migrate`
# (đăng nhập bằng ims_owner) sẽ chết ở câu ALTER đầu tiên nếu không giao lại.
docker compose exec -T postgres sh /ims-db/initdb-owner.sh

step "3/6 Nạp file đính kèm"
if [ -n "$FILES" ]; then
  docker compose run --rm --no-deps -T --entrypoint sh api -c 'tar xzf - -C /data/files' < "$FILES"
  echo "    Đã giải nén $(tar tzf - < "$FILES" | grep -vc '/$' || true) file."
else
  echo "    Bỏ qua (không truyền file files-*.tgz)."
fi

step "4/6 Nạp master key TỪ BẢN GIẤY"
umask 077
if [ -n "${IMS_DRILL_KEY_FILE:-}" ]; then
  cp "$IMS_DRILL_KEY_FILE" ./secrets/master_key
else
  echo "    Mở phong bì niêm phong, gõ lại từng dòng '<version>=<64 ký tự hex>'. Gõ xong nhấn Ctrl-D."
  cat > ./secrets/master_key
fi
lines=$(grep -cE '^[0-9]+=[0-9a-fA-F]{64}$' ./secrets/master_key || true)
[ "$lines" -ge 1 ] || die "không dòng nào đúng dạng '<số>=<64 hex>'."
echo "    Nhận $lines chìa."
if [ "$(stat -c %u ./secrets/master_key 2>/dev/null || echo 1000)" != "1000" ]; then
  echo "    Lưu ý: container chạy uid 1000. Nếu api không đọc được chìa: sudo chown 1000:1000 secrets/master_key"
fi

step "5/6 Khởi động api với chìa vừa nạp"
docker compose -f docker-compose.yml -f docker-compose.override.drill.yml up -d --wait api

step "6/6 Giải mã thử một secret"
pg "-c \"SELECT id, label, key_version FROM secret WHERE label ILIKE '%drill%' ORDER BY created_at DESC LIMIT 5\""
read -r -p "    Secret id: " secret_id
docker compose exec -T api node scripts/drill-open-secret.mjs "$secret_id"

echo
echo "✓ Diễn tập xong. So chuỗi vừa in với chuỗi ghi trong biên bản lần cất."
echo "  Khớp  → ghi biên bản ĐỖ, niêm phong lại phong bì, hẹn lần diễn tập kế (mỗi quý)."
echo "  Lệch  → HỎNG. Ghi lại nguyên trạng rồi truy vì sao (sai version chìa? dump cũ hơn lần"
echo "          xoay chìa?). Đây đúng là lúc để phát hiện."
echo "  Xong buổi: xoá hẳn VM diễn tập. 'shred' không đáng tin trên SSD/VM."
