import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { SystemConfigService } from '../config-sys/system-config.service';
import type { AuthedRequest } from './types';

const WINDOW_MS = 60_000;
/** Dọn bộ đếm cũ mỗi 5 phút — chống rò bộ nhớ khi bị quét IP hàng loạt. */
const PRUNE_EVERY_MS = 5 * 60_000;

/**
 * Đếm số lần trong một CỬA SỔ CỐ ĐỊNH theo khóa (ở đây là IP).
 * Tách khỏi guard để test bằng bảng dữ liệu, không cần dựng Nest.
 */
export class FixedWindowCounter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();
  private lastPrune = 0;

  /** Trả về số lần đã dùng TRONG cửa sổ hiện tại, tính cả lần này. */
  hit(key: string, now: number, windowMs = WINDOW_MS): number {
    this.prune(now, windowMs);
    const current = this.hits.get(key);
    if (!current || now - current.windowStart >= windowMs) {
      this.hits.set(key, { count: 1, windowStart: now });
      return 1;
    }
    current.count += 1;
    return current.count;
  }

  /** Số giây còn lại của cửa sổ — để nói với người dùng "chờ bao lâu". */
  retryAfterSeconds(key: string, now: number, windowMs = WINDOW_MS): number {
    const current = this.hits.get(key);
    if (!current) return 0;
    return Math.max(1, Math.ceil((current.windowStart + windowMs - now) / 1000));
  }

  reset(): void {
    this.hits.clear();
  }

  private prune(now: number, windowMs: number): void {
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    for (const [key, value] of this.hits) {
      if (now - value.windowStart >= windowMs) this.hits.delete(key);
    }
  }
}

/**
 * Chặn dò mật khẩu theo IP (NFR-01).
 *
 * Ngưỡng đọc từ `system_config` khóa `login.rate_limit_per_ip` (AD-11) — TRƯỚC ĐÂY con số 20
 * bị viết cứng trong `@Throttle` của route login, tức là khóa cấu hình có mà không ai đọc:
 * Admin sửa cấu hình thì hệ thống vẫn chạy theo số cũ. Bộ E2E của Epic 2 đâm vào trần này
 * mới lộ ra.
 *
 * Bộ đếm nằm TRONG BỘ NHỚ tiến trình, giống ThrottlerGuard mặc định — API cố ý không mở
 * kết nối Redis (xem QueueModule). Chạy nhiều instance api thì mỗi instance có trần riêng;
 * ghi lại ở đây để lúc scale ngang thì biết mà chuyển sang bộ đếm chung.
 */
@Injectable()
export class LoginRateGuard implements CanActivate {
  private readonly counter = new FixedWindowCounter();

  constructor(private readonly config: SystemConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const key = request.ip ?? 'unknown';
    const limit = await this.config.getNumber('loginRateLimitPerIp');
    const now = Date.now();
    const used = this.counter.hit(key, now);

    if (used > limit) {
      const retryAfter = this.counter.retryAfterSeconds(key, now);
      throw new HttpException(
        {
          code: 'LOGIN_RATE_LIMITED',
          message: `Quá nhiều lần đăng nhập từ máy này. Thử lại sau ${retryAfter} giây.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
