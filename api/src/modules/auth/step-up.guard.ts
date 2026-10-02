import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemConfigService } from '../config-sys/system-config.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { REQUIRES_STEP_UP_KEY } from './step-up.decorator';
import { isStepUpValid } from './session-policy';
import type { AuthedRequest } from './types';

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * ===== MẶC ĐỊNH ĐÓNG =====
   *
   * Mở mặc định (`if (!required) return true`) nghĩa là route không khai gì thì ĐI THẲNG, và
   * mọi route nhạy cảm viết sau này bắt đầu ở trạng thái không được bảo vệ.
   *
   * Cái quên đó có hậu quả đo được. Khi `/api/v1/accounts/*` không có step-up, một phiên SA bị
   * chiếm — đúng mô hình đe dọa mà chính cửa két nêu ra: "cookie trộm, máy bỏ ngỏ, chưa từng
   * gõ mã" — đi được TRỌN đường mà không cần yếu tố thứ hai của nạn nhân:
   *
   *   1. `GET /auth/me` lấy CSRF token (GET nên CsrfGuard bỏ qua).
   *   2. `POST /accounts` tạo một tài khoản SA mới; response trả thẳng `temporaryPassword`.
   *   3. `POST /auth/login` bằng tài khoản đó → phiên `authenticated` ngay.
   *   4. `POST /auth/totp/enroll` trả `secret` base32 nguyên văn → tự sinh mã 6 số.
   *   5. `POST /auth/step-up` → đóng dấu `stepped_up_at`.
   *   6. `POST /vault/secrets/:id/reveal` → plaintext.
   *
   * Cửa két được dựng để "kể cả root cũng phải gõ mã". Đường trên vô hiệu hoá đúng lời hứa đó.
   *
   * ===== HAI BƯỚC TRONG CHUỖI ĐÓ NAY ĐÃ BỊT (đừng đọc nó như mô tả hiện trạng) =====
   *
   * Bước 2 đóng bằng chính guard này: `/accounts/*` đòi step-up, nên phiên SA bị chiếm không
   * tạo nổi tài khoản mới để lấy mật khẩu tạm.
   *
   * Bước 4 đóng ở A-02: `POST /auth/totp/enroll` đòi mật khẩu
   * hiện tại, trừ phiên đang ở GIỮA luồng đăng nhập bắt buộc cài 2 lớp và còn trẻ hơn
   * `totp.enroll_reauth_minutes`. Sai đủ ngưỡng thì phiên bị thu hồi. Xem
   * `AuthService.startTotpEnrollment` và `canEnrollWithoutPassword` ở `session-policy.ts`.
   *
   * Chuỗi trên giữ nguyên ở đây vì nó là LÝ DO guard này mặc-định-đóng, không phải vì nó còn
   * đi được. Bịt hai bước không làm lý do ấy yếu đi: nó cho thấy một route quên khai lập
   * trường step-up là một mắt xích, và mắt xích thì phải tìm từng cái một mới thấy.
   *
   * `RolesGuard` trong chính repo này đã giải bài cùng hình dạng từ lâu: route quên `@Roles`
   * bị 403 `ROLES_NOT_DECLARED`, "Đây là lỗi lập trình". Đây là vế tương ứng cho step-up —
   * không phải để bắt mọi route gõ mã, mà để bắt mọi route TRẢ LỜI câu hỏi đó.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Route `@Public()` chạy trước khi có phiên (đăng nhập, health). Bắt chúng khai lập trường
    // step-up là vô nghĩa, và đá chúng thì không ai đăng nhập được nữa.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRES_STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined) {
      throw new ForbiddenException({
        code: 'STEP_UP_NOT_DECLARED',
        message:
          'Chức năng này chưa khai có cần nhập mã 6 số hay không nên bị chặn. ' +
          'Đây là lỗi phần mềm, hãy báo SA.',
      });
    }
    if (required === false) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const user = request.user;
    /**
     * Không có phiên thì SessionGuard đã chặn từ trước; đây là hàng rào cuối, không phải chỗ
     * để đoán "chắc là hợp lệ".
     *
     * Nhưng mã trả về phải là SESSION_MISSING chứ KHÔNG phải STEPUP_REQUIRED: client coi
     * STEPUP_REQUIRED là "phiên vẫn sống, chỉ cần gõ mã" và sẽ mở hộp nhập mã. Không có phiên
     * thì gõ mã nào cũng vô nghĩa — người dùng kẹt trong một hộp thoại không bao giờ thoát
     * được, thay vì được đưa về màn đăng nhập.
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
    message: 'Nhập mã 6 số trên ứng dụng xác thực để xác nhận thao tác này.',
    graceMinutes,
  });
}
