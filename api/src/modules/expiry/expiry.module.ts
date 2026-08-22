import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SystemConfigModule } from '../config-sys/system-config.module';
import { ExpiryApiService } from './expiry.api';
import { ExpiryController } from './expiry.controller';
import { ExpiryService } from './expiry.service';

/**
 * Cỗ máy Expiry (AD-7) — chủ sở hữu `renewal_history`.
 * KHÔNG import module nghiệp vụ nào: nguồn hạn đến từ sổ đăng ký ở `common`.
 */
@Module({
  imports: [AuditModule, SystemConfigModule],
  controllers: [ExpiryController],
  providers: [ExpiryService, ExpiryApiService],
  exports: [ExpiryApiService],
})
export class ExpiryModule {}
