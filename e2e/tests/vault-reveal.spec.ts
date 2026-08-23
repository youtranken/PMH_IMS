import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  countAudit,
  expireStepUp,
  firstLogin,
  freshTotpCode,
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

async function setUpDeviceWithSecrets(
  page: Page,
  stamp: string,
  secrets: { label: string; value: string }[],
): Promise<{ deviceId: string; ids: string[] }> {
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
      code: `SW-E2E-RV-${stamp}`,
      name: 'Switch có két',
      deviceTypeId: type.id,
      serial: `FOC-RV-${stamp}`,
    },
  });
  const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

  const ids: string[] = [];
  for (const secret of secrets) {
    const created = await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: secret.label,
        value: secret.value,
      },
    });
    expect(created.status()).toBe(201);
    ids.push(((await created.json()) as { id: string }).id);
  }
  return { deviceId, ids };
}

/** Story 4.2 — FR-022: mở két phải gõ TOTP, hiện rồi tự ẩn, mỗi lần một dòng audit. */
test.describe('Mở két với TOTP step-up', () => {
  test('đường hạnh phúc: hết grace → gõ mã → giá trị hiện → xem tiếp secret khác không phải gõ lại', async ({
    page,
  }) => {
    const totpSecret = await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { deviceId } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
      { label: `SSH root E2E ${stamp}`, value: `Ssh#Pass#${stamp}` },
    ]);

    // Enroll TOTP vừa xong đã tính là step-up — đẩy mốc lùi để đúng cảnh "đã quá grace".
    expireStepUp();

    await page.goto(`/thiet-bi/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();

    await page
      .getByRole('row', { name: new RegExp(`admin web E2E ${stamp}`) })
      .getByRole('button', { name: 'Xem' })
      .click();

    // Phải hỏi mã, KHÔNG được hiện giá trị và cũng không được đá về màn đăng nhập.
    await expect(page.getByRole('heading', { name: 'Xác nhận danh tính' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/thiet-bi/${deviceId}`));

    await page.getByLabel('Mã xác thực').fill(await freshTotpCode(totpSecret));
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();

    await expect(page.getByTestId('secret-value')).toHaveText(`Web#Pass#${stamp}`);
    // Toast stack cũng mang role=status — bám vào hộp thoại, không bám toàn trang.
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('Tự ẩn sau');
    await page.getByRole('button', { name: 'Ẩn ngay' }).click();
    await expect(page.getByTestId('secret-value')).toHaveCount(0);

    // Trong grace: xem secret THỨ HAI không phải gõ mã lần nữa.
    await page
      .getByRole('row', { name: new RegExp(`SSH root E2E ${stamp}`) })
      .getByRole('button', { name: 'Xem' })
      .click();
    await expect(page.getByTestId('secret-value')).toHaveText(`Ssh#Pass#${stamp}`);
    await expect(page.getByRole('heading', { name: 'Xác nhận danh tính' })).toHaveCount(0);
  });

  test('đường hỏng: gõ sai mã thì không mở, ô nhập bị xóa để không bấm lại mã cũ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { deviceId } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
    ]);
    expireStepUp();

    await page.goto(`/thiet-bi/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await page.getByRole('button', { name: 'Xem' }).click();

    await page.getByLabel('Mã xác thực').fill('000000');
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();

    await expect(page.getByRole('alert')).toContainText('Mã xác thực không đúng');
    await expect(page.getByTestId('secret-value')).toHaveCount(0);
    await expect(page.getByLabel('Mã xác thực')).toHaveValue('');
  });

  test('phiên hết grace không phải phiên chết: bị hỏi mã chứ không bị đá về đăng nhập', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { ids } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
    ]);
    expireStepUp();

    const denied = await page.request.post(`/api/v1/vault/secrets/${ids[0]}/reveal`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' },
    });
    expect(denied.status()).toBe(401);
    expect(await denied.json()).toMatchObject({ code: 'STEPUP_REQUIRED' });
  });

  test('mỗi lần giải mã = một dòng audit, và response không được lưu đệm', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { ids } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
    ]);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    expect(countAudit('vault.secret.revealed', ids[0])).toBe(0);

    for (let i = 1; i <= 3; i += 1) {
      const opened = await page.request.post(`/api/v1/vault/secrets/${ids[0]}/reveal`, {
        headers,
      });
      expect(opened.status()).toBe(200);
      // Thiếu no-store thì bí mật nằm lại trong đệm trình duyệt — bấm Back ở máy dùng chung
      // là hiện lại, không cần đăng nhập.
      expect(opened.headers()['cache-control']).toContain('no-store');
      expect(((await opened.json()) as { value: string }).value).toBe(`Web#Pass#${stamp}`);
      expect(countAudit('vault.secret.revealed', ids[0])).toBe(i);
    }
  });

  test('Member gọi đường mở két nhận 403, không phải lời mời gõ mã', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { ids } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
    ]);
    await page.getByRole('button', { name: 'Đăng xuất' }).click();

    await firstLogin(page, E2E_MEMBER);
    const denied = await page.request.post(`/api/v1/vault/secrets/${ids[0]}/reveal`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' },
    });
    // 403 chứ KHÔNG phải 401/STEPUP_REQUIRED: Member gõ mã đúng cũng vẫn không được xem.
    expect(denied.status()).toBe(403);
  });

  /**
   * Tự ẩn kiểm bằng ĐÚNG giá trị `secret.reveal_seconds` đang cấu hình, đọc từ chính API —
   * viết cứng 30 ở đây thì đổi cấu hình xong test vẫn xanh trong khi màn hình đã sai (AD-11).
   */
  test('giá trị tự ẩn sau đúng số giây trong system_config', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { deviceId } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
    ]);

    const revealSeconds = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { config: { secretRevealSeconds: number } }).config
        .secretRevealSeconds;
    });
    test.setTimeout((revealSeconds + 40) * 1000);

    await page.goto(`/thiet-bi/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await page.getByRole('button', { name: 'Xem' }).click();
    await expect(page.getByTestId('secret-value')).toBeVisible();

    await expect(page.getByTestId('secret-value')).toHaveCount(0, {
      timeout: (revealSeconds + 10) * 1000,
    });
  });
});
