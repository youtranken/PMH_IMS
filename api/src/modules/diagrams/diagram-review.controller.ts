import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { NoSecretText } from '../../common/no-secret-text';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import { NoStepUp, RequiresStepUp } from '../auth/step-up.decorator';
import type { AuthedRequest } from '../auth/types';
import { DiagramReviewService } from './diagram-review.service';

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã bản vẽ không hợp lệ.' })
  id!: string;
}

class ApprovalParamDto extends IdParamDto {
  @IsUUID(undefined, { message: 'Mã yêu cầu duyệt không hợp lệ.' })
  approvalId!: string;
}

class VersionParamDto extends IdParamDto {
  @IsUUID(undefined, { message: 'Mã phiên bản không hợp lệ.' })
  versionId!: string;
}

class CommentParamDto extends IdParamDto {
  @IsUUID(undefined, { message: 'Mã bình luận không hợp lệ.' })
  commentId!: string;
}

class SubmitDto {
  @IsString() @Length(1, 500, { message: 'Lý do gửi duyệt từ 1 đến 500 ký tự.' }) @NoSecretText('Lý do gửi duyệt') reason!: string;
  @IsOptional() @IsUUID(undefined, { message: 'Mã phiên bản không hợp lệ.' }) versionId?: string;
}

class DecisionDto {
  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Ghi chú tối đa 1000 ký tự.' })
  @NoSecretText('Ghi chú')
  note?: string | null;
}

class PublishDto {
  @IsOptional() @IsUUID(undefined, { message: 'Mã phiên bản không hợp lệ.' }) versionId?: string;
}

class AnchorDto {
  @IsNumber({ allowNaN: false, allowInfinity: false }) x!: number;
  @IsNumber({ allowNaN: false, allowInfinity: false }) y!: number;
}

class CommentDto {
  @IsUUID(undefined, { message: 'Mã phiên bản không hợp lệ.' }) versionId!: string;
  @ValidateIf((_o, v) => v !== null) @IsOptional() @IsString() @Length(1, 200, { message: 'Mã ô không hợp lệ.' }) cellId?: string | null;
  @ValidateIf((_o, v) => v !== null) @IsOptional() @ValidateNested() @Type(() => AnchorDto) anchor?: AnchorDto | null;
  @IsString() @Length(1, 2000, { message: 'Bình luận từ 1 đến 2000 ký tự.' }) @NoSecretText('Bình luận') body!: string;
  @ValidateIf((_o, v) => v !== null) @IsOptional() @IsUUID(undefined, { message: 'Luồng bình luận không hợp lệ.' }) parentId?: string | null;
}

class ResolveDto {
  @IsBoolean({ message: 'Trạng thái xử lý không hợp lệ.' }) resolved!: boolean;
}

/**
 * Gửi duyệt, duyệt, trả về, phát hành và bình luận ghim (Q-23, AD-6, AD-18). Mọi route chạm
 * NỘI DUNG hoặc đổi một bản vẽ có sẵn đòi mã phạm vi sơ đồ (Q-23: xem và sửa đều hỏi mã) — trang
 * duyệt hiện mã thiết bị, bình luận nêu id ô.
 */
@NoStepUp()
@Controller('api/v1/diagrams')
export class DiagramReviewController {
  constructor(private readonly review: DiagramReviewService) {}

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Get(':id/review')
  page(@Param() params: IdParamDto) {
    return this.review.review(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Get(':id/publications')
  publications(@Param() params: IdParamDto) {
    return this.review.publications(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/submit')
  @Audited('diagram_publish.requested', 'approval', { writtenByService: true })
  submit(@Param() params: IdParamDto, @Body() dto: SubmitDto, @Req() req: AuthedRequest) {
    return this.review.submit(req.user!, params.id, dto);
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/review/:approvalId/withdraw')
  @Audited('diagram_publish.withdrawn', 'approval', { writtenByService: true })
  withdraw(@Param() params: ApprovalParamDto, @Req() req: AuthedRequest) {
    return this.review.withdraw(req.user!, params.id, params.approvalId);
  }

  @Roles('sa', 'admin')
  @RequiresStepUp('diagram')
  @Post(':id/review/:approvalId/approve')
  @Audited(['diagram_publish.approved', 'diagram.published'], 'approval', { writtenByService: true })
  approve(@Param() params: ApprovalParamDto, @Body() dto: DecisionDto, @Req() req: AuthedRequest) {
    return this.review.approve(req.user!, params.id, params.approvalId, dto.note ?? null);
  }

  @Roles('sa', 'admin')
  @RequiresStepUp('diagram')
  @Post(':id/review/:approvalId/return')
  @Audited('diagram_publish.returned', 'approval', { writtenByService: true })
  returnToSender(@Param() params: ApprovalParamDto, @Body() dto: DecisionDto, @Req() req: AuthedRequest) {
    return this.review.returnToSender(req.user!, params.id, params.approvalId, { note: dto.note ?? null });
  }

  @Roles('sa', 'admin')
  @RequiresStepUp('diagram')
  @Post(':id/publish')
  @Audited('diagram.published', 'diagram', { writtenByService: true })
  publish(@Param() params: IdParamDto, @Body() dto: PublishDto, @Req() req: AuthedRequest) {
    return this.review.publish(req.user!, params.id, dto);
  }

  @Roles('sa', 'admin')
  @RequiresStepUp('diagram')
  @Post(':id/versions/:versionId/restore-official')
  @Audited(['diagram.version_restored', 'diagram.published'], 'diagram', { writtenByService: true })
  restoreOfficial(@Param() params: VersionParamDto, @Req() req: AuthedRequest) {
    return this.review.restoreOfficial(req.user!, params.id, params.versionId);
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Get(':id/comments')
  comments(@Param() params: IdParamDto) {
    return this.review.comments(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/comments')
  @Audited('diagram.commented', 'diagram', { writtenByService: true })
  comment(@Param() params: IdParamDto, @Body() dto: CommentDto, @Req() req: AuthedRequest) {
    return this.review.addComment(req.user!, params.id, dto);
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/comments/:commentId/resolve')
  @Audited(['diagram.comment_resolved', 'diagram.comment_reopened'], 'diagram', { writtenByService: true })
  async resolve(@Param() params: CommentParamDto, @Body() dto: ResolveDto, @Req() req: AuthedRequest) {
    await this.review.resolveComment(req.user!, params.id, params.commentId, dto.resolved);
    return { ok: true };
  }
}
