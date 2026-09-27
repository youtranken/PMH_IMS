#!/usr/bin/env bash
# Sao lưu hằng đêm (NFR-02): database + file đính kèm.
#
#   bash ops/backup-nightly.sh /mnt/nas/ims-backup
#
# Cron trên máy chủ IMS (Ubuntu), 01:30 mỗi đêm:
#   30 1 * * * cd /opt/ims && bash ops/backup-nightly.sh /mnt/nas/ims-backup >> /var/log/ims-backup.log 2>&1
#
# Mỗi lượt tạo hai file:
#   ims-<stamp>.sql.gz    pg_dump GIỮ quyền (GRANT/DEFAULT PRIVILEGES cho ims_app). Bỏ quyền thì
#                         bản khôi phục lên được nhưng ims_app không đọc được bảng nào.
#   files-<stamp>.tgz     volume file đính kèm (/data/files).
#
# LUẬT KHÔNG ĐƯỢC PHÁ: bản sao lưu KHÔNG kèm master key hay pepper. Dump chứa ciphertext của két
# và hash mật khẩu; để chung chỗ với chìa thì ai lấy được NAS là mở được hết. Chìa và pepper nằm
# trong phong bì niêm phong (xem docs/RUNBOOK-4.3-dong-dot-1.md). Script DỪNG nếu thấy chúng ở đích.
#
# Biến môi trường:
#   IMS_BACKUP_KEEP_DAYS   số ngày giữ bản cũ (mặc định 30)
#   IMS_BACKUP_ALLOW_LOCAL=1  cho phép đích KHÔNG phải mount point (chỉ để thử trên máy dev)
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${1:?Thiếu thư mục đích, vd /mnt/nas/ims-backup}"
KEEP_DAYS="${IMS_BACKUP_KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_FILE="$DEST/ims-$STAMP.sql.gz"
FILES_FILE="$DEST/files-$STAMP.tgz"

die() { echo "DỪNG: $*" >&2; exit 1; }

[ -d "$DEST" ] || die "không thấy thư mục đích $DEST."
# NAS chưa mount thì thư mục mount point vẫn tồn tại trên đĩa máy chủ: kiểm [ -d ] là chưa đủ.
if [ "${IMS_BACKUP_ALLOW_LOCAL:-0}" != "1" ] && ! mountpoint -q "$DEST"; then
  die "$DEST không phải mount point — NAS chưa mount? Bản sao lưu sẽ nằm lại trên chính máy chủ."
fi

if find "$DEST" -maxdepth 2 \( -name 'master_key*' -o -name 'password_pepper*' \) -print -quit | grep -q .; then
  die "có master key/pepper trong $DEST. Sao lưu và chìa PHẢI tách chỗ (NFR-02)."
fi

# Ghi ra .tmp, kiểm xong mới đổi tên: người khôi phục chọn file mới nhất, nên file dở dang
# không bao giờ được mang tên thật.
cleanup() { rm -f "$DB_FILE.tmp" "$FILES_FILE.tmp"; }
trap cleanup EXIT

echo "▸ pg_dump → $DB_FILE"
# Tên user/DB đọc từ môi trường CỦA CONTAINER: cron không nạp .env của host.
docker compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=plain --no-owner' \
  | gzip -9 > "$DB_FILE.tmp"

SIZE=$(gzip -l "$DB_FILE.tmp" | awk 'NR==2 {print $2}')
[ "${SIZE:-0}" -ge 100000 ] || die "dump chỉ ${SIZE:-0} byte sau giải nén — nghi hỏng, KHÔNG xoá bản cũ."
# `grep -c` đọc hết đầu vào nên gzip không bị cắt ngang (SIGPIPE) như `grep -q` dưới pipefail.
count_in_dump() { gzip -dc "$DB_FILE.tmp" | grep -c "$1" || true; }
[ "$(count_in_dump 'CREATE TABLE public.secret')" -ge 1 ] || die "dump không có bảng secret — sai database hay dump nửa chừng."
[ "$(count_in_dump 'TO ims_app')" -ge 1 ] || die "dump không có GRANT cho ims_app — khôi phục ra sẽ không dùng được."
mv "$DB_FILE.tmp" "$DB_FILE"

echo "▸ File đính kèm → $FILES_FILE"
docker compose exec -T api sh -c 'tar czf - -C /data/files .' > "$FILES_FILE.tmp"
tar tzf - < "$FILES_FILE.tmp" > /dev/null || die "file nén đính kèm hỏng."
mv "$FILES_FILE.tmp" "$FILES_FILE"

echo "▸ Dọn bản cũ hơn $KEEP_DAYS ngày"
find "$DEST" -maxdepth 1 \( -name 'ims-*.sql.gz' -o -name 'files-*.tgz' \) -mtime "+$KEEP_DAYS" -delete

echo "✓ Xong: $(basename "$DB_FILE") ($(du -h "$DB_FILE" | cut -f1)), $(basename "$FILES_FILE") ($(du -h "$FILES_FILE" | cut -f1))"
echo "  Nhắc: master key và pepper KHÔNG nằm ở đây. Diễn tập khôi phục mỗi quý — xem RUNBOOK."
