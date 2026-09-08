import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * `OutboxService` — thứ AD-5 bắt MỌI lượt ghi đi qua — có ĐÚNG 0 test cho tới 08/09.
 *
 * Không phải vì ai lười. Nó không có test được: CLAUDE.md cấm mock drizzle, và mọi hành vi
 * đáng giá của nó nằm ở tầng SQL — `FOR UPDATE SKIP LOCKED`, lease 5 phút, check-and-set
 * `processed_at`, trần `fail_count`. Mock đi thì bài kiểm chỉ còn khẳng định lại chính chuỗi
 * SQL mà nó vừa chép sang, tức là không khẳng định gì.
 *
 * Bài này chạy trên Postgres thật, DB trắng, migration thật.
 *
 * ===== HAI LỜI HỨA ĐANG TRẦN TRỤI =====
 *
 * 1. "Outbox sống chết CÙNG lượt ghi nghiệp vụ" (AD-5). Đây là toàn bộ lý do outbox tồn tại
 *    thay vì gọi thẳng SMTP. Hỏng nó thì hệ thống hoặc gửi email cho một việc đã rollback,
 *    hoặc rollback một việc mà email đã bay đi — cả hai đều không có dấu vết nào trên màn hình.
 *
 * 2. "At-least-once, không bao giờ đúp" — lease + `jobId = event.id` + check-and-set. Hỏng nó
 *    thì hoặc mất email nhắc hạn (im lặng), hoặc bắn 52 email liên tiếp cho một tên miền đã
 *    bỏ — đúng chuyện rà soát 07/09 đã ghi ở phần digest.
 */

const TEST_TIMEOUT = 120_000;

/** Queue giả — CHỈ ghi lại lời gọi. Redis không thuộc phạm vi bài này; ranh giới SQL mới là. */
function fakeQueue() {
  const added: { name: string; data: Record<string, unknown>; opts: { jobId?: string } }[] = [];
  const queue = {
    add: (name: string, data: Record<string, unknown>, opts: { jobId?: string }) => {
      added.push({ name, data, opts });
      return Promise.resolve({ id: opts.jobId });
    },
  } as unknown as Queue;
  return { queue, added };
}

describe('OutboxService trên Postgres thật', () => {
  let scratch: ScratchDb;
  let outbox: OutboxService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_outbox');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    outbox = new OutboxService(scratch.db);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await scratch.pool.query('TRUNCATE outbox');
  });

  async function rows() {
    const r = await scratch.pool.query<{
      id: string;
      topic: string;
      payload: Record<string, unknown>;
      claimed_at: Date | null;
      processed_at: Date | null;
      fail_count: number;
      last_error: string | null;
    }>('SELECT * FROM outbox ORDER BY created_at');
    return r.rows;
  }

  describe('AD-5: outbox sống chết cùng lượt ghi nghiệp vụ', () => {
    it(
      'transaction nghiệp vụ COMMIT → sự kiện có mặt',
      async () => {
        await scratch.db.transaction(async (tx) => {
          await tx.execute(sql`SELECT 1`); // đại diện cho lượt ghi nghiệp vụ
          await outbox.enqueueWithin(tx, 'mail.test', { ref: 'abc' });
        });
        const all = await rows();
        expect(all).toHaveLength(1);
        expect(all[0].topic).toBe('mail.test');
        expect(all[0].payload).toEqual({ ref: 'abc' });
      },
      TEST_TIMEOUT,
    );

    it(
      'transaction nghiệp vụ ROLLBACK → sự kiện BIẾN MẤT THEO, không gửi email cho việc chưa xảy ra',
      async () => {
        /*
         * Đây là lời hứa trung tâm của AD-5, và trước 08/09 nó KHÔNG có bài kiểm nào — chỉ
         * chứng minh gián tiếp được qua E2E. Nếu `enqueueWithin` lỡ dùng `this.db` thay vì `tx`
         * (một ký tự), sự kiện sẽ commit độc lập và hệ thống gửi email báo "đã tạo hồ sơ" cho
         * một hồ sơ đã rollback. Không màn nào hiện ra sai lệch đó.
         */
        await expect(
          scratch.db.transaction(async (tx) => {
            await outbox.enqueueWithin(tx, 'mail.roll', { ref: 'xyz' });
            throw new Error('lượt ghi nghiệp vụ hỏng');
          }),
        ).rejects.toThrow('lượt ghi nghiệp vụ hỏng');

        expect(await rows()).toHaveLength(0);
      },
      TEST_TIMEOUT,
    );
  });

  describe('relay: claim có lease, đẩy ngoài transaction', () => {
    it(
      'claim đặt lease và đẩy sang queue với jobId = id sự kiện (chống job đúp)',
      async () => {
        await scratch.db.transaction((tx) => outbox.enqueueWithin(tx, 'mail.a', { k: 1 }));
        const { queue, added } = fakeQueue();

        expect(await outbox.relayBatch(queue)).toBe(1);
        const all = await rows();
        expect(all[0].claimed_at).not.toBeNull();
        expect(added).toHaveLength(1);
        expect(added[0].name).toBe('mail.a');
        expect(added[0].opts.jobId).toBe(all[0].id);
        // `id` đặt SAU spread → payload không được ghi đè phong bì.
        expect(added[0].data).toEqual({ k: 1, id: all[0].id });
      },
      TEST_TIMEOUT,
    );

    it(
      'payload mang khóa "id" KHÔNG cướp được id phong bì',
      async () => {
        await scratch.db.transaction((tx) =>
          outbox.enqueueWithin(tx, 'mail.spoof', { id: 'id-gia-mao' }),
        );
        const { queue, added } = fakeQueue();
        await outbox.relayBatch(queue);

        const all = await rows();
        expect(added[0].data.id).toBe(all[0].id);
        expect(added[0].opts.jobId).toBe(all[0].id);
      },
      TEST_TIMEOUT,
    );

    it(
      'chạy relay lần hai ngay sau đó: KHÔNG chọn lại (lease 5 phút còn hiệu lực)',
      async () => {
        await scratch.db.transaction((tx) => outbox.enqueueWithin(tx, 'mail.b'));
        const first = fakeQueue();
        expect(await outbox.relayBatch(first.queue)).toBe(1);

        const second = fakeQueue();
        expect(await outbox.relayBatch(second.queue)).toBe(0);
        expect(second.added).toHaveLength(0);
      },
      TEST_TIMEOUT,
    );

    it(
      'lease HẾT HẠN → re-drive (job mất trong Redis không được nuốt luôn sự kiện)',
      async () => {
        await scratch.db.transaction((tx) => outbox.enqueueWithin(tx, 'mail.c'));
        await outbox.relayBatch(fakeQueue().queue);
        // Đẩy lease lùi quá 5 phút thay vì chờ đồng hồ thật.
        await scratch.pool.query(
          `UPDATE outbox SET claimed_at = now() - interval '6 minutes'`,
        );

        const again = fakeQueue();
        expect(await outbox.relayBatch(again.queue)).toBe(1);
        expect(again.added).toHaveLength(1);
      },
      TEST_TIMEOUT,
    );

    it(
      'đã xử xong (processed_at) thì lease hết hạn cũng KHÔNG re-drive nữa',
      async () => {
        await scratch.db.transaction((tx) => outbox.enqueueWithin(tx, 'mail.d'));
        await outbox.relayBatch(fakeQueue().queue);
        const id = (await rows())[0].id;
        expect(await outbox.markProcessed(id)).toBe(true);
        await scratch.pool.query(
          `UPDATE outbox SET claimed_at = now() - interval '6 minutes'`,
        );

        expect(await outbox.relayBatch(fakeQueue().queue)).toBe(0);
      },
      TEST_TIMEOUT,
    );

    it(
      'hai relay chạy CÙNG LÚC không giành nhau một sự kiện (FOR UPDATE SKIP LOCKED)',
      async () => {
        for (let i = 0; i < 6; i += 1) {
          await scratch.db.transaction((tx) => outbox.enqueueWithin(tx, `mail.race.${i}`));
        }
        const a = fakeQueue();
        const b = fakeQueue();
        const [na, nb] = await Promise.all([
          outbox.relayBatch(a.queue),
          outbox.relayBatch(b.queue),
        ]);

        /*
         * Tổng đúng 6 và KHÔNG chồng id. SKIP LOCKED cho phép một bên lấy hết và bên kia lấy 0
         * — đó là kết quả hợp lệ, nên bài này chốt vào bất biến (không đúp, không sót) chứ
         * không chốt vào một tỉ lệ chia cụ thể sẽ đổi theo thời điểm.
         */
        expect(na + nb).toBe(6);
        const ids = [...a.added, ...b.added].map((j) => j.opts.jobId);
        expect(new Set(ids).size).toBe(6);
      },
      TEST_TIMEOUT,
    );
  });

  describe('markProcessed: check-and-set, không gửi đúp', () => {
    it(
      'lần đầu trả true, lần hai trả false — consumer chạy lại không bắn email lần nữa',
      async () => {
        await scratch.db.transaction((tx) => outbox.enqueueWithin(tx, 'mail.once'));
        const id = (await rows())[0].id;

        expect(await outbox.markProcessed(id)).toBe(true);
        expect(await outbox.markProcessed(id)).toBe(false);
      },
      TEST_TIMEOUT,
    );

    it('id không tồn tại → false, không ném', async () => {
      expect(
        await outbox.markProcessed('00000000-0000-4000-8000-0000000000ff'),
      ).toBe(false);
    });
  });

  describe('điểm terminal: fail_count chạm trần thì relay buông, nhưng SA vẫn thấy', () => {
    it(
      'fail_count = 10 → relay NGỪNG chọn lại, mà listFailed vẫn đếm',
      async () => {
        await scratch.db.transaction((tx) => outbox.enqueueWithin(tx, 'mail.poison'));
        const id = (await rows())[0].id;
        for (let i = 0; i < 10; i += 1) {
          await outbox.markFailed(id, `lỗi lần ${i}`);
        }

        const stuck = await rows();
        expect(stuck[0].fail_count).toBe(10);
        // Vẫn `processed_at IS NULL`, nhưng relay không được phép quay lại vòng lặp vô hạn.
        expect(await outbox.relayBatch(fakeQueue().queue)).toBe(0);

        const failed = await outbox.listFailed();
        expect(failed.total).toBe(1);
        expect(failed.items[0].id).toBe(id);
        expect(failed.items[0].failCount).toBe(10);
        expect(failed.items[0].lastError).toBe('lỗi lần 9');
      },
      TEST_TIMEOUT,
    );

    it(
      'requeue tay hồi sinh sự kiện chạm trần; sự kiện ĐÃ XỬ thì requeue không đụng tới',
      async () => {
        await scratch.db.transaction((tx) => outbox.enqueueWithin(tx, 'mail.revive'));
        const id = (await rows())[0].id;
        for (let i = 0; i < 10; i += 1) await outbox.markFailed(id, 'x');

        expect(await outbox.requeue(id)).toBe(true);
        expect(await outbox.relayBatch(fakeQueue().queue)).toBe(1);

        // Đã xử xong rồi thì không được requeue — làm vậy là gửi lại một email đã gửi.
        await outbox.markProcessed(id);
        expect(await outbox.requeue(id)).toBe(false);
      },
      TEST_TIMEOUT,
    );

    it(
      'lỗi dài bị cắt còn 1000 ký tự (cột last_error không phải chỗ đổ stack trace)',
      async () => {
        await scratch.db.transaction((tx) => outbox.enqueueWithin(tx, 'mail.long'));
        const id = (await rows())[0].id;
        await outbox.markFailed(id, 'x'.repeat(5000));

        expect((await rows())[0].last_error).toHaveLength(1000);
      },
      TEST_TIMEOUT,
    );
  });

  describe('loadForConsumer', () => {
    it(
      'trả payload + mốc thời gian để consumer tự quyết baseline; id lạ → null',
      async () => {
        await scratch.db.transaction((tx) =>
          outbox.enqueueWithin(tx, 'mail.load', { ref: 'r1' }),
        );
        const id = (await rows())[0].id;

        const loaded = await outbox.loadForConsumer(id);
        expect(loaded?.payload).toEqual({ ref: 'r1' });
        expect(loaded?.createdAt).toBeInstanceOf(Date);
        expect(loaded?.processedAt).toBeNull();

        await outbox.markProcessed(id);
        expect((await outbox.loadForConsumer(id))?.processedAt).toBeInstanceOf(Date);

        expect(
          await outbox.loadForConsumer('00000000-0000-4000-8000-0000000000ff'),
        ).toBeNull();
      },
      TEST_TIMEOUT,
    );
  });
});
