#!/usr/bin/env bash
# Cổng chất lượng chạy trên máy — bản đầy đủ của những gì spine yêu cầu.
#
#   bash ops/ci-local.sh          # lint + depcruise + test đơn vị + build   (giống CI GitHub)
#   bash ops/ci-local.sh --e2e    # kèm E2E Playwright trên docker compose thật
#
# PHÂN CÔNG (quyết định 03/09): GitHub Actions chạy phần trên; E2E chỉ chạy ở đây, vì nó cần
# dựng cả stack và ở runner GitHub thì tốn 10-15 phút mỗi lần cho repo private.
#
# ĐIỀU KIỆN ĐỦ ĐỂ ĐÓNG STORY (CLAUDE.md, DoD gạch 7): `--e2e` phải xanh. E2E không còn là
# cổng tự động, nên nếp này là thứ duy nhất giữ nó sống.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml"

step "API — lint (AD-2 ranh giới module + AD-15 cấm thư viện)"
npm --prefix api run lint

step "API — đồ thị module acyclic + quyền sở hữu bảng (AD-2/AD-3)"
npm --prefix api run depcruise

step "API — test đơn vị"
npm --prefix api test

step "API — build"
npm --prefix api run build

step "WEB — lint (AD-15 ranh giới feature + cấm window.confirm)"
npm --prefix web run lint

step "WEB — cấm hex màu ngoài tokens.css (AD-15)"
rogue=$(grep -rlE "#[0-9a-fA-F]{3,8}\b" web/src --include="*.css" | grep -v "tokens.css" || true)
if [ -n "$rogue" ]; then
  echo "Có hex màu ngoài tokens.css:"; echo "$rogue"; exit 1
fi

step "WEB — test đơn vị"
npm --prefix web test

step "WEB — build (đây mới là cổng kiểm KIỂU của web, không phải tsc --noEmit)"
npm --prefix web run build

if [ "${1:-}" = "--e2e" ]; then
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

  step "E2E — Playwright (desktop + 390px)"
  (cd e2e && npx playwright test)
fi

printf '\n\033[32mTất cả kiểm tra đã xanh.\033[0m\n'
if [ "${1:-}" != "--e2e" ]; then
  printf '\033[33mLƯU Ý: chưa chạy E2E. Trước khi đóng story, chạy: bash ops/ci-local.sh --e2e\033[0m\n'
fi
