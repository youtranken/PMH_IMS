import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { ExcelImportService } from '../../common/excel/excel-import.service';
import { DeviceImportService } from './device-import.service';
import { DevicePanelsService } from './device-panels.service';
import { DevicePortsService } from './device-ports.service';
import { DevicesApiService } from './devices.api';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

/**
 * Chủ sở hữu `device` + `device_history` (AD-3).
 * Ra ngoài chỉ xuất `DevicesApiService` (AD-2) — ipam/vault/software ở epic sau dùng cái đó.
 */
@Module({
  imports: [AuditModule, CatalogModule],
  controllers: [DevicesController],
  providers: [
    DevicesService,
    DevicePortsService,
    DevicePanelsService,
    DeviceImportService,
    DevicesApiService,
    ExcelExportService,
    ExcelImportService,
  ],
  exports: [DevicesApiService],
})
export class DevicesModule {}
