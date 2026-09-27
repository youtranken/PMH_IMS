import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { Pool } from 'pg';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { PG_POOL } from './database/database.module';
import { assertNarrowRole } from './database/app-role';
import { migrateDatabase } from './database/migrate';
import { MasterKeyRing } from './common/crypto/master-key-ring';
import { assertKeyringCovers } from './ops/rewrap';

/** Biến bắt buộc — thiếu là chết ngay lúc boot, không chạy nửa vời (AD-11). */
const REQUIRED_ENV = ['DATABASE_URL', 'APP_BASE_URL', 'MASTER_KEY_FILE', 'PASSWORD_PEPPER_FILE'];

/*
 * `assertNarrowRole` ĐÃ CHUYỂN sang `database/app-role.ts` (21/09).
 *
 * Nó ở đây thì không bài kiểm nào chạm tới được — `main.ts` gọi `bootstrap()` ngay lúc nạp
 * module. Và một cổng không bài nào chạm tới là một cổng có thể bị gỡ mà không gì đỏ: đã đo,
 * xoá câu `throw` mà Jest, test:db, Vitest, build lẫn E2E đều xanh. Xem bảng bốn ca ở
 * `api/test/app-role-privileges.spec.ts`, trong đó có ca "tên môi trường lạ vẫn phải NÉM".
 */

async function bootstrap(): Promise<void> {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${missing.join(', ')}`);
  }

  // Trong compose, migration chạy ở service `migrate` riêng (OPS-07) và api không có DSN chủ sở
  // hữu. Chỉ khi chạy api trần (máy dev, không compose) mà có khai DSN đó thì mới tự áp ở đây.
  if (process.env.MIGRATION_DATABASE_URL) await migrateDatabase(new Logger('Migrations'));

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  setupApp(app);

  await assertNarrowRole(app.get<Pool>(PG_POOL), new Logger('DbRole'), process.env.NODE_ENV);
  // Thiếu chìa mà dữ liệu còn cần thì không lên (DOM-01): két và TOTP ở version đó sẽ không mở được.
  await assertKeyringCovers(app.get<Pool>(PG_POOL), MasterKeyRing.fromSecretFile());

  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  new Logger('Bootstrap').log(`API sẵn sàng — ${process.env.APP_BASE_URL}`);
}

void bootstrap();
