import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { requireCas, requireUnchangedSince } from '../../common/cas';
import { HISTORY_PAGE_LIMIT } from '../../common/history';
import type { Tx } from '../../common/tx';
import {
  PG_CHECK_VIOLATION,
  conflictOnUnique,
  escapeLike,
  imsNormLike,
  pgConstraint,
  pgErrorCode,
} from '../../common/sql';
import { diffRecord, hasChanges } from '../../common/record-diff';
import { isoDateInTz } from '../../common/today';
import { AuditWriterService } from '../audit/audit-writer.service';
import { SystemConfigService } from '../config-sys/system-config.service';
import { DevicesApiService } from '../devices/devices.api';
import {
  enumerateHosts,
  hostOf,
  ipAddressSearchOf,
  keepPreferredByAddress,
  parseAddress,
} from './ip-rules';
import {
  OCCUPYING_STATUSES,
  canTransition,
  isOccupying,
  nextStatuses,
  transitionLabel,
  type IpStatus,
} from './ip-lifecycle';
import { describePortRange } from './nat-rules';
import { ipAddressTable, ipHistoryTable, natRuleTable, subnetTable } from './ipam.schema';
import { SubnetService } from './subnet.service';
import { DEVICE_ONE_IP_CONSTRAINT, deviceHasIp } from './ip-one-per-device';

export type { IpStatus };

/** Câu cảnh báo theo đúng việc người dùng vừa bấm — xem `assertNoLiveNatWithin`. */
const PURPOSE_WARNING = {
  reclaim: 'Để nguyên thì cổng vẫn mở và sẽ trỏ vào máy được cấp tiếp theo.',
  assign: 'Để nguyên thì cổng đang mở sẽ trỏ thẳng vào máy mới.',
  void: 'Xóa hồ sơ mà để nguyên luật thì cổng vẫn mở nhưng không màn nào còn nhắc tới.',
  readdress: 'Để nguyên thì luật vẫn trỏ vào địa chỉ cũ.',
} as const;

/** Trường được theo dõi trong lịch sử (AD-13). */
const TRACKED = ['address', 'deviceId', 'usedBy', 'assignedAt', 'status', 'note'] as const;

export interface IpAddressRecord {
  id: string;
  subnetId: string;
  address: string;
  deviceId: string | null;
  deviceCode: string | null;
  deviceName: string | null;
  /**
   * Site của THIẾT BỊ giữ IP (Q-20). Dải để trống site là dùng chung mọi site, nên site của một
   * IP chỉ đọc được từ máy; IP không gắn máy thì `null`.
   */
  deviceSiteCode: string | null;
  usedBy: string | null;
  assignedBy: string;
  assignedAt: string | null;
  status: IpStatus;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Hồ sơ đã ẨN hay chưa — `null` là đang hiển thị.
   *
   * `decorate` PHẢI trả ba trường này. Thiếu chúng thì khi màn dải xin thêm hồ sơ đã ẩn
   * (`?includeVoided=true`), chúng về trông y hệt hồ sơ đang sống — và cửa `restore()` không
   * có cách nào biết nên bày nút cho dòng nào. Cùng lý do với `SubnetRecord`.
   */
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
}

export interface IpAddressInput {
  subnetId: string;
  address: string;
  deviceId?: string | null;
  usedBy?: string | null;
  assignedAt?: string | null;
  status?: IpStatus;
  note?: string | null;
  reason?: string | null;
}

/** Một kết quả tra IP xuyên dải — kèm dải chứa nó để mở thẳng đúng dải. */
export type IpSearchHit = IpAddressRecord & {
  subnetCidr: string;
  subnetName: string;
  subnetVlan: number | null;
};

/** Trần số dòng của ô tra — đây là ô gợi ý, không phải một bảng. */
export const IP_SEARCH_MAX = 50;

export interface TransitionOptions {
  reason?: string | null;
  deviceId?: string | null;
  usedBy?: string | null;
  /** Chỉ dùng khi cấp: ngày cấp thật (YYYY-MM-DD); bỏ trống là hôm nay. */
  assignedAt?: string | null;
  note?: string | null;
}

/** Một dòng trên màn "toàn bộ dải": hoặc là hồ sơ thật, hoặc là một ô trống. */
export type SubnetSlot =
  | ({
      kind: 'record';
      /**
       * Chỉ hồ sơ đang Trống: chủ của lượt THU HỒI gần nhất (mã máy, không có thì người/bộ
       * phận). Hồ sơ đã gỡ chủ lúc thu hồi, nên "IP này vừa của ai" chỉ còn ở lịch sử.
       */
      previousOwner?: string | null;
    } & IpAddressRecord)
  | { kind: 'free'; address: string };

/**
 * Hồ sơ IP (FR-018/FR-019). Chủ sở hữu bảng `ip_address` + `ip_history` (AD-3).
 */
@Injectable()
export class IpAddressService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly devices: DevicesApiService,
    private readonly subnets: SubnetService,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * "Hôm nay" theo múi giờ ứng dụng (AD-11).
   *
   * KHÔNG dùng `new Date().toISOString()`: từ 00:00 tới 07:00 giờ VN thì UTC còn là hôm qua,
   * và ngày cấp IP sẽ lùi một ngày suốt cả buổi sáng.
   */
  private async timezone(): Promise<string> {
    return this.config.getString('appTimezone');
  }

  /**
   * AC 5.1: "danh sách IP tổng theo subnet hiển thị cả đang dùng lẫn trống".
   *
   * Ô trống KHÔNG có hàng trong DB — chúng được suy ra từ dải trừ đi những địa chỉ đã có hồ
   * sơ. Tạo sẵn 254 hàng "free" cho mỗi /24 thì mỗi lần khai dải là đẻ ra hàng trăm hàng rỗng
   * phải dọn khi ẩn dải, và một hàng "trống" vẫn mang `assigned_by`, `created_at` — dữ liệu
   * giả vờ có nghĩa.
   */
  async listBySubnet(subnetId: string, includeVoided = false): Promise<SubnetSlot[]> {
    /*
     * Dải ĐÃ NGỪNG DÙNG thì hiện luôn những hồ sơ IP đã tắt CÙNG nó.
     *
     * Bỏ chúng đi thì 254 địa chỉ hiện ra là 254 ô TRỐNG — và "trống" ở màn này có nghĩa rất
     * cụ thể: cấp cho máy khác được. Trong khi sự thật là mấy chục cái máy vẫn đang cắm đúng
     * những địa chỉ đó dưới dạng IP tĩnh; không cái nào tự nhả ra chỉ vì cuốn sổ đã cất dải đi.
     *
     * "Cùng nó" = `voided_at` trùng mốc của dải (`SubnetService.voidSubnet` đóng dải và mọi IP
     * bên trong bằng MỘT mốc). Hồ sơ bị XÓA lẻ trước đó (nhập nhầm, Q-15) không hiện ở đâu cả —
     * xóa là để nhập lại, vết của nó nằm trong nhật ký hệ thống chứ không trên màn dải.
     *
     * `includeVoided` là cửa XIN thêm ở tầng API (SA tra hồ sơ đã xóa qua `restore()`); giao
     * diện không gọi nó.
     */
    const frame = await this.subnets.frameOf(subnetId);
    const all = await this.listRecords(subnetId, {
      includeVoided: includeVoided || frame.voidedAt !== null,
    });
    const stamp = frame.voidedAt?.getTime() ?? null;
    const records =
      includeVoided || stamp === null
        ? all
        : all.filter((row) => row.voidedAt === null || row.voidedAt.getTime() === stamp);
    /*
     * `keepPreferredByAddress`, KHÔNG phải `new Map(records.map(...))` (F-10).
     *
     * `ip_address_key` là UNIQUE một phần (`WHERE voided_at IS NULL`), nên một địa chỉ có thể
     * có 1 hàng sống + N hàng đã ẩn — và `new Map` giữ hàng CUỐI, mà "cuối" do Postgres quyết.
     * Xem luật và hậu quả ở chính hàm ấy.
     */
    const byAddress = keepPreferredByAddress(records);
    const previous = await this.previousOwnersOf(
      [...byAddress.values()]
        .filter((record) => record.status === 'free' && !record.voidedAt)
        .map((record) => record.id),
    );

    return enumerateHosts(frame.cidr).map<SubnetSlot>((address) => {
      const record = byAddress.get(address);
      if (!record) return { kind: 'free', address };
      const owner = previous.get(record.id);
      return owner
        ? { kind: 'record', ...record, previousOwner: owner }
        : { kind: 'record', ...record };
    });
  }

  /**
   * Chủ của lượt về Trống GẦN NHẤT cho từng hồ sơ — một câu `DISTINCT ON` cho cả dải, và một
   * lượt `devices.api` cho mọi mã máy (AD-2, không join bảng `device`).
   *
   * Chỉ dòng CHUYỂN trạng thái mới mang khóa `previousDeviceId` (kể cả khi null). Lượt thả gần
   * nhất không có chủ thì trả không có chủ — lọc bỏ nó là lùi về chủ của một chu kỳ cũ hơn.
   * Dòng sửa ghi chú / khôi phục cũng có `to_status = 'free'` nhưng không có khóa đó.
   */
  private async previousOwnersOf(ids: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (ids.length === 0) return result;
    const rows = await this.db
      .selectDistinctOn([ipHistoryTable.ipAddressId], {
        id: ipHistoryTable.ipAddressId,
        deviceId: sql<string | null>`${ipHistoryTable.changes}->>'previousDeviceId'`,
        usedBy: sql<string | null>`${ipHistoryTable.changes}->>'previousUsedBy'`,
      })
      .from(ipHistoryTable)
      .where(
        and(
          inArray(ipHistoryTable.ipAddressId, ids),
          eq(ipHistoryTable.toStatus, 'free'),
          sql`${ipHistoryTable.changes} ? 'previousDeviceId'`,
        ),
      )
      .orderBy(ipHistoryTable.ipAddressId, desc(ipHistoryTable.createdAt));
    const deviceIds = [...new Set(rows.map((row) => row.deviceId).filter(Boolean))] as string[];
    const devices = await this.devices.getByIds(deviceIds);
    for (const row of rows) {
      const code = row.deviceId ? devices.get(row.deviceId)?.code : null;
      const owner = code ?? row.usedBy;
      if (owner) result.set(row.id, owner);
    }
    return result;
  }

  /** Chỉ những IP CÓ hồ sơ, sắp theo thứ tự số học (nhờ kiểu `inet` của Postgres). */
  async listRecords(
    subnetId: string,
    options: { includeVoided?: boolean } = {},
  ): Promise<IpAddressRecord[]> {
    const rows = await this.db
      .select()
      .from(ipAddressTable)
      .where(
        options.includeVoided
          ? eq(ipAddressTable.subnetId, subnetId)
          : and(eq(ipAddressTable.subnetId, subnetId), isNull(ipAddressTable.voidedAt)),
      )
      .orderBy(asc(ipAddressTable.address));
    return this.decorate(rows);
  }

  /**
   * Địa chỉ của một thiết bị, đọc TRONG transaction và KHÔNG tra thêm gì (`decorate` gọi sang
   * `devices.api`, thừa ở đây và làm chậm lượt dọn).
   *
   * Lượt thanh lý phải đọc bằng chính `tx` của nó: đọc bằng `this.db` là đọc trên MỘT KẾT NỐI
   * KHÁC, ngoài transaction — một IP vừa được cấp cho máy này sẽ không có trong danh sách và
   * máy được thanh lý trong khi vẫn đang giữ nó (mẫu M2).
   *
   * ===== CHỈ NHỮNG ĐỊA CHỈ ĐANG CHIẾM CHỖ (A-06) =====
   *
   * Hai nơi gọi hàm này — `holdingsOf` ("máy còn giữ gì") và `releaseWithin` ("trả lại những
   * gì nó giữ") — đều hỏi về TÀI SẢN ĐANG GIỮ. Một địa chỉ đã trống thì đã trả về pool rồi.
   *
   * Không lọc thì một hàng lai `device_id = X, status = free` khóa cứng thiết bị X: đường chặn
   * báo `DEVICE_HAS_HOLDINGS`, đường dọn thì `transitionWithin(…, 'free')` đâm vào
   * `IP_TRANSITION_INVALID` và kéo cả lượt thanh lý rollback. Cả hai lối đều tắc.
   */
  async listForDeviceWithin(
    tx: Pick<Database, 'select'>,
    deviceId: string,
  ): Promise<{ id: string; address: string }[]> {
    const rows = await tx
      .select({ id: ipAddressTable.id, address: ipAddressTable.address })
      .from(ipAddressTable)
      .where(
        and(
          eq(ipAddressTable.deviceId, deviceId),
          isNull(ipAddressTable.voidedAt),
          inArray(ipAddressTable.status, OCCUPYING_STATUSES),
        ),
      )
      .orderBy(asc(ipAddressTable.address));
    return rows.map((row) => ({ id: row.id, address: hostOf(row.address) }));
  }

  /**
   * Thiết bị đang GIỮ địa chỉ khớp từ khoá — ô tìm thiết bị hỏi cái này (Q-14). Chỉ hồ sơ còn
   * sống và đang chiếm địa chỉ: hồ sơ đã ẩn hay đã trả về pool mà vẫn chỉ về máy cũ là trả lời
   * sai câu "IP này là máy nào".
   */
  async deviceIdsByAddress(pattern: {
    exact: string | null;
    prefix: string | null;
  }): Promise<string[]> {
    const match = pattern.exact
      ? sql`host(${ipAddressTable.address}) = ${pattern.exact}`
      : sql`host(${ipAddressTable.address}) LIKE ${`${pattern.prefix ?? ''}%`}`;
    const rows = await this.db
      .selectDistinct({ deviceId: ipAddressTable.deviceId })
      .from(ipAddressTable)
      .where(
        and(
          match,
          isNotNull(ipAddressTable.deviceId),
          isNull(ipAddressTable.voidedAt),
          inArray(ipAddressTable.status, OCCUPYING_STATUSES),
        ),
      );
    return rows.map((row) => row.deviceId).filter((value): value is string => value !== null);
  }

  /**
   * Địa chỉ đang GIỮ của nhiều máy một lượt — cột IP của danh sách thiết bị hỏi cho cả trang
   * (không N+1). Cùng luật "đang giữ" với `listForDeviceWithin`: hồ sơ ẩn hay đã trả về pool
   * không còn là IP của máy đó. Sắp theo kiểu `inet` nên ".3" đứng trước ".20".
   */
  async heldAddressesOf(deviceIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (deviceIds.length === 0) return result;
    const rows = await this.db
      .select({ deviceId: ipAddressTable.deviceId, address: ipAddressTable.address })
      .from(ipAddressTable)
      .where(
        and(
          inArray(ipAddressTable.deviceId, deviceIds),
          isNull(ipAddressTable.voidedAt),
          inArray(ipAddressTable.status, OCCUPYING_STATUSES),
        ),
      )
      .orderBy(asc(ipAddressTable.address));
    for (const row of rows) {
      if (!row.deviceId) continue;
      const list = result.get(row.deviceId) ?? [];
      list.push(hostOf(row.address));
      result.set(row.deviceId, list);
    }
    return result;
  }

  /** IP của một thiết bị — panel IP trên trang thiết bị hỏi cái này. */
  async listForDevice(deviceId: string): Promise<IpAddressRecord[]> {
    const rows = await this.db
      .select()
      .from(ipAddressTable)
      .where(and(eq(ipAddressTable.deviceId, deviceId), isNull(ipAddressTable.voidedAt)))
      .orderBy(asc(ipAddressTable.address));
    return this.decorate(rows);
  }

  /**
   * Tra hồ sơ IP xuyên MỌI dải đang dùng: "10.77.1.53 là máy nào" và "máy CAM-01 giữ IP nào".
   *
   * Câu gõ có dáng IP thì so theo địa chỉ: đủ bốn khúc là khớp ĐÚNG (gõ .5 mà ra .53 là trả lời
   * sai câu hỏi), gõ dở thì khớp trọn nhóm đã gõ. Chỉ số và chấm mà sai định dạng thì trả rỗng,
   * không rơi về tìm theo chữ (`ipAddressSearchOf`). Còn lại thì tìm theo máy — qua `devices.api` chứ
   * không join bảng `device` (AD-2) — và theo người/bộ phận, gấp dấu.
   *
   * Bỏ dải đã vô hiệu hoá và hồ sơ đã ẩn: kết quả dẫn người ta tới chỗ CẤP/SỬA, mà hai chỗ đó
   * đều chỉ đọc.
   */
  async search(term: string, limit = 20): Promise<IpSearchHit[]> {
    const q = term.trim();
    if (q.length < 2) return [];
    const cap = Math.min(Math.max(1, Math.trunc(limit) || 1), IP_SEARCH_MAX);

    let match: SQL | undefined;
    const intent = ipAddressSearchOf(q);
    if (intent.kind === 'invalid') return [];
    if (intent.kind === 'ip') {
      match = intent.exact
        ? sql`host(${ipAddressTable.address}) = ${intent.exact}`
        : sql`host(${ipAddressTable.address}) LIKE ${`${escapeLike(intent.prefix ?? '')}%`}`;
    } else {
      const deviceIds = (await this.devices.search(q, IP_SEARCH_MAX)).map((d) => d.id);
      match = or(
        deviceIds.length > 0 ? inArray(ipAddressTable.deviceId, deviceIds) : undefined,
        imsNormLike(ipAddressTable.usedBy, q),
      );
    }

    const rows = await this.db
      .select({
        ip: ipAddressTable,
        subnetCidr: sql<string>`${subnetTable.cidr}::text`,
        subnetName: subnetTable.name,
        subnetVlan: subnetTable.vlan,
      })
      .from(ipAddressTable)
      .innerJoin(subnetTable, eq(subnetTable.id, ipAddressTable.subnetId))
      .where(and(match, isNull(ipAddressTable.voidedAt), isNull(subnetTable.voidedAt)))
      .orderBy(asc(ipAddressTable.address))
      .limit(cap);
    const records = await this.decorate(rows.map((row) => row.ip));
    return records.map((record, index) => ({
      ...record,
      subnetCidr: rows[index].subnetCidr,
      subnetName: rows[index].subnetName,
      subnetVlan: rows[index].subnetVlan,
    }));
  }

  /**
   * "Xuất tất cả" ở màn IP (Q-20): mọi hồ sơ còn sống của mọi dải đang dùng, sắp theo dải rồi
   * địa chỉ. Dải đã ngừng dùng không vào: file này là sổ IP ĐANG dùng; dải đã tắt vẫn xuất
   * riêng được ở chính dải đó.
   */
  async listAllForExport(): Promise<IpSearchHit[]> {
    const rows = await this.db
      .select({
        ip: ipAddressTable,
        subnetCidr: sql<string>`${subnetTable.cidr}::text`,
        subnetName: subnetTable.name,
        subnetVlan: subnetTable.vlan,
      })
      .from(ipAddressTable)
      .innerJoin(subnetTable, eq(subnetTable.id, ipAddressTable.subnetId))
      .where(and(isNull(ipAddressTable.voidedAt), isNull(subnetTable.voidedAt)))
      .orderBy(asc(subnetTable.cidr), asc(ipAddressTable.address));
    const records = await this.decorate(rows.map((row) => row.ip));
    return records.map((record, index) => ({
      ...record,
      subnetCidr: rows[index].subnetCidr,
      subnetName: rows[index].subnetName,
      subnetVlan: rows[index].subnetVlan,
    }));
  }

  async findOne(id: string): Promise<IpAddressRecord> {
    return (await this.decorate([await this.requireAlive(id)]))[0];
  }

  /**
   * Tra NHIỀU hồ sơ IP còn sống trong MỘT lượt — bản chống N+1 của `findOne`, cho sổ NAT.
   *
   * Id không tồn tại (hoặc đã ẩn) thì VẮNG MẶT trong map chứ không ném: sổ NAT hiện được cả
   * rule trỏ vào một địa chỉ chưa có hồ sơ, và đó là chuyện bình thường chứ không phải lỗi.
   */
  async findByIds(ids: string[]): Promise<Map<string, IpAddressRecord>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(ipAddressTable)
      .where(and(inArray(ipAddressTable.id, unique), isNull(ipAddressTable.voidedAt)));
    return new Map((await this.decorate(rows)).map((item) => [item.id, item]));
  }

  /**
   * Lịch sử của MỘT hồ sơ IP — kể cả hồ sơ ĐÃ ẨN.
   *
   * `requireAlive` ở đây là chặn nhầm chỗ: câu "IP này từng của máy nào, ai xóa nó, vì sao"
   * chỉ được hỏi SAU khi hồ sơ đã biến khỏi bảng. AC 5.2 bắt giữ lịch sử vĩnh viễn, mà giữ
   * xong lại không cho đọc thì bằng không.
   */
  /**
   * Lịch sử một hồ sơ IP — MỚI NHẤT TRÊN ĐẦU, có trần 200 dòng.
   *
   * Phải cùng thứ tự với mọi bộ đọc lịch sử khác của repo. Để `asc` thì panel Lịch sử của IP
   * hiện cũ-nhất-trên-đầu trong khi các màn kia hiện mới-nhất-trên-đầu. Người đọc chuyển qua
   * lại giữa hai màn sẽ đọc sai thứ tự mà không nhận ra — dòng đầu bảng ở màn này là "lâu
   * rồi", ở màn kia là "vừa xong".
   *
   * Trần 200 cùng lý do với các bản kia: một IP bị chuyển trạng thái hàng ngày trong vài năm
   * sẽ kéo cả nghìn dòng về trình duyệt cho một cái panel không ai cuộn hết.
   */
  async history(id: string): Promise<(typeof ipHistoryTable.$inferSelect)[]> {
    await this.requireAny(id);
    return this.db
      .select()
      .from(ipHistoryTable)
      .where(eq(ipHistoryTable.ipAddressId, id))
      .orderBy(desc(ipHistoryTable.createdAt))
      .limit(HISTORY_PAGE_LIMIT);
  }

  async create(actor: string, input: IpAddressInput): Promise<IpAddressRecord> {
    const cidr = await this.subnets.cidrOf(input.subnetId);
    const address = this.requireHost(input.address, cidr);
    requireOwner(input.deviceId, input.usedBy);

    try {
      const row = await this.db.transaction((tx) =>
        this.insertWithin(tx, actor, { ...input, address }),
      );
      return (await this.decorate([row]))[0];
    } catch (error) {
      throw this.translate(error, address, cidr);
    }
  }

  /** Thân của `create` — `changeAddress` dùng lại trong transaction của nó. `address` đã kiểm. */
  private async insertWithin(
    tx: Tx,
    actor: string,
    input: IpAddressInput,
  ): Promise<typeof ipAddressTable.$inferSelect> {
    const status = input.status ?? 'assigned';
    const address = input.address;
    await this.requireDeviceWithin(tx, input.deviceId);
    if (isOccupying(status)) await this.assertDeviceHasNoIpWithin(tx, input.deviceId);
    const rows = await tx
      .insert(ipAddressTable)
      .values({
        subnetId: input.subnetId,
        address,
        deviceId: input.deviceId || null,
        usedBy: input.usedBy?.trim() || null,
        assignedBy: actor,
        assignedAt: input.assignedAt || null,
        status,
        note: input.note?.trim() || null,
      })
      .returning();
    await this.audit.appendWithin(tx, {
      actor,
      action: 'ip.created',
      objectType: 'ip_address',
      objectId: rows[0].id,
      detail: { address, status },
    });
    await tx.insert(ipHistoryTable).values({
      ipAddressId: rows[0].id,
      action: 'ip.created',
      actor,
      toStatus: status,
      changes: {
        address,
        deviceId: input.deviceId || null,
        usedBy: input.usedBy?.trim() || null,
        reason: input.reason?.trim() || null,
      },
    });
    return rows[0];
  }

  /**
   * ĐỔI IP của một thiết bị (Q-20): thu hồi IP đang giữ về pool rồi cấp địa chỉ mới, trong MỘT
   * transaction (AD-5).
   *
   * Hai cú bấm rời (Thu hồi, rồi Cấp IP) thì giữa chừng máy không có IP nào trong sổ, và nếu
   * bước hai hỏng (địa chỉ vừa bị người khác cấp) thì máy mất luôn IP cũ. Gộp lại thì hỏng ở
   * bước nào cũng rollback về đúng trạng thái trước.
   *
   * Đi qua `transitionWithin` / `insertWithin` chứ không tự UPDATE: hàng rào NAT, CAS, chủ cũ
   * trong lịch sử và luật một-máy-một-IP phải là MỘT bản cho mọi đường cấp.
   */
  async changeAddress(
    actor: string,
    id: string,
    input: {
      subnetId: string;
      address: string;
      usedBy?: string | null;
      assignedAt?: string | null;
      note?: string | null;
      reason?: string | null;
    },
  ): Promise<IpAddressRecord> {
    const cidr = await this.subnets.cidrOf(input.subnetId);
    const address = this.requireHost(input.address, cidr);

    try {
      const row = await this.db.transaction(async (tx) => {
        const current = await this.requireAliveWithin(tx, id, 'update');
        if (!current.deviceId || !isOccupying(current.status as IpStatus)) {
          throw new BadRequestException({
            code: 'IP_CHANGE_NEEDS_DEVICE',
            message: 'Chỉ đổi được IP đang cấp cho một thiết bị.',
          });
        }
        const from = hostOf(current.address);
        if (current.subnetId === input.subnetId && from === address) {
          throw new BadRequestException({
            code: 'IP_CHANGE_SAME',
            message: `Thiết bị đang giữ đúng ${address}. Chọn một địa chỉ khác.`,
          });
        }
        const deviceId = current.deviceId;
        // Người/bộ phận dùng máy và ghi chú về chỗ cắm đi theo MÁY, không theo địa chỉ: đổi IP
        // mà rơi mất chúng thì sổ mất câu trả lời "IP này của ai". Gửi giá trị (kể cả rỗng)
        // nghĩa là người dùng đã sửa — vắng mặt mới là "giữ như cũ".
        const usedBy = input.usedBy !== undefined ? input.usedBy : current.usedBy;
        const note = input.note !== undefined ? input.note : current.note;
        const reason = input.reason?.trim() || `Đổi IP: ${from} → ${address}`;
        await this.transitionWithin(tx, actor, id, 'free', { reason });

        const existing = await tx
          .select()
          .from(ipAddressTable)
          .where(
            and(
              eq(ipAddressTable.subnetId, input.subnetId),
              sql`host(${ipAddressTable.address}) = ${address}`,
              isNull(ipAddressTable.voidedAt),
            ),
          )
          .for('update');
        let next: typeof ipAddressTable.$inferSelect;
        if (existing.length === 0) {
          next = await this.insertWithin(tx, actor, {
            subnetId: input.subnetId,
            address,
            deviceId,
            usedBy,
            assignedAt: input.assignedAt || isoDateInTz(await this.timezone()),
            note,
            reason,
          });
        } else if (isOccupying(existing[0].status as IpStatus)) {
          throw new ConflictException({
            code: 'IP_TAKEN',
            message: `Địa chỉ ${address} đang cấp cho chỗ khác. Chọn một địa chỉ còn trống.`,
          });
        } else {
          next = await this.transitionWithin(tx, actor, existing[0].id, 'assigned', {
            deviceId,
            usedBy,
            assignedAt: input.assignedAt,
            note,
            reason,
          });
        }
        await this.audit.appendWithin(tx, {
          actor,
          action: 'ip.changed',
          objectType: 'ip_address',
          objectId: next.id,
          detail: { deviceId, from, to: address, previousIpId: id },
        });
        return next;
      });
      return (await this.decorate([row]))[0];
    } catch (error) {
      throw this.translate(error, address, cidr);
    }
  }

  async update(
    actor: string,
    id: string,
    input: Partial<IpAddressInput>,
  ): Promise<IpAddressRecord> {
    const before = await this.requireAlive(id);
    const values: {
      address?: string;
      deviceId?: string | null;
      usedBy?: string | null;
      assignedAt?: string | null;
      note?: string | null;
    } = {};

    if (input.address !== undefined) {
      const cidr = await this.subnets.cidrOf(before.subnetId);
      values.address = this.requireHost(input.address, cidr);
    }
    if (input.deviceId !== undefined) {
      values.deviceId = input.deviceId || null;
    }
    if (input.usedBy !== undefined) values.usedBy = input.usedBy?.trim() || null;
    if (input.assignedAt !== undefined) values.assignedAt = input.assignedAt || null;
    if (input.note !== undefined) values.note = input.note?.trim() || null;
    /**
     * Trạng thái KHÔNG sửa được qua đây — phải đi `transition()`.
     * AC 5.2 nói rõ: "chuyển trạng thái qua transition(), không UPDATE status tự do". Để lọt
     * một đường sửa thẳng thì cái máy trạng thái chỉ còn là gợi ý.
     */
    if (input.status !== undefined && input.status !== before.status) {
      throw new BadRequestException({
        code: 'IP_STATUS_NEEDS_TRANSITION',
        message: 'Đổi trạng thái IP phải qua thao tác riêng, không sửa trực tiếp.',
      });
    }

    /*
     * Gán MÁY hoặc NGƯỜI DÙNG vào một hồ sơ đang TRỐNG thì nó thành ĐANG CẤP.
     *
     * Để `status` nguyên thì một hàng vừa có tên máy vừa mang badge "Trống", còn nút
     * lọc phía trên đếm "Đang dùng 0" — bảng và con số nói ngược nhau, và cả hai đều đúng theo
     * dữ liệu. Người dùng thấy ô đã có máy nên tưởng đã cấp, còn hệ thống thì vẫn coi địa chỉ
     * đó là chỗ trống và sẵn sàng cấp lần nữa cho máy khác.
     *
     * Vẫn KHÔNG nhận `status` từ body (AC 5.2: đổi trạng thái phải qua `transition`) — đây là
     * hệ quả TỰ SUY từ việc gán chủ, đúng luật mà `create()` đã dùng từ đầu.
     *
     * ===== HỎI `isOccupying`, ĐỪNG LIỆT KÊ TAY MỘT TRẠNG THÁI (A-06) =====
     *
     * Bỏ sót một trạng thái "chỗ trống" ở đây đẻ ra hàng lai `device_id = X` mà vẫn trống, và
     * hàng lai đó KHÓA CỨNG thiết bị X: không tick dọn thì `DEVICE_HAS_HOLDINGS` chặn, có tick
     * dọn thì `IP_TRANSITION_INVALID` làm rollback cả lượt thanh lý. Vị từ dùng chung trả lời
     * sẵn cho mọi trạng thái, kể cả trạng thái thêm về sau.
     */
    const nextOwner = {
      deviceId: values.deviceId !== undefined ? values.deviceId : before.deviceId,
      usedBy: values.usedBy !== undefined ? values.usedBy : before.usedBy,
    };
    const becomesAssigned =
      !isOccupying(before.status as IpStatus) &&
      Boolean(nextOwner.deviceId || nextOwner.usedBy);
    // Hồ sơ Đang dùng mà bị gỡ hết chủ là quay lại đúng dòng mồ côi Q-14 cấm. Hồ sơ Trống thì
    // không có chủ là chuyện bình thường — sửa ghi chú của nó không được chặn.
    if (isOccupying(before.status as IpStatus)) requireOwner(nextOwner.deviceId, nextOwner.usedBy);

    /*
     * ĐỔI CHỦ hoặc DỜI ĐỊA CHỈ qua đường sửa hồ sơ cũng phải hỏi sổ NAT.
     *
     * Hàng rào ở `transitionWithin` và `voidAddress` chỉ canh hai cửa HẸP. Cửa này dẫn tới
     * đúng cùng một hậu quả, chỉ khác đường vào:
     *
     *   · đổi `deviceId`: rule `TCP 8080 → .5` vẫn mở, và giờ nó trỏ vào máy mới. Không khác
     *     gì "cấp cho máy khác" — thứ `PURPOSE_WARNING.assign` viết ra để chặn.
     *   · đổi `address`: `nat_rule.internal_ip` giữ nguyên địa chỉ CŨ, còn `decorate()` của sổ
     *     NAT lại lấy tên máy qua `ip_address_id`. Sổ NAT hiện "8080 → 172.16.10.5, máy
     *     PC-KT-01" trong khi PC-KT-01 đã ở .9.
     *
     * Hỏi theo địa chỉ CŨ (`before.address`) vì đó là địa chỉ rule đang trỏ vào.
     */
    const ownerMoves =
      values.deviceId !== undefined && (values.deviceId ?? null) !== (before.deviceId ?? null);
    const addressMoves = values.address !== undefined && values.address !== before.address;

    try {
      const row = await this.db.transaction(async (tx) => {
        /*
         * `becomesAssigned`, hàng rào NAT và diff đều tính từ `before` đọc ngoài transaction.
         * Một lượt thu hồi commit vào giữa thì câu UPDATE dưới đây gắn chủ mới lên một hàng đã
         * `free` mà không lật nó sang `assigned` — đúng hàng lai "trống mà có chủ".
         */
        requireUnchangedSince(before, await this.requireAliveWithin(tx, id, 'update'), {
          code: 'IP_ALREADY_CHANGED',
          message: 'Hồ sơ IP này vừa được người khác sửa — tải lại rồi thử lại.',
        });
        await this.requireDeviceWithin(tx, values.deviceId);
        if (ownerMoves && (becomesAssigned || isOccupying(before.status as IpStatus))) {
          await this.assertDeviceHasNoIpWithin(tx, values.deviceId, id);
        }
        if (addressMoves || ownerMoves) {
          await this.assertNoLiveNatWithin(
            tx,
            before.address,
            addressMoves ? 'readdress' : 'assign',
          );
        }
        const rows = await tx
          .update(ipAddressTable)
          .set({
            ...values,
            ...(becomesAssigned ? { status: 'assigned' as const } : {}),
            updatedAt: new Date(),
          })
          .where(eq(ipAddressTable.id, id))
          .returning();
        if (becomesAssigned) {
          // Dòng lịch sử RIÊNG cho bước chuyển, không trộn vào dòng "sửa hồ sơ": AC 5.2 đòi
          // "IP này từng của máy nào" trả lời được, mà câu đó đọc từ chuỗi chuyển trạng thái.
          await tx.insert(ipHistoryTable).values({
            ipAddressId: id,
            action: 'ip.assigned',
            actor,
            fromStatus: before.status,
            toStatus: 'assigned',
            changes: { reason: 'gán chủ khi sửa hồ sơ' },
          });
        }
        const changes = diffRecord(TRACKED, before, rows[0]);
        await this.audit.appendWithin(tx, {
          actor,
          action: 'ip.updated',
          objectType: 'ip_address',
          objectId: id,
          detail: changes,
        });
        if (hasChanges(changes)) {
          await tx.insert(ipHistoryTable).values({
            ipAddressId: id,
            action: 'ip.updated',
            actor,
            fromStatus: before.status,
            toStatus: rows[0].status,
            changes,
          });
        }
        return rows[0];
      });
      return (await this.decorate([row]))[0];
    } catch (error) {
      throw this.translate(error, values.address ?? before.address, null);
    }
  }

  /**
   * Chuyển trạng thái vòng đời (FR-019).
   *
   * Đây là đường DUY NHẤT đổi được `status` — `update()` từ chối thẳng. Máy trạng thái nằm
   * ở `ip-lifecycle.ts`, service chỉ hỏi rồi ghi.
   *
   * Thu hồi (`assigned → free`, Q-02) thì XÓA thiết bị và người dùng khỏi hàng, giữ mọi thứ
   * khác, và lịch sử giữ nguyên ai thu hồi lúc nào: đó chính là
   * cách trả lời "IP này từng là máy in kế toán" sau khi nó đã được cấp cho máy khác. Để
   * `device_id` lại thì màn hình nói IP đang thuộc một máy mà thực tế đã trả về pool.
   */
  async transition(
    actor: string,
    id: string,
    to: IpStatus,
    options: TransitionOptions = {},
  ): Promise<IpAddressRecord> {
    const row = await this.db.transaction((tx) =>
      this.transitionWithin(tx, actor, id, to, options),
    );
    return (await this.decorate([row]))[0];
  }

  /**
   * Thân của `transition`, chạy trong transaction CÓ SẴN.
   *
   * Tách ra để lượt THANH LÝ MÁY thu hồi được mọi IP của máy trong cùng một transaction với
   * lượt đổi trạng thái thiết bị (`DeviceRetirementRegistry`). Không chép logic sang chỗ khác:
   * máy trạng thái, hàng rào NAT, CAS và hai dòng sổ đều phải là MỘT bản, nếu không thì đường
   * thanh lý và đường bấm tay sẽ trôi khỏi nhau đúng như mẫu M5.
   */
  async transitionWithin(
    tx: Tx,
    actor: string,
    id: string,
    to: IpStatus,
    options: TransitionOptions = {},
  ): Promise<typeof ipAddressTable.$inferSelect> {
    const before = await this.requireAliveWithin(tx, id);
    const from = before.status as IpStatus;

    if (!canTransition(from, to)) {
      const allowed = nextStatuses(from).map((next) => transitionLabel(from, next));
      throw new BadRequestException({
        code: 'IP_TRANSITION_INVALID',
        message:
          allowed.length > 0
            ? `Không chuyển thẳng được từ "${STATUS_LABEL[from]}" sang "${STATUS_LABEL[to]}". Từ đây chỉ có: ${allowed.join(', ')}.`
            : `Không chuyển được từ "${STATUS_LABEL[from]}".`,
      });
    }

    const values: {
      status: IpStatus;
      deviceId?: string | null;
      usedBy?: string | null;
      assignedAt?: string | null;
      note?: string | null;
    } = { status: to };

    if (to === 'free') {
      values.deviceId = null;
      values.usedBy = null;
    } else {
      // Cấp thường đi kèm chủ mới — nhận luôn ở đây để không phải gọi hai lượt và để lịch sử
      // ghi "cấp cho máy X" thành MỘT dòng, đúng như việc thật. Chủ mới dọn vào nên ô người
      // dùng để trống nghĩa là "chưa biết ai", không có gì của chủ cũ để giữ lại.
      if (options.deviceId !== undefined) {
        await this.requireDeviceWithin(tx, options.deviceId);
        values.deviceId = options.deviceId || null;
      }
      if (options.usedBy !== undefined) values.usedBy = options.usedBy?.trim() || null;
      const nextDeviceId = values.deviceId !== undefined ? values.deviceId : before.deviceId;
      requireOwner(nextDeviceId, values.usedBy !== undefined ? values.usedBy : before.usedBy);
      await this.assertDeviceHasNoIpWithin(tx, nextDeviceId, id);
      // Ngày cấp người dùng chọn thắng "hôm nay": cấp bù một IP đã cắm từ tuần trước là
      // chuyện thường, và sổ phải ghi ngày thật.
      values.assignedAt = options.assignedAt || isoDateInTz(await this.timezone());
      if (options.note !== undefined) values.note = options.note?.trim() || null;
    }

    {
      /*
       * SỔ NAT PHẢI ĐƯỢC HỎI TRƯỚC KHI QUYỀN SỞ HỮU ĐỔI CHỦ.
       *
       * Kịch bản: rule `TCP 8080 → 172.16.10.5` cho "camera tầng 2". Camera chết, IT thu hồi
       * `.5`. Tuần sau `.5` cấp cho laptop kế toán — và port 8080 vẫn mở, giờ trỏ vào laptop
       * kế toán. Từng bước đều đúng; cái sai là hai cuốn sổ không hỏi nhau câu nào.
       *
       * Cả hai bước chuyển đều là một mốc đổi chủ: thu hồi thì người thuê cũ đi khỏi, cấp thì
       * người thuê mới dọn vào.
       *
       * Trong transaction, không phải trước nó: kiểm ngoài rồi ghi trong là mẫu M2 (TOCTOU).
       */
      await this.assertNoLiveNatWithin(tx, before.address, to === 'free' ? 'reclaim' : 'assign');

      /*
       * Điều kiện `status = from` VÀ `voided_at IS NULL` đi ngay trong câu UPDATE.
       *
       * `requireAlive` ở trên đọc bằng `this.db`, tức NGOÀI transaction này. Giữa lúc đó và
       * lúc UPDATE có một khe hở. Hai người cùng mở một IP đang `free`: cả hai đọc
       * `from = 'free'`, cả hai qua được `canTransition`, cả hai UPDATE. Không có điều kiện
       * này thì trạng thái cuối là của người bấm sau, người bấm trước tưởng mình làm xong,
       * và `ip_history` để lại HAI dòng cùng `fromStatus: 'free'` — sổ lịch sử tự mâu thuẫn
       * với chính nó, mà AC 5.2 lại bắt giữ nó vĩnh viễn.
       *
       * `voided_at IS NULL` chặn nốt trường hợp dải cha bị ẩn xen giữa: không được hồi sinh
       * một hàng đã ẩn bằng đường đổi trạng thái.
       */
      const rows = await tx
        .update(ipAddressTable)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(ipAddressTable.id, id),
            eq(ipAddressTable.status, from),
            isNull(ipAddressTable.voidedAt),
          ),
        )
        .returning();
      requireCas(rows, {
        code: 'IP_ALREADY_CHANGED',
        message:
          'Địa chỉ IP này vừa được người khác đổi trạng thái (hoặc dải vừa ngừng dùng). Tải lại để xem.',
      });
      await this.audit.appendWithin(tx, {
        actor,
        action: 'ip.transitioned',
        objectType: 'ip_address',
        objectId: id,
        detail: { address: before.address, from, to, reason: options.reason ?? null },
      });
      await tx.insert(ipHistoryTable).values({
        ipAddressId: id,
        action: transitionLabel(from, to),
        actor,
        fromStatus: from,
        toStatus: to,
        // Ghi lại CHỦ CŨ ngay tại dòng thu hồi — đó là chỗ tra "IP này từng của ai".
        changes: {
          reason: options.reason ?? null,
          previousDeviceId: before.deviceId,
          previousUsedBy: before.usedBy,
          deviceId: rows[0].deviceId,
          usedBy: rows[0].usedBy,
        },
      });
      return rows[0];
    }
  }

  /**
   * "Xóa" hồ sơ IP NHẬP NHẦM (Q-15): đặt `voided_at`, có lý do — hàng ở lại giữ lịch sử (AD-13)
   * nhưng biến khỏi mọi màn và nhả địa chỉ để nhập lại ngay. Giao diện không có đường khôi phục.
   *
   * Chỉ dành cho hồ sơ NHẬP NHẦM. IP hết dùng thì đi đường vòng đời (thu hồi) —
   * ẩn một IP đang dùng là làm mất luôn cái lịch sử mà AC 5.2 đòi giữ vĩnh viễn.
   */
  async voidAddress(actor: string, id: string, reason: string): Promise<void> {
    const before = await this.requireAlive(id);
    const text = reason.trim();
    if (!text) {
      throw new BadRequestException({
        code: 'VOID_REASON_REQUIRED',
        message: 'Nói rõ vì sao xóa hồ sơ này (vd "gõ nhầm địa chỉ").',
      });
    }
    await this.db.transaction(async (tx) => {
      /*
       * ẨN cũng phải hỏi sổ NAT, y như THU HỒI (mẫu N1).
       *
       * Ẩn hồ sơ còn tệ hơn thu hồi một bậc: thu hồi thì địa chỉ vẫn còn trong sổ và người ta
       * còn thấy nó trống; ẩn thì hồ sơ BIẾN MẤT khỏi mọi màn, trong khi rule NAT vẫn lặng lẽ
       * chuyển gói tới đúng địa chỉ đó. Lỗ thủng vẫn nguyên mà cuốn sổ không còn chỗ nào nhắc
       * tới nó.
       */
      await this.assertNoLiveNatWithin(tx, before.address, 'void');
      await tx
        .update(ipAddressTable)
        .set({ voidedAt: new Date(), voidedBy: actor, voidReason: text })
        .where(eq(ipAddressTable.id, id));
      await this.audit.appendWithin(tx, {
        actor,
        action: 'ip.voided',
        objectType: 'ip_address',
        objectId: id,
        detail: { address: before.address, reason: text },
      });
      await tx.insert(ipHistoryTable).values({
        ipAddressId: id,
        action: 'ip.voided',
        actor,
        fromStatus: before.status,
        changes: { reason: text },
      });
    });
  }

  /**
   * KHÔI PHỤC một hồ sơ IP đã xóa — chỉ SA, chỉ qua API, giao diện không có nút (Q-15: xóa là để
   * nhập lại; bấm nhầm thì khai lại). Giữ cửa này vì hàng rào dưới đây đã có test và vì SA đôi
   * khi cần nối lại lịch sử cho đúng hồ sơ cũ thay vì một hồ sơ mới.
   *
   * ===== HAI HÀNG RÀO =====
   *
   * 1. Dải cha còn ẩn thì không bật lẻ được: một hồ sơ IP sống trong một dải đã cất đi sẽ
   *    không hiện ở màn nào — bật lại mà vẫn vô hình thì không phải bật lại.
   * 2. Địa chỉ đã bị hồ sơ khác chiếm trong lúc này thì từ chối. Không kiểm bằng SELECT chạy
   *    trước (mẫu M2): để chính `ip_address_key` (UNIQUE ... WHERE voided_at IS NULL) làm
   *    trọng tài rồi dịch 23505 thành câu tiếng Việt.
   * 3. DẢI ĐÃ ĐỔI từ lúc hồ sơ bị ẩn thì từ chối. Trọng tài cũng ở tầng DB
   *    (`ip_address_within_subnet`, trigger UPDATE có cả cột `voided_at`), vì cùng lý do
   *    với gạch 2: một câu SELECT chạy trước lại đẻ ra đúng mẫu M2 mà cả nhánh này đi dọn.
   *
   * VÌ SAO GẠCH 3 TỪNG KHÔNG CÓ. Trigger khai `BEFORE UPDATE OF address, subnet_id`, mà
   * `restore` chỉ đụng `voided_at` — nên trigger không chạy trên đường này. Ghép với hàng rào
   * đổi dải (chỉ đếm IP đang sống), ba cú bấm bình thường là ra một hàng 10.0.0.5 nằm trong
   * dải 192.168.1.0/24: ẩn hồ sơ → sửa dải (được, vì đếm ra 0) → bật lại. Không cuộc đua nào,
   * không lỗi hạ tầng nào.
   */
  async restore(actor: string, id: string): Promise<IpAddressRecord> {
    const before = await this.requireAny(id);
    if (before.voidedAt === null) {
      throw new ConflictException({
        code: 'IP_NOT_VOIDED',
        message: 'Hồ sơ này chưa bị xóa, không có gì để khôi phục.',
      });
    }
    const frame = await this.subnets.frameOf(before.subnetId);
    if (frame.voidedAt !== null) {
      throw new ConflictException({
        code: 'SUBNET_VOIDED',
        message:
          `Dải ${frame.cidr} đang ngừng dùng. Dùng lại cả dải trước.`,
      });
    }

    try {
      const row = await this.db.transaction(async (tx) => {
        /*
         * CAS trên `voided_at`: điều kiện "đang bị ẩn" phải nằm TRONG câu ghi, không chỉ ở câu
         * kiểm phía trên. Hai người cùng bấm "Bật lại" một hồ sơ thì không có gì loại trừ nhau
         * — cả hai đọc `voidedAt !== null`, cả hai ghi, và `audit_log` cùng `ip_history` (đều
         * CHỈ-THÊM, AD-13) để lại HAI dòng `ip.restored` cho MỘT lần bật lại. Không có đường
         * bù: xoá dòng lịch sử là đúng thứ AD-13 cấm.
         */
        const rows = await tx
          .update(ipAddressTable)
          .set({ voidedAt: null, voidedBy: null, voidReason: null, updatedAt: new Date() })
          .where(and(eq(ipAddressTable.id, id), isNotNull(ipAddressTable.voidedAt)))
          .returning();
        requireCas(rows, {
          code: 'IP_NOT_VOIDED',
          message: 'Hồ sơ này vừa được người khác khôi phục. Tải lại để xem trạng thái mới.',
        });
        await this.audit.appendWithin(tx, {
          actor,
          action: 'ip.restored',
          objectType: 'ip_address',
          objectId: id,
          detail: { address: before.address, previousReason: before.voidReason },
        });
        await tx.insert(ipHistoryTable).values({
          ipAddressId: id,
          action: 'ip.restored',
          actor,
          fromStatus: before.status,
          toStatus: before.status,
          changes: { previousReason: before.voidReason },
        });
        return rows[0];
      });
      return (await this.decorate([row]))[0];
    } catch (error) {
      /*
       * Dải đã đổi từ lúc hồ sơ bị ẩn. Câu này phải NÓI RA con số dải hiện tại: hồ sơ đã ẩn
       * không hiện ở màn nào, nên người bấm không có cách nào tự biết vì sao bị từ chối.
       */
      if (pgErrorCode(error) === PG_CHECK_VIOLATION) {
        throw new ConflictException({
          code: 'IP_OUT_OF_SUBNET',
          message:
            `Dải đã đổi thành ${frame.cidr} từ khi hồ sơ này bị xóa, nên ${before.address} ` +
            'không còn nằm trong dải. Khai một hồ sơ mới với địa chỉ thuộc dải hiện tại.',
        });
      }
      if (pgConstraint(error) === DEVICE_ONE_IP_CONSTRAINT) throw deviceHasIp(null);
      throw conflictOnUnique(error, {
        code: 'IP_TAKEN',
        message:
          `Địa chỉ ${before.address} đã có hồ sơ khác dùng sau khi hồ sơ này bị xóa. ` +
          'Xử lý hồ sơ kia trước.',
      });
    }
  }

  private requireHost(value: string, cidr: string): string {
    const parsed = parseAddress(value);
    if (!parsed.ok) {
      throw new BadRequestException({
        code: 'IP_INVALID',
        message:
          parsed.reason === 'leading_zero'
            ? 'Không viết số 0 đứng đầu (172.16.010.5 dễ bị hiểu nhầm). Viết 172.16.10.5.'
            : 'Địa chỉ IPv4 không hợp lệ. Ví dụ đúng: 172.16.10.5.',
      });
    }
    /**
     * Kiểm bằng danh sách địa chỉ CẤP ĐƯỢC, nên chặn luôn cả địa chỉ mạng và địa chỉ quảng
     * bá — hai thứ trigger của DB cho qua (chúng vẫn "nằm trong dải") nhưng gán cho máy nào
     * là máy đó không ra được mạng.
     */
    if (!enumerateHosts(cidr).includes(parsed.value)) {
      throw new BadRequestException({
        code: 'IP_OUT_OF_SUBNET',
        message: `Địa chỉ ${parsed.value} không cấp được trong dải ${cidr} (ngoài dải, hoặc là địa chỉ mạng/quảng bá).`,
      });
    }
    return parsed.value;
  }

  /**
   * Chặn nếu còn rule NAT SỐNG trỏ vào địa chỉ này.
   *
   * ===== KHỚP THEO ĐỊA CHỈ, KHÔNG THEO `ip_address_id` =====
   *
   * Đây là điểm dễ làm sai nhất. `nat_rule.ip_address_id` chỉ là liên kết MỀM: `linkIp()` để
   * `null` khi rule được khai trước lúc địa chỉ có hồ sơ IPAM ("không có cũng lưu được"), và
   * FK `ON DELETE SET NULL` thì không bao giờ bắn vì thu hồi/ẩn đều là XÓA MỀM. Khớp theo cột
   * đó sẽ bỏ sót đúng những rule nguy hiểm nhất — những rule không ai nối vào sổ IP.
   *
   * Thứ router THẬT SỰ chuyển gói tới là `internal_ip`. Nên hỏi đúng cột đó, bằng chính vị từ
   * `host(...)` mà `NatRuleService.linkIp()` dùng, để hai bên không bao giờ trả lời khác nhau.
   * Có index riêng cho nó: `nat_rule_internal_host_idx ON nat_rule (host(internal_ip))
   * WHERE voided_at IS NULL`. Chỉ mục trên cột `internal_ip` THÔ thì vô dụng ở đây: mọi câu
   * bọc nó trong `host(...)`, và một hàm quanh cột được đánh chỉ mục là chỉ mục KHÔNG bao giờ
   * được chọn.
   *
   * Chặn (chứ không cảnh báo) là có chủ ý: một port-forward đang mở trỏ vào máy sắp rời đi là
   * lỗ thủng tường lửa, và bước đúng — gỡ hoặc trỏ lại rule — luôn phải làm trước. Thông điệp
   * nêu đích danh port để người trực đi dọn được ngay; nói chung chung thì họ sẽ đi tìm đường
   * lách thay vì đi dọn.
   */
  private async assertNoLiveNatWithin(
    tx: Tx,
    address: string,
    /** Việc đang làm — chỉ dùng để câu lỗi nói đúng thứ người dùng vừa bấm. */
    purpose: keyof typeof PURPOSE_WARNING,
  ): Promise<void> {
    const rules = await tx
      .select({
        externalFrom: natRuleTable.externalFrom,
        externalTo: natRuleTable.externalTo,
        protocol: natRuleTable.protocol,
      })
      .from(natRuleTable)
      .where(
        and(
          sql`host(${natRuleTable.internalIp}) = host(${address}::inet)`,
          isNull(natRuleTable.voidedAt),
        ),
      )
      .orderBy(asc(natRuleTable.externalFrom));
    if (rules.length === 0) return;

    const list = rules
      .map((r) => `${r.protocol.toUpperCase()} ${describePortRange(r.externalFrom, r.externalTo)}`)
      .join(', ');
    throw new ConflictException({
      code: 'IP_HAS_LIVE_NAT',
      message:
        `Địa chỉ ${hostOf(address)} còn ${rules.length} luật NAT đang mở (${list}). ` +
        PURPOSE_WARNING[purpose] +
        ' Gỡ hoặc trỏ lại luật trong Sổ NAT trước, rồi làm lại.',
    });
  }

  /**
   * Máy nhận địa chỉ này còn dùng được không — hỏi TRONG `tx` và giữ khoá tới hết lượt ghi.
   *
   * `assertUsable*` chứ không `exists`: máy đã thanh lý không được nhận thêm IP. Thông điệp
   * và mã lỗi do `devices.api` giữ — bốn cửa phải nói cùng một câu.
   *
   * Bản `Within` chứ không phải bản trên pool: hỏi xong rồi mới mở transaction là chừa lại
   * đúng khoảng hở để một lượt thanh lý chen vào giữa, và địa chỉ được cấp cho một máy vừa ra
   * khỏi công ty mà không bên nào gặp lỗi (xem `DevicesApiService.assertUsableWithin`).
   */
  private async requireDeviceWithin(tx: Tx, deviceId: string | null | undefined): Promise<void> {
    if (!deviceId) return;
    await this.devices.assertUsableWithin(tx, deviceId);
  }

  /**
   * Q-20: máy đã giữ một IP đang cấp thì không nhận thêm. Kiểm trước để câu lỗi nêu được địa
   * chỉ đang giữ; trọng tài thật là chỉ mục `ip_address_device_uq` (lượt song song — `translate`).
   * `exceptId`: chính hồ sơ đang sửa / đang cấp lại không tính là "IP khác".
   */
  private async assertDeviceHasNoIpWithin(
    tx: Tx,
    deviceId: string | null | undefined,
    exceptId?: string,
  ): Promise<void> {
    if (!deviceId) return;
    const held = await tx
      .select({ id: ipAddressTable.id, address: ipAddressTable.address })
      .from(ipAddressTable)
      .where(
        and(
          eq(ipAddressTable.deviceId, deviceId),
          isNull(ipAddressTable.voidedAt),
          inArray(ipAddressTable.status, OCCUPYING_STATUSES),
        ),
      );
    const other = held.find((row) => row.id !== exceptId);
    if (other) throw deviceHasIp(hostOf(other.address));
  }

  /** Tra một hồ sơ KỂ CẢ đã ẩn — đường đọc lịch sử, và đường BẬT LẠI (`restore`). */
  private async requireAny(id: string): Promise<typeof ipAddressTable.$inferSelect> {
    const rows = await this.db.select().from(ipAddressTable).where(eq(ipAddressTable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        message: 'Không tìm thấy hồ sơ IP này.',
      });
    }
    return rows[0];
  }

  private requireAlive(id: string): Promise<typeof ipAddressTable.$inferSelect> {
    return this.requireAliveWithin(this.db, id);
  }

  /** Bản đọc TRONG transaction — `transitionWithin` phải thấy trạng thái của chính tx mình. */
  private async requireAliveWithin(
    tx: Pick<Database, 'select'>,
    id: string,
    lock?: 'update',
  ): Promise<typeof ipAddressTable.$inferSelect> {
    const query = tx
      .select()
      .from(ipAddressTable)
      .where(and(eq(ipAddressTable.id, id), isNull(ipAddressTable.voidedAt)));
    const rows = await (lock ? query.for(lock) : query);
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        message: 'Không tìm thấy hồ sơ IP này (có thể đã bị xóa).',
      });
    }
    return rows[0];
  }

  /** Gắn mã/tên thiết bị qua `devices.api` — KHÔNG join thẳng bảng `device` (AD-2/AD-3). */
  private async decorate(
    rows: (typeof ipAddressTable.$inferSelect)[],
  ): Promise<IpAddressRecord[]> {
    /*
     * MỘT lượt hỏi `devices.api` cho cả trang, không phải một lượt mỗi thiết bị.
     *
     * Đừng gọi `getById` trong vòng lặp: hàm đó tốn 8 truy vấn (đọc hàng `device` +
     * `catalog.lists()` bắn 7 câu không cache). Một dải /24 gán đầy là ~2000 câu cho MỘT lần
     * mở màn — và nó lớn lên theo số máy, đúng chiều mà sổ IPAM sẽ lớn lên.
     */
    const deviceIds = [...new Set(rows.map((row) => row.deviceId).filter(Boolean))] as string[];
    const devices = await this.devices.getByIds(deviceIds);
    return rows.map((row) => {
      const device = row.deviceId ? (devices.get(row.deviceId) ?? null) : null;
      return {
        id: row.id,
        subnetId: row.subnetId,
        address: hostOf(row.address),
        deviceId: row.deviceId,
        deviceCode: device?.code ?? null,
        deviceName: device?.name ?? null,
        deviceSiteCode: device?.siteCode ?? null,
        usedBy: row.usedBy,
        assignedBy: row.assignedBy,
        assignedAt: row.assignedAt,
        status: row.status as IpStatus,
        note: row.note,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        voidedAt: row.voidedAt,
        voidedBy: row.voidedBy,
        voidReason: row.voidReason,
      };
    });
  }

  private translate(error: unknown, address: string, cidr: string | null): unknown {
    // Trigger `ip_address_within_subnet` — hàng rào cuối ở tầng DB. Xét TRƯỚC vì nhánh 23505
    // bên dưới là nhánh trả về mặc định; 23514 và 23505 loại trừ nhau nên thứ tự không đổi nghĩa.
    if (pgErrorCode(error) === PG_CHECK_VIOLATION) {
      return new BadRequestException({
        code: 'IP_OUT_OF_SUBNET',
        message: cidr
          ? `Địa chỉ ${address} không nằm trong dải ${cidr}.`
          : `Địa chỉ ${address} không nằm trong dải của hồ sơ này.`,
      });
    }
    // Lượt cấp song song thua ở chỉ mục một-máy-một-IP: câu kiểm trước của nó chạy khi lượt kia
    // chưa commit nên không biết địa chỉ đang giữ — báo chung, người dùng tải lại sẽ thấy.
    if (pgConstraint(error) === DEVICE_ONE_IP_CONSTRAINT) return deviceHasIp(null);
    return conflictOnUnique(error, {
      code: 'IP_TAKEN',
      message:
        `Địa chỉ ${address} đã có hồ sơ trong dải này. ` +
        'Hồ sơ đó đang trống thì bấm "Cấp IP" trên chính dòng đó.',
    });
  }
}

/**
 * Q-14: hồ sơ IP phải gắn thiết bị hoặc người/bộ phận — có hồ sơ là Đang dùng (Q-02), và một
 * hồ sơ không chủ chỉ là dòng "Trống" mồ côi đứng cạnh ô trống thật.
 */
function requireOwner(
  deviceId: string | null | undefined,
  usedBy: string | null | undefined,
): void {
  if (deviceId || usedBy?.trim()) return;
  throw new BadRequestException({
    code: 'IP_OWNER_REQUIRED',
    message: 'Chọn thiết bị hoặc nhập người/phòng ban dùng IP này.',
  });
}

/** Nhãn tiếng Việt cho thông điệp lỗi — khớp `STATUS_KEY` phía web. */
const STATUS_LABEL: Record<IpStatus, string> = {
  free: 'Trống',
  assigned: 'Đang dùng',
};
