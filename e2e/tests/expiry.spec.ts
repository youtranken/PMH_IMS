import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetDevices,
  resetIsp,
  resetSoftware,
  resetUsers,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetIsp();
  resetDevices();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

/**
 * Ngày cách hôm nay N ngày, dạng YYYY-MM-DD, tính theo GIỜ ĐỊA PHƯƠNG.
 * Dùng `toISOString()` ở đây là lệch một ngày khi chạy test lúc sáng sớm giờ VN — đúng cái
 * bẫy đã làm lộ ra bug UTC ở server.
 */
function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

async function post(page: Page, url: string, data: Record<string, unknown>) {
  const csrf = await csrfOf(page);
  const response = await page.request.post(url, {
    headers: { 'X-CSRF-Token': csrf, Origin: 'https://localhost' },
    data,
  });
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

test.describe('Cỗ máy Expiry', () => {
  test('gom license + ISP + bảo hành về một màn, sắp theo độ gấp', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;

    // Ba loại, ba mốc khác nhau: ISP gấp nhất, rồi license, rồi bảo hành.
    await post(page, '/api/v1/isp-lines', {
      code: `ISP-E2E-EXP-${stamp}`,
      provider: 'FPT',
      endDate: inDays(3),
    });
    await post(page, '/api/v1/software', {
      code: `LIC-E2E-EXP-${stamp}`,
      name: 'Office',
      kind: 'license',
      endDate: inDays(10),
    });
    await post(page, '/api/v1/devices', {
      code: `PC-E2E-EXP-${stamp}`,
      name: 'Máy bảo hành',
      deviceTypeId: pc.id,
      warrantyEnd: inDays(20),
    });

    await page.goto('/sap-het-han');
    await expect(page.getByRole('heading', { name: 'Sắp hết hạn' })).toBeVisible();

    const rows = page.getByRole('row');
    await expect(page.getByRole('link', { name: new RegExp(`ISP-E2E-EXP-${stamp}`) })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`LIC-E2E-EXP-${stamp}`) })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`PC-E2E-EXP-${stamp}`) })).toBeVisible();

    // Thứ gấp nhất phải nằm trên: ISP (3 ngày) trước license (10 ngày).
    const text = await rows.allInnerTexts();
    const ispAt = text.findIndex((line) => line.includes(`ISP-E2E-EXP-${stamp}`));
    const licAt = text.findIndex((line) => line.includes(`LIC-E2E-EXP-${stamp}`));
    expect(ispAt).toBeGreaterThan(0);
    expect(ispAt).toBeLessThan(licAt);
  });

  test('lọc theo loại — danh sách loại lấy từ API, không viết cứng ở UI', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

    await post(page, '/api/v1/software', {
      code: `SSL-E2E-F-${stamp}`,
      name: 'SSL pmh.com.vn',
      kind: 'ssl',
      endDate: inDays(15),
    });
    await post(page, '/api/v1/software', {
      code: `LIC-E2E-F-${stamp}`,
      name: 'License',
      kind: 'license',
      endDate: inDays(15),
    });

    // API phải khai đủ 6 nguồn: 4 loại phần mềm + ISP + bảo hành thiết bị.
    const kinds = await page.evaluate(async () => {
      const res = await fetch('/api/v1/expiry/kinds', { credentials: 'include' });
      return (await res.json()) as { kind: string; canRenew: boolean }[];
    });
    expect(kinds.map((item) => item.kind).sort()).toEqual([
      'domain',
      'isp',
      'license',
      'maintenance',
      'ssl',
      'warranty',
    ]);
    // Bảo hành thiết bị KHÔNG gia hạn được từ màn này.
    expect(kinds.find((item) => item.kind === 'warranty')?.canRenew).toBe(false);

    await page.goto('/sap-het-han');
    await page.getByRole('button', { name: 'Loại', exact: true }).click();
    await page.getByRole('option', { name: 'Chứng chỉ SSL', exact: true }).click();

    await expect(page.getByRole('link', { name: new RegExp(`SSL-E2E-F-${stamp}`) })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`LIC-E2E-F-${stamp}`) })).toHaveCount(0);
  });

  test('gia hạn từ màn Expiry gọi về module chủ và ghi lịch sử gia hạn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const created = await post(page, '/api/v1/software', {
      code: `LIC-E2E-RENEW-${stamp}`,
      name: 'License gia hạn',
      kind: 'license',
      endDate: inDays(5),
    });
    const id = String(created.body.id);
    const newEnd = inDays(400);

    const result = await post(page, '/api/v1/expiry/renew', {
      kind: 'license',
      id,
      endDate: newEnd,
    });
    expect(result.status).toBe(201);

    // Hồ sơ ở module chủ đã đổi hạn thật.
    const software = await page.evaluate(async (softwareId: string) => {
      const res = await fetch(`/api/v1/software/${softwareId}`, { credentials: 'include' });
      return (await res.json()) as { endDate: string };
    }, id);
    expect(software.endDate).toBe(newEnd);

    // Lịch sử gia hạn dùng chung ghi lại mốc cũ → mốc mới.
    const renewals = await page.evaluate(async () => {
      const res = await fetch('/api/v1/expiry/renewals', { credentials: 'include' });
      return (await res.json()) as { objectId: string; oldEnd: string; newEnd: string }[];
    });
    const entry = renewals.find((row) => row.objectId === id);
    expect(entry?.oldEnd).toBe(inDays(5));
    expect(entry?.newEnd).toBe(newEnd);

    // Và lịch sử của chính module chủ cũng có dòng "Gia hạn".
    await page.goto(`/phan-mem/${id}`);
    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    // Bám vào DÒNG lịch sử, không phải chữ "Gia hạn" chung chung (nút ở đầu trang cũng vậy).
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Gia hạn' }).first(),
    ).toBeVisible();
  });

  test('bảo hành thiết bị không gia hạn được từ màn Expiry', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
    const created = await post(page, '/api/v1/devices', {
      code: `PC-E2E-NOREN-${stamp}`,
      name: 'Máy không gia hạn',
      deviceTypeId: pc.id,
      warrantyEnd: inDays(9),
    });
    const deviceId = (created.body.device as { id: string }).id;

    const blocked = await post(page, '/api/v1/expiry/renew', {
      kind: 'warranty',
      id: deviceId,
      endDate: inDays(400),
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body).toMatchObject({ code: 'EXPIRY_NOT_RENEWABLE' });

    await page.goto('/sap-het-han');
    const row = page.getByRole('row', { name: new RegExp(`PC-E2E-NOREN-${stamp}`) });
    await expect(row.getByText('Sửa trong hồ sơ')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Gia hạn' })).toHaveCount(0);
  });

  test('mục đã QUÁ HẠN vẫn hiện — đó mới là thứ nguy hiểm', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    await post(page, '/api/v1/software', {
      code: `SSL-E2E-OLD-${stamp}`,
      name: 'SSL đã hết hạn',
      kind: 'ssl',
      endDate: inDays(-40),
    });

    await page.goto('/sap-het-han');
    await expect(page.getByRole('link', { name: new RegExp(`SSL-E2E-OLD-${stamp}`) })).toBeVisible();
    await expect(page.getByText(/Quá hạn \d+ ngày/).first()).toBeVisible();
    await expect(page.getByText(/Đã quá hạn: [1-9]/)).toBeVisible();
  });
});
