import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { requireCas, requireUnchangedSince } from '../../common/cas';
import { HISTORY_PAGE_LIMIT } from '../../common/history';
import type { Tx } from '../../common/tx';
import { PG_CHECK_VIOLATION, conflictOnUnique, pgErrorCode } from '../../common/sql';
import { diffRecord, hasChanges } from '../../common/record-diff';
import { isoDateInTz } from '../../common/today';
import { AuditWriterService } from '../audit/audit-writer.service';
import { SystemConfigService } from '../config-sys/system-config.service';
import { DevicesApiService } from '../devices/devices.api';
import { enumerateHosts, hostOf, keepPreferredByAddress, parseAddress } from './ip-rules';
import {
  IP_LIFECYCLE_STATUSES,
  OCCUPYING_STATUSES,
  canTransition,
  isOccupying,
  nextStatuses,
  transitionLabel,
  type IpStatus,
} from './ip-lifecycle';
import { describePortRange } from './nat-rules';
import { ipAddressTable, ipHistoryTable, natRuleTable } from './ipam.schema';
import { SubnetService } from './subnet.service';

/** MỘT nguồn sự thật cho danh sách trạng thái — `ip-lifecycle.ts` (AD-15). */
export const IP_STATUSES = IP_LIFECYCLE_STATUSES;
export type { IpStatus };

/** Câu cảnh báo theo đúng việc người dùng vừa bấm — xem `assertNoLiveNatWithin`. */
const PURPOSE_WARNING = {
  reclaim: 'Thu hồi mà để nguyên rule thì port vẫn mở và sẽ trỏ vào máy được cấp tiếp theo.',
  assign: 'Cấp cho máy khác mà để nguyên rule là giao thẳng port đang mở cho máy mới.',
  void: 'Ẩn hồ sơ thì địa chỉ này biến khỏi mọi màn, còn rule NAT vẫn chuyển gói tới đó — lỗ thủng còn nguyên mà không còn chỗ nào nhắc tới nó.',
  readdress:
    'Dời hồ sơ sang địa chỉ khác mà để nguyên rule thì rule vẫn trỏ vào địa chỉ CŨ — sổ NAT và sổ IP nói khác nhau về cùng một cái máy.',
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
   * Ra khỏi service từ 09/09. Trước đó `decorate` không trả ba trường này, nên khi màn dải
   * xin thêm hồ sơ đã ẩn (`?includeVoided=true`) thì chúng về trông y hệt hồ sơ đang sống —
   * và cửa `restore()` không có cách nào biết nên bày nút cho dòng nào. Đúng bẫy đã gặp ở
   * `SubnetRecord`: ba cột có từ 0020 nhưng không bao giờ ra tới giao diện.
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
}

/** Một dòng trên màn "toàn bộ dải": hoặc là hồ sơ thật, hoặc là một ô trống. */
export type SubnetSlot =
  | ({ kind: 'record' } & IpAddressRecord)
  | { kind: 'free'; address: string };

/**
 * Hồ sơ IP (story 5.1, FR-018/FR-019). Chủ sở hữu bảng `ip_address` + `ip_history` (AD-3).
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
   * và ngày cấp IP sẽ lùi một ngày suốt cả buổi sáng — đúng lỗi E2E của Epic 3 bắt được.
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
     * Dải ĐÃ VÔ HIỆU HÓA thì hiện luôn cả những hồ sơ IP đã tắt theo nó.
     *
     * Bỏ chúng đi thì 254 địa chỉ hiện ra là 254 ô TRỐNG — và "trống" ở màn này có nghĩa rất
     * cụ thể: cấp cho máy khác được. Trong khi sự thật là mấy chục cái máy vẫn đang cắm đúng
     * những địa chỉ đó dưới dạng IP tĩnh; không cái nào tự nhả ra chỉ vì cuốn sổ đã cất dải đi.
     * Đây chính là lý do người dùng mở phiếu: vô hiệu hóa mà nhìn như đã xóa sạch.
     *
     * Dải đang dùng thì ngược lại — hồ sơ bị xóa lẻ ("gõ nhầm địa chỉ") PHẢI biến thành ô
     * trống, vì đó là toàn bộ ý nghĩa của việc xóa nó.
     *
     * `includeVoided` là cửa XIN thêm, do người dùng bật ("Hiện hồ sơ đã ẩn"). Nó phải tồn
     * tại vì cửa `restore()` cần một đường tới: ẩn nhầm một hồ sơ mà không màn nào hiện nó ra
     * nữa thì bật lại chỉ là một endpoint không ai gọi được (rà soát 07/09, mục 6).
     */
    const frame = await this.subnets.frameOf(subnetId);
    const records = await this.listRecords(subnetId, {
      includeVoided: includeVoided || frame.voidedAt !== null,
    });
    /*
     * `keepPreferredByAddress`, KHÔNG phải `new Map(records.map(...))` (F-10, vá 21/09).
     *
     * `ip_address_key` là UNIQUE một phần (`WHERE voided_at IS NULL`), nên một địa chỉ có thể
     * có 1 hàng sống + N hàng đã ẩn — và bản trước giữ hàng CUỐI, mà "cuối" do Postgres quyết.
     * Xem luật và hậu quả ở chính hàm ấy.
     */
    const byAddress = keepPreferredByAddress(records);

    return enumerateHosts(frame.cidr).map<SubnetSlot>((address) => {
      const record = byAddress.get(address);
      return record ? { kind: 'record', ...record } : { kind: 'free', address };
    });
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
   * máy được thanh lý trong khi vẫn đang giữ nó. Đó đúng là mẫu M2 mà cả đợt rà soát này dọn.
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

  /** IP của một thiết bị — panel IP trên trang thiết bị (story 5.4) hỏi cái này. */
  async listForDevice(deviceId: string): Promise<IpAddressRecord[]> {
    const rows = await this.db
      .select()
      .from(ipAddressTable)
      .where(and(eq(ipAddressTable.deviceId, deviceId), isNull(ipAddressTable.voidedAt)))
      .orderBy(asc(ipAddressTable.address));
    return this.decorate(rows);
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
   * Trước 09/09 đây là bản LỆCH DUY NHẤT trong mười bộ đọc lịch sử của repo, và là bản lệch
   * duy nhất NGƯỜI DÙNG NHÌN THẤY: nó `asc` và không trần, nên panel Lịch sử của IP hiện
   * cũ-nhất-trên-đầu trong khi chín màn kia hiện mới-nhất-trên-đầu. Người đọc chuyển qua lại
   * giữa hai màn sẽ đọc sai thứ tự mà không nhận ra — dòng đầu bảng ở màn này là "lâu rồi",
   * ở màn kia là "vừa xong".
   *
   * Trần 200 cũng đi kèm, cùng lý do với chín bản kia: một IP bị chuyển trạng thái hàng ngày
   * trong vài năm sẽ kéo cả nghìn dòng về trình duyệt cho một cái panel không ai cuộn hết.
   * Rà soát 07/09, mục 6 "Kiến trúc".
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
    const status = input.status ?? (input.deviceId || input.usedBy ? 'assigned' : 'free');

    try {
      const row = await this.db.transaction(async (tx) => {
        await this.requireDeviceWithin(tx, input.deviceId);
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
          changes: { address, deviceId: input.deviceId ?? null, usedBy: input.usedBy ?? null },
        });
        return rows[0];
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
     * Trạng thái KHÔNG sửa được qua đây — phải đi `transition()` (story 5.2).
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
     * Bản trước để `status` nguyên: một hàng vừa có tên máy vừa mang badge "Trống", còn nút
     * lọc phía trên đếm "Đang cấp 0" — bảng và con số nói ngược nhau, và cả hai đều đúng theo
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

    /*
     * ĐỔI CHỦ hoặc DỜI ĐỊA CHỈ qua đường sửa hồ sơ cũng phải hỏi sổ NAT (rà soát 10/09).
     *
     * Bản vá finding #6 đặt hàng rào ở `transitionWithin` và `voidAddress` — hai cửa HẸP. Cửa
     * này dẫn tới đúng cùng một hậu quả, chỉ khác đường vào:
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
   * Chuyển trạng thái vòng đời (story 5.2, FR-019).
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
    options: { reason?: string | null; deviceId?: string | null; usedBy?: string | null } = {},
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
    options: { reason?: string | null; deviceId?: string | null; usedBy?: string | null } = {},
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
      values.assignedAt = isoDateInTz(await this.timezone());
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
          'Địa chỉ IP này vừa được người khác đổi trạng thái (hoặc dải chứa nó vừa bị ẩn). Tải lại để xem trạng thái mới.',
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
        // Ghi lại CHỦ CŨ ngay tại dòng thu hồi — đó là chỗ tra "trước đây IP này của ai".
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
   * "Xóa" = ẩn, có lý do (quyết định 2026-08-23).
   *
   * Chỉ dành cho hồ sơ NHẬP NHẦM. IP hết dùng thì đi đường vòng đời (thu hồi, story 5.2) —
   * ẩn một IP đang dùng là làm mất luôn cái lịch sử mà AC 5.2 đòi giữ vĩnh viễn.
   */
  async voidAddress(actor: string, id: string, reason: string): Promise<void> {
    const before = await this.requireAlive(id);
    const text = reason.trim();
    if (!text) {
      throw new BadRequestException({
        code: 'VOID_REASON_REQUIRED',
        message: 'Nói rõ vì sao ẩn hồ sơ này (vd "gõ nhầm địa chỉ").',
      });
    }
    await this.db.transaction(async (tx) => {
      /*
       * ẨN cũng phải hỏi sổ NAT, y như THU HỒI (rà soát 08/09, #5 — mẫu N1).
       *
       * Bản đầu của hàng rào #6 chỉ áp cho `transition`, bỏ trống cửa này. Nhưng ẩn hồ sơ còn
       * tệ hơn thu hồi một bậc: thu hồi thì địa chỉ vẫn còn trong sổ và người ta còn thấy nó
       * trống; ẩn thì hồ sơ BIẾN MẤT khỏi mọi màn, trong khi rule NAT vẫn lặng lẽ chuyển gói
       * tới đúng địa chỉ đó. Lỗ thủng vẫn nguyên mà cuốn sổ không còn chỗ nào nhắc tới nó.
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
   * BẬT LẠI một hồ sơ IP đã ẩn — cửa đối ứng của `voidAddress`.
   *
   * ===== VÌ SAO PHẢI CÓ =====
   *
   * `voidAddress` tự nhận là "chỉ dành cho hồ sơ NHẬP NHẦM". Nhưng bấm nhầm ở đây là chuyện
   * cùng loại với gõ nhầm: ẩn `.5` (Phòng Kế toán, thật) trong khi định ẩn `.6`. Và cho tới
   * 09/09 đó là đường MỘT CHIỀU — `SubnetService.restore()` bật lại được cả một dải, còn một
   * hồ sơ IP lẻ thì không có cửa nào. Hồ sơ đã ẩn biến khỏi mọi màn (`listBySubnet` chỉ hiện
   * hàng đã ẩn khi chính DẢI bị ẩn), `findOne` trả 404, nên nó cũng không mở ra xem được lý
   * do vì sao mình vừa ẩn nó. Nhãn `'ip.restored'` có sẵn trong `ip-history-entries.ts` mà
   * không đường nào tới được cho hồ sơ lẻ.
   *
   * Hậu quả cụ thể: ô `.5` hiện ra là TRỐNG, người khác cấp nó cho máy khác, và lịch sử
   * "IP này từng là máy in kế toán" — thứ AC 5.2 bắt giữ vĩnh viễn — nằm mồ côi dưới một hàng
   * không ai nhìn thấy.
   *
   * ===== HAI HÀNG RÀO =====
   *
   * 1. Dải cha còn ẩn thì không bật lẻ được: một hồ sơ IP sống trong một dải đã cất đi sẽ
   *    không hiện ở màn nào — bật lại mà vẫn vô hình thì không phải bật lại.
   * 2. Địa chỉ đã bị hồ sơ khác chiếm trong lúc này thì từ chối. Không kiểm bằng SELECT chạy
   *    trước (mẫu M2): để chính `ip_address_key` (UNIQUE ... WHERE voided_at IS NULL) làm
   *    trọng tài rồi dịch 23505 thành câu tiếng Việt.
   * 3. DẢI ĐÃ ĐỔI từ lúc hồ sơ bị ẩn thì từ chối. Trọng tài cũng ở tầng DB
   *    (`ip_address_within_subnet`, mở rộng sang `voided_at` ở migration 0044), vì cùng lý do
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
        message: 'Hồ sơ này đang hiển thị, không có gì để bật lại.',
      });
    }
    const frame = await this.subnets.frameOf(before.subnetId);
    if (frame.voidedAt !== null) {
      throw new ConflictException({
        code: 'SUBNET_VOIDED',
        message:
          `Dải ${frame.cidr} đang bị ẩn nên bật lẻ hồ sơ này cũng không hiện ra ở đâu. ` +
          'Bật lại cả dải trước.',
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
          message: 'Hồ sơ này vừa được người khác bật lại. Tải lại để xem trạng thái mới.',
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
            `Dải đã đổi thành ${frame.cidr} từ khi hồ sơ này bị ẩn, nên ${before.address} ` +
            'không còn nằm trong dải. Khai một hồ sơ mới với địa chỉ thuộc dải hiện tại.',
        });
      }
      throw conflictOnUnique(error, {
        code: 'IP_TAKEN',
        message:
          `Địa chỉ ${before.address} đã có hồ sơ khác dùng sau khi hồ sơ này bị ẩn. ` +
          'Bật lại sẽ có hai hồ sơ cho cùng một địa chỉ — xử lý hồ sơ kia trước.',
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
   * WHERE voided_at IS NULL` (migration 0042). Bản 0022 đánh chỉ mục cột `internal_ip` THÔ, mà
   * mọi câu ở đây lại bọc nó trong `host(...)` — một hàm quanh cột được đánh chỉ mục là chỉ
   * mục KHÔNG bao giờ được chọn. Nó tồn tại, tốn chỗ, tốn công ghi, và chưa từng giúp đọc.
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
        `Địa chỉ ${hostOf(address)} còn ${rules.length} rule NAT đang mở (${list}). ` +
        PURPOSE_WARNING[purpose] +
        ' Vào sổ NAT gỡ hoặc trỏ lại rule trước, rồi làm lại.',
    });
  }

  /**
   * Máy nhận địa chỉ này còn dùng được không — hỏi TRONG `tx` và giữ khoá tới hết lượt ghi.
   *
   * `assertUsable*` chứ không `exists`: máy đã thanh lý không được nhận thêm IP (rà soát
   * 07/09). Thông điệp và mã lỗi do `devices.api` giữ — bốn cửa phải nói cùng một câu.
   *
   * Bản `Within` chứ không phải bản trên pool: hỏi xong rồi mới mở transaction là chừa lại
   * đúng khoảng hở để một lượt thanh lý chen vào giữa, và địa chỉ được cấp cho một máy vừa ra
   * khỏi công ty mà không bên nào gặp lỗi (xem `DevicesApiService.assertUsableWithin`).
   */
  private async requireDeviceWithin(tx: Tx, deviceId: string | null | undefined): Promise<void> {
    if (!deviceId) return;
    await this.devices.assertUsableWithin(tx, deviceId);
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
        message: 'Không tìm thấy hồ sơ IP này (có thể đã ẩn).',
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
     * Bản trước gọi `getById` trong vòng lặp, mà hàm đó tốn 8 truy vấn (đọc hàng `device` +
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
    return conflictOnUnique(error, {
      code: 'IP_TAKEN',
      message:
        `Địa chỉ ${address} đã có hồ sơ trong dải này. Một IP chỉ có một chủ — ` +
        'nếu hồ sơ cũ đang trống thì dùng "Cấp IP" trên chính dòng đó, đừng tạo hồ sơ mới ' +
        '(tạo mới là mất lịch sử cũ).',
    });
  }
}

/** Nhãn tiếng Việt cho thông điệp lỗi — khớp `STATUS_KEY` phía web. */
const STATUS_LABEL: Record<IpStatus, string> = {
  free: 'Trống',
  assigned: 'Đang cấp',
};
