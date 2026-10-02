import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DiagramSpikeController } from './diagram-spike.controller';
import { DiagramSpikeService } from './diagram-spike.service';

/**
 * Chủ sở hữu `diagram_spike` (AD-3) — bản thử draw.io. Không xuất gì: chưa module nào cần đọc
 * bản vẽ, và Epic 10 giữ chiều phụ thuộc một phía (không ai gọi ngược `diagrams`).
 */
@Module({
  imports: [AuditModule],
  controllers: [DiagramSpikeController],
  providers: [DiagramSpikeService],
})
export class DiagramsModule {}
