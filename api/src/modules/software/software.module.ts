import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DevicesModule } from '../devices/devices.module';
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
  controllers: [SoftwareController],
  providers: [
    SoftwareService,
    LicenseAssignmentService,
    SoftwareDevicePanel,
    SoftwareApiService,
  ],
  exports: [SoftwareApiService],
})
export class SoftwareModule {}
