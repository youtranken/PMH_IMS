import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { RATE_LIMIT_BACKUP_FILE } from './rate-limit-backup';
import { clearRunStart, findLeakedRows } from './leak-guard';
import { E2E_LOGIN_RATE_LIMIT } from './tests/helpers';

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
được, không phải chỗ để dập tắt cảnh báo.

Còn nếu dòng trên ghi [ĐIỂM MÙ MỚI]: có một bảng vừa ra đời mà KHÔNG có cột
\`created_at\`, nên cửa canh không phân biệt được rác của bài kiểm với dữ liệu có
sẵn. Hai đường đi, chọn một:
  · thêm \`created_at timestamptz NOT NULL DEFAULT now()\` cho bảng đó — gần như
    luôn là đường đúng, vì câu "hàng này có từ bao giờ" sớm muộn ai cũng hỏi;
  · hoặc khai nó vào \`NO_CREATED_AT\` KÈM LÝ DO nó không cần bị canh.`,
    );
  }
}

function restoreRateLimit(): void {
  if (!existsSync(RATE_LIMIT_BACKUP_FILE)) {
    /*
     * KHÔNG có bản cất — và im lặng đi ra là sai, vì trạng thái lúc này gần như chắc chắn bẩn.
     *
     * `global-setup` từ chối cất con số mà bộ test tự đặt (xem `saveBackup`), nên "không có
     * file" nghĩa là một lượt trước đã chết giữa chừng hoặc ai đó chạy `reset-e2e.mjs` bằng
     * tay. Cả hai trường hợp đều để DB nằm ở ngưỡng 500 — tức hàng rào chống dò mật khẩu của
     * NFR-01 đang TẮT trên môi trường mà người ta hay lấy dữ liệu để diễn tập khôi phục.
     *
     * `global-setup` đã cảnh báo chuyện này, nhưng nó in ở ĐẦU lượt chạy và bị 400 dòng kết
     * quả test đẩy đi mất — tôi vừa bỏ lỡ đúng cảnh báo đó ba lượt liền. Nên nói lại ở CUỐI,
     * chỗ người ta thật sự nhìn.
     */
    const current = readRateLimit();
    if (current && current === String(E2E_LOGIN_RATE_LIMIT)) {
      console.error(
        `[e2e] CẢNH BÁO: login.rate_limit_per_ip đang là ${current} (ngưỡng của bộ test) và ` +
          `không có bản cất nào để trả lại — hàng rào chống dò mật khẩu đang TẮT. Đặt lại tay:\n` +
          `  UPDATE system_config SET value = '20' WHERE key = 'login.rate_limit_per_ip';`,
      );
    }
    return;
  }

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

/** Giá trị hiện tại của trần đăng nhập, hoặc chuỗi rỗng nếu không hỏi được. */
function readRateLimit(): string {
  try {
    return execSync(
      'docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml exec -T postgres ' +
        `psql -U ims -d ims -tAc "SELECT value#>>'{}' FROM system_config WHERE key = 'login.rate_limit_per_ip'"`,
      { cwd: '..', stdio: 'pipe' },
    )
      .toString()
      .trim();
  } catch {
    return '';
  }
}
