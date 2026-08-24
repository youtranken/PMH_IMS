import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetDevices, resetSoftware, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetDevices();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function createDevice(page: Page, code: string): Promise<string> {
  const csrf = await csrfOf(page);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
    data: { code, name: `Máy ${code}`, deviceTypeId: pc.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

async function createLicense(page: Page, code: string, seats: number | null): Promise<string> {
  const csrf = await csrfOf(page);
  const created = await page.request.post('/api/v1/software', {
    headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
    data: {
      code,
      name: `License ${code}`,
      kind: 'license',
      seatTotal: seats,
      endDate: '2028-12-31',
    },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

async function assign(
  page: Page,
  softwareId: string,
  deviceId: string,
  overSeatReason?: string,
) {
  const csrf = await csrfOf(page);
  return page.request.post(`/api/v1/software/${softwareId}/assignments`, {
    headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
    data: { deviceId, overSeatReason: overSeatReason ?? '' },
  });
}

test.describe('Gán license theo seat', () => {
  test('đường hạnh phúc: gán → seat tăng → gỡ → bản ghi vẫn còn trong lịch sử', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const licenseId = await createLicense(page, `LIC-E2E-SEAT-${stamp}`, 2);
    const deviceId = await createDevice(page, `PC-E2E-L1-${stamp}`);

    expect((await assign(page, licenseId, deviceId)).status()).toBe(201);

    await page.goto(`/phan-mem/${licenseId}`);
    await expect(page.getByText('1/2').first()).toBeVisible();

    await page.getByRole('tab', { name: 'Máy đang dùng' }).click();
    const row = page.getByRole('row', { name: new RegExp(`PC-E2E-L1-${stamp}`) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Đang dùng')).toBeVisible();

    await row.getByRole('button', { name: 'Gỡ' }).click();
    await page.getByRole('button', { name: 'Đồng ý' }).click();
    await expect(page.getByText('Chưa gán license này vào máy nào.')).toBeVisible();

    // Gỡ KHÔNG xóa dòng: bật "xem cả đã gỡ" là thấy lại, kèm mốc thời gian.
    await page.getByRole('button', { name: 'Xem cả bản ghi đã gỡ' }).click();
    const released = page.getByRole('row', { name: new RegExp(`PC-E2E-L1-${stamp}`) });
    await expect(released).toBeVisible();
    await expect(released.getByText(/Đã gỡ/)).toBeVisible();
  });

  test('vượt seat: chặn lần đầu, cho ghi đè khi có lý do', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const licenseId = await createLicense(page, `LIC-E2E-OVER-${stamp}`, 1);
    const first = await createDevice(page, `PC-E2E-O1-${stamp}`);
    const second = await createDevice(page, `PC-E2E-O2-${stamp}`);

    expect((await assign(page, licenseId, first)).status()).toBe(201);

    // Máy thứ hai vượt seat → 400 kèm lời nhắc phải ghi lý do.
    const blocked = await assign(page, licenseId, second);
    expect(blocked.status()).toBe(400);
    expect(await blocked.json()).toMatchObject({ code: 'SEAT_LIMIT_REACHED' });

    // Có lý do thì vẫn gán được, và kết quả kèm cảnh báo.
    const forced = await assign(page, licenseId, second, 'Sếp duyệt mua thêm seat tuần sau');
    expect(forced.status()).toBe(201);
    expect(String((await forced.json()).warnings)).toContain('vượt seat');

    await page.goto(`/phan-mem/${licenseId}`);
    await page.getByRole('tab', { name: 'Máy đang dùng' }).click();
    await expect(page.getByText('Sếp duyệt mua thêm seat tuần sau')).toBeVisible();
  });

  test('cùng license gán trùng một máy bị chặn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const licenseId = await createLicense(page, `LIC-E2E-DUP-${stamp}`, 5);
    const deviceId = await createDevice(page, `PC-E2E-D1-${stamp}`);

    expect((await assign(page, licenseId, deviceId)).status()).toBe(201);
    const again = await assign(page, licenseId, deviceId);
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'ALREADY_ASSIGNED' });
  });

  test('gỡ rồi gán lại cùng máy là hợp lệ (máy cài lại)', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const licenseId = await createLicense(page, `LIC-E2E-RE-${stamp}`, 5);
    const deviceId = await createDevice(page, `PC-E2E-R1-${stamp}`);
    const csrf = await csrfOf(page);

    const created = await assign(page, licenseId, deviceId);
    const assignmentId = ((await created.json()) as { assignment: { id: string } }).assignment.id;

    const released = await page.request.delete(
      `/api/v1/software/${licenseId}/assignments/${assignmentId}`,
      { headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' } },
    );
    expect(released.status()).toBe(200);

    expect((await assign(page, licenseId, deviceId)).status()).toBe(201);
  });

  test('loại không phải license thì không gán được, và không có tab Máy đang dùng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const csrf = await csrfOf(page);
    const ssl = await page.request.post('/api/v1/software', {
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
      data: { code: `SSL-E2E-NA-${stamp}`, name: 'SSL', kind: 'ssl', endDate: '2027-01-01' },
    });
    const sslId = ((await ssl.json()) as { id: string }).id;
    const deviceId = await createDevice(page, `PC-E2E-NA-${stamp}`);

    const result = await assign(page, sslId, deviceId);
    expect(result.status()).toBe(400);
    expect(await result.json()).toMatchObject({ code: 'NOT_A_LICENSE' });

    await page.goto(`/phan-mem/${sslId}`);
    await expect(page.getByRole('tab', { name: 'Máy đang dùng' })).toHaveCount(0);
  });

  test('trang thiết bị hiện khu "License đang cài" — đúng cơ chế khu mở rộng 2.5', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const licenseId = await createLicense(page, `LIC-E2E-PANEL-${stamp}`, 5);
    const deviceId = await createDevice(page, `PC-E2E-P1-${stamp}`);

    // Chưa gán: khu mở rộng phải RỖNG, không có khối trống treo lơ lửng.
    await page.goto(`/thiet-bi/${deviceId}`);
    await expect(page.getByRole('heading', { name: 'License đang cài' })).toHaveCount(0);

    expect((await assign(page, licenseId, deviceId)).status()).toBe(201);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'License đang cài' })).toBeVisible();
    await expect(page.getByRole('link', { name: `LIC-E2E-PANEL-${stamp}` })).toBeVisible();
  });
});
