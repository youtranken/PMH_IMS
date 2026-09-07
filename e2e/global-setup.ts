import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { RATE_LIMIT_BACKUP_FILE } from './rate-limit-backup';
import { E2E_LOGIN_RATE_LIMIT } from './tests/helpers';

/**
 * Đưa tài khoản E2E về trạng thái sạch trước mỗi lần chạy.
 * Dùng script trong container api — KHÔNG có endpoint reset trong API production.
 */
export default function globalSetup(): void {
  /*
   * ĐỌC TRƯỚC, RESET SAU — thứ tự này quan trọng.
   *
   * Từ 07/09, `reset-e2e.mjs users` tự nới `login.rate_limit_per_ip` lên 500 (trước kia việc
   * đó nằm ở `relaxLoginRateLimit()` gọi riêng trong từng `beforeEach`). Chạy reset trước rồi
   * mới đọc là đọc phải chính con số bộ test vừa đặt, và giá trị thật không bao giờ được cất.
   *
   * `global-teardown.ts` trả lại đúng con số cất ở đây. Không có bước cất/trả, DB dev-test nằm
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

  saveBackup(original);

  // Giờ mới đưa tài khoản E2E về trạng thái sạch (script này cũng nới trần đăng nhập).
  execSync(
    'docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml exec -T api node scripts/reset-e2e.mjs users',
    {
      cwd: '..',
      stdio: 'inherit',
      env: { ...process.env, ALLOW_E2E_RESET: '1' },
    },
  );
}

function saveBackup(original: string): void {
  if (!original) return;

  /*
   * HAI CHỐT trước khi ghi đè bản cất — cả hai đều chống cùng một tai nạn.
   *
   * Bản trước ghi vô điều kiện. Lượt 1 bị `Ctrl-C` / SIGKILL / CI timeout → `globalTeardown`
   * KHÔNG chạy → DB còn 500, file backup còn 20. Lượt 2 khởi động: đọc DB ra **500** rồi ghi
   * đè file → giá trị thật 20 biến mất VĨNH VIỄN, và từ đó mọi lượt "khôi phục" đều trả về
   * 500. Đúng finding #5 Chặn của 28/08 quay lại bằng cửa sau (rà soát 07/09).
   *
   * 1. File đã có thì giữ nguyên — nó là giá trị của lượt chạy SẠCH gần nhất.
   * 2. Kể cả khi chưa có file, không bao giờ cất chính con số mà bộ test tự đặt vào: đó là
   *    dấu hiệu lượt trước chết giữa chừng, và cất nó lại là hợp thức hóa cấu hình bẩn.
   */
  if (existsSync(RATE_LIMIT_BACKUP_FILE)) return;

  if (original === String(E2E_LOGIN_RATE_LIMIT)) {
    console.warn(
      `[e2e] login.rate_limit_per_ip đang là ${original} — đúng giá trị bộ test tự đặt, nghĩa là ` +
        `một lượt chạy trước đã chết giữa chừng và không kịp trả lại. KHÔNG cất con số này. ` +
        `Hãy đặt lại giá trị thật (seed là 20) rồi chạy lại: ` +
        `UPDATE system_config SET value = '20' WHERE key = 'login.rate_limit_per_ip';`,
    );
    return;
  }

  writeFileSync(RATE_LIMIT_BACKUP_FILE, original, 'utf8');
}
