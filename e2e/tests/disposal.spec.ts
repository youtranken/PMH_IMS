import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  isoInDays,
  ispProviderId,
  resetDevices,
  resetIsp,
  resetServiceAccounts,
  resetSoftware,
  resetUsers,
  writeHeaders,
  uniqueStamp,
} from './helpers';

/**
 * Kho thanh lý (28/08/2026) — MỘT chỗ nhìn thấy mọi thứ công ty đã ngừng dùng.
 *
 * Vì sao cần: bốn loại hồ sơ có trạng thái "ngừng dùng" mang tên khác nhau, nằm ở bốn màn
 * khác nhau. Câu "công ty đã bỏ những gì" vì thế không ai trả lời được, dù dữ liệu đã có đủ
 * từ lâu.
 *
 * Bài này khóa ba điều: (1) các loại cùng hiện trong một bảng, (2) đường truyền đã thanh lý
 * cũng vào kho và link về đúng trang của nó (Q-10), và (3) hồ sơ trong kho KHÔNG còn được
 * tính hạn — thứ mà người dùng trông vào để email nhắc gia hạn thôi làm phiền.
 */
test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetSoftware();
  resetServiceAccounts();
  resetIsp();
});

test('ba loại hồ sơ đã ngừng dùng cùng hiện trong một bảng', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const headers = await writeHeaders(page);

  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;

  // 1. Thiết bị → thanh lý
  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: `PC-E2E-DIS-${stamp}`, name: 'Máy cũ', deviceTypeId: pc.id },
  });
  const deviceId = ((await device.json()) as { device: { id: string } }).device.id;
  expect(
    (
      await page.request.patch(`/api/v1/devices/${deviceId}/status`, {
        headers,
        data: { status: 'retired' },
      })
    ).status(),
  ).toBe(200);

  // 2. Phần mềm → bỏ
  const software = await page.request.post('/api/v1/software', {
    headers,
    data: {
      code: `LIC-E2E-DIS-${stamp}`,
      name: 'License hết dùng',
      kind: 'license',
      endDate: isoInDays(20),
    },
  });
  const softwareId = ((await software.json()) as { id: string }).id;
  expect(
    (
      await page.request.patch(`/api/v1/software/${softwareId}`, {
        headers,
        data: { status: 'retired' },
      })
    ).status(),
  ).toBe(200);

  // 3. Tài khoản dịch vụ → vô hiệu hóa (đường riêng, BẮT ghi lý do)
  const account = await page.request.post('/api/v1/service-accounts', {
    headers,
    data: { code: `TK-E2E-DIS-${stamp}`, kind: 'shared', name: 'Tài khoản cũ' },
  });
  const accountId = ((await account.json()) as { id: string }).id;
  expect(
    (
      await page.request.patch(`/api/v1/service-accounts/${accountId}/disable`, {
        headers,
        data: { reason: 'nhân sự đã nghỉ' },
      })
    ).status(),
  ).toBe(200);

  await page.goto('/disposal');
  await expect(page.getByRole('heading', { name: 'Kho thanh lý' })).toBeVisible();
  for (const code of [`PC-E2E-DIS-${stamp}`, `LIC-E2E-DIS-${stamp}`, `TK-E2E-DIS-${stamp}`]) {
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
  }

  // Lọc theo loại: bấm "Thiết bị" thì ba loại kia biến đi.
  await page.getByRole('button', { name: /^Thiết bị \d/ }).click();
  await expect(page.getByRole('row', { name: new RegExp(`PC-E2E-DIS-${stamp}`) })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`LIC-E2E-DIS-${stamp}`) })).toHaveCount(0);

  /*
   * Vẫn mở được hồ sơ gốc: "đã thanh lý" không phải "đã xoá", và người ta mở nó ra chính để
   * đọc lịch sử vì sao bỏ.
   */
  await page.getByRole('link', { name: `PC-E2E-DIS-${stamp}` }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`PC-E2E-DIS-${stamp}`) })).toBeVisible();
});

/**
 * Q-10: đường truyền đã Thanh lý nằm trong kho cùng ba loại kia, mang đúng chữ của màn Đường
 * truyền, và link dẫn về trang chi tiết đường truyền chứ không phải một trang khác cùng id.
 * Đường truyền còn chạy thì KHÔNG vào kho — kho mà lẫn đồ đang dùng thì hết là kho.
 */
test('đường truyền đã thanh lý vào kho, link về đúng trang đường truyền', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const headers = await writeHeaders(page);
  const cut = `ISP-E2E-DIS-${stamp}`;
  const running = `ISP-E2E-RUN-${stamp}`;

  const created = await page.request.post('/api/v1/isp-lines', {
    headers,
    data: {
      code: cut,
      providerId: await ispProviderId(page, 'VNPT E2E'),
      bandwidth: '300 Mbps',
    },
  });
  expect(created.status()).toBe(201);
  const cutId = ((await created.json()) as { id: string }).id;
  expect(
    (
      await page.request.post('/api/v1/isp-lines', {
        headers,
        data: { code: running, providerId: await ispProviderId(page, 'FPT E2E') },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await page.request.patch(`/api/v1/isp-lines/${cutId}`, {
        headers,
        data: { status: 'terminated' },
      })
    ).status(),
  ).toBe(200);

  await page.goto('/disposal');
  const row = page.getByRole('row', { name: new RegExp(cut) });
  await expect(row).toBeVisible();
  await expect(row.getByText('Đường truyền', { exact: true })).toBeVisible();
  await expect(row.getByText('Đã thanh lý', { exact: true })).toBeVisible();
  await expect(row.getByText('300 Mbps')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(running) })).toHaveCount(0);

  // Loại này có nút lọc riêng, như ba loại kia.
  await page.getByRole('button', { name: /^Đường truyền \d/ }).click();
  await expect(row).toBeVisible();

  await row.getByRole('link', { name: cut }).click();
  await expect(page).toHaveURL(new RegExp(`/isp-lines/${cutId}$`));
  await expect(page.getByRole('heading', { name: new RegExp(cut) })).toBeVisible();
});

/**
 * Điều người dùng THẬT SỰ trông vào: bỏ rồi thì thôi nhắc.
 *
 * Hồ sơ trong kho không được tính hạn nữa — nếu nó vẫn lên màn Sắp hết hạn thì email digest
 * cũng vẫn gửi, và một lời nhắc sai vài lần là người ta bỏ qua mọi lời nhắc còn lại.
 */
test('hồ sơ trong kho KHÔNG còn được tính hạn', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const headers = await writeHeaders(page);
  const code = `LIC-E2E-QUIET-${stamp}`;

  const software = await page.request.post('/api/v1/software', {
    headers,
    data: { code, name: 'License sắp hết', kind: 'license', endDate: isoInDays(5) },
  });
  const softwareId = ((await software.json()) as { id: string }).id;

  // Trước khi bỏ: có trong danh sách sắp hết hạn.
  await page.goto('/expiry');
  await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();

  const disposed = await page.request.patch(`/api/v1/software/${softwareId}`, {
    headers,
    data: { status: 'retired' },
  });
  expect(disposed.status()).toBe(200);

  // Sau khi bỏ: biến khỏi màn Sắp hết hạn, nhưng vẫn nằm trong Kho thanh lý.
  await page.goto('/expiry');
  await expect(page.getByRole('row', { name: new RegExp(code) })).toHaveCount(0);
  await page.goto('/disposal');
  await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
});

// `isoInDays` dã chuyển sang `helpers.ts` (24/09) — xem chú thích ở đó về bẫy múi giờ.
