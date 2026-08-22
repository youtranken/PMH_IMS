import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { MailConsumer } from './mail.consumer';
import { MailTransportService } from './mail-transport.service';

/** Hạ tầng email: transport + consumer outbox. Không module nghiệp vụ nào gửi mail trực tiếp (AD-5). */
@Module({
  imports: [UsersModule],
  providers: [MailTransportService, MailConsumer],
  exports: [MailConsumer, MailTransportService],
})
export class MailModule {}
