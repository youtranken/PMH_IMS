import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, horizontalOverflow, resetUsers } from './helpers';

test.beforeEach(() => resetUsers());

/** 390px: nhãn hành động tiếng Việt + mã dòng phụ + đối tượng có tên vẫn không đẩy ngang trang. */
test('Nhật ký ở 390px: nhãn tiếng Việt, không tràn ngang', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  await page.goto(`/admin/audit-log?q=${encodeURIComponent(E2E_SA.email)}`);
  await expect(page.getByText('Đăng nhập', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^auth\.(login|password)\.ok$/).first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
