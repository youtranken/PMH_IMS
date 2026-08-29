import { expect, test } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_LOGIN_RATE_LIMIT,
  E2E_SA,
  getLoginRateLimit,
  resetUsers,
  setLoginRateLimit,
} from './helpers';

/**
 * Chặn dò mật khẩu theo IP (NFR-01, AC 1.2).
 *
 * VÌ SAO BÀI NÀY TỒN TẠI: hàng rào này chưa từng chạy thật một lần nào.
 *   - `login-rate.guard.spec.ts` TIÊM `SystemConfigService` GIẢ — nó chứng minh bộ đếm đúng,
 *     không chứng minh guard được lắp đúng vào chuỗi request. Guard từng bị đăng ký sai thứ
 *     tự một lần rồi (docs/EPIC-MAP.md:272) và "không có gì đỏ".
 *   - `resetUsers()` nới trần lên 500 trong MỌI beforeEach của cả 45 spec.
 *   - `grep 429` trong e2e trước 28/08: 3 kết quả, tất cả về trần MỞ KÉT, không dòng nào
 *     cho đăng nhập.
 * Tức là: unit test giả lập cấu hình → E2E tắt tính năng → 0 phủ sóng thực.
 *
 * Bài này mượn trần xuống thấp, chứng minh 429 là thật trên stack thật, rồi TRẢ LẠI ngay để
 * các spec sau không bị 429 oan. Bộ đếm của guard nằm trong RAM tiến trình api (cửa sổ 1
 * phút) — trả trần về 500 là đủ, vì vài lượt đã đếm luôn nhỏ hơn 500.
 */
test.describe('Chống dò mật khẩu theo IP', () => {
  const LIMIT = 3;
  let restoreTo = String(E2E_LOGIN_RATE_LIMIT);

  test.beforeAll(() => {
    resetUsers();
    restoreTo = getLoginRateLimit() || String(E2E_LOGIN_RATE_LIMIT);
    setLoginRateLimit(LIMIT);
  });

  test.afterAll(() => {
    setLoginRateLimit(Number(restoreTo) || E2E_LOGIN_RATE_LIMIT);
  });

  test('vượt trần thì trả 429 LOGIN_RATE_LIMITED, không phải 401', async ({ page }) => {
    await page.goto('/login');

    const attempt = () =>
      page.request.post('/api/v1/auth/login', {
        headers: { Origin: APP_ORIGIN },
        data: { email: E2E_SA.email, password: 'sai-mat-khau-co-y' },
        failOnStatusCode: false,
      });

    // Trong trần: phải là 401 (sai mật khẩu), KHÔNG được là 429.
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await attempt();
      expect(res.status(), `lần thử ${i + 1} còn trong trần`).toBe(401);
    }

    // Vượt trần: guard phải cắt trước cả khi kiểm mật khẩu.
    const blocked = await attempt();
    expect(blocked.status()).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'LOGIN_RATE_LIMITED' });
  });

  test('trần đọc TỪ system_config, không viết cứng trong code (AD-11)', async ({ page }) => {
    // Nâng trần lên cao rồi bắn đúng số lần vừa làm nghẽn ở bài trên: phải hết bị chặn.
    setLoginRateLimit(E2E_LOGIN_RATE_LIMIT);
    await page.goto('/login');

    const res = await page.request.post('/api/v1/auth/login', {
      headers: { Origin: APP_ORIGIN },
      data: { email: E2E_SA.email, password: 'sai-mat-khau-co-y' },
      failOnStatusCode: false,
    });

    // Đổi một dòng trong system_config là đổi hành vi — không cần dựng lại ảnh docker.
    expect(res.status()).toBe(401);
  });
});
