import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, or, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { HISTORY_PAGE_LIMIT } from '../../common/history';
import { requireCas } from '../../common/cas';
import { pageOffset, type Page, type PageQuery } from '../../common/pagination';
import type { SortQuery } from '../../common/sorting';
import {
  PG_FOREIGN_KEY_VIOLATION,
  conflictOnUnique,
  imsNormLike,
  pgConstraint,
  pgErrorCode,
} from '../../common/sql';
import { AuditWriterService } from '../audit/audit-writer.service';
import {
  cabinetTable,
  catalogHistoryTable,
  departmentTable,
  deviceTypeTable,
  ispProviderTable,
  servicePortTable,
  siteTable,
  vendorTable,
} from './catalog.schema';
import { normalizeKey } from '../../common/import-plan';
import {
  type CabinetRecord,
  type CatalogEntity,
  type CatalogHistoryRecord,
  type CatalogRecord,
  type CatalogSnapshot,
  type DepartmentRecord,
  type DeviceTypeRecord,
  type IspProviderRecord,
  type ServicePortRecord,
  type SiteRecord,
  type VendorRecord,
} from './catalog.types';

export interface CatalogLists {
  sites: SiteRecord[];
  cabinets: CabinetRecord[];
  deviceTypes: DeviceTypeRecord[];
  vendors: VendorRecord[];
  departments: DepartmentRecord[];
  ispProviders: IspProviderRecord[];
  servicePorts: ServicePortRecord[];
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
  hotline?: string | null;
  protocol?: string;
  portFrom?: number;
  portTo?: number;
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

  /** Mọi danh sách đầy đủ để đổ vào ô chọn của các form và để sinh file mẫu. */
  async lists(options: { includeInactive?: boolean } = {}): Promise<CatalogLists> {
    const onlyActive = options.includeInactive !== true;
    const [
      sites,
      cabinets,
      deviceTypes,
      vendors,
      departments,
      ispProviders,
      servicePorts,
    ] = await Promise.all([
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
      this.db
        .select()
        .from(departmentTable)
        .where(onlyActive ? eq(departmentTable.active, true) : undefined)
        .orderBy(asc(departmentTable.name)),
      this.db
        .select()
        .from(ispProviderTable)
        .where(onlyActive ? eq(ispProviderTable.active, true) : undefined)
        .orderBy(asc(ispProviderTable.name)),
      this.db
        .select()
        .from(servicePortTable)
        .where(onlyActive ? eq(servicePortTable.active, true) : undefined)
        .orderBy(asc(servicePortTable.name)),
    ]);
    return {
      sites,
      cabinets: cabinets.map((r) => ({ ...r.cabinet, siteCode: r.siteCode })),
      deviceTypes,
      vendors,
      departments,
      ispProviders,
      // `protocol` ở DB là `text` nên drizzle trả `string`; kiểu công khai hẹp hơn
      // ('tcp' | 'udp' | 'both'). CHECK của migration 0028 mới là chỗ giữ lời hứa đó.
      servicePorts: servicePorts as ServicePortRecord[],
    };
  }

  /** Danh sách phân trang cho màn quản trị — hiện CẢ mục đã vô hiệu (có cột trạng thái). */
  async list(
    entity: CatalogEntity,
    query: PageQuery,
    search?: string,
    sort?: SortQuery<string>,
  ): Promise<Page<CatalogRecord>> {
    const term = search?.trim() || null;
    const effectiveSort = sort ?? CATALOG_SORT_DEFAULT[entity];

    /*
     * Danh mục gấp dấu bằng `imsNormLike` — TÍNH TẠI CHỖ, không qua cột sinh.
     *
     * Bảy bảng danh mục đều là bảng tra cứu vài chục tới vài trăm dòng. Dựng cột sinh
     * `search_norm` + chỉ mục GIN cho từng bảng (như năm bảng nghiệp vụ ở migration 0052) là
     * trả giá lưu trữ và giá ghi mà không mua được gì: ở cỡ ấy quét tuần tự đã là chuyện
     * không đáng bàn. Cái CẦN chữa ở đây là sự ĐÚNG ĐẮN — `ILIKE` không gấp dấu nên gõ
     * `tru so` không ra `Trụ sở` — chứ không phải tốc độ (B-01).
     *
     * Quyết định này có ô canh ở `api/test/search-norm.spec.ts`, để lượt rà soát sau không
     * báo lại nó như một thiếu sót.
     */
    if (entity === 'cabinet') {
      const where = term
        ? or(
            imsNormLike(cabinetTable.code, term),
            imsNormLike(cabinetTable.description, term),
            imsNormLike(siteTable.code, term),
          )
        : undefined;
      const [rows, totalRows] = await Promise.all([
        this.db
          .select({ cabinet: cabinetTable, siteCode: siteTable.code })
          .from(cabinetTable)
          .innerJoin(siteTable, eq(cabinetTable.siteId, siteTable.id))
          .where(where)
          .orderBy(...cabinetOrderBy(effectiveSort))
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
    const where = term
      ? entity === 'site'
        ? or(imsNormLike(siteTable.code, term), imsNormLike(siteTable.name, term))
        : imsNormLike(labelColumn, term)
      : undefined;
    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(table)
        .where(where)
        .orderBy(...entityOrderBy(entity, effectiveSort))
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
      .limit(HISTORY_PAGE_LIMIT);
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
      /*
       * Trúng 0 dòng phải NÉM (rà soát 07/09 #10).
       *
       * `rows[0] as unknown as CatalogRecord` là ép kiểu che mắt: khi câu UPDATE không khớp
       * dòng nào — mục danh mục bị xóa xen giữa lúc đối chiếu và lúc ghi — nó trả `undefined`
       * đội lốt `CatalogRecord`, `applyImportWithin` vẫn `updated += 1`, vẫn ghi một dòng
       * `catalog_history` cho một bản ghi KHÔNG CÒN TỒN TẠI, và audit báo "đã cập nhật 1".
       * Người dùng thấy import thành công cho một việc chưa hề xảy ra.
       */
      // `tableOf(entity)` trả về hợp của 7 kiểu bảng nên `rows` là hợp của 7 kiểu mảng và TS
      // không hợp nhất được cho `requireCas<T>`. Ở đây chỉ cần ĐẾM, không cần biết hình dạng.
      requireCas(rows as readonly unknown[], {
        code: 'CATALOG_ALREADY_CHANGED',
        message:
          'Một mục danh mục trong file vừa bị người khác xóa hoặc đổi. Tải lại bảng đối chiếu rồi làm lại — chưa ghi gì cả.',
      });
      return rows[0] as unknown as CatalogRecord;
    } catch (error) {
      throw this.translateWriteError(error, entity);
    }
  }

  private translateWriteError(error: unknown, entity: CatalogEntity): unknown {
    // Khoá ngoại kép của 0067 — trọng tài duy nhất, vì `catalog` không được đếm bảng `device`.
    if (pgConstraint(error) === 'device_cabinet_same_site_fkey') {
      return new ConflictException({
        code: 'CABINET_HAS_DEVICES',
        message:
          'Tủ này còn thiết bị (kể cả máy đã thanh lý) nên không dời sang site khác được — thiết bị sẽ bị kẹt ở site cũ. Chuyển các thiết bị ra khỏi tủ trước, hoặc tạo tủ mới ở site kia.',
      });
    }
    return conflictOnUnique(error, {
      code: 'CATALOG_DUPLICATE',
      message:
        entity === 'cabinet'
          ? 'Site này đã có tủ mang mã đó.'
          : 'Đã có mục khác trùng mã/tên (không phân biệt hoa-thường).',
    });
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
      case 'department':
        return {
          ...(input.name !== undefined ? { name: requireText(input.name, 'Tên bộ phận') } : {}),
          ...(input.description !== undefined ? { description: text(input.description) } : {}),
        };
      case 'isp_provider':
        return {
          ...(input.name !== undefined ? { name: requireText(input.name, 'Tên nhà mạng') } : {}),
          ...(input.hotline !== undefined ? { hotline: text(input.hotline) } : {}),
          ...(input.contact !== undefined ? { contact: text(input.contact) } : {}),
        };
      case 'service_port': {
        const values: Record<string, unknown> = {
          ...(input.name !== undefined ? { name: requireText(input.name, 'Tên dịch vụ') } : {}),
          ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
          ...(input.description !== undefined ? { description: text(input.description) } : {}),
        };
        if (input.portFrom !== undefined || input.portTo !== undefined) {
          const from = input.portFrom;
          // Bỏ trống "đến" nghĩa là MỘT port, không phải một dải hở đầu kia: người khai
          // "HTTPS 443" chỉ điền một ô, và bắt họ gõ 443 hai lần là bắt vô cớ.
          const to = input.portTo ?? from;
          if (!isPort(from) || !isPort(to)) {
            throw new BadRequestException({
              code: 'SERVICE_PORT_INVALID',
              message: 'Port phải là số nguyên từ 1 đến 65535.',
            });
          }
          if (to < from) {
            throw new BadRequestException({
              code: 'SERVICE_PORT_INVALID',
              message: 'Dải port viết ngược — số đầu phải nhỏ hơn số cuối (vd 50000-52000).',
            });
          }
          values.portFrom = from;
          values.portTo = to;
        }
        return values;
      }
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

/**
 * Cột được phép sắp xếp — WHITELIST theo TỪNG loại (AD-2): tên cột đi thẳng vào `ORDER BY`,
 * và mỗi loại có bộ cột hiển thị riêng trên bảng nên whitelist cũng phải khai riêng.
 *
 * `siteCode` của tủ mạng KHÔNG có ở đây dù đang hiển thị trên bảng: giá trị đó lấy qua JOIN
 * sang bảng `site` (module khác — AD-2), sắp theo nó nghĩa là phải sắp bằng cột của bảng khác.
 * Muốn xem theo site thì lọc/tìm theo site rồi sắp theo mã tủ.
 */
export const CATALOG_SORT_KEYS = {
  site: ['code', 'name', 'address', 'active'],
  cabinet: ['code', 'description', 'uHeight', 'active'],
  device_type: ['name', 'hasPortMap', 'description', 'active'],
  vendor: ['name', 'supplies', 'phone', 'contact', 'active'],
  department: ['name', 'description', 'active'],
  isp_provider: ['name', 'hotline', 'contact', 'active'],
  service_port: ['name', 'protocol', 'portFrom', 'description', 'active'],
} as const satisfies Record<CatalogEntity, readonly string[]>;

export const CATALOG_SORT_DEFAULT: Record<CatalogEntity, SortQuery<string>> = {
  site: { key: 'code', dir: 'asc' },
  cabinet: { key: 'code', dir: 'asc' },
  device_type: { key: 'name', dir: 'asc' },
  vendor: { key: 'name', dir: 'asc' },
  department: { key: 'name', dir: 'asc' },
  isp_provider: { key: 'name', dir: 'asc' },
  service_port: { key: 'name', dir: 'asc' },
};

/** Loại KHÔNG cần join (mọi loại trừ `cabinet`) — gộp một hàm theo entity. */
type SimpleEntity = Exclude<CatalogEntity, 'cabinet'>;

function entityOrderBy(entity: SimpleEntity, sort: SortQuery<string>): SQL[] {
  switch (entity) {
    case 'site':
      return siteOrderBy(sort);
    case 'device_type':
      return deviceTypeOrderBy(sort);
    case 'vendor':
      return vendorOrderBy(sort);
    case 'department':
      return nameFirstOrderBy(sort, departmentTable.name, {
        description: departmentTable.description,
        active: departmentTable.active,
      });
    case 'isp_provider':
      return nameFirstOrderBy(sort, ispProviderTable.name, {
        hotline: ispProviderTable.hotline,
        contact: ispProviderTable.contact,
        active: ispProviderTable.active,
      });
    case 'service_port':
      return nameFirstOrderBy(sort, servicePortTable.name, {
        protocol: servicePortTable.protocol,
        portFrom: servicePortTable.portFrom,
        description: servicePortTable.description,
        active: servicePortTable.active,
      });
  }
}

type OrderColumn = Parameters<typeof asc>[0];

/**
 * Sắp theo một cột rồi CHỐT HẠ bằng `name`.
 *
 * Chốt hạ không phải chi tiết thừa: thiếu nó thì hai dòng cùng giá trị ở cột đang sắp có thể
 * đổi chỗ nhau giữa hai lần tải trang, và người dùng thấy bảng "nhảy" mà không hiểu vì sao.
 * `name` là khóa duy nhất của cả ba danh mục này nên nó chốt được.
 */
function nameFirstOrderBy(
  sort: SortQuery<string>,
  nameColumn: OrderColumn,
  others: Record<string, OrderColumn>,
): SQL[] {
  const column = others[sort.key];
  if (!column) return [sort.dir === 'desc' ? desc(nameColumn) : asc(nameColumn)];
  return [sort.dir === 'desc' ? desc(column) : asc(column), asc(nameColumn)];
}

function siteOrderBy(sort: SortQuery<string>): SQL[] {
  const column = {
    code: siteTable.code,
    name: siteTable.name,
    address: siteTable.address,
    active: siteTable.active,
  }[sort.key as (typeof CATALOG_SORT_KEYS)['site'][number]];
  const primary = sort.dir === 'desc' ? desc(column) : asc(column);
  // Chốt hạ bằng `code`: đây là khóa duy nhất của site, thiếu nó hai site cùng giá trị cột
  // đang sắp có thể đổi chỗ nhau giữa hai lần tải trang.
  return sort.key === 'code' ? [primary] : [primary, asc(siteTable.code)];
}

function cabinetOrderBy(sort: SortQuery<string>): SQL[] {
  const column = {
    code: cabinetTable.code,
    description: cabinetTable.description,
    uHeight: cabinetTable.uHeight,
    active: cabinetTable.active,
  }[sort.key as (typeof CATALOG_SORT_KEYS)['cabinet'][number]];
  const primary = sort.dir === 'desc' ? desc(column) : asc(column);
  // Chốt hạ bằng `id`, KHÔNG phải `code`: mã tủ chỉ duy nhất TRONG một site (unique theo
  // site_id + code), không duy nhất toàn cục — và whitelist không cho sắp theo site (AD-2)
  // nên không có cột nào khác đủ để chốt hạ ổn định ngoài khóa chính.
  return [primary, asc(cabinetTable.id)];
}

function deviceTypeOrderBy(sort: SortQuery<string>): SQL[] {
  const column = {
    name: deviceTypeTable.name,
    hasPortMap: deviceTypeTable.hasPortMap,
    description: deviceTypeTable.description,
    active: deviceTypeTable.active,
  }[sort.key as (typeof CATALOG_SORT_KEYS)['device_type'][number]];
  const primary = sort.dir === 'desc' ? desc(column) : asc(column);
  return sort.key === 'name' ? [primary] : [primary, asc(deviceTypeTable.name)];
}

function vendorOrderBy(sort: SortQuery<string>): SQL[] {
  const column = {
    name: vendorTable.name,
    supplies: vendorTable.supplies,
    phone: vendorTable.phone,
    contact: vendorTable.contact,
    active: vendorTable.active,
  }[sort.key as (typeof CATALOG_SORT_KEYS)['vendor'][number]];
  const primary = sort.dir === 'desc' ? desc(column) : asc(column);
  return sort.key === 'name' ? [primary] : [primary, asc(vendorTable.name)];
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
    case 'department':
      return departmentTable;
    case 'isp_provider':
      return ispProviderTable;
    case 'service_port':
      return servicePortTable;
  }
}

/** Cột mang NHÃN của loại — dùng cho ô tìm kiếm. `site`/`cabinet` mang nhãn ở `code`. */
function nameColumn(entity: Exclude<CatalogEntity, 'site' | 'cabinet'>) {
  switch (entity) {
    case 'device_type':
      return deviceTypeTable.name;
    case 'vendor':
      return vendorTable.name;
    case 'department':
      return departmentTable.name;
    case 'isp_provider':
      return ispProviderTable.name;
    case 'service_port':
      return servicePortTable.name;
  }
}

function labelOf(entity: CatalogEntity, row: Record<string, unknown>): string {
  const value = entity === 'site' || entity === 'cabinet' ? row.code : row.name;
  return typeof value === 'string' ? value : '';
}

function isPort(value: number | undefined): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535;
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
