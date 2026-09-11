import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { HISTORY_PAGE_LIMIT } from '../../common/history';
import { DeviceRetirementRegistry } from '../../common/device-retirement.registry';
import { requireCas } from '../../common/cas';
import { pageOffset, type Page, type PageQuery } from '../../common/pagination';
import type { SortQuery } from '../../common/sorting';
import { conflictOnUnique, escapeLike } from '../../common/sql';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CatalogApiService } from '../catalog/catalog.api';
import { diffDevice, hasChanges, type DeviceChanges } from './device-changes';
import { deviceHistoryTable, deviceTable } from './devices.schema';
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
}

/**
 * Chủ sở hữu `device` + `device_history` (AD-3).
 * Danh mục lấy qua `CatalogApiService` — KHÔNG join sang bảng site/cabinet/... (AD-2).
 */
@Injectable()
export class DevicesService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly catalog: CatalogApiService,
    private readonly audit: AuditWriterService,
    private readonly retirement: DeviceRetirementRegistry,
  ) {}

  // ─────────────────────────── Đọc ───────────────────────────

  async list(
    query: PageQuery,
    filter: DeviceFilter,
    sort: SortQuery<DeviceSortKey> = DEVICE_SORT_DEFAULT,
  ): Promise<Page<DeviceListItem>> {
    const where = buildWhere(filter);
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
      .where(buildWhere(filter))
      // Cùng thứ tự với màn hình: file tải về phải khớp thứ tự người dùng đang nhìn, không
      // thì họ mở file ra và tưởng đây là dữ liệu khác.
      .orderBy(...deviceOrderBy(sort));
    return this.decorate(rows);
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

    const device = await this.db.transaction(async (tx) => {
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
   * Bản trước chỉ lật một chữ trong cột `status`. Máy đã ra khỏi công ty, đã ký biên bản,
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
       * Bản trước đọc `requireRow` và đếm `holdings` NGOÀI transaction rồi mới mở transaction
       * để ghi — đúng mẫu "M2" mà `common/cas.ts` mô tả, và ở đây nó hỏng theo hai đường:
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
              'Gỡ những thứ này trước, hoặc tick "Dọn hết thứ liên quan" để hệ thống trả lại ' +
              'trong cùng lượt thanh lý.',
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

  /** Dùng chung cho import hàng loạt (story 2.6) — đã có transaction bao ngoài. */
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
       * Trúng 0 dòng là CHUYỆN CÓ THẬT, không phải trường hợp không xảy ra (rà soát 07/09 #10).
       *
       * Hồ sơ bị xóa xen giữa lúc đối chiếu và lúc ghi thì câu này khớp 0 dòng và Postgres
       * KHÔNG báo lỗi. Bản trước `toRecord(rows[0])` đọc `.status` của `undefined` → TypeError,
       * tức người dùng nhận 500 với câu "Cannot read properties of undefined" thay vì một câu
       * nói đúng chuyện gì đã xảy ra. Bản catalog còn tệ hơn: nó `as unknown as` nên trả về
       * `undefined` trong IM LẶNG và bộ đếm import vẫn +1.
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
    // ném ra một câu SQL. Phải ghép với giá trị ĐANG CÓ khi người dùng chỉ sửa một đầu.
    const current = id ? await this.requireRow(id) : null;
    const start = (values.warrantyStart ?? current?.warrantyStart ?? null) as string | null;
    const end = (values.warrantyEnd ?? current?.warrantyEnd ?? null) as string | null;
    if (start && end && end < start) {
      throw new BadRequestException({
        code: 'WARRANTY_RANGE_INVALID',
        message: 'Ngày kết thúc bảo hành phải sau ngày bắt đầu.',
      });
    }

    const errors = await this.catalog.validateRefs({
      siteId: (values.siteId ?? current?.siteId ?? null) as string | null,
      cabinetId: (values.cabinetId ?? current?.cabinetId ?? null) as string | null,
      deviceTypeId: (values.deviceTypeId ?? current?.deviceTypeId ?? null) as string | null,
      vendorId: (values.vendorId ?? current?.vendorId ?? null) as string | null,
    });
    if (errors.length > 0) {
      throw new BadRequestException({ code: 'CATALOG_REF_INVALID', message: errors.join(' ') });
    }
    return values;
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
   * module này (sửa hồ sơ · nối cổng · import) đều đi qua đây. Trước 08/09 chỉ có cửa ngoài,
   * nên bốn module khác bị chặn còn ba đường trong nhà thì không — đúng mẫu N1: dựng hàng rào
   * ở mấy cửa mình buộc phải bước qua, quên mấy cửa mở sẵn bên trong.
   *
   * `broken` (hỏng, chờ sửa) VẪN qua: máy đó còn trong công ty, còn giữ license và IP của nó.
   * Chỉ `retired` mới là "đã ra khỏi sổ".
   */
  assertNotRetired(row: { code: string; status: string }): void {
    if (row.status !== 'retired') return;
    throw new BadRequestException({
      code: 'DEVICE_RETIRED',
      message: `Thiết bị ${row.code} đã thanh lý nên không nhận thêm được nữa. Chọn thiết bị khác, hoặc mở lại hồ sơ trong Kho thanh lý nếu thanh lý nhầm.`,
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
   * Bản trước import lấy `before` từ ảnh chụp dựng lúc đối chiếu (`context()`), và khi tra
   * không thấy thì rơi về `before ?? {}`. Hệ quả: `diffDevice` so hồ sơ mới với một object
   * RỖNG, nên `device_history` ghi "mọi trường đổi từ trống" — một dòng lịch sử BỊA, trong
   * một bảng chỉ-thêm mà FR-007 dựng ra để trả lời "ai đổi gì" (rà soát 07/09 #10).
   */
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

function deviceOrderBy(sort: SortQuery<DeviceSortKey>): SQL[] {
  const column = {
    code: deviceTable.code,
    name: deviceTable.name,
    serial: deviceTable.serial,
    assignedTo: deviceTable.assignedTo,
    status: deviceTable.status,
    warrantyEnd: deviceTable.warrantyEnd,
  }[sort.key];
  const primary = sort.dir === 'desc' ? desc(column) : asc(column);
  // Chốt hạ bằng `code`: thiếu nó thì hai máy cùng trạng thái có thể đổi chỗ nhau giữa hai
  // lần tải — sang trang 2 lại thấy đúng bản ghi vừa xem ở trang 1, hoặc mất hẳn một dòng.
  return sort.key === 'code' ? [primary] : [primary, asc(deviceTable.code)];
}

function buildWhere(filter: DeviceFilter): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  const term = filter.search?.trim();
  if (term) {
    const like = `%${escapeLike(term)}%`;
    // Tra cứu thực tế: người ta gõ mã, tên, serial hoặc model — tìm cả bốn trong một ô.
    parts.push(
      or(
        sql`${deviceTable.code}::text ILIKE ${like}`,
        sql`${deviceTable.name} ILIKE ${like}`,
        sql`${deviceTable.serial} ILIKE ${like}`,
        sql`${deviceTable.model} ILIKE ${like}`,
      ),
    );
  }
  if (filter.siteId) parts.push(eq(deviceTable.siteId, filter.siteId));
  if (filter.cabinetId) parts.push(eq(deviceTable.cabinetId, filter.cabinetId));
  if (filter.deviceTypeId) parts.push(eq(deviceTable.deviceTypeId, filter.deviceTypeId));
  if (filter.status) parts.push(eq(deviceTable.status, filter.status));
  // `usableOnly` KHÔNG chồng lên `status`: ai lọc đích danh `status=retired` thì vẫn được
  // xem, đó là màn Kho thanh lý. Cờ này chỉ để các ô CHỌN thôi bày ra thứ không chọn được.
  if (filter.usableOnly) parts.push(ne(deviceTable.status, 'retired'));
  const defined = parts.filter((part): part is SQL => part !== undefined);
  return defined.length > 0 ? and(...defined) : undefined;
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
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
