import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { conflictOnUnique } from '../../common/sql';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CatalogApiService } from '../catalog/catalog.api';
import { isHostInSubnet, normalizeSubnet, subnetUsage, type SubnetUsage } from './ip-rules';
import { OCCUPYING_STATUSES } from './ip-lifecycle';
import { ipAddressTable, ipHistoryTable, subnetTable } from './ipam.schema';

export interface SubnetRecord {
  id: string;
  name: string;
  cidr: string;
  siteId: string | null;
  siteCode: string | null;
  /** Số VLAN 802.1Q (0029) — ở PMH người ta gọi dải theo VLAN chứ không theo CIDR. */
  vlan: number | null;
  /** Gateway của dải (0035) — câu hỏi đầu tiên khi khai IP tĩnh cho một cái máy. */
  gateway: string | null;
  description: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Dải đã VÔ HIỆU HÓA hay chưa — `null` là đang dùng.
   *
   * Ba cột này có từ migration 0020; cái MỚI (28/08/2026) là chúng ra khỏi service.
   *
   * Trước 28/08/2026 ba trường này không bao giờ ra khỏi service: `list()` lọc thẳng
   * `voidedAt IS NULL`, nên một dải vừa vô hiệu hóa là BIẾN MẤT khỏi màn hình. Người dùng đọc
   * đúng cái đó là "đã xóa", và họ không sai — không còn chỗ nào trên giao diện nói nó tồn
   * tại, trong khi mấy chục máy vẫn đang cắm IP tĩnh thuộc dải ấy.
   */
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
}

export interface SubnetWithUsage extends SubnetRecord, SubnetUsage {
  /**
   * Có BAO NHIÊU hồ sơ IP từng thuộc dải này, kể cả đã thu hồi hoặc đã ẩn.
   *
   * Khác `used` (chỉ đếm IP đang chiếm chỗ): con số này trả lời "dải này đã từng được dùng
   * chưa", và đó mới là câu quyết định xóa cứng được hay không. Một dải có 0 IP đang dùng
   * nhưng 40 IP đã thu hồi vẫn đang giữ lịch sử "IP này từng của máy nào" (AC 5.2).
   */
  addressCount: number;
}

export interface SubnetInput {
  name: string;
  cidr: string;
  siteId?: string | null;
  vlan?: number | null;
  /** Chuỗi rỗng = xóa gateway đang có. `undefined` = đừng đụng tới. */
  gateway?: string | null;
  description?: string | null;
}

/**
 * Dải mạng (story 5.1, FR-018). Chủ sở hữu bảng `subnet` (AD-3).
 *
 * Ẩn (nhập nhầm) chứ không xóa — quyết định của anh Thuận 2026-08-23. Áp cho mọi bảng
 * nghiệp vụ từ Epic 5 trở đi.
 */
@Injectable()
export class SubnetService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly catalog: CatalogApiService,
  ) {}

  /**
   * Danh sách kèm mức sử dụng (FR-020) — màn subnet cần cả hai, đừng bắt UI gọi hai lần.
   *
   * `includeVoided` mặc định TẮT, và đó là mặc định đúng: mọi thứ đọc dải qua `IpamApiService`
   * (bảng điều khiển "Dải mạng sắp đầy", form NAT…) đang hỏi "dải nào đang dùng". Chỉ MÀN dải
   * mạng bật cờ này lên, vì nó là nơi duy nhất có việc với một dải đã vô hiệu hóa: xem lại,
   * bật lại, hoặc xóa hẳn.
   */
  async list(options: { includeVoided?: boolean } = {}): Promise<SubnetWithUsage[]> {
    const rows = await this.db
      .select()
      .from(subnetTable)
      .where(options.includeVoided ? undefined : isNull(subnetTable.voidedAt))
      .orderBy(asc(subnetTable.cidr));

    /**
     * Đếm IP theo TỪNG subnet bằng MỘT câu group-by, không phải N câu trong vòng lặp.
     * Với vài chục subnet thì N+1 chưa giết ai, nhưng đây là màn mở hằng ngày và câu group-by
     * không dài hơn vòng lặp là bao.
     */
    const counts = await this.db
      .select({ subnetId: ipAddressTable.subnetId, used: count() })
      .from(ipAddressTable)
      .where(and(isNull(ipAddressTable.voidedAt), occupying()))
      .groupBy(ipAddressTable.subnetId);
    const usedBySubnet = new Map(counts.map((row) => [row.subnetId, Number(row.used)]));

    /*
     * Đếm thứ HAI: tổng số hàng, KHÔNG lọc gì cả.
     *
     * Nó trả lời câu khác hẳn `used`: "dải này đã từng được dùng chưa". Màn hình dựa vào đó
     * để bày nút Xóa (xóa cứng, chỉ khi chưa từng dùng) hay nút Vô hiệu hóa.
     */
    const totals = await this.db
      .select({ subnetId: ipAddressTable.subnetId, all: count() })
      .from(ipAddressTable)
      .groupBy(ipAddressTable.subnetId);
    const allBySubnet = new Map(totals.map((row) => [row.subnetId, Number(row.all)]));

    const sites = await this.siteCodes();
    return rows.map((row) => ({
      ...this.toRecord(row, sites),
      ...subnetUsage(row.cidr, usedBySubnet.get(row.id) ?? 0),
      addressCount: allBySubnet.get(row.id) ?? 0,
    }));
  }

  /**
   * Một dải, KỂ CẢ đã vô hiệu hóa — đây là đường ĐỌC.
   *
   * Dải đã tắt vẫn phải mở ra xem được: đó là chỗ duy nhất trả lời "hồi đó dải này có những
   * IP nào" trước khi quyết định bật lại hay xóa hẳn. Chặn ở đây thì nút "Bật lại" vừa thêm
   * dẫn tới một trang 404.
   */
  async findOne(id: string): Promise<SubnetWithUsage> {
    const row = await this.requireAny(id);
    const [used] = await this.db
      .select({ used: count() })
      .from(ipAddressTable)
      .where(
        and(eq(ipAddressTable.subnetId, id), isNull(ipAddressTable.voidedAt), occupying()),
      );
    const [all] = await this.db
      .select({ all: count() })
      .from(ipAddressTable)
      .where(eq(ipAddressTable.subnetId, id));
    const sites = await this.siteCodes();
    return {
      ...this.toRecord(row, sites),
      ...subnetUsage(row.cidr, Number(used?.used ?? 0)),
      addressCount: Number(all?.all ?? 0),
    };
  }

  async create(actor: string, input: SubnetInput): Promise<SubnetRecord> {
    const cidr = this.requireCidr(input.cidr);
    await this.requireSite(input.siteId);
    const name = this.requireName(input.name);
    const gateway = this.requireGateway(input.gateway, cidr);

    try {
      return await this.db.transaction(async (tx) => {
        const rows = await tx
          .insert(subnetTable)
          .values({
            name,
            cidr,
            siteId: input.siteId || null,
            vlan: input.vlan ?? null,
            gateway,
            description: input.description?.trim() || null,
            createdBy: actor,
          })
          .returning();
        await this.audit.appendWithin(tx, {
          actor,
          action: 'subnet.created',
          objectType: 'subnet',
          objectId: rows[0].id,
          detail: { name, cidr },
        });
        return this.toRecord(rows[0], new Map());
      });
    } catch (error) {
      throw this.translate(error, cidr);
    }
  }

  async update(actor: string, id: string, input: Partial<SubnetInput>): Promise<SubnetRecord> {
    const before = await this.requireAlive(id);
    const values: {
      name?: string;
      description?: string | null;
      siteId?: string | null;
      vlan?: number | null;
      gateway?: string | null;
      cidr?: string;
    } = {};
    if (input.name !== undefined) values.name = this.requireName(input.name);
    if (input.description !== undefined) {
      values.description = input.description?.trim() || null;
    }
    if (input.vlan !== undefined) values.vlan = input.vlan ?? null;
    /*
     * Gateway kiểm theo dải SẼ CÓ sau lần sửa này, không phải dải cũ.
     *
     * `input.cidr` xử lý ở dưới, nhưng dải chỉ đổi được khi chưa có IP nào — nên ở đây dùng
     * `input.cidr ?? before.cidr` là đủ và đúng: sửa cả hai cùng lúc thì gateway phải hợp với
     * dải mới, còn chỉ sửa gateway thì hợp với dải đang có.
     */
    if (input.gateway !== undefined) {
      values.gateway = this.requireGateway(
        input.gateway,
        input.cidr === undefined ? before.cidr : this.requireCidr(input.cidr),
      );
    }
    if (input.siteId !== undefined) {
      await this.requireSite(input.siteId);
      values.siteId = input.siteId || null;
    }
    /**
     * Dải KHÔNG sửa được khi đã có IP bên trong.
     *
     * Thu hẹp dải thì những IP đang nằm ngoài dải mới trở thành rác lặng lẽ: trigger chỉ chạy
     * khi INSERT/UPDATE chính hàng IP, nên chúng ở lại, vẫn hiện trên màn hình, vẫn trông hợp
     * lệ. Muốn đổi dải thì ẩn subnet cũ và khai subnet mới — chậm hơn một chút, nhưng không
     * để lại thứ gì sai mà không ai biết.
     *
     * Ở đây CHỈ chuẩn hóa chuỗi (hàm thuần). Việc "đã có IP chưa" phải hỏi bên trong
     * transaction — xem chú thích tại chỗ hỏi.
     */
    const nextCidr =
      input.cidr === undefined
        ? null
        : ((cidr) => (cidr === before.cidr ? null : cidr))(this.requireCidr(input.cidr));

    try {
      return await this.db.transaction(async (tx) => {
        if (nextCidr !== null) {
          /*
           * KHÓA HÀNG SUBNET RỒI MỚI ĐẾM — trong cùng transaction với lượt ghi (AD-5, mẫu M2).
           *
           * Bản trước đếm bằng `this.db` (ngoài tx) rồi mới mở transaction để UPDATE. Giữa hai
           * câu lệnh đó, một lượt khai IP hoàn toàn bình thường lọt qua: trigger
           * `ip_address_within_subnet()` đọc dải CŨ, thấy hợp lệ, commit. Rồi câu UPDATE ở đây
           * đổi dải — và để lại đúng thứ chú thích ngay trên tự hứa sẽ không bao giờ có: một
           * hồ sơ IP nằm ngoài dải của chính nó, không lỗi, không cảnh báo, trigger không bao
           * giờ chạy lại trên hàng đó.
           *
           * `FOR UPDATE` ở đây bắt cặp với `FOR SHARE` trong trigger (migration 0040): hai lượt
           * loại trừ nhau nên thứ tự nào cũng đúng — hoặc lượt khai IP bị dải mới từ chối, hoặc
           * lượt đổi dải đếm được IP vừa khai và từ chối.
           */
          await tx.execute(sql`SELECT 1 FROM subnet WHERE id = ${id}::uuid FOR UPDATE`);
          const [existing] = await tx
            .select({ used: count() })
            .from(ipAddressTable)
            .where(and(eq(ipAddressTable.subnetId, id), isNull(ipAddressTable.voidedAt)));
          if (Number(existing?.used ?? 0) > 0) {
            throw new ConflictException({
              code: 'SUBNET_HAS_ADDRESSES',
              message:
                'Dải này đã có hồ sơ IP nên không đổi được dải. Ẩn dải cũ rồi khai dải mới.',
            });
          }
          values.cidr = nextCidr;
        }

        const rows = await tx
          .update(subnetTable)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(subnetTable.id, id))
          .returning();
        await this.audit.appendWithin(tx, {
          actor,
          action: 'subnet.updated',
          objectType: 'subnet',
          objectId: id,
          detail: values,
        });
        return this.toRecord(rows[0], new Map());
      });
    } catch (error) {
      throw this.translate(error, values.cidr ?? before.cidr);
    }
  }

  /**
   * "Xóa" = ẩn, có lý do (quyết định 2026-08-23). Bản ghi ở lại, tra cứu được, còn vết ai ẩn.
   *
   * Còn IP bên trong thì KHÔNG cho ẩn: ẩn dải mà để lại IP trỏ vào nó thì màn IP hiện một
   * đống hàng thuộc về một dải không còn tồn tại trên màn hình nào.
   */
  async voidSubnet(actor: string, id: string, reason: string): Promise<void> {
    await this.requireAlive(id);
    const text = reason.trim();
    if (!text) {
      throw new BadRequestException({
        code: 'VOID_REASON_REQUIRED',
        message: 'Nói rõ vì sao ẩn dải này (vd "khai nhầm dải").',
      });
    }
    /*
     * Vô hiệu hóa dải thì ẨN LUÔN mọi hồ sơ IP bên trong — CÙNG một lý do, cùng một lượt.
     *
     * Bản trước từ chối thẳng ("Ẩn hết IP trong dải trước đã") và bắt người dùng đi ẩn tay
     * từng địa chỉ. Với một dải /24 đã dùng một nửa thì đó là hơn trăm lượt bấm cho một quyết
     * định họ đã ra rồi — và không ai làm, nên dải hỏng cứ nằm đó.
     *
     * Ẩn chứ KHÔNG xóa: `ip_history` vẫn trỏ vào những hàng này, và câu "IP này từng của máy
     * nào" mà AC 5.2 bắt giữ vĩnh viễn nằm ở đó. Mỗi hàng vẫn để lại một dòng lịch sử nói rõ
     * nó bị ẩn theo dải nào, chứ không biến mất im lặng.
     */
    await this.db.transaction(async (tx) => {
      const now = new Date();
      /*
       * Danh sách hàng bị ẩn lấy TỪ CHÍNH câu UPDATE (`returning`), không phải từ một câu
       * SELECT chạy trước đó ngoài transaction.
       *
       * Bản trước đọc `children` bằng `this.db` (ngoài tx) rồi mới UPDATE trong tx. Chỉ cần
       * một IP được cấp trong khoảnh khắc giữa hai câu lệnh: câu UPDATE ẩn luôn hàng mới đó
       * (nó khớp `subnet_id` + `voided_at IS NULL`), nhưng vòng ghi `ip_history` chạy trên
       * ảnh chụp cũ nên KHÔNG sinh dòng `ip.voided` cho nó — vi phạm đúng điều chú thích
       * ngay trên đây tự hứa ("mỗi hàng vẫn để lại một dòng lịch sử… chứ không biến mất im
       * lặng") và đúng điều AC 5.2 bắt giữ vĩnh viễn. Tệ hơn: `restore()` khớp theo
       * `voidedAt = stamp` sẽ hồi sinh hàng đó và ghi `ip.restored`, nên lịch sử có "bật lại"
       * mà không có "ẩn". `addressesVoided` trong audit cũng sai số.
       */
      const voided = await tx
        .update(ipAddressTable)
        .set({ voidedAt: now, voidedBy: actor, voidReason: text, updatedAt: now })
        .where(and(eq(ipAddressTable.subnetId, id), isNull(ipAddressTable.voidedAt)))
        .returning({ id: ipAddressTable.id, status: ipAddressTable.status });

      if (voided.length > 0) {
        await tx.insert(ipHistoryTable).values(
          voided.map((child) => ({
            ipAddressId: child.id,
            action: 'ip.voided',
            actor,
            fromStatus: child.status,
            toStatus: child.status,
            changes: { reason: `ẩn theo dải: ${text}` },
          })),
        );
      }
      await tx
        .update(subnetTable)
        .set({ voidedAt: now, voidedBy: actor, voidReason: text })
        .where(eq(subnetTable.id, id));
      await this.audit.appendWithin(tx, {
        actor,
        action: 'subnet.voided',
        objectType: 'subnet',
        objectId: id,
        detail: { reason: text, addressesVoided: voided.length },
      });
    });
  }

  /**
   * BẬT LẠI một dải đã vô hiệu hóa, kéo theo đúng những hồ sơ IP đã tắt CÙNG NÓ.
   *
   * "Cùng nó" nhận ra bằng dấu thời gian: `voidSubnet` đóng dải và mọi IP bên trong bằng MỘT
   * `now` duy nhất trong một transaction, nên `ip_address.voided_at = subnet.voided_at` là
   * điều kiện chính xác, không phải phỏng đoán. Quan trọng là nó KHÔNG đụng tới những hồ sơ
   * IP bị xóa lẻ TRƯỚC đó vì lý do riêng ("gõ nhầm địa chỉ") — bật lại dải mà làm sống lại
   * luôn mấy dòng đã xóa nhầm là trả về một cuốn sổ khác với cuốn lúc tắt.
   *
   * Vẫn ghi lịch sử cho từng hồ sơ (AD-13): "IP này từng của máy nào" phải đọc liền mạch, và
   * một khoảng lặng không giải thích giữa lúc tắt và lúc bật là chỗ người đọc sẽ mất niềm tin.
   */
  async restore(actor: string, id: string): Promise<void> {
    const row = await this.requireAny(id);
    if (row.voidedAt === null) {
      throw new ConflictException({
        code: 'SUBNET_NOT_VOIDED',
        message: 'Dải này đang dùng, không có gì để bật lại.',
      });
    }
    const stamp = row.voidedAt;

    await this.db.transaction(async (tx) => {
      const now = new Date();
      const children = await tx
        .select({ id: ipAddressTable.id, status: ipAddressTable.status })
        .from(ipAddressTable)
        .where(and(eq(ipAddressTable.subnetId, id), eq(ipAddressTable.voidedAt, stamp)));
      if (children.length > 0) {
        await tx
          .update(ipAddressTable)
          .set({ voidedAt: null, voidedBy: null, voidReason: null, updatedAt: now })
          .where(and(eq(ipAddressTable.subnetId, id), eq(ipAddressTable.voidedAt, stamp)));
        await tx.insert(ipHistoryTable).values(
          children.map((child) => ({
            ipAddressId: child.id,
            action: 'ip.restored',
            actor,
            fromStatus: child.status,
            toStatus: child.status,
            changes: { reason: 'bật lại theo dải' },
          })),
        );
      }
      await tx
        .update(subnetTable)
        .set({ voidedAt: null, voidedBy: null, voidReason: null, updatedAt: now })
        .where(eq(subnetTable.id, id));
      await this.audit.appendWithin(tx, {
        actor,
        action: 'subnet.restored',
        objectType: 'subnet',
        objectId: id,
        detail: { cidr: row.cidr, addressesRestored: children.length },
      });
    });
  }

  /**
   * Dải + trạng thái ẩn của nó, KỂ CẢ dải đã vô hiệu hóa.
   *
   * Tách khỏi `cidrOf` một cách cố ý. `cidrOf` là đường GHI (tạo/sửa hồ sơ IP) và phải tiếp
   * tục từ chối dải đã tắt — thêm IP mới vào một dải đã cất đi là tạo dữ liệu không màn nào
   * chịu trách nhiệm. Còn đây là đường ĐỌC: bảng IP của một dải đã tắt vẫn phải xem được.
   */
  async frameOf(id: string): Promise<{ cidr: string; voidedAt: Date | null }> {
    const row = await this.requireAny(id);
    return { cidr: row.cidr, voidedAt: row.voidedAt };
  }

  /**
   * XÓA CỨNG một dải — chỉ khi nó CHƯA TỪNG được dùng.
   *
   * Quyết định 2026-08-27: khai nhầm một dải rồi phải sống chung với nó mãi là phiền vô lý.
   * Dải chưa có hồ sơ IP nào thì nó chưa mang thông tin gì cả — xóa hẳn, cần thì khai lại.
   *
   * Nhưng "chưa từng dùng" tính theo TỔNG số hàng `ip_address`, kể cả hàng đã thu hồi hoặc đã
   * ẩn: những hàng đó đang giữ câu trả lời "IP này từng của máy nào" mà AC 5.2 bắt giữ vĩnh
   * viễn, và `ip_history` còn trỏ vào chúng. Dải đã từng dùng thì đi đường `voidSubnet` —
   * bản ghi ở lại, tra cứu được, còn vết ai ẩn và vì sao.
   */
  async remove(actor: string, id: string): Promise<void> {
    // `requireAny`, không phải `requireAlive`: từ 28/08/2026 thứ tự người dùng đi là
    // vô hiệu hóa TRƯỚC rồi mới xóa. Chặn dải đã tắt ở đây thì đúng cái đường đi vừa dựng lại
    // kết thúc bằng 404 ở bước cuối.
    const row = await this.requireAny(id);
    const [existing] = await this.db
      .select({ all: count() })
      .from(ipAddressTable)
      .where(eq(ipAddressTable.subnetId, id));
    const addresses = Number(existing?.all ?? 0);
    if (addresses > 0) {
      throw new ConflictException({
        code: 'SUBNET_HAS_ADDRESSES',
        message:
          `Dải này đã có ${addresses} hồ sơ IP nên không xóa hẳn được — xóa là mất luôn lịch sử ` +
          '"IP nào từng của máy nào". Dùng Vô hiệu hóa để cất dải đi mà vẫn tra cứu được.',
        addresses,
      });
    }

    await this.db.transaction(async (tx) => {
      /*
       * Ghi audit TRƯỚC khi xóa, trong cùng transaction.
       *
       * Sau khi xóa thì hàng không còn để mà đọc — mà dòng audit lại là thứ DUY NHẤT còn lại
       * kể chuyện "dải 172.16.15.0/24 từng tồn tại và ai đã xóa nó". Chép cả cidr + tên vào
       * `detail` vì `objectId` sau đây trỏ tới một hàng không còn nữa.
       */
      await this.audit.appendWithin(tx, {
        actor,
        action: 'subnet.deleted',
        objectType: 'subnet',
        objectId: id,
        detail: { cidr: row.cidr, name: row.name, vlan: row.vlan, gateway: row.gateway },
      });
      await tx.delete(subnetTable).where(eq(subnetTable.id, id));
    });
  }

  /** Dải chuẩn hóa của một subnet — `IpAddressService` cần để kiểm IP nằm trong dải. */
  async cidrOf(id: string): Promise<string> {
    return (await this.requireAlive(id)).cidr;
  }

  private requireName(value: string): string {
    const name = value.trim();
    if (!name) {
      throw new BadRequestException({
        code: 'FIELD_REQUIRED',
        message: 'Đặt tên cho dải (vd "LAN Văn phòng tầng 2").',
      });
    }
    return name;
  }

  private requireCidr(value: string): string {
    const parsed = normalizeSubnet(value);
    if (parsed.ok) return parsed.cidr;
    throw new BadRequestException({
      code: 'SUBNET_INVALID',
      message: CIDR_MESSAGE[parsed.reason] ?? 'Dải không hợp lệ. Ví dụ đúng: 172.16.10.0/24.',
    });
  }

  /**
   * Gateway phải nằm TRONG chính dải của nó — kiểm ở đây để báo một câu tiếng Việt, và CHECK
   * ở tầng DB (`subnet_gateway_within_check`, 0035) là hàng rào cuối cho mọi đường vào khác.
   *
   * Ô để trống là một ý định rõ ràng ("dải này không có gateway", vd dải point-to-point), nên
   * chuỗi rỗng → `null` chứ không phải lỗi.
   */
  private requireGateway(value: string | null | undefined, cidr: string): string | null {
    const text = (value ?? '').trim();
    if (!text) return null;
    if (!isHostInSubnet(text, cidr)) {
      throw new BadRequestException({
        code: 'GATEWAY_OUT_OF_SUBNET',
        message: `Gateway ${text} không nằm trong dải ${cidr}. Gateway phải là một địa chỉ của chính dải đó.`,
      });
    }
    return text;
  }

  private async requireSite(siteId: string | null | undefined): Promise<void> {
    if (!siteId) return;
    const lists = await this.catalog.lists();
    if (!lists.sites.some((site) => site.id === siteId)) {
      throw new BadRequestException({
        code: 'SITE_NOT_FOUND',
        message: 'Site không tồn tại hoặc đã ngừng dùng.',
      });
    }
  }

  private async siteCodes(): Promise<Map<string, string>> {
    const lists = await this.catalog.lists();
    return new Map(lists.sites.map((site) => [site.id, site.code]));
  }

  /** Tra một dải KỂ CẢ đã vô hiệu hóa — dùng cho đường đọc, bật lại, và xóa hẳn. */
  private async requireAny(id: string): Promise<typeof subnetTable.$inferSelect> {
    const rows = await this.db.select().from(subnetTable).where(eq(subnetTable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'SUBNET_NOT_FOUND',
        message: 'Không tìm thấy dải này.',
      });
    }
    return rows[0];
  }

  private async requireAlive(id: string): Promise<typeof subnetTable.$inferSelect> {
    const rows = await this.db
      .select()
      .from(subnetTable)
      .where(and(eq(subnetTable.id, id), isNull(subnetTable.voidedAt)));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'SUBNET_NOT_FOUND',
        message: 'Không tìm thấy dải này (có thể đã ẩn).',
      });
    }
    return rows[0];
  }

  private toRecord(
    row: typeof subnetTable.$inferSelect,
    sites: Map<string, string>,
  ): SubnetRecord {
    return {
      id: row.id,
      name: row.name,
      cidr: row.cidr,
      siteId: row.siteId,
      siteCode: row.siteId ? (sites.get(row.siteId) ?? null) : null,
      vlan: row.vlan,
      gateway: row.gateway,
      description: row.description,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      voidedAt: row.voidedAt,
      voidedBy: row.voidedBy,
      voidReason: row.voidReason,
    };
  }

  private translate(error: unknown, cidr: string): unknown {
    return conflictOnUnique(error, {
      code: 'SUBNET_TAKEN',
      message: `Dải ${cidr} đã được khai rồi.`,
    });
  }
}

const CIDR_MESSAGE: Record<string, string> = {
  missing_prefix: 'Thiếu độ dài dải. Viết dạng 172.16.10.0/24.',
  bad_prefix: 'Độ dài dải phải từ /24 đến /32. Ví dụ: 172.16.10.0/24.',
  too_wide:
    'Dải rộng nhất được khai là /24 (254 máy). Mạng lớn hơn thì chia thành nhiều dải /24 — ' +
    'ví dụ 172.16.10.0/24 và 172.16.11.0/24.',
  not_ipv4: 'Chỉ nhận địa chỉ IPv4. Ví dụ đúng: 172.16.10.0/24.',
  leading_zero: 'Không viết số 0 đứng đầu (172.16.010.5 dễ bị hiểu nhầm). Viết 172.16.10.5.',
  octet_range: 'Mỗi nhóm số phải từ 0 đến 255.',
};

/**
 * FR-020 đếm theo địa chỉ đang CHIẾM chỗ, không phải theo số hàng có trong bảng.
 *
 * IP đã thu hồi vẫn còn hàng (lịch sử giữ vĩnh viễn — AC 5.2) nhưng đã trả chỗ về pool. Đếm
 * cả nó thì mức sử dụng chỉ có tăng, không bao giờ giảm, và sau một năm màn hình báo dải đầy
 * trong khi thực tế còn quá nửa.
 */
function occupying() {
  return inArray(ipAddressTable.status, OCCUPYING_STATUSES);
}
