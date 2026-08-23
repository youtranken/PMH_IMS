import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetDevices, resetSecrets, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSecrets();
  resetDevices();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

/**
 * UX-DR2 — két sắt là màn ĐỌC (tra "máy này có mật khẩu gì đã cất"), nên phải dùng được ở
 * 390px. Đúng cảnh thật: 2 giờ sáng, đứng trước tủ rack, chỉ có cái điện thoại.
 */
test.describe('Két sắt ở 390px', () => {
  test('bảng secret xếp dọc, đọc được, không tràn ngang', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

    const csrf = await csrfOf(page);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const type = catalog.deviceTypes.find((t) => t.name === 'Switch')!;
    const device = await page.request.post('/api/v1/devices', {
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://localhost' },
      data: {
        code: `SW-E2E-M390-${stamp}`,
        name: 'Switch tầng 2',
        deviceTypeId: type.id,
        serial: `FOC-M390-${stamp}`,
      },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    const label = `admin web E2E ${stamp}`;
    await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://localhost' },
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label,
        username: 'admin',
        value: `M390#${stamp}`,
      },
    });

    await page.goto(`/thiet-bi/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByRole('cell', { name: label })).toBeVisible();
    await expect(page.getByText('Mật khẩu', { exact: true })).toBeVisible();

    // Trang không được cuộn ngang ở 390px.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
