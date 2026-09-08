import { Injectable, OnModuleInit } from '@nestjs/common';
import type { OwnerResolver } from '../../common/owner-exists.registry';
import { OwnerExistsRegistry } from '../../common/owner-exists.registry';
import { ServiceAccountService } from './service-account.service';

/** `service-accounts` làm chủ loại chủ thể `service_account`. */
@Injectable()
export class ServiceAccountOwnerResolver implements OwnerResolver, OnModuleInit {
  readonly ownerTypes = ['service_account'] as const;

  constructor(
    private readonly registry: OwnerExistsRegistry,
    private readonly accounts: ServiceAccountService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelFor(_ownerType: string, ownerId: string): Promise<string | null> {
    const row = await this.accounts.findOne(ownerId).catch(() => null);
    return row ? `${row.code} — ${row.name}` : null;
  }
}
