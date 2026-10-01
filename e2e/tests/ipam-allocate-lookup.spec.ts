import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetDevices,
  resetIpam,
  resetUsers,
  rowActionNames,
  sql,
  writeHeaders,
} from './helpers';

/**
 * NET-001 · NET-002 · NET-003 · NET-005 — màn Địa chỉ IP.
 *
 *   · hồ sơ IP phải có thiết bị hoặc người/phòng ban (Q-14): hộp báo lỗi dưới ô, API từ chối;
 *   · MỘT hộp "Cấp IP" cho ô trống lẫn hồ sơ đã thu hồi, có ô Thiết bị ở cả hai;
 *   · cột Thiết bị: mã một dòng, tên máy là dòng phụ;
 *   · ô lọc trong dải + ô "Tra IP hoặc máy…" cấp trang.
 */

test.beforeEach(() => {
  resetUsers();
  resetIpam();
  resetDevices();
});

function esc(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ipRow(page: Page, address: string) {
  return page.getByRole('row', { name: new RegExp(`^${esc(address)}\\b`) });
}

async function setUp(page: Page) {
  const stamp = Date.now().toString().slice(-5);
  const octet = (Number(stamp) % 180) + 30;
  const headers = await writeHeaders(page);
  const catalog = (await (await page.request.get('/api/v1/catalog')).json()) as {
    deviceTypes: { id: string; name: string }[];
  };
  const deviceCode = `SV-E2E-FILE-${stamp}`;
  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: deviceCode, name: 'Máy chủ file E2E', deviceTypeId: catalog.deviceTypes[0].id },
  });
  expect(device.status(), await device.text()).toBe(201);
  const deviceId = ((await device.json()) as { device: { id: string } }).device.id;
  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { cidr: `10.${octet}.1.0/24`, name: `LAN tra cứu E2E ${stamp}` },
  });
  expect(subnet.status(), await subnet.text()).toBe(201);
  const subnetId = ((await subnet.json()) as { id: string }).id;
  return { stamp, octet, headers, deviceCode, deviceId, subnetId, net: `10.${octet}.1` };
}

test.describe('Cấp IP — hồ sơ phải có chủ (NET-001, NET-002)', () => {
  test('đường hỏng: API từ chối hồ sơ không có máy lẫn người dùng, kể cả khi cấp lại', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);

    const empty = await page.request.post('/api/v1/ipam/addresses', {
      headers: f.headers,
      data: { subnetId: f.subnetId, address: `${f.net}.5`, note: 'để dành' },
    });
    expect(empty.status()).toBe(400);
    expect(((await empty.json()) as { code: string }).code).toBe('IP_OWNER_REQUIRED');

    const made = await page.request.post('/api/v1/ipam/addresses', {
      headers: f.headers,
      data: { subnetId: f.subnetId, address: `${f.net}.6`, usedBy: 'Kho E2E' },
    });
    const ipId = ((await made.json()) as { id: string }).id;
    await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers: f.headers,
      data: { to: 'free', reason: 'thu hồi E2E' },
    });
    const relet = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers: f.headers,
      data: { to: 'assigned', usedBy: '' },
    });
    expect(relet.status()).toBe(400);
    expect(((await relet.json()) as { code: string }).code).toBe('IP_OWNER_REQUIRED');
  });

  test('hộp Cấp IP trên ô trống: bấm Cấp khi trống → lỗi dưới ô, không tạo hồ sơ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    const address = `${f.net}.7`;
    await page.goto(`/ip-addresses/${f.subnetId}`);

    await ipRow(page, address).getByRole('button', { name: 'Cấp IP', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Cấp IP — ${address}` });
    await dialog.getByRole('button', { name: 'Cấp IP', exact: true }).click();
    await expect(
      dialog.getByText('Chọn thiết bị hoặc nhập người/phòng ban dùng IP này.'),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(
      sql(`SELECT count(*) FROM ip_address WHERE host(address) = '${address}'`),
      'bấm Cấp khi trống không được đẻ ra hồ sơ mồ côi',
    ).toBe('0');

    // Chọn máy rồi cấp: đúng MỘT hộp, có ô Thiết bị, nút chính "Cấp IP".
    await dialog.getByRole('combobox', { name: 'Thiết bị' }).fill(f.deviceCode);
    await page.getByRole('option', { name: new RegExp(f.deviceCode) }).click();
    await dialog.getByRole('button', { name: 'Cấp IP', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // NET-003: mã máy một dòng + tên máy là dòng phụ.
    const row = ipRow(page, address);
    await expect(row.getByRole('link', { name: f.deviceCode })).toBeVisible();
    await expect(row.getByText('Máy chủ file E2E')).toBeVisible();
    const link = row.getByRole('link', { name: f.deviceCode });
    const box = await link.boundingBox();
    const lineHeight = await link.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect(box!.height, 'mã máy không được gãy thành nhiều dòng').toBeLessThan(lineHeight * 1.5);
  });

  test('hồ sơ đã thu hồi: mờ như ô trống, nút Cấp IP mở CÙNG hộp có ô Thiết bị', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    const address = `${f.net}.8`;
    const made = await page.request.post('/api/v1/ipam/addresses', {
      headers: f.headers,
      data: { subnetId: f.subnetId, address, usedBy: 'Chủ cũ E2E' },
    });
    const ipId = ((await made.json()) as { id: string }).id;
    await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers: f.headers,
      data: { to: 'free', reason: 'thu hồi E2E' },
    });

    await page.goto(`/ip-addresses/${f.subnetId}`);
    const row = ipRow(page, address);
    await expect(row.getByText('Trống', { exact: true })).toBeVisible();
    expect(await rowActionNames(page, address)).toEqual(['Lịch sử', 'Xóa']);

    await row.getByRole('button', { name: 'Cấp IP', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Cấp IP — ${address}` });
    await expect(dialog.getByRole('combobox', { name: 'Thiết bị' })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Người / phòng ban dùng' })).toHaveValue('');
    await dialog.getByRole('combobox', { name: 'Thiết bị' }).fill(f.deviceCode);
    await page.getByRole('option', { name: new RegExp(f.deviceCode) }).click();
    await dialog.getByRole('textbox', { name: 'Lý do' }).fill('cấp lại E2E');
    await dialog.getByRole('button', { name: 'Cấp IP', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row.getByText('Đang dùng')).toBeVisible();
    await expect(row.getByRole('link', { name: f.deviceCode })).toBeVisible();

    // Cấp lại đi đường transition: lịch sử nối tiếp trên CÙNG hồ sơ, không mở hồ sơ mới.
    expect(sql(`SELECT count(*) FROM ip_address WHERE host(address) = '${address}'`)).toBe('1');
  });
});

test.describe('Tra IP và máy (NET-005)', () => {
  test('gõ một IP ở ô tra cấp trang → mở đúng dải, đúng trang, tô sáng dòng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    await page.request.post('/api/v1/ipam/addresses', {
      headers: f.headers,
      data: { subnetId: f.subnetId, address: `${f.net}.200`, usedBy: 'Chị Bình E2E' },
    });

    await page.goto('/ip-addresses');
    const lookup = page.getByRole('searchbox', { name: 'Tra IP hoặc máy…' });
    await lookup.fill(`${f.net}.200`);
    await lookup.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/ip-addresses/${f.subnetId}\\?ip=`));
    const row = ipRow(page, `${f.net}.200`);
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/row-highlight/);
    await expect(row.getByText('Chị Bình E2E')).toBeVisible();
    // .200 nằm ở trang 4 của một /24 (50 dòng/trang).
    await expect(page.getByRole('navigation', { name: 'Trang' }).getByText(/151–200/)).toBeVisible();
  });

  test('gõ mã máy ở ô tra → liệt kê IP của máy và IP ghi tên máy, bấm là tới đúng dòng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    // Một máy chỉ giữ một IP (Q-20): .11 gắn máy, .12 chỉ ghi tên máy ở ô người dùng.
    for (const [host, owner] of [
      [11, { deviceId: f.deviceId }],
      [12, { usedBy: `Cổng phụ ${f.deviceCode}` }],
    ] as const) {
      const res = await page.request.post('/api/v1/ipam/addresses', {
        headers: f.headers,
        data: { subnetId: f.subnetId, address: `${f.net}.${host}`, ...owner },
      });
      expect(res.status(), await res.text()).toBe(201);
    }

    await page.goto('/ip-addresses');
    const lookup = page.getByRole('searchbox', { name: 'Tra IP hoặc máy…' });
    await lookup.fill(f.deviceCode);
    await page.getByRole('button', { name: 'Tra', exact: true }).click();
    const results = page.getByRole('region', { name: `IP khớp "${f.deviceCode}"` });
    await expect(results.getByRole('link', { name: `${f.net}.11` })).toBeVisible();
    await expect(results.getByRole('link', { name: `${f.net}.12` })).toBeVisible();

    await results.getByRole('link', { name: `${f.net}.12` }).click();
    await expect(ipRow(page, `${f.net}.12`)).toHaveClass(/row-highlight/);
  });

  test('đường hỏng: IP không thuộc dải nào → nói rõ, không nhảy lung tung', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await setUp(page);
    await page.goto('/ip-addresses');
    const lookup = page.getByRole('searchbox', { name: 'Tra IP hoặc máy…' });
    await lookup.fill('203.0.113.77');
    await lookup.press('Enter');
    await expect(page.getByText('Không dải nào đang dùng chứa 203.0.113.77.')).toBeVisible();
  });

  test('ô lọc trong dải: gõ tên người → chỉ còn dòng của họ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    await page.request.post('/api/v1/ipam/addresses', {
      headers: f.headers,
      data: { subnetId: f.subnetId, address: `${f.net}.53`, usedBy: 'Chị Bình — Kế toán E2E' },
    });
    await page.goto(`/ip-addresses/${f.subnetId}`);
    await page.getByRole('searchbox', { name: /Lọc trong dải/ }).fill('chi binh');
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
    await expect(ipRow(page, `${f.net}.53`)).toBeVisible();
  });
});

test.describe('Tìm nhanh (Ctrl+K) tra IP và dải mạng (SHELL-015)', () => {
  test('gõ IP → nhóm "Địa chỉ IP" đứng đầu, Enter mở đúng dải ở đúng dòng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    await page.request.post('/api/v1/ipam/addresses', {
      headers: f.headers,
      data: { subnetId: f.subnetId, address: `${f.net}.77`, deviceId: f.deviceId },
    });
    await page.goto('/');
    // Ctrl+K do listener gắn lên `document` sau khi app dựng xong — gõ sớm là phím rơi mất.
    await expect(page.getByRole('navigation', { name: /Điều hướng/ })).toBeVisible();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Tìm nhanh' });
    await expect(palette.getByRole('combobox')).toHaveAttribute(
      'placeholder',
      'Tìm mã, tên, serial, IP…',
    );
    await palette.getByRole('combobox').fill(`${f.net}.77`);
    const ipGroup = palette.getByRole('group', { name: 'Địa chỉ IP' });
    await expect(ipGroup.getByRole('option', { name: new RegExp(f.deviceCode) })).toBeVisible();
    await expect(palette.getByRole('group').first()).toHaveAttribute('aria-label', 'Địa chỉ IP');

    await palette.getByRole('combobox').press('Enter');
    await expect(page).toHaveURL(new RegExp(`/ip-addresses/${f.subnetId}\\?ip=`));
    await expect(ipRow(page, `${f.net}.77`)).toHaveClass(/row-highlight/);
  });

  test('gõ tên dải → nhóm "Dải mạng"; IP trống vẫn chỉ ra dải chứa nó', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    await page.goto('/');
    // Ctrl+K do listener gắn lên `document` sau khi app dựng xong — gõ sớm là phím rơi mất.
    await expect(page.getByRole('navigation', { name: /Điều hướng/ })).toBeVisible();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Tìm nhanh' });
    await palette.getByRole('combobox').fill(`tra cuu E2E ${f.stamp}`);
    await expect(
      palette.getByRole('group', { name: 'Dải mạng' }).getByRole('option', { name: /10\./ }),
    ).toBeVisible();

    await palette.getByRole('combobox').fill(`${f.net}.250`);
    await expect(
      palette
        .getByRole('group', { name: 'Địa chỉ IP' })
        .getByRole('option', { name: new RegExp(`Trống.*LAN tra cứu E2E ${f.stamp}`) }),
    ).toBeVisible();
  });
});

test.describe('390px — màn đọc trên điện thoại', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('ô tra và bảng IP không tràn ngang; tra IP vẫn tới đúng dòng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    await page.request.post('/api/v1/ipam/addresses', {
      headers: f.headers,
      data: { subnetId: f.subnetId, address: `${f.net}.9`, deviceId: f.deviceId },
    });
    await page.goto('/ip-addresses');
    const lookup = page.getByRole('searchbox', { name: 'Tra IP hoặc máy…' });
    await expect(lookup).toBeVisible();
    await lookup.fill(`${f.net}.9`);
    await lookup.press('Enter');
    // Ở 390px bảng gập thành thẻ: tên dòng mở đầu bằng nhãn "Địa chỉ", nên không neo `^` được.
    const row = page
      .getByRole('row')
      .filter({ has: page.getByText(`${f.net}.9`, { exact: true }) });
    await expect(row.getByRole('link', { name: f.deviceCode })).toBeInViewport();
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
