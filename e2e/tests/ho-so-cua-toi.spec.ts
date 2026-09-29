import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  E2E_SA,
  NEW_PASSWORD,
  SECOND_BROWSER,
  confirmAction,
  expireStepUp,
  firstLogin,
  freshTotpCode,
  loginWithTotp,
  resetUsers,
  sql,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Hồ sơ của tôi (AUTH-030, SHELL-001, Q-14): tự đổi mật khẩu, tự cài lại 2 lớp (phải có mã của
 * điện thoại hiện tại), tự đóng phiên khác của chính mình.
 *
 * Mỗi bài dùng một tài khoản MỚI (`e2e-tao-moi-hoso-…@`) — đổi mật khẩu và thay 2 lớp của tài
 * khoản E2E dùng chung là phá mọi bài chạy song song.
 */

test.beforeEach(() => {
  resetUsers();
});

interface Person {
  email: string;
  password: string;
  secret: string;
}

/** SA tạo một tài khoản mới; người đó đăng nhập lần đầu trong một trình duyệt riêng. */
async function newPerson(page: Page, browser: Browser): Promise<{ person: Person; own: Page }> {
  await firstLogin(page, E2E_SA);
  const email = `e2e-tao-moi-hoso-${uniqueStamp()}@pmh.com.vn`;
  const res = await page.request.post('/api/v1/accounts', {
    headers: await writeHeaders(page),
    data: { email, fullName: 'E2E Ho So', role: 'member' },
  });
  expect(res.status(), 'SA tạo tài khoản thử').toBe(201);
  const { temporaryPassword } = (await res.json()) as { temporaryPassword: string };
  const ctx = await browser.newContext(SECOND_BROWSER);
  const own = await ctx.newPage();
  const secret = await firstLogin(own, { email, password: temporaryPassword });
  return { person: { email, password: NEW_PASSWORD, secret }, own };
}

async function openProfileFromMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Menu tài khoản của / }).click();
  await page.getByRole('menuitem', { name: 'Hồ sơ của tôi' }).click();
  await expect(page.getByRole('heading', { name: 'Hồ sơ của tôi', level: 1 })).toBeVisible();
}

test('menu tài khoản → Hồ sơ: thông tin, trạng thái 2 lớp, phiên của tôi', async ({ page, browser }) => {
  const { person, own } = await newPerson(page, browser);
  await openProfileFromMenu(own);
  await expect(own.getByText(person.email)).toBeVisible();
  await expect(own.getByTestId('profile-totp-status')).toHaveText(/Đã bật từ/);
  await expect(own.getByText('Máy này')).toBeVisible();
  await own.context().close();
});

test('đổi mật khẩu thành công từ Hồ sơ; sai mật khẩu hiện tại thì báo tại chỗ', async ({
  page,
  browser,
}) => {
  const { person, own } = await newPerson(page, browser);
  await own.getByRole('button', { name: /^Menu tài khoản của / }).click();
  await own.getByRole('menuitem', { name: 'Đổi mật khẩu' }).click();
  const dialog = own.getByRole('dialog', { name: 'Đổi mật khẩu' });
  await expect(dialog).toBeVisible();

  // Đường hỏng: sai mật khẩu hiện tại.
  await dialog.getByLabel('Mật khẩu hiện tại').fill('Sai#MatKhau2026');
  await dialog.getByLabel('Mật khẩu mới', { exact: true }).fill('Ims#Moi2026!doi');
  await dialog.getByLabel('Nhập lại mật khẩu mới').fill('Ims#Moi2026!doi');
  await dialog.getByRole('button', { name: 'Đổi mật khẩu' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Mật khẩu hiện tại không đúng');

  // Đường đúng.
  await dialog.getByLabel('Mật khẩu hiện tại').fill(person.password);
  await dialog.getByRole('button', { name: 'Đổi mật khẩu' }).click();
  await expect(own.getByText('Đã đổi mật khẩu. Các máy khác đã bị đăng xuất.')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await own.context().close();
});

test('cài lại 2 lớp trên điện thoại mới ĐÒI mã của điện thoại hiện tại, rồi mã cũ hết dùng được', async ({
  page,
  browser,
}) => {
  // Ba mã của CÙNG điện thoại cũ (đăng nhập, step-up, thử mã cũ): chống dùng lại buộc mỗi lần
  // chờ sang chu kỳ 30 giây mới — riêng phần chờ đã chạm trần 60 giây mặc định.
  test.setTimeout(150_000);
  const { person, own } = await newPerson(page, browser);
  await openProfileFromMenu(own);
  // Hết ân hạn step-up của lần đăng nhập — để hàng rào phải hỏi mã thật.
  expireStepUp(person.email);

  await own.getByRole('button', { name: 'Cài lại trên điện thoại mới' }).click();
  const dialog = own.getByRole('dialog', { name: 'Cài lại trên điện thoại mới' });
  await dialog.getByLabel('Mật khẩu hiện tại').fill(person.password);
  await dialog.getByRole('button', { name: 'Tiếp tục' }).click();

  // Hộp hỏi mã của điện thoại HIỆN TẠI.
  const stepUp = own.getByRole('dialog', { name: 'Xác nhận danh tính' });
  await expect(stepUp).toBeVisible();
  await stepUp.getByLabel('Mã xác thực').fill(await freshTotpCode(person.secret));

  const newSecret = (await dialog.getByTestId('totp-secret').innerText()).trim();
  expect(newSecret).not.toBe(person.secret);
  await dialog.getByLabel('Mã 6 số đang hiện trong ứng dụng').fill(await freshTotpCode(newSecret));
  await dialog.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(own.getByText('Đã chuyển xác thực 2 lớp sang điện thoại mới.')).toBeVisible();

  // Mã của điện thoại cũ không còn mở được két.
  const old = await own.request.post('/api/v1/auth/step-up', {
    headers: await writeHeaders(own),
    data: { token: await freshTotpCode(person.secret) },
    failOnStatusCode: false,
  });
  expect(old.status()).toBe(401);
  await own.context().close();
});

test('TẤN CÔNG: phiên chưa step-up gọi thẳng API cài lại 2 lớp thì bị chặn', async ({
  page,
  browser,
}) => {
  const { person, own } = await newPerson(page, browser);
  expireStepUp(person.email);
  const before = sql(`SELECT encode(totp_secret_ct, 'hex') FROM users WHERE email = '${person.email}'`);
  const res = await own.request.post('/api/v1/auth/totp/re-enroll', {
    headers: await writeHeaders(own),
    data: { currentPassword: person.password },
    failOnStatusCode: false,
  });
  expect(res.status()).toBe(401);
  expect(((await res.json()) as { code: string }).code).toBe('STEPUP_REQUIRED');
  expect(sql(`SELECT encode(totp_secret_ct, 'hex') FROM users WHERE email = '${person.email}'`)).toBe(
    before,
  );
  await own.context().close();
});

test('đóng một phiên khác của mình từ Hồ sơ → máy kia bị đá; không đóng được phiên người khác', async ({
  page,
  browser,
}) => {
  const { person, own } = await newPerson(page, browser);

  // Máy thứ hai của CHÍNH người này.
  const ctx2 = await browser.newContext(SECOND_BROWSER);
  const other = await ctx2.newPage();
  await loginWithTotp(other, person.email, person.password, person.secret);

  await openProfileFromMenu(own);
  await own.getByRole('button', { name: 'Đăng xuất phiên', exact: true }).first().click();
  await confirmAction(own);
  await expect(own.getByText('Đã đăng xuất phiên đó.')).toBeVisible();
  await expect
    .poll(async () => (await other.request.get('/api/v1/auth/me')).status())
    .toBe(401);

  // TẤN CÔNG: id phiên của SA (lấy thẳng từ DB) — người thường không đóng được.
  const saSession = sql(
    `SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE u.email = '${E2E_SA.email}' AND s.revoked_at IS NULL ORDER BY s.last_seen_at DESC LIMIT 1`,
  );
  const res = await own.request.post(`/api/v1/auth/sessions/${saSession}/revoke`, {
    headers: await writeHeaders(own),
    failOnStatusCode: false,
  });
  expect(res.status()).toBe(404);
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(200);

  await ctx2.close();
  await own.context().close();
});

test('"Đăng xuất các máy khác" đá mọi phiên khác, giữ máy đang dùng', async ({ page, browser }) => {
  const { person, own } = await newPerson(page, browser);
  const ctx2 = await browser.newContext(SECOND_BROWSER);
  const other = await ctx2.newPage();
  await loginWithTotp(other, person.email, person.password, person.secret);

  await openProfileFromMenu(own);
  await own.getByRole('button', { name: 'Đăng xuất các máy khác' }).click();
  await confirmAction(own);
  await expect(own.getByText(/Đã đăng xuất \d+ máy khác/)).toBeVisible();
  await expect(own.getByText('Không có máy nào khác đang đăng nhập.')).toBeVisible();
  await expect
    .poll(async () => (await other.request.get('/api/v1/auth/me')).status())
    .toBe(401);
  expect((await own.request.get('/api/v1/auth/me')).status()).toBe(200);

  await ctx2.close();
  await own.context().close();
});

test('Giao diện trong Hồ sơ: chọn Tối áp ngay, chọn Theo hệ thống bỏ lựa chọn đã lưu', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  await page.goto('/profile');
  const group = page.getByRole('group', { name: 'Giao diện' });
  await group.getByRole('button', { name: 'Tối' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await group.getByRole('button', { name: 'Theo hệ thống' }).click();
  expect(await page.evaluate(() => localStorage.getItem('ims_theme'))).toBeNull();
});
