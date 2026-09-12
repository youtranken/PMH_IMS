import { expect, request, test } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  freshTotpCode,
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

/**
 * "ĐĂNG NHẬP LẦN CUỐI" PHẢI LÀ LÚC THẬT SỰ VÀO ĐƯỢC — vá 11/09.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `markLoginSuccess` chạy ngay sau khi Argon2 xác minh xong, tức TRƯỚC bước TOTP, và nó đóng
 * dấu `last_login_at` cùng lúc với việc xoá hai bộ đếm sai. Với tài khoản bật
 * `totp_login_required` (mặc định là mọi tài khoản), người gõ đúng mật khẩu nhưng KHÔNG có
 * điện thoại vẫn khiến cột đó nhảy sang thời điểm ấy.
 *
 * Cột này hiện thẳng trên màn Tài khoản và là thứ SA nhìn khi rà tài khoản bỏ quên hoặc khi
 * truy vết một vụ việc. Ghi sai nó là ghi sai theo hướng nguy hiểm: một kẻ có mật khẩu nhưng
 * bị chặn ở cửa TOTP để lại đúng dấu vết của một lần đăng nhập bình thường — và người đọc sổ
 * sẽ kết luận người dùng thật đã vào.
 *
 * Xoá bộ đếm thì VẪN đúng ở bước đó: chúng đếm việc đoán MẬT KHẨU, mà việc đó vừa kết thúc.
 * Nên bài dưới kiểm cả hai vế — nếu chỉ kiểm vế đầu thì một bản "bỏ hẳn cả hai việc" cũng xanh.
 */
test.describe('Dấu "đăng nhập lần cuối"', () => {
  function lastLoginAt(): string {
    return sql(
      `SELECT coalesce(last_login_at::text, '') FROM users WHERE email = '${E2E_SA.email}'`,
    );
  }

  /**
   * ĐƯỜNG THỨ BA — lần đăng nhập ĐẦU TIÊN, đi qua màn "Cài xác thực 2 lớp" (test tay 12/09).
   *
   * Hai bài dưới phủ hai đường: `login()` khi tài khoản không bắt TOTP, và `verifyLoginTotp()`
   * khi tài khoản đã cài rồi. Nhưng có BA đường kết thúc bằng một phiên đã xác thực đủ —
   * đường thứ ba là `confirmTotpEnrollment()`, lúc người dùng vừa quét QR xong. Nó cấp phiên
   * mới và ghi `auth.login.ok`, nhưng bản trước không đóng dấu `last_login_at`.
   *
   * Vì sao không bài nào bắt được: cả hai bài dưới đều mở màn bằng `firstLogin()` rồi
   * `UPDATE users SET last_login_at = NULL` để dọn nền — tức chính bước dọn đã XOÁ đúng cái
   * dấu mà đường thứ ba lẽ ra phải để lại. Bài này làm ngược: xoá TRƯỚC, rồi mới đăng nhập.
   *
   * Hậu quả của lỗ: tài khoản vừa được SA tạo, người ta đăng nhập lần đầu xong, cột "Đăng nhập
   * lần cuối" trên màn Tài khoản vẫn là "—". SA rà tài khoản bỏ quên sẽ đọc thành "người này
   * chưa từng vào" — trong khi nhật ký cùng lúc ghi họ đã vào. Hai chỗ nói ngược nhau, và cột
   * hiển thị là chỗ người ta tin.
   */
  test('lần đăng nhập ĐẦU TIÊN (qua màn cài 2 lớp) cũng phải đóng dấu', async ({ page }) => {
    /*
     * `resetUsers()` ở beforeEach gỡ TOTP và bật lại `must_change_password`, nhưng KHÔNG đụng
     * `last_login_at` — nên phải tự xoá, để mốc quan sát được chắc chắn là của lượt này.
     */
    sql(`UPDATE users SET last_login_at = NULL WHERE email = '${E2E_SA.email}'`);
    expect(lastLoginAt(), 'nền phải sạch thì quan sát sau mới có nghĩa').toBe('');

    await firstLogin(page, E2E_SA);

    expect(
      lastLoginAt(),
      'vừa đi hết ba màn và đang đứng trong app thì đó LÀ một lần đăng nhập',
    ).not.toBe('');

    /*
     * VẾ ĐỐI CHỨNG, và là vế nói đúng bản chất lỗi: hệ thống ĐÃ tự ghi nhận đây là một lần
     * đăng nhập thành công. Chốt cả hai cạnh nhau thì lần sau ai gỡ một trong hai sẽ thấy
     * ngay chúng mâu thuẫn, thay vì mâu thuẫn âm thầm suốt như vừa rồi.
     */
    expect(
      Number(
        sql(
          `SELECT count(*) FROM audit_log WHERE action = 'auth.login.ok' AND actor = '${E2E_SA.email}'`,
        ),
      ),
      'nhật ký và cột hiển thị phải nói cùng một chuyện',
    ).toBeGreaterThan(0);
  });

  test('qua mật khẩu nhưng CHƯA qua TOTP thì không được đóng dấu', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    await logout(page);

    /*
     * Nền sạch: xoá mốc do chính lượt `firstLogin` vừa đóng, và gieo sẵn 3 lượt sai để có cái
     * mà quan sát ở vế đối chứng bên dưới.
     */
    sql(
      `UPDATE users SET last_login_at = NULL, failed_attempts = 3 WHERE email = '${E2E_SA.email}'`,
    );
    expect(lastLoginAt()).toBe('');

    const api = await rawClient();
    try {
      const step1 = await api.post('/api/v1/auth/login', {
        data: { email: E2E_SA.email, password: NEW_PASSWORD },
      });
      expect(step1.status()).toBe(200);
      const body = (await step1.json()) as { status: string; csrfToken: string };
      // Bài chỉ có nghĩa khi phiên đang CHỜ mã — nếu không thì chẳng có bước nào ở giữa để hỏng.
      expect(body.status).toBe('totp-required');

      // ĐÂY LÀ CẢ BÀI: mật khẩu đúng nhưng chưa vào được, nên sổ chưa được ghi gì.
      expect(lastLoginAt()).toBe('');

      /*
       * VẾ ĐỐI CHỨNG, và nó nằm ngay đây chứ không ở bài riêng: bộ đếm sai PHẢI đã bị xoá.
       * Thiếu vế này thì một bản "dời cả hai việc xuống sau TOTP" cũng xanh — và khi đó một
       * người gõ đúng mật khẩu ở lần thứ 5 sẽ vẫn còn nguyên 5 lượt sai trên hồ sơ.
       */
      expect(Number(sql(`SELECT failed_attempts FROM users WHERE email = '${E2E_SA.email}'`))).toBe(
        0,
      );

      const step2 = await api.post('/api/v1/auth/login/totp', {
        headers: { 'X-CSRF-Token': body.csrfToken },
        data: { token: await freshTotpCode(secret) },
      });
      expect(step2.status(), '403 = chưa qua CSRF, bài kiểm chưa chạm tới luồng cần kiểm').toBe(
        200,
      );

      // Giờ mới thật sự vào được → giờ mới được đóng dấu.
      expect(lastLoginAt()).not.toBe('');
    } finally {
      await api.dispose();
    }
  });

  /**
   * VẾ ĐỐI CHỨNG THỨ HAI: tài khoản KHÔNG bắt TOTP lúc đăng nhập thì bước 1 đã là vào được,
   * và mốc phải đóng dấu ngay ở đó. Không có bài này thì một bản "chỉ đóng dấu trong
   * `verifyLoginTotp`" cũng xanh bài trên — và cả một nhóm người dùng sẽ mãi mãi hiện
   * "chưa đăng nhập lần nào".
   */
  test('tài khoản không bắt TOTP thì đóng dấu ngay ở bước mật khẩu', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await logout(page);
    sql(
      `UPDATE users SET last_login_at = NULL, totp_login_required = false WHERE email = '${E2E_SA.email}'`,
    );

    const api = await rawClient();
    try {
      const res = await api.post('/api/v1/auth/login', {
        data: { email: E2E_SA.email, password: NEW_PASSWORD },
      });
      expect(res.status()).toBe(200);
      expect(((await res.json()) as { status: string }).status).toBe('authenticated');

      expect(lastLoginAt()).not.toBe('');
    } finally {
      await api.dispose();
    }
  });
});
