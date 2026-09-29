import { expect, request, test } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  NEW_PASSWORD,
  fillLogin,
  firstLogin,
  freshTotpCode,
  logout,
  resetUsers,
  sql,
} from './helpers';

test.beforeEach(() => resetUsers());

/**
 * Kịch bản tấn công — mỗi test ở đây tương ứng một finding của code review.
 * Đỏ ở đây nghĩa là một hàng rào an ninh đã bị gỡ mất.
 */
test.describe('Hàng rào an ninh', () => {
  test('không đi vòng qua chống-replay bằng đường enroll (tài khoản đã cài 2 lớp)', async ({
    page,
  }) => {
    const secret = await firstLogin(page, E2E_MEMBER);
    const usedCode = await freshTotpCode(secret);

    // Đăng nhập lại tới bước chờ TOTP rồi thử "enroll lại" bằng một mã bất kỳ.
    await logout(page);
    await fillLogin(page, E2E_MEMBER.email, NEW_PASSWORD);
    await expect(page.getByRole('heading', { name: 'Xác thực 2 lớp' })).toBeVisible();

    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });

    const response = await page.request.post('/api/v1/auth/totp/enroll/confirm', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { token: usedCode },
    });

    // Phải bị chặn vì tài khoản ĐÃ enroll — không được cấp phiên đã xác thực qua đường này.
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'TOTP_ALREADY_ENROLLED' });
  });

  test('mã phiên đọc được trong nhật ký audit không dùng làm cookie được (SEC-01)', async ({
    page,
    request,
  }) => {
    await firstLogin(page, E2E_MEMBER);
    const sessionIdInAudit = sql(
      `SELECT object_id FROM audit_log WHERE action = 'auth.login.ok' ` +
        `AND actor = '${E2E_MEMBER.email}' ORDER BY created_at DESC LIMIT 1`,
    ).trim();
    expect(sessionIdInAudit).toMatch(/^[0-9a-f-]{36}$/);

    const cookies = await page.context().cookies();
    const real = cookies.find((c) => c.name === 'ims_session');
    expect(real?.value).toBeTruthy();
    expect(real?.value).not.toBe(sessionIdInAudit);

    const forged = await request.get('/api/v1/auth/me', {
      headers: { Cookie: `ims_session=${sessionIdInAudit}` },
    });
    expect(forged.status()).toBe(401);

    const genuine = await request.get('/api/v1/auth/me', {
      headers: { Cookie: `ims_session=${real!.value}` },
    });
    expect(genuine.status()).toBe(200);
  });

  test('đoán mật khẩu hiện tại ở cửa Đổi mật khẩu: đủ ngưỡng thì phiên chết (SEC-06)', async ({
    page,
  }) => {
    await firstLogin(page, E2E_MEMBER);
    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const guess = () =>
      page.request.post('/api/v1/auth/change-password', {
        headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
        data: { currentPassword: 'doan-sai-#2026', newPassword: 'Ims#MoiHoanToan2026!' },
      });

    const first = await guess();
    expect(first.status()).toBe(401);
    expect(await first.json()).toMatchObject({ code: 'CURRENT_PASSWORD_WRONG', attemptsLeft: 4 });
    for (let i = 0; i < 3; i += 1) await guess();
    const fifth = await guess();
    expect(await fifth.json()).toMatchObject({ code: 'SESSION_REVOKED' });

    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(401);
  });

  test('member không mở được trang nội bộ /dev/components', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    await expect(page.getByRole('link', { name: 'Bộ giao diện' })).toHaveCount(0);

    await page.goto('/dev/components');
    await expect(page.getByRole('heading', { name: 'Bạn không có quyền xem trang này' })).toBeVisible();
  });

  test('thao tác ghi thiếu CSRF token bị từ chối', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    const response = await page.request.post('/api/v1/auth/logout', {
      headers: { Origin: APP_ORIGIN },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'CSRF_TOKEN_INVALID' });
  });

  test('thao tác ghi từ nguồn lạ (Origin sai) bị từ chối', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const response = await page.request.post('/api/v1/auth/logout', {
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://ke-tan-cong.example' },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'ORIGIN_MISMATCH' });
  });

  /*
   * Login-CSRF (SEC-11): trang lạ tự POST form đăng nhập bằng tài khoản CỦA KẺ TẤN CÔNG, nạn nhân
   * bị đăng nhập vào đó mà không biết. Trình duyệt cũ không gửi `Origin` cho form cùng-trang-khác-
   * gốc, nên thiếu Origin không được là "cho qua". Email ở đây không tồn tại: nếu hàng rào hỏng thì
   * API trả 401 (đã vào tới bước kiểm mật khẩu) thay vì 403.
   */
  test('đăng nhập từ trang lạ không có Origin bị chặn trước khi kiểm mật khẩu (SEC-11)', async () => {
    const ghost = { email: 'e2e-login-csrf@pmh.com.vn', password: 'khong-quan-trong-#2026' };
    const cases: { headers: Record<string, string>; code: string }[] = [
      { headers: { 'Sec-Fetch-Site': 'cross-site' }, code: 'ORIGIN_MISMATCH' },
      { headers: { Referer: 'https://ke-tan-cong.example/dang-nhap' }, code: 'ORIGIN_MISMATCH' },
      { headers: {}, code: 'ORIGIN_MISSING' },
    ];
    for (const { headers, code } of cases) {
      const api = await request.newContext({
        baseURL: APP_ORIGIN,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: headers,
      });
      try {
        const res = await api.post('/api/v1/auth/login', { data: ghost });
        expect(res.status(), JSON.stringify(headers)).toBe(403);
        expect(await res.json()).toMatchObject({ code });
      } finally {
        await api.dispose();
      }
    }

    // Đối chứng: cùng request, cùng gốc thì đi tiếp tới bước kiểm mật khẩu.
    const same = await request.newContext({
      baseURL: APP_ORIGIN,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'Sec-Fetch-Site': 'same-origin' },
    });
    try {
      const res = await same.post('/api/v1/auth/login', { data: ghost });
      expect(res.status()).toBe(401);
    } finally {
      await same.dispose();
    }
  });
});
