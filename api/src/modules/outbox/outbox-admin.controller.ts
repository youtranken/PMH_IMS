import { Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import { NoIdleTouch } from '../auth/no-idle-touch.decorator';
import { Roles } from '../auth/roles.decorator';
import { NoStepUp } from '../auth/step-up.decorator';
import type { AuthedRequest } from '../auth/types';
import { OutboxAdminService } from './outbox-admin';
import { FeatureFree } from '../auth/feature.decorator';

/**
 * Thư gửi lỗi (Q-25) — CHỈ SA, cùng phạm vi với Tham số hệ thống. Không đòi mã 2 lớp: gửi lại chỉ
 * gửi đúng thư hệ thống đã định gửi, không mở thêm gì; mỗi lần gửi lại vẫn là một dòng nhật ký.
 */
@NoStepUp()
@FeatureFree()
@Controller('api/v1/admin/outbox')
export class OutboxAdminController {
  constructor(private readonly admin: OutboxAdminService) {}

  @Roles('sa')
  @Get('failed')
  list() {
    return this.admin.listFailed();
  }

  /** Badge menu hỏi định kỳ: không gia hạn idle của phiên, như các badge khác. */
  @Roles('sa')
  @NoIdleTouch()
  @Get('failed/count')
  count() {
    return this.admin.failedCount();
  }

  @Roles('sa')
  @Post('failed/:id/requeue')
  @Audited('outbox.requeued', 'outbox', { writtenByService: true })
  requeue(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthedRequest) {
    return this.admin.requeue(id, req.user!.email);
  }
}
