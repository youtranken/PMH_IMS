import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { DevicesModule } from '../devices/devices.module';
import { DisposalModule } from '../disposal/disposal.module';
import { ExpiryModule } from '../expiry/expiry.module';
import { IpamModule } from '../ipam/ipam.module';
import { VaultModule } from '../vault/vault.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Bảng điều khiển (Epic 7) — module ĐỌC thuần: không sở hữu bảng nào (AD-3).
 *
 * Nó chỉ gom số liệu qua public api của các module khác. Đây là chỗ dễ phá AD-2 nhất trong cả
 * hệ thống: một cái JOIN ở đây nhanh hơn thật, nhưng dashboard sẽ thành nơi mọi bảng của mọi
 * module gặp nhau, và từ đó không module nào đổi được lược đồ của mình nữa.
 */
@Module({
  imports: [ExpiryModule, ApprovalsModule, DevicesModule, IpamModule, VaultModule, DisposalModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
