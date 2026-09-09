import { expect, test } from '@playwright/test';
import { APP_ORIGIN, E2E_MEMBER, NEW_PASSWORD, fillLogin, firstLogin, freshTotpCode, logout, resetUsers } from './helpers';

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

  test('member không mở được trang nội bộ /dev/components', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    await expect(page.getByRole('link', { name: 'Bộ giao diện' })).toHaveCount(0);

    await page.goto('/dev/components');
    await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
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
});
