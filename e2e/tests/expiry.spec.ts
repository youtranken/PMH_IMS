import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  ispProviderId,
  resetDevices,
  resetIsp,
  resetSoftware,
  resetUsers,
  sql,
  uniqueStamp,
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
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data,
  });
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

test.describe('Cỗ máy Expiry', () => {
  test('gom SSL + license + bảo hành về một màn, sắp theo độ gấp; ISP không có mặt', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;

    // Ba loại, ba mốc khác nhau: SSL gấp nhất, rồi license, rồi bảo hành.
    await post(page, '/api/v1/software', {
      code: `SSL-E2E-EXP-${stamp}`,
      name: 'SSL pmh.com.vn',
      kind: 'ssl',
      endDate: inDays(3),
    });
    // Đường truyền không có hạn (Q-04) — có mặt trong DB nhưng không được lên màn này.
    const isp = await post(page, '/api/v1/isp-lines', {
      code: `ISP-E2E-EXP-${stamp}`,
      providerId: await ispProviderId(page, 'FPT E2E'),
    });
    expect(isp.status).toBe(201);
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

    await page.goto('/expiry');
    await expect(page.getByRole('heading', { name: 'Sắp hết hạn' })).toBeVisible();

    const rows = page.getByRole('row');
    await expect(page.getByRole('link', { name: new RegExp(`SSL-E2E-EXP-${stamp}`) })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`LIC-E2E-EXP-${stamp}`) })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`PC-E2E-EXP-${stamp}`) })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`ISP-E2E-EXP-${stamp}`) })).toHaveCount(0);

    // Thứ gấp nhất phải nằm trên: SSL (3 ngày) trước license (10 ngày).
    const text = await rows.allInnerTexts();
    const sslAt = text.findIndex((line) => line.includes(`SSL-E2E-EXP-${stamp}`));
    const licAt = text.findIndex((line) => line.includes(`LIC-E2E-EXP-${stamp}`));
    expect(sslAt).toBeGreaterThan(0);
    expect(sslAt).toBeLessThan(licAt);
  });

  test('lọc theo loại — danh sách loại lấy từ API, không viết cứng ở UI', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

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
    await post(page, '/api/v1/software', {
      code: `DOM-E2E-F-${stamp}`,
      name: 'Tên miền pmh.com.vn',
      kind: 'domain',
      endDate: inDays(15),
    });

    // API phải khai đủ 6 nguồn: 5 loại phần mềm (cả "Khác" — Q-14) + bảo hành thiết bị. Đường
    // truyền không có hạn nên không phải một nguồn (Q-04).
    const kinds = await page.evaluate(async () => {
      const res = await fetch('/api/v1/expiry/kinds', { credentials: 'include' });
      return (await res.json()) as { kind: string; canRenew: boolean }[];
    });
    expect(kinds.map((item) => item.kind).sort()).toEqual([
      'domain',
      'license',
      'maintenance',
      'other',
      'ssl',
      'warranty',
    ]);
    // Bảo hành thiết bị KHÔNG gia hạn được từ màn này.
    expect(kinds.find((item) => item.kind === 'warranty')?.canRenew).toBe(false);

    await page.goto('/expiry');
    const kindGroup = page.getByRole('group', { name: 'Loại', exact: true });
    await kindGroup.getByRole('button', { name: 'Chứng chỉ SSL', exact: true }).click();

    await expect(page.getByRole('link', { name: new RegExp(`SSL-E2E-F-${stamp}`) })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`LIC-E2E-F-${stamp}`) })).toHaveCount(0);
    await expect(page.getByRole('link', { name: new RegExp(`DOM-E2E-F-${stamp}`) })).toHaveCount(0);

    // Chọn thêm loại thứ hai: SSL + Tên miền cùng lúc, license vẫn bị lọc ra.
    await kindGroup.getByRole('button', { name: 'Tên miền', exact: true }).click();
    await expect(page).toHaveURL(/kinds=ssl%2Cdomain|kinds=ssl,domain/);
    await expect(page.getByRole('link', { name: new RegExp(`DOM-E2E-F-${stamp}`) })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`SSL-E2E-F-${stamp}`) })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`LIC-E2E-F-${stamp}`) })).toHaveCount(0);

    // "Mọi loại" gỡ mọi lựa chọn.
    await kindGroup.getByRole('button', { name: 'Mọi loại', exact: true }).click();
    await expect(page.getByRole('link', { name: new RegExp(`LIC-E2E-F-${stamp}`) })).toBeVisible();
  });

  test('gia hạn từ màn Expiry gọi về module chủ và ghi lịch sử gia hạn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
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
    await page.goto(`/software/${id}`);
    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    // Bám vào DÒNG lịch sử, không phải chữ "Gia hạn" chung chung (nút ở đầu trang cũng vậy).
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Gia hạn' }).first(),
    ).toBeVisible();
  });

  /** Q-15: gia hạn từ màn Sắp hết hạn cũng ghi số hợp đồng + chi phí vào sổ gia hạn. */
  test('gia hạn từ màn Sắp hết hạn ghi số hợp đồng + chi phí vào sổ gia hạn', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-EXPHD-${stamp}`;
    const contract = `HD-E2E-EXP-${stamp}`;
    const created = await post(page, '/api/v1/software', {
      code,
      name: 'License gia hạn từ màn hạn',
      kind: 'license',
      endDate: inDays(5),
    });
    const id = String(created.body.id);

    await page.goto('/expiry');
    const row = page.getByRole('row', { name: new RegExp(code) });
    await row.getByRole('button', { name: 'Gia hạn' }).click();
    const dialog = page.getByRole('dialog', { name: `Gia hạn ${code}` });
    await dialog.getByRole('button', { name: '+1 năm', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Số hợp đồng', exact: true }).fill(contract);
    await dialog.getByRole('textbox', { name: 'Chi phí kỳ mới', exact: true }).fill('4tr');
    const renewed = page.waitForResponse((r) => r.url().endsWith('/expiry/renew'));
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
    expect((await renewed).status()).toBeLessThan(300);
    await expect(page.getByText(new RegExp(`^Đã gia hạn ${code} tới`))).toBeVisible();

    expect(
      sql(`SELECT contract || '|' || cost FROM renewal_history WHERE object_id = '${id}'`),
    ).toBe(`${contract}|4000000`);
  });

  test('gia hạn từ màn Sắp hết hạn: chi phí âm bị từ chối, sổ và hạn không đổi', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const created = await post(page, '/api/v1/software', {
      code: `LIC-E2E-EXPAM-${stamp}`,
      name: 'License chi phí âm',
      kind: 'license',
      endDate: inDays(5),
    });
    const id = String(created.body.id);

    const bad = await post(page, '/api/v1/expiry/renew', {
      kind: 'license',
      id,
      endDate: inDays(400),
      contract: `HD-E2E-AM-${stamp}`,
      cost: -1,
    });
    expect(bad.status).toBe(400);
    expect(sql(`SELECT count(*) FROM renewal_history WHERE object_id = '${id}'`)).toBe('0');
    expect(sql(`SELECT end_date::text FROM software WHERE id = '${id}'`)).toBe(inDays(5));
  });

  test('bảo hành thiết bị không gia hạn được từ màn Expiry', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
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

    await page.goto('/expiry');
    const row = page.getByRole('row', { name: new RegExp(`PC-E2E-NOREN-${stamp}`) });
    await expect(row.getByRole('link', { name: 'Mở hồ sơ →' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Gia hạn' })).toHaveCount(0);
  });

  test('mục đã QUÁ HẠN vẫn hiện — đó mới là thứ nguy hiểm', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    await post(page, '/api/v1/software', {
      code: `SSL-E2E-OLD-${stamp}`,
      name: 'SSL đã hết hạn',
      kind: 'ssl',
      endDate: inDays(-40),
    });

    await page.goto('/expiry');
    await expect(page.getByRole('link', { name: new RegExp(`SSL-E2E-OLD-${stamp}`) })).toBeVisible();
    await expect(page.getByText(/Quá hạn \d+ ngày/).first()).toBeVisible();
    /* Ô số ở đầu màn là "số to đứng trước, nhãn nhỏ bên dưới" và bấm được để lọc — không phải
       khuôn "Đã quá hạn: 4". */
    await expect(
      page.getByRole('button', { name: /[1-9]\d*\s*Đã quá hạn/ }),
    ).toHaveCount(1);
  });

  /**
   * BỘ LỌC MÀN SẮP HẾT HẠN SỐNG TRÊN THANH ĐỊA CHỈ.
   *
   * Ba bộ lọc của màn này — cửa sổ nhìn tới, loại hạn, và ô số — không được nằm trong
   * `useState`: `docs/SHARED-REGISTRY.md` viết thẳng: "Cấm quay lại `useState` cho bốn
   * thứ đó — mất bộ lọc khi F5, không gửi được link, và bấm Back từ trang chi tiết rơi về một
   * danh sách trắng."
   *
   * Bài này canh đúng ba lời hứa ấy, bằng ba thao tác người dùng thật làm: bấm lọc, F5, và
   * bấm Back từ hồ sơ vừa mở.
   */
  test('bộ lọc lên URL: F5 còn nguyên, Back từ hồ sơ về đúng bảng đã lọc', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    await post(page, '/api/v1/software', {
      code: `SSL-E2E-URL-${stamp}`,
      name: 'SSL cho bai kiem URL',
      kind: 'ssl',
      endDate: inDays(-3),
    });

    await page.goto('/expiry');
    const linkRow = page.getByRole('link', { name: new RegExp(`SSL-E2E-URL-${stamp}`) });
    await expect(linkRow).toBeVisible();

    // Bấm ô "Đã quá hạn" → trạng thái phải hiện lên thanh địa chỉ, không nằm trong bộ nhớ.
    await page.getByRole('button', { name: /\d+\s*Đã quá hạn/ }).click();
    await expect(page).toHaveURL(/[?&]state=expired/);

    // F5: bộ lọc còn nguyên, và dòng vẫn ở đó.
    await page.reload();
    await expect(page).toHaveURL(/[?&]state=expired/);
    await expect(linkRow).toBeVisible();

    // Mở hồ sơ rồi bấm Back — không được rơi về một bảng chưa lọc.
    await linkRow.click();
    await expect(page).toHaveURL(/\/software\//);
    await page.goBack();
    await expect(page).toHaveURL(/[?&]state=expired/);
    await expect(linkRow).toBeVisible();
  });
});
