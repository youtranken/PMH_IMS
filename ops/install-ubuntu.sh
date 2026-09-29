#!/usr/bin/env bash
# Cài IMS lần đầu trên máy chủ Ubuntu (tự động hoá mục A → D của docs/RUNBOOK-4.3-dong-dot-1.md).
#
#   git clone https://github.com/youtranken/PMH_IMS.git /opt/ims && cd /opt/ims
#   git checkout <tag-phát-hành>
#   bash ops/install-ubuntu.sh
#
# Script hỏi những gì chỉ người biết (tên miền, SMTP, App Password, email SA), tự sinh mọi mật
# khẩu và bí mật, dựng stack, tạo 2 SA, đặt cron sao lưu + giám sát. Chạy lại được: bước nào đã
# xong (file đã có, SA đã có, cron đã đặt) thì bỏ qua, KHÔNG ghi đè bí mật đã sinh.
#
# Không làm hộ (vì cần tay người): in chìa ra giấy + niêm phong phong bì (RUNBOOK mục C), diễn tập
# khôi phục trên VM khác (mục E), nhập dữ liệu thật (mục F).
set -euo pipefail
cd "$(dirname "$0")/.."

bold() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
ask() { local var="$1" prompt="$2" def="${3:-}"; local v; read -r -p "  $prompt${def:+ [$def]}: " v; printf -v "$var" '%s' "${v:-$def}"; }
secret() { openssl rand -hex 24; }

# ─── 1. Điều kiện ───
bold "1/7 Kiểm điều kiện máy"
[ "$(uname -s)" = "Linux" ] || die "Script này cho Ubuntu/Linux."
command -v docker >/dev/null || die "Chưa có docker. Cài: curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker \$USER (rồi đăng nhập lại)."
docker compose version >/dev/null 2>&1 || die "Thiếu docker compose plugin."
docker info >/dev/null 2>&1 || die "User $(whoami) chưa dùng được docker (chưa vào nhóm docker? đăng xuất/đăng nhập lại)."
command -v openssl >/dev/null || die "Thiếu openssl (sudo apt-get install -y openssl)."
for port in 80 443; do
  if ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN; then
    warn "Cổng $port đang có tiến trình khác giữ — web sẽ không lên được cho tới khi giải phóng nó."
  fi
done
ok "docker $(docker version --format '{{.Server.Version}}'), compose $(docker compose version --short)"

# ─── 2. .env ───
bold "2/7 Cấu hình .env"
if [ -f .env ]; then
  ok ".env đã có — giữ nguyên (xoá nó đi nếu muốn tạo lại)."
else
  ask DOMAIN "Tên miền IMS" "ims.pmh.com.vn"
  ask SMTP_USER "Hộp thư gửi (Google Workspace)" "ims@pmh.com.vn"
  cat > .env <<EOF
NODE_ENV=production
POSTGRES_USER=ims
POSTGRES_PASSWORD=$(secret)
POSTGRES_DB=ims
MIGRATION_DB_PASSWORD=$(secret)
APP_DB_PASSWORD=$(secret)
REDIS_PASSWORD=$(secret)
APP_BASE_URL=https://$DOMAIN
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=$SMTP_USER
TLS_CERT_DIR=./ops/certs
EOF
  chmod 600 .env
  ok ".env đã tạo với mật khẩu ngẫu nhiên (chmod 600)."
fi
# DB-03: .env của bản cài trước chưa có mật khẩu role chủ sở hữu. Thêm vào chứ không tạo lại
# .env, vì các mật khẩu còn lại đang khớp với DB đã có.
if ! grep -qE '^MIGRATION_DB_PASSWORD=.+' .env; then
  echo "MIGRATION_DB_PASSWORD=$(secret)" >> .env
  ok "Đã thêm MIGRATION_DB_PASSWORD (role chủ sở hữu ims_owner) vào .env."
fi
grep -q 'doi-mat-khau-nay' .env && die ".env còn mật khẩu mẫu 'doi-mat-khau-nay' — sửa trước khi tiếp tục."
grep -q '^NODE_ENV=production' .env || warn "NODE_ENV trong .env không phải production."

# ─── 3. Bí mật ───
bold "3/7 Bí mật (secrets/)"
umask 077
mkdir -p secrets
if [ -s secrets/master_key ]; then ok "secrets/master_key đã có — giữ nguyên."; else
  echo "1=$(openssl rand -hex 32)" > secrets/master_key; ok "Đã sinh master key (version 1)."; fi
if [ -s secrets/password_pepper ]; then ok "secrets/password_pepper đã có — giữ nguyên."; else
  openssl rand -hex 32 > secrets/password_pepper; ok "Đã sinh pepper."; fi
if [ -f secrets/smtp_password ]; then ok "secrets/smtp_password đã có — giữ nguyên."; else
  read -r -s -p "  App Password của hộp thư SMTP (không hiện khi gõ): " smtp_pw; echo
  printf '%s' "$smtp_pw" > secrets/smtp_password; ok "Đã lưu mật khẩu SMTP."; fi
if [ "$(stat -c %u secrets/master_key)" != "1000" ]; then
  echo "  Container chạy uid 1000 — cần sudo để đổi chủ secrets/:"
  sudo chown 1000:1000 secrets/master_key secrets/password_pepper secrets/smtp_password
fi
chmod 600 secrets/master_key secrets/password_pepper secrets/smtp_password
ok "secrets/*: chủ uid 1000, chmod 600."

# ─── 4. Cert ───
bold "4/7 Chứng chỉ TLS"
if [ ! -s ops/certs/fullchain.pem ] || [ ! -s ops/certs/privkey.pem ]; then
  echo "  Cần hai file: ops/certs/fullchain.pem (cert + chuỗi trung gian) và ops/certs/privkey.pem."
  ask CRT "Đường dẫn file cert (.crt/.pem)" ""
  ask CHAIN "Đường dẫn file chuỗi trung gian (bỏ trống nếu cert đã kèm)" ""
  ask KEY "Đường dẫn khoá riêng (.key)" ""
  [ -f "$CRT" ] && [ -f "$KEY" ] || die "Không thấy file cert/khoá."
  cat "$CRT" ${CHAIN:+"$CHAIN"} > ops/certs/fullchain.pem
  cp "$KEY" ops/certs/privkey.pem
fi
chmod 600 ops/certs/privkey.pem
openssl x509 -checkend 0 -noout -in ops/certs/fullchain.pem >/dev/null || die "Cert đã hết hạn."
ok "Cert: $(openssl x509 -noout -subject -in ops/certs/fullchain.pem | sed 's/^subject=//'), hết hạn $(openssl x509 -noout -enddate -in ops/certs/fullchain.pem | cut -d= -f2)"

# ─── 5. Dựng ───
bold "5/7 Dựng và khởi động (vài phút lần đầu)"
# DB-03: `migrate` đăng nhập bằng `ims_owner`. Cụm mới đã có role từ initdb; cụm cài từ bản cũ
# thì chưa, và bảng còn thuộc superuser. Script chạy lại được nên gọi cả hai trường hợp.
bash ops/db-owner-bootstrap.sh
ok "Role chủ sở hữu ims_owner sở hữu database (không superuser)."
docker compose up -d --build --wait
docker compose ps
ok "Stack đã lên. Migration: $(docker compose logs migrate 2>/dev/null | grep -cE 'Migration applied') file mới áp."

# ─── 6. SA ───
bold "6/7 Tài khoản SA đầu tiên"
has_sa=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "SELECT count(*) FROM users WHERE role = '"'"'sa'"'"'"')
if [ "${has_sa:-0}" -gt 0 ]; then
  ok "Đã có $has_sa SA — bỏ qua."
else
  echo "  Mật khẩu tạm in ra MỘT lần duy nhất bên dưới: chép ra giấy, trao tận tay."
  docker compose exec api node dist/ops/seed-sa.main.js
fi

# ─── 7. Cron ───
bold "7/7 Sao lưu và giám sát (cron)"
ask NAS "Thư mục NAS đã mount cho sao lưu" "/mnt/nas/ims-backup"
ask WEBHOOK "Webhook nhận cảnh báo (Google Chat/Teams/Slack; bỏ trống nếu chưa có)" ""
if mountpoint -q "$NAS"; then ok "$NAS là mount point."; else warn "$NAS CHƯA phải mount point — sao lưu sẽ từ chối chạy cho tới khi mount NAS (xem RUNBOOK D1)."; fi
dir=$(pwd)
current=$(crontab -l 2>/dev/null || true)
add=""
grep -q 'ops/backup-nightly.sh' <<<"$current" ||
  add+="30 1 * * * cd $dir && bash ops/backup-nightly.sh $NAS >> \$HOME/ims-backup.log 2>&1"$'\n'
grep -q 'ops/healthcheck.sh' <<<"$current" ||
  add+="*/5 * * * * cd $dir && IMS_ALERT_WEBHOOK='$WEBHOOK' IMS_DISK_PATHS='/ /var/lib/docker $NAS' bash ops/healthcheck.sh >> \$HOME/ims-health.log 2>&1"$'\n'
if [ -n "$add" ]; then
  printf '%s\n%s' "$current" "$add" | sed '/^$/d' | crontab -
  ok "Đã đặt cron (crontab -l để xem)."
else
  ok "Cron đã có — giữ nguyên."
fi
bash ops/healthcheck.sh || warn "Healthcheck báo vấn đề ở trên — xem và xử lý."

cat <<EOF

$(printf '\033[1m')Xong phần máy làm được.$(printf '\033[0m') Việc còn lại theo docs/RUNBOOK-4.3-dong-dot-1.md:
  C. In master key + pepper + .env ra giấy, niêm phong 3 phong bì. Lệnh in:
       cat secrets/master_key secrets/password_pepper; cat .env
  D. Chạy tay một lượt sao lưu:  bash ops/backup-nightly.sh $NAS
  E. Diễn tập khôi phục trên VM KHÁC (ops/restore-drill.sh).
  F. Khai dải IP rồi nhập Excel thiết bị.
  Mở: https://$(grep '^APP_BASE_URL=' .env | sed 's#.*://##')
EOF
