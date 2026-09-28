import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, horizontalOverflow, resetUsers } from './helpers';

test.beforeEach(() => resetUsers());

/**
 * 390px: nhãn hành động tiếng Việt + đối tượng có tên vẫn không đẩy ngang trang; mã thô vẫn
 * tra được. Ở khổ này mỗi dòng là một thẻ hai dòng "giờ · nhãn" (ADM-066), mã hành động nằm
 * trong hộp chi tiết mở ra khi chạm thẻ (ADM-063).
 */
test('Nhật ký ở 390px: nhãn tiếng Việt, không tràn ngang', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  await page.goto(`/admin/audit-log?q=${encodeURIComponent(E2E_SA.email)}`);
  const card = page
    .getByRole('button', { name: /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} · Đăng nhập/ })
    .first();
  await expect(card).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await card.click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByText('auth.login.ok', { exact: true })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
