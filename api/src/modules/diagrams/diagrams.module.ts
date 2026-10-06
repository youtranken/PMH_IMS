import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DevicesModule } from '../devices/devices.module';
import { IpamModule } from '../ipam/ipam.module';
import { OutboxModule } from '../outbox/outbox.module';
import { UsersModule } from '../users/users.module';
import { DiagramDriftService } from './diagram-drift.service';
import { DiagramExportController } from './diagram-export.controller';
import { DiagramExportService } from './diagram-export.service';
import { DiagramNavigationService } from './diagram-navigation.service';
import { DiagramPruneService } from './diagram-prune.service';
import { DiagramReviewController } from './diagram-review.controller';
import { DiagramReviewService } from './diagram-review.service';
import { DiagramsController } from './diagrams.controller';
import { DiagramsService } from './diagrams.service';

/**
 * Chủ sở hữu `diagram`, `diagram_version`, `diagram_version_label`, `diagram_history`,
 * `diagram_presence`, `diagram_comment`, `diagram_drift` (AD-3, AD-18); duyệt bản vẽ đi qua
 * `approvals.api` (AD-6). `EnvelopeCryptoService` lấy từ `AuthModule` (một chùm master key) để dẫn
 * khoá mã bản vẽ dở cho web.
 * Không xuất gì: không module nào import `diagrams` — trang khác muốn biết thiết bị có mặt trong
 * bản vẽ nào thì web gọi endpoint của `diagrams`.
 */
@Module({
  imports: [ApprovalsModule, AuditModule, AuthModule, CatalogModule, DevicesModule, IpamModule, OutboxModule, UsersModule],
  controllers: [DiagramsController, DiagramReviewController, DiagramExportController],
  providers: [DiagramsService, DiagramReviewService, DiagramExportService, DiagramDriftService, DiagramNavigationService, DiagramPruneService],
})
export class DiagramsModule {}
