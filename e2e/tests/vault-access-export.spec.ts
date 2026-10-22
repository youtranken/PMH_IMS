import { expect, test } from '@playwright/test';
import { E2E_MEMBER, E2E_SA, firstLogin } from './helpers';

/** UX-E28: ma trận quyền két xuất được để rà soát — chỉ SA/Admin, không giá trị két (FR-026). */
test.describe('Quyền két — xuất ma trận', () => {
  test('SA tải quyen-ket.xlsx từ đầu trang', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/vault-access');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Xuất Excel', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('quyen-ket.xlsx');
  });

  test('đường hỏng: Thành viên gọi thẳng API xuất → 403, không có file', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    const res = await page.request.get('/api/v1/vault/access/export.xlsx');
    expect(res.status()).toBe(403);
    expect(res.headers()['content-type'] ?? '').not.toContain('spreadsheetml');
  });
});
