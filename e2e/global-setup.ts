import { execSync } from 'node:child_process';

/**
 * Đưa tài khoản E2E về trạng thái sạch trước mỗi lần chạy.
 * Dùng script trong container api — KHÔNG có endpoint reset trong API production.
 */
export default function globalSetup(): void {
  execSync(
    'docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml exec -T api node scripts/reset-e2e-user.mjs',
    {
      cwd: '..',
      stdio: 'inherit',
      env: { ...process.env, ALLOW_E2E_RESET: '1' },
    },
  );
}
