import { Module } from '@nestjs/common';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { AuditModule } from '../audit/audit.module';
import { SystemConfigModule } from '../config-sys/system-config.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ExpiryDigestService } from './expiry-digest.service';
import { ExpiryApiService } from './expiry.api';
import { ExpiryController } from './expiry.controller';
import { ExpiryService } from './expiry.service';

/**
 * Cỗ máy Expiry (AD-7) — chủ sở hữu `renewal_history`.
 * KHÔNG import module nghiệp vụ nào: nguồn hạn đến từ sổ đăng ký ở `common`.
 */
@Module({
  imports: [AuditModule, SystemConfigModule, OutboxModule],
  controllers: [ExpiryController],
  providers: [
    ExcelExportService,
    ExpiryService, ExpiryDigestService, ExpiryApiService],
  exports: [ExpiryApiService],
})
export class ExpiryModule {}
