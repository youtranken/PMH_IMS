import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemConfigService } from '../config-sys/system-config.service';
import { isStepUpValid } from './session-policy';
import type { AuthedRequest } from './types';

export const REQUIRES_STEP_UP_KEY = 'ims:requires-step-up';

/**
 * FR-022: route này đòi đã gõ TOTP trong `secret.stepup_grace_minutes` phút gần nhất.
 *
 * Vì sao là decorator + guard chứ không phải một câu `if` trong service: cửa mở két sẽ nhiều
 * dần (xem secret 4.2, break-glass Epic 6, xuất khóa khi bàn giao). Mỗi chỗ tự viết `if` là
 * mỗi chỗ có thể quên, hoặc quên khác kiểu — và cái quên đó không làm test nào đỏ. Khai báo
 * ngay trên route thì nhìn controller là biết cửa nào cần gõ mã.
 */
export const RequiresStepUp = () => SetMetadata(REQUIRES_STEP_UP_KEY, true);

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: SystemConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRES_STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const user = request.user;
    /**
     * Không có phiên thì SessionGuard đã chặn từ trước; đây là hàng rào cuối, không phải chỗ
     * để đoán "chắc là hợp lệ".
     *
     * Nhưng mã trả về phải là SESSION_MISSING chứ KHÔNG phải STEPUP_REQUIRED: client coi
     * STEPUP_REQUIRED là "phiên vẫn sống, chỉ cần gõ mã" và sẽ mở hộp nhập mã. Không có phiên
     * thì gõ mã nào cũng vô nghĩa — người dùng kẹt trong một hộp thoại không bao giờ thoát
     * được, thay vì được đưa về màn đăng nhập (code review Epic 4, finding 4).
     */
    if (!user) {
      throw new UnauthorizedException({
        code: 'SESSION_MISSING',
        message: 'Chưa đăng nhập.',
      });
    }

    // AD-11: grace đọc từ system_config, không hardcode 10.
    const graceMinutes = await this.config.getNumber('secretStepUpGraceMinutes');
    if (!isStepUpValid(user.steppedUpAt, graceMinutes, new Date())) {
      throw stepUpRequired(graceMinutes);
    }
    return true;
  }
}

function stepUpRequired(graceMinutes: number): UnauthorizedException {
  return new UnauthorizedException({
    code: 'STEPUP_REQUIRED',
    message: 'Nhập mã 6 số trên ứng dụng xác thực để mở két.',
    graceMinutes,
  });
}
