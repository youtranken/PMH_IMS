import { Module } from '@nestjs/common';
import { ExpiryModule } from '../expiry/expiry.module';
import { UsersModule } from '../users/users.module';
import { MailConsumer } from './mail.consumer';
import { MailTransportService } from './mail-transport.service';

/** Hạ tầng email: transport + consumer outbox. Không module nghiệp vụ nào gửi mail trực tiếp (AD-5). */
@Module({
  imports: [ExpiryModule, UsersModule],
  providers: [MailTransportService, MailConsumer],
  exports: [MailConsumer, MailTransportService],
})
export class MailModule {}
