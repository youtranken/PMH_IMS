import { runMigrations } from '../src/database/migration-runner';
import { SecurityProbeService } from '../src/modules/audit/security-probe.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * OLD-SEC-01: thời gian nghỉ chống ngập hộp thư, nhưng không được biến thành tấm chăn cho kẻ dò
 * cứ bắn tiếp. Vượt `secret.probe_escalation_multiplier × ngưỡng` trong lúc nghỉ thì đi THÊM
 * đúng một lá, và chỉ một lá cho mỗi thời gian nghỉ — kể cả khi bị bắn song song.
 *
 * Tầng DB vì lời hứa "chỉ một lá" dựa vào khoá advisory của Postgres; cấm mock drizzle.
 */

const TEST_TIMEOUT = 120_000;
const THRESHOLD = 3;
const MULTIPLIER = 3;

let seq = 0;
const newActor = (): string => `ke-do-leo-thang-${Date.now().toString(36)}-${++seq}@pmh.com.vn`;

function configWith(multiplier: number): SystemConfigService {
  return {
    getNumber: (name: string): Promise<number> => {
      if (name === 'secretProbeAlertThreshold') return Promise.resolve(THRESHOLD);
      if (name === 'secretProbeWindowMinutes') return Promise.resolve(15);
      if (name === 'secretProbeCooldownMinutes') return Promise.resolve(60);
      if (name === 'secretProbeEscalationMultiplier') return Promise.resolve(multiplier);
      return Promise.reject(new Error(`Khóa cấu hình lạ trong bài kiểm: ${name}`));
    },
  } as unknown as SystemConfigService;
}

describe('Cảnh báo dò két leo thang một lần trong thời gian nghỉ (OLD-SEC-01)', () => {
  let scratch: ScratchDb;
  let probe: SecurityProbeService;

  const probeWith = (multiplier: number) =>
    new SecurityProbeService(
      scratch.db,
      configWith(multiplier),
      new OutboxService(scratch.db),
      new AuditWriterService(scratch.db),
    );

  beforeAll(async () => {
    scratch = await createScratchDb('ims_probe_esc');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    probe = probeWith(MULTIPLIER);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  const seedFailures = async (actor: string, n: number): Promise<void> => {
    await scratch.pool.query(
      `INSERT INTO audit_log (actor, action, object_type, object_id, detail)
       SELECT $1, 'vault.secret.reveal_denied', 'secret', NULL, '{}'::jsonb
         FROM generate_series(1, $2::int)`,
      [actor, n],
    );
  };

  const lettersOf = async (
    actor: string,
  ): Promise<{ count: number; escalated: boolean | null }[]> => {
    const { rows } = await scratch.pool.query<{ count: number; escalated: boolean | null }>(
      `SELECT (payload->>'count')::int AS count, (payload->>'escalated')::boolean AS escalated
         FROM outbox
        WHERE topic = 'security.probe.alert' AND payload->>'who' = $1
        ORDER BY created_at, id`,
      [actor],
    );
    return rows;
  };

  const alertRowsOf = async (actor: string): Promise<number> => {
    const { rows } = await scratch.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE actor = $1 AND action = 'security.probe.alerted'`,
      [actor],
    );
    return rows[0].n;
  };

  it(
    'đạt ngưỡng thì một lá; dưới hệ số × ngưỡng trong lúc nghỉ thì im; vượt thì thêm ĐÚNG một lá',
    async () => {
      const actor = newActor();
      await seedFailures(actor, THRESHOLD);
      await probe.noteFailure(actor);
      expect(await lettersOf(actor)).toEqual([{ count: THRESHOLD, escalated: null }]);

      // Còn thiếu một lượt nữa mới chạm 3 × 3 = 9.
      await seedFailures(actor, THRESHOLD * MULTIPLIER - THRESHOLD - 1);
      await probe.noteFailure(actor);
      expect(await lettersOf(actor)).toHaveLength(1);

      await seedFailures(actor, 1);
      await probe.noteFailure(actor);
      const letters = await lettersOf(actor);
      expect(letters).toHaveLength(2);
      expect(letters[1]).toEqual({ count: THRESHOLD * MULTIPLIER, escalated: true });

      // Bắn tiếp bao nhiêu nữa trong cùng thời gian nghỉ cũng không thêm lá nào.
      await seedFailures(actor, 20);
      await probe.noteFailure(actor);
      expect(await lettersOf(actor)).toHaveLength(2);
      // Vết và thư đi cùng nhau (AD-5): mỗi lá một dòng vết.
      expect(await alertRowsOf(actor)).toBe(2);
    },
    TEST_TIMEOUT,
  );

  it(
    '30 lượt song song đã vượt hệ số × ngưỡng sau lá đầu chỉ sinh ra ĐÚNG MỘT lá leo thang',
    async () => {
      const actor = newActor();
      await seedFailures(actor, THRESHOLD);
      await probe.noteFailure(actor);
      await seedFailures(actor, THRESHOLD * MULTIPLIER);

      await Promise.all(Array.from({ length: 30 }, () => probe.noteFailure(actor)));

      const letters = await lettersOf(actor);
      expect(letters).toHaveLength(2);
      expect(letters[1].escalated).toBe(true);
      expect(await alertRowsOf(actor)).toBe(2);
    },
    TEST_TIMEOUT,
  );

  it(
    'lá leo thang không tính là lá thường: chưa có lá thường thì lượt đầu vẫn là lá thường',
    async () => {
      const actor = newActor();
      // Dồn thẳng lên quá 3 × ngưỡng trước lượt gọi đầu tiên: vẫn là MỘT lá thường, chưa leo thang.
      await seedFailures(actor, THRESHOLD * MULTIPLIER + 5);
      await probe.noteFailure(actor);
      expect(await lettersOf(actor)).toEqual([{ count: THRESHOLD * MULTIPLIER + 5, escalated: null }]);

      await seedFailures(actor, 1);
      await probe.noteFailure(actor);
      const letters = await lettersOf(actor);
      expect(letters).toHaveLength(2);
      expect(letters[1].escalated).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    'hệ số dưới 2 là cấu hình vô nghĩa: không leo thang, lá thường vẫn đi',
    async () => {
      const actor = newActor();
      const invalid = probeWith(1);
      await seedFailures(actor, THRESHOLD);
      await invalid.noteFailure(actor);
      await seedFailures(actor, 50);
      await invalid.noteFailure(actor);
      expect(await lettersOf(actor)).toEqual([{ count: THRESHOLD, escalated: null }]);
    },
    TEST_TIMEOUT,
  );
});
