import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import {
  AuditObjectLabelRegistry,
  type AuditObjectLabel,
  type AuditObjectLabeler,
} from '../../common/audit-object-labels.registry';
import { VAULT_TAB_PATH } from './break-glass.service';
import { VaultOwnersService } from './vault-owners.service';
import { secretTable } from './vault.schema';
import type { SecretOwnerType } from './vault.service';

/**
 * `vault` gọi tên đối tượng `secret` trên màn Nhật ký: "tên secret · mã chủ thể", link tới tab
 * Két của chủ thể. "Xem két CỦA MÁY NÀO" là câu người rà nhật ký hỏi đầu tiên.
 *
 * CHỈ nhãn (`label`), không bao giờ giá trị — bảng này có cả bản mã, và nhật ký là màn đọc của
 * Quản trị, không phải cửa mở két (AD-4).
 */
@Injectable()
export class SecretAuditLabeler implements AuditObjectLabeler, OnModuleInit {
  readonly objectTypes = ['secret'] as const;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly registry: AuditObjectLabelRegistry,
    private readonly owners: VaultOwnersService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelsFor(_type: string, ids: string[]): Promise<Map<string, AuditObjectLabel>> {
    const rows = await this.db
      .select({
        id: secretTable.id,
        label: secretTable.label,
        ownerType: secretTable.ownerType,
        ownerId: secretTable.ownerId,
      })
      .from(secretTable)
      .where(inArray(secretTable.id, ids));

    // Nhiều secret chung một chủ thể — hỏi tên chủ thể một lần mỗi chủ.
    const ownerCodes = new Map<string, string | null>();
    const out = new Map<string, AuditObjectLabel>();
    for (const row of rows) {
      const type = row.ownerType as SecretOwnerType;
      const key = `${type}:${row.ownerId}`;
      if (!ownerCodes.has(key)) {
        const owner = await this.owners.describe(type, row.ownerId).catch(() => null);
        ownerCodes.set(key, owner && !owner.orphan ? owner.code : null);
      }
      const code = ownerCodes.get(key);
      const pathOf = VAULT_TAB_PATH[type];
      out.set(row.id, {
        label: code ? `${row.label} · ${code}` : row.label,
        path: pathOf ? pathOf(row.ownerId) : null,
      });
    }
    return out;
  }
}
