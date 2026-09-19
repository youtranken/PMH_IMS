#!/usr/bin/env bash
# Cổng chất lượng chạy trên máy — BA TẦNG, chọn theo việc đang làm (quyết định 07/09).
#
#   bash ops/ci-local.sh              # ~4 phút — lint + depcruise + test đơn vị + hạ tầng + build
#                                     # CHẠY MỖI LẦN SỬA CODE. Bao trùm CI GitHub:
#                                     # xanh ở đây ⇒ xanh trên GitHub, không ngược lại.
#
#   bash ops/ci-local.sh --e2e-fast   # ~24 phút — thêm E2E, BỎ những bài gắn @slow
#                                     # CHẠY KHI SỬA XONG MỘT TÍNH NĂNG.
#
#   bash ops/ci-local.sh --e2e        # ~30 phút — E2E đầy đủ
#                                     # BẮT BUỘC trước khi đóng story/epic và trước khi gộp master.
#
# CON SỐ LÀ ĐO THẬT trên máy này (07/09), không phải ước lượng. Đừng sửa chúng thành số đẹp
# hơn mà không đo lại — cả dự án này đã trả giá đủ cho những con số tự khai.
#
# VÌ SAO CHIA TẦNG. Lượt đầy đủ từng mất 33 phút, và một cổng nặng tới mức không ai chạy nổi
# mỗi lần sửa thì nó thành cổng không tồn tại. Nhưng gác hẳn E2E cũng sai: cả hai đợt rà soát
# 28/08 và 07/09 đều có lỗi mà CHỈ E2E mới thấy (module audit hỏng ba tầng chồng nhau; năm lỗi
# đua M2). Bảy chuyên gia đọc code không ai tìm ra chúng.
#
# `@slow` là nhãn cho những bài PHẢI CHỜ ĐỒNG HỒ THẬT — trần mở két theo phút, cache
# `system_config` 30 giây, ngưỡng đăng nhập theo IP. Chúng chậm vì bản chất bài toán, không
# phải vì viết ẩu, nên không tối ưu được; chỉ để dành cho lượt đầy đủ.
#
# PHÂN CÔNG (quyết định 03/09): GitHub Actions chạy tầng một; E2E chỉ chạy ở đây, vì nó cần
# dựng cả stack và ở runner GitHub thì tốn 10-15 phút mỗi lần cho repo private.
#
# TẦNG TEST CHẠM HẠ TẦNG THẬT (08/09) nằm ở TẦNG MỘT, không phải tầng E2E — nó tốn ~15 giây và
# chỉ cần ba container hạ tầng (postgres · redis · mailpit), không cần dựng api/web/worker. Đặt
# nó vào tầng đắt là đặt nó vào chỗ không ai chạy, mà đây đang là cơ chế kiểm chứng DUY NHẤT
# cho DoD gạch 5 ("migration chạy sạch trên DB TRẮNG"), cho ranh giới transaction của
# `OutboxService` (thứ AD-5 bắt mọi lượt ghi đi qua), cho việc BullMQ khử job đúp, và cho
# đường SMTP. GitHub không chạy được vì runner không có Postgres/Redis/Mailpit; nghĩa là y như
# E2E, KHÔNG ai ép nó ngoài anh.
#
# ĐIỀU KIỆN ĐỦ ĐỂ ĐÓNG STORY (CLAUDE.md, DoD gạch 7): `--e2e` ĐẦY ĐỦ phải xanh. `--e2e-fast`
# KHÔNG thay thế được — nó cố tình bỏ qua đúng những hàng rào an ninh theo thời gian.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-}"
case "$MODE" in
  ''|--e2e|--e2e-fast) ;;
  *) printf '\033[31mTham số không hiểu: %s\033[0m\nDùng: (trống) | --e2e-fast | --e2e\n' "$MODE"; exit 2 ;;
esac

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml"

step "API — lint (AD-2 ranh giới module + AD-15 cấm thư viện)"
npm --prefix api run lint

step "API — đồ thị module acyclic + quyền sở hữu bảng (AD-2/AD-3)"
npm --prefix api run depcruise

step "API — test đơn vị"
npm --prefix api test

step "API — test hạ tầng THẬT (migration trên DB trắng · outbox · BullMQ · SMTP)"
# Ba container hạ tầng, KHÔNG kéo cả stack (không api, không web, không worker): bước này phải
# rẻ đủ để chạy mỗi lần sửa code, nếu không nó sẽ bị bỏ qua và DoD gạch 5 quay về chỗ cũ.
#
# Vì sao cả ba: `postgres` cho migration + ranh giới transaction outbox; `redis` để chứng minh
# BullMQ THẬT SỰ khử job đúp theo `jobId` (Queue giả chỉ khẳng định được hình dạng tham số);
# `mailpit` để `MailTransportService` — nơi DUY NHẤT chạm nodemailer — có một bài kiểm chạm
# hộp thư thật. Cổng của cả ba mở ở `docker-compose.override.e2e.yml`, chỉ trên loopback.
$COMPOSE --profile dev up -d postgres redis mailpit
ready=0
for _ in $(seq 1 30); do
  if $COMPOSE ps postgres 2>/dev/null | grep -q healthy      && $COMPOSE ps redis 2>/dev/null | grep -q healthy; then ready=1; break; fi
  sleep 2
done
[ "$ready" = "1" ] || fail "postgres/redis không lên được — tầng test hạ tầng KHÔNG được bỏ qua im lặng."
npm --prefix api run test:db

step "API — build"
npm --prefix api run build

step "WEB — lint + depcruise (AD-15 ranh giới tầng, cấm window.confirm)"
# 07/09: web chuyển từ oxlint sang ESLint để cả repo dùng MỘT phương ngữ luật, và có
# dependency-cruiser lần đầu (trước đó vòng lặp phụ thuộc bên web không ai canh).
npm --prefix web run lint

step "WEB — cấm hex màu ngoài tokens.css (AD-15)"
# Luật nằm trong `ops/gate-hex.sh` — MỘT bản, gọi từ cả đây lẫn `.github/workflows/ci.yml`.
# Đừng chép lại nó vào đây: đúng việc chép đôi ấy đã làm cổng nội bộ xanh còn cổng chặn merge
# đỏ suốt, xem khối chú thích đầu file kia.
bash ops/gate-hex.sh

step "WEB — test đơn vị"
npm --prefix web test

step "WEB — build (đây mới là cổng kiểm KIỂU của web, không phải tsc --noEmit)"
npm --prefix web run build

step "E2E — lint (cấm sleep, ghim trần selector CSS)"
# 08/09: `e2e/` là thư mục DUY NHẤT của repo chưa có lint (rà soát 07/09 #16), nên mọi luật
# E2E trong CLAUDE.md có 0 cưỡng chế. `--max-warnings` ghim nợ selector CSS ở con số hôm nay —
# nó không được lớn thêm. Xem đầu `e2e/eslint.config.mjs`.
npm --prefix e2e run lint

step "E2E — kiểm kiểu (tsc --noEmit)"
# Playwright transpile TS nhưng KHÔNG kiểm kiểu, nên trước 07/09 thư mục e2e không có cổng
# nào. Đó là cơ chế đã để lọt lỗi `__dirname` trong gói ESM hôm 03/09: globalSetup chết,
# KHÔNG bài nào chạy, mà lệnh vẫn thoát 0.
npm --prefix e2e run typecheck

if [ "$MODE" = "--e2e" ] || [ "$MODE" = "--e2e-fast" ]; then
  # `IMS_BASE_URL` phải KHỚP `APP_BASE_URL` trong .env: Playwright dùng nó làm baseURL, và
  # `e2e/tests/helpers.ts` dùng nó làm `Origin`. Lệch nhau là CsrfGuard trả 403
  # ORIGIN_MISMATCH cho mọi request ghi — đỏ hàng loạt theo kiểu chẳng liên quan tới bài test.
  [ -f .env ] || fail "Thiếu .env — chép từ .env.example rồi điền."
  APP_BASE_URL=$(grep -E '^APP_BASE_URL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
  [ -n "$APP_BASE_URL" ] || fail "Thiếu APP_BASE_URL trong .env."
  export IMS_BASE_URL="${IMS_BASE_URL:-$APP_BASE_URL}"
  echo "  IMS_BASE_URL = $IMS_BASE_URL (khớp APP_BASE_URL của stack)"

  step "E2E — dựng lại stack với code hiện tại"
  # `--build` là bắt buộc: không có nó thì test chạy trên image CŨ và báo xanh cho code
  # chưa hề được nạp — đúng loại kết quả sai nguy hiểm nhất.
  $COMPOSE --profile dev up -d --build

  step "E2E — chờ api sẵn sàng"
  ready=0
  for _ in $(seq 1 60); do
    if $COMPOSE ps api 2>/dev/null | grep -q healthy; then ready=1; break; fi
    sleep 5
  done
  [ "$ready" = "1" ] || { $COMPOSE logs --tail 50 api; fail "api không lên được sau 5 phút."; }

  if [ "$MODE" = "--e2e-fast" ]; then
    step "E2E NHANH — bỏ bài @slow (KHÔNG đủ để đóng story)"
    (cd e2e && npx playwright test --grep-invert "@slow")
  else
    step "E2E ĐẦY ĐỦ — Playwright (desktop + 390px)"
    (cd e2e && npx playwright test)
  fi
fi

printf '\n\033[32mTất cả kiểm tra đã xanh.\033[0m\n'
if [ "$MODE" != "--e2e" ]; then
  printf '\033[33mLUU Y: chua chay E2E DAY DU - chua du de dong story/epic hay gop master.\n'
  printf '        Chay: bash ops/ci-local.sh --e2e\033[0m\n'
fi
