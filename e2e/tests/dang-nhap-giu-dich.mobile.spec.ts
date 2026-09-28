import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  NEW_PASSWORD,
  fillLogin,
  firstLogin,
  freshTotpCode,
  horizontalOverflow,
  logout,
  resetUsers,
  signOutMidFlow,
} from './helpers';

/**
 * Đăng nhập xong phải về ĐÚNG trang đã mở (AUTH-029, VLT-001, Q-14) — ở 390px, vì người duyệt
 * break-glass bấm link trong mail trên điện thoại. Và đích chỉ được là đường NỘI BỘ: đích lấy
 * từ URL người khác gửi, nên một đích dẫn ra ngoài là trang lừa đảo đứng ngay sau màn đăng nhập thật.
 */

test.beforeEach(() => {
  resetUsers();
});

/** Mật khẩu + mã 2 lớp của một tài khoản đã cài xong — KHÔNG `goto('/')` để giữ đích đã nhớ. */
async function loginKeepingTarget(page: Page, secret: string): Promise<void> {
  await fillLogin(page, E2E_SA.email, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Xác thực 2 lớp' })).toBeVisible();
  await page.getByLabel('Mã xác thực').fill(await freshTotpCode(secret));
  await page.getByRole('button', { name: 'Xác nhận' }).click();
}

test('link sâu /approvals?id=… khi chưa đăng nhập → đăng nhập + 2 lớp → về đúng /approvals?id=…', async ({
  page,
}) => {
  const secret = await firstLogin(page, E2E_SA);
  await logout(page);

  const id = '00000000-0000-4000-8000-00000000e2e1';
  await page.goto(`/approvals?id=${id}`);
  await expect(page).toHaveURL(/\/login$/);
  // Màn đăng nhập nói trước sẽ tới đâu.
  await expect(page.getByText(`Đăng nhập để mở: /approvals?id=${id}`)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await loginKeepingTarget(page, secret);
  await expect(page).toHaveURL((url) => url.pathname === '/approvals' && url.search === `?id=${id}`);

  // Đích chỉ dùng MỘT lần: đăng xuất rồi đăng nhập lại thì về trang chủ.
  await logout(page);
  await loginKeepingTarget(page, secret);
  await expect(page.getByRole('heading', { name: /Xin chào/ })).toBeVisible();
});

test('đích độc //evil.com bị bỏ — đăng nhập xong vẫn ở lại miền của IMS', async ({ page }) => {
  const secret = await firstLogin(page, E2E_SA);
  await logout(page);

  // Đường có hai dấu "/" đầu, ngay trên miền của IMS: trình duyệt hiểu "//evil.com" là miền khác.
  await page.goto(`${APP_ORIGIN}//evil.com`);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/Đăng nhập để mở/)).toHaveCount(0);

  // Kho bị sửa tay (XSS ở chỗ khác, extension…) cũng không đưa được ra ngoài.
  await page.evaluate(() => sessionStorage.setItem('ims_next_path', '//evil.com/approvals'));
  await loginKeepingTarget(page, secret);
  await expect(page.getByRole('heading', { name: /Xin chào/ })).toBeVisible();
  expect(new URL(page.url()).origin).toBe(new URL(APP_ORIGIN).origin);
  expect(new URL(page.url()).pathname).toBe('/');
});

test('đang ở màn mã 2 lớp: thấy email đang đăng nhập và thoát ra được bằng "Đăng xuất"', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  await logout(page);

  await fillLogin(page, E2E_SA.email, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Xác thực 2 lớp' })).toBeVisible();
  await expect(page.getByText(`Đang đăng nhập: ${E2E_SA.email}`)).toBeVisible();
  await expect(page.getByText(`Không phải ${E2E_SA.email}?`)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await signOutMidFlow(page);
  await expect(page.getByLabel('Email')).toBeVisible();
  // Phiên dở đã chết thật ở máy chủ, không chỉ là đổi màn.
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
});

test('"Không lấy được mã?" hiện hướng dẫn và câu liên hệ từ tham số hệ thống', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  await logout(page);
  await fillLogin(page, E2E_SA.email, NEW_PASSWORD);
  await page.getByRole('button', { name: 'Không lấy được mã?' }).click();
  const help = page.getByRole('region', { name: 'Không lấy được mã?' });
  await expect(help.getByText(/đặt lại xác thực 2 lớp cho bạn/)).toBeVisible();
  await expect(help.getByText(/Liên hệ:/)).toBeVisible();
});

test('màn đăng nhập: "Quên mật khẩu?" chỉ đường, không có luồng tự đặt lại qua mail', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Quên mật khẩu?' }).click();
  const help = page.getByRole('region', { name: 'Quên mật khẩu?' });
  await expect(help.getByText(/Super Admin sẽ cấp cho bạn một mật khẩu tạm/)).toBeVisible();
  await expect(help.getByText(/Liên hệ:/)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  // Route công khai chỉ trả đúng một khoá.
  const res = await page.request.get('/api/v1/auth/support-contact');
  expect(res.status()).toBe(200);
  expect(Object.keys((await res.json()) as object)).toEqual(['contact']);
});
