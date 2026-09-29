import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, horizontalOverflow, resetUsers } from './helpers';

test.beforeEach(() => resetUsers());

/**
 * UX-DR2: ba màn ĐỌC của nhóm Quản trị ở 390px dùng THẺ GỌN (không phải bảng gập 8 hàng nhãn)
 * và không tràn ngang: Danh mục, Tài khoản, Nhật ký hệ thống.
 */
test('Danh mục 390px: thẻ gọn một dòng tên + dòng thuộc tính, không tràn ngang', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  await page.goto('/admin/catalog?tab=device_type');
  await expect(page.getByRole('heading', { name: 'Danh mục' })).toBeVisible();
  // Thẻ gọn = danh sách, không còn bảng.
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('listitem').first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test('Tài khoản 390px: thẻ tên + vai, dòng email; không tràn ngang', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  await page.goto('/admin/accounts');
  await expect(page.getByRole('heading', { name: 'Người dùng IMS', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText(E2E_SA.email).first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test('Nhật ký hệ thống 390px: chạm một sự kiện mở chi tiết dạng sheet, không tràn ngang', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  await page.goto('/admin/audit-log');
  await expect(page.getByRole('heading', { level: 1, name: 'Nhật ký hệ thống' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.getByRole('listitem').first().getByRole('button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
