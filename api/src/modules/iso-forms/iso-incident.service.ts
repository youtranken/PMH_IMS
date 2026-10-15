import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, between, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../../common/tx';
import { isoDateInTz, viDate } from '../../common/today';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import { FilesApiService, type FileRecord } from '../files/files.api';
import { UsersApiService } from '../users/users.api';
import { IsoAccessService, type IsoActor } from './iso-access.service';
import { IsoClock } from './iso-clock';
import {
  isoAvIssueTable,
  isoBackupJobTable,
  isoBackupLineTable,
  isoBackupTickTable,
  isoDivisionTable,
  isoIncidentCellTable,
  isoIncidentTable,
} from './iso-forms.schema';
import { IsoPeriodStore, stateKey } from './iso-period.store';
import {
  incidentCode,
  incidentGoverning,
  incidentInReview,
  incidentLocked,
  monthKey,
  monthOf,
  signedIsCurrent,
  validateIncident,
  type IncidentInput,
  type IncidentStatus,
  type IsoFormType,
  type PeriodState,
} from './iso-rules';

export type CellInput = { form: '0203'; lineId: string; day: string } | { form: '0208'; issueId: string };

export interface IncidentCell {
  form: IsoFormType;
  lineId: string | null;
  day: string;
  issueId: string | null;
  /** 0203: `tên job › đối tượng`; 0208: `bộ phận · máy`. */
  label: string;
}

export interface SignedFile {
  id: string;
  originalName: string;
  sizeBytes: number;
  uploadedAt: Date;
  uploadedBy: string;
  current: boolean;
}

export interface IncidentRecord extends IncidentInput {
  id: string;
  code: string;
  year: number;
  month: number;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  contentUpdatedAt: Date;
  cells: IncidentCell[];
  governing: IsoFormType[];
  locked: boolean;
  /** Có kỳ quản phiếu đang Chờ duyệt: chỉ xem tới khi kỳ được duyệt hoặc trả lại. */
  inReview: boolean;
  /** Bản ký hiện hành (tải lên sau lần sửa nội dung gần nhất). */
  signedCurrent: boolean;
  signed: SignedFile[];
}

export interface UnlinkedCell extends IncidentCell {
  year: number;
  month: number;
}

export interface IncidentListFilters {
  year: number;
  month?: number;
  kind?: string;
  source?: 'backup' | 'antivirus' | 'direct';
  signed?: 'yes' | 'no';
}

type IncidentRow = typeof isoIncidentTable.$inferSelect;

/**
 * Phiếu sự cố 0206. Một sự cố một phiếu: phiếu thuộc kỳ của tháng chứa Detection
 * Time; ô ✗ tháng sau của cùng sự cố gắn vào chính phiếu đó. Số `0206-YYYY-NNN` cấp lúc lưu.
 *
 * Phiếu khoá khi mọi kỳ quản nó đã duyệt chốt (`incidentLocked`); không có cột khoá riêng nên mở
 * lại kỳ là phiếu mở theo, đổi In Progress sang Resolved là phiếu tự khoá.
 */
@Injectable()
export class IsoIncidentService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly access: IsoAccessService,
    private readonly periods: IsoPeriodStore,
    private readonly files: FilesApiService,
    private readonly users: UsersApiService,
    private readonly clock: IsoClock,
  ) {}

  /* ---------------------------------------------------------------- đọc --- */

  async get(id: string): Promise<IncidentRecord> {
    const [row] = await this.db.select().from(isoIncidentTable).where(eq(isoIncidentTable.id, id));
    if (!row) throw new NotFoundException({ code: 'ISO_INCIDENT_NOT_FOUND', message: 'Không tìm thấy phiếu sự cố này.' });
    return (await this.hydrate([row]))[0];
  }

  /** Phiếu kèm cờ "người này ghi được không" — màn chi tiết ẩn ô tải bản ký theo cờ này. */
  async getFor(actor: IsoActor, id: string): Promise<IncidentRecord & { canWrite: boolean }> {
    const incident = await this.get(id);
    return { ...incident, canWrite: await this.canWrite(actor, incident) };
  }

  /** Luật ghi của một phiếu 0206 (Q-28): theo loại phiếu của các ô đã gắn; phiếu lập thẳng thì mọi tài khoản IT. */
  async canWrite(actor: IsoActor, incident: Pick<IncidentRecord, 'cells'>): Promise<boolean> {
    for (const form of new Set(incident.cells.map((c) => c.form))) {
      if (!(await this.access.canWrite(actor, form))) return false;
    }
    return true;
  }

  async assertCanWrite(actor: IsoActor, incident: Pick<IncidentRecord, 'cells'>): Promise<void> {
    await this.assertCellWriters(actor, incident.cells.map((c) => c.form));
  }

  async list(filters: IncidentListFilters): Promise<IncidentRecord[]> {
    const where = [eq(isoIncidentTable.year, filters.year)];
    if (filters.month) where.push(eq(isoIncidentTable.month, filters.month));
    if (filters.kind) where.push(eq(isoIncidentTable.kind, filters.kind));
    const rows = await this.db
      .select()
      .from(isoIncidentTable)
      .where(and(...where))
      .orderBy(desc(isoIncidentTable.month), desc(isoIncidentTable.code));
    let items = await this.hydrate(rows);
    if (filters.source) {
      items = items.filter((i) => sourceOf(i) === filters.source);
    }
    if (filters.signed) items = items.filter((i) => i.signedCurrent === (filters.signed === 'yes'));
    return items;
  }

  /** Phiếu của một tháng — luồng chốt kỳ lọc theo `governing`. */
  async ofMonth(year: number, month: number): Promise<IncidentRecord[]> {
    const rows = await this.db
      .select()
      .from(isoIncidentTable)
      .where(and(eq(isoIncidentTable.year, year), eq(isoIncidentTable.month, month)))
      .orderBy(asc(isoIncidentTable.code));
    return this.hydrate(rows);
  }

  async ofYear(year: number): Promise<IncidentRecord[]> {
    const rows = await this.db.select().from(isoIncidentTable).where(eq(isoIncidentTable.year, year));
    return this.hydrate(rows);
  }

  /**
   * Ô ✗ chưa có phiếu tới hôm nay. `year` lọc theo năm của ô; bỏ trống = mọi kỳ còn Đang ghi (danh
   * sách "gắn thêm ô ✗" của form 0206).
   */
  async unlinked(scope: { year?: number }): Promise<UnlinkedCell[]> {
    const today = await this.clock.today();
    // Tháng trước `iso.first_month` không mở được nữa (ISO_PERIOD_BEFORE_START): ô ở đó không ai gắn
    // được, để trong danh sách thì huy hiệu menu không bao giờ về 0.
    const from = `${await this.periods.firstMonth()}-01`;
    const backupRange = scope.year
      ? between(isoBackupTickTable.day, `${scope.year}-01-01`, `${scope.year}-12-31`)
      : between(isoBackupTickTable.day, from, today);
    const fails = await this.db
      .select({
        lineId: isoBackupTickTable.lineId,
        day: isoBackupTickTable.day,
        jobName: isoBackupJobTable.name,
        label: isoBackupLineTable.label,
      })
      .from(isoBackupTickTable)
      .innerJoin(isoBackupLineTable, eq(isoBackupLineTable.id, isoBackupTickTable.lineId))
      .innerJoin(isoBackupJobTable, eq(isoBackupJobTable.id, isoBackupLineTable.jobId))
      .leftJoin(
        isoIncidentCellTable,
        and(eq(isoIncidentCellTable.tickLineId, isoBackupTickTable.lineId), eq(isoIncidentCellTable.tickDay, isoBackupTickTable.day)),
      )
      .where(and(eq(isoBackupTickTable.result, 'fail'), isNull(isoIncidentCellTable.id), backupRange))
      .orderBy(asc(isoBackupTickTable.day), asc(isoBackupJobTable.no));
    const issueRange = scope.year
      ? between(isoAvIssueTable.reportedOn, `${scope.year}-01-01`, `${scope.year}-12-31`)
      : between(isoAvIssueTable.reportedOn, from, today);
    const issues = await this.db
      .select({
        id: isoAvIssueTable.id,
        day: isoAvIssueTable.reportedOn,
        division: isoDivisionTable.name,
        computer: isoAvIssueTable.computerName,
      })
      .from(isoAvIssueTable)
      .innerJoin(isoDivisionTable, eq(isoDivisionTable.id, isoAvIssueTable.divisionId))
      .leftJoin(isoIncidentCellTable, eq(isoIncidentCellTable.avIssueId, isoAvIssueTable.id))
      .where(and(isNull(isoIncidentCellTable.id), issueRange))
      .orderBy(asc(isoAvIssueTable.reportedOn));
    const cells: UnlinkedCell[] = [
      ...fails.map((f) => ({
        form: '0203' as const,
        lineId: f.lineId,
        day: f.day,
        issueId: null,
        label: backupLabel(f.jobName, f.label),
        ...monthOf(f.day),
      })),
      ...issues.map((i) => ({
        form: '0208' as const,
        lineId: null,
        day: i.day,
        issueId: i.id,
        label: `${i.division} · ${i.computer}`,
        ...monthOf(i.day),
      })),
    ];
    if (scope.year) return cells;
    // Chỉ ô của kỳ còn Đang ghi mới gắn thêm được.
    const states = await this.periods.statesOf(cells.map((c) => ({ formType: c.form, year: c.year, month: c.month })));
    return cells.filter((c) => states.get(stateKey(c.form, c.year, c.month)) === 'open');
  }

  /* ---------------------------------------------------------------- ghi --- */

  async create(actor: IsoActor, input: IncidentInput & { cells: CellInput[] }): Promise<IncidentRecord> {
    const content = this.checkContent(input);
    const { year, month } = await this.monthOfDetection(input.detectedAt);
    const today = await this.clock.today();
    await this.periods.assertAccessible(year, month, today);
    await this.assertCellWriters(actor, input.cells.map((c) => c.form));
    const id = await this.db.transaction(async (tx) => {
      await this.lockInputPeriodsWithin(tx, input.cells, year, month);
      const cells = await this.resolveCellsWithin(tx, input.cells, year, month);
      await this.lockCellPeriodsWithin(tx, cells);
      for (const form of incidentGoverning(cells, year, month)) await this.periods.assertOpenWithin(tx, form, year, month);
      const [counter] = await tx.execute<{ last_no: number }>(sql`
        INSERT INTO iso_incident_counter (year, last_no) VALUES (${year}, 1)
        ON CONFLICT (year) DO UPDATE SET last_no = iso_incident_counter.last_no + 1
        RETURNING last_no
      `).then((r) => r.rows);
      const code = incidentCode(year, Number(counter.last_no));
      const [row] = await tx
        .insert(isoIncidentTable)
        .values({ ...content, code, year, month, createdBy: actor.email })
        .returning();
      await this.insertCellsWithin(tx, row.id, cells);
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_incident.created',
        objectType: 'iso_incident',
        objectId: row.id,
        detail: { code, kind: row.kind, status: row.status, cells: cells.map(cellKey) },
      });
      return row.id;
    });
    return this.get(id);
  }

  async update(actor: IsoActor, id: string, input: IncidentInput & { cells: CellInput[] }): Promise<IncidentRecord> {
    const content = this.checkContent(input);
    const target = await this.monthOfDetection(input.detectedAt);
    const today = await this.clock.today();
    const before = await this.get(id);
    if (before.locked) throw lockedIncident(before.code);
    if (before.inReview) throw inReviewIncident(before.code);
    await this.assertCellWriters(actor, [...before.cells.map((c) => c.form), ...input.cells.map((c) => c.form)]);
    const moved = target.year !== before.year || target.month !== before.month;
    if (moved) await this.periods.assertAccessible(target.year, target.month, today);
    await this.db.transaction(async (tx) => {
      // `before` đọc ngoài transaction: ai sửa chen giữa thì phép kiểm khoá ở trên đã cũ.
      const [row] = await tx.select().from(isoIncidentTable).where(eq(isoIncidentTable.id, id)).for('update');
      if (row.contentUpdatedAt.getTime() !== before.contentUpdatedAt.getTime()) {
        throw new ConflictException({ code: 'ISO_INCIDENT_CHANGED', message: 'Phiếu vừa được người khác sửa. Tải lại rồi sửa tiếp.' });
      }
      // Đọc lại trạng thái kỳ quản phiếu dưới khoá FOR SHARE: lượt gửi chốt chen giữa thì phải chờ
      // lượt này xong, hoặc lượt này thấy kỳ đã sang Chờ duyệt.
      const states: PeriodState[] = [];
      for (const form of before.governing) states.push((await this.periods.lockWithin(tx, form, before.year, before.month, 'share')).state);
      if (incidentLocked(before.status, states)) throw lockedIncident(before.code);
      if (incidentInReview(before.status, states)) throw inReviewIncident(before.code);
      await this.lockInputPeriodsWithin(tx, input.cells, target.year, target.month);
      const wanted = await this.resolveCellsWithin(tx, input.cells, target.year, target.month, id);
      const keep = new Set(wanted.map(cellKey));
      const removed = before.cells.filter((c) => !keep.has(cellKey(c)));
      const had = new Set(before.cells.map(cellKey));
      const added = wanted.filter((c) => !had.has(cellKey(c)));
      // Gắn / bỏ gắn một ô là sửa kỳ của ô đó: kỳ phải còn Đang ghi.
      await this.lockCellPeriodsWithin(tx, [...removed, ...added]);
      // Phiếu ra / vào hồ sơ của một kỳ (đổi tháng, hoặc ô gắn đổi làm đổi loại phiếu quản nó) là sửa
      // kỳ đó, kể cả khi kỳ không còn ô nào của phiếu — kỳ đã chốt thì hồ sơ của nó không đổi được.
      const from = incidentGoverning(before.cells, before.year, before.month).map((f) => stateKey(f, before.year, before.month));
      const to = incidentGoverning(wanted, target.year, target.month).map((f) => stateKey(f, target.year, target.month));
      const touched = [...from.filter((k) => !to.includes(k)), ...to.filter((k) => !from.includes(k))].sort();
      for (const key of touched) {
        const [form, ym] = key.split('|');
        const { year, month } = monthOf(`${ym}-01`);
        await this.periods.assertOpenWithin(tx, form as IsoFormType, year, month);
      }
      if (removed.length > 0) {
        const current = await tx
          .select({ id: isoIncidentCellTable.id, lineId: isoIncidentCellTable.tickLineId, day: isoIncidentCellTable.tickDay, issueId: isoIncidentCellTable.avIssueId })
          .from(isoIncidentCellTable)
          .where(eq(isoIncidentCellTable.incidentId, id));
        const drop = current
          .filter((c) => !keep.has(cellKey({ form: c.issueId ? '0208' : '0203', lineId: c.lineId, day: c.day ?? '', issueId: c.issueId })))
          .map((c) => c.id);
        await tx.delete(isoIncidentCellTable).where(inArray(isoIncidentCellTable.id, drop));
      }
      await this.insertCellsWithin(tx, id, added);
      await tx
        .update(isoIncidentTable)
        .set({ ...content, year: target.year, month: target.month, updatedAt: new Date(), contentUpdatedAt: new Date() })
        .where(eq(isoIncidentTable.id, id));
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_incident.updated',
        objectType: 'iso_incident',
        objectId: id,
        detail: {
          code: before.code,
          from: { status: before.status, kind: before.kind, detectedAt: before.detectedAt, resolvedAt: before.resolvedAt },
          to: { status: content.status, kind: content.kind, detectedAt: input.detectedAt, resolvedAt: input.resolvedAt },
          cellsAdded: added.map(cellKey),
          cellsRemoved: removed.map(cellKey),
        },
      });
    });
    return this.get(id);
  }

  /* ----------------------------------------------------------- nội bộ --- */

  private checkContent(input: IncidentInput) {
    const errors = validateIncident(input);
    if (errors.length > 0) {
      throw new BadRequestException({ code: 'ISO_INCIDENT_INVALID', message: errors[0].message, errors });
    }
    return {
      reportedOn: input.reportedOn,
      kind: input.kind,
      detectedAt: new Date(input.detectedAt),
      resolvedAt: input.resolvedAt ? new Date(input.resolvedAt) : null,
      severity: input.severity,
      status: input.status,
      description: input.description.trim(),
      correctiveAction: input.correctiveAction.trim(),
      backupDetails: input.kind === 'backup' ? input.backupDetails : [],
    };
  }

  /** Phiếu thuộc kỳ của tháng chứa Detection Time theo giờ Việt Nam, không theo Date Report. */
  private async monthOfDetection(detectedAt: string): Promise<{ year: number; month: number }> {
    return monthOf(isoDateInTz(await this.clock.timeZone(), new Date(detectedAt)));
  }

  /** Ô 0203 theo quyền 0203, ô 0208 theo quyền 0208; phiếu lập thẳng thì mọi tài khoản IT (Q-28). */
  private async assertCellWriters(actor: IsoActor, forms: IsoFormType[]): Promise<void> {
    for (const form of new Set(forms)) await this.access.assertCanWrite(actor, form);
  }

  private async resolveCellsWithin(tx: Tx, input: CellInput[], year: number, month: number, selfId?: string): Promise<IncidentCell[]> {
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const seen = new Set<string>();
    const out: IncidentCell[] = [];
    for (const cell of input) {
      const key = cell.form === '0203' ? `0203|${cell.lineId}|${cell.day}` : `0208|${cell.issueId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let resolved: IncidentCell;
      let linkedTo: string | null;
      if (cell.form === '0203') {
        const [row] = await tx
          .select({
            result: isoBackupTickTable.result,
            jobName: isoBackupJobTable.name,
            label: isoBackupLineTable.label,
            linkedTo: isoIncidentCellTable.incidentId,
          })
          .from(isoBackupTickTable)
          .innerJoin(isoBackupLineTable, eq(isoBackupLineTable.id, isoBackupTickTable.lineId))
          .innerJoin(isoBackupJobTable, eq(isoBackupJobTable.id, isoBackupLineTable.jobId))
          .leftJoin(
            isoIncidentCellTable,
            and(eq(isoIncidentCellTable.tickLineId, isoBackupTickTable.lineId), eq(isoIncidentCellTable.tickDay, isoBackupTickTable.day)),
          )
          .where(and(eq(isoBackupTickTable.lineId, cell.lineId), eq(isoBackupTickTable.day, cell.day)))
          .for('update', { of: isoBackupTickTable });
        if (!row || row.result !== 'fail') {
          throw new BadRequestException({ code: 'ISO_CELL_NOT_FAIL', message: `Ô ngày ${viDate(cell.day)} không phải ô ✗ — chỉ gắn được ô Lỗi.` });
        }
        resolved = { form: '0203', lineId: cell.lineId, day: cell.day, issueId: null, label: backupLabel(row.jobName, row.label) };
        linkedTo = row.linkedTo;
      } else {
        const [row] = await tx
          .select({
            day: isoAvIssueTable.reportedOn,
            division: isoDivisionTable.name,
            computer: isoAvIssueTable.computerName,
            linkedTo: isoIncidentCellTable.incidentId,
          })
          .from(isoAvIssueTable)
          .innerJoin(isoDivisionTable, eq(isoDivisionTable.id, isoAvIssueTable.divisionId))
          .leftJoin(isoIncidentCellTable, eq(isoIncidentCellTable.avIssueId, isoAvIssueTable.id))
          .where(eq(isoAvIssueTable.id, cell.issueId))
          .for('update', { of: isoAvIssueTable });
        if (!row) throw new BadRequestException({ code: 'ISO_ISSUE_NOT_FOUND', message: 'Dòng issue 0208 được chọn không còn. Tải lại rồi chọn lại.' });
        resolved = { form: '0208', lineId: null, day: row.day, issueId: cell.issueId, label: `${row.division} · ${row.computer}` };
        linkedTo = row.linkedTo;
      }
      if (linkedTo && linkedTo !== selfId) {
        const [other] = await tx.select({ code: isoIncidentTable.code }).from(isoIncidentTable).where(eq(isoIncidentTable.id, linkedTo));
        throw new ConflictException({
          code: 'ISO_CELL_ALREADY_LINKED',
          message: `Ô ${resolved.label} · ${viDate(resolved.day)} đã gắn phiếu ${other?.code ?? 'khác'} — một ô chỉ một phiếu.`,
        });
      }
      if (resolved.day < firstDay) {
        throw new BadRequestException({
          code: 'ISO_CELL_BEFORE_INCIDENT',
          message: `Ô ngày ${viDate(resolved.day)} thuộc tháng trước Detection Time — sự cố tháng trước có phiếu của tháng đó.`,
        });
      }
      out.push(resolved);
    }
    return out;
  }

  /**
   * Khoá FOR SHARE các kỳ mà ô gửi lên có thể chạm TRƯỚC khi khoá hàng ô: `setTick` / `setMark` khoá
   * kỳ rồi mới khoá ô, nên khoá theo thứ tự ngược lại thì một lượt gửi chốt đang chờ FOR UPDATE kỳ có
   * thể khép vòng chờ (40P01). Chỉ khoá, chưa kiểm trạng thái — phần kiểm vẫn ở chỗ cũ.
   */
  private async lockInputPeriodsWithin(tx: Tx, input: CellInput[], year: number, month: number): Promise<void> {
    const keys = new Set<string>();
    const issueIds = input.flatMap((c) => (c.form === '0208' ? [c.issueId] : []));
    const issues = issueIds.length
      ? await tx.select({ day: isoAvIssueTable.reportedOn }).from(isoAvIssueTable).where(inArray(isoAvIssueTable.id, issueIds))
      : [];
    for (const c of input) {
      keys.add(`${c.form}|${monthKey(year, month)}`);
      if (c.form === '0203') keys.add(`0203|${c.day.slice(0, 7)}`);
    }
    for (const i of issues) keys.add(`0208|${i.day.slice(0, 7)}`);
    for (const key of [...keys].sort()) {
      const [form, ym] = key.split('|');
      const at = monthOf(`${ym}-01`);
      await this.periods.lockWithin(tx, form as IsoFormType, at.year, at.month, 'share');
    }
  }

  private async lockCellPeriodsWithin(tx: Tx, cells: IncidentCell[]): Promise<void> {
    const keys = [...new Set(cells.map((c) => `${c.form}|${c.day.slice(0, 7)}`))].sort();
    for (const key of keys) {
      const [form, ym] = key.split('|');
      const { year, month } = monthOf(`${ym}-01`);
      await this.periods.assertOpenWithin(tx, form as IsoFormType, year, month);
    }
  }

  private async insertCellsWithin(tx: Tx, incidentId: string, cells: IncidentCell[]): Promise<void> {
    if (cells.length === 0) return;
    await tx.insert(isoIncidentCellTable).values(
      cells.map((c) =>
        c.form === '0203'
          ? { incidentId, tickLineId: c.lineId, tickDay: c.day }
          : { incidentId, avIssueId: c.issueId },
      ),
    );
  }

  private async hydrate(rows: IncidentRow[]): Promise<IncidentRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const backup = await this.db
      .select({
        incidentId: isoIncidentCellTable.incidentId,
        lineId: isoIncidentCellTable.tickLineId,
        day: isoIncidentCellTable.tickDay,
        jobName: isoBackupJobTable.name,
        label: isoBackupLineTable.label,
      })
      .from(isoIncidentCellTable)
      .innerJoin(isoBackupLineTable, eq(isoBackupLineTable.id, isoIncidentCellTable.tickLineId))
      .innerJoin(isoBackupJobTable, eq(isoBackupJobTable.id, isoBackupLineTable.jobId))
      .where(and(inArray(isoIncidentCellTable.incidentId, ids), isNotNull(isoIncidentCellTable.tickLineId)));
    const av = await this.db
      .select({
        incidentId: isoIncidentCellTable.incidentId,
        issueId: isoAvIssueTable.id,
        day: isoAvIssueTable.reportedOn,
        division: isoDivisionTable.name,
        computer: isoAvIssueTable.computerName,
      })
      .from(isoIncidentCellTable)
      .innerJoin(isoAvIssueTable, eq(isoAvIssueTable.id, isoIncidentCellTable.avIssueId))
      .innerJoin(isoDivisionTable, eq(isoDivisionTable.id, isoAvIssueTable.divisionId))
      .where(inArray(isoIncidentCellTable.incidentId, ids));
    const cellsOf = new Map<string, IncidentCell[]>();
    for (const c of backup) {
      const list = cellsOf.get(c.incidentId) ?? [];
      list.push({ form: '0203', lineId: c.lineId, day: c.day!, issueId: null, label: backupLabel(c.jobName, c.label) });
      cellsOf.set(c.incidentId, list);
    }
    for (const c of av) {
      const list = cellsOf.get(c.incidentId) ?? [];
      list.push({ form: '0208', lineId: null, day: c.day, issueId: c.issueId, label: `${c.division} · ${c.computer}` });
      cellsOf.set(c.incidentId, list);
    }
    const governingOf = new Map(rows.map((r) => [r.id, incidentGoverning(cellsOf.get(r.id) ?? [], r.year, r.month)]));
    const states = await this.periods.statesOf(
      rows.flatMap((r) => governingOf.get(r.id)!.map((formType) => ({ formType, year: r.year, month: r.month }))),
    );
    const files = await this.files.listForOwners('iso_incident', ids);
    const names = await this.users.namesByEmails([...new Set(rows.map((r) => r.createdBy))]);
    return rows.map((r) => {
      const governing = governingOf.get(r.id)!;
      const governingStates = governing.map((f) => states.get(stateKey(f, r.year, r.month)) ?? 'open');
      const signed = files
        .filter((f) => f.ownerId === r.id)
        .map((f) => toSigned(f, r.contentUpdatedAt));
      return {
        id: r.id,
        code: r.code,
        year: r.year,
        month: r.month,
        reportedOn: r.reportedOn,
        kind: r.kind as IncidentRecord['kind'],
        detectedAt: r.detectedAt.toISOString(),
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
        severity: r.severity as IncidentRecord['severity'],
        status: r.status as IncidentStatus,
        description: r.description,
        correctiveAction: r.correctiveAction,
        backupDetails: r.backupDetails,
        createdBy: r.createdBy,
        createdByName: names.get(r.createdBy.toLowerCase()) ?? names.get(r.createdBy) ?? r.createdBy,
        createdAt: r.createdAt,
        contentUpdatedAt: r.contentUpdatedAt,
        cells: (cellsOf.get(r.id) ?? []).sort((a, b) => a.day.localeCompare(b.day)),
        governing,
        locked: incidentLocked(r.status as IncidentStatus, governingStates),
        inReview: incidentInReview(r.status as IncidentStatus, governingStates),
        signedCurrent: signed.some((f) => f.current),
        signed,
      };
    });
  }
}

export function sourceOf(incident: Pick<IncidentRecord, 'cells'>): 'backup' | 'antivirus' | 'direct' {
  if (incident.cells.some((c) => c.form === '0203')) return 'backup';
  if (incident.cells.some((c) => c.form === '0208')) return 'antivirus';
  return 'direct';
}

export function toSigned(file: FileRecord, since: Date | null): SignedFile {
  return {
    id: file.id,
    originalName: file.originalName,
    sizeBytes: file.sizeBytes,
    uploadedAt: file.createdAt,
    uploadedBy: file.uploadedBy,
    current: signedIsCurrent(file.createdAt, since),
  };
}

function backupLabel(jobName: string, label: string | null): string {
  return label ? `${jobName} › ${label}` : jobName;
}

function cellKey(cell: Pick<IncidentCell, 'form' | 'lineId' | 'day' | 'issueId'>): string {
  return cell.form === '0203' ? `0203|${cell.lineId}|${cell.day}` : `0208|${cell.issueId}`;
}

export function inReviewIncident(code: string) {
  return new ConflictException({
    code: 'ISO_INCIDENT_IN_REVIEW',
    message: `Kỳ của phiếu ${code} đang chờ SA/Admin duyệt — chỉ xem. Cần sửa thì nhờ SA/Admin trả lại kỳ.`,
  });
}

export function lockedIncident(code: string) {
  return new ConflictException({
    code: 'ISO_INCIDENT_LOCKED',
    message: `Phiếu ${code} đã khoá theo kỳ đã chốt — chỉ xem. Cần sửa thì xin mở lại kỳ ở Kỳ phiếu.`,
  });
}

