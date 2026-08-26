import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetDevices,
  resetUsers,
  writeHeaders,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetDevices();
});

/**
 * UX-DR2: màn ĐỌC phải dùng được ở 390px — thợ đứng cạnh tủ mạng tra bằng điện thoại.
 * Danh sách và trang chi tiết thiết bị đều là màn đọc.
 */
test('danh sách và chi tiết thiết bị dùng được ở 390px', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = Date.now().toString().slice(-6);
  const code = `PC-E2E-${stamp}`;

  // Tạo qua API: form nhập là màn desktop-only, không phải thứ test ở 390px.
  const csrf = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
    data: {
      code,
      name: 'Máy trạm kế toán',
      deviceTypeId: pc.id,
      assignedTo: 'chị Lan',
      warrantyEnd: '2027-12-31',
    },
  });
  expect(created.status()).toBe(201);
  const deviceId = ((await created.json()) as { device: { id: string } }).device.id;

  await page.goto('/devices');
  await expect(page.getByRole('link', { name: code })).toBeVisible();
  // Bảng gập thành thẻ dọc (.table-stack) — trang không được cuộn ngang.
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.goto(`/devices/${deviceId}`);
  await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
  // Story 2.5 thêm dải tóm tắt nên người dùng hiện ở HAI chỗ (tóm tắt + bảng hồ sơ).
  await expect(page.getByText('chị Lan').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Lịch sử' }).click();
  await expect(page.getByText('Tạo hồ sơ')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

/**
 * G-08 — Story 2.4 AC-2 ghi rõ "bảng pass 390px ở chế độ xem", nhưng bài mobile ở trên chỉ
 * mở tab Lịch sử. Port map mới là bảng rộng nhất của trang thiết bị (cổng · đầu kia · ghi
 * chú), và cũng là thứ người ta tra khi đang đứng cạnh tủ.
 */
test('bảng port map, cả chiều ngược, đọc được ở 390px', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = Date.now().toString().slice(-6);
  const switchCode = `SW-E2E-390-${stamp}`;
  const serverCode = `SRV-E2E-390-${stamp}`;
  const headers = await writeHeaders(page);

  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const make = async (code: string, typeName: string) => {
    const res = await page.request.post('/api/v1/devices', {
      headers,
      data: {
        code,
        name: `${typeName} ${code}`,
        deviceTypeId: catalog.deviceTypes.find((t) => t.name === typeName)!.id,
      },
    });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { device: { id: string } }).device.id;
  };
  const switchId = await make(switchCode, 'Switch');
  const serverId = await make(serverCode, 'Server');

  expect(
    (
      await page.request.post(`/api/v1/devices/${switchId}/ports`, {
        headers,
        data: { portLabel: '24', connectedDeviceId: serverId, note: 'uplink phòng máy chủ' },
      })
    ).status(),
  ).toBe(201);

  await page.goto(`/devices/${switchId}`);
  await page.getByRole('tab', { name: 'Port map' }).click();
  await expect(page.getByText('uplink phòng máy chủ')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  // AD-14: khai một đầu, đầu kia tự hiện — chiều ngược cũng phải đọc được trên điện thoại.
  await page.goto(`/devices/${serverId}`);
  await page.getByRole('tab', { name: 'Port map' }).click();
  await expect(page.getByText(switchCode).first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
