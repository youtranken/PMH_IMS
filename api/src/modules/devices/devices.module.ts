import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { ExcelImportService } from '../../common/excel/excel-import.service';
import { DeviceExpirySource } from './device-expiry-source';
import { DeviceImportService } from './device-import.service';
import { DevicePortsService } from './device-ports.service';
import { DevicesApiService } from './devices.api';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DeviceOwnerResolver } from './device-owner-resolver';

/**
 * Chủ sở hữu `device` + `device_history` (AD-3).
 * Ra ngoài chỉ xuất `DevicesApiService` (AD-2) — ipam/vault/software ở epic sau dùng cái đó.
 */
@Module({
  imports: [AuditModule, CatalogModule],
  controllers: [DevicesController],
  providers: [
    DevicesService,
    DeviceOwnerResolver,
    DevicePortsService,
    DeviceImportService,
    DeviceExpirySource,
    DevicesApiService,
    ExcelExportService,
    ExcelImportService,
  ],
  exports: [DevicesApiService],
})
export class DevicesModule {}
