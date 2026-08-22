import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import type { AppRole } from './roles.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthedRequest } from './types';

/**
 * AD-9 — QUYỀN MẶC ĐỊNH ĐÓNG. Khác QLTS ở đúng một điểm sống còn:
 * route KHÔNG khai `@Roles(...)` thì BỊ CHẶN, chứ không "cho qua vì đã đăng nhập".
 * Muốn mở cho mọi người đã đăng nhập thì phải viết `@Roles('sa','admin','member')` —
 * quên khai là 403 ngay ở môi trường dev, không lọt ra production.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<AppRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      throw new ForbiddenException({
        code: 'ROLES_NOT_DECLARED',
        message:
          'Route chưa khai @Roles(...) — bị chặn theo mặc định đóng (AD-9). Đây là lỗi lập trình.',
      });
    }

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const role = request.user?.role;
    if (role && (required as string[]).includes(role)) return true;

    throw new ForbiddenException({
      code: 'FORBIDDEN_ROLE',
      message: 'Bạn không có quyền thực hiện thao tác này.',
    });
  }
}
