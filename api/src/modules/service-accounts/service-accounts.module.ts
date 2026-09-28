import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ServiceAccountController } from './service-account.controller';
import { ServiceAccountService } from './service-account.service';
import { ServiceAccountOwnerResolver } from './service-account-owner-resolver';
import { ServiceAccountAuditLabeler } from './service-account-audit-labeler';
import { ServiceAccountsApiService } from './service-accounts.api';

/**
 * Chủ sở hữu `service_account` + `service_account_history` (AD-3).
 * Ra ngoài chỉ xuất `ServiceAccountsApiService` (AD-2).
 */
@Module({
  imports: [AuditModule],
  controllers: [ServiceAccountController],
  providers: [
    ServiceAccountService,
    ServiceAccountsApiService,
    ServiceAccountOwnerResolver,
    ServiceAccountAuditLabeler,
  ],
  exports: [ServiceAccountsApiService],
})
export class ServiceAccountsModule {}
