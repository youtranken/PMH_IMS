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
  /*
   * THỨ TỰ QUAN TRỌNG: cửa canh chạy TRƯỚC, trả trần sau.
   *
   * `findLeakedRows()` chạy trọn `reset-e2e.mjs`, mà vùng `users` của lượt dọn NÂNG
   * `login.rate_limit_per_ip` lên mức E2E. Trả trần trước rồi mới dọn thì lượt dọn nâng lại,
   * và DB dev nằm vĩnh viễn ở ngưỡng 500 — đúng lỗ F-QA-02 mà bước trả trần này sinh ra để vá.
   */
  const leaked = findLeakedRows();
  clearRunStart();
  restoreRateLimit();

  if (leaked) {
    throw new Error(
      `Bộ E2E để lại hàng SỐNG SÓT QUA TRỌN MỘT LƯỢT DỌN:
${leaked}

Nghĩa là \`api/scripts/reset-e2e.mjs\` không có đường nào với tới chúng — gần như luôn
luôn vì bài kiểm đặt tên không đúng quy ước. Lượt dọn nhận ra hàng của E2E BẰNG TÊN:
\`device.code\`/\`software.code\`/\`isp_line.code\` chứa "E2E", \`subnet.name\` chứa "E2E",
\`users.email\` bắt đầu bằng "e2e-tao-moi-"… (xem \`DOMAINS\` trong script đó).

Sửa tên trong spec vừa thêm. Số đã lỡ tạo thì đổi tên là đủ, lượt dọn sau tự xoá:
  UPDATE subnet SET name = name || ' E2E' WHERE name LIKE '<mẫu>%';

Nếu bảng này ĐÚNG LÀ được phép giữ hàng lại (chỉ-thêm, sổ sự kiện…), khai nó vào
\`MAY_GROW\` trong \`e2e/leak-guard.ts\` KÈM LÝ DO — đó là ngoại lệ phải giải thích
được, không phải chỗ để dập tắt cảnh báo.`,
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
