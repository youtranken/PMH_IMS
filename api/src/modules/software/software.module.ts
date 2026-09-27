import { Module } from '@nestjs/common';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { AuditModule } from '../audit/audit.module';
import { ExpiryModule } from '../expiry/expiry.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DevicesModule } from '../devices/devices.module';
import { IspDevicePanel } from './isp-device-panel';
import { SoftwareExpiryRegistrar } from './software-expiry-sources';
import { LicenseDeviceRetirement } from './license-device-retirement';
import { IspDeviceRetirement } from './isp-device-retirement';
import { SoftwareOwnerResolver } from './software-owner-resolver';
import { IspLineController } from './isp-line.controller';
import { IspLineService } from './isp-line.service';
import { LicenseAssignmentService } from './license-assignment.service';
import { SoftwareDevicePanel } from './software-device-panel';
import { SoftwareApiService } from './software.api';
import { SoftwareController } from './software.controller';
import { SoftwareService } from './software.service';
import { SoftwareStatusSweep } from './software-status-sweep';

/**
 * Chủ sở hữu `software` + `software_history` (AD-3).
 * Ra ngoài chỉ xuất `SoftwareApiService` (AD-2).
 */
@Module({
  imports: [AuditModule, CatalogModule, DevicesModule, ExpiryModule],
  controllers: [SoftwareController, IspLineController],
  providers: [
    ExcelExportService,
    SoftwareService,
    LicenseAssignmentService,
    IspLineService,
    IspDevicePanel,
    SoftwareExpiryRegistrar,
    LicenseDeviceRetirement,
    IspDeviceRetirement,
    SoftwareOwnerResolver,
    SoftwareDevicePanel,
    SoftwareApiService,
    SoftwareStatusSweep,
  ],
  exports: [SoftwareApiService],
})
export class SoftwareModule {}
