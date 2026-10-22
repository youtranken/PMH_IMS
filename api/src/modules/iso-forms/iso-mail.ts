import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { MailContentRegistry, type MailContent } from '../../common/mail-content.registry';
import { isoDateInTz, viDate } from '../../common/today';
import { UI_PATHS } from '../../common/ui-paths';
import { ApprovalsApiService, type ApprovalRecord } from '../approvals/approvals.api';
import { UsersApiService } from '../users/users.api';
import { IsoAccessService } from './iso-access.service';
import { IsoAntivirusService } from './iso-antivirus.service';
import { IsoBackupService } from './iso-backup.service';
import { IsoClock } from './iso-clock';
import { IsoIncidentService } from './iso-incident.service';
import { ISO_PERIOD_EVENT_TOPIC, PERIOD_CLOSE_KIND, PERIOD_REOPEN_KIND, type IsoPeriodEvent } from './iso-period.service';
import { IsoPeriodStore, periodLabel } from './iso-period.store';
import { monthKey, monthOf, type IsoFormType } from './iso-rules';

export const ISO_REMINDER_TOPIC = 'iso.reminder';

export type IsoReminder =
  | { kind: 'tick'; form: IsoFormType; day: string; withBackup: boolean }
  | { kind: 'submit'; form: IsoFormType; month: string }
  | { kind: 'approval'; approvalId: string }
  | { kind: 'signed'; periodId: string }
  | { kind: 'in_progress'; incidentId: string };

const FORM_NAME: Record<IsoFormType, string> = { '0203': '0203 · Theo dõi backup', '0208': '0208 · Theo dõi antivirus' };

/**
 * Thư của phiếu ISO. `mail` là tầng nền không import được `iso-forms`, nên module này
 * dạy `MailContentRegistry` cách dựng thư; outbox chỉ mang id + loại việc (NFR-04), nội dung và
 * người nhận đọc lại lúc gửi — việc đã xong trước khi worker kịp gửi thì không gửi nữa.
 */
@Injectable()
export class IsoMailContent implements OnModuleInit {
  constructor(
    private readonly contents: MailContentRegistry,
    private readonly approvals: ApprovalsApiService,
    private readonly users: UsersApiService,
    private readonly access: IsoAccessService,
    private readonly periods: IsoPeriodStore,
    private readonly backup: IsoBackupService,
    private readonly antivirus: IsoAntivirusService,
    private readonly incidents: IsoIncidentService,
    private readonly clock: IsoClock,
  ) {}

  onModuleInit(): void {
    this.contents.register(ISO_PERIOD_EVENT_TOPIC, (payload) => this.eventMail(payload));
    this.contents.register(ISO_REMINDER_TOPIC, (payload) => this.reminderMail(payload as unknown as IsoReminder));
    /*
     * Lượt nhắc chung của `approvals` (`approval.reminder`, tính theo giờ) cũng quét yêu cầu của
     * phiếu ISO. Phiếu ISO nhắc SA/Admin theo NGÀY ở lượt nhắc riêng (`iso.remind_approval_days`),
     * nên thư chung cho hai loại này không gửi.
     */
    for (const kind of [PERIOD_CLOSE_KIND, PERIOD_REOPEN_KIND]) {
      this.contents.register(`approval:${kind}`, () => Promise.resolve(null));
    }
  }

  /* ------------------------------------------------------- sự kiện kỳ --- */

  private async eventMail(payload: Record<string, unknown>): Promise<MailContent | null> {
    const approvalId = typeof payload.approvalId === 'string' ? payload.approvalId : null;
    const event = payload.event as IsoPeriodEvent | undefined;
    if (!approvalId || !event) return null;
    const request = await this.findApproval(approvalId);
    if (!request) return null;
    const period = await this.periods.findById(request.subjectId);
    if (!period) return null;
    const label = periodLabel(period.formType, period.year, period.month);
    const month = monthKey(period.year, period.month);
    const who = await this.nameOf(request.requester);
    const form = period.formType as IsoFormType;

    if (event === 'close_requested' || event === 'reopen_requested') {
      const to = await this.managersExcept(request.requester);
      if (to.length === 0) return null;
      const reopen = event === 'reopen_requested';
      return {
        to,
        subject: reopen ? `[IMS] Xin mở lại kỳ phiếu ${label}` : `[IMS] Duyệt chốt kỳ phiếu ${label}`,
        title: reopen ? 'Có yêu cầu mở lại kỳ phiếu ISO' : 'Có kỳ phiếu ISO chờ duyệt chốt',
        intro: reopen
          ? `${who} xin mở lại kỳ ${label} đã chốt để sửa.`
          : `${who} vừa gửi chốt kỳ ${label}. Xem bản in và danh sách kiểm rồi duyệt hoặc trả lại.`,
        rows: [
          { label: 'Phiếu', value: FORM_NAME[form] },
          { label: 'Kỳ', value: `${String(period.month).padStart(2, '0')}/${period.year}` },
          { label: 'Người gửi', value: `${who} (${request.requester})` },
          ...(reopen ? [{ label: 'Lý do', value: request.reason }] : []),
        ],
        ctaLabel: reopen ? 'Mở Kỳ phiếu để duyệt' : 'Xem & duyệt chốt',
        ctaPath: reopen ? UI_PATHS.isoPeriod(form, month) : UI_PATHS.isoReview(form, month),
      };
    }

    const decidedBy = request.decidedBy ? await this.nameOf(request.decidedBy) : 'Super Admin / Quản trị';
    const noteRows = request.decisionNote ? [{ label: 'Ghi chú', value: request.decisionNote }] : [];
    const common = { to: [request.requester], rows: [{ label: 'Kỳ', value: label }, { label: 'Người duyệt', value: decidedBy }, ...noteRows] };
    switch (event) {
      case 'close_approved':
        return {
          ...common,
          subject: `[IMS] Đã duyệt chốt kỳ ${label}`,
          title: 'Kỳ phiếu đã được duyệt chốt',
          intro: 'Kỳ đã khóa. In bản phiếu, ký, scan rồi tải bản ký lên ở màn Kỳ phiếu.',
          ctaLabel: 'Mở Kỳ phiếu',
          ctaPath: UI_PATHS.isoPeriod(form, month),
        };
      case 'close_returned':
        return {
          ...common,
          subject: `[IMS] Trả lại kỳ ${label}`,
          title: 'Kỳ phiếu bị trả lại',
          intro: 'Kỳ đã về Đang ghi. Sửa theo ghi chú rồi Xem lại & gửi chốt lần nữa.',
          ctaLabel: 'Mở phiếu để sửa',
          ctaPath: form === '0203' ? UI_PATHS.isoBackupAt(month) : UI_PATHS.isoAntivirusAt(month),
        };
      case 'reopen_approved':
        return {
          ...common,
          subject: `[IMS] Đã mở lại kỳ ${label}`,
          title: 'Kỳ phiếu đã được mở lại',
          intro: 'Kỳ về Đang ghi, các 0206 của kỳ mở theo. Sửa xong thì xem lại, gửi chốt, ký và tải bản ký mới.',
          ctaLabel: 'Mở phiếu',
          ctaPath: form === '0203' ? UI_PATHS.isoBackupAt(month) : UI_PATHS.isoAntivirusAt(month),
        };
      case 'reopen_denied':
        return {
          ...common,
          subject: `[IMS] Từ chối mở lại kỳ ${label}`,
          title: 'Yêu cầu mở lại kỳ phiếu bị từ chối',
          intro: 'Kỳ giữ nguyên trạng thái đã chốt.',
          ctaLabel: 'Mở Kỳ phiếu',
          ctaPath: UI_PATHS.isoPeriod(form, month),
        };
      default:
        return null;
    }
  }

  /* ------------------------------------------------------------- nhắc --- */

  private async reminderMail(reminder: IsoReminder): Promise<MailContent | null> {
    switch (reminder.kind) {
      case 'tick':
        return this.tickMail(reminder.form, reminder.day, reminder.withBackup);
      case 'submit':
        return this.submitMail(reminder.form, reminder.month);
      case 'approval':
        return this.approvalReminderMail(reminder.approvalId);
      case 'signed':
        return this.signedMail(reminder.periodId);
      case 'in_progress':
        return this.inProgressMail(reminder.incidentId);
      default:
        return null;
    }
  }

  private async tickMail(form: IsoFormType, day: string, withBackup: boolean): Promise<MailContent | null> {
    const today = await this.clock.today();
    const { year, month } = monthOf(day);
    const period = await this.periods.find(form, year, month);
    if (period && period.state !== 'open') return null;
    const missing = await this.missingOf(form, year, month, today);
    if (missing.length === 0) return null;
    const to = await this.ownersOf(form, withBackup);
    if (to.length === 0) return null;
    const ym = monthKey(year, month);
    return {
      to,
      subject: `[IMS] Phiếu ${form}: còn ${missing.length} mục chưa đánh`,
      title: `Phiếu ${FORM_NAME[form]} còn ô chưa đánh`,
      intro: withBackup
        ? 'Có ngày đã trống quá số ngày nhắc — mail này gửi cả người phụ trách dự phòng.'
        : `Ngày ${viDate(day)} còn mục chưa có kết quả.`,
      rows: missing.slice(0, 15).map((m) => ({ label: viDate(m.day), value: m.what })),
      ctaLabel: 'Mở phiếu để đánh',
      ctaPath: form === '0203' ? UI_PATHS.isoBackupAt(ym) : UI_PATHS.isoAntivirusAt(ym),
      footnote: missing.length > 15 ? `Còn ${missing.length - 15} mục khác trên lưới.` : undefined,
    };
  }

  private async submitMail(form: IsoFormType, month: string): Promise<MailContent | null> {
    const { year, month: mon } = monthOf(`${month}-01`);
    const period = await this.periods.find(form, year, mon);
    if (period && period.state !== 'open') return null;
    const to = await this.ownersOf(form, false);
    if (to.length === 0) return null;
    const label = periodLabel(form, year, mon);
    return {
      to,
      subject: `[IMS] Gửi chốt kỳ ${label}`,
      title: 'Tới lúc gửi chốt kỳ phiếu',
      intro: `Kỳ ${label} đã tới ngày cuối tháng. Vào Xem lại để kiểm bản in rồi gửi chốt cho Super Admin / Quản trị duyệt.`,
      rows: [{ label: 'Phiếu', value: FORM_NAME[form] }],
      ctaLabel: 'Xem lại & gửi chốt',
      ctaPath: UI_PATHS.isoReview(form, month),
    };
  }

  private async approvalReminderMail(approvalId: string): Promise<MailContent | null> {
    const request = await this.findApproval(approvalId);
    if (!request || request.state !== 'pending') return null;
    const period = await this.periods.findById(request.subjectId);
    if (!period) return null;
    const to = await this.managersExcept(request.requester);
    if (to.length === 0) return null;
    const label = periodLabel(period.formType, period.year, period.month);
    const reopen = request.kind === PERIOD_REOPEN_KIND;
    const month = monthKey(period.year, period.month);
    return {
      to,
      subject: `[IMS] Nhắc: ${reopen ? 'xin mở lại' : 'duyệt chốt'} kỳ ${label} vẫn chờ`,
      title: reopen ? 'Yêu cầu mở lại kỳ phiếu vẫn chờ duyệt' : 'Kỳ phiếu vẫn chờ duyệt chốt',
      intro: `Gửi lúc ${viDate(isoDateInTz(await this.clock.timeZone(), request.createdAt))}, chưa ai xử lý.`,
      rows: [
        { label: 'Kỳ', value: label },
        { label: 'Người gửi', value: await this.nameOf(request.requester) },
      ],
      ctaLabel: reopen ? 'Mở Kỳ phiếu' : 'Xem & duyệt chốt',
      ctaPath: reopen ? UI_PATHS.isoPeriod(period.formType, month) : UI_PATHS.isoReview(period.formType, month),
    };
  }

  private async signedMail(periodId: string): Promise<MailContent | null> {
    const period = await this.periods.findById(periodId);
    if (!period || period.state !== 'locked') return null;
    const label = periodLabel(period.formType, period.year, period.month);
    const to = await this.ownersOf(period.formType as IsoFormType, false);
    if (to.length === 0) return null;
    return {
      to,
      subject: `[IMS] Kỳ ${label} chưa có bản ký`,
      title: 'Kỳ phiếu đã chốt nhưng chưa có bản ký',
      intro: 'In bản phiếu, ký tay, scan rồi tải lên ở màn Kỳ phiếu. Kỳ chỉ Hoàn tất khi có bản ký của kỳ và của mọi 0206 thuộc kỳ.',
      rows: [{ label: 'Duyệt chốt lúc', value: period.lockedAt ? viDate(isoDateInTz(await this.clock.timeZone(), period.lockedAt)) : '—' }],
      ctaLabel: 'Tải bản ký lên',
      ctaPath: UI_PATHS.isoPeriod(period.formType, monthKey(period.year, period.month)),
    };
  }

  private async inProgressMail(incidentId: string): Promise<MailContent | null> {
    const incident = await this.incidents.get(incidentId).catch((error: unknown) => {
      if (error instanceof NotFoundException) return null;
      throw error;
    });
    if (!incident || incident.status !== 'in_progress') return null;
    return {
      to: [incident.createdBy],
      subject: `[IMS] Phiếu ${incident.code} vẫn In Progress`,
      title: 'Phiếu sự cố chưa xử lý xong',
      intro: 'Sửa xong thì đổi Current Status sang Resolved, phiếu tự khóa rồi in và tải bản ký.',
      rows: [
        { label: 'Phiếu', value: incident.code },
        { label: 'Mô tả', value: incident.description.slice(0, 160) },
      ],
      ctaLabel: 'Mở phiếu',
      ctaPath: UI_PATHS.isoIncident(incident.id),
    };
  }

  /** Mục còn thiếu của kỳ tới hết hôm qua — chính là thứ thư nhắc liệt kê. */
  async missingOf(form: IsoFormType, year: number, month: number, today: string): Promise<{ day: string; what: string }[]> {
    if (form === '0203') {
      const { rows, summary } = await this.backup.summary(year, month, today);
      const names = new Map(rows.map((r) => [r.lineId, r.label ? `${r.name} › ${r.label}` : r.name]));
      return summary.missed.map((m) => ({ day: m.day, what: names.get(m.lineId) ?? '' }));
    }
    const { summary } = await this.antivirus.summary(year, month, today);
    return summary.missedDays.map((day) => ({ day, what: 'Chưa có kết quả' }));
  }

  /** Người phụ trách (chính, kèm dự phòng nếu cần); chưa gán thì SA/Admin — chỉ họ thao tác được. */
  private async ownersOf(form: IsoFormType, withBackup: boolean): Promise<string[]> {
    const owners = await this.access.ownersOf(form);
    const emails = [owners.primary?.email, withBackup ? owners.backup?.email : undefined].filter((e): e is string => Boolean(e));
    if (emails.length > 0) return emails;
    return (await this.users.recipientsByRole(['sa', 'admin'])).map((r) => r.email);
  }

  /** SA/Admin trừ người gửi: tự gửi tự duyệt thì không mail cho chính mình (Q-28). */
  private async managersExcept(requester: string): Promise<string[]> {
    const me = requester.toLowerCase();
    return (await this.users.recipientsByRole(['sa', 'admin'])).map((r) => r.email).filter((e) => e.toLowerCase() !== me);
  }

  private async nameOf(email: string): Promise<string> {
    const names = await this.users.namesByEmails([email]);
    return names.get(email.toLowerCase()) ?? names.get(email) ?? email;
  }

  private findApproval(id: string): Promise<ApprovalRecord | null> {
    return this.approvals.findOne(id).catch((error: unknown) => {
      if (error instanceof NotFoundException) return null;
      throw error;
    });
  }
}

