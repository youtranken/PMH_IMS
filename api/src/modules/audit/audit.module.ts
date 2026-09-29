import { Global, Module } from '@nestjs/common';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { AuditPartitionSweep } from './audit-partition-sweep';
import { AuditApiService } from './audit.api';
import { AuditQueryService } from './audit-query.service';
import { AuditWriterService } from './audit-writer.service';
import { SecurityProbeService } from './security-probe.service';
import { UsersModule } from '../users/users.module';

/**
 * AD-9 — hạ tầng audit.
 *
 * `AuditInterceptor` đăng ký APP_INTERCEPTOR ĐÚNG MỘT LẦN, ở đây.
 *
 * Khai thêm ở `app.module.ts` thì Nest áp cả hai — mọi route dựa vào interceptor để ghi audit
 * đều đẻ ra HAI dòng giống hệt nhau. Lỗi đó dễ ẩn vì gần như mọi endpoint ghi đều dùng
 * `writtenByService: true` (service tự ghi, interceptor bỏ qua).
 */
@Global()
@Module({
  /*
   * `users` vào đây để `AuditQueryService` tra được tên người thao tác qua cửa chính, thay
   * cho tự viết `LEFT JOIN users` (A-07).
   *
   * Cạnh phụ thuộc chỉ đi MỘT chiều, audit → users. Chiều ngược lại không cần khai: module
   * này `@Global()` nên `UsersService` lấy `AuditWriterService` mà không phải import gì —
   * tức là không có vòng nào ở đây, dù nhìn thoáng qua thì trông như có.
   */
  imports: [UsersModule],
  controllers: [AuditController],
  providers: [
    ExcelExportService,
    AuditWriterService,
    AuditQueryService,
    SecurityProbeService,
    AuditApiService,
    AuditPartitionSweep,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditWriterService, AuditApiService],
})
export class AuditModule {}
