import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { RATE_LIMIT_BACKUP_FILE } from './rate-limit-backup';

/**
 * Trả `login.rate_limit_per_ip` về đúng giá trị trước khi bộ E2E chạy.
 *
 * Vì sao cần: `resetUsers()` nới trần lên 500 trong MỌI `beforeEach` và bản trước không bao
 * giờ trả lại. Hệ quả: sau một lượt chạy E2E, DB dev/test nằm vĩnh viễn ở ngưỡng 500 — hàng
 * rào chống dò mật khẩu (NFR-01) bị tắt trên chính môi trường mà người ta hay lấy dữ liệu
 * để diễn tập khôi phục. Xem `docs/CODE-REVIEW-2026-08-28.md` (F-QA-02).
 *
 * Teardown KHÔNG được làm cả lượt chạy đỏ nếu nó hỏng: bản thân nó là dọn dẹp, không phải
 * assertion. Hỏng thì kêu to trên log để người chạy biết mà sửa tay.
 */
export default function globalTeardown(): void {
  if (!existsSync(RATE_LIMIT_BACKUP_FILE)) return;

  const original = readFileSync(RATE_LIMIT_BACKUP_FILE, 'utf8').trim();
  if (!original) return;

  try {
    execSync(
      'docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml exec -T postgres ' +
        `psql -U ims -d ims -c "UPDATE system_config SET value = '${original}' WHERE key = 'login.rate_limit_per_ip'"`,
      { cwd: '..', stdio: 'pipe' },
    );
    console.log(`[e2e] đã trả login.rate_limit_per_ip về ${original}`);
  } catch (error) {
    console.error(
      `[e2e] KHÔNG trả được login.rate_limit_per_ip về ${original} — hãy sửa tay: ` +
        `UPDATE system_config SET value = '${original}' WHERE key = 'login.rate_limit_per_ip';`,
      error,
    );
  } finally {
    rmSync(RATE_LIMIT_BACKUP_FILE, { force: true });
  }
}
