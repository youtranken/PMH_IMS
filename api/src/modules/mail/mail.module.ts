import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ExpiryModule } from '../expiry/expiry.module';
import { UsersModule } from '../users/users.module';
import { MailConsumer } from './mail.consumer';
import { MailTransportService } from './mail-transport.service';

/** Hạ tầng email: transport + consumer outbox. Không module nghiệp vụ nào gửi mail trực tiếp (AD-5). */
@Module({
  imports: [ApprovalsModule, ExpiryModule, UsersModule],
  providers: [MailTransportService, MailConsumer],
  exports: [MailConsumer, MailTransportService],
})
export class MailModule {}
