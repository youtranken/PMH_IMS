import { expect, test } from '@playwright/test';
import { E2E_MEMBER, firstLogin, resetUsers } from './helpers';

test.beforeEach(() => resetUsers());

/**
 * UX-DR2: màn ĐỌC phải dùng được ở 390px. Project `mobile-390` của Playwright chạy file này.
 * Danh mục là màn đọc của Member nên phải đạt; màn NHẬP (import, form) là desktop-only.
 */
test('Danh mục đọc được ở 390px, không tràn ngang', async ({ page }) => {
  await firstLogin(page, E2E_MEMBER);
  await page.goto('/admin/catalog');

  await expect(page.getByRole('heading', { name: 'Danh mục' })).toBeVisible();
  await page.getByRole('tab', { name: 'Loại thiết bị' }).click();
  await expect(page.getByText('Switch').first()).toBeVisible();

  // Bảng gập thành thẻ dọc (.table-stack) — trang không được cuộn ngang.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
