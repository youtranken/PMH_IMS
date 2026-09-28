import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetDevices,
  resetIpam,
  resetUsers,
  timVaChoLoc,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Mảng thiết bị — đợt sửa giao diện mức cao (Q-14). Mỗi nhóm canh một lỗi đã thấy trên ảnh
 * chụp màn thật ở 1280px có sidebar.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetIpam();
});

async function deviceTypeId(page: Page, name: string): Promise<string> {
  const res = await page.request.get('/api/v1/catalog');
  const catalog = (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  return (catalog.deviceTypes.find((t) => t.name === name) ?? catalog.deviceTypes[0]).id;
}

async function createDevice(
  page: Page,
  data: { code: string; name: string; type?: string } & Record<string, unknown>,
): Promise<string> {
  const { type, ...rest } = data;
  const created = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { ...rest, deviceTypeId: await deviceTypeId(page, type ?? 'PC') },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

/** Cấp một IP cho máy. Tên dải mang chữ E2E để `reset-e2e.mjs` dọn được. */
async function assignIp(page: Page, deviceId: string, stamp: string): Promise<string> {
  const headers = await writeHeaders(page);
  const octet = Number(stamp) % 200;
  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { cidr: `172.23.${octet}.0/28`, name: `LAN E2E tim IP ${stamp}` },
  });
  expect(subnet.status(), await subnet.text()).toBe(201);
  const subnetId = ((await subnet.json()) as { id: string }).id;
  const address = `172.23.${octet}.5`;
  const ip = await page.request.post('/api/v1/ipam/addresses', {
    headers,
    data: { subnetId, address, deviceId },
  });
  expect(ip.status(), await ip.text()).toBe(201);
  return address;
}

test.describe('DEV-013 · tìm thiết bị theo IP, người sử dụng, bộ phận', () => {
  test('đường hạnh phúc: gõ IP hoặc tên người dùng ra đúng máy', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-TIM-${stamp}`;
    const deviceId = await createDevice(page, {
      code,
      name: 'Máy trạm',
      assignedTo: 'Chị Bình',
      department: 'Phòng Kế hoạch',
    });
    const address = await assignIp(page, deviceId, stamp);

    await page.goto('/devices');
    // Placeholder nói đúng những gì ô tìm làm được.
    await expect(
      page.getByRole('searchbox', { name: 'Tìm mã, tên, serial, IP hoặc người dùng' }),
    ).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(code) });

    await timVaChoLoc(page, address);
    await expect(row).toBeVisible();
    await timVaChoLoc(page, 'chi binh');
    await expect(row).toBeVisible();
    await timVaChoLoc(page, 'ke hoach');
    await expect(row).toBeVisible();
  });

  test('đường hỏng: IP chưa cấp cho máy nào thì nói không khớp, không chỉ bừa', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-TIM-${stamp}`;
    const deviceId = await createDevice(page, { code, name: 'Máy trạm' });
    const address = await assignIp(page, deviceId, stamp);
    // Cùng dải, khác địa chỉ: gõ đủ 4 nhóm là khớp ĐÚNG, không khớp theo tiền tố.
    const other = address.replace(/\.5$/, '.9');

    await page.goto('/devices');
    await timVaChoLoc(page, other);
    await expect(page.getByRole('row', { name: new RegExp(code) })).toHaveCount(0);
    await expect(page.getByText('Không có thiết bị nào khớp bộ lọc.')).toBeVisible();
  });
});
