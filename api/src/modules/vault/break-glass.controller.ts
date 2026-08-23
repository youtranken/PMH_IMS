import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Audited } from '../audit/audited.decorator';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { sendXlsx } from '../../common/excel/xlsx-http';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { BreakGlassService } from './break-glass.service';
import { SECRET_OWNER_TYPES, type SecretOwnerType } from './vault.service';

class RequestDto {
  @IsIn([...SECRET_OWNER_TYPES], { message: 'Loại chủ thể không hợp lệ.' })
  ownerType!: SecretOwnerType;

  @IsUUID(undefined, { message: 'Mã chủ thể không hợp lệ.' })
  ownerId!: string;

  @IsString() @Length(5, 500) reason!: string;

  /**
   * Trần thật nằm ở `breakglass.max_grant_hours` (AD-11) và service KẸP theo nó. Chặn 168 ở
   * đây chỉ để một con số vô lý không đi xa hơn cửa vào — không phải để thay cho trần cấu hình.
   */
  @IsInt() @Min(1) @Max(168) hours!: number;
}

class DecisionDto {
  @IsOptional() @IsInt() @Min(1) @Max(168) hours?: number;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã yêu cầu không hợp lệ.' })
  id!: string;
}

/**
 * Break-glass (story 6.3, FR-023).
 *
 * Quyền ở đây cố ý KHÔNG đối xứng: ai cũng XIN được (kể cả Admin, dù họ hiếm khi cần), nhưng
 * chỉ SA/Admin mới QUYẾT. Người xin cũng tự hủy được yêu cầu của chính mình — việc đã xong
 * trước khi ai kịp duyệt là chuyện thường lúc 2 giờ sáng.
 */
@Controller('api/v1/vault/break-glass')
export class BreakGlassController {
  constructor(
    private readonly breakGlass: BreakGlassService,
    private readonly excel: ExcelExportService,
  ) {}

  /** Yêu cầu của CHÍNH MÌNH — Member mở màn này để xem đã được duyệt chưa. */
  @Roles('sa', 'admin', 'member')
  @Get('mine')
  mine(@Req() req: AuthedRequest) {
    return this.breakGlass.mine(actor(req));
  }

  /** Hàng chờ của người duyệt. */
  @Roles('sa', 'admin')
  @Get('pending')
  pending() {
    return this.breakGlass.pendingForApprovers();
  }

  /** FR-025: nhật ký đầy đủ — ai xin, lý do, ai duyệt, hết hạn lúc nào. Dashboard Epic 7 đọc. */
  @Roles('sa', 'admin')
  @Get('log')
  log() {
    return this.breakGlass.log();
  }

  /**
   * FR-025 / AC 7.2: xuất nhật ký break-glass để nộp cho auditor.
   *
   * File này KHÔNG có cột nào chứa secret — chỉ ai xin, đối tượng nào, lý do, ai duyệt, hạn
   * bao lâu. FR-026 vẫn nguyên hiệu lực: không đường nào xuất được giá trị trong két, kể cả
   * đường đi vòng qua nhật ký (`vault-surface.spec.ts` khóa luật này lại).
   */
  @Roles('sa', 'admin')
  @Audited('break_glass.exported', 'approval')
  @Get('export.xlsx')
  async export(@Res() res: Response) {
    const rows = await this.breakGlass.log();
    const buffer = await this.excel.build({
      sheetName: 'Nhat ky break-glass',
      columns: [
        { header: 'Người xin', width: 28, value: (r) => r.requester },
        { header: 'Loại đối tượng', width: 16, value: (r) => r.subjectType },
        { header: 'Mã đối tượng', width: 38, value: (r) => r.subjectId },
        { header: 'Lý do', width: 48, value: (r) => r.reason },
        { header: 'Trạng thái', width: 16, value: (r) => BG_STATE_LABEL[r.state] ?? r.state },
        { header: 'Người quyết', width: 28, value: (r) => r.decidedBy ?? '' },
        { header: 'Ghi chú quyết', width: 36, value: (r) => r.decisionNote ?? '' },
        { header: 'Gửi lúc', width: 20, value: (r) => r.createdAt },
        { header: 'Hết hạn', width: 20, value: (r) => r.expiresAt ?? '' },
      ],
      rows,
    });
    sendXlsx(res, buffer, 'nhat-ky-break-glass.xlsx');
  }

  @Roles('sa', 'admin', 'member')
  @Post()
  @Audited('break_glass.requested', 'approval', { writtenByService: true })
  request(@Body() body: RequestDto, @Req() req: AuthedRequest) {
    return this.breakGlass.request(actor(req), body);
  }

  @Roles('sa', 'admin')
  @Post(':id/approve')
  @Audited('break_glass.approved', 'approval', { writtenByService: true })
  approve(@Param() params: IdParamDto, @Body() body: DecisionDto, @Req() req: AuthedRequest) {
    return this.breakGlass.approve(actor(req), params.id, body);
  }

  @Roles('sa', 'admin')
  @Post(':id/deny')
  @Audited('break_glass.denied', 'approval', { writtenByService: true })
  deny(@Param() params: IdParamDto, @Body() body: DecisionDto, @Req() req: AuthedRequest) {
    return this.breakGlass.deny(actor(req), params.id, body.note);
  }

  /** Thu hồi sớm: người xin không còn trực nữa thì không phải chờ hết giờ. */
  @Roles('sa', 'admin')
  @Post(':id/revoke')
  @Audited('break_glass.revoked', 'approval', { writtenByService: true })
  revoke(@Param() params: IdParamDto, @Body() body: DecisionDto, @Req() req: AuthedRequest) {
    return this.breakGlass.revoke(actor(req), params.id, body.note);
  }

  @Roles('sa', 'admin', 'member')
  @Post(':id/cancel')
  @Audited('break_glass.cancelled', 'approval', { writtenByService: true })
  cancel(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    return this.breakGlass.cancel(actor(req), params.id);
  }
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}

const BG_STATE_LABEL: Record<string, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  denied: 'Từ chối',
  cancelled: 'Đã hủy',
  expired: 'Hết hạn',
  revoked: 'Đã thu hồi',
};
