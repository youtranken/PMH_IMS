import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthedRequest } from '../modules/auth/types';

/**
 * Rate-limit theo USER (sub) thay vì IP (epic review 2) — sau nginx mọi request
 * cùng IP proxy, throttle theo IP sẽ gộp cả văn phòng vào một bucket.
 * PHẢI đăng ký SAU `SessionGuard` ở AppModule, nếu không `req.user` chưa tồn tại và guard
 * này lặng lẽ lùi về đếm theo IP — đúng thứ nó sinh ra để tránh, mà không có gì báo lỗi.
 * Thứ tự đó từng bị sai và code review Epic 4 mới phát hiện.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: AuthedRequest): Promise<string> {
    return Promise.resolve(req.user?.email ?? req.ip ?? 'anonymous');
  }
}
