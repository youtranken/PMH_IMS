import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import {
  AuditObjectLabelRegistry,
  type AuditObjectLabel,
  type AuditObjectLabeler,
} from '../../common/audit-object-labels.registry';
import { UI_PATHS } from '../../common/ui-paths';
import { ipAddressTable, subnetTable } from './ipam.schema';

/**
 * `ipam` gọi tên `subnet` ("tên (cidr)") và `ip_address` (địa chỉ) trên màn Nhật ký. Hồ sơ IP
 * không có trang riêng — link về dải chứa nó.
 */
@Injectable()
export class IpamAuditLabeler implements AuditObjectLabeler, OnModuleInit {
  readonly objectTypes = ['subnet', 'ip_address'] as const;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly registry: AuditObjectLabelRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelsFor(type: string, ids: string[]): Promise<Map<string, AuditObjectLabel>> {
    if (type === 'ip_address') {
      const rows = await this.db
        .select({ id: ipAddressTable.id, address: ipAddressTable.address, subnetId: ipAddressTable.subnetId })
        .from(ipAddressTable)
        .where(inArray(ipAddressTable.id, ids));
      return new Map(
        rows.map((r) => [
          r.id,
          { label: String(r.address).replace(/\/32$/, ''), path: UI_PATHS.subnet(r.subnetId) },
        ]),
      );
    }
    const rows = await this.db
      .select({ id: subnetTable.id, name: subnetTable.name, cidr: subnetTable.cidr })
      .from(subnetTable)
      .where(inArray(subnetTable.id, ids));
    return new Map(
      rows.map((r) => [r.id, { label: `${r.name} (${String(r.cidr)})`, path: UI_PATHS.subnet(r.id) }]),
    );
  }
}
