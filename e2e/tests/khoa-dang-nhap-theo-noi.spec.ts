import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  NEW_PASSWORD,
  clearMailbox,
  firstLogin,
  freshTotpCode,
  logout,
  mailBody,
  resetUsers,
  sql,
  waitForMail,
} from './helpers';

/**
 * Chặn đăng nhập hai tầng (NFR-01, `docs/QUYET-DINH.md` Q-06):
 *   · theo cặp (người dùng, IP) — chặn nơi đang đoán;
 *   · theo TÀI KHOẢN, chậm dần 5 → 15 → 30 → 60 phút — thấy kẻ dò đổi IP (SEC-03), và đếm cả
 *     lượt sai mã TOTP lúc đăng nhập (SEC-02).
 *
 * Playwright chạy trên một máy nên không tự khai IP khác được (nginx nối thêm địa chỉ socket
 * thật vào X-Forwarded-For). Tình huống "nơi khác" dựng bằng cách dời hàng khoá sang IP khác.
 */

const WRONG = 'chac-chan-sai-#2026';

function userColumn(email: string, column: 'failed_attempts' | 'locked_until'): string {
  return sql(`SELECT coalesce(${column}::text, '') FROM users WHERE email = '${email}'`);
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

function login(api: APIRequestContext, email: string, password: string) {
  return api.post('/api/v1/auth/login', { data: { email, password } });
}

async function codeOf(res: { json: () => Promise<unknown> }): Promise<string | undefined> {
  return ((await res.json()) as { code?: string }).code;
}

test.beforeEach(() => {
  resetUsers();
});

test.describe('Chặn đăng nhập theo nơi và theo tài khoản', () => {
  test('gõ sai đủ ngưỡng thì bị chặn — kể cả khi sau đó gõ ĐÚNG', async () => {
    const api = await rawClient();
    try {
      for (let i = 0; i < 5; i += 1) {
        expect((await login(api, E2E_SA.email, WRONG)).status()).toBe(401);
      }
      const blocked = await login(api, E2E_SA.email, E2E_SA.password);
      expect(blocked.status()).toBe(401);
      expect(await codeOf(blocked)).toBe('ACCOUNT_LOCKED');
      expect(lockRowCount()).toBe(1);
    } finally {
      await api.dispose();
    }
  });

  test('SEC-03: đổi nơi cũng không thoát — tài khoản chờ bậc đầu ở MỌI nơi', async () => {
    const api = await rawClient();
    try {
      for (let i = 0; i < 5; i += 1) await login(api, E2E_SA.email, WRONG);

      // Kẻ dò chuyển sang IP khác: dời hàng khoá theo IP đi, chỉ còn chặn theo tài khoản.
      sql(
        `UPDATE login_failure SET ip = '203.0.113.77' WHERE user_id = (SELECT id FROM users WHERE email = '${E2E_SA.email}')`,
      );
      const blocked = await login(api, E2E_SA.email, E2E_SA.password);
      expect(blocked.status()).toBe(401);
      const body = (await blocked.json()) as { code?: string; retryAfterSeconds?: number };
      expect(body.code).toBe('ACCOUNT_LOCKED');
      expect(body.retryAfterSeconds).toBeGreaterThan(0);
      expect(body.retryAfterSeconds).toBeLessThanOrEqual(5 * 60);

      // Hết bậc chờ thì vào lại được; bộ đếm không tự về 0 (5 lần sai kế sẽ lên bậc thứ hai).
      sql(`UPDATE users SET locked_until = now() - interval '1 second' WHERE email = '${E2E_SA.email}'`);
      const ok = await login(api, E2E_SA.email, E2E_SA.password);
      expect(ok.status()).toBeLessThan(300);
      // Còn bước TOTP (cài hoặc nhập mã) nên CHƯA xoá bộ đếm theo tài khoản (SEC-02).
      expect(userColumn(E2E_SA.email, 'failed_attempts')).toBe('5');
      // Khoá của nơi kia vẫn nguyên.
      expect(lockRowCount()).toBe(1);
    } finally {
      await api.dispose();
    }
  });

  test('SEC-02: đúng mật khẩu rồi đoán sai mã TOTP cũng bị đếm — đăng nhập lại bị chặn', async ({
    page,
  }) => {
    const secret = await firstLogin(page, E2E_MEMBER);
    await logout(page);
    await clearMailbox();

    const api = await rawClient();
    try {
      const first = await login(api, E2E_MEMBER.email, NEW_PASSWORD);
      expect(first.status()).toBe(200);
      const { csrfToken } = (await first.json()) as { csrfToken: string };

      // Một mã chắc chắn sai: lệch mã thật một đơn vị.
      const real = Number(await freshTotpCode(secret));
      const wrong = String((real + 1) % 1_000_000).padStart(6, '0');
      let last = await api.post('/api/v1/auth/login/totp', {
        headers: { 'X-CSRF-Token': csrfToken },
        data: { token: wrong },
      });
      for (let i = 1; i < 5; i += 1) {
        last = await api.post('/api/v1/auth/login/totp', {
          headers: { 'X-CSRF-Token': csrfToken },
          data: { token: wrong },
        });
      }
      expect(await codeOf(last)).toBe('SESSION_REVOKED');

      // Bản cũ xoá bộ đếm khi mật khẩu đúng, nên vòng "đăng nhập → đoán 5 mã" lặp được mãi.
      const again = await login(api, E2E_MEMBER.email, NEW_PASSWORD);
      expect(again.status()).toBe(401);
      expect(await codeOf(again)).toBe('ACCOUNT_LOCKED');

      // Chủ tài khoản nhận thư, và thư nói đúng việc đã xảy ra.
      const mails = await waitForMail('Tạm chặn đăng nhập');
      expect(mails[0].To.map((t) => t.Address)).toContain(E2E_MEMBER.email);
    } finally {
      await api.dispose();
    }
  });

  test('SA khoá tay thì chặn ở MỌI nơi, không liên quan tới bộ đếm', async () => {
    const api = await rawClient();
    try {
      sql(`UPDATE users SET status = 'locked' WHERE email = '${E2E_SA.email}'`);
      expect(lockRowCount()).toBe(0);

      const res = await login(api, E2E_SA.email, E2E_SA.password);
      expect(res.status()).toBe(401);
      expect(await codeOf(res)).toBe('ACCOUNT_LOCKED');
    } finally {
      await api.dispose();
    }
  });
});

test.describe('Thư báo khi một tài khoản bị đoán mật khẩu', () => {
  test('thư nói rõ tài khoản đang bị TẠM CHẶN và chỉ việc cần làm', async () => {
    await clearMailbox();
    const api = await rawClient();
    try {
      for (let i = 0; i < 5; i += 1) await login(api, E2E_SA.email, WRONG);
    } finally {
      await api.dispose();
    }

    const mails = await waitForMail('Tạm chặn đăng nhập');
    expect(mails.length).toBeGreaterThan(0);
    const body = await mailBody(mails[0].ID);
    expect(body).toContain('tạm chặn đăng nhập');
    expect(body).toContain('khóa tay');
    // Câu của luật cũ (chỉ chặn theo nơi), nay sai, không được còn.
    expect(body).not.toContain('VẪN ĐĂNG NHẬP ĐƯỢC');
  });
});
