import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DiagramEditorController } from './diagram-editor.controller';
import { DiagramSpikeController } from './diagram-spike.controller';
import { DiagramSpikeService } from './diagram-spike.service';

/**
 * Chủ sở hữu `diagram_spike` (AD-3) — bản thử draw.io — và cổng kiểm XML/SVG bản vẽ. Không xuất gì: chưa module nào cần đọc
 * bản vẽ, và Epic 10 giữ chiều phụ thuộc một phía (không ai gọi ngược `diagrams`).
 */
@Module({
  imports: [AuditModule],
  controllers: [DiagramEditorController, DiagramSpikeController],
  providers: [DiagramSpikeService],
})
export class DiagramsModule {}
