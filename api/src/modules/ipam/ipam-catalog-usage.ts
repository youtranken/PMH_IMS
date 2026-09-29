import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CatalogUsageRegistry, countByRef } from '../../common/catalog-usage.registry';
import { DRIZZLE_DB, type Database } from '../../database/database.module';
import { subnetTable } from './ipam.schema';

/** Góp số "đang dùng ở N dải IP" cho site ở màn Danh mục — `ipam` đếm bảng của mình (AD-3). */
@Injectable()
export class IpamCatalogUsage implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly registry: CatalogUsageRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      entity: 'site',
      kind: 'subnet',
      countFor: (refs) => countByRef(this.db, subnetTable, subnetTable.siteId, refs),
    });
  }
}
