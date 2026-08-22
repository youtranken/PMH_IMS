import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DevicesModule } from '../devices/devices.module';
import { IspDevicePanel } from './isp-device-panel';
import { IspLineController } from './isp-line.controller';
import { IspLineService } from './isp-line.service';
import { LicenseAssignmentService } from './license-assignment.service';
import { SoftwareDevicePanel } from './software-device-panel';
import { SoftwareApiService } from './software.api';
import { SoftwareController } from './software.controller';
import { SoftwareService } from './software.service';

/**
 * Chủ sở hữu `software` + `software_history` (AD-3).
 * Ra ngoài chỉ xuất `SoftwareApiService` (AD-2).
 */
@Module({
  imports: [AuditModule, CatalogModule, DevicesModule],
  controllers: [SoftwareController, IspLineController],
  providers: [
    SoftwareService,
    LicenseAssignmentService,
    IspLineService,
    IspDevicePanel,
    SoftwareDevicePanel,
    SoftwareApiService,
  ],
  exports: [SoftwareApiService],
})
export class SoftwareModule {}
