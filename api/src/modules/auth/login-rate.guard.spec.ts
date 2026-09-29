import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { FixedWindowCounter, LoginRateGuard } from './login-rate.guard';
import type { SystemConfigService } from '../config-sys/system-config.service';

describe('FixedWindowCounter', () => {
  it('đếm dồn trong cùng một cửa sổ', () => {
    const counter = new FixedWindowCounter();
    const t = 1_000_000;
    expect(counter.hit('1.2.3.4', t)).toBe(1);
    expect(counter.hit('1.2.3.4', t + 10_000)).toBe(2);
    expect(counter.hit('1.2.3.4', t + 59_000)).toBe(3);
  });

  it('sang cửa sổ mới thì đếm lại từ đầu', () => {
    const counter = new FixedWindowCounter();
    const t = 1_000_000;
    counter.hit('1.2.3.4', t);
    counter.hit('1.2.3.4', t + 30_000);
    expect(counter.hit('1.2.3.4', t + 60_001)).toBe(1);
  });

  it('mỗi IP một bộ đếm riêng — một máy bị chặn không kéo theo cả văn phòng', () => {
    const counter = new FixedWindowCounter();
    const t = 1_000_000;
    counter.hit('1.2.3.4', t);
    counter.hit('1.2.3.4', t);
    expect(counter.hit('5.6.7.8', t)).toBe(1);
  });

  it('nói được còn bao nhiêu giây nữa mới hết cửa sổ', () => {
    const counter = new FixedWindowCounter();
    const t = 1_000_000;
    counter.hit('1.2.3.4', t);
    expect(counter.retryAfterSeconds('1.2.3.4', t + 20_000)).toBe(40);
    // Luôn ≥ 1 giây: nói "thử lại sau 0 giây" thì người dùng bấm lại ngay và lại bị chặn.
    expect(counter.retryAfterSeconds('1.2.3.4', t + 59_900)).toBe(1);
  });
});

function contextFor(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as unknown as ExecutionContext;
}

function configWithLimit(limit: number): SystemConfigService {
  return { getNumber: () => Promise.resolve(limit) } as unknown as SystemConfigService;
}

describe('LoginRateGuard — ngưỡng LẤY TỪ system_config (AD-11)', () => {
  it('cho qua khi còn dưới ngưỡng', async () => {
    const guard = new LoginRateGuard(configWithLimit(3));
    await expect(guard.canActivate(contextFor('1.2.3.4'))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor('1.2.3.4'))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor('1.2.3.4'))).resolves.toBe(true);
  });

  it('chặn 429 khi vượt ngưỡng, kèm mã lỗi và câu tiếng Việt', async () => {
    const guard = new LoginRateGuard(configWithLimit(2));
    await guard.canActivate(contextFor('1.2.3.4'));
    await guard.canActivate(contextFor('1.2.3.4'));

    await expect(guard.canActivate(contextFor('1.2.3.4'))).rejects.toThrow(HttpException);
    try {
      await guard.canActivate(contextFor('1.2.3.4'));
    } catch (error) {
      const response = (error as HttpException).getResponse() as {
        code: string;
        message: string;
      };
      expect((error as HttpException).getStatus()).toBe(429);
      expect(response.code).toBe('LOGIN_RATE_LIMITED');
      expect(response.message).toMatch(/Thử lại sau \d+ giây/);
    }
  });

  /**
   * Đây là điểm mấu chốt của AD-11: đổi số trong `system_config` là hành vi ĐỔI THEO.
   * Con số nằm cứng trong `@Throttle` thì khóa cấu hình chỉ để trưng bày.
   */
  it('nới ngưỡng trong cấu hình thì hệ thống nới theo ngay', async () => {
    const guard = new LoginRateGuard(configWithLimit(50));
    for (let i = 0; i < 40; i += 1) {
      await expect(guard.canActivate(contextFor('1.2.3.4'))).resolves.toBe(true);
    }
  });

  it('IP khác không ăn theo bộ đếm của IP đang bị chặn', async () => {
    const guard = new LoginRateGuard(configWithLimit(1));
    await guard.canActivate(contextFor('1.2.3.4'));
    await expect(guard.canActivate(contextFor('1.2.3.4'))).rejects.toThrow(HttpException);
    await expect(guard.canActivate(contextFor('9.9.9.9'))).resolves.toBe(true);
  });
});
