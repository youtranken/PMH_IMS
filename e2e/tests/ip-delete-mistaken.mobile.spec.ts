import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetIpam,
  resetUsers,
  rowAction,
  writeHeaders,
} from './helpers';

/**
 * Q-15 — "Xóa" hồ sơ IP nhập nhầm ở 390px: xóa để nhập lại, không khôi phục trên giao diện.
 *
 * Vì sao chạy ở 390px: người gõ nhầm hay là người đang đứng ở tủ mạng với cái điện thoại. Hộp
 * Xóa phải mở được, bắt lý do, và sau khi xóa ô phải là chỗ TRỐNG cấp lại được ngay tại dòng.
 *
 * Đường hỏng: bỏ trống lý do thì không xóa; và hồ sơ đã xóa KHÔNG còn đường nào hiện lại trên
 * màn (không chip, không nút khôi phục) — vết nằm trong Nhật ký hệ thống.
 */

test.beforeEach(() => {
  resetUsers();
  resetIpam();
});

const OWNER = 'Phòng Kế toán E2E 390';

/** Một dải /29 + một hồ sơ IP đang dùng. */
async function seedRecord(page: Page): Promise<{ subnetId: string; address: string }> {
  const headers = await writeHeaders(page);
  const stamp = Number(Date.now().toString().slice(-4)) % 200;
  const cidr = `10.${140 + (stamp % 40)}.${stamp}.0/29`;

  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { name: `Dai xoa E2E 390 ${stamp}`, cidr },
  });
  expect(subnet.status()).toBeLessThan(300);
  const subnetId = ((await subnet.json()) as { id: string }).id;

  const address = cidr.replace('.0/29', '.5');
  const ip = await page.request.post('/api/v1/ipam/addresses', {
    headers,
    data: { subnetId, address, usedBy: OWNER },
  });
  expect(ip.status()).toBeLessThan(300);
  return { subnetId, address };
}

test.describe('Xóa hồ sơ IP nhập nhầm ở 390px', () => {
  test('hộp Xóa mở được, xóa xong ô là chỗ trống và nhập lại được ngay', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const { subnetId, address } = await seedRecord(page);
    await page.goto(`/ip-addresses/${subnetId}`);

    const row = page.getByRole('row').filter({ hasText: address });
    await expect(row).toContainText(OWNER);

    await rowAction(page, address, 'Xóa');
    const dialog = page.getByRole('dialog', { name: `Xóa hồ sơ IP nhập nhầm — ${address}` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('nhập lại được ngay');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await dialog.getByRole('textbox', { name: 'Lý do' }).fill('gõ nhầm chủ E2E');
    await dialog.getByRole('button', { name: 'Xóa', exact: true }).click();
    await expect(page.getByText('Đã xóa hồ sơ IP — nhập lại được ngay.')).toBeVisible();

    // Ô trở về TRỐNG, cấp lại được ngay tại dòng.
    await expect(row).not.toContainText(OWNER);
    await row.getByRole('button', { name: 'Cấp IP', exact: true }).click();
    const assign = page.getByRole('dialog', { name: `Cấp IP — ${address}` });
    await expect(assign).toBeVisible();
    await assign.getByRole('combobox', { name: 'Người / phòng ban dùng' }).fill('Chủ đúng E2E');
    await assign.getByRole('button', { name: 'Cấp IP', exact: true }).click();
    await expect(row).toContainText('Chủ đúng E2E');
  });

  test('đường hỏng: bỏ trống lý do thì không xóa; hồ sơ đã xóa không có đường hiện lại', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const { subnetId, address } = await seedRecord(page);
    await page.goto(`/ip-addresses/${subnetId}`);
    const row = page.getByRole('row').filter({ hasText: address });

    await rowAction(page, address, 'Xóa');
    const dialog = page.getByRole('dialog', { name: `Xóa hồ sơ IP nhập nhầm — ${address}` });
    await dialog.getByRole('button', { name: 'Xóa', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('alert'),
      'bỏ trống lý do phải được nói ra ngay trong hộp',
    ).toBeVisible();
    /*
     * Hộp đang mở là modal: phần còn lại của trang bị ẩn khỏi cây truy cập, nên dòng chỉ đọc
     * được sau khi đóng hộp. Hủy rồi mới kiểm hồ sơ còn nguyên, sau đó mở lại để xóa thật.
     */
    await dialog.getByRole('button', { name: 'Hủy', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toContainText(OWNER);

    await rowAction(page, address, 'Xóa');
    await dialog.getByRole('textbox', { name: 'Lý do' }).fill('gõ nhầm địa chỉ E2E');
    await dialog.getByRole('button', { name: 'Xóa', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // Không chip hồ sơ đã xóa, không mục khôi phục — Q-15.
    const filters = page.getByRole('radiogroup', { name: 'Trạng thái' });
    await expect(filters.getByRole('radio')).toHaveText([/^Tất cả/, /^Đang dùng/, /^Trống/]);
    await expect(page.getByText(OWNER)).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});
