import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DevicesModule } from '../devices/devices.module';
import { UsersModule } from '../users/users.module';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { IpAddressService } from './ip-address.service';
import { IpDevicePanel } from './ip-device-panel';
import { IpDeviceRetirement } from './ip-device-retirement';
import { IpDeviceSearch } from './ip-device-search';
import { IpDeviceTimeline } from './ip-device-timeline';
import { IpamOwnerResolver } from './ipam-owner-resolver';
import { IpamAuditLabeler } from './ipam-audit-labeler';
import { NatDevicePanel, NatTargetDevicePanel } from './nat-device-panel';
import { NatRuleService } from './nat-rule.service';
import { IpamApiService } from './ipam.api';
import { IpamController } from './ipam.controller';
import { SubnetService } from './subnet.service';
import { IpamCatalogUsage } from './ipam-catalog-usage';

/** Quản lý IP & NAT — chủ sở hữu bảng `subnet`, `ip_address`, `ip_history` (AD-3). */
@Module({
  imports: [AuditModule, CatalogModule, DevicesModule, UsersModule],
  controllers: [IpamController],
  providers: [
    SubnetService,
    IpAddressService,
    NatRuleService,
    IpamApiService,
    IpDevicePanel,
    IpDeviceRetirement,
    IpDeviceSearch,
    IpDeviceTimeline,
    IpamOwnerResolver,
    IpamAuditLabeler,
    NatDevicePanel,
    NatTargetDevicePanel,
    IpamCatalogUsage,
    ExcelExportService,
  ],
  exports: [IpamApiService],
})
export class IpamModule {}
