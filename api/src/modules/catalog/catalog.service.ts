import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { pageOffset, type Page, type PageQuery } from '../../common/pagination';
import {
  escapeLike,
  pgErrorCode,
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from '../../common/sql';
import { AuditWriterService } from '../audit/audit-writer.service';
import {
  cabinetTable,
  catalogHistoryTable,
  deviceTypeTable,
  siteTable,
  vendorTable,
} from './catalog.schema';
import {
  normalizeKey,
  type CabinetRecord,
  type CatalogEntity,
  type CatalogHistoryRecord,
  type CatalogRecord,
  type CatalogSnapshot,
  type DeviceTypeRecord,
  type SiteRecord,
  type VendorRecord,
} from './catalog.types';

export interface CatalogLists {
  sites: SiteRecord[];
  cabinets: CabinetRecord[];
  deviceTypes: DeviceTypeRecord[];
  vendors: VendorRecord[];
}

export interface CatalogInput {
  code?: string;
  name?: string;
  address?: string | null;
  siteId?: string;
  description?: string | null;
  uHeight?: number | null;
  hasPortMap?: boolean;
  supplies?: string | null;
  phone?: string | null;
  contact?: string | null;
}

/**
 * Chủ sở hữu bốn bảng danh mục + `catalog_history` (AD-3).
 * Module khác KHÔNG query các bảng này — đi qua `CatalogApiService` (AD-2).
 * Mọi hàm ghi nhận `tx` tường minh hoặc tự mở transaction bao trọn audit + lịch sử (AD-5).
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
  ) {}

  // ─────────────────────────── Đọc ───────────────────────────

  /** Bốn danh sách đầy đủ để đổ vào ô chọn của form thiết bị và để sinh file mẫu. */
  async lists(options: { includeInactive?: boolean } = {}): Promise<CatalogLists> {
    const onlyActive = options.includeInactive !== true;
    const [sites, cabinets, deviceTypes, vendors] = await Promise.all([
      this.db
        .select()
        .from(siteTable)
        .where(onlyActive ? eq(siteTable.active, true) : undefined)
        .orderBy(asc(siteTable.code)),
      this.db
        .select({ cabinet: cabinetTable, siteCode: siteTable.code })
        .from(cabinetTable)
        .innerJoin(siteTable, eq(cabinetTable.siteId, siteTable.id))
        .where(onlyActive ? eq(cabinetTable.active, true) : undefined)
        .orderBy(asc(siteTable.code), asc(cabinetTable.code)),
      this.db
        .select()
        .from(deviceTypeTable)
        .where(onlyActive ? eq(deviceTypeTable.active, true) : undefined)
        .orderBy(asc(deviceTypeTable.name)),
      this.db
        .select()
        .from(vendorTable)
        .where(onlyActive ? eq(vendorTable.active, true) : undefined)
        .orderBy(asc(vendorTable.name)),
    ]);
    return {
      sites,
      cabinets: cabinets.map((r) => ({ ...r.cabinet, siteCode: r.siteCode })),
      deviceTypes,
      vendors,
    };
  }

  /** Danh sách phân trang cho màn quản trị — hiện CẢ mục đã vô hiệu (có cột trạng thái). */
  async list(
    entity: CatalogEntity,
    query: PageQuery,
    search?: string,
  ): Promise<Page<CatalogRecord>> {
    const term = search?.trim();
    const like = term ? `%${escapeLike(term)}%` : null;

    if (entity === 'cabinet') {
      const where = like
        ? or(
            sql`${cabinetTable.code}::text ILIKE ${like}`,
            ilike(cabinetTable.description, like),
            sql`${siteTable.code}::text ILIKE ${like}`,
          )
        : undefined;
      const [rows, totalRows] = await Promise.all([
        this.db
          .select({ cabinet: cabinetTable, siteCode: siteTable.code })
          .from(cabinetTable)
          .innerJoin(siteTable, eq(cabinetTable.siteId, siteTable.id))
          .where(where)
          .orderBy(asc(siteTable.code), asc(cabinetTable.code))
          .limit(query.limit)
          .offset(pageOffset(query)),
        this.db
          .select({ value: count() })
          .from(cabinetTable)
          .innerJoin(siteTable, eq(cabinetTable.siteId, siteTable.id))
          .where(where),
      ]);
      return {
        items: rows.map((r) => ({ ...r.cabinet, siteCode: r.siteCode })),
        total: Number(totalRows[0]?.value ?? 0),
      };
    }

    const table = tableOf(entity);
    const labelColumn = entity === 'site' ? siteTable.code : nameColumn(entity);
    const where = like
      ? entity === 'site'
        ? or(sql`${siteTable.code}::text ILIKE ${like}`, ilike(siteTable.name, like))
        : sql`${labelColumn}::text ILIKE ${like}`
      : undefined;
    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(table)
        .where(where)
        .orderBy(asc(labelColumn))
        .limit(query.limit)
        .offset(pageOffset(query)),
      this.db.select({ value: count() }).from(table).where(where),
    ]);
    return {
      items: rows as unknown as CatalogRecord[],
      total: Number(totalRows[0]?.value ?? 0),
    };
  }

  /** Ảnh chụp để đối chiếu file import — khóa đã chuẩn hóa (`normalizeKey`). */
  async snapshot(): Promise<CatalogSnapshot> {
    const lists = await this.lists({ includeInactive: true });
    return {
      sites: new Map(lists.sites.map((s) => [normalizeKey(s.code), s])),
      cabinets: new Map(
        lists.cabinets.map((c) => [
          `${normalizeKey(c.siteCode)} ${normalizeKey(c.code)}`,
          c,
        ]),
      ),
      deviceTypes: new Map(lists.deviceTypes.map((t) => [normalizeKey(t.name), t])),
      vendors: new Map(lists.vendors.map((v) => [normalizeKey(v.name), v])),
    };
  }

  async history(entity: CatalogEntity, entityId: string): Promise<CatalogHistoryRecord[]> {
    const rows = await this.db
      .select()
      .from(catalogHistoryTable)
      .where(
        and(
          eq(catalogHistoryTable.entity, entity),
          eq(catalogHistoryTable.entityId, entityId),
        ),
      )
      .orderBy(desc(catalogHistoryTable.createdAt))
      .limit(100);
    return rows as CatalogHistoryRecord[];
  }

  // ─────────────────────────── Ghi ───────────────────────────

  async create(
    actor: string,
    entity: CatalogEntity,
    input: CatalogInput,
  ): Promise<CatalogRecord> {
    const values = await this.toRow(entity, input);
    return this.db.transaction(async (tx) => {
      const created = await this.insertWithin(tx, entity, values);
      await this.recordWithin(tx, actor, entity, created.id, 'created', values);
      return created;
    });
  }

  async update(
    actor: string,
    entity: CatalogEntity,
    id: string,
    input: CatalogInput,
  ): Promise<CatalogRecord> {
    const before = await this.requireOne(entity, id);
    const values = await this.toRow(entity, input);
    return this.db.transaction(async (tx) => {
      const updated = await this.updateWithin(tx, entity, id, values);
      await this.recordWithin(tx, actor, entity, id, 'updated', {
        before: pickChanged(before, values),
        after: values,
      });
      return updated;
    });
  }

  /**
   * Vô hiệu / bật lại. AC 2.1: mục đang được thiết bị tham chiếu KHÔNG xóa được —
   * vô hiệu là đường ra: mục biến khỏi ô chọn nhưng hồ sơ cũ vẫn đọc được đúng tên.
   */
  async setActive(
    actor: string,
    entity: CatalogEntity,
    id: string,
    active: boolean,
  ): Promise<void> {
    await this.requireOne(entity, id);
    await this.db.transaction(async (tx) => {
      await this.updateWithin(tx, entity, id, { active });
      await this.recordWithin(
        tx,
        actor,
        entity,
        id,
        active ? 'activated' : 'deactivated',
        {},
      );
    });
  }

  /**
   * Xóa hẳn — CHỈ khi chưa ai tham chiếu tới. Không tự đi đếm bên `devices` được vì tầng nền
   * không được biết tầng nghiệp vụ (AD-2); để khóa ngoại ON DELETE RESTRICT của Postgres chặn
   * rồi dịch mã lỗi 23503 thành câu tiếng Việt.
   */
  async remove(actor: string, entity: CatalogEntity, id: string): Promise<void> {
    const existing = await this.requireOne(entity, id);
    try {
      await this.db.transaction(async (tx) => {
        // Lịch sử ghi TRƯỚC: bảng append-only nên không có FK trỏ ngược lại bản ghi bị xóa,
        // vết vẫn còn sau khi mục biến mất.
        await this.recordWithin(tx, actor, entity, id, 'deleted', {
          label: labelOf(entity, existing),
        });
        await tx.delete(tableOf(entity)).where(eq(tableOf(entity).id, id));
      });
    } catch (error) {
      if (pgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION) {
        throw new ConflictException({
          code: 'CATALOG_IN_USE',
          message:
            'Mục này đang được dữ liệu khác tham chiếu nên không xóa được. Hãy VÔ HIỆU HÓA để nó biến khỏi ô chọn mà hồ sơ cũ vẫn đọc được.',
        });
      }
      throw error;
    }
  }

  /**
   * Ghi cả file import trong MỘT transaction (AC 2.1): lỗi giữa chừng rollback sạch,
   * không để lại nửa danh mục. Site ghi trước tủ vì tủ tham chiếu site vừa tạo.
   */
  async applyImportWithin(
    tx: Tx,
    actor: string,
    rows: {
      sheet: CatalogEntity;
      action: 'create' | 'update';
      values: Record<string, unknown>;
      existingId?: string;
    }[],
  ): Promise<{ created: number; updated: number }> {
    // Mã site (đã chuẩn hóa) → id, gồm cả site vừa tạo trong chính lần import này.
    const siteIds = new Map<string, string>();
    const existingSites = await tx.select().from(siteTable);
    for (const site of existingSites) siteIds.set(normalizeKey(site.code), site.id);

    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const values: Record<string, unknown> = { ...row.values };
      if (row.sheet === 'cabinet') {
        const siteKey = String(values.siteKey);
        const siteId = siteIds.get(siteKey);
        if (!siteId) {
          // Không xảy ra nếu bảng đối chiếu đúng — nhưng file có thể đã đổi giữa xem trước
          // và xác nhận, nên vẫn phải chặn tường minh thay vì ghi NULL.
          throw new BadRequestException({
            code: 'CATALOG_SITE_MISSING',
            message: `Không tìm thấy site "${String(values.siteCode)}" khi ghi tủ "${String(values.code)}". Hãy xem lại bảng đối chiếu.`,
          });
        }
        values.siteId = siteId;
        delete values.siteKey;
        delete values.siteCode;
      }

      if (row.action === 'create') {
        const inserted = await this.insertWithin(tx, row.sheet, values);
        created += 1;
        if (row.sheet === 'site') {
          siteIds.set(normalizeKey(String(values.code)), inserted.id);
        }
        await this.recordWithin(tx, actor, row.sheet, inserted.id, 'imported', values);
      } else {
        await this.updateWithin(tx, row.sheet, row.existingId!, values);
        updated += 1;
        await this.recordWithin(
          tx,
          actor,
          row.sheet,
          row.existingId!,
          'imported-update',
          values,
        );
      }
    }
    return { created, updated };
  }

  /** Dùng chung cho import (đã có tx bao ngoài) và cho CRUD lẻ. */
  async recordWithin(
    tx: Tx,
    actor: string,
    entity: CatalogEntity,
    entityId: string,
    action: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(catalogHistoryTable).values({ entity, entityId, action, actor, changes });
    await this.audit.appendWithin(tx, {
      actor,
      action: `catalog.${entity}.${action}`,
      objectType: entity,
      objectId: entityId,
      detail: changes,
    });
  }

  // ─────────────────────────── Nội bộ ───────────────────────────

  private async insertWithin(
    tx: Tx,
    entity: CatalogEntity,
    values: Record<string, unknown>,
  ): Promise<CatalogRecord & { id: string }> {
    try {
      const rows = await tx
        .insert(tableOf(entity))
        .values(values as never)
        .returning();
      return rows[0] as unknown as CatalogRecord & { id: string };
    } catch (error) {
      throw this.translateWriteError(error, entity);
    }
  }

  private async updateWithin(
    tx: Tx,
    entity: CatalogEntity,
    id: string,
    values: Record<string, unknown>,
  ): Promise<CatalogRecord> {
    try {
      const rows = await tx
        .update(tableOf(entity))
        .set({ ...values, updatedAt: new Date() })
        .where(eq(tableOf(entity).id, id))
        .returning();
      return rows[0] as unknown as CatalogRecord;
    } catch (error) {
      throw this.translateWriteError(error, entity);
    }
  }

  private translateWriteError(error: unknown, entity: CatalogEntity): unknown {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      return new ConflictException({
        code: 'CATALOG_DUPLICATE',
        message:
          entity === 'cabinet'
            ? 'Site này đã có tủ mang mã đó.'
            : 'Đã có mục khác trùng mã/tên (không phân biệt hoa-thường).',
      });
    }
    return error;
  }

  /** Chuẩn hóa + kiểm tra đầu vào của form trước khi chạm DB. */
  private async toRow(
    entity: CatalogEntity,
    input: CatalogInput,
  ): Promise<Record<string, unknown>> {
    const text = (value: string | null | undefined): string | null => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };

    switch (entity) {
      case 'site':
        return {
          ...(input.code !== undefined ? { code: requireText(input.code, 'Mã site') } : {}),
          ...(input.name !== undefined ? { name: requireText(input.name, 'Tên site') } : {}),
          ...(input.address !== undefined ? { address: text(input.address) } : {}),
        };
      case 'cabinet': {
        if (input.siteId !== undefined) {
          const site = await this.db
            .select({ id: siteTable.id })
            .from(siteTable)
            .where(eq(siteTable.id, input.siteId));
          if (site.length === 0) {
            throw new BadRequestException({
              code: 'SITE_NOT_FOUND',
              message: 'Site được chọn không tồn tại.',
            });
          }
        }
        return {
          ...(input.code !== undefined ? { code: requireText(input.code, 'Mã tủ') } : {}),
          ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
          ...(input.description !== undefined ? { description: text(input.description) } : {}),
          ...(input.uHeight !== undefined ? { uHeight: input.uHeight } : {}),
        };
      }
      case 'device_type':
        return {
          ...(input.name !== undefined ? { name: requireText(input.name, 'Tên loại') } : {}),
          ...(input.hasPortMap !== undefined ? { hasPortMap: input.hasPortMap } : {}),
          ...(input.description !== undefined ? { description: text(input.description) } : {}),
        };
      case 'vendor':
        return {
          ...(input.name !== undefined
            ? { name: requireText(input.name, 'Tên nhà cung cấp') }
            : {}),
          ...(input.supplies !== undefined ? { supplies: text(input.supplies) } : {}),
          ...(input.phone !== undefined ? { phone: text(input.phone) } : {}),
          ...(input.contact !== undefined ? { contact: text(input.contact) } : {}),
        };
    }
  }

  private async requireOne(
    entity: CatalogEntity,
    id: string,
  ): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(tableOf(entity)).where(eq(tableOf(entity).id, id));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'CATALOG_NOT_FOUND',
        message: 'Không tìm thấy mục danh mục này.',
      });
    }
    return rows[0];
  }
}

function tableOf(entity: CatalogEntity) {
  switch (entity) {
    case 'site':
      return siteTable;
    case 'cabinet':
      return cabinetTable;
    case 'device_type':
      return deviceTypeTable;
    case 'vendor':
      return vendorTable;
  }
}

function nameColumn(entity: CatalogEntity) {
  return entity === 'device_type' ? deviceTypeTable.name : vendorTable.name;
}

function labelOf(entity: CatalogEntity, row: Record<string, unknown>): string {
  const value = entity === 'site' || entity === 'cabinet' ? row.code : row.name;
  return typeof value === 'string' ? value : '';
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new BadRequestException({
      code: 'FIELD_REQUIRED',
      message: `Thiếu ${label}.`,
    });
  }
  return trimmed;
}

/** Chỉ giữ những trường THỰC SỰ bị đổi để lịch sử đọc được, không phải bãi JSON. */
function pickChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) out[key] = before[key] ?? null;
  }
  return out;
}
