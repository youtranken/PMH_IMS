import { Module } from '@nestjs/common';
import { EnvelopeCryptoService } from '../../common/crypto/envelope.service';
import { MasterKeyRing } from '../../common/crypto/master-key-ring';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { UsersModule } from '../users/users.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { KnownDeviceService } from './known-device.service';
import { PasswordService } from './password.service';
import { LoginFailureService } from './login-failure.service';
import { SessionAuditLabeler } from './session-audit-labeler';
import { LoginRateGuard } from './login-rate.guard';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

/**
 * Module auth (AD-8). Lõi mã hóa envelope và pepper khởi tạo TỪ FILE docker secret
 * ngay lúc dựng module — thiếu secret là api chết lúc boot, không chạy nửa vời (AD-11).
 */
@Module({
  imports: [UsersModule, AuditModule, OutboxModule],
  controllers: [AuthController, AccountsController],
  providers: [
    LoginRateGuard,
    LoginFailureService,
    AuthService,
    AccountsService,
    SessionService,
    SessionAuditLabeler,
    TotpService,
    KnownDeviceService,
    {
      provide: PasswordService,
      useFactory: () => PasswordService.fromSecretFile(),
    },
    {
      provide: MasterKeyRing,
      useFactory: () => MasterKeyRing.fromSecretFile(),
    },
    {
      provide: EnvelopeCryptoService,
      useFactory: (ring: MasterKeyRing) => new EnvelopeCryptoService(ring),
      inject: [MasterKeyRing],
    },
  ],
  exports: [SessionService, TotpService, EnvelopeCryptoService, PasswordService],
})
export class AuthModule {}
