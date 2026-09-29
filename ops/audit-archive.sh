#!/usr/bin/env bash
# Lưu trữ ngăn năm cũ của audit_log (OLD-DB-03): tách khỏi bảng cha, dump sang thư mục sao lưu.
#
#   bash ops/audit-archive.sh /mnt/nas/ims-backup            # chỉ LIỆT KÊ ngăn sẽ lưu trữ
#   bash ops/audit-archive.sh /mnt/nas/ims-backup --yes      # tách + dump, GIỮ bảng trong DB
#   bash ops/audit-archive.sh /mnt/nas/ims-backup --yes --drop   # tách + dump + xoá khỏi DB
#
# KHÔNG đặt cron. Nhật ký giữ vĩnh viễn theo NFR-03; đưa một năm nhật ký ra khỏi DB đang chạy là
# việc người trực làm có chủ đích và ký nhận, không phải việc một lịch chạy lặng lẽ làm. Xem
# docs/RUNBOOK-4.3-dong-dot-1.md mục H1.
#
# Ngưỡng: `audit.archive_after_years` trong system_config (mặc định 2). Một ngăn được lưu trữ
# khi MỌI dòng của nó cũ hơn ngần ấy năm (cận trên của ngăn <= now() - N năm). Ngăn năm nay,
# năm sau và DEFAULT không bao giờ bị đụng.
#
# Mỗi ngăn lưu trữ ra một file `audit_log_<năm>-<stamp>.dump` (pg_dump custom). Ngăn tách ra được
# đổi tên thành `audit_archive_<năm>`, để lượt sweep không tưởng nhầm là ngăn còn thiếu.
#
# Biến môi trường:
#   IMS_BACKUP_ALLOW_LOCAL=1  cho phép đích KHÔNG phải mount point (chỉ để thử trên máy dev)
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${1:?Thiếu thư mục đích, vd /mnt/nas/ims-backup}"
shift
DO_IT=0
DO_DROP=0
for arg in "$@"; do
  case "$arg" in
    --yes) DO_IT=1 ;;
    --drop) DO_DROP=1 ;;
    *) echo "Tham số lạ: $arg" >&2; exit 2 ;;
  esac
done
STAMP="$(date +%Y%m%d-%H%M%S)"

die() { echo "DỪNG: $*" >&2; exit 1; }

# Tên user/DB đọc từ môi trường CỦA CONTAINER, như backup-nightly.sh.
psql_q() {
  docker compose exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -t -A -q' <<<"$1"
}

[ -d "$DEST" ] || die "không thấy thư mục đích $DEST."
if [ "${IMS_BACKUP_ALLOW_LOCAL:-0}" != "1" ] && ! mountpoint -q "$DEST"; then
  die "$DEST không phải mount point — NAS chưa mount? File lưu trữ sẽ nằm lại trên chính máy chủ."
fi
[ "$DO_DROP" = 0 ] || [ "$DO_IT" = 1 ] || die "--drop chỉ đi cùng --yes."

YEARS="$(psql_q "SELECT COALESCE((SELECT value #>> '{}' FROM system_config WHERE key = 'audit.archive_after_years'), '2');")"
[[ "$YEARS" =~ ^[0-9]+$ ]] && [ "$YEARS" -ge 1 ] \
  || die "audit.archive_after_years = '$YEARS' — phải là số nguyên >= 1."

# Chỉ ngăn đúng khuôn `audit_log_<năm>` do 0302 dựng; ranh giới năm là UTC như 0302.
CANDIDATES="$(psql_q "
  SELECT c.relname
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
   WHERE i.inhparent = 'public.audit_log'::regclass
     AND c.relname ~ '^audit_log_[0-9]{4}\$'
     AND make_timestamptz(substring(c.relname FROM '[0-9]{4}')::int + 1, 1, 1, 0, 0, 0, 'UTC')
         <= now() - make_interval(years => $YEARS)
   ORDER BY c.relname;")"

if [ -z "$CANDIDATES" ]; then
  echo "✓ Không có ngăn nào cũ hơn $YEARS năm. Không làm gì."
  exit 0
fi

echo "Ngăn cũ hơn $YEARS năm:"
for part in $CANDIDATES; do
  echo "  $part — $(psql_q "SELECT count(*) FROM $part;") dòng"
done

if [ "$DO_IT" != 1 ]; then
  echo "Chưa làm gì. Chạy lại với --yes để tách và dump."
  exit 0
fi

for part in $CANDIDATES; do
  year="${part#audit_log_}"
  archived="audit_archive_$year"
  file="$DEST/audit_log_$year-$STAMP.dump"
  rows="$(psql_q "SELECT count(*) FROM $part;")"

  echo "▸ Tách $part khỏi audit_log → $archived"
  psql_q "BEGIN;
          ALTER TABLE audit_log DETACH PARTITION $part;
          ALTER TABLE $part RENAME TO $archived;
          COMMIT;" >/dev/null

  echo "▸ pg_dump $archived → $file"
  docker compose exec -T postgres sh -c \
    "pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --format=custom -t public.$archived" \
    > "$file.tmp"
  docker compose exec -T postgres pg_restore --list < "$file.tmp" \
    | grep -q "TABLE DATA public $archived" \
    || die "$file.tmp không có dữ liệu của $archived — GIỮ NGUYÊN bảng trong DB, không xoá."
  mv "$file.tmp" "$file"
  echo "  $rows dòng, $(du -h "$file" | cut -f1)"

  if [ "$DO_DROP" = 1 ]; then
    echo "▸ Xoá $archived khỏi DB"
    psql_q "DROP TABLE $archived;" >/dev/null
  else
    echo "  $archived vẫn nằm trong DB (ngoài audit_log). Kiểm file xong thì xoá tay:"
    echo "  docker compose exec postgres sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"DROP TABLE $archived;\"'"
  fi
done

echo "✓ Xong. File lưu trữ nằm ở $DEST. Khôi phục một năm: xem RUNBOOK mục H1."
