import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetSoftware, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

/**
 * UX-DR2 — bảng điều khiển là màn ĐỌC, và là màn đầu tiên sếp mở.
 *
 * Cảnh dùng thật đúng như epic mô tả: ba phút trước giờ họp, và rất có thể là trên điện thoại
 * trong thang máy. Ba khối phải tự xếp dọc, chữ đọc được, không tràn ngang.
 */
test.describe('Bảng điều khiển ở 390px', () => {
  test('ba khối xếp dọc, đọc được, không tràn ngang', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);

    await page.request.post('/api/v1/software', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
      data: {
        code: `LIC-E2E-M390-${stamp}`,
        name: 'License có tên rất dài để thử tràn ngang trên điện thoại',
        kind: 'license',
        endDate: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
      },
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sắp hết hạn (30 ngày)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sự cố tuần qua' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Break-glass tuần qua' })).toBeVisible();
    await expect(
      page.getByText('License có tên rất dài để thử tràn ngang trên điện thoại'),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
