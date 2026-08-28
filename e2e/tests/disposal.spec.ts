import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetDevices,
  resetIsp,
  resetServiceAccounts,
  resetSoftware,
  resetUsers,
  writeHeaders,
} from './helpers';

/**
 * Kho thanh lý (28/08/2026) — MỘT chỗ nhìn thấy mọi thứ công ty đã ngừng dùng.
 *
 * Vì sao cần: bốn loại hồ sơ có bốn trạng thái "ngừng dùng" mang bốn cái tên khác nhau, nằm ở
 * bốn màn khác nhau. Câu "công ty đã bỏ những gì" vì thế không ai trả lời được, dù dữ liệu đã
 * có đủ từ lâu.
 *
 * Bài này khóa đúng hai điều: (1) bốn loại cùng hiện trong một bảng, và (2) hồ sơ trong kho
 * KHÔNG còn được tính hạn — thứ mà người dùng trông vào để email nhắc gia hạn thôi làm phiền.
 */
test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetSoftware();
  resetIsp();
  resetServiceAccounts();
});

test('bốn loại hồ sơ đã ngừng dùng cùng hiện trong một bảng', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = Date.now().toString().slice(-6);
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

  // 3. Đường truyền → cắt
  const isp = await page.request.post('/api/v1/isp-lines', {
    headers,
    data: {
      code: `FTTH-E2E-DIS-${stamp}`,
      provider: 'VNPT',
      endDate: isoInDays(15),
    },
  });
  const ispId = ((await isp.json()) as { id: string }).id;
  expect(
    (
      await page.request.patch(`/api/v1/isp-lines/${ispId}`, {
        headers,
        data: { status: 'terminated' },
      })
    ).status(),
  ).toBe(200);

  // 4. Tài khoản dịch vụ → vô hiệu hóa (đường riêng, BẮT ghi lý do)
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
  for (const code of [
    `PC-E2E-DIS-${stamp}`,
    `LIC-E2E-DIS-${stamp}`,
    `FTTH-E2E-DIS-${stamp}`,
    `TK-E2E-DIS-${stamp}`,
  ]) {
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
 * Điều người dùng THẬT SỰ trông vào: bỏ rồi thì thôi nhắc.
 *
 * Hồ sơ trong kho không được tính hạn nữa — nếu nó vẫn lên màn Sắp hết hạn thì email digest
 * cũng vẫn gửi, và một lời nhắc sai vài lần là người ta bỏ qua mọi lời nhắc còn lại.
 */
test('hồ sơ trong kho KHÔNG còn được tính hạn', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = Date.now().toString().slice(-6);
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

/** Ngày ISO cách hôm nay N ngày — bài kiểm cần hạn tương đối, không phải một ngày cố định. */
function isoInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
