import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, between, eq, gte, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Tx } from '../../common/tx';
import { viDate } from '../../common/today';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import { IsoAccessService, type IsoActor } from './iso-access.service';
import { IsoClock } from './iso-clock';
import {
  isoBackupJobTable,
  isoBackupLineTable,
  isoBackupTickTable,
  isoIncidentCellTable,
  isoIncidentTable,
  type BackupRowSnapshot,
} from './iso-forms.schema';
import { IsoPeriodStore, type PeriodRow } from './iso-period.store';
import {
  backupSummary,
  firstDayOf,
  lastDayOf,
  lineApplies,
  monthOf,
  tickKey,
  type BackupSummary,
  type PeriodState,
  type TickResult,
} from './iso-rules';

export interface TickCell {
  lineId: string;
  day: string;
  result: TickResult;
  incident: { id: string; code: string } | null;
}

export interface BackupGrid {
  formType: '0203';
  year: number;
  month: number;
  today: string;
  state: PeriodState;
  periodId: string | null;
  canEdit: boolean;
  rows: BackupRowSnapshot[];
  ticks: TickCell[];
  summary: BackupSummary;
}

/**
 * Lưới 0203 (Story 8.2): mỗi dòng của job × mỗi ngày. Ô trống không có hàng; ✓/✗ là một hàng
 * `iso_backup_tick`. Ghi ô chỉ cho người phụ trách 0203 và SA/Admin, chỉ ngày đã qua / hôm nay
 * trong khoảng theo dõi của job, chỉ khi kỳ còn Đang ghi.
 */
@Injectable()
export class IsoBackupService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly access: IsoAccessService,
    private readonly periods: IsoPeriodStore,
    private readonly clock: IsoClock,
  ) {}

  async grid(actor: IsoActor, year: number, month: number): Promise<BackupGrid> {
    const today = await this.clock.today();
    await this.periods.assertAccessible(year, month, today);
    const period = await this.periods.find('0203', year, month);
    const state = period?.state ?? 'open';
    const rows = await this.rowsFor(period, year, month);
    const ticks = await this.ticksOf(rows.map((r) => r.lineId), year, month);
    return {
      formType: '0203',
      year,
      month,
      today,
      state,
      periodId: period?.id ?? null,
      canEdit: state === 'open' && (await this.access.canWrite(actor, '0203')),
      rows,
      ticks,
      summary: summarize(rows, ticks, year, month, today),
    };
  }

  /** Tóm tắt cho luồng chốt kỳ / mail nhắc, không cần dựng cả lưới. */
  async summary(year: number, month: number, today: string): Promise<{ rows: BackupRowSnapshot[]; summary: BackupSummary }> {
    const period = await this.periods.find('0203', year, month);
    const rows = await this.rowsFor(period, year, month);
    const ticks = await this.ticksOf(rows.map((r) => r.lineId), year, month);
    return { rows, summary: summarize(rows, ticks, year, month, today) };
  }

  /** Dòng của kỳ: kỳ đã gửi chốt đọc bản chụp (AR-8), kỳ đang ghi đọc danh mục sống. */
  async rowsFor(period: PeriodRow | null, year: number, month: number): Promise<BackupRowSnapshot[]> {
    if (period && period.state !== 'open' && period.snapshot?.lines) return period.snapshot.lines;
    return this.liveRows(year, month);
  }

  /** Job có ít nhất một ngày theo dõi trong tháng — job đã ngừng vẫn hiện ở các tháng nó còn chạy. */
  async liveRows(year: number, month: number, tx?: Tx): Promise<BackupRowSnapshot[]> {
    const first = firstDayOf(year, month);
    const last = lastDayOf(year, month);
    const rows = await (tx ?? this.db)
      .select({
        jobId: isoBackupJobTable.id,
        no: isoBackupJobTable.no,
        name: isoBackupJobTable.name,
        trackedFrom: isoBackupJobTable.trackedFrom,
        stoppedOn: isoBackupJobTable.stoppedOn,
        lineId: isoBackupLineTable.id,
        label: isoBackupLineTable.label,
        pointsNas: isoBackupLineTable.pointsNas,
        storageNas: isoBackupLineTable.storageNas,
        pointsCloud: isoBackupLineTable.pointsCloud,
        storageCloud: isoBackupLineTable.storageCloud,
      })
      .from(isoBackupJobTable)
      .innerJoin(isoBackupLineTable, eq(isoBackupLineTable.jobId, isoBackupJobTable.id))
      .where(
        and(
          lte(isoBackupJobTable.trackedFrom, last),
          or(isNull(isoBackupJobTable.stoppedOn), gte(isoBackupJobTable.stoppedOn, first)),
        ),
      )
      .orderBy(asc(isoBackupJobTable.no), asc(isoBackupJobTable.name), asc(isoBackupLineTable.sortOrder));
    return rows;
  }

  private async ticksOf(lineIds: string[], year: number, month: number): Promise<TickCell[]> {
    if (lineIds.length === 0) return [];
    const rows = await this.db
      .select({
        lineId: isoBackupTickTable.lineId,
        day: isoBackupTickTable.day,
        result: isoBackupTickTable.result,
        incidentId: isoIncidentTable.id,
        incidentCode: isoIncidentTable.code,
      })
      .from(isoBackupTickTable)
      .leftJoin(
        isoIncidentCellTable,
        and(eq(isoIncidentCellTable.tickLineId, isoBackupTickTable.lineId), eq(isoIncidentCellTable.tickDay, isoBackupTickTable.day)),
      )
      .leftJoin(isoIncidentTable, eq(isoIncidentTable.id, isoIncidentCellTable.incidentId))
      .where(
        and(
          inArray(isoBackupTickTable.lineId, lineIds),
          between(isoBackupTickTable.day, firstDayOf(year, month), lastDayOf(year, month)),
        ),
      );
    return rows.map((r) => ({
      lineId: r.lineId,
      day: r.day,
      result: r.result,
      incident: r.incidentId && r.incidentCode ? { id: r.incidentId, code: r.incidentCode } : null,
    }));
  }

  /** Đặt một ô: ✓, ✗, hoặc `null` = để trống. */
  async setTick(actor: IsoActor, input: { lineId: string; day: string; result: TickResult | null }): Promise<TickCell | null> {
    const today = await this.clock.today();
    const { year, month } = monthOf(input.day);
    await this.periods.assertAccessible(year, month, today);
    if (input.day > today) throw futureDay();
    await this.access.assertCanWrite(actor, '0203');
    return this.db.transaction(async (tx) => {
      await this.periods.assertOpenWithin(tx, '0203', year, month);
      const line = await this.lineWithin(tx, input.lineId);
      if (!lineApplies(line.trackedFrom, line.stoppedOn, input.day)) {
        throw new BadRequestException({
          code: 'ISO_CELL_OUT_OF_TRACKING',
          message: `Ngày ${viDate(input.day)} nằm ngoài thời gian theo dõi của job "${line.name}".`,
        });
      }
      const [before] = await tx
        .select()
        .from(isoBackupTickTable)
        .where(and(eq(isoBackupTickTable.lineId, input.lineId), eq(isoBackupTickTable.day, input.day)))
        .for('update');
      if ((before?.result ?? null) === input.result) return before ? { ...before, incident: null } : null;
      if (before?.result === 'fail') await this.assertNotLinked(tx, input.lineId, input.day);
      if (input.result === null) {
        await tx.delete(isoBackupTickTable).where(and(eq(isoBackupTickTable.lineId, input.lineId), eq(isoBackupTickTable.day, input.day)));
      } else {
        await tx
          .insert(isoBackupTickTable)
          .values({ lineId: input.lineId, day: input.day, result: input.result, updatedBy: actor.email })
          .onConflictDoUpdate({
            target: [isoBackupTickTable.lineId, isoBackupTickTable.day],
            set: { result: input.result, updatedBy: actor.email, updatedAt: new Date() },
          });
      }
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_backup.tick_set',
        objectType: 'iso_backup_job',
        objectId: line.jobId,
        detail: { lineId: input.lineId, label: line.label, day: input.day, from: before?.result ?? null, to: input.result },
      });
      return input.result ? { lineId: input.lineId, day: input.day, result: input.result, incident: null } : null;
    });
  }

  /** Nút ✓ đầu cột: mọi ô trống của ngày đó thành ✓ trong một lệnh; ô ✗ giữ nguyên. */
  async fillDay(actor: IsoActor, day: string): Promise<{ filled: number }> {
    const today = await this.clock.today();
    const { year, month } = monthOf(day);
    await this.periods.assertAccessible(year, month, today);
    if (day > today) throw futureDay();
    await this.access.assertCanWrite(actor, '0203');
    return this.db.transaction(async (tx) => {
      await this.periods.assertOpenWithin(tx, '0203', year, month);
      const lines = (await this.liveRows(year, month, tx)).filter((r) => lineApplies(r.trackedFrom, r.stoppedOn, day));
      if (lines.length === 0) return { filled: 0 };
      const inserted = await tx
        .insert(isoBackupTickTable)
        .values(lines.map((l) => ({ lineId: l.lineId, day, result: 'ok' as const, updatedBy: actor.email })))
        .onConflictDoNothing()
        .returning({ lineId: isoBackupTickTable.lineId });
      if (inserted.length > 0) {
        await this.audit.appendWithin(tx, {
          actor: actor.email,
          action: 'iso_backup.day_filled',
          objectType: 'iso_period',
          detail: { formType: '0203', day, filled: inserted.length },
        });
      }
      return { filled: inserted.length };
    });
  }

  private async lineWithin(tx: Tx, lineId: string) {
    const [line] = await tx
      .select({
        jobId: isoBackupJobTable.id,
        name: isoBackupJobTable.name,
        label: isoBackupLineTable.label,
        trackedFrom: isoBackupJobTable.trackedFrom,
        stoppedOn: isoBackupJobTable.stoppedOn,
      })
      .from(isoBackupLineTable)
      .innerJoin(isoBackupJobTable, eq(isoBackupJobTable.id, isoBackupLineTable.jobId))
      .where(eq(isoBackupLineTable.id, lineId));
    if (!line) throw new NotFoundException({ code: 'ISO_LINE_NOT_FOUND', message: 'Không tìm thấy dòng job này. Tải lại lưới.' });
    return line;
  }

  private async assertNotLinked(tx: Tx, lineId: string, day: string): Promise<void> {
    const [linked] = await tx
      .select({ code: isoIncidentTable.code })
      .from(isoIncidentCellTable)
      .innerJoin(isoIncidentTable, eq(isoIncidentTable.id, isoIncidentCellTable.incidentId))
      .where(and(isNotNull(isoIncidentCellTable.tickLineId), eq(isoIncidentCellTable.tickLineId, lineId), eq(isoIncidentCellTable.tickDay, day)));
    if (linked) {
      throw new ConflictException({
        code: 'ISO_CELL_LINKED',
        message: `Ô này đã gắn phiếu ${linked.code} — bỏ gắn ở phiếu đó trước khi đổi kết quả.`,
      });
    }
  }
}

function summarize(rows: BackupRowSnapshot[], ticks: TickCell[], year: number, month: number, today: string): BackupSummary {
  return backupSummary({
    year,
    month,
    today,
    lines: rows.map((r) => ({ id: r.lineId, trackedFrom: r.trackedFrom, stoppedOn: r.stoppedOn })),
    ticks: new Map(ticks.map((t) => [tickKey(t.lineId, t.day), t.result])),
    linked: new Set(ticks.filter((t) => t.incident).map((t) => tickKey(t.lineId, t.day))),
  });
}

function futureDay(): BadRequestException {
  return new BadRequestException({ code: 'ISO_CELL_FUTURE', message: 'Ngày tương lai chưa đánh được.' });
}
