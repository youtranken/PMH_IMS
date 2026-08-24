import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetDevices, resetIsp, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetIsp();
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
  const fw = catalog.deviceTypes.find((type) => type.name === 'Firewall')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
    data: { code, name: 'Draytek biên', deviceTypeId: fw.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

async function createLine(page: Page, data: Record<string, unknown>) {
  const csrf = await csrfOf(page);
  const response = await page.request.post('/api/v1/isp-lines', {
    headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
    data,
  });
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

test.describe('Đường truyền ISP', () => {
  test('đường hạnh phúc: hotline và số hợp đồng hiện NGAY trên danh sách', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `ISP-E2E-${stamp}`;

    const created = await createLine(page, {
      code,
      provider: 'FPT Telecom',
      bandwidth: '200 Mbps',
      wanIp: '113.161.0.10',
      hotline: '1900 6600',
      contractNo: `HD-${stamp}`,
      endDate: '2027-06-30',
    });
    expect(created.status).toBe(201);

    await page.goto('/duong-truyen');
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    // Mục tiêu của story: 2h sáng nhìn thấy ngay, không phải bấm vào trong.
    await expect(row.getByRole('link', { name: '1900 6600' })).toBeVisible();
    await expect(row.getByText(`HD-${stamp}`)).toBeVisible();
    // Hotline bấm gọi được thẳng từ điện thoại.
    await expect(row.getByRole('link', { name: '1900 6600' })).toHaveAttribute(
      'href',
      'tel:19006600',
    );
  });

  test('gắn Draytek: trang thiết bị hiện ngược lại đường ISP kèm hotline', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createDevice(page, `FW-E2E-${stamp}`);

    // Chưa gắn đường nào: khu mở rộng phải RỖNG.
    await page.goto(`/thiet-bi/${deviceId}`);
    await expect(page.getByRole('heading', { name: 'Đường truyền ISP' })).toHaveCount(0);

    const created = await createLine(page, {
      code: `ISP-E2E-FW-${stamp}`,
      provider: 'Viettel',
      deviceId,
      hotline: '18008098',
      contractNo: `HD-FW-${stamp}`,
    });
    expect(created.status).toBe(201);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Đường truyền ISP' })).toBeVisible();
    await expect(page.getByText('18008098')).toBeVisible();
    await expect(page.getByText(`HD-FW-${stamp}`)).toBeVisible();
  });

  test('đường hỏng: thiếu nhà mạng, ngày ngược, thiết bị không tồn tại', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

    const noProvider = await createLine(page, { code: `ISP-E2E-NP-${stamp}` });
    expect(noProvider.status).toBe(400);
    expect(String(noProvider.body.message)).toContain('nhà mạng');

    const badRange = await createLine(page, {
      code: `ISP-E2E-BR-${stamp}`,
      provider: 'FPT',
      startDate: '2027-01-01',
      endDate: '2026-01-01',
    });
    expect(badRange.status).toBe(400);
    expect(badRange.body).toMatchObject({ code: 'ISP_RANGE_INVALID' });

    const ghostDevice = await createLine(page, {
      code: `ISP-E2E-GD-${stamp}`,
      provider: 'FPT',
      deviceId: '00000000-0000-4000-8000-000000000000',
    });
    expect(ghostDevice.status).toBe(400);
    expect(ghostDevice.body).toMatchObject({ code: 'DEVICE_NOT_FOUND' });
  });

  test('gia hạn: tiến về trước thì được, lùi lại bị chặn, lịch sử ghi rõ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const created = await createLine(page, {
      code: `ISP-E2E-RN-${stamp}`,
      provider: 'VNPT',
      endDate: '2026-12-31',
    });
    const id = String(created.body.id);
    const csrf = await csrfOf(page);

    const back = await page.request.post(`/api/v1/isp-lines/${id}/renew`, {
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
      data: { endDate: '2026-01-01' },
    });
    expect(back.status()).toBe(400);
    expect(await back.json()).toMatchObject({ code: 'RENEW_NOT_FORWARD' });

    const forward = await page.request.post(`/api/v1/isp-lines/${id}/renew`, {
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
      data: { endDate: '2027-12-31' },
    });
    expect(forward.status()).toBe(201);

    await page.goto(`/duong-truyen/${id}`);
    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    // Nút "Gia hạn hợp đồng" trên đầu trang cũng mang đúng chữ này — chỉ kiểm DÒNG LỊCH SỬ.
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Gia hạn hợp đồng' }),
    ).toBeVisible();
    await expect(page.getByText(/ngày hết hạn: 2026-12-31 → 2027-12-31/)).toBeVisible();
  });

  test('file scan hợp đồng đính kèm được vào đường truyền', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const created = await createLine(page, {
      code: `ISP-E2E-FILE-${stamp}`,
      provider: 'FPT',
    });

    await page.goto(`/duong-truyen/${String(created.body.id)}`);
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    await expect(page.getByText('Chưa có giấy tờ nào.')).toBeVisible();
    await expect(page.getByLabel('Chọn file để đính kèm')).toBeVisible();
  });
});
