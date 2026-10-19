import { runMigrations } from '../src/database/migration-runner';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { IsoActor } from '../src/modules/iso-forms/iso-access.service';
import { IsoCatalogService } from '../src/modules/iso-forms/iso-catalog.service';
import { JOB_LIST_LOCK } from '../src/modules/iso-forms/iso-period.store';
import { createScratchDb, migrationsDir, type ScratchDb, waitForLock } from './db';

/**
 * Số No của job 0203 đang theo dõi không được trùng: phiếu in theo No, hai dòng cùng số thì đọc
 * sai. Service kiểm trước khi ghi nhưng chỉ giữ khoá advisory dạng shared, nên hai lượt tạo cùng
 * lúc cùng qua bước kiểm. DB phải là chỗ chặn thật — và vẫn cho `moveJob` tráo số hai job.
 */

const TEST_TIMEOUT = 120_000;

describe('số No job 0203 không trùng khi tạo đồng thời', () => {
  let scratch: ScratchDb;
  let catalog: IsoCatalogService;
  let actor: IsoActor;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_iso_job_no');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash) VALUES ('e2e-iso-no@qa.test', 'E2E ISO no', 'sa', 'x') RETURNING id`,
    );
    actor = { id: rows[0].id, email: 'e2e-iso-no@qa.test', role: 'sa' };
    catalog = new IsoCatalogService(scratch.db, new AuditWriterService(scratch.db));
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  const job = (no: number, name: string) => ({ no, name, trackedFrom: '2026-11-01', lines: [{ label: null, pointsNas: '1', storageNas: null, pointsCloud: null, storageCloud: null }] });

  it(
    'hai lượt tạo cùng số: một lượt được lưu, lượt kia nhận 409 ISO_JOB_NO_TAKEN',
    async () => {
      // Giữ khoá danh sách job ở chế độ exclusive để hai lượt cùng đứng chờ rồi cùng đi tiếp.
      const blocker = await scratch.pool.connect();
      let results: PromiseSettledResult<unknown>[];
      try {
        await blocker.query('BEGIN');
        await blocker.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [JOB_LIST_LOCK]);
        const first = catalog.createJob(actor, job(7, 'E2E Job A'));
        void first.catch(() => undefined);
        const second = catalog.createJob(actor, job(7, 'E2E Job B'));
        void second.catch(() => undefined);
        await waitForLock(scratch.pool, 10_000, 2);
        await blocker.query('COMMIT');
        results = await Promise.allSettled([first, second]);
      } finally {
        blocker.release();
      }
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toMatchObject({ status: 409, response: { code: 'ISO_JOB_NO_TAKEN' } });
      const { rows } = await scratch.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM iso_backup_job WHERE no = 7 AND stopped_on IS NULL`,
      );
      expect(rows[0].n).toBe(1);
    },
    TEST_TIMEOUT,
  );

  it(
    'đổi thứ tự (tráo số hai job) vẫn chạy được',
    async () => {
      const a = await catalog.createJob(actor, job(20, 'E2E Move A'));
      const b = await catalog.createJob(actor, job(21, 'E2E Move B'));
      await catalog.moveJob(actor, a.id, 'down');
      const after = await catalog.jobs('live');
      expect(after.find((j) => j.id === a.id)?.no).toBe(21);
      expect(after.find((j) => j.id === b.id)?.no).toBe(20);
    },
    TEST_TIMEOUT,
  );

  it(
    'đường hỏng tuần tự: tạo trùng số với job đang theo dõi bị chặn; trùng với job đã ngừng thì được',
    async () => {
      const old = await catalog.createJob(actor, job(30, 'E2E Old'));
      await expect(catalog.createJob(actor, job(30, 'E2E Dup'))).rejects.toMatchObject({ response: { code: 'ISO_JOB_NO_TAKEN' } });
      await catalog.stopJob(actor, old.id, '2026-11-01');
      await expect(catalog.createJob(actor, job(30, 'E2E New'))).resolves.toMatchObject({ no: 30 });
    },
    TEST_TIMEOUT,
  );
});
