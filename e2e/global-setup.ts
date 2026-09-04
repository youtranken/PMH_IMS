import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { RATE_LIMIT_BACKUP_FILE } from './rate-limit-backup';

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

  /*
   * Cất giá trị GỐC của `login.rate_limit_per_ip` trước khi bộ test nới nó lên.
   * `global-teardown.ts` trả lại đúng con số này. Không có bước cất/trả, DB dev-test nằm
   * vĩnh viễn ở ngưỡng 500 — và nếu diễn tập khôi phục (Story 4.3) lấy dữ liệu từ đây thì
   * cấu hình bẩn đó đi thẳng vào production.
   */
  const original = execSync(
    'docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml exec -T postgres ' +
      `psql -U ims -d ims -tAc "SELECT value FROM system_config WHERE key = 'login.rate_limit_per_ip'"`,
    { cwd: '..', stdio: 'pipe' },
  )
    .toString()
    .trim();

  if (original) writeFileSync(RATE_LIMIT_BACKUP_FILE, original, 'utf8');
}
