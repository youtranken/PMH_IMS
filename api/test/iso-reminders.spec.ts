import { runMigrations } from '../src/database/migration-runner';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import { MailContentRegistry, type MailContent } from '../src/common/mail-content.registry';
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
import { IsoIncidentService } from '../src/modules/iso-forms/iso-incident.service';
import { IsoMailContent } from '../src/modules/iso-forms/iso-mail';
import { IsoPeriodService } from '../src/modules/iso-forms/iso-period.service';
import { IsoPeriodStore } from '../src/modules/iso-forms/iso-period.store';
import { IsoReminderService } from '../src/modules/iso-forms/iso-reminder.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Mail nhắc phiếu ISO (Story 8.7) trên Postgres thật: một việc tối đa một mail mỗi ngày kể cả khi
 * worker chạy lại, người nhận là người phụ trách (dự phòng khi trống quá N ngày), SA/Admin tự gửi
 * chốt thì không nhận thư của chính mình, và lượt nhắc chung của `approvals` không gửi mẫu "mở két".
 */

const TEST_TIMEOUT = 180_000;
const noopSweep = { register: () => undefined } as unknown as SweepService;

class FixedClock extends IsoClock {
  /** 05:00 UTC = 12:00 giờ Việt Nam — sau giờ nhắc mặc định 8h. */
  at = '2026-11-10T05:00:00Z';
  override now(): Date {
    return new Date(this.at);
  }
}

describe('Phiếu ISO · mail nhắc (Story 8.7)', () => {
  let scratch: ScratchDb;
  let clock: FixedClock;
  let catalog: IsoCatalogService;
  let backup: IsoBackupService;
  let periods: IsoPeriodService;
  let reminders: IsoReminderService;
  let registry: MailContentRegistry;
  const people: Record<'sa' | 'owner' | 'backup', IsoActor> = {} as never;

  async function outboxCount(topic: string): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: string }>(`SELECT count(*) AS n FROM outbox WHERE topic = $1`, [topic]);
    return Number(rows[0].n);
  }

  async function build(topic: string, payload: Record<string, unknown>): Promise<MailContent | null> {
    return registry.find(topic)!(payload);
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_iso_remind');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    await scratch.pool.query(`UPDATE system_config SET value = '"2026-11"' WHERE key = 'iso.first_month'`);
    const db = scratch.db;
    const audit = new AuditWriterService(db);
    const config = new SystemConfigService(db);
    const users = new UsersApiService(new UsersService(db));
    const kinds = new ApprovalKindRegistry();
    clock = new FixedClock(config);
    const filesApi = new FilesApiService(new FilesService(db, audit, new OwnerExistsRegistry(), users, config, noopSweep));
    const access = new IsoAccessService(db, audit, users);
    const store = new IsoPeriodStore(db, config);
    const approvals = new ApprovalsApiService(new ApprovalsService(db, audit, kinds));
    const outbox = new OutboxService(db, config, noopSweep);
    catalog = new IsoCatalogService(db, audit);
    backup = new IsoBackupService(db, audit, access, store, clock, config);
    const antivirus = new IsoAntivirusService(db, audit, access, store, catalog, clock, config);
    const incidents = new IsoIncidentService(db, audit, access, store, filesApi, users, clock);
    periods = new IsoPeriodService(db, audit, access, store, backup, antivirus, incidents, approvals, kinds, outbox, filesApi, users, clock);
    periods.onModuleInit();
    registry = new MailContentRegistry();
    const mail = new IsoMailContent(registry, approvals, users, access, store, backup, antivirus, incidents, clock);
    mail.onModuleInit();
    reminders = new IsoReminderService(db, noopSweep, config, clock, store, approvals, filesApi, outbox, mail);

    for (const [key, role] of [['sa', 'sa'], ['owner', 'member'], ['backup', 'member']] as const) {
      const email = `e2e-iso-remind-${key}@qa.test`;
      const { rows } = await scratch.pool.query<{ id: string }>(
        `INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, 'x') RETURNING id`,
        [email, `E2E ${key}`, role],
      );
      people[key] = { id: rows[0].id, email, role };
    }
    for (const form of ['0203', '0208'] as const) {
      await access.setOwners(people.sa, form, { primaryUserId: people.owner.id, backupUserId: people.backup.id });
    }
    await catalog.createJob(people.owner, {
      no: 1,
      name: 'E2E-REMIND',
      trackedFrom: '2026-11-01',
      lines: [{ label: null, pointsNas: '7', storageNas: 'NAS', pointsCloud: null, storageCloud: null }],
    });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('trước giờ nhắc thì không làm gì', async () => {
    clock.at = '2026-11-10T00:30:00Z'; // 07:30 giờ VN
    expect(await reminders.run()).toBe(0);
    clock.at = '2026-11-10T05:00:00Z';
  });

  it('ô hôm qua còn trống → một mail cho người phụ trách; chạy lại trong ngày không gửi trùng', async () => {
    for (let d = 1; d <= 8; d += 1) await backup.fillDay(people.owner, `2026-11-${String(d).padStart(2, '0')}`);
    const before = await outboxCount('iso.reminder');
    await reminders.run();
    const after = await outboxCount('iso.reminder');
    expect(after).toBeGreaterThan(before);
    await reminders.run();
    expect(await outboxCount('iso.reminder')).toBe(after);
    // Gỡ dấu "đã quét xong" (như worker chết giữa chừng) — khoá từng việc vẫn chặn gửi trùng.
    await scratch.pool.query(`DELETE FROM iso_reminder_sent WHERE reminder_key = 'sweep:done'`);
    await reminders.run();
    expect(await outboxCount('iso.reminder')).toBe(after);

    const { rows } = await scratch.pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox WHERE topic = 'iso.reminder' AND payload->>'kind' = 'tick' AND payload->>'form' = '0203'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ kind: 'tick', form: '0203', day: '2026-11-09', withBackup: false });
    const mail = await build('iso.reminder', rows[0].payload);
    expect(mail?.to).toEqual([people.owner.email]);
    expect(mail?.rows.map((r) => r.value)).toEqual(['E2E-REMIND']);
  });

  it('trống quá N ngày thì gửi thêm người dự phòng; đánh đủ rồi thì thư không còn gì để gửi', async () => {
    clock.at = '2026-11-12T05:00:00Z';
    await reminders.run();
    const { rows } = await scratch.pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox WHERE topic = 'iso.reminder' AND payload->>'kind' = 'tick' AND payload->>'form' = '0203' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0].payload.withBackup).toBe(true);
    expect((await build('iso.reminder', rows[0].payload))?.to.sort()).toEqual([people.backup.email, people.owner.email].sort());
    for (let d = 9; d <= 11; d += 1) await backup.fillDay(people.owner, `2026-11-${String(d).padStart(2, '0')}`);
    expect(await build('iso.reminder', rows[0].payload)).toBeNull();
  });

  it('ngày cuối kỳ nhắc gửi chốt; SA tự gửi chốt thì thư "chờ duyệt" không tới chính SA', async () => {
    clock.at = '2026-11-30T05:00:00Z';
    for (let d = 12; d <= 30; d += 1) await backup.fillDay(people.owner, `2026-11-${d}`);
    await reminders.run();
    const submit = await scratch.pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox WHERE topic = 'iso.reminder' AND payload->>'kind' = 'submit' AND payload->>'form' = '0203'`,
    );
    expect(submit.rows).toHaveLength(1);
    expect((await build('iso.reminder', submit.rows[0].payload))?.ctaPath).toBe('/iso/periods/0203/2026-11/review');

    await periods.submit(people.sa, '0203', 2026, 11);
    const event = await scratch.pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox WHERE topic = 'iso.period.event' ORDER BY created_at DESC LIMIT 1`,
    );
    const requested = await build('iso.period.event', event.rows[0].payload);
    expect(requested).toBeNull();
    // Kỳ đã gửi thì thư nhắc gửi chốt cũ không còn gì để gửi.
    expect(await build('iso.reminder', submit.rows[0].payload)).toBeNull();
  });

  it('lượt nhắc chung của approvals không gửi mẫu "mở két" cho yêu cầu chốt kỳ', async () => {
    const builder = registry.find('approval:iso_period_close');
    expect(builder).toBeDefined();
    expect(await builder!({ approvalId: 'x', reminder: true })).toBeNull();
  });

  it('SA tự duyệt thì không có thư báo kết quả cho chính SA', async () => {
    const before = await outboxCount('iso.period.event');
    await periods.approve(people.sa, '0203', 2026, 11, null);
    expect(await outboxCount('iso.period.event')).toBe(before);
  });
});
