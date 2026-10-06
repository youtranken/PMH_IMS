import { NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { OutboxAdminService } from '../src/modules/outbox/outbox-admin';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';
import { noSweep } from './sweep-stub';

/**
 * Thư gửi lỗi (Q-25): SA thấy thư đã hết lượt gửi tự động và "Gửi lại" được. Chạy trên Postgres
 * thật vì cái cần khẳng định là ranh giới SQL: chỉ thư CHƯA xử + có lỗi mới hiện; gửi lại xoá dấu
 * lỗi cùng transaction với dòng nhật ký (AD-5); thư đã gửi xong thì không "gửi lại" được nữa.
 */

const TEST_TIMEOUT = 120_000;
const SA = 'e2e-sa@pmh.com.vn';

describe('OutboxAdminService trên Postgres thật', () => {
  let scratch: ScratchDb;
  let admin: OutboxAdminService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_outbox_admin');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const outbox = new OutboxService(scratch.db, new SystemConfigService(scratch.db), noSweep);
    admin = new OutboxAdminService(scratch.db, outbox, new AuditWriterService(scratch.db));
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    await scratch.pool.query('TRUNCATE outbox');
  });

  async function insert(topic: string, extra: { failCount?: number; error?: string | null; processed?: boolean; payload?: object } = {}) {
    const r = await scratch.pool.query<{ id: string }>(
      `INSERT INTO outbox (topic, payload, fail_count, last_error, last_failed_at, processed_at)
       VALUES ($1, $2::jsonb, $3, $4, CASE WHEN $3 > 0 THEN now() END, CASE WHEN $5 THEN now() END) RETURNING id`,
      [topic, JSON.stringify(extra.payload ?? {}), extra.failCount ?? 0, extra.error ?? null, extra.processed ?? false],
    );
    return r.rows[0].id;
  }

  it(
    'liệt kê đúng thư CHƯA gửi được (có lỗi, chưa xử); lỗi che địa chỉ người nhận; không trả payload',
    async () => {
      const failed = await insert('approval.requested', { failCount: 3, error: '550 <an.nguyen@pmh.com.vn> unknown', payload: { who: 'lo@pmh.com.vn' } });
      await insert('expiry.digest'); // đang chờ gửi lần đầu, chưa lỗi
      await insert('auth.account.locked', { failCount: 2, error: 'x', processed: true }); // lỗi rồi nhưng sau đó gửi được

      const list = await admin.listFailed();
      expect(list.total).toBe(1);
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ id: failed, topic: 'approval.requested', failCount: 3, lastError: '550 <a***@pmh.com.vn> unknown' });
      expect(list.items[0].createdAt).toBeTruthy();
      expect(JSON.stringify(list)).not.toContain('lo@pmh.com.vn');
      expect(await admin.failedCount()).toEqual({ count: 1 });
    },
    TEST_TIMEOUT,
  );

  it(
    'Gửi lại: xoá dấu lỗi + lượt thử để relay đẩy lại; một dòng nhật ký outbox.requeued cùng transaction',
    async () => {
      const id = await insert('approval.requested', { failCount: 5, error: 'ETIMEDOUT' });
      await admin.requeue(id, SA);

      const row = (await scratch.pool.query('SELECT fail_count, last_error, claimed_at, processed_at FROM outbox WHERE id = $1', [id])).rows[0];
      expect(row).toMatchObject({ fail_count: 0, last_error: null, claimed_at: null, processed_at: null });
      const audit = (await scratch.pool.query(`SELECT actor, object_type, object_id, detail FROM audit_log WHERE action = 'outbox.requeued' AND object_id = $1`, [id])).rows;
      expect(audit).toEqual([{ actor: SA, object_type: 'outbox', object_id: id, detail: { topic: 'approval.requested', failCount: 5 } }]);
      expect((await admin.listFailed()).total).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    'đường hỏng: thư đã gửi xong hoặc không còn → 404, không ghi nhật ký',
    async () => {
      const done = await insert('approval.requested', { failCount: 1, error: 'x', processed: true });
      await expect(admin.requeue(done, SA)).rejects.toBeInstanceOf(NotFoundException);
      await expect(admin.requeue('00000000-0000-4000-8000-000000000000', SA)).rejects.toBeInstanceOf(NotFoundException);
      expect((await scratch.pool.query(`SELECT 1 FROM audit_log WHERE action = 'outbox.requeued' AND object_id = $1`, [done])).rowCount).toBe(0);
    },
    TEST_TIMEOUT,
  );
});
