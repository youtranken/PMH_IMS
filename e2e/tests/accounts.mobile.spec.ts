import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, horizontalOverflow, resetUsers, rowAction, sql, searchAndWaitForFilter } from './helpers';

test.beforeEach(() => resetUsers());

/**
 * 390px: hộp "Phiên đang mở" là THẺ — nút "Đóng phiên" phải nằm trong khung nhìn, không lọt
 * ra ngoài cột cuối của một bảng bị cắt. Đó là lúc cần đá kẻ chiếm tài khoản từ điện thoại.
 */
test('Phiên đang mở ở 390px: thẻ thiết bị · IP, nút Đóng phiên trong khung, không tràn ngang', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  await page.goto('/admin/accounts');
  const fullName = sql(`SELECT full_name FROM users WHERE email = '${E2E_SA.email}'`);
  await searchAndWaitForFilter(page, E2E_SA.email);
  await rowAction(page, fullName, 'Phiên đang mở');

  const dialog = page.getByRole('dialog', { name: `Phiên đang mở: ${fullName}` });
  await expect(dialog).toBeVisible();
  // Thẻ, không phải bảng.
  await expect(dialog.getByRole('table')).toHaveCount(0);
  await expect(dialog.getByRole('listitem').first()).toContainText(/Hoạt động/);
  const button = dialog.getByRole('button', { name: 'Đóng phiên' }).first();
  await expect(button).toBeInViewport();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
