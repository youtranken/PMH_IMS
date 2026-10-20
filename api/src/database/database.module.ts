import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { redactMessage } from '../common/log-redact';

export const PG_POOL = 'PG_POOL';
export const DRIZZLE_DB = 'DRIZZLE_DB';

// Khớp KIỂU THỰC drizzle(pool) trả về ở phiên bản hiện tại (schema param `Record<string,unknown>`,
// kèm `$client`). Bare `NodePgDatabase` default về `Record<string,never>` → db-spec truyền
// `drizzle(pool)` vào service báo lệch kiểu (hygiene). Dùng schemaless (select/insert(table)/execute)
// nên schema param không ảnh hưởng runtime.
export type Database = NodePgDatabase<Record<string, unknown>>;

/**
 * Trần thời gian của pool (giá trị mặc định đọc từ env, đổi được không cần build lại).
 *
 * Không có trần thì một transaction treo (lỗi code, chờ I/O ngoài DB) giữ kết nối và khoá vô hạn;
 * vài kết nối kẹt là mọi request sau xếp hàng mãi trong khi `/health` vẫn trả lời. Trần áp cho
 * TỪNG câu lệnh, nên import / export nhiều câu vẫn chạy được miễn mỗi câu không quá trần.
 */
const POOL_LIMITS = {
  DB_POOL_MAX: 15,
  DB_CONNECT_TIMEOUT_MS: 5_000,
  DB_STATEMENT_TIMEOUT_MS: 30_000,
  DB_IDLE_TX_TIMEOUT_MS: 60_000,
  DB_LOCK_TIMEOUT_MS: 15_000,
} as const;

function limit(env: NodeJS.ProcessEnv, key: keyof typeof POOL_LIMITS): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return POOL_LIMITS[key];
  const value = Number(raw);
  // Sai cấu hình phải làm API không khởi động, không được âm thầm về 0 (= không giới hạn).
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} phải là số nguyên dương (mili giây hoặc số kết nối), đang là "${raw}".`);
  }
  return value;
}

export function createPgPool(env: NodeJS.ProcessEnv = process.env): Pool {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: limit(env, 'DB_POOL_MAX'),
    connectionTimeoutMillis: limit(env, 'DB_CONNECT_TIMEOUT_MS'),
    statement_timeout: limit(env, 'DB_STATEMENT_TIMEOUT_MS'),
    idle_in_transaction_session_timeout: limit(env, 'DB_IDLE_TX_TIMEOUT_MS'),
    lock_timeout: limit(env, 'DB_LOCK_TIMEOUT_MS'),
  });
  // pg Pool emit 'error' khi client idle rớt kết nối (Postgres restart/OOM);
  // không có listener → uncaught exception giết cả process.
  pool.on('error', (error) => {
    console.error('[pg-pool] lỗi kết nối idle:', error);
  });
  /*
   * Kết nối ĐANG MƯỢN cũng phải có người nghe: pg-pool gỡ listener của nó lúc cho mượn, và giờ
   * Postgres chủ động cắt kết nối (idle_in_transaction_session_timeout, FATAL 25P03). Không ai nghe
   * thì Node ném lỗi chưa bắt và sập cả api / worker. Câu lệnh đang chờ trên kết nối đó vẫn nhận lỗi
   * của nó như thường; listener này chỉ chặn tiến trình chết.
   */
  pool.on('connect', (client) => {
    client.on('error', (error) => {
      console.error('[pg-pool] kết nối đang dùng bị cắt:', redactMessage(error));
    });
  });
  return pool;
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => createPgPool(),
    },
    {
      provide: DRIZZLE_DB,
      useFactory: (pool: Pool): Database => drizzle(pool),
      inject: [PG_POOL],
    },
  ],
  exports: [PG_POOL, DRIZZLE_DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
