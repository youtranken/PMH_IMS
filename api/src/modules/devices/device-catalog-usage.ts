import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  CatalogUsageRegistry,
  countByName,
  countByRef,
} from '../../common/catalog-usage.registry';
import { DRIZZLE_DB, type Database } from '../../database/database.module';
import { deviceTable } from './devices.schema';

/**
 * Góp số "đang dùng ở N thiết bị" cho màn Danh mục. `devices` đếm bảng của chính nó (AD-3);
 * `catalog` không import được `devices` vì chiều ngược lại đã có.
 *
 * Đếm CẢ thiết bị đã thanh lý: khóa ngoại vẫn chặn xóa mục đó, và con số phải khớp với việc
 * nút Xóa có làm được hay không.
 */
@Injectable()
export class DeviceCatalogUsage implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly registry: CatalogUsageRegistry,
  ) {}

  onModuleInit(): void {
    const byRef = (entity: string, column: PgColumn) =>
      this.registry.register({
        entity,
        kind: 'device',
        countFor: (refs) => countByRef(this.db, deviceTable, column, refs),
      });
    byRef('site', deviceTable.siteId);
    byRef('cabinet', deviceTable.cabinetId);
    byRef('device_type', deviceTable.deviceTypeId);
    byRef('vendor', deviceTable.vendorId);
    this.registry.register({
      entity: 'department',
      kind: 'device',
      countFor: (refs) => countByName(this.db, deviceTable, deviceTable.department, refs),
    });
  }
}
