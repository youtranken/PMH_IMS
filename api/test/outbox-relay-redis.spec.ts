import { Queue } from 'bullmq';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Vế còn thiếu của `outbox.spec.ts`: BullMQ THẬT trên Redis THẬT.
 *
 * Bài kia dùng Queue giả và chốt rằng relay gọi `queue.add(topic, data, { jobId: event.id })`.
 * Đó là khẳng định về HÌNH DẠNG THAM SỐ, không phải về hành vi. Cả cơ chế chống job đúp của
 * AD-11 ("at-least-once, không bao giờ đúp") nằm ở chỗ BullMQ có THẬT SỰ khử trùng theo
 * `jobId` hay không — điều một hàm giả không bao giờ trả lời được.
 *
 * Vì sao chuyện này quan trọng: relay re-drive mỗi khi lease 5 phút hết hạn (job mất trong
 * Redis, worker chết giữa chừng). Nếu `jobId` không khử trùng, mỗi vòng re-drive đẻ thêm một
 * job — và người dùng nhận 52 email liên tiếp cho một tên miền đã bỏ, đúng chuyện rà soát
 * 07/09 ghi ở phần digest.
 */

const TEST_TIMEOUT = 120_000;

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

/** NÉM khi thiếu cấu hình, không `skip` — cùng nguyên tắc với `testDbUrl`. */
function redisConnection() {
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

describe('Relay outbox trên BullMQ + Redis thật', () => {
  let scratch: ScratchDb;
  let outbox: OutboxService;
  let queue: Queue;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_relay');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    outbox = new OutboxService(scratch.db);
    // Hàng đợi riêng theo tên DB tạm → không giẫm lên hàng đợi thật của stack đang chạy.
    queue = new Queue(`e2e-${scratch.name}`, { connection: redisConnection() });
    await queue.waitUntilReady();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await scratch.pool.query('TRUNCATE outbox');
    await queue.drain(true);
    await queue.clean(0, 1000, 'completed');
    await queue.clean(0, 1000, 'failed');
  });

  it(
    'relay đẩy job thật vào Redis, mang đúng topic và payload kèm id phong bì',
    async () => {
      await scratch.db.transaction((tx) =>
        outbox.enqueueWithin(tx, 'mail.that', { ref: 'r-1' }),
      );

      expect(await outbox.relayBatch(queue)).toBe(1);

      const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe('mail.that');
      const eventId = (
        await scratch.pool.query<{ id: string }>('SELECT id FROM outbox')
      ).rows[0].id;
      expect(jobs[0].id).toBe(eventId);
      expect(jobs[0].data).toEqual({ ref: 'r-1', id: eventId });
    },
    TEST_TIMEOUT,
  );

  it(
    're-drive sau khi lease hết hạn KHÔNG đẻ job thứ hai — BullMQ khử trùng theo jobId',
    async () => {
      await scratch.db.transaction((tx) => outbox.enqueueWithin(tx, 'mail.redrive'));
      expect(await outbox.relayBatch(queue)).toBe(1);

      /*
       * Đúng kịch bản thật: worker chưa kịp xử (job còn nằm chờ), lease 5 phút hết hạn, relay
       * chọn lại. Relay ĐẾM là 1 — nó có claim thật — nhưng Redis phải vẫn chỉ có MỘT job.
       * Đây là chỗ duy nhất phân biệt "at-least-once" với "gửi đúp".
       */
      await scratch.pool.query(`UPDATE outbox SET claimed_at = now() - interval '6 minutes'`);
      expect(await outbox.relayBatch(queue)).toBe(1);

      const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
      expect(jobs).toHaveLength(1);
    },
    TEST_TIMEOUT,
  );

  it(
    'nhiều sự kiện khác nhau vẫn ra nhiều job khác nhau — khử trùng không được nuốt việc thật',
    async () => {
      for (let i = 0; i < 5; i += 1) {
        await scratch.db.transaction((tx) => outbox.enqueueWithin(tx, `mail.n${i}`, { i }));
      }

      expect(await outbox.relayBatch(queue)).toBe(5);
      const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
      expect(jobs).toHaveLength(5);
      expect(new Set(jobs.map((j) => j.id)).size).toBe(5);
    },
    TEST_TIMEOUT,
  );
});
