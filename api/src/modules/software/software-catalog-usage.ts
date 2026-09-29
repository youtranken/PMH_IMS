import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CatalogUsageRegistry, countByRef } from '../../common/catalog-usage.registry';
import { DRIZZLE_DB, type Database } from '../../database/database.module';
import { ispLineTable, softwareTable } from './software.schema';

/**
 * Góp số "đang dùng ở N phần mềm / đường truyền" cho màn Danh mục — `software` đếm bảng của
 * chính nó (AD-3), `catalog` chỉ đọc sổ.
 */
@Injectable()
export class SoftwareCatalogUsage implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly registry: CatalogUsageRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      entity: 'vendor',
      kind: 'software',
      countFor: (refs) => countByRef(this.db, softwareTable, softwareTable.vendorId, refs),
    });
    this.registry.register({
      entity: 'site',
      kind: 'isp_line',
      countFor: (refs) => countByRef(this.db, ispLineTable, ispLineTable.siteId, refs),
    });
    this.registry.register({
      entity: 'isp_provider',
      kind: 'isp_line',
      countFor: (refs) => countByRef(this.db, ispLineTable, ispLineTable.providerId, refs),
    });
  }
}
