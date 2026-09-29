import { Inject, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';
import type { AuthedRequest } from '../modules/auth/types';
import { CONFIG_THROTTLE, THROTTLE_LIMITS, type ThrottleLimitSource } from './config-throttle';

/** Các trần `@ConfigThrottle` đều tính theo phút — đơn vị, không phải tham số nghiệp vụ. */
const CONFIG_WINDOW_MS = 60_000;

/**
 * Rate-limit theo USER (sub) thay vì IP — sau nginx mọi request
 * cùng IP proxy, throttle theo IP sẽ gộp cả văn phòng vào một bucket.
 * PHẢI đăng ký SAU `SessionGuard` ở AppModule, nếu không `req.user` chưa tồn tại và guard
 * này lặng lẽ lùi về đếm theo IP — đúng thứ nó sinh ra để tránh, mà không có gì báo lỗi.
 *
 * Route khai `@ConfigThrottle` thì trần đọc từ `system_config` (AD-11); route khác giữ trần chung
 * của `ThrottlerModule.forRoot`.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  // Tiêm qua thuộc tính: constructor của `ThrottlerGuard` do thư viện giữ, đổi chữ ký là vỡ DI.
  @Inject(THROTTLE_LIMITS) private readonly limits!: ThrottleLimitSource;

  protected getTracker(req: AuthedRequest): Promise<string> {
    return Promise.resolve(req.user?.email ?? req.ip ?? 'anonymous');
  }

  protected async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const configName = this.reflector.getAllAndOverride<string | undefined>(CONFIG_THROTTLE, [
      props.context.getHandler(),
      props.context.getClass(),
    ]);
    if (!configName) return super.handleRequest(props);
    const limit = await this.limits.getNumber(configName);
    return super.handleRequest({
      ...props,
      limit,
      ttl: CONFIG_WINDOW_MS,
      blockDuration: CONFIG_WINDOW_MS,
    });
  }
}
