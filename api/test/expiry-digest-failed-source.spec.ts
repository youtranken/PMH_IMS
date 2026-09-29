import { runMigrations } from '../src/database/migration-runner';
import { ExpirySourceRegistry } from '../src/common/expiry/expiry-registry';
import type { ExpiryItem } from '../src/common/expiry/expiry-source';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { ExpiryDigestService } from '../src/modules/expiry/expiry-digest.service';
import { ExpiryService } from '../src/modules/expiry/expiry.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * BE-01 — nguồn hạn hỏng thì digest KHÔNG được chốt kỳ.
 *
 * Sổ đăng ký nuốt lỗi của một nguồn để màn hình vẫn mở được. Digest mà tin kết quả thiếu đó
 * thì nó chốt `last_sent_at` cho một lá thư thiếu dòng (hoặc không gửi gì vì "không có mục
 * nào"), và kỳ đó mất hẳn: lần chạy sau thấy kỳ đã gửi. Câu hỏi là về transaction chốt kỳ
 * thật, nên chạy trên Postgres thật; outbox/audit/config là đồ giả vì chúng không nằm trên
 * đường chốt kỳ.
 */

const TEST_TIMEOUT = 120_000;
/** 09:00 giờ Việt Nam — đã qua giờ hẹn 08:00 của luật gieo sẵn. */
const NOW = new Date('2026-09-28T02:00:00Z');

describe('BE-01 · digest không chốt kỳ khi một nguồn hạn lỗi', () => {
  let scratch: ScratchDb;
  let broken = true;
  const enqueued: unknown[] = [];

  const item: ExpiryItem = {
    id: 'lic-1',
    label: 'License E2E',
    kind: 'license',
    start: null,
    end: '2026-10-01',
    link: '/software/lic-1',
  };

  function build(): ExpiryDigestService {
    const registry = new ExpirySourceRegistry();
    registry.register({
      sourceKind: 'license',
      sourceLabel: 'License',
      findExpiring: () => Promise.resolve([item]),
    });
    registry.register({
      sourceKind: 'ssl',
      sourceLabel: 'SSL',
      findExpiring: () =>
        broken ? Promise.reject(new Error('nguồn ssl sập')) : Promise.resolve([]),
    });
    const numbers: Record<string, number> = {
      expiryCriticalDays: 7,
      expiryWarningDays: 30,
      expiryDigestExpiredDays: 30,
      expiryLookBackDays: 365,
    };
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
      getNumber: (key: string) => Promise.resolve(numbers[key]),
    } as unknown as SystemConfigService;
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const outbox = {
      enqueueWithin: (_tx: unknown, _type: string, payload: unknown) => {
        enqueued.push(payload);
        return Promise.resolve();
      },
    } as unknown as OutboxService;
    const sweep = { register: () => undefined } as unknown as SweepService;
    const expiry = new ExpiryService(scratch.db, registry, audit, config);
    return new ExpiryDigestService(scratch.db, expiry, outbox, audit, config, sweep);
  }

  async function lastSentAt(): Promise<Date | null> {
    const { rows } = await scratch.pool.query<{ last_sent_at: Date | null }>(
      `SELECT last_sent_at FROM expiry_rule WHERE name = 'Luat E2E digest'`,
    );
    return rows[0].last_sent_at;
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_digest_fail');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    await scratch.pool.query(
      `INSERT INTO expiry_rule (name, kinds, within_days, recipients, frequency, hour, active)
       VALUES ('Luat E2E digest', '[]', 30, '["it@pmh.com.vn"]', 'daily', 8, true)`,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('nguồn lỗi → kỳ KHÔNG bị chốt, không thư nào xếp hàng', async () => {
    broken = true;
    await build().runDue(NOW);
    expect(await lastSentAt()).toBeNull();
    expect(enqueued).toHaveLength(0);
  });

  it('nguồn sống lại → phút sau gửi bù đúng kỳ đó', async () => {
    broken = false;
    await build().runDue(NOW);
    expect(await lastSentAt()).not.toBeNull();
    expect(enqueued).toHaveLength(1);
  });

  it('gửi thử khi nguồn lỗi → 503 nói rõ nguồn nào, không lặng lẽ gửi thư thiếu', async () => {
    broken = true;
    const { rows } = await scratch.pool.query<{ id: string }>(`SELECT id FROM expiry_rule`);
    await expect(build().sendTest('sa@pmh.com.vn', rows[0].id)).rejects.toMatchObject({
      response: { code: 'EXPIRY_SOURCE_FAILED' },
    });
  });

  it('EX-021: bảng luật có lần gửi tới — đã gửi kỳ hôm nay thì là 08:00 ngày mai', async () => {
    broken = false;
    const [rule] = await build().list(NOW);
    // Bài "gửi bù" phía trên đã chốt kỳ 28/09 → kỳ tới 29/09 08:00 giờ VN = 01:00Z.
    expect(rule.nextSendAt).toEqual(new Date('2026-09-29T01:00:00Z'));
    await scratch.pool.query(`UPDATE expiry_rule SET active = false`);
    expect((await build().list(NOW))[0].nextSendAt).toBeNull();
    await scratch.pool.query(`UPDATE expiry_rule SET active = true`);
  });

  it('EX-021: xem trước nội dung thư không xếp hàng thư nào', async () => {
    broken = false;
    const before = enqueued.length;
    const { rows } = await scratch.pool.query<{ id: string }>(`SELECT id FROM expiry_rule`);
    const preview = await build().preview(rows[0].id);
    expect(preview).toMatchObject({ total: 1, recipients: ['it@pmh.com.vn'] });
    expect(preview.items.map((row) => row.label)).toEqual(['License E2E']);
    expect(enqueued).toHaveLength(before);
  });

  it('EX-021: gửi thử chỉ cho tôi — outbox mang id người bấm, không mang email', async () => {
    broken = false;
    const { rows } = await scratch.pool.query<{ id: string }>(`SELECT id FROM expiry_rule`);
    const result = await build().sendTest('sa@pmh.com.vn', rows[0].id, {
      userId: 'u-sa',
      email: 'sa@pmh.com.vn',
    });
    expect(result.recipients).toEqual(['sa@pmh.com.vn']);
    expect(enqueued.at(-1)).toEqual({ ruleId: rows[0].id, isTest: true, toUserId: 'u-sa' });
  });
});
