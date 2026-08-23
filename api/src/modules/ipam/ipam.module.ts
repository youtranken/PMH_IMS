import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DevicesModule } from '../devices/devices.module';
import { IpAddressService } from './ip-address.service';
import { IpamApiService } from './ipam.api';
import { IpamController } from './ipam.controller';
import { SubnetService } from './subnet.service';

/** Quản lý IP & NAT (Epic 5) — chủ sở hữu bảng `subnet`, `ip_address`, `ip_history` (AD-3). */
@Module({
  imports: [AuditModule, CatalogModule, DevicesModule],
  controllers: [IpamController],
  providers: [SubnetService, IpAddressService, IpamApiService],
  exports: [IpamApiService],
})
export class IpamModule {}
