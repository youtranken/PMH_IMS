import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../../common/tx';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { SystemConfigService } from '../config-sys/system-config.service';
import { isoPeriodTable } from './iso-forms.schema';
import { monthKey, pad2, periodAccess, type IsoFormType, type PeriodState } from './iso-rules';

export type PeriodRow = typeof isoPeriodTable.$inferSelect;

export const PERIOD_STATE_LABEL: Record<PeriodState | 'done', string> = {
  open: 'Đang ghi',
  pending: 'Chờ duyệt',
  locked: 'Đã chốt · chờ bản ký',
  done: 'Hoàn tất',
};

export function periodLabel(formType: string, year: number, month: number): string {
  return `${formType} · ${pad2(month)}/${year}`;
}

/**
 * Trạng thái kỳ và khoá kỳ — tầng dưới cùng mà lưới 0203, 0208, phiếu 0206 và luồng chốt kỳ đều
 * đọc. Kỳ không có hàng là Đang ghi.
 *
 * Mọi lượt ghi vào ô của một kỳ phải đi qua `assertOpenWithin` TRONG transaction ghi: nó tạo hàng
 * nếu chưa có rồi khoá `FOR SHARE`, nên lượt gửi chốt (`FOR UPDATE` cùng hàng) phải chờ lượt ghi
 * xong và ngược lại — không có ô nào lọt vào sau khi kỳ đã sang Chờ duyệt.
 */
@Injectable()
export class IsoPeriodStore {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly config: SystemConfigService,
  ) {}

  async firstMonth(): Promise<string> {
    return this.config.getString('isoFirstMonth');
  }

  /** Ném khi tháng chưa tới hoặc trước tháng bắt đầu dùng IMS (Q-28). */
  async assertAccessible(year: number, month: number, today: string): Promise<void> {
    const access = periodAccess(year, month, today, await this.firstMonth());
    if (access === 'future') {
      throw new BadRequestException({
        code: 'ISO_PERIOD_FUTURE',
        message: `Kỳ ${pad2(month)}/${year} chưa tới — chỉ mở được tháng hiện tại và tháng đã qua.`,
      });
    }
    if (access === 'before_start') {
      throw new BadRequestException({
        code: 'ISO_PERIOD_BEFORE_START',
        message: `Kỳ ${pad2(month)}/${year} trước khi phiếu ISO chuyển lên IMS — phiếu tháng đó là bản giấy.`,
      });
    }
  }

  async find(formType: IsoFormType, year: number, month: number): Promise<PeriodRow | null> {
    const [row] = await this.db
      .select()
      .from(isoPeriodTable)
      .where(and(eq(isoPeriodTable.formType, formType), eq(isoPeriodTable.year, year), eq(isoPeriodTable.month, month)));
    return row ?? null;
  }

  async findById(id: string): Promise<PeriodRow | null> {
    const [row] = await this.db.select().from(isoPeriodTable).where(eq(isoPeriodTable.id, id));
    return row ?? null;
  }

  async ofYear(year: number): Promise<PeriodRow[]> {
    return this.db.select().from(isoPeriodTable).where(eq(isoPeriodTable.year, year));
  }

  /** Mọi kỳ Đã chốt, không kể năm: kỳ tháng 12 chưa có bản ký vẫn là việc tồn sang năm sau. */
  async allLocked(): Promise<PeriodRow[]> {
    return this.db.select().from(isoPeriodTable).where(eq(isoPeriodTable.state, 'locked'));
  }

  /** Trạng thái của nhiều kỳ một lượt; kỳ không có hàng là `open`. Khoá `form|YYYY-MM`. */
  async statesOf(keys: { formType: IsoFormType; year: number; month: number }[], tx?: Tx): Promise<Map<string, PeriodState>> {
    const out = new Map<string, PeriodState>();
    if (keys.length === 0) return out;
    const years = [...new Set(keys.map((k) => k.year))];
    const rows = await (tx ?? this.db)
      .select({ formType: isoPeriodTable.formType, year: isoPeriodTable.year, month: isoPeriodTable.month, state: isoPeriodTable.state })
      .from(isoPeriodTable)
      .where(inArray(isoPeriodTable.year, years));
    const byKey = new Map(rows.map((r) => [stateKey(r.formType as IsoFormType, r.year, r.month), r.state]));
    for (const k of keys) {
      const key = stateKey(k.formType, k.year, k.month);
      out.set(key, byKey.get(key) ?? 'open');
    }
    return out;
  }

  /** Tạo hàng nếu chưa có rồi khoá. `update` cho lượt đổi trạng thái kỳ, `share` cho lượt ghi ô. */
  async lockWithin(tx: Tx, formType: IsoFormType, year: number, month: number, mode: 'share' | 'update'): Promise<PeriodRow> {
    await tx.execute(sql`
      INSERT INTO iso_period (form_type, year, month) VALUES (${formType}, ${year}, ${month})
      ON CONFLICT (form_type, year, month) DO NOTHING
    `);
    const query = tx
      .select()
      .from(isoPeriodTable)
      .where(and(eq(isoPeriodTable.formType, formType), eq(isoPeriodTable.year, year), eq(isoPeriodTable.month, month)));
    const [row] = await (mode === 'update' ? query.for('update') : query.for('share'));
    return row;
  }

  async assertOpenWithin(tx: Tx, formType: IsoFormType, year: number, month: number): Promise<PeriodRow> {
    const row = await this.lockWithin(tx, formType, year, month, 'share');
    if (row.state !== 'open') throw lockedPeriod(formType, year, month, row.state);
    return row;
  }
}

export function stateKey(formType: IsoFormType, year: number, month: number): string {
  return `${formType}|${monthKey(year, month)}`;
}

export function lockedPeriod(formType: string, year: number, month: number, state: PeriodState): ConflictException {
  return new ConflictException({
    code: 'ISO_PERIOD_LOCKED',
    message: `Kỳ ${periodLabel(formType, year, month)} đang ở trạng thái "${PERIOD_STATE_LABEL[state]}" — chỉ xem. Cần sửa thì xin mở lại ở Kỳ phiếu.`,
  });
}
