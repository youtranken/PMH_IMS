import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CatalogApiService } from '../catalog/catalog.api';
import { DevicesApiService } from '../devices/devices.api';
import { SoftwareApiService } from '../software/software.api';
import { UsersApiService } from '../users/users.api';
import {
  ACCESS_TIERS,
  SCOPE_TYPES,
  groupsOfDevice,
  groupsOfSoftware,
  resolveTier,
  type AccessRule,
  type AccessTier,
  type ScopeType,
} from './access-tier';
import { accessListTable } from './vault.schema';
import type { SecretOwnerType } from './vault.service';

export interface AccessRuleRecord extends AccessRule {
  id: string;
  /** Tên đọc được của nhóm ("Site HN", "Switch", "License") — màn ma trận cần, DB không có. */
  scopeLabel: string;
  grantedBy: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccessRuleInput {
  memberEmail: string;
  scopeType: ScopeType;
  scopeRef: string;
  tier: Exclude<AccessTier, 'denied'>;
  note?: string | null;
}

/**
 * Ma trận quyền xem secret (story 6.2, FR-023). Chủ sở hữu bảng `access_list` (AD-3).
 *
 * Cấm là MẶC ĐỊNH, không phải một lời gán: bảng chỉ chứa `whitelist` và `needs_approval`.
 * Muốn cấm thì GỠ dòng đi. Cho phép gán 'denied' sẽ sinh ra câu hỏi "dòng cấm có thắng dòng
 * cho phép không" — và câu trả lời nào cũng làm màn ma trận khó đọc hơn.
 */
@Injectable()
export class AccessListService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly catalog: CatalogApiService,
    private readonly devices: DevicesApiService,
    private readonly software: SoftwareApiService,
    private readonly users: UsersApiService,
  ) {}

  async list(memberEmail?: string): Promise<AccessRuleRecord[]> {
    const rows = await this.db
      .select()
      .from(accessListTable)
      .where(memberEmail ? eq(accessListTable.memberEmail, memberEmail) : undefined)
      .orderBy(asc(accessListTable.memberEmail), asc(accessListTable.scopeType));
    const labels = await this.scopeLabels();
    return rows.map((row) => this.toRecord(row, labels));
  }

  /** Các nhóm có thể gán — màn ma trận đổ vào ô chọn. */
  async scopeOptions(): Promise<{ scopeType: ScopeType; scopeRef: string; label: string }[]> {
    const lists = await this.catalog.lists({ includeInactive: false });
    return [
      ...lists.sites.map((site) => ({
        scopeType: 'device_site' as const,
        scopeRef: site.id,
        label: `Thiết bị tại ${site.code}`,
      })),
      ...lists.deviceTypes.map((type) => ({
        scopeType: 'device_type' as const,
        scopeRef: type.id,
        label: `Thiết bị loại ${type.name}`,
      })),
      ...SOFTWARE_KINDS.map((kind) => ({
        scopeType: 'software_kind' as const,
        scopeRef: kind.key,
        label: `Phần mềm: ${kind.label}`,
      })),
    ];
  }

  async upsert(actor: string, input: AccessRuleInput): Promise<AccessRuleRecord> {
    const email = input.memberEmail.trim().toLowerCase();
    await this.requireMember(email);
    this.requireScope(input.scopeType, input.tier);
    await this.requireScopeRef(input.scopeType, input.scopeRef);

    const record = await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(accessListTable)
        .values({
          memberEmail: email,
          scopeType: input.scopeType,
          scopeRef: input.scopeRef,
          tier: input.tier,
          grantedBy: actor,
          note: input.note?.trim() || null,
        })
        // Gán lại = ĐỔI tầng, không đẻ dòng thứ hai. Hai dòng cùng nhóm thì màn ma trận hiện
        // hai ô cho một ô thật, và người đọc không biết cái nào đang có hiệu lực.
        .onConflictDoUpdate({
          target: [
            accessListTable.memberEmail,
            accessListTable.scopeType,
            accessListTable.scopeRef,
          ],
          set: {
            tier: input.tier,
            grantedBy: actor,
            note: input.note?.trim() || null,
            updatedAt: new Date(),
          },
        })
        .returning();
      await this.audit.appendWithin(tx, {
        actor,
        action: 'vault.access.granted',
        objectType: 'access_list',
        objectId: rows[0].id,
        detail: {
          member: email,
          scopeType: input.scopeType,
          scopeRef: input.scopeRef,
          tier: input.tier,
        },
      });
      return rows[0];
    });
    return this.toRecord(record, await this.scopeLabels());
  }

  /** Gỡ = đưa về CẤM mặc định. Không có "xóa mềm" ở đây: bảng này là cấu hình, không phải sổ. */
  async remove(actor: string, id: string): Promise<void> {
    const rows = await this.db.select().from(accessListTable).where(eq(accessListTable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'ACCESS_RULE_NOT_FOUND',
        message: 'Không tìm thấy lời gán này.',
      });
    }
    const before = rows[0];
    await this.db.transaction(async (tx) => {
      await tx.delete(accessListTable).where(eq(accessListTable.id, id));
      // Vết ai gỡ nằm ở audit — bảng cấu hình không giữ lịch sử, `audit_log` giữ.
      await this.audit.appendWithin(tx, {
        actor,
        action: 'vault.access.revoked',
        objectType: 'access_list',
        objectId: id,
        detail: {
          member: before.memberEmail,
          scopeType: before.scopeType,
          scopeRef: before.scopeRef,
          tier: before.tier,
        },
      });
    });
  }

  /**
   * Tầng quyền của một người trên một CHỦ THỂ cụ thể (thiết bị hoặc hồ sơ phần mềm).
   *
   * Đây là hàm mà cả story 6.3 xoay quanh. Nó tra chủ thể qua public api của module chủ
   * (`devices.api`, `software.api`) chứ KHÔNG join bảng của họ — `vault` không được biết bảng
   * `device` trông thế nào (AD-2/AD-3).
   */
  async tierFor(
    memberEmail: string,
    ownerType: SecretOwnerType,
    ownerId: string,
  ): Promise<AccessTier> {
    const groups =
      ownerType === 'device'
        ? groupsOfDevice(await this.deviceGroupKeys(ownerId))
        : groupsOfSoftware(await this.softwareGroupKeys(ownerId));
    if (groups.length === 0) return 'denied';

    const rules = await this.list(memberEmail.toLowerCase());
    return resolveTier(rules, memberEmail, groups);
  }

  private async deviceGroupKeys(
    id: string,
  ): Promise<{ siteId: string | null; deviceTypeId: string | null }> {
    const device = await this.devices.getById(id).catch(() => null);
    // Thiết bị không tồn tại → không nhóm nào → CẤM. Không ném: nơi gọi đang hỏi "được không",
    // và câu trả lời đúng cho một id ma là "không", chứ không phải một lỗi 500.
    if (!device) return { siteId: null, deviceTypeId: null };
    return { siteId: device.siteId, deviceTypeId: device.deviceTypeId };
  }

  private async softwareGroupKeys(id: string): Promise<{ kind: string }> {
    const item = await this.software.getById(id).catch(() => null);
    return { kind: item?.kind ?? '' };
  }

  private async requireMember(email: string): Promise<void> {
    const known = await this.users.recipientsByRole(['sa', 'admin', 'member']);
    if (!known.some((user) => user.email.toLowerCase() === email)) {
      throw new BadRequestException({
        code: 'MEMBER_NOT_FOUND',
        message: 'Không có tài khoản nào với email này.',
      });
    }
  }

  private requireScope(scopeType: ScopeType, tier: AccessTier): void {
    if (!SCOPE_TYPES.includes(scopeType)) {
      throw new BadRequestException({
        code: 'SCOPE_INVALID',
        message: 'Nhóm đối tượng không hợp lệ.',
      });
    }
    if (!ACCESS_TIERS.includes(tier) || tier === 'denied') {
      throw new BadRequestException({
        code: 'TIER_INVALID',
        message: 'Tầng phải là "Xem thẳng" hoặc "Cần duyệt". Muốn cấm thì gỡ lời gán đi.',
      });
    }
  }

  /**
   * Nhóm phải TỒN TẠI.
   *
   * Không kiểm thì một site đã xóa (hoặc một id gõ nhầm) vẫn nằm trong ma trận, hiện ra dưới
   * dạng một dòng không ai đọc được — và cái dòng đó không bao giờ khớp với thiết bị nào, nên
   * người gán tưởng đã cho quyền mà thực tế thì không.
   */
  private async requireScopeRef(scopeType: ScopeType, scopeRef: string): Promise<void> {
    const options = await this.scopeOptions();
    if (!options.some((o) => o.scopeType === scopeType && o.scopeRef === scopeRef)) {
      throw new BadRequestException({
        code: 'SCOPE_REF_NOT_FOUND',
        message: 'Nhóm đối tượng này không tồn tại (site/loại đã xóa hoặc ngừng dùng?).',
      });
    }
  }

  private async scopeLabels(): Promise<Map<string, string>> {
    const options = await this.scopeOptions();
    return new Map(options.map((o) => [`${o.scopeType}:${o.scopeRef}`, o.label]));
  }

  private toRecord(
    row: typeof accessListTable.$inferSelect,
    labels: Map<string, string>,
  ): AccessRuleRecord {
    const key = `${row.scopeType}:${row.scopeRef}`;
    return {
      id: row.id,
      memberEmail: row.memberEmail,
      scopeType: row.scopeType as ScopeType,
      scopeRef: row.scopeRef,
      tier: row.tier as AccessTier,
      // Nhóm đã biến mất (site bị xóa sau khi gán) hiện rõ là "đã xóa", không hiện ô trống —
      // ô trống làm người đọc tưởng màn hình hỏng thay vì hiểu là dữ liệu cần dọn.
      scopeLabel: labels.get(key) ?? `${row.scopeType} (đã xóa)`,
      grantedBy: row.grantedBy,
      note: row.note,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/** Khớp `SOFTWARE_KINDS` của module software — nhãn để người gán đọc, không phải khóa mới. */
const SOFTWARE_KINDS = [
  { key: 'license', label: 'License' },
  { key: 'ssl', label: 'Chứng chỉ SSL' },
  { key: 'domain', label: 'Tên miền' },
  { key: 'maintenance', label: 'Hợp đồng bảo trì' },
  { key: 'other', label: 'Khác' },
];
