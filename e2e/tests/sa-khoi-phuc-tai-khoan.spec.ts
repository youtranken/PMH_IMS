import { expect, test } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  clearMailbox,
  firstLogin,
  mailBody,
  resetUsers,
  sql,
  waitForMail,
  writeHeaders,
} from './helpers';

/**
 * HAI CỬA KHÔI PHỤC TÀI KHOẢN CỦA SA — `reset-password` và `reset-totp`.
 *
 * ===== VÌ SAO BÀI NÀY RA ĐỜI =====
 *
 * Rà soát 07/09 đếm ra 12 endpoint GHI không có bài kiểm nào, và hai cửa này đứng đầu danh
 * sách. Chúng cũng nằm trong nhóm "luồng email bảo mật không có assertion nào ở hộp thư":
 * `MailConsumer` có mẫu thư cho cả hai, nhưng chưa từng có bài kiểm nào chứng minh thư THẬT
 * SỰ tới nơi. Một mẫu thư không ai kiểm là một mẫu thư có thể đã chết từ lâu mà cả bộ E2E
 * vẫn xanh — đúng chuyện đã xảy ra với phần `text` của thư (Mailpit tự suy nó ra từ HTML nên
 * bài kiểm cũ xanh dù `text` đã bị bỏ hẳn).
 *
 * Và thư ở đây KHÔNG phải chi tiết trang trí: nó là đường DUY NHẤT báo cho chủ tài khoản biết
 * có người vừa đặt lại mật khẩu / xác thực 2 lớp của họ. Nếu một tài khoản SA bị chiếm, lá thư
 * này là thứ duy nhất người dùng thật nhìn thấy.
 *
 * ===== BA ĐIỀU MỖI CỬA PHẢI GIỮ CÙNG LÚC =====
 *
 * 1. Lượt ghi có hiệu lực (mật khẩu đổi / secret TOTP bị xóa).
 * 2. Mọi phiên đang mở bị thu hồi.
 * 3. Thư tới hộp CHỦ TÀI KHOẢN — cùng một transaction đẩy outbox (AD-5).
 *
 * Bài này kiểm cả ba, vì ba thứ đó nằm trong CÙNG một transaction và giữ được hai thứ mà mất
 * thứ ba là kiểu hỏng khó thấy nhất.
 */

test.describe('SA khôi phục tài khoản người khác', () => {
  test.beforeEach(async () => {
    resetUsers();
    await clearMailbox();
  });

  /** Id của tài khoản member — lấy từ DB vì màn Tài khoản không phơi id ra DOM. */
  function memberId(): string {
    return sql(`SELECT id FROM users WHERE email = '${E2E_MEMBER.email}'`);
  }

  function sessionCount(userId: string): number {
    return Number(
      sql(`SELECT count(*) FROM sessions WHERE user_id = '${userId}' AND revoked_at IS NULL`),
    );
  }

  test('reset-password: cấp mật khẩu tạm, đá sạch phiên, và BÁO cho chủ tài khoản', async ({
    page,
    browser,
  }) => {
    const id = memberId();

    // Member đăng nhập thật để có một phiên đang sống — thứ mà lượt reset phải giết.
    const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await memberContext.newPage();
    await firstLogin(memberPage, E2E_MEMBER);
    expect(sessionCount(id)).toBeGreaterThan(0);

    await firstLogin(page, E2E_SA);
    const before = sql(`SELECT password_hash FROM users WHERE id = '${id}'`);

    const res = await page.request.post(`/api/v1/accounts/${id}/reset-password`, {
      headers: await writeHeaders(page),
    });
    expect(res.status()).toBeLessThan(300);
    const body = (await res.json()) as { temporaryPassword: string };
    // Mật khẩu tạm phải trả về cho SA đọc cho người dùng — không có nó thì cửa này vô dụng.
    expect(body.temporaryPassword.length).toBeGreaterThan(8);

    expect(
      sql(`SELECT password_hash FROM users WHERE id = '${id}'`),
      'hash phải đổi — không đổi nghĩa là cửa này không làm gì',
    ).not.toBe(before);
    expect(
      sql(`SELECT must_change_password FROM users WHERE id = '${id}'`),
      'mật khẩu tạm phải buộc đổi ở lần đăng nhập tới',
    ).toBe('t');
    expect(sessionCount(id), 'mọi phiên đang mở phải bị thu hồi').toBe(0);

    /*
     * VẾ HỘP THƯ. Đây là vế duy nhất chứng minh chủ tài khoản BIẾT chuyện vừa xảy ra — và là
     * vế đã thiếu suốt từ Epic 4.
     */
    const mails = await waitForMail('[IMS] Thay đổi mật khẩu');
    expect(mails.length, 'phải có đúng thư báo đổi mật khẩu trong hộp').toBeGreaterThan(0);
    expect(
      mails.some((mail) => mail.To.some((to) => to.Address === E2E_MEMBER.email)),
      'thư phải gửi cho CHỦ TÀI KHOẢN, không phải cho SA',
    ).toBe(true);

    const text = await mailBody(mails[0].ID);
    expect(text).toContain('SA vừa đặt lại mật khẩu');
    // NFR-04: thư báo KHÔNG được mang chính mật khẩu tạm đi qua SMTP.
    expect(text, 'mật khẩu tạm không được nằm trong thư').not.toContain(body.temporaryPassword);

    await memberContext.close();
  });

  test('reset-totp: xóa secret, đá sạch phiên, và BÁO cho chủ tài khoản', async ({
    page,
    browser,
  }) => {
    const id = memberId();

    const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await memberContext.newPage();
    await firstLogin(memberPage, E2E_MEMBER);
    expect(
      sql(`SELECT totp_secret_ct IS NOT NULL FROM users WHERE id = '${id}'`),
      'firstLogin phải cài xong TOTP, nếu không bài này không kiểm được gì',
    ).toBe('t');

    await firstLogin(page, E2E_SA);
    const res = await page.request.post(`/api/v1/accounts/${id}/reset-totp`, {
      headers: await writeHeaders(page),
    });
    expect(res.status()).toBeLessThan(300);

    expect(
      sql(`SELECT totp_secret_ct IS NULL AND totp_enrolled_at IS NULL FROM users WHERE id = '${id}'`),
      'secret và mốc enroll phải bị xóa sạch — mất điện thoại thì secret cũ vô dụng',
    ).toBe('t');
    expect(sessionCount(id), 'mọi phiên đang mở phải bị thu hồi').toBe(0);

    const mails = await waitForMail('[IMS] Đặt lại xác thực 2 lớp');
    expect(mails.length).toBeGreaterThan(0);
    expect(
      mails.some((mail) => mail.To.some((to) => to.Address === E2E_MEMBER.email)),
      'thư phải gửi cho CHỦ TÀI KHOẢN',
    ).toBe(true);

    await memberContext.close();
  });

  /**
   * Đường hỏng: chỉ SA mới mở được hai cửa này. Member tự bấm reset cho chính mình sẽ là một
   * đường vòng qua toàn bộ luật mật khẩu và 2 lớp.
   */
  test('member không mở được hai cửa này', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    const id = memberId();
    const headers = await writeHeaders(page);

    for (const path of ['reset-password', 'reset-totp']) {
      const res = await page.request.post(`/api/v1/accounts/${id}/${path}`, { headers });
      expect(res.status(), `${path} phải chặn member`).toBe(403);
    }
    // Không lượt nào được để lại hậu quả: phiên của chính member vẫn phải còn sống.
    expect(sessionCount(id)).toBeGreaterThan(0);
  });
});
