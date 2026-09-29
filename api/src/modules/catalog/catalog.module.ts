import { Module } from '@nestjs/common';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { ExcelImportService } from '../../common/excel/excel-import.service';
import { AuditModule } from '../audit/audit.module';
import { CatalogApiService } from './catalog.api';
import { CatalogController } from './catalog.controller';
import { CatalogImportService } from './catalog-import.service';
import { CatalogService } from './catalog.service';
import { CatalogOwnUsage } from './catalog-usage';

/**
 * Chủ sở hữu `site`, `cabinet`, `device_type`, `vendor`, `catalog_history` (AD-3).
 * Ra ngoài chỉ xuất `CatalogApiService` (AD-2) — module `devices` không thấy service/schema.
 */
@Module({
  imports: [AuditModule],
  controllers: [CatalogController],
  providers: [
    CatalogService,
    CatalogApiService,
    CatalogImportService,
    CatalogOwnUsage,
    ExcelExportService,
    ExcelImportService,
  ],
  exports: [CatalogApiService],
})
export class CatalogModule {}
