import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { GlobalExceptionFilter } from './common/global-exception.filter';
import { UserThrottlerGuard } from './common/user-throttler.guard';
import { ExcelExportService } from './common/excel/excel-export.service';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { AuditModule } from './modules/audit/audit.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { CsrfGuard } from './modules/auth/csrf.guard';
import { RolesGuard } from './modules/auth/roles.guard';
import { SessionGuard } from './modules/auth/session.guard';
import { SystemConfigModule } from './modules/config-sys/system-config.module';
import { FilesModule } from './modules/files/files.module';
import { MailModule } from './modules/mail/mail.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { QueueModule } from './modules/queue/queue.module';
import { UsersModule } from './modules/users/users.module';

/**
 * Thứ tự guard toàn cục QUAN TRỌNG (Nest chạy theo thứ tự khai báo):
 *   1. Throttler  — chặn dò mật khẩu trước khi đụng DB (NFR-01)
 *   2. Session    — dựng request.user từ cookie phiên
 *   3. Csrf       — cần request.user.sessionId của bước 2
 *   4. Roles      — quyền mặc định ĐÓNG (AD-9)
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        // Không để cookie/authorization/secret lọt vào log (NFR-04).
        redact: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-csrf-token"]',
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
          'req.body.token',
        ],
        transport:
          process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DatabaseModule,
    SystemConfigModule,
    AuditModule,
    OutboxModule,
    QueueModule,
    UsersModule,
    AuthModule,
    FilesModule,
    MailModule,
  ],
  controllers: [HealthController],
  providers: [
    ExcelExportService,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [ExcelExportService],
})
export class AppModule {}
