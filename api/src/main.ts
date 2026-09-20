import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { Pool } from 'pg';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { PG_POOL } from './database/database.module';
import { redactMessage } from './common/log-redact';
import { appRoleVerdict, ensureAppRole, readAppRoleFacts } from './database/app-role';
import { resolveMigrationsDir, runMigrations } from './database/migration-runner';

/** Biến bắt buộc — thiếu là chết ngay lúc boot, không chạy nửa vời (AD-11). */
const REQUIRED_ENV = ['DATABASE_URL', 'APP_BASE_URL', 'MASTER_KEY_FILE', 'PASSWORD_PEPPER_FILE'];

const APP_DB_ROLE = 'ims_app';

/**
 * D-01: migration chạy bằng CHỦ SỞ HỮU, ứng dụng chạy bằng role hẹp.
 *
 * Hai kết nối, hai quyền khác nhau, và kết nối chủ sở hữu SỐNG ĐÚNG mấy giây đầu rồi đóng
 * hẳn — không có pool nào giữ quyền `ALTER TABLE` mở suốt vòng đời tiến trình.
 *
 * `MIGRATION_DATABASE_URL` không đặt = chưa tách role. Không chết ở đây (dev và mọi nơi cài
 * cũ vẫn phải chạy được), nhưng `assertNarrowRole` bên dưới sẽ nói rõ ra, và ở production
 * thì nó chặn hẳn.
 */
async function migrate(logger: Logger): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  const owner = new Pool({ connectionString: url, max: 1 });
  // NFR-04: `.message` của lỗi truy vấn chở cả tham số đã bind — đi qua `redactMessage`.
  owner.on('error', (error) => logger.error(`[migrate-pool] ${redactMessage(error)}`));
  try {
    const password = process.env.APP_DB_PASSWORD;
    if (process.env.MIGRATION_DATABASE_URL && password) {
      await ensureAppRole(owner, APP_DB_ROLE, password);
      logger.log(`Role ứng dụng "${APP_DB_ROLE}" đã sẵn sàng.`);
    }
    const applied = await runMigrations(owner, resolveMigrationsDir(), logger);
    logger.log(applied.length > 0 ? `Đã áp ${applied.length} migration.` : 'Schema đã mới nhất.');
  } finally {
    await owner.end();
  }
}

/**
 * Hỏi bằng chính kết nối mà ứng dụng sẽ dùng cả đời: role này có rộng quá không (D-01).
 *
 * Ở production thì NÉM — đây là hạng mục "chặn phát hành" của rà soát 19/09, và một lời cảnh
 * báo trong log là thứ không ai đọc lúc 2 giờ sáng. Ngoài production thì chỉ kêu to: máy dev
 * và stack E2E của người khác không được chết vì một file `.env` chưa kịp cập nhật.
 */
async function assertNarrowRole(pool: Pool, logger: Logger): Promise<void> {
  const verdict = appRoleVerdict(await readAppRoleFacts(pool));
  if (verdict.ok || verdict.reason === null) return;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(verdict.reason);
  }
  logger.warn(verdict.reason);
}

async function bootstrap(): Promise<void> {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${missing.join(', ')}`);
  }

  // Migration chạy TRƯỚC khi dựng Nest: advisory lock + checksum (AD-10). Trước 20/09 nó chạy
  // sau `NestFactory.create`, dùng chung pool với ứng dụng — không tách role được như vậy.
  await migrate(new Logger('Migrations'));

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  setupApp(app);

  await assertNarrowRole(app.get<Pool>(PG_POOL), new Logger('DbRole'));

  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  new Logger('Bootstrap').log(`API sẵn sàng — ${process.env.APP_BASE_URL}`);
}

void bootstrap();
