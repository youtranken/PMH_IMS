import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetDevices,
  resetSoftware,
  resetUsers,
  writeHeaders,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetDevices();
});

/**
 * G-09 — Story 3.1 AC-1 ghi thẳng "pass 390px chế độ xem", nhưng không có file mobile nào
 * cho màn phần mềm. Cảnh dùng thật: sếp hỏi "license Office còn hạn tới bao giờ" lúc đang
 * ngồi họp, người trả lời chỉ có cái điện thoại.
 */
test('danh sách phần mềm và tab Máy đang dùng đọc được ở 390px', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = Date.now().toString().slice(-6);
  const headers = await writeHeaders(page);
  const code = `LIC-E2E-M-${stamp}`;
  const deviceCode = `PC-E2E-M-${stamp}`;

  // Dựng qua API: form nhập là màn desktop-only, không phải thứ kiểm ở 390px.
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((t) => t.name === 'PC')!;
  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: deviceCode, name: 'Máy trạm', deviceTypeId: pc.id },
  });
  const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

  const created = await page.request.post('/api/v1/software', {
    headers,
    data: {
      code,
      name: 'Office 365 E2E',
      kind: 'license',
      seatTotal: 5,
      endDate: '2028-12-31',
    },
  });
  expect(created.status()).toBe(201);
  const licenseId = ((await created.json()) as { id: string }).id;
  expect(
    (
      await page.request.post(`/api/v1/software/${licenseId}/assignments`, {
        headers,
        data: { deviceId, overSeatReason: '' },
      })
    ).status(),
  ).toBe(201);

  await page.goto('/phan-mem');
  await expect(page.getByRole('heading', { name: 'Phần mềm' })).toBeVisible();
  await expect(page.getByRole('link', { name: code })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.goto(`/phan-mem/${licenseId}`);
  await page.getByRole('tab', { name: 'Máy đang dùng' }).click();
  await expect(page.getByText(deviceCode)).toBeVisible();
  // Bảng máy đang dùng có cột mã + tên + ngày gán — chỗ dễ tràn nhất của màn này.
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
