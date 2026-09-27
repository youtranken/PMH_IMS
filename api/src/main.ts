import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { Pool } from 'pg';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { PG_POOL } from './database/database.module';
import { redactMessage } from './common/log-redact';
import { assertNarrowRole, ensureAppRole } from './database/app-role';
import { MasterKeyRing } from './common/crypto/master-key-ring';
import { assertKeyringCovers } from './ops/rewrap';
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
 * `MIGRATION_DATABASE_URL` không đặt = chưa tách role. Không chết ở đây: chạy thẳng bằng
 * `node` với một `.env` cũ vẫn lên được, và `assertNarrowRole` bên dưới sẽ nói rõ ra (ở
 * production thì nó chặn hẳn).
 *
 * NHƯNG ĐỪNG ĐỌC CÂU TRÊN THÀNH "MỌI NƠI CÀI CŨ VẪN CHẠY ĐƯỢC" (§18 #19, sửa 21/09). Với
 * docker — tức mọi nơi cài thật — `docker-compose.yml` chặn cứng bằng
 * `${APP_DB_PASSWORD:?…}`, nên một `.env` chưa cập nhật chết TRƯỚC khi Node chạy dòng nào.
 * Chú thích cũ hứa một sự khoan dung mà tầng dưới không hề có; nói rõ ra thì người đi nâng
 * cấp biết phải sửa `.env` chứ không đi tìm lỗi trong mã.
 *
 * Và khi ĐÃ khai `MIGRATION_DATABASE_URL` thì `APP_DB_PASSWORD` thành BẮT BUỘC (§18 #6):
 * khai một nửa việc tách role rồi bỏ qua nửa kia trong im lặng là cách hỏng tệ nhất — api
 * vẫn lên, vẫn chạy, và role hẹp thì chưa bao giờ tồn tại.
 */
async function migrate(logger: Logger): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  const owner = new Pool({ connectionString: url, max: 1 });
  // NFR-04: `.message` của lỗi truy vấn chở cả tham số đã bind — đi qua `redactMessage`.
  owner.on('error', (error) => logger.error(`[migrate-pool] ${redactMessage(error)}`));
  try {
    const password = process.env.APP_DB_PASSWORD;
    if (process.env.MIGRATION_DATABASE_URL) {
      if (!password) {
        throw new Error(
          'Đã khai MIGRATION_DATABASE_URL (tức đã tách role D-01) nhưng thiếu APP_DB_PASSWORD. ' +
            'Không tạo được role ứng dụng, và bỏ qua trong im lặng thì api vẫn lên trong khi ' +
            'role hẹp chưa bao giờ tồn tại. Thêm APP_DB_PASSWORD vào .env — xem .env.example.',
        );
      }
      // Truyền DSN ứng dụng vào: `ensureAppRole` thử đăng nhập trước, và chỉ đặt lại mật
      // khẩu khi nó thật sự đổi — xem chú thích ở đó (§18 #12).
      await ensureAppRole(owner, APP_DB_ROLE, password, process.env.DATABASE_URL);
    }
    const applied = await runMigrations(owner, resolveMigrationsDir(), logger);
    logger.log(applied.length > 0 ? `Đã áp ${applied.length} migration.` : 'Schema đã mới nhất.');
  } finally {
    await owner.end();
  }
}

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

  // Migration chạy TRƯỚC khi dựng Nest: advisory lock + checksum (AD-10). Trước 20/09 nó chạy
  // sau `NestFactory.create`, dùng chung pool với ứng dụng — không tách role được như vậy.
  await migrate(new Logger('Migrations'));

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
