import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetCatalog,
  resetDevices,
  resetUsers,
  timVaChoLoc,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Mảng thiết bị ở 390px — đợt sửa giao diện mức cao (Q-14). Người dùng chính là nhân viên IT
 * đứng cạnh tủ mạng tra bằng điện thoại.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetCatalog();
});

async function createDevice(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.get('/api/v1/catalog');
  const catalog = (await res.json()) as {
    deviceTypes: { id: string; name: string }[];
    sites: { id: string; code: string }[];
    cabinets: { id: string; code: string; siteId: string }[];
  };
  const pc = catalog.deviceTypes.find((t) => t.name === 'PC') ?? catalog.deviceTypes[0];
  const created = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { deviceTypeId: pc.id, ...data },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const button = page.getByRole('button', {
    name: theme === 'dark' ? 'Chuyển sang chế độ tối' : 'Chuyển sang chế độ sáng',
  });
  if ((await button.count()) > 0) await button.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

test.describe('DEV-005 · danh sách thiết bị là thẻ gọn trên điện thoại', () => {
  test('thẻ: mã + trạng thái, tên, người dùng, chip bảo hành; chạm là mở chi tiết (sáng + tối)', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-THE-${stamp}`;
    await createDevice(page, {
      code,
      name: 'Máy trạm kế toán',
      assignedTo: 'Chị Lan',
      warrantyEnd: '2027-12-31',
    });

    await page.goto('/devices');
    await timVaChoLoc(page, code);
    const card = page.getByRole('listitem').filter({ hasText: code });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Máy trạm kế toán');
    await expect(card).toContainText('Chị Lan');
    await expect(card).toContainText('Đang dùng');
    // Thẻ gọn, không phải bảng xếp chồng 8 dòng nhãn–giá trị (~410px/máy).
    expect((await card.boundingBox())!.height).toBeLessThan(160);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      await expect(card.getByText('Đang dùng')).toBeVisible();
    }

    await card.getByRole('link', { name: code }).click();
    await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
  });

  test('đường hỏng: lọc không ra thì nói không khớp, không vẽ thẻ rỗng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/devices');
    await timVaChoLoc(page, `KHONG-CO-E2E-${uniqueStamp()}`);
    await expect(page.getByText('Không có thiết bị nào khớp bộ lọc.')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'E2E' })).toHaveCount(0);
  });
});

test.describe('DEV-063 · DEV-043 · trang chi tiết trên điện thoại', () => {
  test('thẻ định danh thu thành một dải, tab ở gần đầu trang và dính dưới topbar khi cuộn', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-M-${stamp}`;
    const id = await createDevice(page, {
      code,
      name: 'Máy trạm',
      assignedTo: 'Chị Lan',
      warrantyEnd: '2027-12-31',
    });

    await page.goto(`/devices/${id}?tab=history`);
    // Dải tóm tắt thay cho thẻ ~600px: người dùng vẫn thấy ngay, tab không còn nằm dưới y≈590.
    await expect(page.getByText('Chị Lan').first()).toBeVisible();
    const tab = page.getByRole('tab', { name: 'Lịch sử' });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    expect((await tab.boundingBox())!.y).toBeLessThan(560);

    // Thẻ đầy đủ vẫn ở sau nút "Chi tiết".
    await page.getByText('Chi tiết', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Thẻ định danh' })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeInViewport();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('đường hỏng: mã tủ dài không bị ngắt giữa chữ trong dải tóm tắt', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = await writeHeaders(page);
    const stamp = uniqueStamp();
    const site = await page.request.post('/api/v1/catalog/site', {
      headers,
      data: { code: `E2E-HCM-${stamp}`, name: 'Site E2E HCM' },
    });
    expect(site.status(), await site.text()).toBe(201);
    const siteId = ((await site.json()) as { id: string }).id;
    const cabinetCode = `TU-E2E-HCM-${stamp}`;
    const cabinet = await page.request.post('/api/v1/catalog/cabinet', {
      headers,
      data: { siteId, code: cabinetCode },
    });
    expect(cabinet.status(), await cabinet.text()).toBe(201);
    const cabinetId = ((await cabinet.json()) as { id: string }).id;
    const id = await createDevice(page, {
      code: `SW-E2E-M-${stamp}`,
      name: 'Switch tủ',
      siteId,
      cabinetId,
    });

    await page.goto(`/devices/${id}`);
    const cab = page.getByText(cabinetCode, { exact: true }).first();
    await expect(cab).toBeVisible();
    const lines = await cab.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getClientRects().length;
    });
    expect(lines, 'mã tủ bị ngắt giữa chữ').toBe(1);
  });
});
