import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule, ThrottlerStorageService } from '@nestjs/throttler';
import { ConfigThrottle, THROTTLE_LIMITS, type ThrottleLimitSource } from './config-throttle';
import { UserThrottlerGuard } from './user-throttler.guard';

/**
 * BE-20 · trần theo phút của các route nhạy cảm đọc từ `system_config` (AD-11), không nằm cứng
 * trong `@Throttle`. Đổi số trong cấu hình là guard đổi theo ngay lượt sau — không phải dựng
 * lại ảnh docker.
 */

class Probe {
  @ConfigThrottle('rateTotpPerMinute')
  guarded(): void {}

  plain(): void {}
}

function contextFor(handler: 'guarded' | 'plain', email: string): ExecutionContext {
  const request = { user: { email }, ip: '10.0.0.1', headers: {} };
  const response = { header: () => undefined };
  return {
    // Lấy hàm qua descriptor: chính hàm đó là khoá mà `Reflector` đọc metadata của decorator.
    getHandler: () => Object.getOwnPropertyDescriptor(Probe.prototype, handler)?.value as unknown,
    getClass: () => Probe,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

async function guardWith(limit: { value: number }, asked: string[]): Promise<UserThrottlerGuard> {
  const guard = new UserThrottlerGuard(
    [{ ttl: 60_000, limit: 300 }],
    new ThrottlerStorageService(),
    new Reflector(),
  );
  const source: ThrottleLimitSource = {
    getNumber: (name: string) => {
      asked.push(name);
      return Promise.resolve(limit.value);
    },
  };
  Object.assign(guard, { limits: source });
  await guard.onModuleInit();
  return guard;
}

async function passes(guard: UserThrottlerGuard, handler: 'guarded' | 'plain', email: string) {
  try {
    return await guard.canActivate(contextFor(handler, email));
  } catch (error) {
    if (error instanceof HttpException && error.getStatus() === 429) return false;
    throw error;
  }
}

describe('UserThrottlerGuard — trần theo phút lấy từ system_config', () => {
  it('chặn ở lượt vượt đúng số cấu hình, và hỏi đúng khoá đã khai', async () => {
    const asked: string[] = [];
    const guard = await guardWith({ value: 3 }, asked);
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await passes(guard, 'guarded', 'a@pmh.com.vn'));
    expect(results).toEqual([true, true, true, false]);
    expect(new Set(asked)).toEqual(new Set(['rateTotpPerMinute']));
  });

  /*
   * Nới TRƯỚC khi chạm trần. Đã chạm trần thì người đó bị chặn trọn cửa sổ 60 giây (hành vi
   * `blockDuration` của throttler) — nới cấu hình giữa chừng không mở khoá cho họ sớm hơn.
   */
  it('nới số trong cấu hình thì guard nới theo ngay lượt sau', async () => {
    const limit = { value: 2 };
    const guard = await guardWith(limit, []);
    expect(await passes(guard, 'guarded', 'b@pmh.com.vn')).toBe(true);
    expect(await passes(guard, 'guarded', 'b@pmh.com.vn')).toBe(true);

    limit.value = 10;
    expect(await passes(guard, 'guarded', 'b@pmh.com.vn')).toBe(true);

    const tight = await guardWith({ value: 2 }, []);
    await passes(tight, 'guarded', 'b@pmh.com.vn');
    await passes(tight, 'guarded', 'b@pmh.com.vn');
    expect(await passes(tight, 'guarded', 'b@pmh.com.vn')).toBe(false);
  });

  it('mỗi người một bộ đếm — người này bị chặn không kéo theo người khác', async () => {
    const guard = await guardWith({ value: 1 }, []);
    await passes(guard, 'guarded', 'c@pmh.com.vn');
    expect(await passes(guard, 'guarded', 'c@pmh.com.vn')).toBe(false);
    expect(await passes(guard, 'guarded', 'd@pmh.com.vn')).toBe(true);
  });

  it('route không khai `@ConfigThrottle` giữ trần chung, không hỏi cấu hình', async () => {
    const asked: string[] = [];
    const guard = await guardWith({ value: 1 }, asked);
    for (let i = 0; i < 5; i += 1) {
      expect(await passes(guard, 'plain', 'e@pmh.com.vn')).toBe(true);
    }
    expect(asked).toEqual([]);
  });

  // Tiêm qua thuộc tính: phải kiểm bằng DI thật của Nest, không bằng `Object.assign` như trên.
  it('Nest tiêm được nguồn trần vào guard qua THROTTLE_LIMITS', async () => {
    const source: ThrottleLimitSource = { getNumber: () => Promise.resolve(1) };
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])],
      providers: [UserThrottlerGuard, { provide: THROTTLE_LIMITS, useValue: source }],
    }).compile();
    const guard = moduleRef.get(UserThrottlerGuard);
    await guard.onModuleInit();
    expect(await passes(guard, 'guarded', 'f@pmh.com.vn')).toBe(true);
    expect(await passes(guard, 'guarded', 'f@pmh.com.vn')).toBe(false);
  });

  /*
   * Câu mặc định của thư viện là "ThrottlerException: Too Many Requests" — tiếng Anh thô lọt lên
   * toast. Body phải mang mã riêng + câu tiếng Việt + số giây để web nói được "thử lại sau N giây".
   */
  it('429 mang mã RATE_LIMITED, câu tiếng Việt và số giây chờ', async () => {
    const guard = await guardWith({ value: 1 }, []);
    await passes(guard, 'guarded', 'g@pmh.com.vn');
    let caught: unknown;
    try {
      await guard.canActivate(contextFor('guarded', 'g@pmh.com.vn'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpException);
    const http = caught as HttpException;
    expect(http.getStatus()).toBe(429);
    const body = http.getResponse() as { code: string; message: string; retryAfter: number };
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.retryAfter).toBeLessThanOrEqual(60);
    expect(body.message).toBe(`Thao tác quá nhanh, thử lại sau ${body.retryAfter} giây.`);
  });
});
