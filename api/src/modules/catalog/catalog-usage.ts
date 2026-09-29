import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CatalogUsageRegistry, countByRef } from '../../common/catalog-usage.registry';
import { DRIZZLE_DB, type Database } from '../../database/database.module';
import { cabinetTable } from './catalog.schema';

/** Tủ mạng trỏ tới site nằm ngay trong danh mục — `catalog` tự góp phần của mình vào sổ. */
@Injectable()
export class CatalogOwnUsage implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly registry: CatalogUsageRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      entity: 'site',
      kind: 'cabinet',
      countFor: (refs) => countByRef(this.db, cabinetTable, cabinetTable.siteId, refs),
    });
  }
}
