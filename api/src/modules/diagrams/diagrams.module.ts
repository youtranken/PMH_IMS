import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DevicesModule } from '../devices/devices.module';
import { IpamModule } from '../ipam/ipam.module';
import { UsersModule } from '../users/users.module';
import { DiagramsController } from './diagrams.controller';
import { DiagramsService } from './diagrams.service';

/**
 * Chủ sở hữu `diagram`, `diagram_version`, `diagram_version_label`, `diagram_history`,
 * `diagram_presence` (AD-3, AD-18). Không xuất gì: không module nào import `diagrams` — trang
 * khác muốn biết thiết bị có mặt trong bản vẽ nào thì web gọi endpoint của `diagrams`.
 */
@Module({
  imports: [AuditModule, CatalogModule, DevicesModule, IpamModule, UsersModule],
  controllers: [DiagramsController],
  providers: [DiagramsService],
})
export class DiagramsModule {}
