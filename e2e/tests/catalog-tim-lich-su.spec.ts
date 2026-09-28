import { expect, test } from '@playwright/test';
import {
  catalogItem,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  logout,
  resetCatalog,
  resetUsers,
  rowAction,
  uniqueStamp,
  writeHeaders,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetCatalog();
});

/**
 * Danh mục: tìm không ra thì nói "không khớp" (không mời nhập Excel lại dữ liệu đang có), và
 * mỗi mục mở được sổ lịch sử của nó ngay từ menu dòng.
 */
test.describe('Danh mục — tìm không khớp và lịch sử mục', () => {
  test('tìm không khớp: câu "Không có … khớp", nút Xoá từ khoá đưa bảng trở lại', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const code = `E2E-TIM-${uniqueStamp()}`;
    await catalogItem(page, 'site', { code, name: 'Site E2E tìm' });

    await page.goto('/admin/catalog');
    await page.getByRole('searchbox', { name: /Tìm/ }).fill('zzz-khong-co-e2e');
    await expect(page.getByText('Không có site nào khớp "zzz-khong-co-e2e".')).toBeVisible();
    // Câu "chưa khai mục nào" là câu cho tab RỖNG — ở đây danh mục đâu có rỗng.
    await expect(page.getByText(/Chưa khai mục nào/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Xoá từ khoá' }).click();
    await expect(page.getByRole('searchbox', { name: /Tìm/ })).toHaveValue('');
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
  });

  test('menu dòng có "Lịch sử": ghi đủ tạo → sửa → vô hiệu, kèm người làm', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const code = `E2E-LS-${uniqueStamp()}`;
    const id = await catalogItem(page, 'site', { code, name: 'Site E2E lịch sử' });
    const headers = await writeHeaders(page);
    const put = await page.request.patch(`/api/v1/catalog/site/${id}`, {
      headers,
      data: { code, name: 'Site E2E lịch sử', address: 'Tầng 3' },
    });
    expect(put.ok()).toBeTruthy();
    const off = await page.request.patch(`/api/v1/catalog/site/${id}/active`, {
      headers,
      data: { active: false },
    });
    expect(off.ok()).toBeTruthy();

    await page.goto('/admin/catalog');
    await rowAction(page, new RegExp(code), 'Lịch sử');
    const dialog = page.getByRole('dialog', { name: new RegExp(`Lịch sử của .*${code}`) });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Tạo mục')).toBeVisible();
    await expect(dialog.getByText('Vô hiệu hóa')).toBeVisible();
    await expect(dialog.getByText(/địa chỉ: trống → Tầng 3/)).toBeVisible();
    await expect(dialog.getByText(new RegExp(E2E_SA.email)).first()).toBeVisible();
  });

  test('Member cũng xem được lịch sử (chỉ đọc)', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const code = `E2E-LSM-${uniqueStamp()}`;
    await catalogItem(page, 'site', { code, name: 'Site E2E member' });
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    await page.goto('/admin/catalog');
    await rowAction(page, new RegExp(code), 'Lịch sử');
    await expect(page.getByRole('dialog').getByText('Tạo mục')).toBeVisible();
  });
});
