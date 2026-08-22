#!/usr/bin/env bash
# Chạy đúng bộ kiểm tra của CI ngay trên máy — dùng trước khi commit hoặc khi đóng epic.
#   bash ops/ci-local.sh          # lint + depcruise + test đơn vị + build
#   bash ops/ci-local.sh --e2e    # kèm E2E Playwright (cần docker compose đang chạy)
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "API — lint (kèm luật AD-15)"
npm --prefix api run lint

step "API — ranh giới module acyclic (AD-2)"
npm --prefix api run depcruise

step "API — test đơn vị"
npm --prefix api test

step "API — build"
npm --prefix api run build

step "WEB — lint"
npm --prefix web run lint

step "WEB — cấm hex màu ngoài tokens.css (AD-15)"
rogue=$(grep -rlE "#[0-9a-fA-F]{3,8}\b" web/src --include="*.css" | grep -v "tokens.css" || true)
if [ -n "$rogue" ]; then
  echo "Có hex màu ngoài tokens.css:"; echo "$rogue"; exit 1
fi

step "WEB — test đơn vị"
npm --prefix web test

step "WEB — build"
npm --prefix web run build

if [ "${1:-}" = "--e2e" ]; then
  step "E2E — Playwright trên stack docker"
  # Override mount script reset tài khoản test (script không nằm trong image production).
  docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml up -d
  (cd e2e && npx playwright test)
fi

printf '\n\033[32mTất cả kiểm tra đã xanh.\033[0m\n'
