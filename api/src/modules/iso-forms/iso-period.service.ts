import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ApprovalKindRegistry, type ApprovalSubject } from '../../common/approvals/approvals-registry';
import type { Tx } from '../../common/tx';
import { UI_PATHS } from '../../common/ui-paths';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { ApprovalsApiService, type ApprovalRecord } from '../approvals/approvals.api';
import { AuditWriterService } from '../audit/audit-writer.service';
import { FilesApiService } from '../files/files.api';
import { OutboxService } from '../outbox/outbox.service';
import { UsersApiService } from '../users/users.api';
import { assertSeesForm, IsoAccessService, isManager, seesForm, type IsoActor } from './iso-access.service';
import { IsoAntivirusService } from './iso-antivirus.service';
import { IsoBackupService } from './iso-backup.service';
import { IsoClock } from './iso-clock';
import { isoPeriodTable, type PeriodSnapshot } from './iso-forms.schema';
import { IsoIncidentService, toSigned, type IncidentRecord, type SignedFile } from './iso-incident.service';
import { IsoPeriodStore, lockJobListWithin, PERIOD_STATE_LABEL, periodLabel, type PeriodRow } from './iso-period.store';
import {
  ISO_FORM_TYPES,
  closeChecklist,
  displayState,
  monthKey,
  periodAccess,
  type ChecklistItem,
  type IsoFormType,
  type PeriodDisplayState,
  type PeriodState,
} from './iso-rules';
import { eq } from 'drizzle-orm';

export const PERIOD_CLOSE_KIND = 'iso_period_close';
export const PERIOD_REOPEN_KIND = 'iso_period_reopen';

/** Một lượt gửi chốt: duyệt → khoá, trả lại → kỳ về Đang ghi. Lượt mới cho lần gửi sau (AD-6). */
export const PERIOD_CLOSE_FLOW = {
  kind: PERIOD_CLOSE_KIND,
  initial: 'pending',
  transitions: { pending: ['approved', 'returned'], approved: [], returned: [] },
  labels: { 'pending->approved': 'Duyệt chốt kỳ', 'pending->returned': 'Trả lại kèm lý do' },
};

export const PERIOD_REOPEN_FLOW = {
  kind: PERIOD_REOPEN_KIND,
  initial: 'pending',
  transitions: { pending: ['approved', 'denied'], approved: [], denied: [] },
  labels: { 'pending->approved': 'Duyệt mở lại kỳ', 'pending->denied': 'Từ chối mở lại' },
};

/** Sự kiện của luồng kỳ đi qua outbox (chỉ id tham chiếu — NFR-04); thư dựng ở `iso-mail.ts`. */
export const ISO_PERIOD_EVENT_TOPIC = 'iso.period.event';
export type IsoPeriodEvent =
  | 'close_requested'
  | 'close_approved'
  | 'close_returned'
  | 'reopen_requested'
  | 'reopen_approved'
  | 'reopen_denied';

export interface PeriodCell {
  formType: IsoFormType;
  state: PeriodState;
  display: PeriodDisplayState;
  periodId: string | null;
}

export interface MonthOverview {
  month: number;
  /** `future` / `before_start`: không mở được (Q-28). */
  access: 'ok' | 'future' | 'before_start';
  forms: PeriodCell[];
  incidents: number;
  incidentsSigned: number;
}

export interface YearOverview {
  year: number;
  months: MonthOverview[];
  kpis: Record<string, number>;
}

export interface PendingApproval {
  id: string;
  kind: string;
  requester: string;
  requesterName: string;
  reason: string;
  createdAt: Date;
}

export interface PeriodDetail {
  formType: IsoFormType;
  year: number;
  month: number;
  today: string;
  periodId: string | null;
  state: PeriodState;
  display: PeriodDisplayState;
  canWrite: boolean;
  canDecide: boolean;
  submittedBy: string | null;
  submittedAt: Date | null;
  lockedBy: string | null;
  lockedAt: Date | null;
  checklist: { canSubmit: boolean; items: ChecklistItem[] } | null;
  pendingClose: PendingApproval | null;
  pendingReopen: PendingApproval | null;
  lastReturn: { note: string | null; by: string | null; at: Date | null } | null;
  signed: SignedFile[];
  signedCurrent: boolean;
  incidents: { id: string; code: string; status: string; locked: boolean; signedCurrent: boolean }[];
  counts: { rows: number };
}

/**
 * Luồng kỳ phiếu: Đang ghi → Chờ duyệt → Đã chốt · chờ bản ký → Hoàn tất.
 * Duyệt chốt và duyệt mở lại đi qua `approvals` (Q-05); trạng thái kỳ, nhật ký, trạng thái yêu
 * cầu và thư báo ghi trong CÙNG một transaction (AD-5).
 */
@Injectable()
export class IsoPeriodService implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly access: IsoAccessService,
    private readonly store: IsoPeriodStore,
    private readonly backup: IsoBackupService,
    private readonly antivirus: IsoAntivirusService,
    private readonly incidents: IsoIncidentService,
    private readonly approvals: ApprovalsApiService,
    private readonly kinds: ApprovalKindRegistry,
    private readonly outbox: OutboxService,
    private readonly files: FilesApiService,
    private readonly users: UsersApiService,
    private readonly clock: IsoClock,
  ) {}

  onModuleInit(): void {
    this.kinds.register(PERIOD_CLOSE_FLOW);
    this.kinds.register(PERIOD_REOPEN_FLOW);
    this.kinds.registerDescriber(PERIOD_CLOSE_KIND, (_t, id) => this.describe(id));
    this.kinds.registerDescriber(PERIOD_REOPEN_KIND, (_t, id) => this.describe(id));
  }

  private async describe(periodId: string): Promise<ApprovalSubject | null> {
    const row = await this.store.findById(periodId);
    if (!row) return null;
    const path = UI_PATHS.isoPeriod(row.formType, monthKey(row.year, row.month));
    return { code: periodLabel(row.formType, row.year, row.month), label: `Phiếu ISO ${periodLabel(row.formType, row.year, row.month)}`, path, detailPath: path };
  }

  /* --------------------------------------------------------------- đọc --- */

  async overview(actor: IsoActor, year: number): Promise<YearOverview> {
    // Q-31: chỉ cột của phiếu nhóm cho thấy, và KPI cũng chỉ đếm trên các cột đó.
    const forms = ISO_FORM_TYPES.filter((formType) => seesForm(actor, formType));
    const seesIncidents = seesForm(actor, '0206');
    const today = await this.clock.today();
    const firstMonth = await this.store.firstMonth();
    const rows = await this.store.ofYear(year);
    const incidents = await this.incidents.ofYear(year);
    const periodFiles = await this.files.listForOwners('iso_period', rows.map((r) => r.id));
    const months: MonthOverview[] = [];
    for (let month = 12; month >= 1; month -= 1) {
      const ofMonth = seesIncidents ? incidents.filter((i) => i.month === month) : [];
      months.push({
        month,
        access: periodAccess(year, month, today, firstMonth),
        incidents: ofMonth.length,
        incidentsSigned: ofMonth.filter((i) => i.signedCurrent).length,
        forms: forms.map((formType) => {
          const row = rows.find((r) => r.formType === formType && r.month === month) ?? null;
          const state = row?.state ?? 'open';
          const signed = row ? periodFiles.some((f) => f.ownerId === row.id && toSigned(f, row.lockedAt).current) : false;
          const governed = ofMonth.filter((i) => i.governing.includes(formType));
          return {
            formType,
            state,
            display: displayState(state, signed, governed.every((i) => i.signedCurrent)),
            periodId: row?.id ?? null,
          };
        }),
      });
    }
    const cells = months.flatMap((m) => (m.access === 'ok' ? m.forms : []));
    const pendingReopen = (await this.approvals.pending(PERIOD_REOPEN_KIND)).length;
    const unlinked = (await this.incidents.unlinked({ year })).filter((c) => forms.includes(c.form)).length;
    const kpis: Record<string, number> = isManager(actor)
      ? {
          pending: cells.filter((c) => c.display === 'pending').length,
          reopenPending: pendingReopen,
          awaitingSigned: cells.filter((c) => c.display === 'locked').length,
          done: cells.filter((c) => c.display === 'done').length,
        }
      : {
          unlinkedFails: unlinked,
          awaitingSigned: cells.filter((c) => c.display === 'locked').length,
          pending: cells.filter((c) => c.display === 'pending').length,
          done: cells.filter((c) => c.display === 'done').length,
        };
    return { year, months, kpis };
  }

  async detail(actor: IsoActor, formType: IsoFormType, year: number, month: number): Promise<PeriodDetail> {
    assertSeesForm(actor, formType);
    const today = await this.clock.today();
    await this.store.assertAccessible(year, month, today);
    const row = await this.store.find(formType, year, month);
    const state = row?.state ?? 'open';
    const governed = (await this.incidents.ofMonth(year, month)).filter((i) => i.governing.includes(formType));
    const signed = row ? (await this.files.listFor('iso_period', row.id)).map((f) => toSigned(f, row.lockedAt)) : [];
    const signedCurrent = state === 'locked' && signed.some((f) => f.current);
    const pendingClose = row ? await this.pendingOf(PERIOD_CLOSE_KIND, row.id) : null;
    const pendingReopen = row ? await this.pendingOf(PERIOD_REOPEN_KIND, row.id) : null;
    const lastReturn = row && state === 'open' ? await this.lastReturnOf(row.id) : null;
    const { checklist, rows } = await this.checklistOf(formType, year, month, today, governed);
    const names = await this.users.namesByEmails([row?.submittedBy, row?.lockedBy].filter((v): v is string => Boolean(v)));
    return {
      formType,
      year,
      month,
      today,
      periodId: row?.id ?? null,
      state,
      display: displayState(state, signedCurrent, governed.every((i) => i.signedCurrent)),
      canWrite: await this.access.canWrite(actor, formType),
      canDecide: isManager(actor),
      submittedBy: row?.submittedBy ? (names.get(row.submittedBy.toLowerCase()) ?? row.submittedBy) : null,
      submittedAt: row?.submittedAt ?? null,
      lockedBy: row?.lockedBy ? (names.get(row.lockedBy.toLowerCase()) ?? row.lockedBy) : null,
      lockedAt: row?.lockedAt ?? null,
      checklist: state === 'open' ? checklist : null,
      pendingClose,
      pendingReopen,
      lastReturn,
      signed,
      signedCurrent,
      incidents: governed.map((i) => ({ id: i.id, code: i.code, status: i.status, locked: i.locked, signedCurrent: i.signedCurrent })),
      counts: { rows },
    };
  }

  private async checklistOf(formType: IsoFormType, year: number, month: number, today: string, governed: IncidentRecord[]) {
    const inProgress = governed.filter((i) => i.status === 'in_progress').length;
    if (formType === '0203') {
      const { rows, summary } = await this.backup.summary(year, month, today);
      const blank = summary.missed.length + (summary.todayTotal - summary.todayDone);
      return {
        rows: new Set(rows.map((r) => r.jobId)).size,
        checklist: closeChecklist({ year, month, today, missed: blank, unlinkedFails: summary.unlinkedFails.length, inProgress }),
      };
    }
    const { issues, summary } = await this.antivirus.summary(year, month, today);
    return {
      rows: new Set(issues.map((i) => i.divisionId)).size,
      checklist: closeChecklist({
        year,
        month,
        today,
        missed: summary.pendingDays.length,
        unlinkedFails: summary.unlinkedIssues.length,
        inProgress,
      }),
    };
  }

  private async pendingOf(kind: string, periodId: string): Promise<PendingApproval | null> {
    const [request] = await this.approvals.list({ kind, subjectId: periodId, state: 'pending' });
    if (!request) return null;
    const names = await this.users.namesByEmails([request.requester]);
    return {
      id: request.id,
      kind,
      requester: request.requester,
      requesterName: names.get(request.requester.toLowerCase()) ?? request.requester,
      reason: request.reason,
      createdAt: request.createdAt,
    };
  }

  private async lastReturnOf(periodId: string) {
    const [returned] = (await this.approvals.list({ kind: PERIOD_CLOSE_KIND, subjectId: periodId, state: 'returned' })).sort(
      (a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0),
    );
    if (!returned) return null;
    return { note: returned.decisionNote, by: returned.decidedBy, at: returned.decidedAt };
  }

  /* --------------------------------------------------------- gửi chốt --- */

  async submit(actor: IsoActor, formType: IsoFormType, year: number, month: number): Promise<PeriodDetail> {
    const today = await this.clock.today();
    await this.store.assertAccessible(year, month, today);
    await this.access.assertCanWrite(actor, formType);
    await this.db.transaction(async (tx) => {
      const row = await this.store.lockWithin(tx, formType, year, month, 'update');
      if (row.state !== 'open') {
        throw new ConflictException({
          code: 'ISO_PERIOD_NOT_OPEN',
          message: `Kỳ ${periodLabel(formType, year, month)} đang "${PERIOD_STATE_LABEL[row.state]}" — không gửi chốt được nữa.`,
        });
      }
      // Kiểm lại ngay trong transaction đang giữ khoá kỳ: không ô nào đổi được giữa lúc kiểm và lúc khoá.
      if (formType === '0203') await lockJobListWithin(tx, 'exclusive');
      const governed = (await this.incidents.ofMonth(year, month)).filter((i) => i.governing.includes(formType));
      const { checklist } = await this.checklistOf(formType, year, month, today, governed);
      if (!checklist.canSubmit) {
        const first = checklist.items.find((i) => !i.ok)!;
        throw new BadRequestException({ code: 'ISO_PERIOD_CHECK_FAILED', message: CHECK_MESSAGE[first.key](first.count), checklist });
      }
      const snapshot: PeriodSnapshot =
        formType === '0203'
          ? { lines: await this.backup.liveRows(year, month, tx) }
          : { divisions: await this.antivirus.divisionsUsed(year, month, tx) };
      await tx
        .update(isoPeriodTable)
        .set({ state: 'pending', snapshot, submittedBy: actor.email, submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(isoPeriodTable.id, row.id));
      const request = await this.approvals.createWithin(tx, {
        kind: PERIOD_CLOSE_KIND,
        requester: actor.email,
        subjectType: 'iso_period',
        subjectId: row.id,
        reason: `Gửi chốt kỳ ${periodLabel(formType, year, month)}`,
      });
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_period.submitted',
        objectType: 'iso_period',
        objectId: row.id,
        detail: { formType, year, month, approvalId: request.id },
      });
      await this.outbox.enqueueWithin(tx, ISO_PERIOD_EVENT_TOPIC, { approvalId: request.id, event: 'close_requested' });
    });
    return this.detail(actor, formType, year, month);
  }

  /**
   * Duyệt chốt: kỳ khoá, 0206 Resolved / Temporary Fix thuộc kỳ khoá theo (suy từ trạng thái kỳ,
   * không ghi gì lên phiếu). SA/Admin tự gửi thì được tự duyệt (Q-28) — nhật ký ghi rõ.
   */
  async approve(actor: IsoActor, formType: IsoFormType, year: number, month: number, note: string | null): Promise<PeriodDetail> {
    this.assertManager(actor);
    await this.db.transaction(async (tx) => {
      const row = await this.lockExisting(tx, formType, year, month);
      const request = await this.requirePendingWithin(row, PERIOD_CLOSE_KIND, 'Kỳ này không có yêu cầu chốt nào đang chờ duyệt.');
      const now = new Date();
      await tx
        .update(isoPeriodTable)
        .set({ state: 'locked', lockedBy: actor.email, lockedAt: now, updatedAt: now })
        .where(eq(isoPeriodTable.id, row.id));
      await this.approvals.transitionWithin(tx, request.id, { to: 'approved', actor: actor.email, note });
      const selfApproved = request.requester.toLowerCase() === actor.email.toLowerCase();
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_period.approved',
        objectType: 'iso_period',
        objectId: row.id,
        detail: { formType, year, month, approvalId: request.id, submittedBy: request.requester, selfApproved },
      });
      if (!selfApproved) {
        await this.outbox.enqueueWithin(tx, ISO_PERIOD_EVENT_TOPIC, { approvalId: request.id, event: 'close_approved' });
      }
    });
    return this.detail(actor, formType, year, month);
  }

  async returnToSender(actor: IsoActor, formType: IsoFormType, year: number, month: number, note: string): Promise<PeriodDetail> {
    this.assertManager(actor);
    const reason = note.trim();
    if (!reason) throw new BadRequestException({ code: 'ISO_RETURN_NOTE_REQUIRED', message: 'Ghi lý do trả lại để người gửi biết phải sửa gì.' });
    await this.db.transaction(async (tx) => {
      const row = await this.lockExisting(tx, formType, year, month);
      const request = await this.requirePendingWithin(row, PERIOD_CLOSE_KIND, 'Kỳ này không có yêu cầu chốt nào đang chờ duyệt.');
      await tx
        .update(isoPeriodTable)
        .set({ state: 'open', snapshot: null, updatedAt: new Date() })
        .where(eq(isoPeriodTable.id, row.id));
      await this.approvals.transitionWithin(tx, request.id, { to: 'returned', actor: actor.email, note: reason });
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_period.returned',
        objectType: 'iso_period',
        objectId: row.id,
        detail: { formType, year, month, approvalId: request.id, note: reason },
      });
      if (request.requester.toLowerCase() !== actor.email.toLowerCase()) {
        await this.outbox.enqueueWithin(tx, ISO_PERIOD_EVENT_TOPIC, { approvalId: request.id, event: 'close_returned' });
      }
    });
    return this.detail(actor, formType, year, month);
  }

  /* --------------------------------------------------------- mở lại --- */

  async requestReopen(actor: IsoActor, formType: IsoFormType, year: number, month: number, reason: string): Promise<PeriodDetail> {
    await this.access.assertCanWrite(actor, formType);
    const text = reason.trim();
    if (!text) throw new BadRequestException({ code: 'APPROVAL_REASON_REQUIRED', message: 'Ghi lý do xin mở lại — người duyệt cần biết sửa gì.' });
    await this.db.transaction(async (tx) => {
      const row = await this.lockExisting(tx, formType, year, month);
      if (row.state !== 'locked') {
        throw new ConflictException({ code: 'ISO_PERIOD_NOT_LOCKED', message: 'Chỉ xin mở lại kỳ đã chốt.' });
      }
      const open = await this.approvals.list({ kind: PERIOD_REOPEN_KIND, subjectId: row.id, state: 'pending' });
      if (open.length > 0) {
        throw new ConflictException({ code: 'ISO_REOPEN_PENDING', message: 'Kỳ này đã có một yêu cầu mở lại đang chờ duyệt.' });
      }
      const request = await this.approvals.createWithin(tx, {
        kind: PERIOD_REOPEN_KIND,
        requester: actor.email,
        subjectType: 'iso_period',
        subjectId: row.id,
        reason: text,
      });
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_period.reopen_requested',
        objectType: 'iso_period',
        objectId: row.id,
        detail: { formType, year, month, approvalId: request.id, reason: text },
      });
      await this.outbox.enqueueWithin(tx, ISO_PERIOD_EVENT_TOPIC, { approvalId: request.id, event: 'reopen_requested' });
    });
    return this.detail(actor, formType, year, month);
  }

  /**
   * Duyệt mở lại: kỳ về Đang ghi, các 0206 của kỳ mở theo. Bản ký cũ KHÔNG xoá — lần chốt sau đổi
   * `locked_at`, nên bản cũ tự thành "cũ" trong lịch sử bản ký.
   */
  async decideReopen(actor: IsoActor, formType: IsoFormType, year: number, month: number, approve: boolean, note: string | null): Promise<PeriodDetail> {
    this.assertManager(actor);
    if (!approve && !note?.trim()) {
      throw new BadRequestException({ code: 'ISO_DENY_NOTE_REQUIRED', message: 'Ghi lý do từ chối để người xin biết.' });
    }
    await this.db.transaction(async (tx) => {
      const row = await this.lockExisting(tx, formType, year, month);
      const request = await this.requirePendingWithin(row, PERIOD_REOPEN_KIND, 'Kỳ này không có yêu cầu mở lại nào đang chờ.');
      if (approve) {
        await tx
          .update(isoPeriodTable)
          .set({ state: 'open', snapshot: null, updatedAt: new Date() })
          .where(eq(isoPeriodTable.id, row.id));
      }
      await this.approvals.transitionWithin(tx, request.id, { to: approve ? 'approved' : 'denied', actor: actor.email, note: note?.trim() || null });
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: approve ? 'iso_period.reopened' : 'iso_period.reopen_denied',
        objectType: 'iso_period',
        objectId: row.id,
        detail: { formType, year, month, approvalId: request.id, reason: request.reason, note: note?.trim() || null, requestedBy: request.requester },
      });
      if (request.requester.toLowerCase() !== actor.email.toLowerCase()) {
        await this.outbox.enqueueWithin(tx, ISO_PERIOD_EVENT_TOPIC, {
          approvalId: request.id,
          event: approve ? 'reopen_approved' : 'reopen_denied',
        });
      }
    });
    return this.detail(actor, formType, year, month);
  }

  /**
   * Yêu cầu chốt / mở lại kỳ đang chờ duyệt — khối "Cần bạn duyệt" của bảng điều khiển (SA/Admin).
   * Gồm cả yêu cầu do chính người xem gửi: SA/Admin được tự duyệt kỳ mình gửi (Q-28).
   */
  async pendingRequests(): Promise<{ approvalId: string; kind: string; formType: string; month: string; requesterName: string; reason: string; createdAt: Date }[]> {
    const pending = [...(await this.approvals.pending(PERIOD_CLOSE_KIND)), ...(await this.approvals.pending(PERIOD_REOPEN_KIND))];
    if (pending.length === 0) return [];
    const names = await this.users.namesByEmails([...new Set(pending.map((a) => a.requester))]);
    const out = [];
    for (const request of pending) {
      const period = await this.store.findById(request.subjectId);
      if (!period) continue;
      out.push({
        approvalId: request.id,
        kind: request.kind,
        formType: period.formType,
        month: monthKey(period.year, period.month),
        requesterName: names.get(request.requester.toLowerCase()) ?? request.requester,
        reason: request.reason,
        createdAt: request.createdAt,
      });
    }
    return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /** Việc cần làm của người đang xem — số trên đầu nhóm "Phiếu ISO" khi thu gọn. */
  async todo(actor: IsoActor): Promise<{ count: number; pendingApprovals: number; unlinkedFails: number; awaitingSigned: number }> {
    const pendingApprovals = isManager(actor)
      ? (await this.approvals.pending(PERIOD_CLOSE_KIND)).length + (await this.approvals.pending(PERIOD_REOPEN_KIND)).length
      : 0;
    const writable = (await Promise.all(ISO_FORM_TYPES.map(async (f) => ((await this.access.canWrite(actor, f)) ? f : null)))).filter(
      (f): f is IsoFormType => f !== null,
    );
    const unlinked = (await this.incidents.unlinked({})).filter((c) => writable.includes(c.form)).length;
    const locked = (await this.store.allLocked()).filter((r) => writable.includes(r.formType as IsoFormType));
    const files = await this.files.listForOwners('iso_period', locked.map((r) => r.id));
    // Cùng luật "Hoàn tất" với màn Kỳ phiếu: bản ký của kỳ VÀ của mọi 0206 thuộc kỳ.
    const years = [...new Set(locked.map((r) => r.year))];
    const incidents = (await Promise.all(years.map((y) => this.incidents.ofYear(y)))).flat();
    const awaitingSigned = locked.filter((r) => {
      const signed = files.some((f) => f.ownerId === r.id && toSigned(f, r.lockedAt).current);
      const governed = incidents.filter((i) => i.year === r.year && i.month === r.month && i.governing.includes(r.formType as IsoFormType));
      return displayState('locked', signed, governed.every((i) => i.signedCurrent)) !== 'done';
    }).length;
    return { count: pendingApprovals + unlinked + awaitingSigned, pendingApprovals, unlinkedFails: unlinked, awaitingSigned };
  }

  /* --------------------------------------------------------- nội bộ --- */

  private assertManager(actor: IsoActor): void {
    if (!isManager(actor)) {
      throw new ForbiddenException({ code: 'ISO_DECIDE_MANAGER_ONLY', message: 'Chỉ Super Admin / Quản trị duyệt hoặc trả lại kỳ phiếu.' });
    }
  }

  private async lockExisting(tx: Tx, formType: IsoFormType, year: number, month: number): Promise<PeriodRow> {
    const existing = await this.store.find(formType, year, month);
    if (!existing) throw new NotFoundException({ code: 'ISO_PERIOD_NOT_FOUND', message: `Kỳ ${periodLabel(formType, year, month)} chưa gửi chốt lần nào.` });
    return this.store.lockWithin(tx, formType, year, month, 'update');
  }

  private async requirePendingWithin(row: PeriodRow, kind: string, message: string): Promise<ApprovalRecord> {
    const [request] = await this.approvals.list({ kind, subjectId: row.id, state: 'pending' });
    if (!request) throw new ConflictException({ code: 'ISO_NO_PENDING_REQUEST', message });
    return request;
  }
}

const CHECK_MESSAGE: Record<ChecklistItem['key'], (count: number) => string> = {
  month_ended: () => 'Chưa tới ngày cuối tháng của kỳ — chỉ gửi chốt từ ngày cuối tháng trở đi.',
  no_blank: (n) => `Còn ${n} ô / ngày chưa có kết quả.`,
  fails_linked: (n) => `Còn ${n} ô ✗ chưa có phiếu 0206.`,
  in_progress: () => '',
};
