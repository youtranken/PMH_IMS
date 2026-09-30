import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetDevices,
  resetIpam,
  resetUsers,
  writeHeaders,
} from './helpers';

/**
 * Đợt trau chuốt thiết bị + mạng: những chỗ nối dữ liệu giữa các màn.
 *
 *   · DEV-014 — danh sách thiết bị có IP đang giữ dưới mã;
 *   · DEV-045 — nút "Địa chỉ IP 1" của bản đồ quan hệ (máy tính; điện thoại là chip "Đang
 *     giữ") bấm là tới khu Địa chỉ IP;
 *   · NET-017 — hồ sơ IP đã thu hồi ghi "trước: <chủ cũ>";
 *   · NET-086 — đầu dải nói gateway là máy nào.
 */

test.beforeEach(() => {
  resetUsers();
  resetIpam();
  resetDevices();
});

async function setUp(page: Page) {
  const stamp = Date.now().toString().slice(-5);
  const octet = (Number(stamp) % 180) + 30;
  const headers = await writeHeaders(page);
  const catalog = (await (await page.request.get('/api/v1/catalog')).json()) as {
    deviceTypes: { id: string; name: string }[];
  };
  const makeDevice = async (code: string) => {
    const res = await page.request.post('/api/v1/devices', {
      headers,
      data: { code, name: `Máy ${code}`, deviceTypeId: catalog.deviceTypes[0].id },
    });
    expect(res.status(), await res.text()).toBe(201);
    return ((await res.json()) as { device: { id: string } }).device.id;
  };
  const net = `10.${octet}.7`;
  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { cidr: `${net}.0/28`, name: `LAN trau chuot E2E ${stamp}`, gateway: `${net}.1` },
  });
  expect(subnet.status(), await subnet.text()).toBe(201);
  const subnetId = ((await subnet.json()) as { id: string }).id;
  const assign = async (address: string, owner: { deviceId?: string; usedBy?: string }) => {
    const res = await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId, address, ...owner },
    });
    expect(res.status(), await res.text()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const reclaim = async (ipId: string) => {
    const res = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers,
      data: { to: 'free', reason: 'thu hồi E2E' },
    });
    expect(res.status(), await res.text()).toBeLessThan(300);
  };
  return { stamp, net, subnetId, makeDevice, assign, reclaim };
}

test.describe('Thiết bị ↔ IP', () => {
  test('DEV-014 · DEV-045: IP đang giữ hiện dưới mã và trên bản đồ quan hệ; máy không IP thì không', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    const withIp = `PC-E2E-IPSUB-${f.stamp}`;
    const noIp = `PC-E2E-NOIP-${f.stamp}`;
    const withId = await f.makeDevice(withIp);
    await f.makeDevice(noIp);
    await f.assign(`${f.net}.5`, { deviceId: withId });

    await page.goto(`/devices?q=${f.stamp}`);
    const row = page.getByRole('row', { name: new RegExp(withIp) });
    await expect(row.getByText(`${f.net}.5`, { exact: true })).toBeVisible();
    // Đường hỏng: máy không giữ IP nào thì không bịa ra một dòng IP.
    await expect(
      page.getByRole('row', { name: new RegExp(noIp) }).getByText(f.net, { exact: false }),
    ).toHaveCount(0);

    await page.goto(`/devices/${withId}`);
    // Máy tính: MỘT bản "máy đang giữ gì" là bản đồ quan hệ — hàng chip chỉ có ở điện thoại.
    await expect(page.getByRole('group', { name: 'Đang giữ:' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Địa chỉ IP\s*1$/ }).click();
    await expect(page.getByRole('region', { name: 'Địa chỉ IP' })).toBeFocused();
  });
});

test.describe('Sổ IP nối về máy', () => {
  test('NET-017: hồ sơ đã thu hồi ghi chủ cũ — mã máy, hoặc người/bộ phận', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    const code = `PR-E2E-CU-${f.stamp}`;
    const deviceId = await f.makeDevice(code);
    await f.reclaim(await f.assign(`${f.net}.6`, { deviceId }));
    await f.reclaim(await f.assign(`${f.net}.7`, { usedBy: 'Kho E2E' }));
    // Đường hỏng: địa chỉ đang dùng không mang "trước:".
    await f.assign(`${f.net}.8`, { usedBy: 'Phòng IT E2E' });

    await page.goto(`/ip-addresses/${f.subnetId}`);
    await page.getByRole('radio', { name: /^Tất cả/ }).click();
    const row = (address: string) =>
      page.getByRole('row', { name: new RegExp(`^${address.replace(/\./g, '\\.')}\\b`) });
    await expect(row(`${f.net}.6`).getByText(`trước: ${code}`, { exact: false })).toBeVisible();
    await expect(row(`${f.net}.7`).getByText('trước: Kho E2E', { exact: false })).toBeVisible();
    await expect(row(`${f.net}.8`).getByText('trước:', { exact: false })).toHaveCount(0);
  });

  test('NET-086: gateway đang cấp cho một máy thì đầu dải dẫn tới máy đó; chưa cấp thì không', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const f = await setUp(page);
    await page.goto(`/ip-addresses/${f.subnetId}`);
    await expect(page.getByText(`${f.net}.1`, { exact: true }).first()).toBeVisible();
    const code = `FW-E2E-GW-${f.stamp}`;
    await expect(page.getByRole('link', { name: code })).toHaveCount(0);

    await f.assign(`${f.net}.1`, { deviceId: await f.makeDevice(code) });
    await page.reload();
    await page.getByRole('link', { name: code }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(code) })).toBeVisible();
  });
});
