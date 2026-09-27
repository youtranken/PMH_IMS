import type { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { redactMessage } from '../common/log-redact';
import { ensureAppRole } from './app-role';
import { resolveMigrationsDir, runMigrations } from './migration-runner';

export const APP_DB_ROLE = 'ims_app';

/**
 * Dựng role ứng dụng và áp migration bằng CHỦ SỞ HỮU (D-01, OPS-07).
 *
 * Chạy trong service `migrate` của compose (`dist/ops/migrate.main.js`), một lần rồi thoát: DSN
 * chủ sở hữu chỉ sống trong container đó, api và worker không bao giờ cầm nó.
 * Thiếu `APP_DB_PASSWORD` là dừng: bỏ qua trong im lặng thì api vẫn lên trong khi role hẹp chưa
 * từng tồn tại.
 */
export async function migrateDatabase(logger: Logger): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  const password = process.env.APP_DB_PASSWORD;
  if (!url) throw new Error('Thiếu MIGRATION_DATABASE_URL (DSN chủ sở hữu) — không chạy migration được.');
  if (!password) throw new Error('Thiếu APP_DB_PASSWORD — không dựng được role ứng dụng ims_app.');
  const owner = new Pool({ connectionString: url, max: 1 });
  // `.message` của lỗi truy vấn chở cả tham số đã bind — đi qua `redactMessage` (NFR-04).
  owner.on('error', (error) => logger.error(`[migrate-pool] ${redactMessage(error)}`));
  try {
    // DSN ứng dụng để `ensureAppRole` thử đăng nhập trước và chỉ đặt lại mật khẩu khi nó đổi.
    await ensureAppRole(owner, APP_DB_ROLE, password, process.env.DATABASE_URL);
    const applied = await runMigrations(owner, resolveMigrationsDir(), logger);
    logger.log(applied.length > 0 ? `Đã áp ${applied.length} migration.` : 'Schema đã mới nhất.');
  } finally {
    await owner.end();
  }
}
