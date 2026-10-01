import { Pool } from 'pg';
import { formatFindings, scanSecretText } from './scan-secret-text';

/**
 * Quét ô chữ dạng rõ trông như mật khẩu — chỉ đọc, chỉ báo cáo (Q-19, SEC-21):
 *
 *   docker compose exec api node dist/ops/scan-secret-text.main.js
 *   docker compose exec api node dist/ops/scan-secret-text.main.js --lich-su
 *
 * `--lich-su` quét thêm các bảng lịch sử và `audit_log.detail` (chỉ-thêm, không sửa được —
 * mật khẩu nằm ở đó thì phải xoay). Không in nội dung ô; mở hồ sơ trên giao diện để xem.
 */
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const found = await scanSecretText(pool, { history: process.argv.includes('--lich-su') });
    for (const line of formatFindings(found)) console.log(line);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Quét thất bại: ${message}`);
  process.exit(1);
});
