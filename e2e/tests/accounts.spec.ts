import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, resetUsers } from './helpers';

test.beforeEach(() => resetUsers());

/** Story 1.4 — SA quản trị tài khoản và phiên. */
test.describe('Quản trị tài khoản', () => {
  test('SA tạo tài khoản mới và nhận mật khẩu tạm', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    await page.getByRole('link', { name: 'Tài khoản' }).click();
    await expect(page.getByRole('heading', { name: 'Tài khoản' })).toBeVisible();

    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const unique = `e2e-tao-moi-${Date.now()}@pmh.com.vn`;
    // Dùng vai + tên trợ năng (accessible name) thay vì getByLabel: nhãn có kèm dấu *
    // trang trí, còn ô tìm kiếm phía trên cũng chứa chữ "email".
    await page.getByRole('textbox', { name: 'Họ tên' }).fill('Nhân viên mới tạo');
    await page.getByRole('textbox', { name: 'Email' }).fill(unique);
    await page.getByRole('button', { name: 'Lưu' }).click();

    // Mật khẩu tạm chỉ hiện MỘT LẦN.
    await expect(page.getByText('Mật khẩu tạm')).toBeVisible();
    const temp = await page.locator('.temp-password').innerText();
    expect(temp.trim().length).toBeGreaterThanOrEqual(12);

    await page.getByRole('button', { name: 'Đóng' }).click();
    await expect(page.getByText(unique)).toBeVisible();
  });

  test('member không thấy mục Tài khoản và bị chặn khi gõ thẳng URL', async ({ page }) => {
    await firstLogin(page, { email: 'e2e-member@pmh.com.vn', password: 'E2e@Test#2026' });

    await expect(page.getByRole('link', { name: 'Tài khoản' })).toHaveCount(0);

    const response = await page.request.get('/api/v1/accounts');
    expect(response.status()).toBe(403);
  });

  test('SA xem và đá được phiên đang mở', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.getByRole('link', { name: 'Tài khoản' }).click();

    const row = page.getByRole('row', { name: /E2E Super Admin/ });
    await row.getByRole('button', { name: 'Phiên đang mở' }).click();
    await expect(page.getByRole('dialog')).toContainText('Phiên đang mở');
    await expect(page.getByRole('button', { name: 'Đá phiên' }).first()).toBeVisible();
  });
});
