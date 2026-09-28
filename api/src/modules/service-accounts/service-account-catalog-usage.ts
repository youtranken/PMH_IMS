import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CatalogUsageRegistry, countByName } from '../../common/catalog-usage.registry';
import { DRIZZLE_DB, type Database } from '../../database/database.module';
import { serviceAccountTable } from './service-account.schema';

/**
 * Góp số "đang dùng ở N tài khoản dịch vụ" cho bộ phận ở màn Danh mục. Bộ phận lưu bằng CHỮ
 * trong cột `department`, nên đếm theo tên chứ không theo id.
 */
@Injectable()
export class ServiceAccountCatalogUsage implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly registry: CatalogUsageRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      entity: 'department',
      kind: 'service_account',
      countFor: (refs) =>
        countByName(this.db, serviceAccountTable, serviceAccountTable.department, refs),
    });
  }
}
