import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, getTableColumns, inArray, ne, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { isRealDateOnly } from '../../common/real-date';
import { HISTORY_PAGE_LIMIT, latestStatusEvents, type StatusEvent } from '../../common/history';
import { DeviceRetirementRegistry } from '../../common/device-retirement.registry';
import { DeviceSearchRegistry } from '../../common/device-search.registry';
import { requireCas, requireUnchangedSince } from '../../common/cas';
import { effectiveOf } from '../../common/merge-effective';
import { pageOffset, type Page, type PageQuery } from '../../common/pagination';
import { orderByStable, type SortQuery } from '../../common/sorting';
import {
  conflictOnUnique,
  PG_EXCLUSION_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  pgConstraint,
  pgErrorCode,
  searchNormLike,
} from '../../common/sql';
import { rackUnitLabel } from '../../common/rack-units';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CatalogApiService } from '../catalog/catalog.api';
import { diffDevice, hasChanges, type DeviceChanges } from './device-changes';
import { normalizeAccessPoints } from './device-access';
import { expandPortTemplate } from './port-template';
import { deviceHistoryTable, deviceModelTable, deviceTable } from './devices.schema';
import { rackClaimOf, rackOverlap, rackPlacementChanged, rackUnitsReason, type RackClaim } from './rack-units';
import type {
  DeviceFilter,
  DeviceHistoryRecord,
  DeviceListItem,
  DeviceRecord,
  DeviceStatus,
  DeviceWriteResult,
} from './devices.types';

export interface DeviceInput {
  code?: string;
  name?: string;
  deviceTypeId?: string;
  model?: string | null;
  serial?: string | null;
  siteId?: string | null;
  cabinetId?: string | null;
  vendorId?: string | null;
  assignedTo?: string | null;
  department?: string | null;
  purchaseDate?: string | null;
  warrantyStart?: string | null;
  warrantyEnd?: string | null;
  status?: DeviceStatus;
  note?: string | null;
  rackUStart?: number | null;
  rackUSize?: number | null;
  /** Model danh mục (Q-26): có thì loại, chuỗi model và Số U lấy từ model. */
  deviceModelId?: string | null;
  /** Truy cập quản trị — đầu vào thô, `normalizeAccessPoints` làm sạch và kiểm. */
  accessPoints?: unknown;
}

/**
 * Chủ sở hữu `device` + `device_history` (AD-3).
 * Danh mục lấy qua `CatalogApiService` — KHÔNG join sang bảng site/cabinet/... (AD-2).
 */
/** Số dòng mỗi câu của lượt ghi hàng loạt — xa dưới trần 65.535 tham số của Postgres. */
const BULK_CHUNK = 500;

@Injectable()
export class DevicesService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly catalog: CatalogApiService,
    private readonly audit: AuditWriterService,
    private readonly retirement: DeviceRetirementRegistry,
    private readonly search: DeviceSearchRegistry,
  ) {}

  /**
   * Vế WHERE của danh sách. Bất đồng bộ vì từ khoá có thể chỉ tới thiết bị qua dữ liệu của
   * module khác (IP nằm ở `ipam`) — hỏi sổ `DeviceSearchRegistry`, không join sang bảng lạ
   * (AD-2). Màn hình và file xuất cùng đi qua đây để luôn ra một tập kết quả.
   */
  private async whereOf(filter: DeviceFilter): Promise<SQL | undefined> {
    const term = filter.search?.trim();
    const extraIds = term ? await this.search.deviceIdsMatching(term) : [];
    return buildWhere(filter, extraIds);
  }

  // ─────────────────────────── Đọc ───────────────────────────

  async list(
    query: PageQuery,
    filter: DeviceFilter,
    sort: SortQuery<DeviceSortKey> = DEVICE_SORT_DEFAULT,
  ): Promise<Page<DeviceListItem>> {
    const where = await this.whereOf(filter);
    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(deviceTable)
        .where(where)
        .orderBy(...deviceOrderBy(sort))
        .limit(query.limit)
        .offset(pageOffset(query)),
      this.db.select({ value: count() }).from(deviceTable).where(where),
    ]);
    return {
      items: await this.decorate(rows),
      total: Number(totalRows[0]?.value ?? 0),
    };
  }

  /** Toàn bộ kết quả theo bộ lọc, KHÔNG phân trang — chỉ dùng cho export xlsx (FR-028). */
  async listAll(
    filter: DeviceFilter,
    sort: SortQuery<DeviceSortKey> = DEVICE_SORT_DEFAULT,
  ): Promise<DeviceListItem[]> {
    const rows = await this.db
      .select()
      .from(deviceTable)
      .where(await this.whereOf(filter))
      // Cùng thứ tự với màn hình: file tải về phải khớp thứ tự người dùng đang nhìn, không
      // thì họ mở file ra và tưởng đây là dữ liệu khác.
      .orderBy(...deviceOrderBy(sort));
    return this.decorate(rows);
  }

  /** Ghi chú dạng rõ của hồ sơ — két so giá trị đang cất với nó (FR-035). */
  async noteOf(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ note: deviceTable.note })
      .from(deviceTable)
      .where(eq(deviceTable.id, id));
    return row?.note ?? null;
  }

  async findOne(id: string): Promise<DeviceListItem> {
    const rows = await this.db.select().from(deviceTable).where(eq(deviceTable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'DEVICE_NOT_FOUND',
        message: 'Không tìm thấy thiết bị này.',
      });
    }
    return (await this.decorate(rows))[0];
  }

  /**
   * Tra NHIỀU thiết bị trong MỘT lượt — bản chống N+1 của `findOne`.
   *
   * ===== VÌ SAO CẦN =====
   *
   * `findOne` tốn 8 truy vấn, không phải 1: một câu đọc hàng `device`, rồi `decorate` gọi
   * `catalog.lists()` mà hàm đó bắn 7 câu song song và KHÔNG cache. Con số đó vô hại khi mở
   * một hồ sơ, và tai hại khi năm chỗ khác nhau gọi nó trong vòng lặp:
   *
   *   · `IpAddressService.decorate`  — một dải /24 gán đầy: 254 × 8 ≈ 2000 câu cho MỘT lần
   *     mở màn dải;
   *   · `NatRuleService.decorate`    — tệ hơn, N+1 LỒNG: mỗi rule tra thiết bị (8 câu) và tra
   *     hồ sơ IP, mà `IpAddressService.findOne` lại tra thiết bị lần nữa;
   *   · `IspLineService.decorate`, `LicenseAssignmentService.decorate` — mỗi dòng một lượt.
   *
   * Trả `Map` chứ không phải mảng: nơi gọi luôn cần tra theo id, và trả mảng thì mỗi nơi lại
   * tự dựng `Map` một lần — ba bản của cùng một việc.
   *
   * Id không tồn tại thì VẮNG MẶT trong map, không ném. Bốn nơi gọi đều đang `catch` rồi hiện
   * "(thiết bị không còn)", và hành vi đó phải giữ: một hàng dữ liệu hỏng không được làm sập
   * cả bảng.
   */
  async findByIds(ids: string[]): Promise<Map<string, DeviceListItem>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.db.select().from(deviceTable).where(inArray(deviceTable.id, unique));
    const decorated = await this.decorate(rows);
    return new Map(decorated.map((item) => [item.id, item]));
  }

  /**
   * Thiết bị có bảo hành hết trong [from, to] — cỗ máy expiry (3.4) hỏi qua provider.
   * Thiết bị đã thanh lý thì thôi không nhắc: bảo hành của đồ bỏ đi không ai đi đòi.
   */
  async findWarrantyExpiring(from: string, to: string): Promise<DeviceListItem[]> {
    const rows = await this.db
      .select()
      .from(deviceTable)
      .where(
        and(
          sql`${deviceTable.warrantyEnd} IS NOT NULL`,
          sql`${deviceTable.warrantyEnd} >= ${from}`,
          sql`${deviceTable.warrantyEnd} <= ${to}`,
          sql`${deviceTable.status} <> 'retired'`,
        ),
      )
      .orderBy(asc(deviceTable.warrantyEnd));
    return this.decorate(rows);
  }

  /** Lần chuyển sang `status` gần nhất của từng máy (ai, khi nào) — một câu cho cả mẻ. */
  statusEvents(ids: string[], status: DeviceStatus): Promise<Map<string, StatusEvent>> {
    return latestStatusEvents(
      this.db,
      {
        table: deviceHistoryTable,
        ownerId: deviceHistoryTable.deviceId,
        actor: deviceHistoryTable.actor,
        changes: deviceHistoryTable.changes,
        createdAt: deviceHistoryTable.createdAt,
      },
      ids,
      status,
    );
  }

  async history(deviceId: string): Promise<DeviceHistoryRecord[]> {
    const rows = await this.db
      .select()
      .from(deviceHistoryTable)
      .where(eq(deviceHistoryTable.deviceId, deviceId))
      .orderBy(desc(deviceHistoryTable.createdAt))
      .limit(HISTORY_PAGE_LIMIT);
    return rows as DeviceHistoryRecord[];
  }

  // ─────────────────────────── Ghi ───────────────────────────

  async create(actor: string, input: DeviceInput): Promise<DeviceWriteResult> {
    const values = await this.prepare(input, null);
    const warnings = await this.serialWarnings(values.serial as string | null, null);

    const claim = rackClaimOf(values, null);
    const device = await this.db.transaction(async (tx) => {
      await this.assertRackFreeWithin(tx, null, claim);
      const created = await this.insertWithin(tx, values);
      await this.recordWithin(tx, actor, created.id, 'created', {
        code: { before: null, after: created.code },
      });
      return created;
    });
    return { device, warnings };
  }

  async update(actor: string, id: string, input: DeviceInput): Promise<DeviceWriteResult> {
    const before = await this.requireRow(id);
    /*
     * Hồ sơ đã thanh lý thì KHÓA — kiểm ở đây chứ không chỉ `disabled` cái nút trên web.
     * Nút bấm là gợi ý; import, script dọn dữ liệu và mọi tích hợp về sau đều đi thẳng vào
     * đường này. Dùng lại chính `before` vừa đọc, không hỏi DB lần hai.
     *
     * `setStatus` KHÔNG đi qua đây (nó gọi thẳng `updateWithin`), nên mở lại một máy bị
     * thanh lý nhầm vẫn chạy — nếu không thì bấm nhầm một lần là hồ sơ chết vĩnh viễn.
     */
    this.assertNotRetired(before);
    const values = await this.prepare(input, id);
    this.assertNotRetiringViaUpdate(before, values.status as DeviceStatus | undefined);
    const changes = diffDevice(before, values);
    const warnings =
      values.serial !== undefined
        ? await this.serialWarnings(values.serial as string | null, id)
        : [];

    if (!hasChanges(changes)) {
      // Không đổi gì thì KHÔNG ghi lịch sử: bấm Lưu hai lần không được đẻ ra hai dòng
      // "đã sửa" rỗng làm loãng tab Lịch sử (FR-007).
      return { device: toRecord(before), warnings };
    }

    const device = await this.db.transaction(async (tx) => {
      /*
       * Mọi phép kiểm ở trên (đã thanh lý chưa, diff cho lịch sử) đọc ảnh chụp NGOÀI
       * transaction. Một lượt thanh lý commit vào giữa thì form đang gửi `status: in_use` sẽ
       * kéo máy sống lại mà không qua chốt của `setStatus`. Khóa hàng rồi hỏi nó còn là hàng
       * đã đọc không; lệch thì 409 chứ không ghi đè.
       */
      requireUnchangedSince(before, await this.requireRowWithin(tx, id, 'update'), {
        code: 'DEVICE_ALREADY_CHANGED',
        message: 'Hồ sơ thiết bị vừa được người khác sửa — tải lại rồi thử lại. Chưa ghi gì cả.',
      });
      if (rackPlacementChanged(placementOf(values, before), placementOf({}, before))) {
        await this.assertRackFreeWithin(tx, id, rackClaimOf(values, before));
      }
      const updated = await this.updateWithin(tx, id, values);
      await this.recordWithin(tx, actor, id, 'updated', changes);
      return updated;
    });
    return { device, warnings };
  }

  /**
   * Đổi trạng thái (AC 2.2 "thiết bị khóa được, không xóa"). `retired` = đã thanh lý:
   * hồ sơ khóa lại, không sửa được nữa nhưng vẫn tra cứu và vẫn nằm trong sổ.
   */
  /**
   * Đổi trạng thái thiết bị. `cleanup` chỉ có nghĩa khi chuyển sang `retired`.
   *
   * ===== THANH LÝ LÀ MỘT CHỐT, KHÔNG PHẢI MỘT PHÉP GÁN =====
   *
   * Chỉ lật một chữ trong cột `status` là chưa đủ: máy đã ra khỏi công ty, đã ký biên bản,
   * nhưng IP của nó vẫn `assigned` và vẫn trỏ về chính nó, rule NAT vào IP đó vẫn sống, ghế
   * license vẫn bị chiếm. Hậu quả nặng nhất không nằm ở IPAM: thanh lý 10 máy cũ thì máy mới
   * đầu tiên đã đụng trần seat và cửa đó BẮT người trực khai một lý do vượt seat sai sự thật
   * pháp lý với nhà cung cấp, chỉ để đi tiếp được việc hằng ngày.
   *
   * Nên mặc định CHẶN, kèm danh sách đích danh thứ máy còn giữ. `cleanup: true` (ô tick trên
   * hộp thanh lý) dọn hết trong CÙNG transaction: hoặc máy được thanh lý và mọi thứ nó giữ
   * được trả lại, hoặc không có gì xảy ra.
   *
   * `devices` không biết ai đang giữ gì — nó chỉ hỏi sổ đăng ký. Xem
   * `common/device-retirement.registry.ts`.
   */
  async setStatus(
    actor: string,
    id: string,
    status: DeviceStatus,
    options: { cleanup?: boolean } = {},
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      /*
       * KHOÁ HÀNG THIẾT BỊ TRƯỚC KHI ĐỌC BẤT CỨ THỨ GÌ KHÁC.
       *
       * Đọc `requireRow` và đếm `holdings` NGOÀI transaction rồi mới mở transaction để ghi là
       * đúng mẫu "M2" mà `common/cas.ts` mô tả, và ở đây nó hỏng theo hai đường:
       *
       *   1. HAI LƯỢT THANH LÝ SONG SONG. Cả hai đọc `status = 'active'`, cả hai thấy không
       *      giữ gì, cả hai chạy `releaseAllWithin`, cả hai ghi. Một lần thanh lý ra HAI dòng
       *      `status-changed` trong `device_history` — bảng chỉ-thêm mà FR-007 dựng lên để
       *      trả lời "ai làm gì hôm đó".
       *
       *   2. THANH LÝ ĐUA VỚI MỘT LƯỢT GẮN TÀI SẢN. Nguy hiểm hơn nhiều. Lượt thanh lý đếm
       *      `holdings` thấy rỗng; cùng lúc đó một người khác đang gán IP/ghế license cho
       *      chính máy này trong transaction của họ, chưa commit nên ta không thấy. Hai bên
       *      commit, và kết quả là một máy `retired` vẫn đang giữ tài sản — đúng cái trạng
       *      thái mà cả `DeviceRetirementRegistry` sinh ra để loại trừ.
       *
       * `FOR UPDATE` ở đây bắt cặp với `FOR SHARE` mà `assertUsableWithin` đặt trên cùng hàng
       * đó. Hai lượt không còn chồng lên nhau được nữa, theo cả hai thứ tự:
       *
       *   · thanh lý khoá trước → lượt gắn xếp hàng, rồi đọc lại thấy `retired` → `DEVICE_RETIRED`;
       *   · lượt gắn khoá trước → thanh lý xếp hàng, rồi đếm `holdings` thấy tài sản vừa được
       *     gán → `DEVICE_HAS_HOLDINGS`.
       *
       * Cùng một nước cờ `LicenseAssignmentService` đã dùng để chặn vượt seat, chỉ là đặt trên
       * hàng `device` thay vì hàng `software`.
       */
      const before = await this.requireRowWithin(tx, id, 'update');
      /*
       * Đọc lại SAU khi có khoá, nên lượt thứ hai của hai lượt thanh lý song song thấy đúng
       * trạng thái lượt thứ nhất vừa ghi và lặng lẽ không làm gì. Trả 409 ở đây mới là sai:
       * người trực bấm Thanh lý, máy ĐÃ thanh lý — đúng ý họ rồi, không có gì để báo lỗi.
       */
      if (before.status === status) return;

      if (status === 'retired' && !options.cleanup) {
        const holdings = await this.retirement.holdingsWithin(tx, id);
        if (holdings.length > 0) {
          throw new ConflictException({
            code: 'DEVICE_HAS_HOLDINGS',
            message:
              `Thiết bị ${before.code} còn đang giữ: ${holdings.join(', ')}. ` +
              'Gỡ những thứ này trước, hoặc chọn "Gỡ hết rồi thanh lý".',
            holdings,
          });
        }
      }

      /*
       * Dọn TRƯỚC khi lật trạng thái.
       *
       * Ngược lại thì máy đã là `retired` khi các releaser chạy, và chúng đi qua đúng những
       * cửa ghi mà `assertUsable` vừa đóng lại — lượt dọn tự chặn chính mình.
       */
      if (status === 'retired' && options.cleanup) {
        await this.retirement.releaseAllWithin(tx, actor, id);
      }
      // Máy thanh lý không giữ chỗ trong tủ; đưa lại vào dùng thì phải còn chỗ đó.
      if (before.status === 'retired') await this.assertRackFreeWithin(tx, id, rackClaimOf({ status }, before));
      await this.updateWithin(tx, id, { status });
      await this.recordWithin(tx, actor, id, 'status-changed', {
        status: { before: before.status, after: status },
        ...(status === 'retired' && options.cleanup ? { cleanup: { before: null, after: true } } : {}),
      });
    });
  }

  async recordWithin(
    tx: Tx,
    actor: string,
    deviceId: string,
    action: string,
    changes: DeviceChanges | Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(deviceHistoryTable).values({ deviceId, action, actor, changes });
    await this.audit.appendWithin(tx, {
      actor,
      action: `device.${action}`,
      objectType: 'device',
      objectId: deviceId,
      detail: changes,
    });
  }

  /**
   * Gỡ U của các máy sắp ĐỔI chỗ trong tủ, trong transaction của lượt ghi hàng loạt — pha một của
   * dời chỗ hai pha (import): hoán đổi hai máy, hay A dời vào chỗ B mà B dời đi ở dòng sau, chỉ
   * ghi được khi chỗ cũ đã trống trước lúc đặt chỗ mới. Nơi gọi PHẢI đặt lại U cho từng máy trong
   * cùng transaction; không ghi lịch sử (trạng thái trung gian, không ai thấy).
   */
  async vacateRackWithin(tx: Tx, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.update(deviceTable).set({ rackUStart: null, rackUSize: null }).where(inArray(deviceTable.id, ids));
  }

  /** Lịch sử + audit của nhiều máy một lượt (import) — cùng nội dung `recordWithin` ghi từng dòng. */
  async recordManyWithin(
    tx: Tx,
    actor: string,
    entries: { deviceId: string; action: string; changes: DeviceChanges | Record<string, unknown> }[],
  ): Promise<void> {
    for (let i = 0; i < entries.length; i += BULK_CHUNK) {
      const chunk = entries.slice(i, i + BULK_CHUNK);
      await tx.insert(deviceHistoryTable).values(chunk.map((e) => ({ deviceId: e.deviceId, action: e.action, actor, changes: e.changes })));
    }
    await this.audit.appendManyWithin(
      tx,
      entries.map((e) => ({ actor, action: `device.${e.action}`, objectType: 'device', objectId: e.deviceId, detail: e.changes })),
    );
  }

  /** Thêm nhiều máy một lượt (import, dòng không đặt U). Trả theo đúng thứ tự `rows`. */
  async insertManyWithin(tx: Tx, rows: Record<string, unknown>[]): Promise<DeviceRecord[]> {
    const out: DeviceRecord[] = [];
    try {
      for (let i = 0; i < rows.length; i += BULK_CHUNK) {
        const written = await tx.insert(deviceTable).values(rows.slice(i, i + BULK_CHUNK) as never).returning();
        // Không dựa vào thứ tự RETURNING: ghép lại theo mã (duy nhất).
        const byCode = new Map(written.map((r) => [r.code, r]));
        for (const row of rows.slice(i, i + BULK_CHUNK)) out.push(toRecord(byCode.get(row.code as string)!));
      }
    } catch (error) {
      throw this.translateWriteError(error);
    }
    return out;
  }

  /**
   * Sửa nhiều máy, mỗi lô một câu `UPDATE … FROM (VALUES …)` cho các dòng cùng bộ cột (import từ
   * mẫu thì gần như mọi dòng cùng bộ cột). Từng câu một thì Postgres lập kế hoạch lại cho mỗi dòng
   * trên một bảng 18 index — phần lớn thời gian của file lớn nằm ở đó. Hồ sơ biến mất giữa chừng
   * thì ném như `updateWithin`.
   */
  async updateManyWithin(tx: Tx, rows: { id: string; values: Record<string, unknown> }[]): Promise<void> {
    const columns = getTableColumns(deviceTable) as Record<string, AnyPgColumn>;
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const keys = Object.keys(row.values).filter((k) => k !== 'updatedAt' && row.values[k] !== undefined);
      for (const key of keys) if (!columns[key]) throw new Error(`Cột thiết bị không có: ${key}`);
      const signature = keys.sort().join(',');
      const group = groups.get(signature) ?? [];
      group.push({ id: row.id, values: Object.fromEntries(keys.map((k) => [k, row.values[k]])) });
      groups.set(signature, group);
    }
    try {
      for (const [signature, group] of groups) {
        const keys = signature ? signature.split(',') : [];
        for (let i = 0; i < group.length; i += BULK_CHUNK) {
          const chunk = group.slice(i, i + BULK_CHUNK);
          const tuples = chunk.map(
            (row) =>
              sql`(${row.id}::uuid${sql.join(
                keys.map((k) => {
                  const value = row.values[k];
                  const driver = value === null ? null : columns[k].mapToDriverValue(value);
                  return sql`, ${driver}::${sql.raw(columns[k].getSQLType())}`;
                }),
                sql``,
              )})`,
          );
          const names = [sql`id`, ...keys.map((k) => sql.identifier(columns[k].name))];
          const sets = [
            ...keys.map((k) => sql`${sql.identifier(columns[k].name)} = v.${sql.identifier(columns[k].name)}`),
            sql`updated_at = now()`,
          ];
          const result = await tx.execute(
            sql`UPDATE ${deviceTable} AS d SET ${sql.join(sets, sql`, `)}
                  FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(${sql.join(names, sql`, `)})
                 WHERE d.id = v.id
             RETURNING d.id`,
          );
          if (result.rows.length !== chunk.length) {
            throw new ConflictException({
              code: 'DEVICE_ALREADY_CHANGED',
              message: 'Hồ sơ thiết bị này vừa bị người khác xóa hoặc đổi. Tải lại rồi làm lại — chưa ghi gì cả.',
            });
          }
        }
      }
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  /** Dùng chung cho import hàng loạt — đã có transaction bao ngoài. */
  async insertWithin(tx: Tx, values: Record<string, unknown>): Promise<DeviceRecord> {
    try {
      const rows = await tx.insert(deviceTable).values(values as never).returning();
      return toRecord(rows[0]);
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async updateWithin(
    tx: Tx,
    id: string,
    values: Record<string, unknown>,
  ): Promise<DeviceRecord> {
    try {
      const rows = await tx
        .update(deviceTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(deviceTable.id, id))
        .returning();
      /*
       * Trúng 0 dòng là CHUYỆN CÓ THẬT, không phải trường hợp không xảy ra.
       *
       * Hồ sơ bị xóa xen giữa lúc đối chiếu và lúc ghi thì câu này khớp 0 dòng và Postgres
       * KHÔNG báo lỗi. `toRecord(rows[0])` khi đó đọc `.status` của `undefined` → TypeError,
       * tức người dùng nhận 500 với câu "Cannot read properties of undefined" thay vì một câu
       * nói đúng chuyện gì đã xảy ra. Ép `as unknown as` còn tệ hơn: trả về `undefined` trong
       * IM LẶNG và bộ đếm import vẫn +1.
       */
      requireCas(rows, {
        code: 'DEVICE_ALREADY_CHANGED',
        message:
          'Hồ sơ thiết bị này vừa bị người khác xóa hoặc đổi. Tải lại rồi làm lại — chưa ghi gì cả.',
      });
      return toRecord(rows[0]);
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  // ─────────────────────────── Nội bộ ───────────────────────────

  /** Gắn tên danh mục cho một trang kết quả — MỘT lượt đọc danh mục, không N+1. */
  private async decorate(rows: (typeof deviceTable.$inferSelect)[]): Promise<DeviceListItem[]> {
    if (rows.length === 0) return [];
    const lists = await this.catalog.lists({ includeInactive: true });
    const types = new Map(lists.deviceTypes.map((t) => [t.id, t]));
    const sites = new Map(lists.sites.map((s) => [s.id, s]));
    const cabinets = new Map(lists.cabinets.map((c) => [c.id, c]));
    const vendors = new Map(lists.vendors.map((v) => [v.id, v]));
    /* Ảnh model thắng ảnh riêng của máy (Q-26) — cột Ảnh của bảng (Q-27) cần biết model nào có
       ảnh mặt trước mà không phải gọi thêm một lượt mỗi dòng. */
    const modelIds = [...new Set(rows.map((row) => row.deviceModelId).filter((id): id is string => Boolean(id)))];
    const modelPhotos = new Map(
      modelIds.length === 0
        ? []
        : (
            await this.db
              .select({ id: deviceModelTable.id, photo: deviceModelTable.photoFrontFileId, updatedAt: deviceModelTable.updatedAt })
              .from(deviceModelTable)
              .where(inArray(deviceModelTable.id, modelIds))
          ).map((m) => [m.id, m.photo ? m.updatedAt.toISOString() : null] as const),
    );

    return rows.map((row) => {
      const type = types.get(row.deviceTypeId);
      return {
        ...toRecord(row),
        // Danh mục bị xóa lỗi nào đó vẫn không được làm sập màn danh sách.
        deviceTypeName: type?.name ?? '(không rõ loại)',
        hasPortMap: type?.hasPortMap ?? false,
        siteCode: row.siteId ? (sites.get(row.siteId)?.code ?? null) : null,
        cabinetCode: row.cabinetId ? (cabinets.get(row.cabinetId)?.code ?? null) : null,
        vendorName: row.vendorId ? (vendors.get(row.vendorId)?.name ?? null) : null,
        modelPhotoVersion: row.deviceModelId ? (modelPhotos.get(row.deviceModelId) ?? null) : null,
      };
    });
  }

  /**
   * Chuẩn hóa đầu vào + kiểm tra tham chiếu danh mục. Chỉ trả về những trường CÓ MẶT trong
   * `input`: sửa một trường không được âm thầm xóa những trường không gửi lên.
   */
  private async prepare(
    input: DeviceInput,
    id: string | null,
  ): Promise<Record<string, unknown>> {
    const values: Record<string, unknown> = {};
    const put = (key: string, value: unknown) => {
      if (value !== undefined) values[key] = value;
    };

    put('code', input.code === undefined ? undefined : requireText(input.code, 'Mã thiết bị'));
    put('name', input.name === undefined ? undefined : requireText(input.name, 'Tên thiết bị'));
    put('deviceTypeId', input.deviceTypeId);
    put('model', text(input.model));
    put('serial', text(input.serial));
    put('siteId', input.siteId === undefined ? undefined : (input.siteId || null));
    put('cabinetId', input.cabinetId === undefined ? undefined : (input.cabinetId || null));
    put('vendorId', input.vendorId === undefined ? undefined : (input.vendorId || null));
    put('assignedTo', text(input.assignedTo));
    put('department', text(input.department));
    put('purchaseDate', dateOnly(input.purchaseDate, 'Ngày mua'));
    put('warrantyStart', dateOnly(input.warrantyStart, 'Bảo hành từ'));
    put('warrantyEnd', dateOnly(input.warrantyEnd, 'Bảo hành đến'));
    put('status', input.status);
    put('note', text(input.note));
    put('rackUStart', input.rackUStart);
    put('rackUSize', input.rackUSize);
    put('deviceModelId', input.deviceModelId === undefined ? undefined : (input.deviceModelId || null));
    put('accessPoints', input.accessPoints === undefined ? undefined : normalizeAccessPoints(input.accessPoints));

    if (id === null) {
      for (const required of ['code', 'name', 'deviceTypeId'] as const) {
        if (values[required] === undefined) {
          throw new BadRequestException({
            code: 'FIELD_REQUIRED',
            message: `Thiếu ${LABEL[required]}.`,
          });
        }
      }
    }

    // Ngày bảo hành: kiểm ở đây để báo tiếng Việt tử tế thay vì để CHECK constraint
    // ném ra một câu SQL. Phải ghép với giá trị ĐANG CÓ khi người dùng chỉ sửa một đầu —
    // và ghép bằng `effectiveOf`, không bằng `??`: ô bị XOÁ (`null` có mặt trong `values`)
    // không phải ô không đụng tới. Với `??`, xoá ngày bắt đầu bảo hành rồi đặt ngày kết
    // thúc sớm hơn ngày bắt đầu CŨ bị từ chối bởi một giá trị vừa bị xoá, và xoá một site
    // đã bị gỡ khỏi danh mục thì không bao giờ xoá được. Đường Excel và các service HTTP
    // phải dùng cùng phép ghép này (A-03).
    const current = id ? await this.requireRow(id) : null;
    await this.applyModel(values, current);
    const effective = effectiveOf(values);
    const start = effective<string | null>('warrantyStart', current?.warrantyStart ?? null);
    const end = effective<string | null>('warrantyEnd', current?.warrantyEnd ?? null);
    if (start && end && end < start) {
      throw new BadRequestException({
        code: 'WARRANTY_RANGE_INVALID',
        message: 'Ngày kết thúc bảo hành phải sau ngày bắt đầu.',
      });
    }

    await this.catalog.assertRefs(
      {
        siteId: effective<string | null>('siteId', current?.siteId ?? null),
        cabinetId: effective<string | null>('cabinetId', current?.cabinetId ?? null),
        deviceTypeId: effective<string | null>('deviceTypeId', current?.deviceTypeId ?? null),
        vendorId: effective<string | null>('vendorId', current?.vendorId ?? null),
      },
      current,
    );
    await this.prepareRack(values, current);
    return values;
  }

  /**
   * Máy thuộc model (Q-26): loại và chuỗi model lấy theo model lúc GÁN (chuỗi model giữ để tìm kiếm
   * và để máy chưa có Model vẫn dò được ảnh model như cũ); Số U luôn theo model, không sửa đè — cùng
   * model là cùng kích thước vật lý.
   */
  private async applyModel(values: Record<string, unknown>, current: typeof deviceTable.$inferSelect | null): Promise<void> {
    const modelId = effectiveOf(values)<string | null>('deviceModelId', current?.deviceModelId ?? null);
    if (!modelId) return;
    const [model] = await this.db.select().from(deviceModelTable).where(eq(deviceModelTable.id, modelId));
    if (!model) throw new BadRequestException({ code: 'DEVICE_MODEL_NOT_FOUND', message: 'Model đã chọn không còn trong danh mục — chọn lại model.' });
    if (values.deviceModelId !== undefined) {
      values.deviceTypeId = model.deviceTypeId;
      values.model = model.model;
      // Chép cổng mẫu lúc gán model mới (form gửi lại deviceModelId mỗi lần lưu) và khi máy chưa có
      // danh sách: lưu lại hồ sơ không chép lại vào danh sách cố ý để trống. Sửa mẫu về sau thì
      // `DeviceModelsService` thêm cổng còn thiếu cho cả loạt máy.
      const assigning = values.deviceModelId !== (current?.deviceModelId ?? null);
      if (assigning && (current?.portLayout ?? []).length === 0 && values.portLayout === undefined) {
        values.portLayout = expandPortTemplate(model.portTemplate, Number.MAX_SAFE_INTEGER);
      }
    }
    const start = effectiveOf(values)<number | null>('rackUStart', current?.rackUStart ?? null);
    if (model.rackMountable && start !== null) values.rackUSize = model.uSize;
    // Máy in, camera, AP… không bao giờ vào tủ (Q-23): chặn ở kho, sơ đồ chỉ là ảnh chiếu.
    const cabinetId = effectiveOf(values)<string | null>('cabinetId', current?.cabinetId ?? null);
    if (!model.rackMountable && cabinetId) {
      throw new BadRequestException({
        code: 'DEVICE_MODEL_NOT_RACKABLE',
        message: `Model ${model.model} không gắn tủ — bỏ chọn tủ (máy chỉ cần Site), hoặc chọn model gắn tủ.`,
      });
    }
  }

  /**
   * U trong tủ: bỏ tủ thì xoá U theo (máy không còn chỗ nào trong tủ nào); có U thì phải hợp lệ và
   * không vượt chiều cao tủ (đọc `cabinet.u_height` qua catalog.api). Chỉ xét khi lượt ghi ĐỔI chỗ
   * của máy (`rackPlacementChanged`).
   */
  private async prepareRack(values: Record<string, unknown>, current: typeof deviceTable.$inferSelect | null): Promise<void> {
    const effective = effectiveOf(values);
    const cabinetId = effective<string | null>('cabinetId', current?.cabinetId ?? null);
    if (!cabinetId && values.rackUStart === undefined && values.rackUSize === undefined && current?.rackUStart != null) {
      values.rackUStart = null;
      values.rackUSize = null;
    }
    if (!rackPlacementChanged(placementOf(values, current), current ? placementOf({}, current) : null)) return;
    const start = effective<number | null>('rackUStart', current?.rackUStart ?? null);
    const size = effective<number | null>('rackUSize', current?.rackUSize ?? null);
    if (start === null && size === null) return;
    const cabinet = cabinetId ? (await this.catalog.cabinetsByIds([cabinetId])).get(cabinetId) : undefined;
    const reason = rackUnitsReason({
      start,
      size,
      hasCabinet: Boolean(cabinetId),
      cabinetCode: cabinet?.code ?? null,
      cabinetHeight: cabinet?.uHeight ?? null,
    });
    if (reason) throw new BadRequestException({ code: 'DEVICE_RACK_U_INVALID', message: reason });
  }

  /**
   * Chồng U trong cùng tủ thì chặn (Q-23) — gọi TRONG transaction của lượt ghi, trước khi ghi.
   *
   * Khoá tư vấn theo tủ xếp hàng mọi lượt ghi vào CÙNG một tủ, nên lượt sau đọc thấy máy lượt
   * trước vừa đặt và báo đúng tên nó. Không khoá thì hai lượt cùng thấy chỗ trống: ràng buộc
   * `device_rack_u_no_overlap` vẫn chặn lượt sau, nhưng chỉ nói được một câu chung chung.
   */
  async assertRackFreeWithin(tx: Tx, deviceId: string | null, claim: RackClaim | null): Promise<void> {
    if (!claim) return;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`device-rack:${claim.cabinetId}`}, 0))`);
    const others = await tx
      .select({ code: deviceTable.code, name: deviceTable.name, start: deviceTable.rackUStart, size: deviceTable.rackUSize })
      .from(deviceTable)
      .where(
        and(
          eq(deviceTable.cabinetId, claim.cabinetId),
          ne(deviceTable.status, 'retired'),
          sql`${deviceTable.rackUStart} IS NOT NULL`,
          deviceId ? ne(deviceTable.id, deviceId) : undefined,
        ),
      );
    const taken = rackOverlap(
      claim,
      others.map((o) => ({ code: o.code, name: o.name, start: o.start!, size: o.size! })),
    );
    if (taken) throw rackTaken(claim, taken);
  }

  /**
   * Loại dây của một dòng sơ đồ cổng: phải có thật, và không chọn MỚI một loại đã ngừng dùng
   * (Q-14) — dòng VỐN mang loại đó (`current`) vẫn gửi lại nó được khi sửa ô khác.
   */
  async assertCableTypeChoice(next: string | null, current: string | null): Promise<void> {
    if (!next) return;
    await this.catalog.assertRefs({ cableTypeId: next }, { cableTypeId: current });
  }

  /** Tên loại dây theo id (kể cả loại đã ngừng dùng) — lịch sử cổng ghi TÊN, không ghi uuid. */
  async cableTypeNames(): Promise<Map<string, string>> {
    return new Map((await this.catalog.cableTypes()).map((c) => [c.id, c.name]));
  }

  /** Serial trùng chỉ CẢNH BÁO, không chặn (AC 2.2). */
  private async serialWarnings(serial: string | null, excludeId: string | null): Promise<string[]> {
    if (!serial) return [];
    const rows = await this.db
      .select({ code: deviceTable.code })
      .from(deviceTable)
      .where(
        and(
          sql`lower(${deviceTable.serial}) = lower(${serial})`,
          excludeId ? ne(deviceTable.id, excludeId) : undefined,
        ),
      )
      .limit(5);
    if (rows.length === 0) return [];
    return [
      `Serial "${serial}" đang trùng với ${rows.map((r) => r.code).join(', ')}. Vẫn lưu được — kiểm lại tem thiết bị cho chắc.`,
    ];
  }

  private requireRow(id: string): Promise<typeof deviceTable.$inferSelect> {
    return this.requireRowWithin(this.db, id);
  }

  /**
   * "Máy này còn nhận thêm được không" — MỘT câu trả lời cho cả hệ thống.
   *
   * `DevicesApiService.assertUsable` (cửa cho module khác) và ba đường ghi NỘI BỘ của chính
   * module này (sửa hồ sơ · nối cổng · import) đều đi qua đây. Chỉ canh cửa ngoài thì module
   * khác bị chặn còn ba đường trong nhà thì không — đúng mẫu N1: dựng hàng rào ở mấy cửa mình
   * buộc phải bước qua, quên mấy cửa mở sẵn bên trong.
   *
   * `broken` (hỏng, chờ sửa) VẪN qua: máy đó còn trong công ty, còn giữ license và IP của nó.
   * Chỉ `retired` mới là "đã ra khỏi sổ".
   */
  assertNotRetired(row: { code: string; status: string }): void {
    if (row.status !== 'retired') return;
    throw new BadRequestException({
      code: 'DEVICE_RETIRED',
      message: `Thiết bị ${row.code} đã thanh lý. Chọn thiết bị khác, hoặc bấm "Đưa lại vào dùng" trên hồ sơ máy nếu thanh lý nhầm.`,
    });
  }

  /**
   * THANH LÝ PHẢI ĐI QUA `setStatus`, KHÔNG ĐI QUA ĐƯỜNG SỬA HỒ SƠ (A-01).
   *
   * ===== LỖ MÀ HÀM NÀY BỊT =====
   *
   * `UpdateDto` nhận `status`, và `DEVICE_STATUSES` có `'retired'`. Không có hàm này thì
   * `PATCH /api/v1/devices/:id` với body `{"status":"retired"}` ghi thẳng chữ "đã thanh lý"
   * vào bảng — **vai `member` là đủ**, và nó đi vòng qua TRỌN VẸN chốt thanh lý của
   * `setStatus`:
   *
   *   · không `FOR UPDATE` ⇒ mất luôn hàng rào đua mà khối chú thích ở `setStatus` dựng lên;
   *   · không hỏi `DeviceRetirementRegistry.holdingsWithin` ⇒ IP vẫn `assigned` và vẫn trỏ về
   *     một máy đã bỏ, rule NAT vẫn mở trên tường lửa, ghế license bị chiếm VĨNH VIỄN (máy mới
   *     đụng trần seat, người trực bị ép khai `overSeatReason` sai sự thật pháp lý);
   *   · lịch sử ghi `action: 'updated'` và audit ghi `device.updated`, nên lượt thanh lý VÔ
   *     HÌNH với ai tra theo `device.status-changed` — đúng câu hỏi mà FR-007 sinh ra để trả lời.
   *
   * ===== VÌ SAO Ở TẦNG SERVICE, KHÔNG Ở DTO =====
   *
   * Chặn bằng `@IsIn` trong DTO chỉ đóng cửa HTTP. Chính chú thích của `assertNotRetired` ngay
   * trên đây đã nói ra bài học đó: "nút bấm là gợi ý; import, script dọn dữ liệu và mọi tích
   * hợp về sau đều đi thẳng vào đường này". Đặt ở đây thì mọi nơi gọi `update()` đều bị chặn.
   *
   * Đường nhập Excel chặn cùng luật ở bước Đối chiếu (`planRow` trong `device-import.ts`, nhánh
   * `values.status === 'retired'`), với câu từ chối gần như y hệt câu dưới đây: hai cửa phải nói
   * cùng một câu.
   *
   * MỞ LẠI thì vẫn đi đường này được: chốt chỉ chặn chiều VÀO `retired`. Một máy đang `retired`
   * đã bị `assertNotRetired` chặn từ trước đó rồi, nên nhánh này chỉ gặp chiều đi tới.
   */
  private assertNotRetiringViaUpdate(
    before: { code: string; status: string },
    next: DeviceStatus | undefined,
  ): void {
    if (next !== 'retired' || before.status === 'retired') return;
    throw new BadRequestException({
      code: 'RETIRE_VIA_UPDATE',
      message:
        `Không thanh lý ${before.code} bằng Sửa hồ sơ được. Dùng nút "Thanh lý" để hệ thống ` +
        'kiểm IP, luật NAT và ghế license máy đang giữ.',
    });
  }

  /**
   * Bản tra-rồi-kiểm KHÔNG khoá — chỉ dùng cho đường ĐỌC (dựng gợi ý, kiểm tra sớm để trả lỗi
   * đẹp trước khi làm việc nặng). Đường GHI phải dùng `assertUsableWithin`.
   */
  async assertUsable(id: string): Promise<void> {
    this.assertNotRetired(await this.requireRow(id));
  }

  /**
   * "Máy này còn nhận thêm được không" — bản dùng cho ĐƯỜNG GHI, và nó GIỮ KHOÁ.
   *
   * ===== VÌ SAO BẢN KHÔNG KHOÁ LÀ CHƯA ĐỦ =====
   *
   * `assertUsable` đọc trên pool, trả lời xong là buông. Giữa câu trả lời đó và câu `INSERT`
   * của người gọi có một khoảng, và một lượt thanh lý lọt vừa vào khoảng ấy: nó đếm tài sản
   * (chưa thấy gì), lật `status` sang `retired`, commit. Người gọi ghi tiếp và thành công.
   * Kết quả là một ghế license / một địa chỉ IP vừa được cấp cho máy đã ra khỏi công ty, và
   * KHÔNG bên nào gặp lỗi.
   *
   * `FOR SHARE` đóng khoảng đó: nhiều lượt ghi cùng lúc vẫn chạy song song với nhau (chúng chỉ
   * đọc hàng `device`), nhưng `FOR UPDATE` của lượt thanh lý phải đợi tất cả xong. Chia sẻ —
   * không xếp hàng — là điểm mấu chốt: dùng `FOR UPDATE` ở đây thì hai người cấp IP cho hai
   * máy... vẫn chạy song song, nhưng hai người cấp IP cho CÙNG một máy sẽ nối đuôi nhau vô cớ.
   *
   * Nơi gọi phải truyền `tx` CỦA CHÍNH LƯỢT GHI. Khoá của Postgres sống theo transaction, nên
   * gọi hàm này trên một transaction khác (hay trên pool) là lấy khoá rồi buông ngay — đúng
   * bằng không làm gì.
   */
  async assertUsableWithin(tx: Tx, id: string): Promise<void> {
    this.assertNotRetired(await this.requireRowWithin(tx, id, 'share'));
  }

  /**
   * Hồ sơ hiện tại, đọc TRONG transaction — import cần "trước khi sửa" là trạng thái THẬT.
   *
   * Lấy `before` từ ảnh chụp dựng lúc đối chiếu (`context()`) thì khi tra không thấy nó rơi về
   * `before ?? {}`. Hệ quả: `diffDevice` so hồ sơ mới với một object RỖNG, nên
   * `device_history` ghi "mọi trường đổi từ trống" — một dòng lịch sử BỊA, trong một bảng
   * chỉ-thêm mà FR-007 dựng ra để trả lời "ai đổi gì".
   */
  /**
   * Nhiều hồ sơ một câu, khoá theo THỨ TỰ id: hai lượt ghi hàng loạt cùng lúc khoá cùng thứ tự nên
   * không deadlock nhau. Thiếu hồ sơ nào thì ném như `requireRowWithin`.
   */
  async requireRowsWithin(tx: Tx, ids: string[], lock: 'update' | 'share'): Promise<Map<string, typeof deviceTable.$inferSelect>> {
    const out = new Map<string, typeof deviceTable.$inferSelect>();
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += BULK_CHUNK) {
      const rows = await tx
        .select()
        .from(deviceTable)
        .where(inArray(deviceTable.id, unique.slice(i, i + BULK_CHUNK)))
        .orderBy(asc(deviceTable.id))
        .for(lock);
      for (const row of rows) out.set(row.id, row);
    }
    if (out.size !== unique.length) {
      throw new NotFoundException({ code: 'DEVICE_NOT_FOUND', message: 'Không tìm thấy thiết bị này.' });
    }
    return out;
  }

  async requireRowWithin(
    tx: Pick<Database, 'select'>,
    id: string,
    /**
     * Khoá hàng tới hết transaction. `'update'` cho lượt ĐỔI TRẠNG THÁI (độc quyền),
     * `'share'` cho lượt GHI TÀI SẢN vào máy (nhiều lượt cùng lúc vẫn được, nhưng chặn lượt
     * thanh lý chen vào giữa). Bỏ trống = đọc thuần, không khoá.
     */
    lock?: 'update' | 'share',
  ): Promise<typeof deviceTable.$inferSelect> {
    const query = tx.select().from(deviceTable).where(eq(deviceTable.id, id));
    const rows = await (lock ? query.for(lock) : query);
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'DEVICE_NOT_FOUND',
        message: 'Không tìm thấy thiết bị này.',
      });
    }
    return rows[0];
  }

  private translateWriteError(error: unknown): unknown {
    // Lưới cuối của luật chồng U khi một lượt ghi đi vòng khoá theo tủ (`assertRackFreeWithin`).
    if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION && pgConstraint(error) === 'device_rack_u_no_overlap') {
      return new ConflictException({
        code: 'DEVICE_RACK_U_TAKEN',
        message: 'Chỗ U này trong tủ vừa có máy khác chiếm — tải lại rồi chọn U khác. Hai máy không chồng U trong cùng tủ.',
      });
    }
    // Khoá ngoại (site, tủ) `device_cabinet_same_site_fkey` là lưới cuối khi lượt dời tủ đua với lượt ghi thiết bị (BE-08).
    if (
      pgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION &&
      pgConstraint(error) === 'device_cabinet_same_site_fkey'
    ) {
      return new ConflictException({
        code: 'CABINET_SITE_MISMATCH',
        message: 'Tủ mạng vừa được dời sang site khác — tải lại hồ sơ rồi chọn lại tủ.',
      });
    }
    // Chỉ có đường MỞ LẠI máy đã thanh lý chạm tới khoá này (`device_port_peer_port_key`): cổng máy này từng
    // ghi đấu vào nay đã có máy khác chiếm. Không bắt riêng thì nó rơi xuống câu "trùng mã".
    const peerTaken = conflictOnUnique(
      error,
      {
        code: 'PORT_PEER_TAKEN',
        message:
          'Không đưa lại vào dùng được: port map của máy này đấu vào một cổng nay đã có máy khác chiếm. ' +
          'Sửa hoặc gỡ dòng port map ở máy kia trước.',
      },
      'device_port_peer_port_key',
    );
    if (peerTaken !== error) return peerTaken;
    return conflictOnUnique(error, {
      code: 'DEVICE_CODE_TAKEN',
      message: 'Đã có thiết bị mang mã này (không phân biệt hoa-thường).',
    });
  }
}

const LABEL: Record<string, string> = {
  code: 'mã thiết bị',
  name: 'tên thiết bị',
  deviceTypeId: 'loại thiết bị',
};

/**
 * Cột được phép sắp xếp. Đây là WHITELIST — tên cột đi thẳng vào `ORDER BY`.
 *
 * Chỉ mở những cột nằm SẴN trong bảng `device`. Cột hiển thị qua danh mục (site, tủ, loại)
 * không có ở đây vì sắp theo chúng phải join sang bảng của module khác — vi phạm AD-2. Muốn
 * sắp theo site thì lọc theo site rồi sắp theo mã.
 */
export const DEVICE_SORT_KEYS = [
  'code',
  'name',
  'serial',
  'assignedTo',
  'status',
  'warrantyEnd',
] as const;
export type DeviceSortKey = (typeof DEVICE_SORT_KEYS)[number];
export const DEVICE_SORT_DEFAULT: SortQuery<DeviceSortKey> = { key: 'code', dir: 'asc' };

/** Mở ra cho `api/test/sort-index.spec.ts` đọc `EXPLAIN` của ĐÚNG câu này. */
export function deviceOrderBy(sort: SortQuery<DeviceSortKey>): SQL[] {
  const column = {
    code: deviceTable.code,
    name: deviceTable.name,
    serial: deviceTable.serial,
    assignedTo: deviceTable.assignedTo,
    status: deviceTable.status,
    warrantyEnd: deviceTable.warrantyEnd,
  }[sort.key];
  /*
   * Bảo hành: máy đã thanh lý ("Không tính hạn") và máy chưa khai hạn luôn xuống CUỐI, bất kể
   * chiều sắp — người sắp cột này là đang tìm máy sắp hết hạn, gặp rác ở đầu là phải lật trang.
   * Khớp từng cột với `device_warranty_sort_asc_idx`/`_desc_idx` để không sinh node Sort (sort-index.spec).
   */
  if (sort.key === 'warrantyEnd') {
    const retiredLast = sql`(${deviceTable.status} = 'retired')`;
    return sort.dir === 'desc'
      ? [asc(retiredLast), sql`${deviceTable.warrantyEnd} DESC NULLS LAST`, desc(deviceTable.code)]
      : [asc(retiredLast), sql`${deviceTable.warrantyEnd} ASC NULLS LAST`, asc(deviceTable.code)];
  }
  // Chốt hạ bằng `code`, CÙNG HƯỚNG với cột đang sắp — `orderByStable` giữ luật đó một chỗ,
  // và chú thích ở đó nói vì sao hướng phải đi theo nhau (không thì mất chỉ mục).
  return orderByStable(sort.dir, column, deviceTable.code);
}

function buildWhere(filter: DeviceFilter, extraIds: string[] = []): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  const term = filter.search?.trim();
  if (term) {
    /*
     * Người ta gõ mã, tên, serial, model, người sử dụng hoặc bộ phận — tất cả nằm trong cột
     * sinh `device.search_norm`, đã gấp dấu. `extraIds` là máy mà module khác
     * nhận ra từ khoá (IP) — HỢP chứ không giao, vì cùng một chuỗi số có thể vừa là serial
     * vừa là IP.
     */
    const byText = searchNormLike(deviceTable, term);
    parts.push(extraIds.length > 0 ? or(byText, inArray(deviceTable.id, extraIds)) : byText);
  }
  if (filter.siteId) parts.push(eq(deviceTable.siteId, filter.siteId));
  if (filter.cabinetId) parts.push(eq(deviceTable.cabinetId, filter.cabinetId));
  if (filter.deviceTypeId) parts.push(eq(deviceTable.deviceTypeId, filter.deviceTypeId));
  if (filter.deviceTypeIds?.length) {
    parts.push(inArray(deviceTable.deviceTypeId, filter.deviceTypeIds));
  }
  if (filter.status === 'live') parts.push(ne(deviceTable.status, 'retired'));
  else if (filter.status) parts.push(eq(deviceTable.status, filter.status));
  /*
   * Phòng ban / người sử dụng: KHỚP ĐÚNG sau khi gấp dấu + hoa thường + khoảng trắng thừa,
   * không phải "có chứa". Hộp gán license tick sẵn cả lô theo bộ lọc này — "Kế toán" mà kéo
   * theo "Kế toán tổng hợp" là tiêu nhầm ghế license của phòng khác.
   */
  const department = filter.department?.trim();
  if (department) parts.push(sameText(deviceTable.department, department));
  const assignedTo = filter.assignedTo?.trim();
  if (assignedTo) parts.push(sameText(deviceTable.assignedTo, assignedTo));
  // `usableOnly` KHÔNG chồng lên `status`: ai lọc đích danh `status=retired` thì vẫn được
  // xem, đó là màn Kho thanh lý. Cờ này chỉ để các ô CHỌN thôi bày ra thứ không chọn được.
  if (filter.usableOnly) parts.push(ne(deviceTable.status, 'retired'));
  const defined = parts.filter((part): part is SQL => part !== undefined);
  return defined.length > 0 ? and(...defined) : undefined;
}

/** `ims_norm` là STRICT: cột NULL cho ra NULL → không khớp, đúng ý "máy chưa ghi phòng". */
function sameText(column: SQLWrapper, value: string): SQL {
  return sql`ims_norm(btrim(${column})) = ims_norm(${value})`;
}

/** Chỗ trong tủ sau lượt ghi (giá trị gửi lên ghép với hồ sơ đang có). */
function placementOf(
  values: Record<string, unknown>,
  current: { cabinetId: string | null; rackUStart: number | null; rackUSize: number | null } | null,
): { cabinetId: string | null; start: number | null; size: number | null } {
  const effective = effectiveOf(values);
  return {
    cabinetId: effective<string | null>('cabinetId', current?.cabinetId ?? null),
    start: effective<number | null>('rackUStart', current?.rackUStart ?? null),
    size: effective<number | null>('rackUSize', current?.rackUSize ?? null),
  };
}

function rackTaken(claim: RackClaim, taken: { code: string; name: string }): ConflictException {
  return new ConflictException({
    code: 'DEVICE_RACK_U_TAKEN',
    message: `${rackUnitLabel(claim.start, claim.size)} trong tủ đang có ${taken.code} (${taken.name}) chiếm — hai máy không chồng U trong cùng tủ.`,
  });
}

function toRecord(row: typeof deviceTable.$inferSelect): DeviceRecord {
  return { ...row, status: row.status as DeviceStatus };
}

function text(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function dateOnly(
  value: string | null | undefined,
  label: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!isRealDateOnly(trimmed)) {
    throw new BadRequestException({
      code: 'DATE_INVALID',
      message: `${label} phải là ngày hợp lệ.`,
    });
  }
  return trimmed;
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new BadRequestException({ code: 'FIELD_REQUIRED', message: `Thiếu ${label}.` });
  }
  return trimmed;
}
