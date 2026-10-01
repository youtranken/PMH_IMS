import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
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
 * Bài này mượn trần xuống thấp, chứng minh 429 là thật trên stack thật, rồi TRẢ LẠI và CHỜ
 * api thật sự nhận trần cũ trước khi nhường cho spec sau. Bộ đếm của guard nằm trong RAM
 * tiến trình api, cửa sổ CỐ ĐỊNH 1 phút, đếm MỌI lượt đăng nhập từ IP này (cả lượt đúng của
 * các spec chạy trước) — nên bài không được coi cửa sổ là trống lúc mình bắt đầu.
 */
test.describe('Chống dò mật khẩu theo IP', () => {
  const LIMIT = 3;
  /** Giãn cách giữa các lượt dò — xem ghi chú ThrottlerModule ở bài 429. */
  const SPACING_MS = 4_000;
  /** Đủ phủ 30 giây cache cấu hình + trọn một cửa sổ 60 giây, với giãn cách ở trên. */
  const MAX_ROUNDS = 25;
  let restoreTo = String(E2E_LOGIN_RATE_LIMIT);

  const loginWrong = (request: APIRequestContext) =>
    request.post('/api/v1/auth/login', {
      headers: { Origin: APP_ORIGIN },
      data: { email: E2E_SA.email, password: 'sai-mat-khau-co-y' },
      failOnStatusCode: false,
    });

  /**
   * Chờ tới khi api THẬT SỰ dùng trần lớn hơn `LIMIT`: một loạt `LIMIT + 1` lượt liền nhau
   * không lượt nào bị 429.
   *
   * Thấy MỘT lượt 401 là chưa đủ: cửa sổ cố định vừa sang phút mới thì lượt đầu luôn lọt, kể
   * cả khi api vẫn đang giữ trần 3 trong cache. Bài cũ tin đúng điều đó, trả trần rồi đi —
   * và spec kế tiếp đăng nhập tới lượt thứ tư thì ăn 429 "thử lại sau 51 giây".
   */
  async function waitUntilLimitLifted(request: APIRequestContext): Promise<void> {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const statuses: number[] = [];
      for (let i = 0; i <= LIMIT; i += 1) statuses.push((await loginWrong(request)).status());
      if (!statuses.includes(429)) {
        expect(statuses.every((status) => status === 401)).toBe(true);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
    }
    throw new Error(`api vẫn chặn 429 sau ${MAX_ROUNDS} vòng — trần đăng nhập chưa được trả lại`);
  }

  test.beforeAll(() => {
    resetUsers();
    restoreTo = getLoginRateLimit() || String(E2E_LOGIN_RATE_LIMIT);
    setLoginRateLimit(LIMIT);
  });

  /*
   * Trả trần rồi CHỜ api nhận — kể cả khi bài AD-11 bên dưới bị bỏ (`--e2e-fast` lọc @slow)
   * hoặc đỏ giữa chừng. Không chờ thì cache 30 giây của api còn giữ trần 3 và spec chạy sau
   * bị 429 oan.
   */
  test.afterAll(async ({ playwright }) => {
    setLoginRateLimit(Number(restoreTo) || E2E_LOGIN_RATE_LIMIT);
    const request = await playwright.request.newContext({
      baseURL: APP_ORIGIN,
      ignoreHTTPSErrors: true,
    });
    try {
      await waitUntilLimitLifted(request);
    } finally {
      await request.dispose();
    }
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
  test.setTimeout(240_000);

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
    const attempt = () => loginWrong(page.request);
    const pause = () => page.waitForTimeout(SPACING_MS);

    /*
     * GIÃN CÁCH 4 giây giữa các lượt chờ, KHÔNG bắn liên tục: `ThrottlerModule` toàn cục có
     * trần 300 request/phút (`app.module.ts`), nên vòng lặp dày sẽ trúng guard ĐÓ trước và
     * trả `TOO_MANY_REQUESTS` thay vì `LOGIN_RATE_LIMITED`. Hai hàng rào khác nhau, phải phân
     * biệt được thì test mới nói lên điều gì.
     *
     * Bước 1 — chờ trần 3 có hiệu lực: bắn tới khi bị chặn. Không đếm "ba lượt 401 rồi mới
     * 429" ngay từ đầu được: cửa sổ hiện tại có thể đã mang sẵn các lượt đăng nhập của spec
     * chạy trước, và cache cấu hình có thể đổi từ 500 sang 3 giữa vòng đếm.
     */
    let res: APIResponse = await attempt();
    for (let i = 0; i < MAX_ROUNDS && res.status() !== 429; i += 1) {
      await pause();
      res = await attempt();
    }
    expect(res.status(), 'trần 3 phải có hiệu lực trong ~30 giây cache cấu hình').toBe(429);
    expect(await res.json()).toMatchObject({ code: 'LOGIN_RATE_LIMITED' });

    /*
     * Bước 2 — chờ cửa sổ MỚI. Trong một cửa sổ, bộ đếm chỉ tăng; đã 429 mà nay lọt 401 thì
     * lượt đó chắc chắn là lượt SỐ MỘT của cửa sổ mới. Từ đây đếm được chính xác.
     */
    for (let i = 0; i < MAX_ROUNDS && res.status() === 429; i += 1) {
      await pause();
      res = await attempt();
    }
    expect(res.status(), 'hết cửa sổ 1 phút thì phải đăng nhập lại được').toBe(401);

    // Bước 3 — các lượt còn lại trong trần: 401 (sai mật khẩu), KHÔNG được là 429.
    for (let i = 1; i < LIMIT; i += 1) {
      expect((await attempt()).status(), `lượt ${i + 1}/${LIMIT} vẫn trong trần`).toBe(401);
    }

    // Lượt vượt trần: guard phải cắt TRƯỚC cả khi kiểm mật khẩu.
    const blocked = await attempt();
    expect(blocked.status()).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'LOGIN_RATE_LIMITED' });
  });

  test('trần đọc TỪ system_config, không viết cứng trong code (AD-11) @slow', async ({ page }) => {
    // Nâng trần lên cao: cùng một IP vừa bị chặn ở bài trên phải được đi tiếp.
    // Nếu ngưỡng bị viết cứng trong code thì dòng UPDATE này không đổi được gì và bài đỏ.
    setLoginRateLimit(E2E_LOGIN_RATE_LIMIT);
    await page.goto('/login');

    // Đổi một dòng trong system_config là đổi hành vi — không cần dựng lại ảnh docker.
    await waitUntilLimitLifted(page.request);
  });
});
