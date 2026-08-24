import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  expireStepUp,
  firstLogin,
  freshTotpCode,
  horizontalOverflow,
  resetDevices,
  resetSecrets,
  resetUsers,
} from './helpers';

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
  /**
   * UX-DR2 cho ĐƯỜNG MỞ KÉT (4.2). Đây đúng là cảnh dùng thật của tính năng này: 2 giờ sáng,
   * đứng trước tủ rack, cầm điện thoại, phải ĐỌC một chuỗi mật khẩu rồi gõ lại trong 30 giây.
   * `.secret-value` cố ý để chữ to + giãn ký tự cho dễ đọc — đúng thứ dễ tràn ngang ở 390px
   * mà không có test nào bắt được (code review Epic 4, finding 5).
   */
  test('hộp nhập mã và hộp hiện giá trị đọc được ở 390px, không tràn ngang', async ({ page }) => {
    const totpSecret = await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { deviceId } = await createDeviceWithSecret(page, stamp, {
      label: `mat khau rat dai E2E ${stamp}`,
      // Chuỗi dài, có ký tự đặc biệt: mật khẩu thiết bị thật trông đúng như vậy.
      value: `Qw3rty!@#$%^&*()_+-=[]{}|;:,.<>?~E2E-${stamp}`,
    });
    expireStepUp();

    await page.goto(`/thiet-bi/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await page.getByRole('button', { name: 'Xem' }).click();

    await expect(page.getByRole('heading', { name: 'Xác nhận danh tính' })).toBeVisible();
    await expect(page.getByLabel('Mã xác thực')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await page.getByLabel('Mã xác thực').fill(await freshTotpCode(totpSecret));
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();

    await expect(page.getByTestId('secret-value')).toBeVisible();
    // Chuỗi phải ngắt dòng trong khung, không đẩy cả trang rộng ra.
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: 'Ẩn ngay' })).toBeVisible();
  });
});


async function createDeviceWithSecret(
  page: Page,
  stamp: string,
  secret: { label: string; value: string },
): Promise<{ deviceId: string }> {
  const csrf = await csrfOf(page);
  const headers = { 'X-CSRF-Token': csrf, Origin: 'https://localhost' };
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const type = catalog.deviceTypes.find((t) => t.name === 'Switch')!;
  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: {
      code: `SW-E2E-M390S-${stamp}`,
      name: 'Switch tủ rack',
      deviceTypeId: type.id,
      serial: `FOC-M390S-${stamp}`,
    },
  });
  const deviceId = ((await device.json()) as { device: { id: string } }).device.id;
  await page.request.post('/api/v1/vault/secrets', {
    headers,
    data: { ownerType: 'device', ownerId: deviceId, kind: 'password', ...secret },
  });
  return { deviceId };
}
