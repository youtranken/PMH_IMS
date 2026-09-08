import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DevicesModule } from '../devices/devices.module';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { IpAddressService } from './ip-address.service';
import { IpDevicePanel } from './ip-device-panel';
import { IpDeviceRetirement } from './ip-device-retirement';
import { IpamOwnerResolver } from './ipam-owner-resolver';
import { NatDevicePanel } from './nat-device-panel';
import { NatRuleService } from './nat-rule.service';
import { IpamApiService } from './ipam.api';
import { IpamController } from './ipam.controller';
import { SubnetService } from './subnet.service';

/** Quản lý IP & NAT (Epic 5) — chủ sở hữu bảng `subnet`, `ip_address`, `ip_history` (AD-3). */
@Module({
  imports: [AuditModule, CatalogModule, DevicesModule],
  controllers: [IpamController],
  providers: [
    SubnetService,
    IpAddressService,
    NatRuleService,
    IpamApiService,
    IpDevicePanel,
    IpDeviceRetirement,
    IpamOwnerResolver,
    NatDevicePanel,
    ExcelExportService,
  ],
  exports: [IpamApiService],
})
export class IpamModule {}
