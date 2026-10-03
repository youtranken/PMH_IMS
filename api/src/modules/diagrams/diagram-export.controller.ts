import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsUUID } from 'class-validator';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import { NoStepUp, RequiresStepUp } from '../auth/step-up.decorator';
import type { AuthedRequest } from '../auth/types';
import { DiagramExportService, type ExportFormat } from './diagram-export.service';

class VersionParamDto {
  @IsUUID(undefined, { message: 'Mã bản vẽ không hợp lệ.' })
  id!: string;

  @IsUUID(undefined, { message: 'Mã phiên bản không hợp lệ.' })
  versionId!: string;
}

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã bản vẽ không hợp lệ.' })
  id!: string;
}

class ExportDto {
  @IsIn(['png', 'pdf'], { message: 'Định dạng xuất chỉ nhận PNG hoặc PDF.' }) format!: ExportFormat;
}

class CompareQueryDto {
  @IsUUID(undefined, { message: 'Phiên bản so sánh không hợp lệ.' }) from!: string;
  @IsUUID(undefined, { message: 'Phiên bản so sánh không hợp lệ.' }) to!: string;
}

/** Bỏ dấu cho `filename=` (ASCII); tên đủ dấu đi ở `filename*` (RFC 5987). */
function asciiName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/"/g, "'");
}

/**
 * Xuất PNG/PDF và so sánh phiên bản (FR-044, Q-23). Cả hai là đọc NỘI DUNG bản vẽ: đòi mã phạm vi
 * sơ đồ như màn xem (AD-17) — hết ân hạn giữa chừng thì web hỏi mã tại chỗ rồi gọi lại.
 */
@NoStepUp()
@Controller('api/v1/diagrams')
export class DiagramExportController {
  constructor(private readonly exports: DiagramExportService) {}

  /**
   * POST chứ không GET: mỗi lượt là một sự kiện có nhật ký (`diagram.exported`) và mang CSRF — một
   * thẻ `<img src>` ở trang khác không được tự xuất hộ người đang đăng nhập.
   */
  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/versions/:versionId/exports')
  @Audited('diagram.exported', 'diagram', { writtenByService: true })
  async export(@Param() params: VersionParamDto, @Body() dto: ExportDto, @Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    const file = await this.exports.export({ email: req.user!.email, fullName: req.user!.fullName }, params.id, params.versionId, dto.format);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(file.body.length));
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName(file.fileName)}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.setHeader('Cache-Control', 'no-store');
    // Chân trang đã ghép (mã hoá URL vì header chỉ nhận ASCII) — bài kiểm đọc lại không phải giải ảnh.
    res.setHeader('X-Diagram-Export-Seq', String(file.seq));
    res.setHeader('X-Diagram-Export-Status', file.kind === 'presentation' ? 'presentation' : file.status);
    res.setHeader('X-Diagram-Export-Footer', encodeURIComponent(file.footer.join('\n')));
    res.setHeader('X-Diagram-Export-Band', encodeURIComponent(file.band ? [file.band.title, file.band.sub].filter(Boolean).join('\n') : ''));
    res.end(file.body);
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Get(':id/compare')
  compare(@Param() params: IdParamDto, @Query() query: CompareQueryDto, @Req() req: AuthedRequest) {
    return this.exports.compare(req.user!.email, params.id, query.from, query.to);
  }
}
