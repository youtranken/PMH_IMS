import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasFeature, type Feature } from '../../common/features';
import { FEATURE_KEY } from './feature.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthedRequest } from './types';

/**
 * Q-31: Member có nhóm quyền chỉ gọi được API của mảng nhóm cho thấy. Chạy SAU RolesGuard: vai
 * quyết người này có được làm việc đó không, nhóm chỉ thu hẹp thêm. MẶC ĐỊNH ĐÓNG như RolesGuard,
 * và `feature-surface.spec.ts` bắt route quên khai trước khi chạy.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const declared = this.reflector.getAllAndOverride<Feature[] | undefined>(FEATURE_KEY, targets);
    if (!declared) {
      throw new ForbiddenException({
        code: 'FEATURE_NOT_DECLARED',
        message: 'Chức năng này chưa khai thuộc mảng nào nên bị chặn. Đây là lỗi phần mềm, hãy báo SA.',
      });
    }
    if (declared.length === 0) return true;

    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (user && hasFeature(user.features, declared)) return true;

    throw new ForbiddenException({
      code: 'FEATURE_HIDDEN',
      message: 'Nhóm quyền của bạn không có mục này.',
    });
  }
}
