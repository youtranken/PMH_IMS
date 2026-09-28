import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  NEW_PASSWORD,
  fillLogin,
  firstLogin,
  freshTotpCode,
  horizontalOverflow,
  logout,
  resetUsers,
  signOutMidFlow,
  sql,
} from './helpers';

/**
 * Đăng nhập xong phải về ĐÚNG trang đã mở (AUTH-029, VLT-001, Q-14) — ở 390px, vì người duyệt
 * break-glass bấm link trong mail trên điện thoại. Và đích chỉ được là đường NỘI BỘ: đích lấy
 * từ URL người khác gửi, nên một đích dẫn ra ngoài là trang lừa đảo đứng ngay sau màn đăng nhập thật.
 */

test.beforeEach(() => {
  resetUsers();
});

/**
 * Mật khẩu + mã 2 lớp của một tài khoản đã cài xong — KHÔNG `goto('/')` để giữ đích đã nhớ.
 * Ô mã tự gửi khi đủ 6 số nên không bấm "Xác nhận".
 */
async function loginKeepingTarget(page: Page, secret: string, email = E2E_SA.email): Promise<void> {
  await fillLogin(page, email, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Xác thực 2 lớp' })).toBeVisible();
  await page.getByLabel('Mã xác thực').fill(await freshTotpCode(secret));
}

/** Phiên của một người chết ở máy chủ (hết idle, bị đá…) trong khi tab vẫn đang mở. */
function killSessions(email: string): void {
  sql(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = 'e2e-phien-chet' ` +
      `WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE email = '${email}')`,
  );
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
  // Màn đăng nhập nói TÊN MÀN sẽ mở, không in đường dẫn thô (B5).
  await expect(page.getByText('Đăng nhập để mở: Duyệt yêu cầu')).toBeVisible();
  await expect(page.getByText(/\/approvals/)).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await loginKeepingTarget(page, secret);
  await expect(page).toHaveURL((url) => url.pathname === '/approvals' && url.search === `?id=${id}`);

  // Đích chỉ dùng MỘT lần: đăng xuất rồi đăng nhập lại thì về trang chủ.
  await logout(page);
  await loginKeepingTarget(page, secret);
  await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();
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
  await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();
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

test('máy dùng chung: phiên của A chết giữa chừng → B đăng nhập thì về trang chủ, không bị kéo tới trang dở của A', async ({
  page,
}) => {
  const memberSecret = await firstLogin(page, E2E_MEMBER);
  await logout(page);
  const saSecret = await firstLogin(page, E2E_SA);

  // A (SA) đang làm dở ở màn Phần mềm thì phiên chết; ai đó F5.
  await page.goto('/software');
  await expect(page.getByRole('heading', { name: 'Phần mềm' })).toBeVisible();
  killSessions(E2E_SA.email);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);

  // B (Member) ngồi vào đăng nhập: về trang chủ của B.
  await loginKeepingTarget(page, memberSecret, E2E_MEMBER.email);
  await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  await logout(page);

  // Đường hạnh phúc: chính người có phiên chết đăng nhập lại thì về đúng trang dở.
  await loginKeepingTarget(page, saSecret);
  await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();
  await page.goto('/software');
  await expect(page.getByRole('heading', { name: 'Phần mềm' })).toBeVisible();
  killSessions(E2E_SA.email);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await loginKeepingTarget(page, saSecret);
  await expect(page).toHaveURL((url) => url.pathname === '/software');
});

test('email đăng nhập được nhớ trên máy; "Không phải tôi" xoá nó', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  await logout(page);

  await page.goto('/login');
  await expect(page.getByLabel('Email')).toHaveValue(E2E_SA.email);
  await expect(page.getByText(`Email đã nhớ trên máy này: ${E2E_SA.email}.`)).toBeVisible();
  // Email đã có thì con trỏ ở ô mật khẩu — trên điện thoại bàn phím bật đúng ô cần gõ.
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeFocused();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Không phải tôi' }).click();
  await expect(page.getByLabel('Email')).toHaveValue('');
  await page.reload();
  await expect(page.getByLabel('Email')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Không phải tôi' })).toHaveCount(0);
});

test('bấm Đăng nhập khi trống: lỗi tiếng Việt dưới từng ô, không phải bong bóng của trình duyệt', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByText('Bắt buộc — chưa nhập ô này.')).toHaveCount(2);
  await expect(page.getByLabel('Email')).toBeFocused();
});
