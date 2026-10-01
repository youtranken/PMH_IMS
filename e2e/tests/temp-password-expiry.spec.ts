import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  NEW_PASSWORD,
  fillLogin,
  firstLogin,
  resetUsers,
  sql,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Q-20 — mật khẩu tạm (tạo tài khoản, SA đặt lại) hết hạn sau `auth.temp_password_hours` giờ.
 * Quá hạn: màn đăng nhập nói phải nhờ SA đặt lại; phiên đang dừng ở bước đổi mật khẩu cũng bị
 * đóng, kể cả khi người dùng bấm "Đổi mật khẩu" bằng chính mật khẩu tạm ấy.
 *
 * Hạn được dời bằng SQL thay vì chờ 24 giờ — thứ cần chứng minh là hệ thống đọc mốc đó.
 */

test.beforeEach(() => {
  resetUsers();
});

/** Tài khoản member không bắt 2 lớp: đăng nhập là tới thẳng bước đổi mật khẩu. */
async function makeMember(page: Page): Promise<{ email: string; password: string }> {
  const email = `e2e-tao-moi-tam-${uniqueStamp()}@pmh.local`;
  const res = await page.request.post('/api/v1/accounts', {
    headers: await writeHeaders(page),
    data: { email, fullName: 'E2E Mat khau tam', role: 'member', totpLoginRequired: false },
  });
  expect(res.status(), 'tạo tài khoản phụ để thử').toBe(201);
  const created = (await res.json()) as { temporaryPassword: string };
  return { email, password: created.temporaryPassword };
}

function expire(email: string): void {
  sql(`UPDATE users SET temp_password_expires_at = now() - interval '1 minute' WHERE email = '${email}'`);
}

test.describe('Mật khẩu tạm có hạn (Q-20)', () => {
  test('mới cấp: có hạn khoảng 24 giờ và đăng nhập được tới bước đổi mật khẩu', async ({ page, browser }) => {
    await firstLogin(page, E2E_SA);
    const who = await makeMember(page);
    const hours = Number(
      sql(
        `SELECT round(extract(epoch FROM temp_password_expires_at - now()) / 3600) FROM users WHERE email = '${who.email}'`,
      ),
    );
    expect(hours).toBe(24);

    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const member = await ctx.newPage();
    await fillLogin(member, who.email, who.password);
    await expect(member.getByRole('heading', { name: 'Đổi mật khẩu' })).toBeVisible();
    await ctx.close();
  });

  test('quá hạn → màn đăng nhập báo nhờ SA đặt lại, không vào được', async ({ page, browser }) => {
    await firstLogin(page, E2E_SA);
    const who = await makeMember(page);
    expire(who.email);

    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const member = await ctx.newPage();
    await fillLogin(member, who.email, who.password);
    await expect(member.getByText(/Mật khẩu tạm đã hết hạn\. Liên hệ Super Admin/)).toBeVisible();
    await expect(member).toHaveURL(/\/login$/);

    // Gõ SAI mật khẩu thì vẫn là câu chung — câu "hết hạn" chỉ tới tay người cầm đúng mật khẩu.
    await fillLogin(member, who.email, 'Sai-mat-khau-E2E-1');
    await expect(member.getByText('Email hoặc mật khẩu không đúng.')).toBeVisible();
    await ctx.close();
  });

  test('đang ở bước đổi mật khẩu thì hết hạn → bấm đổi bị đóng phiên, về đăng nhập kèm lý do', async ({
    page,
    browser,
  }) => {
    await firstLogin(page, E2E_SA);
    const who = await makeMember(page);

    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const member = await ctx.newPage();
    await fillLogin(member, who.email, who.password);
    await expect(member.getByRole('heading', { name: 'Đổi mật khẩu' })).toBeVisible();

    expire(who.email);
    await member.getByLabel('Mật khẩu hiện tại').fill(who.password);
    await member.getByLabel('Mật khẩu mới', { exact: true }).fill(NEW_PASSWORD);
    await member.getByLabel('Nhập lại mật khẩu mới').fill(NEW_PASSWORD);
    await member.getByRole('button', { name: 'Đổi mật khẩu và tiếp tục' }).click();

    await expect(member).toHaveURL(/\/login$/);
    await expect(
      member.getByRole('status').filter({ hasText: 'Mật khẩu tạm đã hết hạn' }),
    ).toBeVisible();
    expect(
      sql(`SELECT must_change_password FROM users WHERE email = '${who.email}'`),
      'mật khẩu tạm quá hạn không được dùng để tự đặt mật khẩu mới',
    ).toBe('t');
    await ctx.close();
  });
});
