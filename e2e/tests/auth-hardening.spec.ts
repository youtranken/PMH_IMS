import { expect, request, test } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  logout,
  NEW_PASSWORD,
  resetUsers,
  sql,
} from './helpers';

/**
 * Siết hai cửa xác thực mà rà soát 07/09 chỉ ra là không được canh (finding #2 và #5).
 *
 * Cả hai bài đều gọi API TRỰC TIẾP, không qua trình duyệt: thứ cần chứng minh là hành vi của
 * server dưới tải song song, và mở 6 tab Chromium chỉ làm nhiễu phép đo.
 */

test.beforeEach(() => {
  resetUsers();
});

/** Client HTTP thô, không cookie chung — mỗi lượt là một "kẻ tấn công" riêng. */
async function rawClient() {
  return request.newContext({
    baseURL: APP_ORIGIN,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: APP_ORIGIN },
  });
}

function failedAttemptsOf(email: string): number {
  return Number(sql(`SELECT failed_attempts FROM users WHERE email = '${email}'`));
}

test.describe('Siết cửa xác thực', () => {
  /**
   * Finding #5 — bộ đếm sai mật khẩu là đọc-rồi-ghi NGOÀI transaction.
   *
   * `login()` đọc `user.failedAttempts` ở đầu hàm, rồi Argon2 xác minh mất ~200ms, rồi mới ghi
   * một giá trị TUYỆT ĐỐI đè lên. Bắn nhiều request song song cùng email: tất cả đọc được cùng
   * một con số cũ, tất cả tính ra cùng một giá trị mới, tất cả ghi đè nhau.
   *
   * Hệ quả: N lần đoán chỉ tốn 1 lượt đếm. NFR-01 nói sai 5 lần thì khóa — hàng rào đó gần như
   * vô hiệu trước một kẻ tấn công biết bắn song song. Repo đã làm ĐÚNG chỗ tương đương ở
   * `session.service.ts:92` (`SET stepup_failures = stepup_failures + 1`), chỉ đường login là sót.
   */
  test('đếm sai mật khẩu: sáu lượt sai đồng thời phải tính đủ SÁU, không phải một', async () => {
    const BURST = 6;
    expect(failedAttemptsOf(E2E_SA.email)).toBe(0);

    const clients = await Promise.all(Array.from({ length: BURST }, () => rawClient()));
    try {
      const responses = await Promise.all(
        clients.map((api) =>
          api.post('/api/v1/auth/login', {
            data: { email: E2E_SA.email, password: 'chac-chan-sai-#2026' },
          }),
        ),
      );
      // Mọi lượt đều phải bị từ chối — không lượt nào được lọt vì lý do gì khác.
      for (const res of responses) expect(res.status()).toBeGreaterThanOrEqual(400);

      /*
       * Đây là toàn bộ bài kiểm. Ngưỡng khóa mặc định là 5, nên sau 6 lượt sai tài khoản
       * PHẢI đã bị khóa và bộ đếm phải >= 5. Bản chưa sửa cho ra 1.
       */
      const attempts = failedAttemptsOf(E2E_SA.email);
      expect(attempts, `bộ đếm phải cộng dồn từng lượt, không ghi đè nhau`).toBeGreaterThanOrEqual(
        5,
      );

      /*
       * `users.locked_until` ĐỔI VAI từ 11/09: nó không còn chặn đăng nhập, nay là mốc CẢNH
       * BÁO (chạm ngưỡng thì bắn thư báo SA, và chính nó là cửa sổ chống spam thư). Bài này
       * vẫn đọc đúng cột đó vì thứ nó đang đo là BỘ ĐẾM CÓ CỘNG DỒN KHÔNG — câu hỏi không đổi.
       * Vế "ai bị chặn" nay do `khoa-dang-nhap-theo-noi.spec.ts` giữ.
       */
      const lockedUntil = sql(
        `SELECT coalesce(locked_until::text, '') FROM users WHERE email = '${E2E_SA.email}'`,
      );
      expect(lockedUntil, 'sáu lượt sai thì phải chạm mốc cảnh báo').not.toBe('');
    } finally {
      await Promise.all(clients.map((api) => api.dispose()));
    }
  });

  /**
   * Finding #2 — `POST /auth/login/totp` là cửa step-up THỨ HAI mà không ai canh.
   *
   * `POST /auth/step-up` có `@Throttle 10/phút`, có bộ đếm sai, và thu hồi phiên khi quá ngưỡng
   * — kèm 5 dòng chú thích giải thích vì sao. `/auth/login/totp` thì KHÔNG có gì cả: trần duy
   * nhất là throttler chung 300/phút, và vì `req.user` đã tồn tại ở route này nên 300 lượt đó
   * đổ hết vào đúng một tài khoản.
   *
   * Nặng hơn nữa: `completeTotpWithin` đóng dấu `stepped_up_at`, nên đoán trúng ở đây là được
   * cấp một phiên ĐÃ MỞ KÉT. Kẻ đã có mật khẩu (dùng lại từ nơi khác, phishing) nhưng không có
   * điện thoại chỉ cần bắn liên tục vào cửa này.
   */
  test('cửa 2FA lúc đăng nhập phải có trần riêng, không chỉ trần chung 300/phút', async ({
    page,
  }) => {
    /*
     * Phải dựng một phiên `totp-required` THẬT, không dùng được tài khoản vừa reset.
     *
     * Tài khoản mới reset chưa cài TOTP nên bước 1 trả `totp-setup`, và `/auth/login/totp` từ
     * chối ngay với 400 — bài kiểm sẽ "đỏ" mà chẳng chạm tới cái trần đang cần chứng minh.
     * (Lượt chạy đầu của tôi dính đúng chỗ này.) Nên: đi hết luồng lần đầu bằng trình duyệt để
     * cài TOTP và đổi mật khẩu, đăng xuất, rồi mới đăng nhập lại bằng API.
     */
    await firstLogin(page, E2E_SA);
    await logout(page);

    const api = await rawClient();
    try {
      const first = await api.post('/api/v1/auth/login', {
        data: { email: E2E_SA.email, password: NEW_PASSWORD },
      });
      expect(first.status()).toBe(200);
      const body = (await first.json()) as { status: string; csrfToken: string };
      expect(body.status, 'phải là phiên chờ mã TOTP thì bài kiểm mới có nghĩa').toBe(
        'totp-required',
      );

      /*
       * `/auth/login/totp` đi qua CsrfGuard nên PHẢI kèm `X-CSRF-Token`. Thiếu nó thì mọi lượt
       * trả 403 và bài kiểm vẫn "đỏ" — nhưng đỏ vì CSRF, chẳng chạm gì tới cái trần đang cần
       * chứng minh. Tôi đã dính đúng cái bẫy đó ở lượt chạy đầu.
       */
      const csrfToken = body.csrfToken;
      expect(csrfToken, 'phản hồi đăng nhập bước 1 phải kèm csrfToken').toBeTruthy();

      /*
       * Bắn mã sai liên tiếp và ĐỌC MÃ LỖI trong body, không chỉ mã HTTP.
       *
       * Hàng rào thật ở đây là THU HỒI PHIÊN sau `secret.stepup_max_failures` (mặc định 5)
       * lượt sai — cùng khuôn với `/auth/step-up`. Nó nổ TRƯỚC cái trần 10/phút vì `SessionGuard`
       * đứng đầu chuỗi guard (`app.module.ts:102`): phiên chết rồi thì request sau không đi tới
       * throttler nữa. Nên khẳng định theo mã HTTP là sai — mọi lượt đều 401, cả trước lẫn sau.
       */
      const codes: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        const res = await api.post('/api/v1/auth/login/totp', {
          headers: { 'X-CSRF-Token': csrfToken },
          data: { token: String(100000 + i) },
        });
        expect(
          res.status(),
          `403 nghĩa là chưa qua nổi CSRF/quyền — bài kiểm chưa chạm tới luồng cần kiểm`,
        ).not.toBe(403);
        codes.push(((await res.json()) as { code?: string }).code ?? String(res.status()));
        if (codes[codes.length - 1] === 'SESSION_REVOKED') break;
      }

      /*
       * Đây là toàn bộ bài kiểm: phải có lượt bị THU HỒI PHIÊN, và nó phải tới trong vòng 5
       * lượt. Bản chưa sửa cho gõ mãi không giới hạn — đã đo: 25 lượt liên tiếp đều
       * `TOTP_INVALID`, phiên chờ không bao giờ chết.
       */
      expect(
        codes,
        `phải thu hồi phiên sau khi gõ sai đủ ngưỡng. Mã lỗi: ${JSON.stringify(codes)}`,
      ).toContain('SESSION_REVOKED');
      expect(
        codes.indexOf('SESSION_REVOKED') + 1,
        `ngưỡng là secret.stepup_max_failures = 5, không được cho gõ nhiều hơn`,
      ).toBeLessThanOrEqual(5);

      // Phiên đã chết thì lượt kế tiếp không còn được vào tới bước kiểm mã nữa.
      const after = await api.post('/api/v1/auth/login/totp', {
        headers: { 'X-CSRF-Token': csrfToken },
        data: { token: '123456' },
      });
      expect(((await after.json()) as { code?: string }).code).not.toBe('TOTP_INVALID');
    } finally {
      await api.dispose();
    }
  });
});
