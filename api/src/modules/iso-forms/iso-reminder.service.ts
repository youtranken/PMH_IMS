import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { redactMessage } from '../../common/log-redact';
import { addDays, isoDateInTz } from '../../common/today';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { ApprovalsApiService } from '../approvals/approvals.api';
import { SystemConfigService } from '../config-sys/system-config.service';
import { FilesApiService } from '../files/files.api';
import { OutboxService } from '../outbox/outbox.service';
import { SweepService } from '../queue/sweep.service';
import { IsoClock } from './iso-clock';
import { isoIncidentTable, isoPeriodTable, isoReminderSentTable } from './iso-forms.schema';
import { toSigned } from './iso-incident.service';
import { ISO_REMINDER_TOPIC, IsoMailContent, type IsoReminder } from './iso-mail';
import { PERIOD_CLOSE_KIND, PERIOD_REOPEN_KIND } from './iso-period.service';
import { IsoPeriodStore } from './iso-period.store';
import { backupRecipientsDue, nthDayDue, submitReminderDue } from './iso-remind-rules';
import { ISO_FORM_TYPES, lastDayOf, monthKey, monthOf, periodAccess } from './iso-rules';

/** Đánh dấu "hôm nay đã quét xong" — lượt sau trong ngày thoát sớm, không dựng lại mọi tóm tắt. */
const DONE_KEY = 'sweep:done';
/** Khoá nhắc chỉ dùng để chặn trùng trong ngày: giữ 90 ngày rồi dọn, bảng không phình mãi. */
const KEEP_DAYS = 90;

/**
 * Mail nhắc phiếu ISO. Lượt quét chạy mỗi phút cùng các sweep khác nhưng chỉ làm việc
 * một lần mỗi ngày, từ giờ `iso.remind_hour` (giờ Việt Nam).
 *
 * Mỗi việc CHIẾM một hàng `iso_reminder_sent (khoá, ngày)` rồi mới đẩy outbox, cùng transaction
 * (AD-5): worker chạy lại hay hai worker chạy song song thì lượt thứ hai không chiếm được hàng và
 * không gửi trùng.
 */
@Injectable()
export class IsoReminderService implements OnModuleInit {
  private readonly logger = new Logger(IsoReminderService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly sweep: SweepService,
    private readonly config: SystemConfigService,
    private readonly clock: IsoClock,
    private readonly periods: IsoPeriodStore,
    private readonly approvals: ApprovalsApiService,
    private readonly files: FilesApiService,
    private readonly outbox: OutboxService,
    private readonly mail: IsoMailContent,
  ) {}

  onModuleInit(): void {
    this.sweep.register({ name: 'iso-remind', run: () => this.run().then(() => undefined) });
  }

  async run(): Promise<number> {
    const timeZone = await this.clock.timeZone();
    const now = this.clock.now();
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour < (await this.config.getNumber('isoRemindHour'))) return 0;
    const today = isoDateInTz(timeZone, now);
    if (await this.sentToday(DONE_KEY, today)) return 0;

    let sent = 0;
    const steps: [string, () => Promise<number>][] = [
      ['tick', () => this.tickReminders(today)],
      ['submit', () => this.submitReminders(today)],
      ['approval', () => this.approvalReminders(today, timeZone)],
      ['signed', () => this.signedReminders(today, timeZone)],
      ['in_progress', () => this.inProgressReminders(today, timeZone)],
    ];
    let failed = false;
    for (const [name, step] of steps) {
      // Một loại nhắc hỏng không được làm câm các loại xếp sau.
      try {
        sent += await step();
      } catch (error) {
        failed = true;
        this.logger.warn(`nhắc phiếu ISO (${name}) lỗi: ${redactMessage(error)}`);
      }
    }
    // Có bước hỏng thì không đánh dấu xong: lượt sau thử lại, bước đã gửi được chặn trùng bằng khoá.
    if (!failed) {
      await this.db.insert(isoReminderSentTable).values({ reminderKey: DONE_KEY, sentOn: today }).onConflictDoNothing();
      await this.db.delete(isoReminderSentTable).where(sql`${isoReminderSentTable.sentOn} < ${addDays(today, -KEEP_DAYS)}`);
    }
    return sent;
  }

  /** Ô của hôm qua còn trống → người phụ trách chính; trống quá N ngày → thêm người dự phòng. */
  private async tickReminders(today: string): Promise<number> {
    const firstMonth = await this.periods.firstMonth();
    const yesterday = addDays(today, -1);
    const backupAfter = await this.config.getNumber('isoRemindBackupAfterDays');
    let sent = 0;
    for (const form of ISO_FORM_TYPES) {
      const months = [monthOf(yesterday), monthOf(today)].filter(
        (m, i, list) => list.findIndex((x) => x.year === m.year && x.month === m.month) === i,
      );
      const missing: { day: string }[] = [];
      for (const { year, month } of months) {
        if (periodAccess(year, month, today, firstMonth) !== 'ok') continue;
        const period = await this.periods.find(form, year, month);
        if (period && period.state !== 'open') continue;
        missing.push(...(await this.mail.missingOf(form, year, month, today)));
      }
      const days = [...new Set(missing.map((m) => m.day))];
      const overdue = backupRecipientsDue(days, today, backupAfter);
      if (!days.includes(yesterday) && !overdue) continue;
      if (await this.claim(`tick:${form}`, today, { kind: 'tick', form, day: yesterday, withBackup: overdue })) sent += 1;
    }
    return sent;
  }

  /**
   * Ngày cuối kỳ: nhắc vào Xem lại và gửi chốt; chưa gửi thì cứ N ngày nhắc lại. Chỉ xét tháng này
   * và tháng trước: kỳ bỏ dở lâu hơn đã nằm sẵn trên màn Kỳ phiếu, nhắc mãi chỉ thành thư rác.
   */
  private async submitReminders(today: string): Promise<number> {
    const firstMonth = await this.periods.firstMonth();
    const repeat = await this.config.getNumber('isoRemindSubmitRepeatDays');
    const current = monthOf(today);
    const previous = monthOf(addDays(`${monthKey(current.year, current.month)}-01`, -1));
    let sent = 0;
    for (const { year, month } of [previous, current]) {
      if (periodAccess(year, month, today, firstMonth) !== 'ok') continue;
      const ym = monthKey(year, month);
      for (const form of ISO_FORM_TYPES) {
        const state = (await this.periods.find(form, year, month))?.state ?? 'open';
        if (state !== 'open' || !submitReminderDue(lastDayOf(year, month), today, repeat)) continue;
        if (await this.claim(`submit:${form}:${ym}`, today, { kind: 'submit', form, month: ym })) sent += 1;
      }
    }
    return sent;
  }

  private async approvalReminders(today: string, timeZone: string): Promise<number> {
    const days = await this.config.getNumber('isoRemindApprovalDays');
    const pending = [...(await this.approvals.pending(PERIOD_CLOSE_KIND)), ...(await this.approvals.pending(PERIOD_REOPEN_KIND))];
    let sent = 0;
    for (const request of pending) {
      if (!nthDayDue(request.createdAt, today, days, timeZone)) continue;
      if (await this.claim(`approval:${request.id}`, today, { kind: 'approval', approvalId: request.id })) sent += 1;
    }
    return sent;
  }

  private async signedReminders(today: string, timeZone: string): Promise<number> {
    const days = await this.config.getNumber('isoRemindSignedDays');
    const locked = await this.db.select().from(isoPeriodTable).where(eq(isoPeriodTable.state, 'locked'));
    const files = await this.files.listForOwners('iso_period', locked.map((p) => p.id));
    let sent = 0;
    for (const period of locked) {
      if (!period.lockedAt || !nthDayDue(period.lockedAt, today, days, timeZone)) continue;
      if (files.some((f) => f.ownerId === period.id && toSigned(f, period.lockedAt).current)) continue;
      if (await this.claim(`signed:${period.id}`, today, { kind: 'signed', periodId: period.id })) sent += 1;
    }
    return sent;
  }

  private async inProgressReminders(today: string, timeZone: string): Promise<number> {
    const days = await this.config.getNumber('isoRemindInProgressDays');
    const open = await this.db
      .select({ id: isoIncidentTable.id, createdAt: isoIncidentTable.createdAt })
      .from(isoIncidentTable)
      .where(eq(isoIncidentTable.status, 'in_progress'));
    let sent = 0;
    for (const incident of open) {
      if (!nthDayDue(incident.createdAt, today, days, timeZone)) continue;
      if (await this.claim(`in_progress:${incident.id}`, today, { kind: 'in_progress', incidentId: incident.id })) sent += 1;
    }
    return sent;
  }

  /** Chiếm hàng (khoá, ngày) rồi đẩy outbox trong CÙNG transaction; đã có người chiếm thì thôi. */
  private async claim(key: string, today: string, payload: IsoReminder): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const claimed = await tx
        .insert(isoReminderSentTable)
        .values({ reminderKey: key, sentOn: today })
        .onConflictDoNothing()
        .returning({ key: isoReminderSentTable.reminderKey });
      if (claimed.length === 0) return false;
      await this.outbox.enqueueWithin(tx, ISO_REMINDER_TOPIC, { ...payload });
      return true;
    });
  }

  private async sentToday(key: string, today: string): Promise<boolean> {
    const [row] = await this.db
      .select({ key: isoReminderSentTable.reminderKey })
      .from(isoReminderSentTable)
      .where(and(eq(isoReminderSentTable.reminderKey, key), eq(isoReminderSentTable.sentOn, today)));
    return Boolean(row);
  }
}
