import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, horizontalOverflow, resetUsers } from './helpers';

test.beforeEach(() => resetUsers());

/**
 * UX-DR2: Nhật ký là màn ĐỌC, và thư cảnh báo bảo mật dẫn tới nó — thư hay được mở trên điện
 * thoại, nên màn phải đọc được ở 390px ngay từ link trong thư.
 */
test('Nhật ký đọc được ở 390px từ link lọc sẵn, không tràn ngang', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  await page.goto(`/admin/audit-log?q=${encodeURIComponent(E2E_SA.email)}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Nhật ký hệ thống' })).toBeVisible();
  // Mỗi dòng là thẻ "giờ · nhãn tiếng Việt" (ADM-066) — link lọc sẵn phải ra đúng lượt đăng nhập.
  await expect(
    page
      .getByRole('button', { name: /· (Đăng nhập|Đúng mật khẩu, chờ mã 2 lớp)/ })
      .first(),
  ).toBeVisible();

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
