import { expect, test, type Page } from '@playwright/test';
import { NobleCryptoPlugin, ScureBase32Plugin, TOTP } from 'otplib';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  countAudit,
  firstLogin,
  logout,
  resetAccessList,
  resetDevices,
  resetSecrets,
  resetUsers,
  uniqueStamp,
} from './helpers';

/**
 * Ngăn két "Mã 2 lớp" (Q-18): cất khóa / chuỗi otpauth, mở két thấy QR sinh lại + mã 6 số hiện
 * tại. Không lưu ảnh QR; Member không có quyền thì không mở được.
 */

/** Khóa 20 byte (RFC 6238) — đủ dài để bộ sinh mã của bài kiểm không phải nới ngưỡng. */
const SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const generator = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
  period: 30,
  digits: 6,
});

/** Mã của chu kỳ trước, hiện tại, kế tiếp — chịu được lượt gọi rơi đúng mép chu kỳ. */
async function nearbyCodes(): Promise<string[]> {
  const now = Math.floor(Date.now() / 1000);
  return Promise.all(
    [-30, 0, 30].map(async (shift) =>
      String(await generator.generate({ secret: SEED, epoch: now + shift })),
    ),
  );
}

test.beforeEach(() => {
  resetUsers();
  resetAccessList();
  resetSecrets();
  resetDevices();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function createDevice(page: Page, stamp: string): Promise<string> {
  const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const type = catalog.deviceTypes.find((t) => t.name === 'Switch')!;
  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: {
      code: `SW-E2E-TOTP-${stamp}`,
      name: 'Switch có mã 2 lớp',
      deviceTypeId: type.id,
      serial: `FOC-TOTP-${stamp}`,
    },
  });
  expect(device.status()).toBe(201);
  return ((await device.json()) as { device: { id: string } }).device.id;
}

async function storeTotpByApi(page: Page, deviceId: string, label: string, value: string) {
  return page.request.post('/api/v1/vault/secrets', {
    headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
    data: { ownerType: 'device', ownerId: deviceId, kind: 'totp', label, value },
  });
}

test.describe('Két — ngăn Mã 2 lớp', () => {
  test('đường hạnh phúc: cất khóa qua form, Xem hiện QR + mã 6 số đúng, không hỏi mã lần hai', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createDevice(page, stamp);
    const label = `VPN E2E ${stamp}`;

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await page.getByRole('button', { name: 'Cất mật khẩu/khóa' }).click();
    const form = page.getByRole('dialog', { name: /Cất mật khẩu\/khóa/ });
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill(label);
    await form.getByRole('button', { name: 'Loại' }).click();
    await page.getByRole('option', { name: 'Mã 2 lớp' }).click();
    await expect(form.getByText('Đọc từ ảnh QR')).toBeVisible();
    await form
      .getByRole('textbox', { name: 'Giá trị', exact: true })
      .fill(SEED.toLowerCase().replace(/(.{4})/g, '$1 '));
    await form.getByRole('button', { name: 'Lưu' }).click();
    // Vừa đăng nhập bằng mã 6 số = còn trong grace: cất không bị hỏi mã (Q-18).
    await expect(page.getByText('Đã lưu vào két.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Xác nhận danh tính' })).toHaveCount(0);

    const row = page.getByRole('row', { name: new RegExp(label) });
    await expect(row).toContainText('Mã 2 lớp');
    await row.getByRole('button', { name: 'Xem' }).click();

    await expect(page.getByRole('img', { name: /Mã QR/ })).toBeVisible();
    await expect(page.getByRole('img', { name: /Mã QR/ })).toHaveAttribute(
      'src',
      /^data:image\/png;base64,/,
    );
    const shown = (await page.getByTestId('totp-code').innerText()).replace(/\s/g, '');
    expect(shown).toMatch(/^\d{6}$/);
    expect(await nearbyCodes()).toContain(shown);
    await expect(page.getByTestId('totp-code-left')).toContainText(/^\d+s$/);

    // Màn đọc ở 390px (UX-DR2): QR + mã vẫn nằm trong khung, trang không cuộn ngang.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('img', { name: /Mã QR/ })).toBeInViewport();
    await expect(page.getByTestId('totp-code')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    // Khóa che sẵn; bấm mới hiện, đúng khóa đã cất (đã chuẩn hóa hoa, bỏ dấu cách).
    await expect(page.getByTestId('totp-secret')).toHaveCount(0);
    await page.getByRole('button', { name: 'Hiện khóa' }).click();
    await expect(page.getByTestId('totp-secret')).toHaveText(SEED);
    await page.getByRole('button', { name: 'Ẩn ngay' }).click();
    await expect(page.getByRole('img', { name: /Mã QR/ })).toHaveCount(0);
  });

  test('mở qua API: no-store, một dòng audit, nhật ký không mang khóa hay ảnh QR', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createDevice(page, stamp);
    const created = await storeTotpByApi(
      page,
      deviceId,
      `API mã 2 lớp E2E ${stamp}`,
      `otpauth://totp/PMH:e2e?secret=${SEED}&issuer=PMH`,
    );
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    const opened = await page.request.post(`/api/v1/vault/secrets/${id}/reveal`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
    });
    expect(opened.status()).toBe(200);
    expect(opened.headers()['cache-control']).toContain('no-store');
    const body = (await opened.json()) as {
      value: string;
      totp: { secret: string; qrDataUrl: string; codes: string[]; secondsLeft: number };
    };
    expect(body.value).toBe(
      `otpauth://totp/PMH:e2e?secret=${SEED}&issuer=PMH&algorithm=SHA1&digits=6&period=30`,
    );
    expect(body.totp.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(await nearbyCodes()).toContain(body.totp.codes[0]);
    expect(countAudit('vault.secret.revealed', id)).toBe(1);
  });

  test('đường hỏng: khóa sai base32 bị từ chối, thân lỗi không nhắc lại khóa', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createDevice(page, stamp);
    const bad = 'GEZDGNBVGY3TQOJ0GEZDGNBVGY3TQOJ1';
    const res = await storeTotpByApi(page, deviceId, `Sai mã 2 lớp E2E ${stamp}`, bad);
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'TOTP_SEED_INVALID' });
    expect(await res.text()).not.toContain(bad);
  });

  test('TẤN CÔNG: Member không có quyền gọi thẳng đường mở két — 403, không QR, không mã', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createDevice(page, stamp);
    const created = await storeTotpByApi(page, deviceId, `Chặn mã 2 lớp E2E ${stamp}`, SEED);
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    const denied = await page.request.post(`/api/v1/vault/secrets/${id}/reveal`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
    });
    expect(denied.status()).toBe(403);
    const text = await denied.text();
    expect(text).not.toContain(SEED);
    expect(text).not.toContain('data:image');
    expect(countAudit('vault.secret.revealed', id)).toBe(0);
  });
});
