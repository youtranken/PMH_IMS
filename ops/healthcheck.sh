#!/usr/bin/env bash
# Giám sát IMS trên máy chủ (MON-01..04). Chạy bằng cron 5 phút một lần:
#   */5 * * * * cd /opt/ims && bash ops/healthcheck.sh >> /var/log/ims-health.log 2>&1
#
# Kiểm: container đang chạy/healthy, trang web trả lời, đĩa, hàng đợi mail kẹt, hạn cert TLS.
# Có vấn đề thì báo qua IMS_ALERT_WEBHOOK (Google Chat / Teams / Slack / Telegram nhận JSON
# {"text": "..."}) và/hoặc lệnh `mail` tới IMS_ALERT_EMAIL nếu máy có. Cùng một vấn đề chỉ báo
# lại sau IMS_ALERT_REPEAT_MINUTES (mặc định 60), và báo "đã ổn" khi nó hết.
#
# Biến môi trường (đặt trong crontab hoặc /etc/environment):
#   IMS_ALERT_WEBHOOK, IMS_ALERT_EMAIL, IMS_ALERT_REPEAT_MINUTES
#   IMS_URL              mặc định https://127.0.0.1 (gọi thẳng web, bỏ qua DNS)
#   IMS_DISK_PATHS       mặc định "/ /var/lib/docker"; thêm thư mục NAS nếu muốn canh cả nó
#   IMS_DISK_MAX_PERCENT mặc định 85
#   IMS_CERT_WARN_DAYS   mặc định 30
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

URL="${IMS_URL:-https://127.0.0.1}"
DISK_MAX="${IMS_DISK_MAX_PERCENT:-85}"
CERT_DAYS="${IMS_CERT_WARN_DAYS:-30}"
REPEAT_MIN="${IMS_ALERT_REPEAT_MINUTES:-60}"
STATE_DIR="${IMS_HEALTH_STATE_DIR:-/var/tmp/ims-health}"
mkdir -p "$STATE_DIR"

problems=()
problem() { problems+=("$1"); }

# 1. Container. `migrate` là service chạy một lần rồi thoát — bỏ qua.
for svc in postgres redis api worker web; do
  cid=$(docker compose ps -q "$svc" 2>/dev/null)
  if [ -z "$cid" ]; then problem "Container $svc không chạy."; continue; fi
  state=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null)
  case "$state" in
    "running healthy" | "running ") ;;
    *) problem "Container $svc: $state." ;;
  esac
done

# 2. Trang web và API trả lời qua nginx.
code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$URL/health" || true)
[ "$code" = "200" ] || problem "$URL/health trả $code (mong đợi 200)."

# 3. Đĩa.
for path in ${IMS_DISK_PATHS:-/ /var/lib/docker}; do
  [ -e "$path" ] || continue
  used=$(df --output=pcent "$path" | tail -1 | tr -dc '0-9')
  [ "${used:-0}" -lt "$DISK_MAX" ] || problem "Đĩa $path đã dùng ${used}% (ngưỡng ${DISK_MAX}%)."
done

# 4. Hàng đợi mail: thư chờ quá 30 phút, hoặc thư đã hỏng hẳn trong 24 giờ.
q() {
  docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -t -A -c \"$1\"" 2>/dev/null
}
stuck=$(q "SELECT count(*) FROM outbox WHERE processed_at IS NULL AND created_at < now() - interval '30 minutes'")
[ "${stuck:-0}" = "0" ] || problem "Có ${stuck} thư/sự kiện chờ quá 30 phút trong outbox (SMTP hỏng hay worker dừng?)."
failed=$(q "SELECT count(*) FROM outbox WHERE processed_at IS NULL AND fail_count > 0 AND last_failed_at > now() - interval '24 hours'")
[ "${failed:-0}" = "0" ] || problem "Có ${failed} thư gửi lỗi trong 24 giờ qua — xem: docker compose logs worker."

# 5. Hạn cert TLS.
cert="ops/certs/fullchain.pem"
if [ -f "$cert" ]; then
  openssl x509 -checkend $((CERT_DAYS * 86400)) -noout -in "$cert" >/dev/null ||
    problem "Cert TLS hết hạn trong vòng ${CERT_DAYS} ngày ($(openssl x509 -enddate -noout -in "$cert" | cut -d= -f2))."
fi

# ─── Báo ───
send() {
  local text
  text="[IMS $(hostname)] $1"
  if [ -n "${IMS_ALERT_WEBHOOK:-}" ]; then
    curl -s -m 10 -H 'Content-Type: application/json' \
      -d "$(printf '{"text": %s}' "$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
      "$IMS_ALERT_WEBHOOK" >/dev/null || echo "Gửi webhook thất bại."
  fi
  if [ -n "${IMS_ALERT_EMAIL:-}" ] && command -v mail >/dev/null; then
    printf '%s\n' "$text" | mail -s "IMS canh bao" "$IMS_ALERT_EMAIL" || echo "Gửi mail thất bại."
  fi
  echo "$(date '+%F %T') ĐÃ BÁO: $text"
}

last_file="$STATE_DIR/last-alert"
if [ ${#problems[@]} -eq 0 ]; then
  if [ -f "$last_file" ]; then
    send "Đã ổn trở lại."
    rm -f "$last_file"
  fi
  echo "$(date '+%F %T') OK"
  exit 0
fi

summary=$(printf -- '- %s\n' "${problems[@]}")
echo "$(date '+%F %T') CÓ VẤN ĐỀ:"
echo "$summary"
if [ ! -f "$last_file" ] || [ -n "$(find "$last_file" -mmin +"$REPEAT_MIN" 2>/dev/null)" ] ||
  [ "$(cat "$last_file")" != "$summary" ]; then
  send $'Có vấn đề:\n'"$summary"
  printf '%s' "$summary" > "$last_file"
fi
exit 1
