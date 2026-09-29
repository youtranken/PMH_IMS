import { Module } from '@nestjs/common';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { ServiceAccountController } from './service-account.controller';
import { ServiceAccountService } from './service-account.service';
import { ServiceAccountOwnerResolver } from './service-account-owner-resolver';
import { ServiceAccountAuditLabeler } from './service-account-audit-labeler';
import { ServiceAccountsApiService } from './service-accounts.api';
import { ServiceAccountCatalogUsage } from './service-account-catalog-usage';

/**
 * Chủ sở hữu `service_account` + `service_account_history` (AD-3).
 * Ra ngoài chỉ xuất `ServiceAccountsApiService` (AD-2).
 */
@Module({
  imports: [AuditModule, UsersModule],
  controllers: [ServiceAccountController],
  providers: [
    ServiceAccountService,
    ServiceAccountsApiService,
    ServiceAccountOwnerResolver,
    ServiceAccountAuditLabeler,
    ServiceAccountCatalogUsage,
    ExcelExportService,
  ],
  exports: [ServiceAccountsApiService],
})
export class ServiceAccountsModule {}
