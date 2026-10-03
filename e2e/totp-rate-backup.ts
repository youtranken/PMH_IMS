import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Trần `rate.totp_per_minute` (gõ mã 2 lớp/phút/người) trong lúc bộ E2E chạy — cùng một cơ chế
 * cất/trả với `login.rate_limit_per_ip` (`rate-limit-backup.ts`), tách file để không đụng đường
 * đã kiểm kỹ của trần đăng nhập.
 *
 * Vì sao phải nới: mã lúc đăng nhập không mở phạm vi két / sơ đồ (Q-23, AD-17), nên gần như mọi
 * bài làm việc với két phải gõ thêm một mã ngay sau khi đăng nhập. Bộ E2E chạy một worker trên
 * cùng tài khoản `e2e-sa`, nên vượt trần 10 mã/phút chỉ vì nhịp chạy test chứ không phải vì dò mã.
 *
 * Hai chốt chống cất nhầm giống hệt bản của trần đăng nhập: file đã có thì giữ (là giá trị của
 * lượt sạch gần nhất), và không bao giờ cất chính con số bộ test tự đặt.
 */
export const E2E_TOTP_RATE_LIMIT = 600;
const KEY = 'rate.totp_per_minute';
const SEED = '10';
const BACKUP_FILE = fileURLToPath(new URL('.totp-rate-original', import.meta.url));
const PSQL =
  'docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml exec -T postgres psql -U ims -d ims';

function read(): string {
  try {
    return execSync(`${PSQL} -tAc "SELECT value FROM system_config WHERE key = '${KEY}'"`, {
      cwd: '..',
      stdio: 'pipe',
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

/** Gọi TRƯỚC `reset-e2e.mjs users` (lượt reset là chỗ nâng trần). */
export function saveTotpRate(): void {
  const original = read();
  if (!original || existsSync(BACKUP_FILE)) return;
  if (original === String(E2E_TOTP_RATE_LIMIT)) {
    console.warn(
      `[e2e] ${KEY} đang là ${original} — đúng giá trị bộ test tự đặt (lượt trước chết giữa chừng). ` +
        `KHÔNG cất. Đặt lại giá trị thật rồi chạy lại: UPDATE system_config SET value = '${SEED}' WHERE key = '${KEY}';`,
    );
    return;
  }
  writeFileSync(BACKUP_FILE, original, 'utf8');
}

/** Gọi SAU cửa canh rác (lượt dọn trong cửa canh nâng trần lại). Hỏng thì kêu, không làm đỏ lượt chạy. */
export function restoreTotpRate(): void {
  if (!existsSync(BACKUP_FILE)) {
    if (read() === String(E2E_TOTP_RATE_LIMIT)) {
      console.error(
        `[e2e] CẢNH BÁO: ${KEY} đang là ${E2E_TOTP_RATE_LIMIT} và không có bản cất — trần chống dò mã ` +
          `2 lớp đang gần như TẮT. Đặt lại tay: UPDATE system_config SET value = '${SEED}' WHERE key = '${KEY}';`,
      );
    }
    return;
  }
  const original = readFileSync(BACKUP_FILE, 'utf8').trim();
  try {
    if (original) {
      execSync(`${PSQL} -c "UPDATE system_config SET value = '${original}' WHERE key = '${KEY}'"`, {
        cwd: '..',
        stdio: 'pipe',
      });
      console.log(`[e2e] đã trả ${KEY} về ${original}`);
    }
  } catch (error) {
    console.error(
      `[e2e] KHÔNG trả được ${KEY} về ${original} — sửa tay: UPDATE system_config SET value = '${original}' WHERE key = '${KEY}';`,
      error,
    );
  } finally {
    rmSync(BACKUP_FILE, { force: true });
  }
}
