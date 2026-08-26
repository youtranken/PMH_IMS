import { Module } from '@nestjs/common';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DevicesModule } from '../devices/devices.module';
import { ServiceAccountsModule } from '../service-accounts/service-accounts.module';
import { SoftwareModule } from '../software/software.module';
import { UsersModule } from '../users/users.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { OutboxModule } from '../outbox/outbox.module';
import { AccessListService } from './access-list.service';
import { BreakGlassController } from './break-glass.controller';
import { BreakGlassService } from './break-glass.service';
import { AuthModule } from '../auth/auth.module';
import { StepUpGuard } from '../auth/step-up.guard';
import { VaultApiService } from './vault.api';
import { VaultAccessController } from './vault-access.controller';
import { VaultController } from './vault.controller';
import { VaultOwnersController } from './vault-owners.controller';
import { VaultOwnersService } from './vault-owners.service';
import { VaultDevicePanel } from './vault-device-panel';
import { VaultService } from './vault.service';

/**
 * Két sắt (AD-4) — chủ sở hữu DUY NHẤT bảng `secret`.
 *
 * `EnvelopeCryptoService` lấy từ `AuthModule` chứ KHÔNG dựng lại ở đây: chùm master key phải
 * là MỘT thể trong cả tiến trình. Hai instance đọc cùng file thì hôm nay giống nhau, nhưng
 * ngày xoay chìa (NFR-02) một cái nạp bản mới còn cái kia giữ bản cũ trong bộ nhớ — và cái
 * sai đó chỉ lộ ra khi có thứ giải không được.
 *
 * Ra ngoài chỉ xuất `VaultApiService`, và api đó KHÔNG có đường lấy plaintext.
 */
@Module({
  imports: [AuditModule, AuthModule, CatalogModule, DevicesModule, ServiceAccountsModule, SoftwareModule, UsersModule, ApprovalsModule, OutboxModule],
  controllers: [VaultController, VaultOwnersController, VaultAccessController, BreakGlassController],
  providers: [
    ExcelExportService,
    VaultService, VaultApiService, VaultOwnersService, VaultDevicePanel, AccessListService, BreakGlassService, StepUpGuard],
  exports: [VaultApiService],
})
export class VaultModule {}
