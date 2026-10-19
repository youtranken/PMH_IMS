import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migration-runner';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import { OwnerExistsRegistry } from '../src/common/owner-exists.registry';
import { ApprovalsApiService } from '../src/modules/approvals/approvals.api';
import { ApprovalsService } from '../src/modules/approvals/approvals.service';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { FilesApiService } from '../src/modules/files/files.api';
import { FilesService } from '../src/modules/files/files.service';
import { IsoAccessService, type IsoActor } from '../src/modules/iso-forms/iso-access.service';
import { IsoAntivirusService } from '../src/modules/iso-forms/iso-antivirus.service';
import { IsoBackupService } from '../src/modules/iso-forms/iso-backup.service';
import { IsoCatalogService } from '../src/modules/iso-forms/iso-catalog.service';
import { IsoClock } from '../src/modules/iso-forms/iso-clock';
import { IsoFileOwner } from '../src/modules/iso-forms/iso-file-owner';
import { IsoIncidentService } from '../src/modules/iso-forms/iso-incident.service';
import { IsoPeriodService } from '../src/modules/iso-forms/iso-period.service';
import { IsoPeriodStore, JOB_LIST_LOCK } from '../src/modules/iso-forms/iso-period.store';
import type { IncidentInput } from '../src/modules/iso-forms/iso-rules';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Hàng rào của phiếu ISO mà lưới và luồng chốt kỳ dựa vào (Q-28): một phiếu 0206 không được ra /
 * vào hồ sơ của một kỳ đã khoá, bản ký chỉ người phụ trách tải lên, ngày 0208 không vừa "không có
 * issue" vừa có issue, và kiểm "đã gắn phiếu" phải đứng sau khoá hàng chứ không đọc trước.
 */

const TEST_TIMEOUT = 180_000;
const noopSweep = { register: () => undefined } as unknown as SweepService;
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

class FixedClock extends IsoClock {
  day = '2026-11-10';
  override now(): Date {
    return new Date(`${this.day}T05:00:00Z`);
  }
}

describe('Phiếu ISO · hàng rào kỳ khoá, bản ký, issue 0208', () => {
  let scratch: ScratchDb;
  let config: SystemConfigService;
  let clock: FixedClock;
  let backup: IsoBackupService;
  let antivirus: IsoAntivirusService;
  let incidents: IsoIncidentService;
  let periods: IsoPeriodService;
  let catalog: IsoCatalogService;
  let files: FilesService;
  let storage: string;
  let line: string;
  const previousDir = process.env.FILE_STORAGE_DIR;
  const people: Record<'sa' | 'owner' | 'other', IsoActor> = {} as never;

  async function addUser(key: keyof typeof people, role: IsoActor['role']): Promise<void> {
    const email = `e2e-isog-${key}@qa.test`;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, 'x') RETURNING id`,
      [email, `E2E ISO ${key}`, role],
    );
    people[key] = { id: rows[0].id, email, role };
  }

  function incident(day: string, over: Partial<IncidentInput> = {}): IncidentInput {
    return {
      reportedOn: day,
      kind: 'other',
      detectedAt: `${day}T01:00:00.000Z`,
      resolvedAt: `${day}T03:00:00.000Z`,
      severity: 'low',
      status: 'resolved',
      description: 'E2E sự cố',
      correctiveAction: 'Xử lý',
      backupDetails: [],
      ...over,
    };
  }

  async function lockPeriod(form: '0203' | '0208', year: number, month: number): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO iso_period (form_type, year, month, state, locked_at) VALUES ($1, $2, $3, 'locked', now())
       ON CONFLICT (form_type, year, month) DO UPDATE SET state = 'locked', locked_at = now() RETURNING id`,
      [form, year, month],
    );
    return rows[0].id;
  }

  async function failCell(day: string): Promise<{ form: '0203'; lineId: string; day: string }> {
    await backup.setTick(people.owner, { lineId: line, day, result: 'fail' });
    return { form: '0203', lineId: line, day };
  }

  function upload(ownerType: 'iso_period' | 'iso_incident', ownerId: string, who: IsoActor) {
    return files.save({
      buffer: PDF,
      originalName: 'ky.pdf',
      ownerType,
      ownerId,
      uploadedBy: who.id,
      actor: who.email,
      actorRole: who.role,
    });
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_iso_guards');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    await scratch.pool.query(`UPDATE system_config SET value = '"2026-01"' WHERE key = 'iso.first_month'`);
    storage = await mkdtemp(join(tmpdir(), 'ims-iso-guards-'));
    process.env.FILE_STORAGE_DIR = storage;

    const db = scratch.db;
    const audit = new AuditWriterService(db);
    config = new SystemConfigService(db);
    const users = new UsersApiService(new UsersService(db));
    const kinds = new ApprovalKindRegistry();
    const owners = new OwnerExistsRegistry();
    clock = new FixedClock(config);
    files = new FilesService(db, audit, owners, users, config, noopSweep);
    const filesApi = new FilesApiService(files);
    const access = new IsoAccessService(db, audit, users);
    const store = new IsoPeriodStore(db, config);
    catalog = new IsoCatalogService(db, audit, access);
    backup = new IsoBackupService(db, audit, access, store, clock, config);
    antivirus = new IsoAntivirusService(db, audit, access, store, catalog, clock, config);
    incidents = new IsoIncidentService(db, audit, access, store, filesApi, users, clock);
    periods = new IsoPeriodService(
      db,
      audit,
      access,
      store,
      backup,
      antivirus,
      incidents,
      new ApprovalsApiService(new ApprovalsService(db, audit, kinds)),
      kinds,
      new OutboxService(db, config, noopSweep),
      filesApi,
      users,
      clock,
    );
    periods.onModuleInit();
    new IsoFileOwner(owners, store, incidents, access, config).onModuleInit();

    await addUser('sa', 'sa');
    await addUser('owner', 'member');
    await addUser('other', 'member');
    for (const form of ['0203', '0208'] as const) {
      await access.setOwners(people.sa, form, { primaryUserId: people.owner.id, backupUserId: null });
    }
    const job = await catalog.createJob(people.owner, {
      no: 1,
      name: 'E2E-GUARD',
      trackedFrom: '2026-01-01',
      lines: [{ label: null, pointsNas: null, storageNas: null, pointsCloud: null, storageCloud: null }],
    });
    line = job.lines[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    process.env.FILE_STORAGE_DIR = previousDir;
    await rm(storage, { recursive: true, force: true }).catch(() => undefined);
    await scratch?.drop();
  }, TEST_TIMEOUT);

  describe('0206 không ra / vào hồ sơ của kỳ đã khoá', () => {
    it('phiếu lập thẳng gắn thêm ô 0203 thì rời kỳ 0208 đã khoá: bị chặn', async () => {
      const direct = await incidents.create(people.owner, { ...incident('2026-11-03'), cells: [] });
      expect(direct.governing).toEqual(['0203', '0208']);
      const cell = await failCell('2026-11-04');
      await lockPeriod('0208', 2026, 11);
      await expect(incidents.update(people.owner, direct.id, { ...incident('2026-11-03'), cells: [cell] })).rejects.toMatchObject({
        response: { code: 'ISO_PERIOD_LOCKED' },
      });
    });

    it('bỏ ô 0203 cuối cùng thì phiếu thành lập thẳng, vào kỳ 0208 đã khoá: bị chặn', async () => {
      const cell = await failCell('2026-11-05');
      const fromCell = await incidents.create(people.owner, { ...incident('2026-11-05'), cells: [cell] });
      expect(fromCell.governing).toEqual(['0203']);
      await expect(incidents.update(people.owner, fromCell.id, { ...incident('2026-11-05'), cells: [] })).rejects.toMatchObject({
        response: { code: 'ISO_PERIOD_LOCKED' },
      });
    });

    it('sửa nội dung mà không đổi kỳ quản thì vẫn sửa được', async () => {
      const cell = await failCell('2026-11-06');
      const saved = await incidents.create(people.owner, { ...incident('2026-11-06'), cells: [cell] });
      const after = await incidents.update(people.owner, saved.id, { ...incident('2026-11-06', { description: 'E2E sửa mô tả' }), cells: [cell] });
      expect(after.description).toBe('E2E sửa mô tả');
    });

    it('đổi Detection Time sang tháng khác thì rời kỳ cũ đã khoá: bị chặn', async () => {
      const direct = await incidents.create(people.owner, { ...incident('2026-08-05'), cells: [] });
      await lockPeriod('0208', 2026, 8);
      await expect(incidents.update(people.owner, direct.id, { ...incident('2026-07-05'), cells: [] })).rejects.toMatchObject({
        response: { code: 'ISO_PERIOD_LOCKED' },
      });
    });

    it('sự cố cuối tháng chỉ có ô ✗ của tháng sau: thuộc kỳ 0203 của tháng đó, không kéo theo 0208', async () => {
      await lockPeriod('0208', 2026, 10);
      const cell = await failCell('2026-11-01');
      // 23:00 ngày 31/10 giờ Việt Nam.
      const saved = await incidents.create(people.owner, {
        ...incident('2026-11-01', { kind: 'backup', detectedAt: '2026-10-31T16:00:00.000Z', resolvedAt: '2026-11-01T02:00:00.000Z' }),
        cells: [cell],
      });
      expect(saved.month).toBe(10);
      expect(saved.governing).toEqual(['0203']);
    });
  });

  describe('0206 khoá sửa khi kỳ quản nó đang Chờ duyệt', () => {
    async function pendPeriod(form: '0203' | '0208', year: number, month: number): Promise<void> {
      await scratch.pool.query(
        `INSERT INTO iso_period (form_type, year, month, state) VALUES ($1, $2, $3, 'pending')
         ON CONFLICT (form_type, year, month) DO UPDATE SET state = 'pending'`,
        [form, year, month],
      );
    }

    it('phiếu Resolved: sửa nội dung bị chặn ISO_INCIDENT_IN_REVIEW, đọc ra inReview', async () => {
      const cell = await failCell('2026-04-03');
      const saved = await incidents.create(people.owner, { ...incident('2026-04-03'), cells: [cell] });
      await pendPeriod('0203', 2026, 4);
      const read = await incidents.get(saved.id);
      expect(read.inReview).toBe(true);
      expect(read.locked).toBe(false);
      await expect(
        incidents.update(people.owner, saved.id, { ...incident('2026-04-03', { description: 'E2E đổi khi chờ duyệt' }), cells: [cell] }),
      ).rejects.toMatchObject({ response: { code: 'ISO_INCIDENT_IN_REVIEW' } });
    });

    it('phiếu In Progress vẫn sửa được khi kỳ Chờ duyệt', async () => {
      const cell = await failCell('2026-03-03');
      const open = incident('2026-03-03', { status: 'in_progress', resolvedAt: null, correctiveAction: '' });
      const saved = await incidents.create(people.owner, { ...open, cells: [cell] });
      await pendPeriod('0203', 2026, 3);
      expect((await incidents.get(saved.id)).inReview).toBe(false);
      const after = await incidents.update(people.owner, saved.id, { ...open, description: 'E2E vẫn sửa', cells: [cell] });
      expect(after.description).toBe('E2E vẫn sửa');
    });

    it('kỳ sang Chờ duyệt giữa lúc đọc và lúc ghi: vẫn bị chặn trong transaction', async () => {
      const cell = await failCell('2026-02-03');
      const saved = await incidents.create(people.owner, { ...incident('2026-02-03'), cells: [cell] });
      const realGet = incidents.get.bind(incidents);
      const spy = jest.spyOn(incidents, 'get').mockImplementationOnce(async (id: string) => {
        const before = await realGet(id);
        await pendPeriod('0203', 2026, 2);
        return before;
      });
      try {
        await expect(
          incidents.update(people.owner, saved.id, { ...incident('2026-02-03', { description: 'E2E chen' }), cells: [cell] }),
        ).rejects.toMatchObject({ response: { code: 'ISO_INCIDENT_IN_REVIEW' } });
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('bản ký chỉ người phụ trách và SA/Admin tải lên', () => {
    it('kỳ đã khoá: Member không phụ trách bị 403, người phụ trách và SA tải được', async () => {
      const periodId = await lockPeriod('0203', 2026, 6);
      await expect(upload('iso_period', periodId, people.other)).rejects.toMatchObject({ response: { code: 'ISO_NOT_OWNER' } });
      await expect(upload('iso_period', periodId, people.owner)).resolves.toBeDefined();
      await expect(upload('iso_period', periodId, people.sa)).resolves.toBeDefined();
    });

    it('0206 lập từ ô 0203 theo quyền 0203; 0206 lập thẳng thì mọi tài khoản IT', async () => {
      const cell = await failCell('2026-05-04');
      const fromCell = await incidents.create(people.owner, { ...incident('2026-05-04'), cells: [cell] });
      const direct = await incidents.create(people.other, { ...incident('2026-05-06'), cells: [] });
      await lockPeriod('0203', 2026, 5);
      await lockPeriod('0208', 2026, 5);
      await expect(upload('iso_incident', fromCell.id, people.other)).rejects.toMatchObject({ response: { code: 'ISO_NOT_OWNER' } });
      await expect(upload('iso_incident', fromCell.id, people.owner)).resolves.toBeDefined();
      await expect(upload('iso_incident', direct.id, people.other)).resolves.toBeDefined();
    });
  });

  /**
   * `setTick` khoá kỳ (FOR SHARE) rồi mới khoá ô. Lưu 0206 phải đi cùng thứ tự: lượt gửi chốt đang
   * giữ / chờ FOR UPDATE kỳ thì lượt lưu dừng ở kỳ, chưa giữ ô — nếu không ba lượt khép vòng chờ.
   */
  it('lưu 0206 gắn ô ✗ khoá kỳ trước khi khoá ô', async () => {
    const cell = await failCell('2026-07-14');
    const client = await scratch.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT id FROM iso_period WHERE form_type = '0203' AND year = 2026 AND month = 7 FOR UPDATE`);
      const pending = incidents.create(people.owner, { ...incident('2026-07-14', { kind: 'backup' }), cells: [cell] }).then(
        () => 'ok',
        () => 'err',
      );
      for (let i = 0; i < 200; i += 1) {
        const { rows } = await scratch.pool.query(
          `SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE NOT l.granted AND a.datname = current_database()`,
        );
        if (rows.length > 0) break;
        await new Promise((r) => setImmediate(r));
      }
      // Lượt lưu đang đợi kỳ: ô vẫn khoá được ngay.
      const other = await scratch.pool.connect();
      try {
        await other.query('BEGIN');
        await expect(
          other.query(`SELECT 1 FROM iso_backup_tick WHERE line_id = $1 AND day = '2026-07-14' FOR UPDATE NOWAIT`, [cell.lineId]),
        ).resolves.toBeDefined();
        await other.query('ROLLBACK');
      } finally {
        other.release();
      }
      await client.query('COMMIT');
      expect(await pending).toBe('ok');
    } finally {
      client.release();
    }
  });

  /**
   * Gửi chốt 0203 kiểm ô trống rồi chụp danh sách job: một lượt thêm / ngừng / tiếp tục job chen vào
   * giữa hai bước đó thì bản chụp có job chưa được kiểm. Lượt gửi giữ khoá danh sách job, lượt sửa
   * danh sách phải chờ.
   */
  it('sửa danh sách job chờ lượt gửi chốt 0203 đang giữ khoá danh sách', async () => {
    const client = await scratch.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [JOB_LIST_LOCK]);
      let done = false;
      const pending = catalog
        .createJob(people.owner, {
          no: 777,
          name: 'E2E-LOCK-LIST',
          trackedFrom: '2026-07-01',
          lines: [{ label: null, pointsNas: null, storageNas: null, pointsCloud: null, storageCloud: null }],
        })
        .finally(() => (done = true));
      let waiting = false;
      for (let i = 0; i < 200 && !waiting; i += 1) {
        const { rows } = await scratch.pool.query(
          `SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE NOT l.granted AND l.locktype = 'advisory' AND a.datname = current_database()`,
        );
        waiting = rows.length > 0;
        if (!waiting) await new Promise((r) => setImmediate(r));
      }
      expect(waiting).toBe(true);
      expect(done).toBe(false);
      await client.query('COMMIT');
      await pending;
    } finally {
      client.release();
    }
  });

  it('ô ✗ của tháng trước tháng bắt đầu dùng IMS không còn trong danh sách chờ lập 0206', async () => {
    const cell = await failCell('2026-01-20');
    expect((await incidents.unlinked({})).some((c) => c.lineId === cell.lineId && c.day === cell.day)).toBe(true);
    await scratch.pool.query(`UPDATE system_config SET value = '"2026-02"' WHERE key = 'iso.first_month'`);
    config.forget('iso.first_month');
    try {
      expect((await incidents.unlinked({})).some((c) => c.day < '2026-02-01')).toBe(false);
    } finally {
      await scratch.pool.query(`UPDATE system_config SET value = '"2026-01"' WHERE key = 'iso.first_month'`);
      config.forget('iso.first_month');
    }
  });

  it('kỳ đã có bản ký nhưng còn 0206 thuộc kỳ chưa có bản ký vẫn là việc "chờ bản ký"', async () => {
    const direct = await incidents.create(people.owner, { ...incident('2026-07-20'), cells: [] });
    // Phiếu lập thẳng thuộc cả hai kỳ của tháng.
    for (const form of ['0203', '0208'] as const) await upload('iso_period', await lockPeriod(form, 2026, 7), people.owner);
    // Phiếu khác của tháng (từ bài trước) ký trước, để chỉ còn phiếu này quyết định.
    for (const other of await incidents.ofMonth(2026, 7)) {
      if (other.id !== direct.id && !other.signedCurrent) await upload('iso_incident', other.id, people.owner);
    }
    const before = (await periods.todo(people.owner)).awaitingSigned;
    await upload('iso_incident', direct.id, people.owner);
    expect((await periods.todo(people.owner)).awaitingSigned).toBe(before - 2);
  });

  it('kỳ khoá tháng 12 chưa có bản ký vẫn đếm sang năm sau', async () => {
    await lockPeriod('0203', 2026, 12);
    clock.day = '2027-01-05';
    try {
      expect((await periods.todo(people.owner)).awaitingSigned).toBeGreaterThanOrEqual(1);
    } finally {
      clock.day = '2026-11-10';
    }
  });

  describe('0208', () => {
    let divisionId: string;

    it('ngày đã có dòng issue vẫn tick Other Division được (Q-28, bấm từng dòng)', async () => {
      await antivirus.createIssue(people.owner, {
        reportedOn: '2026-09-03',
        divisionId: null,
        newDivisionName: 'E2E Guard Division',
        computerName: 'E2E-PC-1',
        description: 'Trojan',
        resolvedOn: null,
      }).then((i) => (divisionId = i.divisionId));
      await antivirus.markClear(people.owner, '2026-09-03');
      expect(Number((await scratch.pool.query(`SELECT count(*) FROM iso_av_clear_day WHERE day = '2026-09-03'`)).rows[0].count)).toBe(1);
    });

    /**
     * Một lượt gắn issue vào 0206 đang giữ khoá hàng issue (như `resolveCellsWithin`) thì lượt sửa
     * / xoá issue phải chờ rồi đọc lại "đã gắn chưa", không dùng kết quả đọc trước khi chờ.
     */
    async function whileLinking(issueId: string, act: () => Promise<unknown>): Promise<unknown> {
      const direct = await incidents.create(people.owner, { ...incident('2026-09-10'), cells: [] });
      const client = await scratch.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT id FROM iso_av_issue WHERE id = $1 FOR UPDATE`, [issueId]);
        await client.query(`INSERT INTO iso_incident_cell (incident_id, av_issue_id) VALUES ($1, $2)`, [direct.id, issueId]);
        const pending = act().then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        // Chờ tới khi lượt kia đứng đợi khoá hàng — không đoán bằng thời gian.
        for (let i = 0; i < 200; i += 1) {
          const { rows } = await scratch.pool.query(
            `SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE NOT l.granted AND a.datname = current_database()`,
          );
          if (rows.length > 0) break;
          await new Promise((r) => setImmediate(r));
        }
        await client.query('COMMIT');
        return await pending;
      } finally {
        client.release();
      }
    }

    async function freshIssue(day: string, pc: string): Promise<string> {
      const issue = await antivirus.createIssue(people.owner, {
        reportedOn: day,
        divisionId,
        newDivisionName: null,
        computerName: pc,
        description: 'Trojan',
        resolvedOn: null,
      });
      return issue.id;
    }

    it('đổi ngày issue đúng lúc nó đang được gắn vào 0206: bị chặn ISO_CELL_LINKED', async () => {
      const id = await freshIssue('2026-09-12', 'E2E-PC-2');
      const result = (await whileLinking(id, () =>
        antivirus.updateIssue(people.owner, id, {
          reportedOn: '2026-09-11',
          divisionId,
          newDivisionName: null,
          computerName: 'E2E-PC-2',
          description: 'Trojan',
          resolvedOn: null,
        }),
      )) as { error?: { response?: { code?: string } } };
      expect(result.error?.response?.code).toBe('ISO_CELL_LINKED');
    });

    it('xoá issue đúng lúc nó đang được gắn vào 0206: 409 ISO_CELL_LINKED, không phải lỗi khoá ngoại', async () => {
      const id = await freshIssue('2026-09-13', 'E2E-PC-3');
      const result = (await whileLinking(id, () => antivirus.deleteIssue(people.owner, id))) as {
        error?: { response?: { code?: string } };
      };
      expect(result.error?.response?.code).toBe('ISO_CELL_LINKED');
    });
  });
});
