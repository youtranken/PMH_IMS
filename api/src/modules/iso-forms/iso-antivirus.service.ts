import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, between, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../../common/tx';
import { viDate } from '../../common/today';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import { SystemConfigService } from '../config-sys/system-config.service';
import { IsoAccessService, type IsoActor } from './iso-access.service';
import { IsoCatalogService } from './iso-catalog.service';
import { IsoClock } from './iso-clock';
import {
  isoAvClearDayTable,
  isoAvIssueTable,
  isoDivisionTable,
  isoIncidentCellTable,
  isoIncidentTable,
} from './iso-forms.schema';
import { IsoPeriodStore } from './iso-period.store';
import { antivirusSummary, firstDayOf, lastDayOf, monthOf, type AntivirusSummary, type PeriodState } from './iso-rules';

export interface AvIssue {
  id: string;
  reportedOn: string;
  divisionId: string;
  divisionName: string;
  computerName: string;
  description: string;
  resolvedOn: string | null;
  handledBy: string | null;
  incident: { id: string; code: string } | null;
}

export interface AntivirusGrid {
  formType: '0208';
  year: number;
  month: number;
  today: string;
  state: PeriodState;
  periodId: string | null;
  canEdit: boolean;
  /** Dòng "System Antivirus:" của bản in (`iso.antivirus_system`). */
  systemName: string;
  issues: AvIssue[];
  clearDays: string[];
  summary: AntivirusSummary;
}

export interface IssueInput {
  reportedOn: string;
  divisionId: string | null;
  /** "+ Bộ phận mới" gõ tại chỗ: lưu luôn vào danh mục (Q-28). */
  newDivisionName: string | null;
  computerName: string;
  description: string;
  resolvedOn: string | null;
}

/**
 * Lưới 0208: mỗi ngày phải có kết quả — "không có issue", hoặc ít nhất một dòng issue
 * (một máy × một ngày phát hiện). Dòng gom theo bộ phận; chỉ bộ phận có issue trong tháng mới
 * hiện, nên cột Division khác nhau giữa các tháng.
 */
@Injectable()
export class IsoAntivirusService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly access: IsoAccessService,
    private readonly periods: IsoPeriodStore,
    private readonly catalog: IsoCatalogService,
    private readonly clock: IsoClock,
    private readonly config: SystemConfigService,
  ) {}

  async grid(actor: IsoActor, year: number, month: number): Promise<AntivirusGrid> {
    const today = await this.clock.today();
    await this.periods.assertAccessible(year, month, today);
    const period = await this.periods.find('0208', year, month);
    const state = period?.state ?? 'open';
    const { issues, clearDays } = await this.monthData(year, month);
    // Kỳ đã gửi chốt in tên bộ phận như lúc chốt (AR-8), không theo tên đã đổi về sau.
    const frozen = state !== 'open' ? period?.snapshot?.divisions : undefined;
    if (frozen) {
      const names = new Map(frozen.map((d) => [d.id, d.name]));
      for (const issue of issues) issue.divisionName = names.get(issue.divisionId) ?? issue.divisionName;
    }
    return {
      formType: '0208',
      year,
      month,
      today,
      state,
      periodId: period?.id ?? null,
      canEdit: state === 'open' && (await this.access.canWrite(actor, '0208')),
      systemName: await this.config.getString('isoAntivirusSystem'),
      issues,
      clearDays,
      summary: summarize(issues, clearDays, year, month, today),
    };
  }

  async summary(year: number, month: number, today: string): Promise<{ issues: AvIssue[]; summary: AntivirusSummary }> {
    const { issues, clearDays } = await this.monthData(year, month);
    return { issues, summary: summarize(issues, clearDays, year, month, today) };
  }

  /** Bộ phận có issue trong tháng — chụp lại lúc gửi chốt. */
  async divisionsUsed(year: number, month: number, tx: Tx): Promise<{ id: string; code: string | null; name: string }[]> {
    return tx
      .selectDistinct({ id: isoDivisionTable.id, code: isoDivisionTable.code, name: isoDivisionTable.name })
      .from(isoAvIssueTable)
      .innerJoin(isoDivisionTable, eq(isoDivisionTable.id, isoAvIssueTable.divisionId))
      .where(between(isoAvIssueTable.reportedOn, firstDayOf(year, month), lastDayOf(year, month)));
  }

  private async monthData(year: number, month: number): Promise<{ issues: AvIssue[]; clearDays: string[] }> {
    const range = between(isoAvIssueTable.reportedOn, firstDayOf(year, month), lastDayOf(year, month));
    const rows = await this.db
      .select({
        id: isoAvIssueTable.id,
        reportedOn: isoAvIssueTable.reportedOn,
        divisionId: isoAvIssueTable.divisionId,
        divisionName: isoDivisionTable.name,
        computerName: isoAvIssueTable.computerName,
        description: isoAvIssueTable.description,
        resolvedOn: isoAvIssueTable.resolvedOn,
        handledBy: isoAvIssueTable.handledBy,
        incidentId: isoIncidentTable.id,
        incidentCode: isoIncidentTable.code,
      })
      .from(isoAvIssueTable)
      .innerJoin(isoDivisionTable, eq(isoDivisionTable.id, isoAvIssueTable.divisionId))
      .leftJoin(isoIncidentCellTable, eq(isoIncidentCellTable.avIssueId, isoAvIssueTable.id))
      .leftJoin(isoIncidentTable, eq(isoIncidentTable.id, isoIncidentCellTable.incidentId))
      .where(range)
      .orderBy(asc(isoDivisionTable.name), asc(isoAvIssueTable.reportedOn), asc(isoAvIssueTable.computerName));
    const clear = await this.db
      .select({ day: isoAvClearDayTable.day })
      .from(isoAvClearDayTable)
      .where(between(isoAvClearDayTable.day, firstDayOf(year, month), lastDayOf(year, month)));
    return {
      issues: rows.map(({ incidentId, incidentCode, ...r }) => ({
        ...r,
        incident: incidentId && incidentCode ? { id: incidentId, code: incidentCode } : null,
      })),
      clearDays: clear.map((c) => c.day).sort(),
    };
  }

  /** "✓ Ngày … không có issue". */
  async markClear(actor: IsoActor, day: string): Promise<void> {
    const { year, month } = await this.guardDay(actor, day);
    await this.db.transaction(async (tx) => {
      await this.periods.assertOpenWithin(tx, '0208', year, month);
      await lockDayWithin(tx, day);
      const [issue] = await tx.select({ id: isoAvIssueTable.id }).from(isoAvIssueTable).where(eq(isoAvIssueTable.reportedOn, day)).limit(1);
      if (issue) {
        throw new ConflictException({
          code: 'ISO_DAY_HAS_ISSUE',
          message: `Ngày ${viDate(day)} đã có dòng issue — không đánh "không có issue" được. Tải lại để xem.`,
        });
      }
      const inserted = await tx.insert(isoAvClearDayTable).values({ day, markedBy: actor.email }).onConflictDoNothing().returning();
      if (inserted.length === 0) return;
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_antivirus.day_cleared',
        objectType: 'iso_period',
        detail: { formType: '0208', day },
      });
    });
  }

  async unmarkClear(actor: IsoActor, day: string): Promise<void> {
    const { year, month } = await this.guardDay(actor, day);
    await this.db.transaction(async (tx) => {
      await this.periods.assertOpenWithin(tx, '0208', year, month);
      const removed = await tx.delete(isoAvClearDayTable).where(eq(isoAvClearDayTable.day, day)).returning();
      if (removed.length === 0) return;
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_antivirus.day_uncleared',
        objectType: 'iso_period',
        detail: { formType: '0208', day },
      });
    });
  }

  async createIssue(actor: IsoActor, input: IssueInput): Promise<AvIssue> {
    const { year, month } = await this.guardDay(actor, input.reportedOn);
    this.checkIssue(input);
    // Handled = người ghi dòng, lấy từ phiên chứ không từ form: ai ghi thì tên người đó lên phiếu.
    const handledBy = await this.access.nameOf(actor);
    const id = await this.db.transaction(async (tx) => {
      await this.periods.assertOpenWithin(tx, '0208', year, month);
      await lockDayWithin(tx, input.reportedOn);
      const divisionId = await this.resolveDivision(tx, actor, input);
      const [row] = await tx
        .insert(isoAvIssueTable)
        .values({
          reportedOn: input.reportedOn,
          divisionId,
          computerName: input.computerName.trim(),
          description: input.description.trim(),
          resolvedOn: input.resolvedOn,
          handledBy,
          createdBy: actor.email,
        })
        .returning();
      // Ngày đã có một dòng issue thì không còn là "không có issue".
      await tx.delete(isoAvClearDayTable).where(eq(isoAvClearDayTable.day, input.reportedOn));
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_antivirus.issue_created',
        objectType: 'iso_av_issue',
        objectId: row.id,
        detail: { reportedOn: row.reportedOn, divisionId, computerName: row.computerName },
      });
      return row.id;
    });
    return this.issue(id);
  }

  async updateIssue(actor: IsoActor, id: string, input: IssueInput): Promise<AvIssue> {
    const before = await this.issue(id);
    const from = await this.guardDay(actor, before.reportedOn);
    const to = await this.guardDay(actor, input.reportedOn);
    this.checkIssue(input);
    await this.db.transaction(async (tx) => {
      await this.periods.assertOpenWithin(tx, '0208', from.year, from.month);
      if (to.year !== from.year || to.month !== from.month) await this.periods.assertOpenWithin(tx, '0208', to.year, to.month);
      await lockDayWithin(tx, input.reportedOn);
      const current = await this.lockIssueWithin(tx, id);
      if (current.reportedOn !== before.reportedOn) throw issueChanged();
      if (current.linkedCode && input.reportedOn !== before.reportedOn) {
        throw new ConflictException({
          code: 'ISO_CELL_LINKED',
          message: `Dòng này đã gắn phiếu ${current.linkedCode} — bỏ gắn ở phiếu đó trước khi đổi ngày phát hiện.`,
        });
      }
      const divisionId = await this.resolveDivision(tx, actor, input);
      await tx
        .update(isoAvIssueTable)
        .set({
          reportedOn: input.reportedOn,
          divisionId,
          computerName: input.computerName.trim(),
          description: input.description.trim(),
          resolvedOn: input.resolvedOn,
          updatedAt: new Date(),
        })
        .where(eq(isoAvIssueTable.id, id));
      await tx.delete(isoAvClearDayTable).where(eq(isoAvClearDayTable.day, input.reportedOn));
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_antivirus.issue_updated',
        objectType: 'iso_av_issue',
        objectId: id,
        detail: {
          from: { reportedOn: before.reportedOn, divisionId: before.divisionId, computerName: before.computerName, resolvedOn: before.resolvedOn },
          to: { reportedOn: input.reportedOn, divisionId, computerName: input.computerName.trim(), resolvedOn: input.resolvedOn },
        },
      });
    });
    return this.issue(id);
  }

  async deleteIssue(actor: IsoActor, id: string): Promise<void> {
    const before = await this.issue(id);
    const { year, month } = await this.guardDay(actor, before.reportedOn);
    await this.db.transaction(async (tx) => {
      await this.periods.assertOpenWithin(tx, '0208', year, month);
      const current = await this.lockIssueWithin(tx, id);
      if (current.reportedOn !== before.reportedOn) throw issueChanged();
      if (current.linkedCode) {
        throw new ConflictException({
          code: 'ISO_CELL_LINKED',
          message: `Dòng này đã gắn phiếu ${current.linkedCode} — bỏ gắn ở phiếu đó trước khi xoá.`,
        });
      }
      await tx.delete(isoAvIssueTable).where(eq(isoAvIssueTable.id, id));
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_antivirus.issue_deleted',
        objectType: 'iso_av_issue',
        objectId: id,
        detail: { reportedOn: before.reportedOn, divisionName: before.divisionName, computerName: before.computerName },
      });
    });
  }

  async issue(id: string): Promise<AvIssue> {
    const [row] = await this.issuesByIds([id]);
    if (!row) throw new NotFoundException({ code: 'ISO_ISSUE_NOT_FOUND', message: 'Không tìm thấy dòng issue này.' });
    return row;
  }

  async issuesByIds(ids: string[]): Promise<AvIssue[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        id: isoAvIssueTable.id,
        reportedOn: isoAvIssueTable.reportedOn,
        divisionId: isoAvIssueTable.divisionId,
        divisionName: isoDivisionTable.name,
        computerName: isoAvIssueTable.computerName,
        description: isoAvIssueTable.description,
        resolvedOn: isoAvIssueTable.resolvedOn,
        handledBy: isoAvIssueTable.handledBy,
        incidentId: isoIncidentTable.id,
        incidentCode: isoIncidentTable.code,
      })
      .from(isoAvIssueTable)
      .innerJoin(isoDivisionTable, eq(isoDivisionTable.id, isoAvIssueTable.divisionId))
      .leftJoin(isoIncidentCellTable, eq(isoIncidentCellTable.avIssueId, isoAvIssueTable.id))
      .leftJoin(isoIncidentTable, eq(isoIncidentTable.id, isoIncidentCellTable.incidentId))
      .where(inArray(isoAvIssueTable.id, ids));
    return rows.map(({ incidentId, incidentCode, ...r }) => ({
      ...r,
      incident: incidentId && incidentCode ? { id: incidentId, code: incidentCode } : null,
    }));
  }

  private async guardDay(actor: IsoActor, day: string): Promise<{ year: number; month: number }> {
    const today = await this.clock.today();
    const { year, month } = monthOf(day);
    await this.periods.assertAccessible(year, month, today);
    if (day > today) throw new BadRequestException({ code: 'ISO_CELL_FUTURE', message: 'Ngày tương lai chưa ghi được.' });
    await this.access.assertCanWrite(actor, '0208');
    return { year, month };
  }

  private checkIssue(input: IssueInput): void {
    if (input.resolvedOn && input.resolvedOn < input.reportedOn) {
      throw new BadRequestException({
        code: 'ISO_ISSUE_DATES',
        message: `Resolution Date phải từ ${viDate(input.reportedOn)} trở đi.`,
      });
    }
    if (!input.divisionId && !input.newDivisionName?.trim()) {
      throw new BadRequestException({ code: 'ISO_ISSUE_DIVISION', message: 'Chọn Division, hoặc gõ tên bộ phận mới.' });
    }
  }

  /**
   * Khoá hàng issue rồi mới đọc "đã gắn 0206 chưa": lượt gắn ô 0208 vào phiếu cũng khoá hàng này
   * (`resolveCellsWithin`), nên đọc trước khi khoá là dùng kết quả đã cũ.
   */
  private async lockIssueWithin(tx: Tx, id: string): Promise<{ reportedOn: string; linkedCode: string | null }> {
    const [row] = await tx.select({ reportedOn: isoAvIssueTable.reportedOn }).from(isoAvIssueTable).where(eq(isoAvIssueTable.id, id)).for('update');
    if (!row) throw new NotFoundException({ code: 'ISO_ISSUE_NOT_FOUND', message: 'Không tìm thấy dòng issue này.' });
    const [link] = await tx
      .select({ code: isoIncidentTable.code })
      .from(isoIncidentCellTable)
      .innerJoin(isoIncidentTable, eq(isoIncidentTable.id, isoIncidentCellTable.incidentId))
      .where(eq(isoIncidentCellTable.avIssueId, id));
    return { reportedOn: row.reportedOn, linkedCode: link?.code ?? null };
  }

  private async resolveDivision(tx: Tx, actor: IsoActor, input: IssueInput): Promise<string> {
    if (input.newDivisionName?.trim()) {
      return (await this.catalog.createDivisionWithin(tx, actor, { code: null, name: input.newDivisionName })).id;
    }
    const [division] = await tx.select({ id: isoDivisionTable.id }).from(isoDivisionTable).where(eq(isoDivisionTable.id, input.divisionId!));
    if (!division) throw new BadRequestException({ code: 'ISO_DIVISION_NOT_FOUND', message: 'Bộ phận được chọn không còn. Tải lại rồi chọn lại.' });
    return division.id;
  }
}

/**
 * Một ngày 0208 là "không có issue" HOẶC có dòng issue, không cả hai. Đánh "không có issue" và ghi
 * issue cùng ngày chạy song song thì mỗi bên đều thấy bên kia chưa có — khoá theo ngày cho hai lượt
 * đó đi lần lượt.
 */
async function lockDayWithin(tx: Tx, day: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`iso-av-day:${day}`}, 0))`);
}

function issueChanged() {
  return new ConflictException({ code: 'ISO_ISSUE_CHANGED', message: 'Dòng issue vừa được người khác sửa. Tải lại rồi làm tiếp.' });
}

function summarize(issues: AvIssue[], clearDays: string[], year: number, month: number, today: string): AntivirusSummary {
  return antivirusSummary({
    year,
    month,
    today,
    clearDays: new Set(clearDays),
    issues: issues.map((i) => ({ id: i.id, reportedOn: i.reportedOn, linked: Boolean(i.incident) })),
  });
}
