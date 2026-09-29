import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { LOG_REDACT_PATHS } from './common/log-redact';
import { GlobalExceptionFilter } from './common/global-exception.filter';
import { THROTTLE_LIMITS } from './common/config-throttle';
import { UserThrottlerGuard } from './common/user-throttler.guard';
import { ExcelExportService } from './common/excel/excel-export.service';
import { ExcelImportService } from './common/excel/excel-import.service';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DisposalModule } from './modules/disposal/disposal.module';
import { DatabaseModule } from './database/database.module';
import { ApprovalsRegistryModule } from './common/approvals/approvals-registry';
import { OwnerAccessModule } from './common/owner-access.registry';
import { DevicePanelsModule } from './common/device-panels.registry';
import { DeviceTimelineModule } from './common/device-timeline.registry';
import { DeviceRetirementModule } from './common/device-retirement.registry';
import { DeviceSearchModule } from './common/device-search.registry';
import { OwnerExistsModule } from './common/owner-exists.registry';
import { AuditObjectLabelsModule } from './common/audit-object-labels.registry';
import { ExpiryRegistryModule } from './common/expiry/expiry-registry';
import { CatalogUsageModule } from './common/catalog-usage.registry';
import { HealthController } from './health/health.controller';
import { AuditModule } from './modules/audit/audit.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DevicesModule } from './modules/devices/devices.module';
import { ExpiryModule } from './modules/expiry/expiry.module';
import { CsrfGuard } from './modules/auth/csrf.guard';
import { StepUpGuard } from './modules/auth/step-up.guard';
import { RolesGuard } from './modules/auth/roles.guard';
import { SessionGuard } from './modules/auth/session.guard';
import { SystemConfigModule } from './modules/config-sys/system-config.module';
import { SystemConfigService } from './modules/config-sys/system-config.service';
import { FilesModule } from './modules/files/files.module';
import { MailModule } from './modules/mail/mail.module';
import { ServiceAccountsModule } from './modules/service-accounts/service-accounts.module';
import { SoftwareModule } from './modules/software/software.module';
import { IpamModule } from './modules/ipam/ipam.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { QueueModule } from './modules/queue/queue.module';
import { UsersModule } from './modules/users/users.module';
import { VaultModule } from './modules/vault/vault.module';

/**
 * Thứ tự guard toàn cục QUAN TRỌNG (Nest chạy theo thứ tự khai báo):
 *   1. Session    — dựng request.user từ cookie phiên
 *   2. Throttler  — rate-limit theo USER, nên PHẢI chạy sau Session
 *   3. Csrf       — cần request.user.sessionId của bước 1
 *   4. Roles      — quyền mặc định ĐÓNG (AD-9)
 *
 * Đừng đưa Throttler lên đầu để "chặn dò mật khẩu trước khi đụng DB". `UserThrottlerGuard`
 * đếm theo `req.user.email`, mà lúc đó `req.user` CHƯA tồn tại — nên nó lặng lẽ lùi về đếm
 * theo IP, và sau nginx thì cả văn phòng dùng chung một bucket, mà không có gì đỏ để báo.
 *
 * Đổi thứ tự KHÔNG làm hở đường dò mật khẩu: `SessionGuard` trả `true` ngay cho route
 * `@Public()` (login) mà không chạm DB, và login có `LoginRateGuard` riêng đọc ngưỡng từ
 * `system_config` (AD-11).
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        // Không để cookie/authorization/secret lọt vào log — danh sách ở common/log-redact.ts.
        redact: LOG_REDACT_PATHS,
        transport:
          process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DatabaseModule,
    DevicePanelsModule,
    DeviceTimelineModule,
    DeviceRetirementModule,
    DeviceSearchModule,
    OwnerExistsModule,
    AuditObjectLabelsModule,
    OwnerAccessModule,
    ExpiryRegistryModule,
    CatalogUsageModule,
    ApprovalsRegistryModule,
    SystemConfigModule,
    AuditModule,
    OutboxModule,
    QueueModule,
    UsersModule,
    AuthModule,
    ApprovalsModule,
    CatalogModule,
    DevicesModule,
    ServiceAccountsModule,
    SoftwareModule,
    ExpiryModule,
    FilesModule,
    MailModule,
    VaultModule,
    IpamModule,
    DashboardModule,
    DisposalModule,
  ],
  controllers: [HealthController],
  providers: [
    ExcelExportService,
    ExcelImportService,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: SessionGuard },
    // Trần `@ConfigThrottle` của UserThrottlerGuard đọc từ system_config (AD-11).
    { provide: THROTTLE_LIMITS, useExisting: SystemConfigService },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    /*
     * StepUpGuard chạy SAU RolesGuard và là guard cuối: nó chỉ có nghĩa khi đã biết route này
     * ai được vào. Nó MẶC ĐỊNH ĐÓNG — route không khai `@RequiresStepUp()` hoặc
     * `@NoStepUp()` thì 403 `STEP_UP_NOT_DECLARED`. Xem khối chú thích ở `step-up.guard.ts`
     * để biết chuỗi leo thang quyền mà cách gắn tay từng route đã để lọt.
     */
    { provide: APP_GUARD, useClass: StepUpGuard },
  ],
  exports: [ExcelExportService, ExcelImportService],
})
export class AppModule {}
