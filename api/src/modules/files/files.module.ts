import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FilesApiService } from './files.api';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

/**
 * Chủ sở hữu bảng `file` (AD-3) — module đính kèm DÙNG CHUNG.
 * Ra ngoài chỉ xuất `FilesApiService` (AD-2).
 */
@Module({
  imports: [AuditModule],
  controllers: [FilesController],
  providers: [FilesService, FilesApiService],
  exports: [FilesApiService],
})
export class FilesModule {}
