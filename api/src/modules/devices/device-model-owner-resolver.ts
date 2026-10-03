import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { OwnerResolver } from '../../common/owner-exists.registry';
import { OwnerExistsRegistry } from '../../common/owner-exists.registry';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { CatalogApiService } from '../catalog/catalog.api';
import { deviceModelTable } from './devices.schema';

/**
 * `devices` làm chủ loại chủ thể `device_model` (ảnh thật theo model — Q-23): tệp chỉ treo được
 * vào một hàng `device_model` có thật (`common/owner-exists.registry.ts`, từ chối khi không ai vouch).
 */
@Injectable()
export class DeviceModelOwnerResolver implements OwnerResolver, OnModuleInit {
  readonly ownerTypes = ['device_model'] as const;

  constructor(
    private readonly registry: OwnerExistsRegistry,
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly catalog: CatalogApiService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelFor(_ownerType: string, ownerId: string): Promise<string | null> {
    const [row] = await this.db.select().from(deviceModelTable).where(eq(deviceModelTable.id, ownerId));
    if (!row) return null;
    const type = (await this.catalog.lists({ includeInactive: true })).deviceTypes.find((t) => t.id === row.deviceTypeId);
    return `${type?.name ?? '?'} · ${row.model}`;
  }
}
