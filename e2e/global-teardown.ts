import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { RATE_LIMIT_BACKUP_FILE } from './rate-limit-backup';
import { clearRunStart, findLeakedRows } from './leak-guard';

/**
 * Dọn dẹp cuối lượt chạy — HAI việc, và chúng khác hẳn nhau về tính chất.
 *
 * 1. Trả `login.rate_limit_per_ip` về đúng giá trị trước khi bộ E2E chạy. Đây là DỌN DẸP:
 *    hỏng thì kêu to trên log, KHÔNG được làm cả lượt chạy đỏ.
 *
 *    Vì sao cần: `resetUsers()` nới trần lên 500 trong MỌI `beforeEach` và bản trước không bao
 *    giờ trả lại. Hệ quả: sau một lượt chạy E2E, DB dev/test nằm vĩnh viễn ở ngưỡng 500 —
 *    hàng rào chống dò mật khẩu (NFR-01) bị tắt trên chính môi trường mà người ta hay lấy dữ
 *    liệu để diễn tập khôi phục. Xem `docs/CODE-REVIEW-2026-08-28.md` (F-QA-02).
 *
 * 2. Cửa canh RÁC (10/09). Đây là KHẲNG ĐỊNH, không phải dọn dẹp: nó ném, và cả lượt chạy đỏ.
 *    Xem `leak-guard.ts` để biết vì sao nó đáng một cổng riêng.
 */
export default function globalTeardown(): void {
  restoreRateLimit();

  const leaked = findLeakedRows();
  clearRunStart();
  if (leaked) {
    throw new Error(
      `Bộ E2E để lại hàng mà \`reset-e2e.mjs\` KHÔNG dọn được (tên thiếu chữ "E2E"):
${leaked}

Quy ước: mọi hàng do bài kiểm tạo ra phải mang chữ "E2E" trong \`subnet.name\`,
\`software.code\`, \`device.code\` — đó là thứ DUY NHẤT \`reset-e2e.mjs\` nhìn vào.
Sửa tên trong spec vừa thêm, rồi dọn tay số đã lỡ tạo (đổi tên là đủ, lượt reset
sau sẽ tự xoá):
  UPDATE subnet SET name = name || ' E2E' WHERE name LIKE '<mẫu>%';`,
    );
  }
}

function restoreRateLimit(): void {
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
