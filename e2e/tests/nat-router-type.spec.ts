import { expect, test, type Page } from '@playwright/test';
import {
  catalogTab,
  E2E_SA,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetIpam,
  resetUsers,
  writeHeaders,
} from './helpers';

/**
 * NET-041 (Q-14): ô Router của form NAT chỉ liệt kê thiết bị thuộc loại mang cờ
 * "Router/Firewall" — không còn camera đứng đầu danh sách. Cờ sửa được ở Danh mục.
 */

test.beforeEach(() => {
  resetUsers();
  resetIpam();
  resetDevices();
  resetCatalog();
});

async function typeId(page: Page, name: string): Promise<string> {
  const catalog = (await (await page.request.get('/api/v1/catalog')).json()) as {
    deviceTypes: { id: string; name: string; isRouter: boolean }[];
  };
  return catalog.deviceTypes.find((t) => t.name === name)!.id;
}

async function makeDevice(page: Page, code: string, deviceTypeId: string): Promise<void> {
  const res = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { code, name: `Máy ${code}`, deviceTypeId },
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function openRouterPicker(page: Page) {
  await page.goto('/nat');
  await page.getByRole('button', { name: 'Thêm luật NAT' }).first().click();
  const form = page.getByRole('dialog', { name: 'Thêm luật NAT' });
  return { form, picker: form.getByRole('combobox', { name: 'Router', exact: true }) };
}

test.describe('Ô Router chỉ liệt kê Router/Firewall (NET-041)', () => {
  test('mặc định: có Firewall, không có camera; "Tất cả loại" mở lại cả kho, chọn camera chỉ cảnh báo', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    await makeDevice(page, `FW-E2E-${stamp}`, await typeId(page, 'Firewall'));
    await makeDevice(page, `CAM-E2E-${stamp}`, await typeId(page, 'Camera'));

    const { form, picker } = await openRouterPicker(page);
    await picker.fill(stamp);
    await expect(page.getByRole('option', { name: new RegExp(`FW-E2E-${stamp}`) })).toBeVisible();
    await expect(page.getByRole('option', { name: new RegExp(`CAM-E2E-${stamp}`) })).toHaveCount(0);

    // Q-20: lọc loại là dải chip, mặc định các loại cờ Router.
    const types = form.getByRole('group', { name: 'Lọc theo loại thiết bị' });
    await expect(types.getByRole('button', { name: 'Firewall', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await types.getByRole('button', { name: 'Tất cả loại', exact: true }).click();
    await picker.fill('');
    await picker.fill(stamp);
    await page.getByRole('option', { name: new RegExp(`CAM-E2E-${stamp}`) }).click();
    // Không chặn — Core/Firewall… vẫn làm NAT được; chỉ nhắc kiểm lại.
    await expect(
      form.getByText('Máy này không thuộc loại Router — vẫn lưu được, nhưng kiểm lại cho chắc.'),
    ).toBeVisible();
  });

  test('bật cờ cho một loại ở Danh mục → thiết bị loại đó vào ô Router; audit có dấu', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const typeName = `Draytek E2E ${stamp}`;

    await page.goto('/admin/catalog');
    await page.getByRole('tab', { name: catalogTab('Loại thiết bị') }).click();
    await page.getByRole('button', { name: 'Thêm loại thiết bị', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Thêm loại thiết bị' });
    await dialog.getByRole('textbox', { name: 'Tên', exact: true }).fill(typeName);
    await dialog.getByRole('checkbox', { name: 'Router/Firewall' }).check();
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await expect(dialog).toHaveCount(0);

    const created = (await (await page.request.get('/api/v1/catalog')).json()) as {
      deviceTypes: { id: string; name: string; isRouter: boolean }[];
    };
    const row = created.deviceTypes.find((t) => t.name === typeName);
    expect(row?.isRouter, 'cờ phải xuống tới DB').toBe(true);

    await makeDevice(page, `RT-E2E-DT-${stamp}`, row!.id);
    const { picker } = await openRouterPicker(page);
    await picker.fill(`RT-E2E-DT-${stamp}`);
    await expect(page.getByRole('option', { name: new RegExp(`RT-E2E-DT-${stamp}`) })).toBeVisible();
  });

  test('đường hỏng: isRouter không phải boolean bị API từ chối', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const res = await page.request.post('/api/v1/catalog/device_type', {
      headers: await writeHeaders(page),
      data: { name: `Rác E2E ${Date.now()}`, isRouter: 'có' },
    });
    expect(res.status()).toBe(400);
  });
});
