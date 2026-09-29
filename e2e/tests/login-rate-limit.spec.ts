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
 * VÌ SAO BÀI NÀY TỒN TẠI: đây là chỗ duy nhất hàng rào này chạy thật.
 *   - `login-rate.guard.spec.ts` TIÊM `SystemConfigService` GIẢ — nó chứng minh bộ đếm đúng,
 *     không chứng minh guard được lắp đúng vào chuỗi request. Guard đăng ký sai thứ tự thì
 *     "không có gì đỏ" (xem docs/EPIC-MAP.md).
 *   - `resetUsers()` nới trần lên 500 trong MỌI beforeEach của mọi spec khác.
 * Tức là thiếu bài này: unit test giả lập cấu hình → E2E tắt tính năng → 0 phủ sóng thực.
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

  /*
   * `SystemConfigService` cache mỗi khóa 30 GIÂY trong bộ nhớ tiến trình
   * (`system-config.service.ts:9` — `CACHE_TTL_MS = 30_000`), và `setWithin` chỉ xóa cache
   * TRONG tiến trình gọi nó. Ta đổi trần bằng psql nên api không hề biết: nó vẫn dùng giá trị
   * cũ tới 30 giây.
   *
   * Vì vậy bài này KHÔNG chờ mù bằng sleep, mà bắn lại cho tới khi thấy hành vi đổi, có trần
   * thời gian: "đổi cấu hình có hiệu lực ngay" là không đúng — có độ trễ tới 30 giây, và
   * worker giữ cache riêng của nó.
   */
  test.setTimeout(120_000);

  /**
   * CANH CHÍNH CÁI GIÀN GIÁO — không phải canh sản phẩm.
   *
   * `resetUsers()` chỉ XẾP HÀNG; `reset-e2e.mjs` chạy sau, do fixture gọi ngay trước thân
   * bài — và trong domain `users` của nó có một dòng đặt trần về 500. Không xả hàng đợi trước
   * thì trần mà `beforeAll` vừa hạ xuống 3 bị đè lại thành 500 TRƯỚC KHI bài chạy, và bài
   * chống dò mật khẩu bên dưới chạy với trần 500: không bao giờ chạm 429, luôn xanh vì lý do
   * sai.
   *
   * `setLoginRateLimit` tự `flushResets()` trước khi ghi. Bài này khóa đúng điều đó lại:
   * nó KHÔNG kiểm sản phẩm, nó kiểm rằng con số bộ test vừa đặt còn sống lúc bài bắt đầu.
   * Bỏ bài này thì một lần tối ưu tốc độ có thể tắt một hàng rào bảo mật mà không ai thấy.
   */
  test('giàn giáo: trần bộ test vừa đặt không bị hàng đợi dọn ghi đè', () => {
    expect(getLoginRateLimit()).toBe(String(LIMIT));
  });

  test('vượt trần thì trả 429 LOGIN_RATE_LIMITED, không phải 401 @slow', async ({ page }) => {
    await page.goto('/login');

    const attempt = () =>
      page.request.post('/api/v1/auth/login', {
        headers: { Origin: APP_ORIGIN },
        data: { email: E2E_SA.email, password: 'sai-mat-khau-co-y' },
        failOnStatusCode: false,
      });

    // Trong trần: phải là 401 (sai mật khẩu), KHÔNG được là 429.
    for (let i = 0; i < LIMIT; i += 1) {
      expect(await attempt().then((r) => r.status())).toBe(401);
    }

    /*
     * Vượt trần: guard phải cắt TRƯỚC cả khi kiểm mật khẩu.
     *
     * GIÃN CÁCH 4 giây giữa các lần bắn, KHÔNG bắn liên tục: `ThrottlerModule` toàn cục có
     * trần 300 request/phút (`app.module.ts`), nên vòng lặp dày sẽ trúng guard ĐÓ trước và
     * trả `TOO_MANY_REQUESTS` thay vì `LOGIN_RATE_LIMITED` — đúng lỗi bài này mắc phải lần
     * chạy đầu. Hai hàng rào khác nhau, phải phân biệt được thì test mới nói lên điều gì.
     */
    let blocked = await attempt();
    for (let i = 0; i < 12 && blocked.status() !== 429; i += 1) {
      await page.waitForTimeout(4_000);
      blocked = await attempt();
    }

    expect(blocked.status()).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'LOGIN_RATE_LIMITED' });
  });

  test('trần đọc TỪ system_config, không viết cứng trong code (AD-11) @slow', async ({ page }) => {
    // Nâng trần lên cao: cùng một IP vừa bị chặn ở bài trên phải được đi tiếp.
    // Nếu ngưỡng bị viết cứng trong code thì dòng UPDATE này không đổi được gì và bài đỏ.
    setLoginRateLimit(E2E_LOGIN_RATE_LIMIT);
    await page.goto('/login');

    const send = () =>
      page.request.post('/api/v1/auth/login', {
        headers: { Origin: APP_ORIGIN },
        data: { email: E2E_SA.email, password: 'sai-mat-khau-co-y' },
        failOnStatusCode: false,
      });

    // Lại phải đợi cache 30 giây của SystemConfigService nhả ra, và vẫn giãn cách để không
    // trúng throttler toàn cục — xem ghi chú ở bài trên.
    let res = await send();
    for (let i = 0; i < 12 && res.status() === 429; i += 1) {
      await page.waitForTimeout(4_000);
      res = await send();
    }

    // Đổi một dòng trong system_config là đổi hành vi — không cần dựng lại ảnh docker.
    expect(res.status()).toBe(401);
  });
});
