import { Global, Module } from '@nestjs/common';
import { OutboxAdminController } from './outbox-admin.controller';
import { OutboxAdminService } from './outbox-admin';
import { OutboxService } from './outbox.service';

/**
 * Outbox (AD-11) — Global vì module nghiệp vụ (Tickets…) ghi sự kiện trong tx của mình.
 * Relay/worker đọc service này ở process worker.
 */
@Global()
@Module({
  controllers: [OutboxAdminController],
  providers: [OutboxService, OutboxAdminService],
  exports: [OutboxService],
})
export class OutboxModule {}
