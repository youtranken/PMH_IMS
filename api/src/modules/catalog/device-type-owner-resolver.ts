import { Injectable, OnModuleInit } from '@nestjs/common';
import type { OwnerResolver } from '../../common/owner-exists.registry';
import { OwnerExistsRegistry } from '../../common/owner-exists.registry';
import { CatalogService } from './catalog.service';

/**
 * `catalog` làm chủ loại chủ thể `device_type` (ảnh riêng của loại, PW-A18): tệp chỉ treo được vào
 * một loại thiết bị có thật (`common/owner-exists.registry.ts`, không ai vouch thì từ chối).
 */
@Injectable()
export class DeviceTypeOwnerResolver implements OwnerResolver, OnModuleInit {
  readonly ownerTypes = ['device_type'] as const;

  constructor(
    private readonly registry: OwnerExistsRegistry,
    private readonly catalog: CatalogService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelFor(_ownerType: string, ownerId: string): Promise<string | null> {
    const type = await this.catalog.deviceTypeById(ownerId);
    return type ? type.name : null;
  }
}
