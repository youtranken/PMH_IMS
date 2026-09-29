import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Database } from '../src/database/database.module';

/**
 * TẦNG TEST CHẠM DB THẬT — hạ tầng dùng chung.
 *
 * ===== VÌ SAO TẦNG NÀY PHẢI TỒN TẠI =====
 *
 * CLAUDE.md ghi thẳng: "Integration chạm DB thật: CHƯA CÓ TẦNG NÀY", và rà soát 07/09 xếp nó
 * là nợ kỹ thuật số một. Hậu quả cụ thể, không phải lý thuyết:
 *
 *   - `migration-runner.spec.ts` chạy trên một `Pool` GIẢ: `client.query()` trả
 *     `{rows: [], rowCount: 0]}` cho mọi câu lệnh. Không một dòng SQL nào được Postgres đọc,
 *     nên MỌI file migration của dự án CHƯA TỪNG được parse trong bất kỳ bài kiểm nào (40 file
 *     lúc dựng tầng này ngày 08/09; con số ấy trôi mỗi epic nên đừng ghim nó lại). Nhánh
 *     "đã apply rồi" và nhánh "checksum lệch" cũng chưa từng chạy — journal giả luôn rỗng.
 *
 *   - Cấm mock drizzle (CLAUDE.md), nên mọi lỗi RANH GIỚI TRANSACTION chỉ chứng minh được
 *     bằng E2E. Với `OutboxService` — thứ AD-5 bắt MỌI lượt ghi đi qua — điều đó có nghĩa là
 *     lời hứa trung tâm của kiến trúc ("outbox sống chết CÙNG lượt ghi nghiệp vụ") không có
 *     bài kiểm nào.
 *
 * ===== CHẠY Ở ĐÂU =====
 *
 * Jest chạy TRÊN HOST, nối vào Postgres của compose qua cổng loopback mở trong
 * `docker-compose.override.e2e.yml`. Không chạy trong container api được: ảnh đó build bằng
 * `npm ci --omit=dev` nên không có jest.
 *
 * Cổng: `npm --prefix api run test:db` (script đã khai sẵn trong package.json từ lâu nhưng
 * trỏ vào một file config KHÔNG TỒN TẠI — 08/09 mới dựng thật). GitHub Actions KHÔNG chạy
 * tầng này vì nó cần một Postgres đang sống; `ops/ci-local.sh` là nơi ép nó, y như E2E.
 */

/** Đọc `.env` ở gốc repo — không thêm dotenv chỉ để lấy ba biến. */
function repoEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(join(__dirname, '..', '..', '.env'), 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Chuỗi kết nối tới Postgres của compose.
 *
 * NÉM chứ không bỏ qua khi thiếu. Một tầng test tự `skip` khi không nối được DB là một cổng
 * khớp đúng số không chuỗi — repo này đã dựng nhầm loại cổng đó hai lần, và cả hai lần nó báo
 * xanh suốt nhiều tuần.
 */
export function testDbUrl(dbName = 'postgres'): string {
  const env = { ...repoEnv(), ...process.env };
  const user = env.POSTGRES_USER;
  const password = env.POSTGRES_PASSWORD;
  if (!user || !password) {
    throw new Error(
      'Thiếu POSTGRES_USER/POSTGRES_PASSWORD — tầng test DB đọc chúng từ .env ở gốc repo.',
    );
  }
  const port = env.POSTGRES_TEST_PORT ?? '55432';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${dbName}`;
}

/**
 * Kết nối tới Redis của compose qua cổng loopback — cùng nguyên tắc với `testDbUrl`: thiếu cấu
 * hình thì NÉM, không `skip`.
 */
export function testRedisConnection(): {
  host: string;
  port: number;
  password: string;
  maxRetriesPerRequest: null;
} {
  const env = { ...repoEnv(), ...process.env };
  const password = env.REDIS_PASSWORD;
  if (!password) {
    throw new Error('Thiếu REDIS_PASSWORD — tầng test DB đọc nó từ .env ở gốc repo.');
  }
  return {
    host: '127.0.0.1',
    port: Number(env.REDIS_TEST_PORT ?? 56379),
    password,
    maxRetriesPerRequest: null,
  };
}

/**
 * Chuỗi kết nối bằng ROLE ỨNG DỤNG (`ims_app`) — dùng để hỏi "role hẹp có thật sự hẹp không"
 * (D-01). Đọc cùng `.env` mà compose đọc, nên bài kiểm và stack đang chạy nói về CÙNG một
 * role với CÙNG một mật khẩu: bài kiểm không được phép đổi mật khẩu dưới chân stack.
 */
export function appDbUrl(dbName: string): string {
  const env = { ...repoEnv(), ...process.env };
  const user = env.APP_DB_USER ?? 'ims_app';
  const password = env.APP_DB_PASSWORD;
  if (!password) {
    throw new Error('Thiếu APP_DB_PASSWORD — tầng test DB đọc nó từ .env ở gốc repo (D-01).');
  }
  const port = env.POSTGRES_TEST_PORT ?? '55432';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${dbName}`;
}

/** Mật khẩu role ứng dụng như `.env` khai — `ensureAppRole` trong test phải đặt đúng cái này. */
export function appDbPassword(): string {
  const env = { ...repoEnv(), ...process.env };
  const password = env.APP_DB_PASSWORD;
  if (!password) {
    throw new Error('Thiếu APP_DB_PASSWORD — tầng test DB đọc nó từ .env ở gốc repo (D-01).');
  }
  return password;
}

export interface ScratchDb {
  name: string;
  pool: Pool;
  db: Database;
  drop: () => Promise<void>;
}

/**
 * Dựng một DATABASE TRẮNG dùng một lần, rồi xóa hẳn.
 *
 * Database riêng chứ không phải schema riêng hay transaction bọc ngoài: bài kiểm migration
 * cần đúng nghĩa "DB trắng" của DoD gạch 5, gồm cả `CREATE EXTENSION` ở `0000_extensions.sql`
 * và các bảng ở schema `public`. Và bài kiểm outbox cần tự mở/đóng transaction thật để đo
 * ranh giới rollback — không lồng được vào một transaction bao ngoài.
 */
export async function createScratchDb(prefix: string): Promise<ScratchDb> {
  const admin = new Pool({ connectionString: testDbUrl('postgres') });
  // Hậu tố ngẫu nhiên: hai file test chạy song song không giẫm lên nhau, và một lượt chạy bị
  // Ctrl-C giữa chừng không chặn lượt sau bằng một cái tên đã bị chiếm.
  const name = `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: testDbUrl(name) });
  pool.on('error', () => undefined);
  return {
    name,
    pool,
    db: drizzle(pool),
    drop: async () => {
      await pool.end();
      const cleaner = new Pool({ connectionString: testDbUrl('postgres') });
      try {
        await cleaner.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleaner.end();
      }
    },
  };
}

/**
 * Chờ tới khi CÓ ÍT NHẤT MỘT câu lệnh đang nằm chờ khóa trong database này.
 *
 * Bài kiểm hợp đồng khóa nào cũng cần đúng một câu hỏi: "câu lệnh thứ hai có ĐỨNG LẠI không?"
 * Không có cách nào hỏi nó bằng `await` — câu lệnh đang chờ khóa thì promise chưa settle, mà
 * "chưa settle" thì không phân biệt được với "chậm". `pg_stat_activity` là nơi Postgres nói
 * thẳng, nên đây là cách duy nhất hỏi mà không phải `sleep` một con số đoán mò.
 *
 * NÉM khi hết giờ chứ không trả về lặng lẽ: không ai chờ khóa nghĩa là hợp đồng khóa đã hỏng,
 * và đó chính là thứ bài kiểm muốn biết.
 */
export async function waitForLock(pool: Pool, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND datname = current_database()`,
    );
    if (rows[0].n > 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `Không có câu lệnh nào chờ khóa sau ${timeoutMs / 1000} giây — hợp đồng khóa đã hỏng.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Gieo nhà mạng vào danh mục, trả tên → id. `isp_line.provider_id` là khoá ngoại bắt buộc
 * (0074), nên mọi bài gieo đường truyền đều cần bước này trước.
 */
export async function seedIspProviders(
  pool: Pool,
  names: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO isp_provider (name) VALUES ($1) RETURNING id`,
      [name],
    );
    out[name] = rows[0].id;
  }
  return out;
}

/** Thư mục migration thật của dự án — cùng nguồn với runtime, không phải bản chép. */
export function migrationsDir(): string {
  return join(__dirname, '..', 'src', 'migrations');
}
