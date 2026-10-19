import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { conflictOnUnique, pgConstraint, pgErrorCode, PG_EXCLUSION_VIOLATION } from '../../common/sql';
import type { Tx } from '../../common/tx';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import type { IsoActor } from './iso-access.service';
import { isoBackupJobTable, isoBackupLineTable, isoBackupTickTable, isoDivisionTable } from './iso-forms.schema';
import { lockJobListWithin } from './iso-period.store';
import { viDate } from '../../common/today';

export interface JobLineInput {
  id?: string;
  label: string | null;
  pointsNas: string | null;
  storageNas: string | null;
  pointsCloud: string | null;
  storageCloud: string | null;
}

export interface JobInput {
  no: number;
  name: string;
  trackedFrom: string;
  lines: JobLineInput[];
}

export interface JobLine extends Required<Omit<JobLineInput, 'id'>> {
  id: string;
}

export interface Job {
  id: string;
  no: number;
  name: string;
  trackedFrom: string;
  stoppedOn: string | null;
  lines: JobLine[];
}

export interface Division {
  id: string;
  code: string | null;
  name: string;
  active: boolean;
}

/** Số dòng con tối đa của một job — mẫu giấy File Server D&E có 6, chừa rộng. */
const MAX_LINES = 20;
/** Số điểm lưu là số bản giữ lại trên kho — chữ lọt vào thì phiếu in ra không đọc được. */
const POINTS_RE = /^\d{1,4}$/;

function blankToNull(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/**
 * Hai danh sách IT tự quản (Q-28): job backup của 0203 và bộ phận của 0208. Thay đổi áp ngay cho
 * kỳ còn Đang ghi; kỳ từ Chờ duyệt trở đi đọc danh sách chụp lúc gửi chốt, nên ở đây không phải
 * hỏi kỳ nào đã khoá.
 */
@Injectable()
export class IsoCatalogService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
  ) {}

  /* ------------------------------------------------------------------ job --- */

  async jobs(status: 'live' | 'stopped' | 'all' = 'all'): Promise<Job[]> {
    const where =
      status === 'live'
        ? isNull(isoBackupJobTable.stoppedOn)
        : status === 'stopped'
          ? sql`${isoBackupJobTable.stoppedOn} IS NOT NULL`
          : undefined;
    const jobs = await this.db
      .select()
      .from(isoBackupJobTable)
      .where(where)
      .orderBy(sql`${isoBackupJobTable.stoppedOn} IS NOT NULL`, asc(isoBackupJobTable.no), asc(isoBackupJobTable.name));
    return this.withLines(jobs);
  }

  async job(id: string): Promise<Job> {
    const [row] = await this.db.select().from(isoBackupJobTable).where(eq(isoBackupJobTable.id, id));
    if (!row) throw new NotFoundException({ code: 'ISO_JOB_NOT_FOUND', message: 'Không tìm thấy job backup này.' });
    return (await this.withLines([row]))[0];
  }

  async createJob(actor: IsoActor, input: JobInput): Promise<Job> {
    const lines = this.normalizeLines(input.lines);
    const name = input.name.trim();
    const id = await this.db.transaction(async (tx) => {
      await lockJobListWithin(tx, 'shared');
      await this.assertNoFree(tx, input.no, null);
      const [job] = await this.guardLiveKeys(() =>
        tx
          .insert(isoBackupJobTable)
          .values({ no: input.no, name, trackedFrom: input.trackedFrom, createdBy: actor.email })
          .returning(),
      );
      await tx.insert(isoBackupLineTable).values(lines.map((line, i) => ({ ...line, jobId: job.id, sortOrder: i + 1 })));
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_job.created',
        objectType: 'iso_backup_job',
        objectId: job.id,
        detail: { no: input.no, name, trackedFrom: input.trackedFrom, lines: lines.map((l) => l.label) },
      });
      return job.id;
    });
    return this.job(id);
  }

  async updateJob(actor: IsoActor, id: string, input: JobInput): Promise<Job> {
    const lines = this.normalizeLines(input.lines);
    const name = input.name.trim();
    await this.db.transaction(async (tx) => {
      await lockJobListWithin(tx, 'shared');
      const [before] = await tx.select().from(isoBackupJobTable).where(eq(isoBackupJobTable.id, id)).for('update');
      if (!before) throw new NotFoundException({ code: 'ISO_JOB_NOT_FOUND', message: 'Không tìm thấy job backup này.' });
      if (before.stoppedOn === null) await this.assertNoFree(tx, input.no, id);
      if (before.stoppedOn !== null && input.trackedFrom > before.stoppedOn) {
        throw new BadRequestException({ code: 'ISO_JOB_DATES', message: 'Ngày bắt đầu theo dõi phải trước ngày ngừng.' });
      }
      const current = await tx.select().from(isoBackupLineTable).where(eq(isoBackupLineTable.jobId, id));
      const currentIds = new Set(current.map((l) => l.id));
      for (const line of input.lines) {
        if (line.id && !currentIds.has(line.id)) {
          throw new BadRequestException({ code: 'ISO_LINE_NOT_OF_JOB', message: 'Đối tượng con không thuộc job này. Tải lại rồi sửa lại.' });
        }
      }
      if (input.trackedFrom > before.trackedFrom && current.length > 0) {
        const [early] = await tx
          .select({ day: isoBackupTickTable.day })
          .from(isoBackupTickTable)
          .where(and(inArray(isoBackupTickTable.lineId, [...currentIds]), lt(isoBackupTickTable.day, input.trackedFrom)))
          .limit(1);
        if (early) {
          throw new ConflictException({
            code: 'ISO_JOB_HAS_EARLIER_TICKS',
            message: `Job đã có ô đánh ngày ${viDate(early.day)} — không dời ngày bắt đầu theo dõi qua ngày đó được.`,
          });
        }
      }
      const keep = new Set(input.lines.map((l) => l.id).filter((v): v is string => Boolean(v)));
      const removed = current.filter((l) => !keep.has(l.id));
      if (removed.length > 0) {
        const [used] = await tx
          .select({ lineId: isoBackupTickTable.lineId })
          .from(isoBackupTickTable)
          .where(inArray(isoBackupTickTable.lineId, removed.map((l) => l.id)))
          .limit(1);
        if (used) {
          const label = removed.find((l) => l.id === used.lineId)?.label ?? name;
          throw new ConflictException({
            code: 'ISO_LINE_HAS_TICKS',
            message: `"${label}" đã có ô đánh trên phiếu — không xoá được. Không theo dõi nữa thì ngừng cả job.`,
          });
        }
        await tx.delete(isoBackupLineTable).where(inArray(isoBackupLineTable.id, removed.map((l) => l.id)));
      }
      for (const [i, line] of lines.entries()) {
        const id0 = input.lines[i].id;
        if (id0) {
          await tx.update(isoBackupLineTable).set({ ...line, sortOrder: i + 1 }).where(eq(isoBackupLineTable.id, id0));
        } else {
          await tx.insert(isoBackupLineTable).values({ ...line, jobId: id, sortOrder: i + 1 });
        }
      }
      await this.guardLiveKeys(() =>
        tx
          .update(isoBackupJobTable)
          .set({ no: input.no, name, trackedFrom: input.trackedFrom, updatedAt: new Date() })
          .where(eq(isoBackupJobTable.id, id)),
      );
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_job.updated',
        objectType: 'iso_backup_job',
        objectId: id,
        detail: {
          from: { no: before.no, name: before.name, trackedFrom: before.trackedFrom, lines: current.map((l) => l.label) },
          to: { no: input.no, name, trackedFrom: input.trackedFrom, lines: lines.map((l) => l.label) },
        },
      });
    });
    return this.job(id);
  }

  /** Ngừng theo dõi từ sau ngày `stoppedOn`: ô các ngày sau đó để trống, không tính bỏ sót. */
  async stopJob(actor: IsoActor, id: string, stoppedOn: string): Promise<Job> {
    await this.db.transaction(async (tx) => {
      await lockJobListWithin(tx, 'shared');
      const [job] = await tx.select().from(isoBackupJobTable).where(eq(isoBackupJobTable.id, id)).for('update');
      if (!job) throw new NotFoundException({ code: 'ISO_JOB_NOT_FOUND', message: 'Không tìm thấy job backup này.' });
      if (job.stoppedOn !== null) throw new ConflictException({ code: 'ISO_JOB_ALREADY_STOPPED', message: 'Job này đã ngừng theo dõi.' });
      if (stoppedOn < job.trackedFrom) {
        throw new BadRequestException({ code: 'ISO_JOB_DATES', message: 'Ngày ngừng phải từ ngày bắt đầu theo dõi trở đi.' });
      }
      const lineIds = (await tx.select({ id: isoBackupLineTable.id }).from(isoBackupLineTable).where(eq(isoBackupLineTable.jobId, id))).map((l) => l.id);
      if (lineIds.length > 0) {
        const [late] = await tx
          .select({ day: isoBackupTickTable.day })
          .from(isoBackupTickTable)
          .where(and(inArray(isoBackupTickTable.lineId, lineIds), gt(isoBackupTickTable.day, stoppedOn)))
          .limit(1);
        if (late) {
          throw new ConflictException({
            code: 'ISO_JOB_HAS_LATER_TICKS',
            message: `Job đã có ô đánh ngày ${viDate(late.day)} — chọn ngày ngừng từ ngày đó trở đi.`,
          });
        }
      }
      await tx.update(isoBackupJobTable).set({ stoppedOn, updatedAt: new Date() }).where(eq(isoBackupJobTable.id, id));
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_job.stopped',
        objectType: 'iso_backup_job',
        objectId: id,
        detail: { name: job.name, stoppedOn },
      });
    });
    return this.job(id);
  }

  async resumeJob(actor: IsoActor, id: string): Promise<Job> {
    await this.db.transaction(async (tx) => {
      await lockJobListWithin(tx, 'shared');
      const [job] = await tx.select().from(isoBackupJobTable).where(eq(isoBackupJobTable.id, id)).for('update');
      if (!job) throw new NotFoundException({ code: 'ISO_JOB_NOT_FOUND', message: 'Không tìm thấy job backup này.' });
      if (job.stoppedOn === null) throw new ConflictException({ code: 'ISO_JOB_NOT_STOPPED', message: 'Job này đang theo dõi.' });
      await this.assertNoFree(tx, job.no, id);
      await this.guardLiveKeys(() =>
        tx.update(isoBackupJobTable).set({ stoppedOn: null, updatedAt: new Date() }).where(eq(isoBackupJobTable.id, id)),
      );
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_job.resumed',
        objectType: 'iso_backup_job',
        objectId: id,
        detail: { name: job.name, stoppedOn: job.stoppedOn },
      });
    });
    return this.job(id);
  }

  /** Đổi thứ tự in trên phiếu: đổi số No với job đang theo dõi đứng liền trên / dưới. */
  async moveJob(actor: IsoActor, id: string, direction: 'up' | 'down'): Promise<Job[]> {
    await this.db.transaction(async (tx) => {
      await lockJobListWithin(tx, 'shared');
      const live = await tx
        .select()
        .from(isoBackupJobTable)
        .where(isNull(isoBackupJobTable.stoppedOn))
        .orderBy(asc(isoBackupJobTable.no), asc(isoBackupJobTable.name))
        .for('update');
      const at = live.findIndex((j) => j.id === id);
      if (at < 0) throw new NotFoundException({ code: 'ISO_JOB_NOT_FOUND', message: 'Chỉ sắp thứ tự job đang theo dõi.' });
      const other = live[direction === 'up' ? at - 1 : at + 1];
      if (!other) return;
      const me = live[at];
      // Tráo số hai hàng: giữa hai câu UPDATE có lúc hai job cùng số, nên hoãn kiểm tới commit.
      await tx.execute(sql`SET CONSTRAINTS iso_backup_job_live_no_excl DEFERRED`);
      await tx.update(isoBackupJobTable).set({ no: other.no, updatedAt: new Date() }).where(eq(isoBackupJobTable.id, me.id));
      await tx.update(isoBackupJobTable).set({ no: me.no, updatedAt: new Date() }).where(eq(isoBackupJobTable.id, other.id));
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_job.moved',
        objectType: 'iso_backup_job',
        objectId: me.id,
        detail: { name: me.name, from: me.no, to: other.no, swappedWith: other.name },
      });
    });
    return this.jobs('all');
  }

  private normalizeLines(lines: JobLineInput[]): Omit<JobLine, 'id'>[] {
    if (lines.length === 0) {
      throw new BadRequestException({ code: 'ISO_JOB_NO_LINES', message: 'Job phải có ít nhất một dòng.' });
    }
    if (lines.length > MAX_LINES) {
      throw new BadRequestException({ code: 'ISO_JOB_TOO_MANY_LINES', message: `Một job tối đa ${MAX_LINES} đối tượng con.` });
    }
    const out = lines.map((line) => ({
      label: blankToNull(line.label),
      pointsNas: blankToNull(line.pointsNas),
      storageNas: blankToNull(line.storageNas),
      pointsCloud: blankToNull(line.pointsCloud),
      storageCloud: blankToNull(line.storageCloud),
    }));
    if (out.some((l) => [l.pointsNas, l.pointsCloud].some((p) => p !== null && !POINTS_RE.test(p)))) {
      throw new BadRequestException({ code: 'ISO_JOB_POINTS', message: 'Points NAS và Points Cloud chỉ nhận số nguyên (0–9999).' });
    }
    if (out.length > 1 && out.some((l) => !l.label)) {
      throw new BadRequestException({
        code: 'ISO_JOB_LINE_LABEL',
        message: 'Job có nhiều đối tượng con thì mỗi đối tượng phải có tên.',
      });
    }
    return out;
  }

  /** Số No chỉ trùng được với job đã ngừng: phiếu in theo No, hai dòng cùng số thì đọc sai. */
  private async assertNoFree(tx: Tx, no: number, selfId: string | null): Promise<void> {
    const where = selfId
      ? and(eq(isoBackupJobTable.no, no), isNull(isoBackupJobTable.stoppedOn), ne(isoBackupJobTable.id, selfId))
      : and(eq(isoBackupJobTable.no, no), isNull(isoBackupJobTable.stoppedOn));
    const [taken] = await tx.select({ name: isoBackupJobTable.name }).from(isoBackupJobTable).where(where).limit(1);
    if (taken) {
      throw new ConflictException({ code: 'ISO_JOB_NO_TAKEN', message: `Số ${no} đang là của job "${taken.name}". Chọn số khác.` });
    }
  }

  /** Tên và số No chỉ duy nhất trong danh sách đang theo dõi; DB chặn khi hai lượt ghi chen nhau. */
  private async guardLiveKeys<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION && pgConstraint(error) === 'iso_backup_job_live_no_excl') {
        throw new ConflictException({ code: 'ISO_JOB_NO_TAKEN', message: 'Số này vừa được gán cho job khác. Tải lại rồi chọn số khác.' });
      }
      throw conflictOnUnique(
        error,
        { code: 'ISO_JOB_NAME_TAKEN', message: 'Đã có job đang theo dõi trùng tên này.' },
        'iso_backup_job_live_name_key',
      );
    }
  }

  private async withLines(jobs: (typeof isoBackupJobTable.$inferSelect)[]): Promise<Job[]> {
    if (jobs.length === 0) return [];
    const lines = await this.db
      .select()
      .from(isoBackupLineTable)
      .where(inArray(isoBackupLineTable.jobId, jobs.map((j) => j.id)))
      .orderBy(asc(isoBackupLineTable.sortOrder));
    return jobs.map((job) => ({
      id: job.id,
      no: job.no,
      name: job.name,
      trackedFrom: job.trackedFrom,
      stoppedOn: job.stoppedOn,
      lines: lines
        .filter((l) => l.jobId === job.id)
        .map((l) => ({
          id: l.id,
          label: l.label,
          pointsNas: l.pointsNas,
          storageNas: l.storageNas,
          pointsCloud: l.pointsCloud,
          storageCloud: l.storageCloud,
        })),
    }));
  }

  /* ------------------------------------------------------------- bộ phận --- */

  async divisions(): Promise<Division[]> {
    return this.db
      .select({ id: isoDivisionTable.id, code: isoDivisionTable.code, name: isoDivisionTable.name, active: isoDivisionTable.active })
      .from(isoDivisionTable)
      .orderBy(sql`NOT ${isoDivisionTable.active}`, asc(isoDivisionTable.name));
  }

  async createDivision(actor: IsoActor, input: { code: string | null; name: string }): Promise<Division> {
    return this.db.transaction((tx) => this.createDivisionWithin(tx, actor, input));
  }

  /** Cũng dùng khi ghi issue 0208 với "+ Bộ phận mới": thêm bộ phận và dòng issue trong CÙNG transaction. */
  async createDivisionWithin(tx: Tx, actor: IsoActor, input: { code: string | null; name: string }): Promise<Division> {
    const name = input.name.trim();
    const [row] = await this.guardDivision(() =>
      tx.insert(isoDivisionTable).values({ code: blankToNull(input.code), name }).returning(),
    );
    await this.audit.appendWithin(tx, {
      actor: actor.email,
      action: 'iso_division.created',
      objectType: 'iso_division',
      objectId: row.id,
      detail: { code: row.code, name: row.name },
    });
    return { id: row.id, code: row.code, name: row.name, active: row.active };
  }

  async updateDivision(actor: IsoActor, id: string, input: { code: string | null; name: string; active: boolean }): Promise<Division> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(isoDivisionTable).where(eq(isoDivisionTable.id, id)).for('update');
      if (!before) throw new NotFoundException({ code: 'ISO_DIVISION_NOT_FOUND', message: 'Không tìm thấy bộ phận này.' });
      const [row] = await this.guardDivision(() =>
        tx
          .update(isoDivisionTable)
          .set({ code: blankToNull(input.code), name: input.name.trim(), active: input.active, updatedAt: new Date() })
          .where(eq(isoDivisionTable.id, id))
          .returning(),
      );
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_division.updated',
        objectType: 'iso_division',
        objectId: id,
        detail: {
          from: { code: before.code, name: before.name, active: before.active },
          to: { code: row.code, name: row.name, active: row.active },
        },
      });
      return { id: row.id, code: row.code, name: row.name, active: row.active };
    });
  }

  private async guardDivision<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      throw conflictOnUnique(
        error,
        { code: 'ISO_DIVISION_NAME_TAKEN', message: 'Đã có bộ phận trùng tên này.' },
        'iso_division_name_key',
      );
    }
  }
}
