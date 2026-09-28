import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  DeviceSearchRegistry,
  type DeviceSearchContributor,
} from '../../common/device-search.registry';
import { IpamApiService } from './ipam.api';

/**
 * Cho ô tìm thiết bị tra được theo IP. `ipam` tự cắm vào sổ vì `devices` không được biết
 * `ipam` tồn tại — xem `common/device-search.registry.ts`.
 */
@Injectable()
export class IpDeviceSearch implements DeviceSearchContributor, OnModuleInit {
  readonly name = 'ipam';

  constructor(
    private readonly registry: DeviceSearchRegistry,
    private readonly ipam: IpamApiService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  deviceIdsMatching(term: string): Promise<string[]> {
    return this.ipam.deviceIdsByAddress(term);
  }
}
