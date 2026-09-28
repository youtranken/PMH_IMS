import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, horizontalOverflow, resetUsers, rowAction, sql, timVaChoLoc } from './helpers';

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
  const hoTen = sql(`SELECT full_name FROM users WHERE email = '${E2E_SA.email}'`);
  await timVaChoLoc(page, E2E_SA.email);
  await rowAction(page, hoTen, 'Phiên đang mở');

  const hop = page.getByRole('dialog', { name: `Phiên đang mở — ${hoTen}` });
  await expect(hop).toBeVisible();
  // Thẻ, không phải bảng.
  await expect(hop.getByRole('table')).toHaveCount(0);
  await expect(hop.getByRole('listitem').first()).toContainText(/Hoạt động/);
  const nut = hop.getByRole('button', { name: 'Đóng phiên' }).first();
  await expect(nut).toBeInViewport();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
