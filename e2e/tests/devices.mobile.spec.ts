import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, resetDevices, resetUsers } from './helpers';

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
    headers: { 'X-CSRF-Token': csrf, Origin: 'https://localhost' },
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

  await page.goto('/thiet-bi');
  await expect(page.getByRole('link', { name: code })).toBeVisible();
  // Bảng gập thành thẻ dọc (.table-stack) — trang không được cuộn ngang.
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.goto(`/thiet-bi/${deviceId}`);
  await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
  await expect(page.getByText('chị Lan')).toBeVisible();
  await page.getByRole('tab', { name: 'Lịch sử' }).click();
  await expect(page.getByText('Tạo hồ sơ')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

function horizontalOverflow(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
