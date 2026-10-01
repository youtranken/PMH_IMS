import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  NEW_PASSWORD,
  agePendingSession,
  fillLogin,
  firstLogin,
  freshTotpCode,
  logout,
  resetUsers,
  signOutMidFlow,
} from './helpers';

/**
 * Màn nhập mã 2 lớp khi đăng nhập (Q-20): có "Quay lại", ô trống thì nhắc nhập, và phiên chờ mã
 * có hạn — tải lại trang ở bước này, hoặc để quá `auth.totp_challenge_minutes`, đều về đăng nhập.
 * Không tạo hàng dữ liệu nào (chỉ tài khoản E2E có sẵn).
 */

test.beforeEach(() => resetUsers());

const EXPIRED_NOTICE = 'Hết thời gian nhập mã, vui lòng đăng nhập lại.';

/** Tài khoản đã cài xong 2 lớp, đang đứng ở màn nhập mã. Trả secret TOTP. */
async function atChallenge(page: Page): Promise<string> {
  const secret = await firstLogin(page, E2E_SA);
  await logout(page);
  await fillLogin(page, E2E_SA.email, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Xác thực 2 lớp' })).toBeVisible();
  return secret;
}

async function pendingSessionIsDead(page: Page): Promise<void> {
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
}

test('ô trống bấm Xác nhận → "Vui lòng nhập mã xác thực."; không còn câu gợi ý dưới ô', async ({ page }) => {
  await atChallenge(page);
  await expect(page.getByText('Mã 6 số đang hiện trong ứng dụng. Nhập mã mới nhất.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByText('Vui lòng nhập mã xác thực.')).toBeVisible();
  await expect(page.getByText('Còn thiếu 6 số.')).toHaveCount(0);
});

test('"Quay lại" đóng phiên chờ ở server và về màn đăng nhập', async ({ page }) => {
  await atChallenge(page);
  await signOutMidFlow(page, 'Quay lại');
  await expect(page.getByLabel('Email')).toBeVisible();
  await pendingSessionIsDead(page);
});

test('tải lại trang ở bước nhập mã → về màn đăng nhập, báo hết thời gian, phiên chờ đã chết', async ({ page }) => {
  await atChallenge(page);
  const loggedOut = page.waitForResponse(
    (res) => res.url().includes('/api/v1/auth/logout') && res.request().method() === 'POST',
  );
  await page.reload();
  await loggedOut;
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.getByRole('status').filter({ hasText: EXPIRED_NOTICE })).toBeVisible();
  await pendingSessionIsDead(page);
});

test('đường hỏng: phiên chờ quá hạn ở server → gõ đúng mã cũng bị đưa về đăng nhập, có câu báo', async ({
  page,
}) => {
  const secret = await atChallenge(page);
  // Lùi tuổi phiên chờ 1 giờ (> 5 phút mặc định) — không ngồi đợi.
  agePendingSession(E2E_SA.email);
  await page.getByLabel('Mã xác thực').fill(await freshTotpCode(secret));
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.getByRole('status').filter({ hasText: EXPIRED_NOTICE })).toBeVisible();
  await pendingSessionIsDead(page);
});
