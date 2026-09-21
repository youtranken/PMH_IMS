import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { HISTORY_PAGE_LIMIT } from '../../common/history';
import { escapeLike, pgErrorCode, PG_CHECK_VIOLATION } from '../../common/sql';
import { requireCas } from '../../common/cas';
import { effectiveOf } from '../../common/merge-effective';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CatalogApiService } from '../catalog/catalog.api';
import { DevicesApiService } from '../devices/devices.api';
import { IpAddressService } from './ip-address.service';
import {
  describePortRange,
  natChanges,
  protocolsOverlap,
  rangesOverlap,
  validateNatRule,
  type NatRuleSnapshot,
} from './nat-rules';
import { hostOf } from './ip-rules';
// `isOccupying` là MỘT nguồn sự thật cho "địa chỉ này đang có máy chiếm" (ip-lifecycle.ts).
// Cảnh báo dưới đây phải dùng đúng nó, không tự liệt kê lại danh sách trạng thái.
import { isOccupying, type IpStatus } from './ip-lifecycle';
import { ipAddressTable, natRuleHistoryTable, natRuleTable } from './ipam.schema';

export interface NatRuleHistoryRecord {
  id: string;
  natRuleId: string;
  action: string;
  actor: string;
  changes: Record<string, unknown> | null;
  createdAt: Date;
}

export const NAT_PROTOCOLS = ['tcp', 'udp', 'both'] as const;
export type NatProtocol = (typeof NAT_PROTOCOLS)[number];

/** SQLSTATE của vi phạm EXCLUDE — Postgres dùng chung mã với vi phạm ràng buộc loại trừ. */
const PG_EXCLUSION_VIOLATION = '23P01';

export interface NatRuleRecord {
  id: string;
  deviceId: string;
  deviceCode: string | null;
  deviceName: string | null;
  siteCode: string | null;
  protocol: NatProtocol;
  externalFrom: number;
  externalTo: number;
  externalPorts: string;
  internalIp: string;
  internalPort: number;
  ipAddressId: string | null;
  /** Chủ của IP trong, tra qua hồ sơ IP — trả lời "port này dẫn tới máy của ai". */
  internalOwner: string | null;
  /**
   * MÁY ĐÍCH — thiết bị đang được NAT, suy từ hồ sơ IP của `internalIp`.
   *
   * Khác hẳn `deviceId` ở trên: cái kia là con router THỰC HIỆN NAT (Draytek), cái này là
   * con máy ĐƯỢC NAT (camera, NAS, máy chủ). Trước đây bảng chỉ có IP trần nên câu "port
   * này dẫn tới máy nào trong kho" phải tự tra bằng mắt qua màn IP.
   *
   * Không thêm cột: IPAM đã là nguồn sự thật của map IP → thiết bị, chép thêm một cột nữa
   * là có hai chỗ cùng trả lời một câu và chúng sẽ lệch nhau.
   */
  internalDeviceId: string | null;
  internalDeviceCode: string | null;
  usedBy: string;
  reason: string;
  enabled: boolean;
  note: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  /** Chỉ có ở kết quả ghi: điều đáng nói nhưng không đủ để chặn (vd mở dải >1000 cổng). */
  warnings?: string[];
}

export interface NatRuleInput {
  deviceId: string;
  protocol: NatProtocol;
  externalFrom: number;
  externalTo: number;
  internalIp: string;
  internalPort: number;
  usedBy: string;
  reason: string;
  enabled?: boolean;
  note?: string | null;
}

/**
 * Sổ NAT / port-forward (story 5.3, FR-017).
 *
 * Bảng này tồn tại để trả lời đúng ba câu của auditor: **port nào mở, vì sao, cho ai**.
 * Mọi quyết định thiết kế ở đây quy về việc giữ ba câu đó luôn có câu trả lời DUY NHẤT —
 * nên `reason`/`usedBy` bắt buộc, và hai rule chồng port ngoài bị chặn ở tầng DB.
 */
@Injectable()
export class NatRuleService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly devices: DevicesApiService,
    private readonly addresses: IpAddressService,
    private readonly catalog: CatalogApiService,
  ) {}

  async list(filters: { deviceId?: string; siteId?: string; search?: string } = {}): Promise<
    NatRuleRecord[]
  > {
    const where: SQL[] = [isNull(natRuleTable.voidedAt)];
    if (filters.deviceId) where.push(eq(natRuleTable.deviceId, filters.deviceId));
    if (filters.search?.trim()) {
      const text = filters.search.trim();
      const term = `%${escapeLike(text)}%`;
      const conditions: SQL[] = [
        sql`${natRuleTable.usedBy} ILIKE ${term}`,
        sql`${natRuleTable.reason} ILIKE ${term}`,
        sql`host(${natRuleTable.internalIp}) ILIKE ${term}`,
      ];
      /**
       * Gõ một SỐ thì tìm theo port, và tìm cả BÊN TRONG khoảng.
       *
       * Bản trước chỉ so `external_from::text` — nên rule `8000-8010` không tìm thấy khi gõ
       * `8005` hay `8010`, và người tra kết luận là port đang trống (code review Epic 5,
       * finding 6). Người tạo rule mới còn được lỗi 409 cứu; auditor chỉ đọc thì nhận thẳng
       * một câu trả lời sai.
       */
      const port = Number(text);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) {
        conditions.push(
          sql`${natRuleTable.externalFrom} <= ${port} AND ${natRuleTable.externalTo} >= ${port}`,
        );
        conditions.push(sql`${natRuleTable.internalPort} = ${port}`);
      }
      where.push(or(...conditions) as SQL);
    }

    const rows = await this.db
      .select()
      .from(natRuleTable)
      .where(and(...where))
      .orderBy(asc(natRuleTable.externalFrom));
    const decorated = await this.decorate(rows);

    /**
     * Lọc theo site làm ở TẦNG ỨNG DỤNG, không join bảng `device`.
     *
     * Site của một rule là site của cái router mang nó, mà `device` là bảng của module khác —
     * join thẳng là phá AD-2/AD-3. Ở quy mô vài trăm rule thì lọc sau khi tra là đủ nhanh;
     * đắt hơn thì mới tính tới việc mở thêm hàm trên `devices.api`.
     */
    if (!filters.siteId) return decorated;
    const site = await this.siteCodeOf(filters.siteId);
    /**
     * Site không tra ra được (đã xóa, hoặc bookmark cũ mang id lạ) → trả RỖNG.
     *
     * Bản trước để `site = null` rồi lọc `siteCode === null`, nên nó trả về đúng những rule
     * của router KHÔNG gắn site — một tập khác hẳn, không rỗng, và auditor đọc thành "đây là
     * các rule của site X" (code review Epic 5, finding 3). Export dùng chung đường này nên
     * con số sai đi thẳng vào file nộp.
     */
    if (site === null) return [];
    return decorated.filter((rule) => rule.siteCode === site);
  }

  listForDevice(deviceId: string): Promise<NatRuleRecord[]> {
    return this.list({ deviceId });
  }

  async findOne(id: string): Promise<NatRuleRecord> {
    return (await this.decorate([await this.requireAlive(id)]))[0];
  }

  async create(actor: string, input: NatRuleInput): Promise<NatRuleRecord> {
    // Chuẩn hóa IP TRƯỚC mọi thứ: `linkIp` so chuỗi thô với `host(address)`, nên một dấu cách
    // thừa là không nối được vào hồ sơ IP dù hồ sơ đó có thật (code review Epic 5, finding 5).
    const clean: NatRuleInput = { ...input, internalIp: input.internalIp.trim() };
    const warnings = this.requireValid(clean);
    await this.requireNoProtocolOverlap(clean, null);
    const ip = await this.lookupIp(clean.internalIp);
    const ipAddressId = ip?.id ?? null;
    warnings.push(...this.warnIfUnowned(ip, clean.internalIp));

    try {
      const row = await this.db.transaction(async (tx) => {
        await this.requireDraytekWithin(tx, clean.deviceId);
        const rows = await tx
          .insert(natRuleTable)
          .values({
            deviceId: clean.deviceId,
            protocol: clean.protocol,
            externalFrom: clean.externalFrom,
            externalTo: clean.externalTo,
            internalIp: clean.internalIp,
            internalPort: clean.internalPort,
            ipAddressId,
            usedBy: clean.usedBy.trim(),
            reason: clean.reason.trim(),
            enabled: clean.enabled ?? true,
            note: clean.note?.trim() || null,
            createdBy: actor,
          })
          .returning();
        await this.audit.appendWithin(tx, {
          actor,
          action: 'nat.created',
          objectType: 'nat_rule',
          objectId: rows[0].id,
          detail: {
            deviceId: clean.deviceId,
            ports: describePortRange(clean.externalFrom, clean.externalTo),
            internalIp: clean.internalIp,
            reason: clean.reason.trim(),
          },
        });
        await this.recordWithin(tx, actor, rows[0].id, 'created', {
          ports: { before: null, after: describePortRange(clean.externalFrom, clean.externalTo) },
          protocol: { before: null, after: clean.protocol },
          internalIp: { before: null, after: clean.internalIp },
          internalPort: { before: null, after: clean.internalPort },
          usedBy: { before: null, after: clean.usedBy.trim() },
          reason: { before: null, after: clean.reason.trim() },
        });
        return rows[0];
      });
      return { ...(await this.decorate([row]))[0], warnings };
    } catch (error) {
      throw this.translate(error, clean);
    }
  }

  /**
   * Một ô BẮT BUỘC sau khi ghép: phải có giá trị thật, nếu không thì 400 nói rõ thiếu ô nào.
   *
   * Chuỗi rỗng cũng bị chặn ở đây, và đó là vế đắt nhất. `NatBodyDto` CỐ Ý cho `''` đi qua
   * cửa DTO (chú thích `ipam.controller.ts:102-115`: màn Sổ NAT khởi tạo ô router bằng
   * `useState('')`), với lập luận rằng `requireDeviceId()` ở `POST` sẽ bắt nó. Lập luận đó
   * đúng với `POST` và KHÔNG đúng với `PATCH` — đường sửa không có ai bắt, nên `''` chạy
   * thẳng tới `SET device_id = ''` và Postgres ném `22P02`, tức một **500** cho một lỗi
   * nhập liệu. Đo ngày 21/09 trên stack thật trước khi vá.
   */
  private requireField<T>(value: T | null | undefined, label: string): T {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
      throw new BadRequestException({ code: 'FIELD_REQUIRED', message: `Chưa chọn ${label}.` });
    }
    return value;
  }

  async update(actor: string, id: string, input: Partial<NatRuleInput>): Promise<NatRuleRecord> {
    const before = await this.requireAlive(id);

    /**
     * GHÉP BẰNG `effectiveOf`, KHÔNG BẰNG `??` — A-03, rà soát 19/09.
     *
     * Đợt B quét mẫu `?? current?.` và sửa ba file. Mẫu đó bỏ lọt chính chỗ này, nơi biến cũ
     * tên là `before`. Sót tới 21/09, tìm ra ở lượt rà soát chéo — và bài học nằm ở CÁCH
     * QUÉT chứ không ở mười dòng dưới đây: một mẫu grep hẹp cho cảm giác đã soi hết.
     *
     * `??` bóp hai ý định khác nhau thành một: "không gửi khoá này" (giữ nguyên) và "gửi
     * `null`" (xoá đi). Với `note` — ô DUY NHẤT xoá được — đó là mất dữ liệu im lặng: người
     * dùng xoá ghi chú, bấm Lưu, hệ thống trả 200 và giữ nguyên chữ cũ.
     *
     * Chín ô còn lại KHÔNG xoá được. Với chúng, một `null` gửi lên là lỗi của người gọi, nên
     * `requireField` trả 400 nói rõ thiếu gì — thay vì âm thầm dùng lại giá trị cũ, mà im
     * lặng thì người gọi tưởng bản sửa đã vào.
     */
    const effective = effectiveOf(input);
    const merged: NatRuleInput = {
      deviceId: this.requireField(effective<string | null>('deviceId', before.deviceId), 'router'),
      protocol: this.requireField(
        effective<NatProtocol | null>('protocol', before.protocol as NatProtocol),
        'giao thức',
      ),
      externalFrom: this.requireField(
        effective<number | null>('externalFrom', before.externalFrom),
        'port ngoài',
      ),
      externalTo: this.requireField(
        effective<number | null>('externalTo', before.externalTo),
        'port ngoài',
      ),
      internalIp: this.requireField(
        effective<string | null>('internalIp', hostOf(before.internalIp)),
        'IP nội bộ',
      ).trim(),
      internalPort: this.requireField(
        effective<number | null>('internalPort', before.internalPort),
        'port nội bộ',
      ),
      usedBy: this.requireField(effective<string | null>('usedBy', before.usedBy), 'người dùng'),
      reason: this.requireField(effective<string | null>('reason', before.reason), 'lý do'),
      enabled: effective<boolean | undefined>('enabled', before.enabled),
      // Ô DUY NHẤT xoá được: `null` ở đây là một ý định, không phải một thiếu sót.
      note: effective<string | null>('note', before.note),
    };
    /**
     * Kiểm trên giá trị ĐÃ TRỘN với bản ghi cũ, không phải trên mỗi phần gửi lên.
     *
     * Sửa mỗi `externalTo` mà kiểm riêng nó thì "8010 hợp lệ" — trong khi hàng sau khi sửa
     * lại là 8020-8010, ngược đầu. Đúng bài học của import thiết bị ở Epic 2.
     */
    const warnings = this.requireValid(merged);
    await this.requireNoProtocolOverlap(merged, id);

    /*
     * Chỉ tra lại sổ IP khi địa chỉ THẬT SỰ đổi. Sửa mỗi cái ghi chú mà cũng bắn cảnh báo
     * "IP không có chủ" thì cảnh báo mất giá — và cảnh báo mất giá thì không ai đọc nữa.
     */
    const ip = input.internalIp !== undefined ? await this.lookupIp(merged.internalIp) : null;
    if (input.internalIp !== undefined) {
      warnings.push(...this.warnIfUnowned(ip, merged.internalIp));
    }
    const ipAddressId = input.internalIp !== undefined ? (ip?.id ?? null) : before.ipAddressId;

    try {
      const row = await this.db.transaction(async (tx) => {
        if (input.deviceId) await this.requireDraytekWithin(tx, input.deviceId);
        const rows = await tx
          .update(natRuleTable)
          .set({
            deviceId: merged.deviceId,
            protocol: merged.protocol,
            externalFrom: merged.externalFrom,
            externalTo: merged.externalTo,
            internalIp: merged.internalIp,
            internalPort: merged.internalPort,
            ipAddressId,
            usedBy: merged.usedBy.trim(),
            reason: merged.reason.trim(),
            enabled: merged.enabled ?? true,
            note: merged.note?.trim() || null,
            updatedAt: new Date(),
          })
          /**
           * `isNull(voidedAt)` trong chính câu UPDATE, không chỉ ở `requireAlive` phía trên.
           *
           * Hai người cùng lúc: A gỡ rule, B bấm Lưu — không có điều kiện này thì bản sửa của
           * B ghi đè lên một hàng ĐÃ gỡ, đẻ ra một dòng audit `nat.updated` cho rule không còn
           * trong sổ, và bản sửa biến mất vĩnh viễn mà không ai biết (code review Epic 5,
           * finding 8). Có điều kiện thì người thua thấy lỗi ngay.
           */
          .where(and(eq(natRuleTable.id, id), isNull(natRuleTable.voidedAt)))
          .returning();
        if (rows.length === 0) {
          throw new ConflictException({
            code: 'NAT_ALREADY_REMOVED',
            message: 'Rule này vừa bị người khác gỡ. Tải lại danh sách rồi thao tác lại.',
          });
        }
        await this.audit.appendWithin(tx, {
          actor,
          action: 'nat.updated',
          objectType: 'nat_rule',
          objectId: id,
          detail: {
            ports: describePortRange(merged.externalFrom, merged.externalTo),
            internalIp: merged.internalIp,
            enabled: merged.enabled,
          },
        });
        /*
         * Lịch sử chỉ ghi ô THẬT SỰ đổi — `audit_log` ở trên vốn chép nguyên trạng thái sau.
         * Hai bảng trả lời hai câu: audit là "đã có lệnh ghi nào chạy", lịch sử là "cái gì đổi
         * từ đâu sang đâu". Chép cả bản ghi vào lịch sử thì mỗi lần sửa một ô cũng ra một dòng
         * mười trường giống hệt nhau, và người đọc phải tự dò xem chỗ nào khác.
         */
        const changes = natChanges(snapshotOf(before), {
          ports: describePortRange(merged.externalFrom, merged.externalTo),
          protocol: merged.protocol,
          internalIp: merged.internalIp,
          internalPort: merged.internalPort,
          usedBy: merged.usedBy.trim(),
          reason: merged.reason.trim(),
          enabled: merged.enabled ?? true,
          note: merged.note?.trim() || null,
        });
        if (Object.keys(changes).length > 0) {
          await this.recordWithin(tx, actor, id, 'updated', changes);
        }
        return rows[0];
      });
      return { ...(await this.decorate([row]))[0], warnings };
    } catch (error) {
      throw this.translate(error, merged);
    }
  }

  /**
   * "Xóa" = ẩn kèm lý do (quyết định 2026-08-23), và ở bảng này lý do còn quan trọng hơn:
   * "port 8080 đóng ngày nào, ai đóng, vì sao" là câu hỏi sẽ có người hỏi.
   */
  async voidRule(actor: string, id: string, reason: string): Promise<void> {
    await this.db.transaction((tx) => this.voidWithin(tx, actor, id, reason));
  }

  /**
   * Thân của `voidRule`, chạy trong transaction CÓ SẴN — để lượt thanh lý máy gỡ được cả chùm
   * rule trong cùng một transaction với lượt đổi trạng thái thiết bị. Một bản logic, hai lối vào.
   */
  async voidWithin(tx: Tx, actor: string, id: string, reason: string): Promise<void> {
    const before = await this.requireAliveWithin(tx, id);
    const text = reason.trim();
    if (!text) {
      throw new BadRequestException({
        code: 'VOID_REASON_REQUIRED',
        message: 'Nói rõ vì sao gỡ rule này (vd "dịch vụ đã ngừng").',
      });
    }
    {
      /*
       * VỊ TỪ `voided_at IS NULL` ĐI CÙNG CÂU GHI (mẫu CAS — `common/cas.ts`).
       *
       * `requireAliveWithin` ở đầu hàm đọc rồi quyết định, nhưng câu UPDATE bên dưới trước đây
       * ghi VÔ ĐIỀU KIỆN. Mức cô lập là READ COMMITTED, nên hai lượt gỡ cùng một rule chen
       * nhau vừa khít: cả hai đọc thấy rule còn sống, cả hai ghi đè `voided_at`/`voided_by`/
       * `void_reason`, và lượt sau đè lên lượt trước.
       *
       * Thứ mất đi không phải trạng thái — rule vẫn bị gỡ, đó là thứ người dùng muốn. Thứ mất
       * là SỔ: `nat_rule_history` và `audit_log` nhận HAI dòng "đã gỡ" cho MỘT lần gỡ, với hai
       * người và hai lý do khác nhau, còn hàng thật thì mang lý do của người bấm sau. "Port
       * 8080 đóng ngày nào, ai đóng, vì sao" — câu mà chú thích của `voidForDeviceWithin` nói
       * là sẽ có người hỏi — có hai câu trả lời mâu thuẫn và không cách nào biết câu nào đúng.
       */
      const voided = await tx
        .update(natRuleTable)
        .set({ voidedAt: new Date(), voidedBy: actor, voidReason: text })
        .where(and(eq(natRuleTable.id, id), isNull(natRuleTable.voidedAt)))
        .returning({ id: natRuleTable.id });
      requireCas(voided, {
        code: 'NAT_ALREADY_VOIDED',
        message: 'Rule này vừa được người khác gỡ. Tải lại sổ NAT để xem trạng thái mới.',
      });
      await this.audit.appendWithin(tx, {
        actor,
        action: 'nat.voided',
        objectType: 'nat_rule',
        objectId: id,
        detail: {
          ports: describePortRange(before.externalFrom, before.externalTo),
          internalIp: hostOf(before.internalIp),
          reason: text,
        },
      });
      await this.recordWithin(tx, actor, id, 'voided', {
        ports: {
          before: describePortRange(before.externalFrom, before.externalTo),
          after: describePortRange(before.externalFrom, before.externalTo),
        },
        reason: { before: null, after: text },
      });
    }
  }

  /**
   * Rule NAT còn sống mà một thiết bị "dính" tới, theo HAI đường — và cả hai đều cần.
   *
   *   1. rule NẰM TRÊN chính máy đó (máy là router đang bị thanh lý);
   *   2. rule TRỎ VÀO một trong các IP của máy đó — và rule này thường nằm trên MỘT ROUTER
   *      KHÁC. Đây là đường của kịch bản camera: camera bị thanh lý, còn rule 8080 thì nằm
   *      trên con Draytek. Chỉ nhìn `device_id` là bỏ sót đúng cái nguy hiểm.
   *
   * Khớp IP theo `internal_ip` chứ không theo `ip_address_id`, cùng lý do đã ghi ở
   * `IpAddressService.assertNoLiveNatWithin`: cột liên kết đó có thể null.
   */
  async rulesTouchingDevice(
    tx: Pick<Database, 'select'>,
    deviceId: string,
    addresses: string[],
  ): Promise<{ id: string; label: string }[]> {
    const reach: SQL[] = [eq(natRuleTable.deviceId, deviceId)];
    if (addresses.length > 0) {
      reach.push(sql`host(${natRuleTable.internalIp}) IN ${addresses.map((a) => hostOf(a))}`);
    }
    const rows = await tx
      .select({
        id: natRuleTable.id,
        protocol: natRuleTable.protocol,
        externalFrom: natRuleTable.externalFrom,
        externalTo: natRuleTable.externalTo,
        internalIp: natRuleTable.internalIp,
      })
      .from(natRuleTable)
      .where(and(isNull(natRuleTable.voidedAt), or(...reach)))
      .orderBy(asc(natRuleTable.externalFrom));
    return rows.map((row) => ({
      id: row.id,
      label: `${row.protocol.toUpperCase()} ${describePortRange(row.externalFrom, row.externalTo)} → ${hostOf(row.internalIp)}`,
    }));
  }

  /**
   * Gỡ mọi rule mà thiết bị này dính tới, TRONG transaction của lượt thanh lý.
   *
   * Đi qua `voidWithin` chứ không tự UPDATE hàng loạt: mỗi rule vẫn phải có dòng `audit` và
   * dòng `nat_rule_history` của riêng nó. "Port 8080 đóng ngày nào, ai đóng, vì sao" là câu
   * hỏi sẽ có người hỏi — và câu trả lời "vì máy bị thanh lý" chỉ có giá trị khi nó nằm ở
   * từng rule, không phải ở một dòng tổng.
   */
  async voidForDeviceWithin(
    tx: Tx,
    actor: string,
    deviceId: string,
    addresses: string[],
    reason: string,
  ): Promise<void> {
    for (const rule of await this.rulesTouchingDevice(tx, deviceId, addresses)) {
      await this.voidWithin(tx, actor, rule.id, reason);
    }
  }

  /**
   * Chỉ LỖI mới chặn. Cảnh báo (vd mở dải hơn 1000 cổng) được trả về để nơi gọi hiện cho
   * người dùng — chặn nó là mâu thuẫn với chính thông điệp "nếu đúng ý thì cứ lưu", và làm
   * dải port camera không bao giờ vào nổi sổ (code review Epic 5, finding 1).
   */
  private requireValid(input: NatRuleInput): string[] {
    const { errors, warnings } = validateNatRule({
      externalFrom: input.externalFrom,
      externalTo: input.externalTo,
      internalIp: input.internalIp,
      internalPort: input.internalPort,
      usedBy: input.usedBy,
      reason: input.reason,
    });
    if (errors.length > 0) {
      throw new BadRequestException({ code: 'NAT_INVALID', message: errors.join(' ') });
    }
    return warnings;
  }

  /**
   * Chặn `both` chồng lên `tcp`/`udp` (và ngược lại) trên cùng router.
   *
   * Ràng buộc `EXCLUDE` của DB so `protocol WITH =` nên nó KHÔNG thấy chuyện này — mà `both`
   * theo định nghĩa phủ cả hai giao thức. Không chặn thì sổ có hai câu trả lời cho TCP/8080,
   * đúng thứ bảng này sinh ra để tránh (code review Epic 5, finding 4).
   *
   * `tcp` vs `udp` vẫn cho qua: Draytek khai riêng hai giao thức cùng port là việc hợp lệ.
   */
  private async requireNoProtocolOverlap(
    input: NatRuleInput,
    excludeId: string | null,
  ): Promise<void> {
    const siblings = await this.db
      .select()
      .from(natRuleTable)
      .where(and(eq(natRuleTable.deviceId, input.deviceId), isNull(natRuleTable.voidedAt)));

    const clash = siblings.find(
      (row) =>
        row.id !== excludeId &&
        protocolsOverlap(row.protocol, input.protocol) &&
        rangesOverlap(row.externalFrom, row.externalTo, input.externalFrom, input.externalTo),
    );
    if (!clash) return;

    throw new ConflictException({
      code: 'NAT_PORT_OVERLAP',
      message:
        `Port ngoài ${describePortRange(input.externalFrom, input.externalTo)} ` +
        `(${input.protocol.toUpperCase()}) đụng rule đang có: ` +
        `${clash.protocol.toUpperCase()} ${describePortRange(clash.externalFrom, clash.externalTo)}. ` +
        'Sổ NAT chỉ được có MỘT câu trả lời cho mỗi port — sửa rule cũ hoặc gỡ nó trước.',
    });
  }

  /**
   * Rule NAT phải gắn vào một thiết bị CÓ THẬT. Không ép phải là Draytek ở tầng dữ liệu:
   * story nói "thiết bị Draytek", nhưng hôm nào PMH đổi sang hãng khác thì cuốn sổ vẫn phải
   * dùng được — chặn theo hãng chỉ tổ đẻ ra một loại thiết bị giả để lách.
   */
  private async requireDraytekWithin(tx: Tx, deviceId: string): Promise<void> {
    // Router ĐÃ THÁO thì rule trỏ vào hư không — mở port trên một hộp không còn cắm điện chỉ
    // làm sổ NAT nói dối về việc "port nào đang mở" (rà soát 07/09).
    //
    // Bản `Within` và có khoá: hỏi trên pool rồi mới mở transaction là chừa lại đúng khoảng hở
    // để lượt thanh lý router chen vào giữa (xem `DevicesApiService.assertUsableWithin`).
    await this.devices.assertUsableWithin(tx, deviceId);
  }

  /** Nối mềm sang hồ sơ IP nếu có — không có cũng lưu được, chỉ là mất đường bấm sang. */
  private async linkIp(internalIp: string): Promise<string | null> {
    return (await this.lookupIp(internalIp))?.id ?? null;
  }

  /** Hồ sơ IP tương ứng (nếu có) kèm TRẠNG THÁI — `linkIp` chỉ cần id, cảnh báo cần cả hai. */
  private async lookupIp(
    internalIp: string,
  ): Promise<{ id: string; status: IpStatus } | null> {
    const rows = await this.db
      .select({ id: ipAddressTable.id, status: ipAddressTable.status })
      .from(ipAddressTable)
      .where(
        and(
          sql`host(${ipAddressTable.address}) = ${internalIp}`,
          isNull(ipAddressTable.voidedAt),
        ),
      );
    const row = rows[0];
    return row ? { id: row.id, status: row.status as IpStatus } : null;
  }

  /**
   * Rule trỏ vào một địa chỉ mà sổ IP nói là KHÔNG CÓ CHỦ — cảnh báo, không chặn.
   *
   * Vế đối xứng của hàng rào ở `IpAddressService.assertNoLiveNatWithin` (rà soát 07/09, #6).
   * Bên kia chặn cứng vì ở đó quyền sở hữu đang đổi chủ và port sẽ trỏ nhầm máy. Bên này chỉ
   * nói, vì người trực hay khai rule TRƯỚC khi dựng xong máy và cập nhật sổ IP sau — chặn ở
   * đây là chặn một việc hợp lệ, và một hàng rào chặn việc hợp lệ là hàng rào sẽ bị tìm cách
   * lách.
   *
   * Địa chỉ KHÔNG có hồ sơ IPAM thì im lặng: `linkIp` vốn cho phép ("không có cũng lưu được"),
   * và kêu ở đó chỉ tạo tiếng ồn cho mọi rule trỏ ra ngoài phạm vi IPAM đang quản.
   */
  private warnIfUnowned(ip: { status: IpStatus } | null, internalIp: string): string[] {
    if (!ip || isOccupying(ip.status)) return [];
    return [
      ip.status === 'reclaimed'
        ? `${internalIp} đang ở trạng thái "đã thu hồi" trong sổ IP — rule này sẽ mở port vào một địa chỉ không còn chủ. Kiểm tra lại sổ IP.`
        : `${internalIp} đang ở trạng thái "trống" trong sổ IP — chưa cấp cho máy nào. Kiểm tra lại sổ IP.`,
    ];
  }

  /** Đổi id site → mã site, vì `devices.api` trả về MÃ chứ không trả id. */
  private async siteCodeOf(siteId: string): Promise<string | null> {
    const lists = await this.catalog.lists({ includeInactive: true });
    return lists.sites.find((site) => site.id === siteId)?.code ?? null;
  }

  /** Lịch sử nghiệp vụ của MỘT rule, mới nhất lên đầu (AD-13). */
  async history(id: string): Promise<NatRuleHistoryRecord[]> {
    await this.requireAny(id);
    const rows = await this.db
      .select()
      .from(natRuleHistoryTable)
      .where(eq(natRuleHistoryTable.natRuleId, id))
      .orderBy(desc(natRuleHistoryTable.createdAt))
      .limit(HISTORY_PAGE_LIMIT);
    return rows.map((row) => ({
      id: row.id,
      natRuleId: row.natRuleId,
      action: row.action,
      actor: row.actor,
      changes: (row.changes as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
    }));
  }

  /*
   * Ghi lịch sử TRONG transaction của lượt ghi, không phải sau nó.
   *
   * Ngoài transaction thì một lỗi ở giữa để lại rule đã đổi mà lịch sử không ghi — đúng loại
   * lệch mà AD-5 sinh ra để chặn, và là loại chỉ lộ ra khi có người đi tra sáu tháng sau.
   */
  private async recordWithin(
    tx: Tx,
    actor: string,
    id: string,
    action: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(natRuleHistoryTable).values({ natRuleId: id, action, actor, changes });
  }

  /**
   * Tra một rule KỂ CẢ đã gỡ — khác `requireAlive`.
   *
   * Lịch sử của một rule đã gỡ chính là thứ đáng đọc nhất ("port này từng mở cho ai, gỡ vì
   * sao"), nên chặn ở đây theo `voidedAt` là chặn đúng chỗ cần xem.
   */
  private async requireAny(id: string): Promise<typeof natRuleTable.$inferSelect> {
    const rows = await this.db.select().from(natRuleTable).where(eq(natRuleTable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'NAT_NOT_FOUND',
        message: 'Không tìm thấy rule NAT này.',
      });
    }
    return rows[0];
  }

  private requireAlive(id: string): Promise<typeof natRuleTable.$inferSelect> {
    return this.requireAliveWithin(this.db, id);
  }

  /** Bản đọc TRONG transaction — `voidWithin` phải thấy trạng thái của chính tx mình. */
  private async requireAliveWithin(
    tx: Pick<Database, 'select'>,
    id: string,
  ): Promise<typeof natRuleTable.$inferSelect> {
    const rows = await tx
      .select()
      .from(natRuleTable)
      .where(and(eq(natRuleTable.id, id), isNull(natRuleTable.voidedAt)));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'NAT_NOT_FOUND',
        message: 'Không tìm thấy rule NAT này (có thể đã gỡ).',
      });
    }
    return rows[0];
  }

  private async decorate(
    rows: (typeof natRuleTable.$inferSelect)[],
  ): Promise<NatRuleRecord[]> {
    /*
     * HAI lượt hỏi cho cả trang, không phải hai lượt mỗi dòng.
     *
     * Bản trước là N+1 LỒNG, và đây là chỗ tệ nhất trong cả repo: mỗi rule tra thiết bị
     * (`getById` = 8 truy vấn), rồi tra hồ sơ IP, mà `IpAddressService.findOne` LẠI tra thiết
     * bị của hồ sơ đó thêm một lượt 8 câu nữa. Sổ NAT của một router có 40 rule tốn hơn 600
     * câu cho một lần mở.
     */
    const deviceIds = [...new Set(rows.map((row) => row.deviceId))];
    const devices = await this.devices.getByIds(deviceIds);
    const ipIds = [...new Set(rows.map((row) => row.ipAddressId).filter(Boolean))] as string[];
    const ips = await this.addresses.findByIds(ipIds);

    return rows.map((row) => {
      const device = devices.get(row.deviceId) ?? null;
      const ip = row.ipAddressId ? (ips.get(row.ipAddressId) ?? null) : null;
      return {
        id: row.id,
        deviceId: row.deviceId,
        deviceCode: device?.code ?? null,
        deviceName: device?.name ?? null,
        siteCode: device?.siteCode ?? null,
        protocol: row.protocol as NatProtocol,
        externalFrom: row.externalFrom,
        externalTo: row.externalTo,
        externalPorts: describePortRange(row.externalFrom, row.externalTo),
        internalIp: hostOf(row.internalIp),
        internalPort: row.internalPort,
        ipAddressId: row.ipAddressId,
        internalOwner: ip?.usedBy ?? ip?.deviceCode ?? null,
        internalDeviceId: ip?.deviceId ?? null,
        internalDeviceCode: ip?.deviceCode ?? null,
        usedBy: row.usedBy,
        reason: row.reason,
        enabled: row.enabled,
        note: row.note,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  private translate(error: unknown, input: NatRuleInput): unknown {
    /**
     * Ràng buộc `nat_external_range_check` của DB — hàng rào cuối. Không map thì mọi đường
     * vào KHÔNG qua DTO HTTP (import Excel về sau, seed, module khác gọi lại) bung 500 thay
     * vì một câu tiếng Việt (code review Epic 5, finding 2).
     */
    if (pgErrorCode(error) === PG_CHECK_VIOLATION) {
      return new BadRequestException({
        code: 'NAT_INVALID',
        message: `Port ngoài ${describePortRange(input.externalFrom, input.externalTo)} không hợp lệ (phải từ 1 đến 65535, số đầu nhỏ hơn số cuối).`,
      });
    }
    if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION) {
      return new ConflictException({
        code: 'NAT_PORT_OVERLAP',
        message:
          `Port ngoài ${describePortRange(input.externalFrom, input.externalTo)} (${input.protocol.toUpperCase()}) ` +
          'đã có rule khác trên router này. Sổ NAT chỉ được có MỘT câu trả lời cho mỗi port — ' +
          'sửa rule cũ hoặc gỡ nó trước.',
      });
    }
    return error;
  }
}

/**
 * Bản ghi DB → hình dạng mà `natChanges` so được.
 *
 * `internalIp` phải đi qua `hostOf`: cột là kiểu `inet` nên Postgres trả về `172.16.10.5/32`,
 * còn giá trị mới từ form là `172.16.10.5`. Không chuẩn hóa thì MỌI lượt sửa đều đẻ ra một
 * dòng "IP trong: 172.16.10.5/32 → 172.16.10.5" — sai, và lặp lại mãi.
 */
function snapshotOf(row: typeof natRuleTable.$inferSelect): NatRuleSnapshot {
  return {
    ports: describePortRange(row.externalFrom, row.externalTo),
    protocol: row.protocol,
    internalIp: hostOf(row.internalIp),
    internalPort: row.internalPort,
    usedBy: row.usedBy,
    reason: row.reason,
    enabled: row.enabled,
    note: row.note,
  };
}
