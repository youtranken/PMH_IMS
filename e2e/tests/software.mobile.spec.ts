import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetDevices,
  resetSoftware,
  resetUsers,
  timVaChoLoc,
  writeHeaders,
  uniqueStamp,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetDevices();
});

/**
 * AC 3.1 ghi thẳng "pass 390px chế độ xem" cho màn phần mềm. Cảnh dùng thật: sếp hỏi "license Office còn hạn tới bao giờ" lúc đang
 * ngồi họp, người trả lời chỉ có cái điện thoại.
 */
test('danh sách phần mềm và tab Máy đang dùng đọc được ở 390px', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
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

  await page.goto('/software');
  await expect(page.getByRole('heading', { name: 'Phần mềm' })).toBeVisible();
  await expect(page.getByRole('link', { name: code })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.goto(`/software/${licenseId}`);
  await page.getByRole('tab', { name: 'Máy đang dùng' }).click();
  await expect(page.getByText(deviceCode)).toBeVisible();
  // Bảng máy đang dùng có cột mã + tên + ngày gán — chỗ dễ tràn nhất của màn này.
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

/**
 * Bảng ghế (0027) nhiều cột — thứ tràn ngang dễ nhất trong cả hệ thống. Ở 390px nó phải gập
 * thành thẻ dọc CÓ NHÃN: một cột số tiền không nhãn thì đọc ra cũng không biết là chi phí hay
 * số hợp đồng.
 */
test('ghế license ở 390px: thẻ danh sách mở hồ sơ, bảng ghế gập thành thẻ dọc có nhãn', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const headers = await writeHeaders(page);
  const code = `LIC-E2E-MSEAT-${stamp}`;
  const deviceCode = `PC-E2E-MSEAT-${stamp}`;

  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((t) => t.name === 'PC')!;
  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: deviceCode, name: 'Máy trạm kế toán', deviceTypeId: pc.id, assignedTo: 'chị Lan' },
  });
  const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

  const created = await page.request.post('/api/v1/software', {
    headers,
    data: { code, name: 'Office ghế', kind: 'license', seatTotal: 3, endDate: '2028-12-31' },
  });
  const licenseId = ((await created.json()) as { id: string }).id;
  expect(
    (
      await page.request.post(`/api/v1/software/${licenseId}/assignments`, {
        headers,
        data: {
          deviceId,
          cost: 3_500_000,
          contract: `HD-M-${stamp}`,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        },
      })
    ).status(),
  ).toBe(201);

  await page.goto('/software');
  await timVaChoLoc(page, code);
  await expect(page.getByRole('link', { name: code })).toBeVisible();
  /* ≤600px danh sách là thẻ gọn (SW-022), không bung ghế trong thẻ: chạm thẻ mở hồ sơ, ghế
     nằm ở tab Máy đang dùng. */
  await expect(page.getByRole('button', { name: 'Mở rộng dòng' })).toHaveCount(0);
  await page.getByRole('link', { name: code }).click();
  await page.getByRole('tab', { name: /Máy đang dùng/ }).click();

  // Ô chi phí của dòng ghế — dòng tổng "1 máy đang dùng · tổng chi phí …" (SW-057) cũng mang
  // cùng con số nên phải bám vào ô bảng.
  const cost = page.getByRole('cell', { name: /3\.500\.000\s₫/ });
  await expect(cost).toBeVisible();
  await expect(page.getByText(`HD-M-${stamp}`)).toBeVisible();

  // Nhãn cột đi kèm TỪNG ô qua `data-label` + `::before` (cùng nếp với `.table-stack`), vì
  // hàng tiêu đề của lưới bị ẩn ở khổ này. Một cột số tiền không nhãn thì đọc ra cũng không
  // biết là chi phí hay số hợp đồng. Nội dung pseudo-element không nằm trong DOM nên phải
  // hỏi style đã tính, không thể bắt bằng getByText.
  const label = await cost.evaluate((el) => getComputedStyle(el, '::before').content);
  expect(label).toContain('Chi phí');

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
