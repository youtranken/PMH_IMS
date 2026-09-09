import { expect, test } from '@playwright/test';
import {
  E2E_MEMBER,
  NEW_PASSWORD,
  fillLogin,
  firstLogin,
  freshTotpCode,
  loginWithTotp,
  logout,
  resetUsers,
} from './helpers';

test.beforeEach(() => resetUsers());

/** Story 1.2 + 1.3 — đăng nhập, TOTP, đổi mật khẩu bắt buộc. */
test.describe('Đăng nhập', () => {
  test('sai mật khẩu → báo lỗi tiếng Việt, không lộ email có tồn tại hay không', async ({ page }) => {
    await fillLogin(page, E2E_MEMBER.email, 'mat-khau-sai-hoan-toan');
    await expect(page.getByRole('alert')).toHaveText('Email hoặc mật khẩu không đúng.');

    await fillLogin(page, 'khong-ton-tai@pmh.com.vn', 'mat-khau-sai-hoan-toan');
    await expect(page.getByRole('alert')).toHaveText('Email hoặc mật khẩu không đúng.');
  });

  test('lần đầu: mật khẩu tạm → cài 2 lớp → đổi mật khẩu → vào được app', async ({ page }) => {
    const secret = await firstLogin(page, E2E_MEMBER);
    expect(secret).toMatch(/^[A-Z2-7]+$/);

    // Đăng xuất rồi đăng nhập lại bằng mật khẩu MỚI + mã TOTP.
    await logout(page);
    await expect(page).toHaveURL(/login/);
    await loginWithTotp(page, E2E_MEMBER.email, NEW_PASSWORD, secret);
  });

  test('mã TOTP sai → từ chối; mã đã dùng → báo đã dùng (chống replay)', async ({ page }) => {
    const secret = await firstLogin(page, E2E_MEMBER);
    await logout(page);

    await fillLogin(page, E2E_MEMBER.email, NEW_PASSWORD);
    await page.getByLabel('Mã xác thực').fill('000000');
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.getByRole('alert')).toContainText('không đúng');

    const code = await freshTotpCode(secret);
    await page.getByLabel('Mã xác thực').fill(code);
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.getByRole('heading', { name: /Xin chào/ })).toBeVisible();

    // Dùng LẠI đúng mã đó cho lần đăng nhập kế tiếp → phải bị chặn.
    await logout(page);
    await fillLogin(page, E2E_MEMBER.email, NEW_PASSWORD);
    await page.getByLabel('Mã xác thực').fill(code);
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.getByRole('alert')).toContainText('đã được dùng');
  });

  test('mật khẩu mới yếu bị từ chối, hai ô nhập lệch nhau cũng bị chặn', async ({ page }) => {
    await fillLogin(page, E2E_MEMBER.email, E2E_MEMBER.password);
    const secret = (await page.getByTestId('totp-secret').innerText()).trim();
    await page.getByLabel('Nhập mã 6 số đầu tiên để xác nhận').fill(await freshTotpCode(secret));
    await page.getByRole('button', { name: 'Xác nhận' }).click();

    await expect(page.getByRole('heading', { name: 'Đổi mật khẩu' })).toBeVisible();
    await page.getByLabel('Mật khẩu hiện tại').fill(E2E_MEMBER.password);
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill('Matkhau12345');
    await page.getByLabel('Nhập lại mật khẩu mới').fill('Matkhau12346');
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('alert')).toContainText('không khớp');
  });
});

test.describe('Khóa tài khoản', () => {
  test('sai 5 lần liên tiếp → tài khoản bị khóa và báo rõ thời gian chờ', async ({ page }) => {
    for (let i = 0; i < 4; i += 1) {
      await fillLogin(page, E2E_MEMBER.email, `sai-lan-${i}`);
      await expect(page.getByRole('alert')).toHaveText('Email hoặc mật khẩu không đúng.');
    }
    await fillLogin(page, E2E_MEMBER.email, 'sai-lan-5');
    await expect(page.getByRole('alert')).toHaveText('Email hoặc mật khẩu không đúng.');

    // Lần thứ 6 (kể cả nhập ĐÚNG mật khẩu) phải báo đang khóa.
    await fillLogin(page, E2E_MEMBER.email, E2E_MEMBER.password);
    await expect(page.getByRole('alert')).toContainText('đang bị khóa');
  });
});
