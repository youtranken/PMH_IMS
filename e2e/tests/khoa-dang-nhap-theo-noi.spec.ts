import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { APP_ORIGIN, E2E_SA, clearMailbox, mailBody, resetUsers, sql, waitForMail } from './helpers';

/**
 * KHOÁ ĐĂNG NHẬP CHUYỂN TỪ "MỘT TÀI KHOẢN" SANG "MỘT TÀI KHOẢN TẠI MỘT NƠI" — NFR-01, 11/09.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * Bộ đếm gõ sai nằm trên hàng `users`, nên cái khoá đặt lên TÀI KHOẢN — và cái khoá đó ai kích
 * cũng được. Biết email của một người là khoá được họ ra ngoài bằng năm request, lặp lại tuỳ
 * thích. Trần theo IP không cứu: khoá chỉ cần 5 lượt nên một IP khoá được khoảng 4 tài khoản
 * mỗi phút, một buổi sáng là hết công ty. Và người đáng khoá nhất là SA, đúng lúc đang có sự
 * cố cần đăng nhập để xử lý.
 *
 * ===== BÀI NÀY GIỮ VẾ NÀO =====
 *
 * Vế "hai nơi đếm riêng nhau" không dựng được ở đây: Playwright chạy trên một máy, mà nginx
 * ghi `X-Forwarded-For` bằng `$proxy_add_x_forwarded_for` (NỐI THÊM địa chỉ socket thật) và
 * Express đặt `trust proxy = 1`, nên client KHÔNG tự khai IP của mình được. Hàng rào đó đúng,
 * và nó khiến E2E mù đúng chỗ này — vế ấy do `api/test/login-lockout-per-ip.spec.ts` giữ.
 *
 * Vế ở ĐÂY là vế mà chỉ chạy thật mới trả lời được: `login()` có ĐỌC bộ đếm mới không, hay nó
 * vẫn đọc `users.locked_until` như cũ. Cách hỏi: gõ sai cho tới khi bị chặn, rồi DỜI hàng khoá
 * sang một IP khác bằng SQL — tức dựng lại đúng tình huống "khoá thuộc về nơi khác" — và đòi
 * lượt đăng nhập ĐÚNG mật khẩu phải đi qua.
 *
 * Bản trước sẽ đỏ ở đúng bước đó, vì `users.locked_until` lúc ấy vẫn còn hiệu lực.
 */

const WRONG = 'chac-chan-sai-#2026';

function lockedUntilOfUser(): string {
  return sql(
    `SELECT coalesce(locked_until::text, '') FROM users WHERE email = '${E2E_SA.email}'`,
  );
}

function lockRowCount(): number {
  return Number(
    sql(
      `SELECT count(*) FROM login_failure f JOIN users u ON u.id = f.user_id WHERE u.email = '${E2E_SA.email}'`,
    ),
  );
}

/** Client thô, không qua `page` — đăng nhập là cửa trước khi có phiên. */
function rawClient(): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: APP_ORIGIN,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: APP_ORIGIN },
  });
}

function login(api: APIRequestContext, password: string) {
  return api.post('/api/v1/auth/login', { data: { email: E2E_SA.email, password } });
}

test.beforeEach(() => {
  resetUsers();
});

test.describe('Khoá đăng nhập theo NƠI, không theo tài khoản', () => {
  test('gõ sai đủ ngưỡng thì chính nơi đang gõ bị chặn — kể cả khi sau đó gõ ĐÚNG', async () => {
    const api = await rawClient();
    try {
      for (let i = 0; i < 6; i += 1) {
        const res = await login(api, WRONG);
        expect(res.status()).toBeGreaterThanOrEqual(400);
      }

      // Đúng mật khẩu nhưng vẫn bị chặn: khoá phải có tác dụng thật, không chỉ là một con số.
      const blocked = await login(api, E2E_SA.password);
      expect(blocked.status()).toBe(401);
      expect(((await blocked.json()) as { code?: string }).code).toBe('ACCOUNT_LOCKED');

      // Và nó phải là hàng khoá MỚI, không phải cột cũ trên `users`.
      expect(lockRowCount()).toBe(1);
    } finally {
      await api.dispose();
    }
  });

  test('ĐÂY LÀ CẢ BÀI: khoá thuộc về nơi KHÁC thì tài khoản vẫn đăng nhập được', async () => {
    const api = await rawClient();
    try {
      for (let i = 0; i < 6; i += 1) await login(api, WRONG);
      expect((await login(api, E2E_SA.password)).status()).toBe(401);

      /*
       * Dời hàng khoá sang một IP khác — dựng lại đúng tình huống thật: kẻ tấn công gõ sai từ
       * chỗ họ, còn người dùng thật ngồi ở bàn của mình.
       */
      sql(
        `UPDATE login_failure SET ip = '203.0.113.77' WHERE user_id = (SELECT id FROM users WHERE email = '${E2E_SA.email}')`,
      );

      /*
       * CÂU CHỐT, và nó chỉ có nghĩa khi bộ đếm CŨ vẫn đang "khoá": `users.locked_until` lúc
       * này vẫn nằm ở tương lai. Bản trước đọc đúng cột đó nên sẽ trả 401 ở đây — tức người
       * dùng thật bị nhốt ra ngoài bởi việc người khác gõ sai.
       */
      expect(lockedUntilOfUser()).not.toBe('');

      const ok = await login(api, E2E_SA.password);
      expect(ok.status()).toBeLessThan(300);

      // Khoá của nơi kia KHÔNG được xoá theo: người dùng thật vào được không phải bằng chứng
      // rằng kẻ đang dò đã thôi gõ.
      expect(lockRowCount()).toBe(1);
    } finally {
      await api.dispose();
    }
  });

  /**
   * VẾ ĐỐI CHỨNG: SA KHOÁ TAY vẫn chặn mọi nơi.
   *
   * Không có bài này thì một bản "bỏ hẳn mọi thứ chặn đăng nhập" cũng xanh hai bài trên — và
   * cái nút Khoá tài khoản mà SA bấm khi nghi một tài khoản bị chiếm sẽ không làm gì cả. Đó
   * đúng là lỗ đã phải vá ngày 09/09.
   */
  test('SA khoá tay thì chặn ở MỌI nơi, không liên quan tới bộ đếm theo IP', async () => {
    const api = await rawClient();
    try {
      sql(`UPDATE users SET status = 'locked' WHERE email = '${E2E_SA.email}'`);
      expect(lockRowCount()).toBe(0); // chưa gõ sai lần nào

      const res = await login(api, E2E_SA.password);
      expect(res.status()).toBe(401);
      expect(((await res.json()) as { code?: string }).code).toBe('ACCOUNT_LOCKED');
    } finally {
      await api.dispose();
    }
  });
});

/**
 * LÁ THƯ BÁO SA PHẢI NÓI ĐÚNG CHUYỆN VỪA XẢY RA.
 *
 * Từ 11/09 chạm ngưỡng KHÔNG còn khoá tài khoản, chỉ khoá nơi đang gõ. Lá thư cũ viết "vừa bị
 * khóa tạm thời" và "khóa tự mở sau thời gian cấu hình" — cả hai câu nay đều sai, và sai theo
 * hướng tệ nhất: SA đọc xong tưởng hệ thống đã tự xử lý nên không làm gì.
 *
 * Thư này giờ là thứ DUY NHẤT khiến một CON NGƯỜI nhìn thấy một lượt dò rải rác, nên nội dung
 * của nó là một phần của hàng rào, không phải chuyện chữ nghĩa.
 */
test.describe('Thư báo SA khi một tài khoản bị dò', () => {
  test('thư vẫn gửi, và KHÔNG được nói rằng tài khoản đã bị khoá', async () => {
    await clearMailbox();
    const api = await rawClient();
    try {
      for (let i = 0; i < 6; i += 1) await login(api, WRONG);
    } finally {
      await api.dispose();
    }

    const mails = await waitForMail('Dò mật khẩu');
    expect(mails.length).toBeGreaterThan(0);

    const body = await mailBody(mails[0].ID);
    // Phải nói rõ tài khoản VẪN vào được từ chỗ khác — đó là lý do SA cần đọc thư này.
    expect(body).toContain('VẪN ĐĂNG NHẬP ĐƯỢC');
    // Và phải chỉ ra việc cần làm: khoá tay là thứ chặn được mọi nơi.
    expect(body).toContain('KHÓA TAY');
    // Câu cũ, nay sai, không được còn ở đây.
    expect(body).not.toContain('Khóa tự mở sau thời gian cấu hình');
  });
});
