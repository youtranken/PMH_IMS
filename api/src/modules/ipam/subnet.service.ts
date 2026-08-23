import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { pgErrorCode, PG_UNIQUE_VIOLATION } from '../../common/sql';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CatalogApiService } from '../catalog/catalog.api';
import { normalizeSubnet, subnetUsage, type SubnetUsage } from './ip-rules';
import { OCCUPYING_STATUSES } from './ip-lifecycle';
import { ipAddressTable, subnetTable } from './ipam.schema';

export interface SubnetRecord {
  id: string;
  name: string;
  cidr: string;
  siteId: string | null;
  siteCode: string | null;
  description: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubnetWithUsage extends SubnetRecord, SubnetUsage {}

export interface SubnetInput {
  name: string;
  cidr: string;
  siteId?: string | null;
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

  /** Danh sách kèm mức sử dụng (FR-020) — màn subnet cần cả hai, đừng bắt UI gọi hai lần. */
  async list(): Promise<SubnetWithUsage[]> {
    const rows = await this.db
      .select()
      .from(subnetTable)
      .where(isNull(subnetTable.voidedAt))
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

    const sites = await this.siteCodes();
    return rows.map((row) => ({
      ...this.toRecord(row, sites),
      ...subnetUsage(row.cidr, usedBySubnet.get(row.id) ?? 0),
    }));
  }

  async findOne(id: string): Promise<SubnetWithUsage> {
    const row = await this.requireAlive(id);
    const [used] = await this.db
      .select({ used: count() })
      .from(ipAddressTable)
      .where(
        and(eq(ipAddressTable.subnetId, id), isNull(ipAddressTable.voidedAt), occupying()),
      );
    const sites = await this.siteCodes();
    return {
      ...this.toRecord(row, sites),
      ...subnetUsage(row.cidr, Number(used?.used ?? 0)),
    };
  }

  async create(actor: string, input: SubnetInput): Promise<SubnetRecord> {
    const cidr = this.requireCidr(input.cidr);
    await this.requireSite(input.siteId);
    const name = this.requireName(input.name);

    try {
      return await this.db.transaction(async (tx) => {
        const rows = await tx
          .insert(subnetTable)
          .values({
            name,
            cidr,
            siteId: input.siteId || null,
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
      cidr?: string;
    } = {};
    if (input.name !== undefined) values.name = this.requireName(input.name);
    if (input.description !== undefined) {
      values.description = input.description?.trim() || null;
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
     */
    if (input.cidr !== undefined) {
      const cidr = this.requireCidr(input.cidr);
      if (cidr !== before.cidr) {
        const [existing] = await this.db
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
        values.cidr = cidr;
      }
    }

    try {
      return await this.db.transaction(async (tx) => {
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
    const [existing] = await this.db
      .select({ used: count() })
      .from(ipAddressTable)
      .where(and(eq(ipAddressTable.subnetId, id), isNull(ipAddressTable.voidedAt)));
    if (Number(existing?.used ?? 0) > 0) {
      throw new ConflictException({
        code: 'SUBNET_HAS_ADDRESSES',
        message: 'Dải này còn hồ sơ IP. Ẩn hết IP trong dải trước đã.',
      });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(subnetTable)
        .set({ voidedAt: new Date(), voidedBy: actor, voidReason: text })
        .where(eq(subnetTable.id, id));
      await this.audit.appendWithin(tx, {
        actor,
        action: 'subnet.voided',
        objectType: 'subnet',
        objectId: id,
        detail: { reason: text },
      });
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
      description: row.description,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private translate(error: unknown, cidr: string): unknown {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      return new ConflictException({
        code: 'SUBNET_TAKEN',
        message: `Dải ${cidr} đã được khai rồi.`,
      });
    }
    return error;
  }
}

const CIDR_MESSAGE: Record<string, string> = {
  missing_prefix: 'Thiếu độ dài dải. Viết dạng 172.16.10.0/24.',
  bad_prefix: 'Độ dài dải phải từ /8 đến /32. Ví dụ: 172.16.10.0/24.',
  too_wide: 'Dải rộng quá mức hợp lý (rộng hơn /8) — có phải gõ nhầm /24 thành /8 không?',
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
