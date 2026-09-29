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

    await page.getByRole('button', { name: 'Xóa từ khóa' }).click();
    await expect(page.getByRole('searchbox', { name: /Tìm/ })).toHaveValue('');
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
  });

  test('menu dòng có "Lịch sử": ghi đủ tạo → sửa → ngừng dùng, kèm người làm', async ({ page }) => {
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
    await expect(dialog.getByText('Ngừng dùng')).toBeVisible();
    await expect(dialog.getByText('địa chỉ: (trống) → Tầng 3', { exact: true })).toBeVisible();
    await expect(dialog.getByText(new RegExp(E2E_SA.email)).first()).toBeVisible();
  });

  test('ADM-014: tủ đổi "Thuộc site" thì sổ đọc ra mã + tên site, không phải uuid (1280 + 390px)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const siteA = await catalogItem(page, 'site', { code: `E2E-SA-${stamp}`, name: 'Site E2E cũ' });
    const siteB = await catalogItem(page, 'site', { code: `E2E-SB-${stamp}`, name: 'Site E2E mới' });
    const cabinet = `E2E-TU-${stamp}`;
    const id = await catalogItem(page, 'cabinet', { code: cabinet, siteId: siteA });
    const moved = await page.request.patch(`/api/v1/catalog/cabinet/${id}`, {
      headers: await writeHeaders(page),
      data: { code: cabinet, siteId: siteB },
    });
    expect(moved.ok(), await moved.text()).toBeTruthy();

    const line = `site: E2E-SA-${stamp} — Site E2E cũ → E2E-SB-${stamp} — Site E2E mới`;
    await page.goto('/admin/catalog');
    await page.getByRole('tab', { name: 'Tủ mạng' }).click();
    await rowAction(page, new RegExp(cabinet), 'Lịch sử');
    const dialog = page.getByRole('dialog', { name: new RegExp(`Lịch sử của .*${cabinet}`) });
    await expect(dialog.getByText(line, { exact: true })).toBeVisible();
    // Không một uuid nào lọt ra sổ — cả của site cũ lẫn site mới.
    await expect(dialog).not.toContainText(siteA);
    await expect(dialog).not.toContainText(siteB);

    // Màn đọc: điện thoại thấy cùng dòng đó trong bottom sheet.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog.getByText(line, { exact: true })).toBeVisible();
  });

  test('ADM-014 đường hỏng: đổi mã tủ (không đổi site) thì không có dòng site nào', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const site = await catalogItem(page, 'site', { code: `E2E-SC-${stamp}`, name: 'Site E2E giữ' });
    const cabinet = `E2E-TV-${stamp}`;
    const id = await catalogItem(page, 'cabinet', { code: cabinet, siteId: site });
    const renamed = `${cabinet}-B`;
    const put = await page.request.patch(`/api/v1/catalog/cabinet/${id}`, {
      headers: await writeHeaders(page),
      data: { code: renamed, siteId: site },
    });
    expect(put.ok(), await put.text()).toBeTruthy();

    await page.goto('/admin/catalog');
    await page.getByRole('tab', { name: 'Tủ mạng' }).click();
    await rowAction(page, new RegExp(renamed), 'Lịch sử');
    const dialog = page.getByRole('dialog', { name: new RegExp(`Lịch sử của .*${renamed}`) });
    await expect(dialog.getByText('Tạo mục')).toBeVisible();
    await expect(dialog.getByText(/^site: /)).toHaveCount(0);
    await expect(dialog.getByText('đổi site')).toHaveCount(0);
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
