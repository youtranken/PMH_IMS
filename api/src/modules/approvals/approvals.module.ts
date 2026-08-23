import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { QueueModule } from '../queue/queue.module';
import { ApprovalSweepService } from './approval-sweep.service';
import { ApprovalsApiService } from './approvals.api';
import { ApprovalsService } from './approvals.service';

/**
 * Khung xin–duyệt dùng chung (AD-6) — tầng NỀN, chủ sở hữu bảng `approval` + `approval_history`.
 *
 * Module này không biết break-glass hay phiếu ISO là gì: loại yêu cầu tự đăng ký từ vựng state
 * của mình vào `ApprovalKindRegistry` (ở `common/`, @Global).
 */
@Module({
  imports: [AuditModule, OutboxModule, QueueModule],
  providers: [ApprovalsService, ApprovalsApiService, ApprovalSweepService],
  exports: [ApprovalsApiService],
})
export class ApprovalsModule {}
