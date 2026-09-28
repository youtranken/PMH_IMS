import { expect, test, type Page } from '@playwright/test';
import {
  agePendingSession,
  APP_ORIGIN,
  clearMailbox,
  configNumber,
  countAuditByActor,
  E2E_SA,
  firstLogin,
  freshTotpCode,
  resetUsers,
  waitForMail,
  writeHeaders,
} from './helpers';

/**
 * A-02 (rà soát 19/09): GẮN yếu tố thứ hai mà không phải chứng minh lại mình là ai.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `POST /auth/totp/enroll` chỉ đòi một phiên đã đăng nhập. Với một tài khoản CHƯA cài 2 lớp,
 * cái cookie phiên vì thế là đủ để:
 *
 *   1. `POST /auth/totp/enroll`        → server trả secret base32 nguyên văn;
 *   2. tự sinh mã 6 số từ secret đó    → `POST /auth/totp/enroll/confirm`;
 *   3. `POST /auth/step-up`            → đóng dấu `stepped_up_at`;
 *   4. `POST /vault/secrets/:id/reveal` → plaintext.
 *
 * Kẻ trộm cookie tự gắn authenticator CỦA CHÍNH NÓ rồi đi qua cửa két — cửa được dựng để
 * "kể cả root cũng phải gõ mã". Đây đúng là bước 4 trong chuỗi mà docblock của
 * `step-up.guard.ts` tự viết ra, và là bước duy nhất trong chuỗi đó chưa ai đóng.
 *
 * ===== HÀNG RÀO, VÀ VÌ SAO NÓ CÓ MỘT NGOẠI LỆ =====
 *
 * Bản vá đòi mật khẩu hiện tại — trừ khi phiên còn cờ `totp_pending`, tức đang ở GIỮA luồng
 * đăng nhập bắt buộc cài 2 lớp. Ở đó mật khẩu vừa được chứng minh vài giây trước để tạo ra
 * chính phiên này, và phiên đó chưa mở được gì ngoài ba route của luồng đăng nhập. Bắt gõ
 * lại mật khẩu ngay sau màn đăng nhập là ma sát không đổi lấy được gì.
 *
 * Ngoại lệ ấy có HẠN: `totp.enroll_reauth_minutes`. Một phiên chờ bị bỏ quên trên máy bỏ ngỏ
 * không được là cửa mở vĩnh viễn.
 *
 * Bài này canh cả hai vế — cửa đóng với phiên đã đăng nhập thường, và cửa vẫn mở tự nhiên
 * cho người đang cài lần đầu (vế thứ hai là thứ 400+ bài E2E khác đi qua mỗi lượt chạy).
 */

test.beforeEach(() => resetUsers());

interface NewAccount {
  email: string;
  password: string;
}

/**
 * Tạo một tài khoản chưa từng cài 2 lớp. Mặc định KHÔNG bắt 2 lớp lúc đăng nhập — đó là
 * hình dạng nạn nhân của A-02: phiên đăng nhập bình thường, đầy đủ quyền, chưa có yếu tố
 * thứ hai nào.
 */
async function accountWithoutTotp(
  page: Page,
  opts: { totpLoginRequired?: boolean } = {},
): Promise<NewAccount> {
  const email = `e2e-tao-moi-enroll-${Date.now()}@pmh.com.vn`;
  const res = await page.request.post('/api/v1/accounts', {
    headers: await writeHeaders(page),
    data: {
      email,
      fullName: 'Nguoi chua cai 2 lop',
      role: 'member',
      totpLoginRequired: opts.totpLoginRequired ?? false,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { temporaryPassword: string };
  return { email, password: body.temporaryPassword };
}

/** Đăng nhập bằng API trong CHÍNH context này — cookie phiên bị thay, SA lùi ra. */
async function loginAs(page: Page, account: NewAccount): Promise<void> {
  const res = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: APP_ORIGIN },
    data: { email: account.email, password: account.password },
  });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()) as { status: string }).toMatchObject({ status: 'authenticated' });
}

test.describe('Gắn yếu tố thứ hai phải chứng minh lại mình là ai', () => {
  test('phiên đã đăng nhập nhưng chưa cài 2 lớp: không có mật khẩu thì không có secret', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const victim = await accountWithoutTotp(page);
    await loginAs(page, victim);

    // Đúng thứ kẻ trộm cookie gửi: một request rỗng, không biết mật khẩu của nạn nhân.
    const bare = await page.request.post('/api/v1/auth/totp/enroll', {
      headers: await writeHeaders(page),
      data: {},
    });
    expect(bare.status()).toBe(401);
    const bareBody = (await bare.json()) as { code: string; secret?: string };
    expect(bareBody.code).toBe('REAUTH_REQUIRED');
    expect(bareBody.secret, 'lượt bị từ chối không được rò secret').toBeUndefined();

    const wrong = await page.request.post('/api/v1/auth/totp/enroll', {
      headers: await writeHeaders(page),
      data: { currentPassword: 'Sai#MatKhau#2026' },
    });
    expect(wrong.status()).toBe(401);
    const wrongBody = (await wrong.json()) as { code: string; secret?: string };
    expect(wrongBody.code).toBe('CURRENT_PASSWORD_WRONG');
    expect(wrongBody.secret, 'đoán sai mật khẩu cũng không được rò secret').toBeUndefined();

    // Và vế còn lại: đúng mật khẩu thì vẫn cài được, không phải bịt luôn cả đường đúng.
    const ok = await page.request.post('/api/v1/auth/totp/enroll', {
      headers: await writeHeaders(page),
      data: { currentPassword: victim.password },
    });
    expect(ok.status(), await ok.text()).toBe(200);
    const secret = ((await ok.json()) as { secret: string }).secret;
    expect(secret.length).toBeGreaterThan(15);

    const confirmed = await page.request.post('/api/v1/auth/totp/enroll/confirm', {
      headers: await writeHeaders(page),
      data: { token: await freshTotpCode(secret) },
    });
    expect(confirmed.status(), await confirmed.text()).toBe(200);
  });

  test('đoán mật khẩu ở cửa này: chuông kêu, rồi cái cookie chết hẳn', async ({ page }) => {
    /*
     * Chặn mà KHÔNG kêu là nửa hàng rào, và chỉ làm-chậm cũng vậy.
     *
     * `SecurityProbeService` (0046) đã có sẵn bộ đếm lẫn đường gửi thư; việc của A-02 là ĐĂNG
     * KÝ cửa mới vào `PROBE_ACTIONS` — đếm CHUNG với lượt gõ sai mã ở cửa két, vì tách hai bộ
     * đếm thì kẻ khôn ngoan chỉ cần xen kẽ hai kiểu là không chạm ngưỡng nào cả.
     *
     * Hàng rào thứ hai mới là cái đóng cửa: sai đủ `secret.stepup_max_failures` lần thì THU
     * HỒI PHIÊN, dùng lại nguyên bộ đếm của cửa két. Một trần theo phút chỉ làm kẻ tấn công
     * chậm lại; thu hồi phiên thì cái cookie trộm được CHẾT, và muốn cookie mới thì phải có
     * đúng thứ nó đang đi đoán.
     *
     * Bài đi hết năm lượt nên nó vượt qua cả hai ngưỡng (cảnh báo 3, thu hồi 5) trong một
     * mạch — đúng thứ tự mà một kẻ tấn công thật sẽ chạm vào.
     */
    await firstLogin(page, E2E_SA);
    const victim = await accountWithoutTotp(page);
    await loginAs(page, victim);
    await clearMailbox();

    // Đọc từ `system_config`, không viết cứng: DoD gạch 8 áp cho cả bài kiểm (sửa 21/09).
    const maxFailures = configNumber('secret.stepup_max_failures');
    for (let i = 1; i <= maxFailures; i += 1) {
      const wrong = await page.request.post('/api/v1/auth/totp/enroll', {
        headers: await writeHeaders(page),
        data: { currentPassword: `Sai#MatKhau#${i}` },
      });
      expect(wrong.status()).toBe(401);
      const body = (await wrong.json()) as { code: string; attemptsLeft?: number };
      if (i < maxFailures) {
        expect(body.code).toBe('CURRENT_PASSWORD_WRONG');
        expect(body.attemptsLeft, 'người gõ nhầm phải biết còn mấy lần').toBe(maxFailures - i);
      } else {
        expect(body.code).toBe('SESSION_REVOKED');
      }
    }

    expect(
      countAuditByActor('auth.totp.enroll.reauth_failed', victim.email),
      'mỗi lượt đoán sai phải để lại đúng MỘT dòng vết',
    ).toBe(maxFailures);
    expect(
      countAuditByActor('auth.totp.enroll.session_revoked', victim.email),
      'và lượt thu hồi phải có vết riêng — phiên chết mà không ai biết vì sao là tệ hơn',
    ).toBe(1);

    // Vế quan trọng nhất: cookie đã chết THẬT, không chỉ có một câu lỗi đẹp.
    const after = await page.request.get('/api/v1/auth/me');
    expect(after.status(), 'phiên bị thu hồi thì mọi request sau đều hỏng').toBe(401);

    const mails = await waitForMail('lượt thất bại quanh két');
    expect(mails.length, 'đủ ngưỡng thì phải có thư cảnh báo ĐI THẬT').toBeGreaterThanOrEqual(1);
  });

  /*
   * ===== GÕ ĐÚNG THÌ BỘ ĐẾM PHẢI VỀ 0 =====
   *
   * Cửa này dùng CHUNG cột `sessions.stepup_failures` với cửa két và cửa nhập mã lúc đăng
   * nhập — cố ý, vì ba cửa hỏi cùng một câu ("chứng minh lại đi") nên năm lần sai xen kẽ ba
   * cửa phải chết y như năm lần sai ở một cửa.
   *
   * Nhưng dùng chung thì phải dùng chung CẢ HAI CHIỀU. Cửa két xoá bộ đếm khi gõ đúng
   * (`markSteppedUpWithin`); cửa này ở bản đầu chỉ biết CỘNG. Hệ quả: người gõ nhầm mật khẩu
   * bốn lần rồi gõ đúng vẫn mang `stepup_failures = 4` suốt đời phiên, và lần gõ hụt mã đầu
   * tiên sau đó thu hồi phiên kèm câu "Gõ sai mã 5 lần" — một câu nói sai sự thật với người
   * vừa sai đúng một lần.
   *
   * Docblock của `registerStepUpFailure` viết "số lần sai LIÊN TIẾP". Bản đầu không liên
   * tiếp; nó tích luỹ vĩnh viễn. Bài này canh đúng chữ "liên tiếp" đó.
   *
   * KHÔNG dùng `markSteppedUpWithin` để xoá: hàm đó còn đóng dấu `stepped_up_at`, tức gõ
   * đúng mật khẩu ở cửa cài 2 lớp sẽ mở luôn cửa KÉT. Hai cửa chia nhau bộ đếm, không chia
   * nhau quyền.
   */
  test('gõ đúng mật khẩu thì bộ đếm về 0 — "liên tiếp" phải đúng nghĩa liên tiếp', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const victim = await accountWithoutTotp(page);
    await loginAs(page, victim);

    const maxFailures = configNumber('secret.stepup_max_failures');

    // Sai tới sát ngưỡng, còn đúng MỘT lần nữa là mất phiên.
    for (let i = 1; i < maxFailures; i += 1) {
      const wrong = await page.request.post('/api/v1/auth/totp/enroll', {
        headers: await writeHeaders(page),
        data: { currentPassword: `Sai#MatKhau#${i}` },
      });
      expect(wrong.status()).toBe(401);
      expect((await wrong.json()) as { code: string }).toMatchObject({
        code: 'CURRENT_PASSWORD_WRONG',
      });
    }

    // Rồi nhớ ra mật khẩu.
    const ok = await page.request.post('/api/v1/auth/totp/enroll', {
      headers: await writeHeaders(page),
      data: { currentPassword: victim.password },
    });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ok.json()) as { secret: string }).toHaveProperty('secret');

    /*
     * Vế canh: một lượt sai SAU đó phải là lượt sai THỨ NHẤT, không phải thứ năm.
     *
     * Chốt bằng `attemptsLeft` chứ không chỉ bằng "phiên còn sống": bản hỏng trả
     * `SESSION_REVOKED` ngay ở đây, nhưng một bản hỏng NỬA VỜI (xoá bộ đếm sai chỗ) vẫn có
     * thể cho phiên sống mà con số đếm còn bẩn. Con số mới là thứ người dùng đọc.
     */
    const again = await page.request.post('/api/v1/auth/totp/enroll', {
      headers: await writeHeaders(page),
      data: { currentPassword: 'Sai#MatKhau#sau-khi-go-dung' },
    });
    expect(again.status()).toBe(401);
    const body = (await again.json()) as { code: string; attemptsLeft?: number };
    expect(body.code, 'gõ đúng rồi thì lượt sai kế tiếp không được là giọt nước tràn ly').toBe(
      'CURRENT_PASSWORD_WRONG',
    );
    expect(body.attemptsLeft, 'bộ đếm phải đếm lại từ đầu').toBe(maxFailures - 1);

    // Và cookie vẫn sống — vế mà người dùng thật cảm nhận được.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status(), 'không ai được mất phiên vì một lần gõ nhầm').toBe(200);
  });

  test('phiên chờ bị bỏ quên hết quyền miễn — cửa sổ có HẠN, không phải mở vĩnh viễn', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    // Mặc định `totpLoginRequired: true` → đăng nhập xong là một phiên CÒN CHỜ, đúng hình
    // dạng người đang đứng giữa luồng cài 2 lớp bắt buộc.
    const pending = await accountWithoutTotp(page, { totpLoginRequired: true });

    const login = await page.request.post('/api/v1/auth/login', {
      headers: { Origin: APP_ORIGIN },
      data: { email: pending.email, password: pending.password },
    });
    expect(login.status(), await login.text()).toBe(200);
    expect((await login.json()) as { status: string }).toMatchObject({
      status: 'totp-enroll-required',
    });

    // Còn trẻ: được miễn, đúng như luồng thật.
    const fresh = await page.request.post('/api/v1/auth/totp/enroll', {
      headers: await writeHeaders(page),
      data: {},
    });
    expect(fresh.status(), await fresh.text()).toBe(200);

    // Cùng cái cookie ấy, một giờ sau — người dùng đã đứng dậy đi họp và để máy mở.
    agePendingSession(pending.email);
    const stale = await page.request.post('/api/v1/auth/totp/enroll', {
      headers: await writeHeaders(page),
      data: {},
    });
    expect(stale.status()).toBe(401);
    expect((await stale.json()) as { code: string }).toMatchObject({ code: 'REAUTH_REQUIRED' });

    // Và người thật quay lại bàn vẫn đi tiếp được — chỉ gõ thêm mật khẩu.
    const resumed = await page.request.post('/api/v1/auth/totp/enroll', {
      headers: await writeHeaders(page),
      data: { currentPassword: pending.password },
    });
    expect(resumed.status(), await resumed.text()).toBe(200);
  });

  test('luồng đăng nhập bắt buộc cài 2 lớp không bị hỏi mật khẩu lần hai', async ({ page }) => {
    /*
     * `firstLogin` đi qua đúng màn hình thật: nhập mật khẩu → màn cài 2 lớp hiện QR ngay.
     * Nếu bản vá quên ngoại lệ `totp_pending` thì màn này không lấy được secret và bài đỏ
     * ở dòng đầu tiên — cùng chỗ mà 400+ bài E2E khác sẽ đỏ.
     */
    const secret = await firstLogin(page, E2E_SA);
    expect(secret.length).toBeGreaterThan(15);
    await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();
  });
});
