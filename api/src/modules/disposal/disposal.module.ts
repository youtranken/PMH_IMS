import { Module } from '@nestjs/common';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { DevicesModule } from '../devices/devices.module';
import { ServiceAccountsModule } from '../service-accounts/service-accounts.module';
import { SoftwareModule } from '../software/software.module';
import { UsersModule } from '../users/users.module';
import { DisposalApiService } from './disposal.api';
import { DisposalController } from './disposal.controller';
import { DisposalService } from './disposal.service';

/**
 * Module ĐỌC thuần, không sở hữu bảng nào (AD-3) — cùng khuôn với `dashboard`.
 *
 * Đây là chỗ dễ phá AD-2: gom bốn loại hồ sơ bằng một câu UNION trên bốn bảng thì nhanh hơn
 * thật, nhưng kho thanh lý sẽ thành nơi bốn lược đồ gặp nhau và từ đó không module nào đổi
 * bảng của mình được nữa.
 */
@Module({
  imports: [DevicesModule, SoftwareModule, ServiceAccountsModule, UsersModule],
  controllers: [DisposalController],
  providers: [DisposalService, DisposalApiService, ExcelExportService],
  exports: [DisposalApiService],
})
export class DisposalModule {}
