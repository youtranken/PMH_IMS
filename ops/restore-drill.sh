#!/usr/bin/env bash
# Diễn tập khôi phục (story 4.3, NFR-02) — chạy trên MÁY SẠCH, không phải máy đang chạy IMS.
#
#   bash ops/restore-drill.sh /duong/dan/ims-20260823-013000.sql.gz
#
# Việc script làm: dựng stack trắng, nạp dump, rồi CHỨNG MINH chìa in trên giấy mở được két.
# Việc script KHÔNG làm: gõ hộ chìa. Người giữ phong bì phải tự gõ — đó chính là thứ đang
# được diễn tập. Nếu chìa chỉ có trong ổ cứng thì hôm ổ cứng chết mới biết là không có chìa.
#
# Điều kiện đỗ: bước 5 in ra ĐÚNG chuỗi bí mật đã cất ở lần tạo secret thử.
set -euo pipefail
cd "$(dirname "$0")/.."

DUMP="${1:?Thiếu đường dẫn file dump .sql.gz}"
[ -f "$DUMP" ] || { echo "Không thấy file $DUMP" >&2; exit 1; }

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "1/5 Dựng stack TRẮNG (xoá sạch dữ liệu cũ trên máy diễn tập)"
echo "    Sẽ xoá volume postgres của máy này. Ctrl-C nếu đang đứng nhầm máy."
read -r -p "    Gõ 'MAY SACH' để tiếp tục: " confirm
[ "$confirm" = "MAY SACH" ] || { echo "Dừng." >&2; exit 1; }
docker compose down -v
docker compose up -d postgres
until docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-ims}" >/dev/null 2>&1; do
  printf '.'
done
echo

step "2/5 Nạp dump"
gzip -dc "$DUMP" | docker compose exec -T postgres psql -U "${POSTGRES_USER:-ims}" -d "${POSTGRES_DB:-ims}" -v ON_ERROR_STOP=1 >/dev/null
rows=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-ims}" -d "${POSTGRES_DB:-ims}" -t -A -c 'SELECT count(*) FROM secret')
echo "    Đã nạp. Bảng secret có $rows dòng (ciphertext)."
[ "$rows" -gt 0 ] || { echo "DỪNG: không có secret nào để giải — dump sai hoặc két rỗng." >&2; exit 1; }

step "3/5 Nạp master key TỪ BẢN GIẤY"
echo "    Mở phong bì niêm phong, gõ lại từng dòng '<version>=<64 ký tự hex>'."
echo "    Gõ xong nhấn Ctrl-D. Ký tự KHÔNG hiện lại trên màn hình là bình thường."
umask 077
cat > ./secrets/master_key
lines=$(grep -cE '^[0-9]+=[0-9a-fA-F]{64}$' ./secrets/master_key || true)
[ "$lines" -ge 1 ] || { echo "DỪNG: không dòng nào đúng dạng '<số>=<64 hex>'." >&2; exit 1; }
echo "    Nhận $lines chìa."

step "4/5 Khởi động api với chìa vừa nạp"
docker compose -f docker-compose.yml -f docker-compose.override.drill.yml up -d --wait api

step "5/5 Giải mã thử một secret"
echo "    Nhập id của secret thử (lấy từ biên bản lần cất, hoặc câu SQL dưới đây):"
docker compose exec -T postgres psql -U "${POSTGRES_USER:-ims}" -d "${POSTGRES_DB:-ims}" \
  -c "SELECT id, label, key_version FROM secret WHERE label ILIKE '%drill%' ORDER BY created_at DESC LIMIT 5"
read -r -p "    Secret id: " secret_id
docker compose exec -T api node scripts/drill-open-secret.mjs "$secret_id"

echo
echo "✓ Diễn tập xong. So chuỗi vừa in với chuỗi ghi trong biên bản lần cất."
echo "  Khớp  → ghi biên bản ĐỖ, niêm phong lại phong bì, ghi ngày diễn tập kế (6 tháng)."
echo "  Lệch  → HỎNG. Đừng sửa vội: ghi lại nguyên trạng rồi truy vì sao (sai version chìa?"
echo "          dump cũ hơn lần xoay chìa? AAD đổi?). Đây đúng là lúc để phát hiện."
