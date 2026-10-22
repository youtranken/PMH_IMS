import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, resetSoftware, resetUsers } from './helpers';

/** PW-A29: tab "Đã gia hạn" xuất được Excel, đúng khoảng ngày đang xem. */
test.beforeEach(() => {
  resetUsers();
  resetSoftware();
});

test.describe('Sắp hết hạn — xuất tab Đã gia hạn', () => {
  test('nút Xuất ở đầu trang tải về da-gia-han.xlsx; khoảng ngày ngược → 400, không trả file', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/expiry');
    await page.getByRole('tab', { name: 'Đã gia hạn' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Xuất Excel', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('da-gia-han.xlsx');

    const bad = await page.request.get('/api/v1/expiry/renewals/export.xlsx?from=2026-10-21&to=2026-09-01');
    expect(bad.status()).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe('RANGE_INVALID');
  });
});
