import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { AuditApiService } from './audit.api';
import { AuditQueryService } from './audit-query.service';
import { AuditWriterService } from './audit-writer.service';
import { SecurityProbeService } from './security-probe.service';

/**
 * AD-9 — hạ tầng audit.
 *
 * `AuditInterceptor` đăng ký APP_INTERCEPTOR ĐÚNG MỘT LẦN, ở đây.
 *
 * Trước đây nó được khai ở CẢ đây lẫn `app.module.ts`, và Nest áp cả hai — mọi route dựa vào
 * interceptor để ghi audit đều đẻ ra HAI dòng giống hệt nhau. Chuyện đó ẩn suốt sáu epic vì
 * gần như mọi endpoint ghi đều dùng `writtenByService: true` (service tự ghi, interceptor bỏ
 * qua). Story 7.2 là chỗ đầu tiên có route thật sự trông vào interceptor — và bài kiểm "mỗi
 * lần xuất ghi một dòng" đếm ra 2 (code review nội bộ, Epic 7).
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditWriterService,
    AuditQueryService,
    SecurityProbeService,
    AuditApiService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditWriterService, AuditApiService],
})
export class AuditModule {}
