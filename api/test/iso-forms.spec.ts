import { readFileSync } from 'node:fs';
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
import { IsoPeriodStore } from '../src/modules/iso-forms/iso-period.store';
import type { IncidentInput } from '../src/modules/iso-forms/iso-rules';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Phiếu ISO đợt 1 (Q-28, Story 8.1–8.6) trên Postgres thật: quyền người phụ trách kiểm ở API, ô
 * khoá theo kỳ, một ô ✗ một phiếu, số 0206 không trùng khi lưu đồng thời, gửi chốt bị chặn khi
 * còn thiếu, duyệt / trả lại / mở lại qua `approvals`, bản ký chỉ nhận khi đã khoá.
 */

const TEST_TIMEOUT = 180_000;
const noopSweep = { register: () => undefined } as unknown as SweepService;

class FixedClock extends IsoClock {
  day = '2026-11-10';
  override now(): Date {
    return new Date(`${this.day}T05:00:00Z`);
  }
}

describe('Phiếu ISO · 0203 / 0206 / 0208 và kỳ (Q-28)', () => {
  let scratch: ScratchDb;
  let clock: FixedClock;
  let access: IsoAccessService;
  let catalog: IsoCatalogService;
  let backup: IsoBackupService;
  let antivirus: IsoAntivirusService;
  let incidents: IsoIncidentService;
  let periods: IsoPeriodService;
  let files: FilesService;
  let storage: string;
  const previousDir = process.env.FILE_STORAGE_DIR;

  const people: Record<'sa' | 'admin' | 'owner' | 'backup' | 'other', IsoActor> = {} as never;

  async function addUser(key: keyof typeof people, role: IsoActor['role']): Promise<void> {
    const email = `e2e-iso-${key}@qa.test`;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, 'x') RETURNING id`,
      [email, `E2E ISO ${key}`, role],
    );
    people[key] = { id: rows[0].id, email, role };
  }

  function incident(over: Partial<IncidentInput> = {}): IncidentInput {
    return {
      reportedOn: '2026-11-05',
      kind: 'backup',
      detectedAt: '2026-11-05T01:00:00.000Z',
      resolvedAt: '2026-11-05T03:00:00.000Z',
      severity: 'medium',
      status: 'resolved',
      description: 'Job lỗi VSS',
      correctiveAction: 'Chạy lại',
      backupDetails: [],
      ...over,
    };
  }

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await scratch.pool.query<Record<string, unknown>>(sql, params);
    return Number(Object.values(rows[0])[0]);
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_iso_forms');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    await scratch.pool.query(`UPDATE system_config SET value = '"2026-01"' WHERE key = 'iso.first_month'`);
    storage = await mkdtemp(join(tmpdir(), 'ims-iso-'));
    process.env.FILE_STORAGE_DIR = storage;

    const db = scratch.db;
    const audit = new AuditWriterService(db);
    const config = new SystemConfigService(db);
    const users = new UsersApiService(new UsersService(db));
    const kinds = new ApprovalKindRegistry();
    const owners = new OwnerExistsRegistry();
    clock = new FixedClock(config);
    files = new FilesService(db, audit, owners, users, config, noopSweep);
    const filesApi = new FilesApiService(files);
    access = new IsoAccessService(db, audit, users);
    const store = new IsoPeriodStore(db, config);
    catalog = new IsoCatalogService(db, audit);
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
    new IsoFileOwner(owners, store, incidents, config).onModuleInit();

    await addUser('sa', 'sa');
    await addUser('admin', 'admin');
    await addUser('owner', 'member');
    await addUser('backup', 'member');
    await addUser('other', 'member');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    process.env.FILE_STORAGE_DIR = previousDir;
    await rm(storage, { recursive: true, force: true }).catch(() => undefined);
    await scratch?.drop();
  }, TEST_TIMEOUT);

  describe('Story 8.1 · danh mục và người phụ trách', () => {
    it('migration không seed job, chỉ seed một bộ phận làm ví dụ', async () => {
      expect(await count('SELECT count(*) FROM iso_backup_job')).toBe(0);
      expect(await count('SELECT count(*) FROM iso_division')).toBe(1);
    });

    it('chưa gán người phụ trách thì chỉ SA/Admin ghi được', async () => {
      expect(await access.canWrite(people.admin, '0203')).toBe(true);
      await expect(access.assertCanWrite(people.owner, '0203')).rejects.toMatchObject({
        response: { code: 'ISO_NOT_OWNER', message: expect.stringContaining('chưa có người phụ trách') },
      });
    });

    it('Member không gán được người phụ trách; SA gán chính + dự phòng', async () => {
      await expect(
        access.setOwners(people.owner, '0203', { primaryUserId: people.owner.id, backupUserId: null }),
      ).rejects.toMatchObject({ response: { code: 'ISO_OWNER_MANAGER_ONLY' } });
      for (const form of ['0203', '0208'] as const) {
        await access.setOwners(people.sa, form, { primaryUserId: people.owner.id, backupUserId: people.backup.id });
      }
      expect(await access.canWrite(people.backup, '0203')).toBe(true);
      expect(await access.canWrite(people.other, '0203')).toBe(false);
    });

    it('tên job trùng trong danh sách đang theo dõi bị từ chối; job ngừng thì dùng lại được tên', async () => {
      const first = await catalog.createJob(people.owner, {
        no: 90,
        name: 'E2E-DUP',
        trackedFrom: '2026-10-01',
        lines: [{ label: null, pointsNas: '7', storageNas: 'NAS', pointsCloud: null, storageCloud: null }],
      });
      await expect(
        catalog.createJob(people.owner, { no: 91, name: ' e2e-dup ', trackedFrom: '2026-10-01', lines: first.lines }),
      ).rejects.toMatchObject({ response: { code: 'ISO_JOB_NAME_TAKEN' } });
      await catalog.stopJob(people.owner, first.id, '2026-10-02');
      const again = await catalog.createJob(people.owner, {
        no: 90,
        name: 'E2E-DUP',
        trackedFrom: '2026-10-03',
        lines: first.lines.map((l) => ({ ...l, id: undefined })),
      });
      await expect(catalog.resumeJob(people.owner, first.id)).rejects.toMatchObject({ response: { code: 'ISO_JOB_NO_TAKEN' } });
      await catalog.stopJob(people.owner, again.id, '2026-10-03');
    });
  });

  describe('Story 8.2 · lưới 0203', () => {
    let lineA: string;
    let lineB: string;

    beforeAll(async () => {
      clock.day = '2026-11-10';
      const job = await catalog.createJob(people.owner, {
        no: 1,
        name: 'E2E-FS1',
        trackedFrom: '2026-11-01',
        lines: [
          { label: 'OS', pointsNas: '14', storageNas: 'NAS', pointsCloud: '14', storageCloud: 'Cloud' },
          { label: 'Volume_E', pointsNas: '31', storageNas: 'NAS', pointsCloud: null, storageCloud: null },
        ],
      });
      [lineA, lineB] = job.lines.map((l) => l.id);
    });

    it('Member không phụ trách bị 403 kể cả gọi thẳng API', async () => {
      await expect(backup.setTick(people.other, { lineId: lineA, day: '2026-11-01', result: 'ok' })).rejects.toMatchObject({
        response: { code: 'ISO_NOT_OWNER' },
      });
    });

    it('ngày tương lai và ngày trước khi theo dõi không bấm được', async () => {
      await expect(backup.setTick(people.owner, { lineId: lineA, day: '2026-11-11', result: 'ok' })).rejects.toMatchObject({
        response: { code: 'ISO_CELL_FUTURE' },
      });
      await expect(backup.setTick(people.owner, { lineId: lineA, day: '2026-10-31', result: 'ok' })).rejects.toMatchObject({
        response: { code: 'ISO_CELL_OUT_OF_TRACKING' },
      });
    });

    it('nút ✓ đầu cột đánh hết ô trống của ngày, ô ✗ giữ nguyên', async () => {
      await backup.setTick(people.owner, { lineId: lineA, day: '2026-11-02', result: 'fail' });
      const { filled } = await backup.fillDay(people.backup, '2026-11-02');
      expect(filled).toBe(1);
      const grid = await backup.grid(people.other, 2026, 11);
      expect(grid.canEdit).toBe(false);
      expect(grid.ticks.filter((t) => t.day === '2026-11-02').map((t) => t.result).sort()).toEqual(['fail', 'ok']);
      expect(grid.summary.unlinkedFails).toEqual([{ lineId: lineA, day: '2026-11-02' }]);
    });

    it('đánh đủ ngày 1–10 trừ một ô bỏ sót', async () => {
      for (let d = 1; d <= 10; d += 1) {
        const day = `2026-11-${String(d).padStart(2, '0')}`;
        if (d !== 2) await backup.fillDay(people.owner, day);
      }
      await backup.setTick(people.owner, { lineId: lineB, day: '2026-11-09', result: null });
      const grid = await backup.grid(people.owner, 2026, 11);
      expect(grid.summary.missed).toEqual([{ lineId: lineB, day: '2026-11-09' }]);
      expect(grid.summary.todayDone).toBe(grid.summary.todayTotal);
    });
  });

  describe('Story 8.3 · phiếu 0206', () => {
    it('gắn ô ✗, cấp số 0206-2026-001, ô đổi sang có phiếu; ô ✗ đã gắn không đổi được', async () => {
      const grid = await backup.grid(people.owner, 2026, 11);
      const fail = grid.ticks.find((t) => t.result === 'fail')!;
      const saved = await incidents.create(people.owner, {
        ...incident({ backupDetails: [{ jobName: 'E2E-FS1', typeBackup: 'incr', typeData: 'db', storage: 'NAS', errorMessage: 'VSS', resolution: 'Chạy lại' }] }),
        cells: [{ form: '0203', lineId: fail.lineId, day: fail.day }],
      });
      expect(saved.code).toBe('0206-2026-001');
      expect(saved.governing).toEqual(['0203']);
      expect(saved.locked).toBe(false);
      const after = await backup.grid(people.owner, 2026, 11);
      expect(after.summary.unlinkedFails).toEqual([]);
      await expect(backup.setTick(people.owner, { lineId: fail.lineId, day: fail.day, result: 'ok' })).rejects.toMatchObject({
        response: { code: 'ISO_CELL_LINKED' },
      });
      await expect(
        incidents.create(people.owner, { ...incident(), cells: [{ form: '0203', lineId: fail.lineId, day: fail.day }] }),
      ).rejects.toMatchObject({ response: { code: 'ISO_CELL_ALREADY_LINKED' } });
    });

    it('phiếu từ ô 0203 theo quyền 0203; phiếu lập thẳng thì Member nào cũng lập được', async () => {
      await backup.setTick(people.owner, { lineId: (await backup.grid(people.owner, 2026, 11)).rows[0].lineId, day: '2026-11-03', result: 'fail' });
      const grid = await backup.grid(people.owner, 2026, 11);
      const fail = grid.summary.unlinkedFails[0];
      await expect(
        incidents.create(people.other, { ...incident(), cells: [{ form: '0203', lineId: fail.lineId, day: fail.day }] }),
      ).rejects.toMatchObject({ response: { code: 'ISO_NOT_OWNER' } });
      const direct = await incidents.create(people.other, { ...incident({ kind: 'server' }), cells: [] });
      expect(direct.governing).toEqual(['0203', '0208']);
      await incidents.create(people.owner, { ...incident(), cells: [{ form: '0203', lineId: fail.lineId, day: fail.day }] });
    });

    it('hai người lưu cùng lúc không lấy trùng số phiếu', async () => {
      const saved = await Promise.all(
        Array.from({ length: 6 }, () => incidents.create(people.other, { ...incident({ kind: 'network' }), cells: [] })),
      );
      const codes = saved.map((s) => s.code);
      expect(new Set(codes).size).toBe(6);
      expect(await count(`SELECT count(DISTINCT code) FROM iso_incident WHERE year = 2026`)).toBe(await count(`SELECT count(*) FROM iso_incident`));
    });

    it('In Progress không có Resolution Time; Resolved bắt buộc có', async () => {
      await expect(
        incidents.create(people.other, { ...incident({ kind: 'other', status: 'resolved', resolvedAt: null }), cells: [] }),
      ).rejects.toMatchObject({ response: { code: 'ISO_INCIDENT_INVALID' } });
      const open = await incidents.create(people.other, {
        ...incident({ kind: 'other', status: 'in_progress', resolvedAt: null, correctiveAction: '' }),
        cells: [],
      });
      expect(open.status).toBe('in_progress');
    });
  });

  describe('Story 8.4 · lưới 0208', () => {
    it('"không có issue", ghi issue kèm bộ phận mới tại chỗ, ngày đã có kết quả', async () => {
      await antivirus.markClear(people.owner, '2026-11-01');
      const issue = await antivirus.createIssue(people.backup, {
        reportedOn: '2026-11-02',
        divisionId: null,
        newDivisionName: 'E2E SMD Division',
        computerName: 'E2E-PC-07',
        description: 'Trojan.Gen đã cách ly',
        resolvedOn: '2026-11-02',
        handledBy: 'Quốc Bảo',
      });
      expect(await count(`SELECT count(*) FROM iso_division WHERE name = 'E2E SMD Division'`)).toBe(1);
      await expect(antivirus.markClear(people.other, '2026-11-03')).rejects.toMatchObject({ response: { code: 'ISO_NOT_OWNER' } });
      const grid = await antivirus.grid(people.owner, 2026, 11);
      expect(grid.summary.missedDays[0]).toBe('2026-11-03');
      expect(grid.summary.unlinkedIssues).toEqual([issue.id]);
      await incidents.create(people.owner, { ...incident({ kind: 'other' }), cells: [{ form: '0208', issueId: issue.id }] });
      await expect(antivirus.deleteIssue(people.owner, issue.id)).rejects.toMatchObject({ response: { code: 'ISO_CELL_LINKED' } });
    });
  });

  describe('Story 8.5 / 8.6 · gửi chốt, duyệt, trả lại, mở lại, bản ký', () => {
    async function fillBackupMonth(): Promise<void> {
      for (let d = 1; d <= 30; d += 1) await backup.fillDay(people.owner, `2026-11-${String(d).padStart(2, '0')}`);
    }

    it('chưa tới ngày cuối tháng thì API từ chối gửi chốt', async () => {
      clock.day = '2026-11-29';
      await expect(periods.submit(people.owner, '0203', 2026, 11)).rejects.toMatchObject({ response: { code: 'ISO_PERIOD_CHECK_FAILED' } });
    });

    it('còn ô trống thì không gửi được; đủ thì gửi, kỳ Chờ duyệt và ô bị khoá ở API', async () => {
      clock.day = '2026-11-30';
      await expect(periods.submit(people.owner, '0203', 2026, 11)).rejects.toMatchObject({ response: { code: 'ISO_PERIOD_CHECK_FAILED' } });
      await fillBackupMonth();
      await expect(periods.submit(people.other, '0203', 2026, 11)).rejects.toMatchObject({ response: { code: 'ISO_NOT_OWNER' } });
      const detail = await periods.submit(people.owner, '0203', 2026, 11);
      expect(detail.state).toBe('pending');
      expect(detail.pendingClose?.requester).toBe(people.owner.email);
      const line = (await backup.grid(people.owner, 2026, 11)).rows[0].lineId;
      await expect(backup.setTick(people.owner, { lineId: line, day: '2026-11-30', result: 'fail' })).rejects.toMatchObject({
        response: { code: 'ISO_PERIOD_LOCKED' },
      });
      expect(await count(`SELECT count(*) FROM outbox WHERE topic = 'iso.period.event'`)).toBe(1);
    });

    it('kỳ đã gửi đọc danh sách job lúc gửi (AR-8): sửa tên job không đổi kỳ cũ', async () => {
      const job = (await catalog.jobs('live')).find((j) => j.name === 'E2E-FS1')!;
      await catalog.updateJob(people.owner, job.id, { no: job.no, name: 'E2E-FS1-RENAMED', trackedFrom: job.trackedFrom, lines: job.lines });
      const grid = await backup.grid(people.owner, 2026, 11);
      expect(grid.rows.some((r) => r.name === 'E2E-FS1')).toBe(true);
      expect(grid.rows.some((r) => r.name === 'E2E-FS1-RENAMED')).toBe(false);
    });

    it('Member không duyệt được; trả lại bắt buộc lý do, kỳ về Đang ghi', async () => {
      await expect(periods.approve(people.owner, '0203', 2026, 11, null)).rejects.toMatchObject({ response: { code: 'ISO_DECIDE_MANAGER_ONLY' } });
      await expect(periods.returnToSender(people.admin, '0203', 2026, 11, '  ')).rejects.toMatchObject({ response: { code: 'ISO_RETURN_NOTE_REQUIRED' } });
      const back = await periods.returnToSender(people.admin, '0203', 2026, 11, 'Ngày 14 sai');
      expect(back.state).toBe('open');
      expect(back.lastReturn?.note).toBe('Ngày 14 sai');
    });

    it('SA tự gửi rồi tự duyệt: kỳ khoá, 0206 Resolved khoá theo, In Progress vẫn sửa được', async () => {
      await periods.submit(people.sa, '0203', 2026, 11);
      const done = await periods.approve(people.sa, '0203', 2026, 11, null);
      expect(done.state).toBe('locked');
      expect(done.display).toBe('locked');
      const audit = await scratch.pool.query(`SELECT detail FROM audit_log WHERE action = 'iso_period.approved' ORDER BY created_at DESC LIMIT 1`);
      expect(audit.rows[0].detail.selfApproved).toBe(true);
      const fromCell = (await incidents.ofMonth(2026, 11)).find((i) => i.code === '0206-2026-001')!;
      expect(fromCell.locked).toBe(true);
      await expect(incidents.update(people.owner, fromCell.id, { ...incident(), cells: [] })).rejects.toMatchObject({
        response: { code: 'ISO_INCIDENT_LOCKED' },
      });
    });

    it('bản ký chỉ nhận PDF/ảnh khi đã khoá; có bản ký của kỳ và mọi 0206 thì Hoàn tất', async () => {
      const detail = await periods.detail(people.owner, '0203', 2026, 11);
      const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');
      await expect(
        files.save({ buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), originalName: 'x.png', ownerType: 'iso_period', ownerId: detail.periodId!, uploadedBy: people.owner.id, actor: people.owner.email }),
      ).resolves.toBeDefined();
      await files.save({ buffer: pdf, originalName: 'ky.pdf', ownerType: 'iso_period', ownerId: detail.periodId!, uploadedBy: people.owner.id, actor: people.owner.email });
      const after = await periods.detail(people.owner, '0203', 2026, 11);
      expect(after.signedCurrent).toBe(true);
      // Còn 0206 thuộc kỳ chưa có bản ký → chưa Hoàn tất.
      expect(after.display).toBe('locked');
      for (const i of after.incidents) {
        if (!i.locked) continue;
        await files.save({ buffer: pdf, originalName: `${i.code}.pdf`, ownerType: 'iso_incident', ownerId: i.id, uploadedBy: people.owner.id, actor: people.owner.email });
      }
      const open = after.incidents.filter((i) => !i.locked);
      for (const i of open) {
        await expect(
          files.save({ buffer: pdf, originalName: 'x.pdf', ownerType: 'iso_incident', ownerId: i.id, uploadedBy: people.owner.id, actor: people.owner.email }),
        ).rejects.toMatchObject({ response: { code: 'ISO_SIGN_NOT_LOCKED' } });
      }
    });

    it('mở lại: lý do bắt buộc, duyệt thì kỳ về Đang ghi, bản ký cũ thành cũ sau lần chốt sau', async () => {
      await expect(periods.requestReopen(people.owner, '0203', 2026, 11, ' ')).rejects.toMatchObject({ response: { code: 'APPROVAL_REASON_REQUIRED' } });
      await periods.requestReopen(people.owner, '0203', 2026, 11, 'Tick nhầm ngày 14');
      await expect(periods.requestReopen(people.owner, '0203', 2026, 11, 'lần nữa')).rejects.toMatchObject({ response: { code: 'ISO_REOPEN_PENDING' } });
      const reopened = await periods.decideReopen(people.admin, '0203', 2026, 11, true, null);
      expect(reopened.state).toBe('open');
      expect(await count(`SELECT count(*) FROM audit_log WHERE action = 'iso_period.reopened' AND detail->>'reason' = 'Tick nhầm ngày 14'`)).toBe(1);
      await periods.submit(people.owner, '0203', 2026, 11);
      const relocked = await periods.approve(people.admin, '0203', 2026, 11, null);
      expect(relocked.signed.length).toBeGreaterThan(0);
      expect(relocked.signed.every((f) => !f.current)).toBe(true);
    });
  });

  // Chạy CUỐI: lượt dọn xoá mọi job / người phụ trách e2e mà các bài ở trên dùng.
  it('lượt dọn E2E (vùng iso của reset-e2e.mjs) gỡ hết job, bộ phận, issue, phiếu và kỳ của bài kiểm', async () => {
    const job = await catalog.createJob(people.owner, {
      no: 501,
      name: 'E2E-CLEAN',
      trackedFrom: '2021-03-01',
      lines: [{ label: null, pointsNas: null, storageNas: null, pointsCloud: null, storageCloud: null }],
    });
    await scratch.pool.query(`INSERT INTO iso_backup_tick (line_id, day, result, updated_by) VALUES ($1, '2021-03-02', 'fail', 'x')`, [job.lines[0].id]);
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO iso_incident (code, year, month, reported_on, kind, detected_at, resolved_at, severity, status, description, created_by)
       VALUES ('0206-2021-001', 2021, 3, '2021-03-02', 'backup', '2021-03-02T01:00:00Z', '2021-03-02T02:00:00Z', 'low', 'resolved', 'E2E sạch', 'x') RETURNING id`,
    );
    await scratch.pool.query(`INSERT INTO iso_incident_cell (incident_id, tick_line_id, tick_day) VALUES ($1, $2, '2021-03-02')`, [rows[0].id, job.lines[0].id]);
    await scratch.pool.query(`INSERT INTO iso_period (form_type, year, month, state) VALUES ('0203', 2021, 3, 'locked')`);
    await scratch.pool.query(`INSERT INTO iso_av_clear_day (day, marked_by) VALUES ('2021-03-05', 'x')`);
    const source = readFileSync(join(__dirname, '..', 'scripts', 'reset-e2e.mjs'), 'utf8');
    const block = /\n {2}iso: \[([\s\S]*?)\n {2}\],/.exec(source);
    if (!block) throw new Error('Không tìm thấy vùng iso trong reset-e2e.mjs');
    for (const [, statement] of block[1].matchAll(/`([^`]+)`/g)) await scratch.pool.query(statement);
    expect(await count(`SELECT count(*) FROM iso_backup_job WHERE name ILIKE '%E2E%'`)).toBe(0);
    expect(await count(`SELECT count(*) FROM iso_division WHERE name ILIKE '%E2E%'`)).toBe(0);
    expect(await count(`SELECT count(*) FROM iso_av_issue WHERE computer_name ILIKE '%E2E%'`)).toBe(0);
    expect(await count(`SELECT count(*) FROM iso_incident WHERE description ILIKE '%E2E%' OR year <= 2021`)).toBe(0);
    expect(await count(`SELECT count(*) FROM iso_period WHERE year <= 2021`)).toBe(0);
    expect(await count(`SELECT count(*) FROM iso_av_clear_day WHERE day < '2022-01-01'`)).toBe(0);
  });
});
