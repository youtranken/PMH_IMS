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
 *   · ô lọc trong dải (chỉ đường sang dải khác) + Tìm nhanh (Ctrl+K).
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
    await page.getByRole('button', { name: 'Hiện từng IP' }).click();

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
    await expect(dialog.getByRole('combobox', { name: 'Người dùng / phòng ban' })).toHaveValue('');
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

test.describe('Tra IP (NET-005, UX-E19)', () => {
  /*
   * Ô "Tra IP hoặc máy…" cấp trang đã bỏ (UX-E19): trùng Tìm nhanh (Ctrl+K, cùng API, cùng đích —
   * bài Tìm nhanh ở cuối file). Link tới một IP (`?ip=`) vẫn mở đúng dải, đúng dòng; ô lọc trong
   * dải chỉ đường khi người ta gõ IP của dải khác.
   */
  test('link ?ip= → mở đúng dải, tô sáng dòng; ô trống hai bên vẫn gập', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    await page.request.post('/api/v1/ipam/addresses', {
      headers: f.headers,
      data: { subnetId: f.subnetId, address: `${f.net}.200`, usedBy: 'Chị Bình E2E' },
    });

    await page.goto(`/ip-addresses/${f.subnetId}?ip=${f.net}.200`);
    const row = ipRow(page, `${f.net}.200`);
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/row-highlight/);
    await expect(row.getByText('Chị Bình E2E')).toBeVisible();
    // Dòng đang tra không bị gập; ô trống hai bên nó vẫn gập, nên .200 hiện ngay, khỏi lật trang.
    // Dải không khai gateway: .1–.199 và .201–.254 là hai vùng trống.
    const runs = page.getByRole('row').filter({ hasText: 'Hiện từng IP' });
    await expect(runs).toHaveCount(2);
    await expect(runs.first()).toContainText('199 IP trống');
    await expect(runs.last()).toContainText('54 IP trống');
  });

  test('ô lọc trong dải: gõ IP của dải khác → link sang đúng dải, đúng dòng; IP không dải nào chứa → gợi ý Tìm nhanh', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    const other = await page.request.post('/api/v1/ipam/subnets', {
      headers: f.headers,
      data: { cidr: `10.${f.octet}.2.0/24`, name: `LAN khác E2E ${f.stamp}` },
    });
    expect(other.status(), await other.text()).toBe(201);
    const otherId = ((await other.json()) as { id: string }).id;

    await page.goto(`/ip-addresses/${f.subnetId}`);
    const filter = page.getByRole('searchbox', { name: /Lọc trong dải/ });
    await filter.fill(`10.${f.octet}.2.15`);
    await page.getByRole('link', { name: new RegExp(`LAN khác E2E ${f.stamp}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/ip-addresses/${otherId}\\?ip=`));
    await expect(ipRow(page, `10.${f.octet}.2.15`)).toHaveClass(/row-highlight/);

    await filter.fill('203.0.113.77');
    await expect(page.getByText(/Không dải nào chứa 203\.0\.113\.77/)).toBeVisible();
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

  test('bảng IP không tràn ngang; link ?ip= vẫn tới đúng dòng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    await page.request.post('/api/v1/ipam/addresses', {
      headers: f.headers,
      data: { subnetId: f.subnetId, address: `${f.net}.9`, deviceId: f.deviceId },
    });
    await page.goto(`/ip-addresses/${f.subnetId}?ip=${f.net}.9`);
    // ≤600px mỗi IP là một THẺ (PW-B01): dòng 2 có link mã máy.
    const row = page
      .getByRole('listitem')
      .filter({ has: page.getByText(`${f.net}.9`, { exact: true }) });
    await expect(row.getByRole('link', { name: f.deviceCode })).toBeInViewport();
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
