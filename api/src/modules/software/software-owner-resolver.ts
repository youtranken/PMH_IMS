import { Injectable, OnModuleInit } from '@nestjs/common';
import type { OwnerResolver } from '../../common/owner-exists.registry';
import { OwnerExistsRegistry } from '../../common/owner-exists.registry';
import { IspLineService } from './isp-line.service';
import { SoftwareService } from './software.service';

/** `software` làm chủ hai loại: hồ sơ phần mềm và hợp đồng đường truyền. */
@Injectable()
export class SoftwareOwnerResolver implements OwnerResolver, OnModuleInit {
  readonly ownerTypes = ['software', 'isp'] as const;

  constructor(
    private readonly registry: OwnerExistsRegistry,
    private readonly software: SoftwareService,
    private readonly isp: IspLineService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelFor(ownerType: string, ownerId: string): Promise<string | null> {
    if (ownerType === 'isp') {
      const line = await this.isp.findOne(ownerId).catch(() => null);
      return line ? `${line.code} — ${line.provider}` : null;
    }
    const row = await this.software.findOne(ownerId).catch(() => null);
    return row ? `${row.code} — ${row.name}` : null;
  }

  async noteOf(ownerType: string, ownerId: string): Promise<string | null> {
    return ownerType === 'isp' ? this.isp.noteOf(ownerId) : this.software.noteOf(ownerId);
  }
}
