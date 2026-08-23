#!/usr/bin/env bash
# Sao lưu hằng đêm (story 4.3, NFR-02).
#
#   bash ops/backup-nightly.sh /mnt/nas/ims-backup
#
# Chạy bằng cron trên máy chủ IMS, ví dụ 01:30 mỗi đêm:
#   30 1 * * * cd /opt/ims && bash ops/backup-nightly.sh /mnt/nas/ims-backup >> /var/log/ims-backup.log 2>&1
#
# LUẬT KHÔNG ĐƯỢC PHÁ: bản sao lưu KHÔNG kèm master key.
#   Dump chứa ciphertext của két sắt. Nếu để chung chìa với ổ khóa trên cùng một NAS thì
#   ai lấy được NAS là mở được hết — cả lớp envelope thành ra trang trí. Chìa nằm ở hai
#   phong bì niêm phong (AR-9), KHÔNG bao giờ nằm cạnh dump.
#   Script này cố ý không đọc ./secrets/ và sẽ DỪNG nếu thấy master key trong thư mục đích.
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${1:?Thiếu thư mục đích, vd /mnt/nas/ims-backup}"
KEEP_DAYS="${IMS_BACKUP_KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DEST/ims-$STAMP.sql.gz"

[ -d "$DEST" ] || { echo "Không thấy thư mục đích $DEST — NAS đã mount chưa?" >&2; exit 1; }

# Hàng rào: chìa không được nằm cùng chỗ với dump.
if find "$DEST" -maxdepth 2 -name 'master_key*' -print -quit | grep -q .; then
  echo "DỪNG: có file master key trong $DEST. Sao lưu và chìa PHẢI tách máy (NFR-02)." >&2
  exit 1
fi

echo "▸ pg_dump → $FILE"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-ims}" -d "${POSTGRES_DB:-ims}" \
  --format=plain --no-owner --no-privileges | gzip -9 > "$FILE"

# Dump rỗng vẫn tạo ra file .gz hợp lệ vài chục byte — kiểm nội dung, không chỉ kiểm tồn tại.
SIZE=$(gzip -l "$FILE" | awk 'NR==2 {print $2}')
if [ "${SIZE:-0}" -lt 100000 ]; then
  echo "DỪNG: dump chỉ $SIZE byte sau giải nén — nghi là hỏng, KHÔNG xoá bản cũ." >&2
  exit 1
fi
if ! gzip -dc "$FILE" | grep -q 'CREATE TABLE public.secret'; then
  echo "DỪNG: dump không có bảng secret — sai database hay dump nửa chừng." >&2
  exit 1
fi

echo "▸ Dọn bản cũ hơn $KEEP_DAYS ngày"
find "$DEST" -maxdepth 1 -name 'ims-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

echo "✓ Xong: $FILE ($(du -h "$FILE" | cut -f1))"
echo "  Nhắc: chìa master key KHÔNG nằm ở đây. Diễn tập khôi phục 6 tháng/lần —"
echo "  xem docs/RUNBOOK-4.3-dong-dot-1.md."
