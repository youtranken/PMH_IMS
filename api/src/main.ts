import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { Pool } from 'pg';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { PG_POOL } from './database/database.module';
import { resolveMigrationsDir, runMigrations } from './database/migration-runner';

/** Biến bắt buộc — thiếu là chết ngay lúc boot, không chạy nửa vời (AD-11). */
const REQUIRED_ENV = ['DATABASE_URL', 'APP_BASE_URL', 'MASTER_KEY_FILE', 'PASSWORD_PEPPER_FILE'];

async function bootstrap(): Promise<void> {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${missing.join(', ')}`);
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  setupApp(app);

  // Migration chạy TRƯỚC khi mở cổng: advisory lock + checksum (AD-10).
  const logger = new Logger('Migrations');
  const applied = await runMigrations(app.get<Pool>(PG_POOL), resolveMigrationsDir(), logger);
  logger.log(applied.length > 0 ? `Đã áp ${applied.length} migration.` : 'Schema đã mới nhất.');

  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  new Logger('Bootstrap').log(`API sẵn sàng — ${process.env.APP_BASE_URL}`);
}

void bootstrap();
