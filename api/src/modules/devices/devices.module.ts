import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { FilesModule } from '../files/files.module';
import { UsersModule } from '../users/users.module';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { ExcelImportService } from '../../common/excel/excel-import.service';
import { DeviceCatalogUsage } from './device-catalog-usage';
import { DeviceExpirySource } from './device-expiry-source';
import { DeviceImportService } from './device-import.service';
import { DeviceModelOwnerResolver } from './device-model-owner-resolver';
import { DevicePhotosController } from './device-photos.controller';
import { DevicePhotosService } from './device-photos.service';
import { DevicePortsService } from './device-ports.service';
import { DevicesApiService } from './devices.api';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DeviceOwnerResolver } from './device-owner-resolver';
import { DeviceAuditLabeler } from './device-audit-labeler';
import { PortDeviceRetirement } from './port-device-retirement';

/**
 * Chủ sở hữu `device` + `device_history` (AD-3).
 * Ra ngoài chỉ xuất `DevicesApiService` (AD-2) — ipam/vault/software ở epic sau dùng cái đó.
 */
@Module({
  imports: [AuditModule, CatalogModule, FilesModule, UsersModule],
  controllers: [DevicesController, DevicePhotosController],
  providers: [
    DevicesService,
    DevicePhotosService,
    DeviceOwnerResolver,
    DeviceModelOwnerResolver,
    DeviceAuditLabeler,
    DevicePortsService,
    PortDeviceRetirement,
    DeviceImportService,
    DeviceExpirySource,
    DeviceCatalogUsage,
    DevicesApiService,
    ExcelExportService,
    ExcelImportService,
  ],
  exports: [DevicesApiService],
})
export class DevicesModule {}
