import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `iso.first_month` trong lúc bộ E2E chạy — cùng cơ chế cất/trả với `rate.totp_per_minute`
 * (`totp-rate-backup.ts`).
 *
 * Vì sao phải hạ: bài kiểm phiếu ISO chỉ ghi vào năm 2021 để không chạm kỳ thật, nên vùng `iso`
 * của `reset-e2e.mjs` hạ tháng bắt đầu về 2021-01. Không trả lại thì DB dev mở mọi tháng từ 2021
 * trên Kỳ phiếu, KPI và mail nhắc — người soát giao diện thấy một hệ thống khác với prod.
 *
 * Giá trị lưu là jsonb nên cất / trả nguyên chuỗi `"YYYY-MM"` kèm dấu nháy.
 */
export const E2E_ISO_FIRST_MONTH = '"2021-01"';
const KEY = 'iso.first_month';
const SEED = '"2026-11"';
const BACKUP_FILE = fileURLToPath(new URL('.iso-first-month-original', import.meta.url));
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

/** Gọi TRƯỚC lượt reset đầu tiên của vùng `iso`. */
export function saveIsoFirstMonth(): void {
  const original = read();
  if (!original || existsSync(BACKUP_FILE)) return;
  if (original === E2E_ISO_FIRST_MONTH) {
    console.warn(
      `[e2e] ${KEY} đang là ${original} — đúng giá trị bộ test tự đặt (lượt trước chết giữa chừng). ` +
        `KHÔNG cất. Đặt lại giá trị thật rồi chạy lại: UPDATE system_config SET value = '${SEED}' WHERE key = '${KEY}';`,
    );
    return;
  }
  writeFileSync(BACKUP_FILE, original, 'utf8');
}

/** Gọi SAU cửa canh rác (lượt dọn trong cửa canh hạ tháng lại). Hỏng thì kêu, không làm đỏ lượt chạy. */
export function restoreIsoFirstMonth(): void {
  if (!existsSync(BACKUP_FILE)) {
    if (read() === E2E_ISO_FIRST_MONTH) {
      console.error(
        `[e2e] CẢNH BÁO: ${KEY} đang là ${E2E_ISO_FIRST_MONTH} và không có bản cất — DB dev mở phiếu ISO ` +
          `từ 2021. Đặt lại tay: UPDATE system_config SET value = '${SEED}' WHERE key = '${KEY}';`,
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
