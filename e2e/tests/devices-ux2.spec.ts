import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetUsers, uniqueStamp, writeHeaders } from './helpers';

/*
 * Soát UX đợt 2 — Thiết bị (Q-24): gỡ dây giữ cổng (T-02), lọc theo Phòng ban (T-08),
 * "sửa lần cuối bởi" hiện tên người (T-09). Mọi máy tạo ra mang chữ E2E trong mã để lượt dọn bắt được.
 */

test.beforeEach(() => resetUsers());

async function typeId(page: Page, name: string): Promise<string> {
  const res = await page.request.get('/api/v1/catalog');
  const catalog = (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  return catalog.deviceTypes.find((type) => type.name === name)!.id;
}

async function createDevice(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/v1/devices', { headers: await writeHeaders(page), data });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { device: { id: string } }).device.id;
}

test.describe('Thiết bị — soát UX đợt 2', () => {
  test('T-02: "Gỡ dây (giữ cổng)" bỏ đầu kia, giữ VLAN của cổng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const sw = await typeId(page, 'Switch');
    const swId = await createDevice(page, { code: `SW-E2E-GD${stamp}`, name: 'Switch gỡ dây', deviceTypeId: sw });
    const pcId = await createDevice(page, { code: `PC-E2E-GD${stamp}`, name: 'PC gỡ dây', deviceTypeId: await typeId(page, 'PC') });
    const port = await page.request.post(`/api/v1/devices/${swId}/ports`, {
      headers: await writeHeaders(page),
      data: { portLabel: 'Gi1/0/7', connectedDeviceId: pcId, vlan: '20' },
    });
    expect(port.ok(), await port.text()).toBe(true);

    await page.goto(`/devices/${swId}?tab=ports`);
    await page.getByRole('button', { name: /^Thao tác với Gi1\/0\/7/ }).click();
    await page.getByRole('menuitem', { name: 'Gỡ dây (giữ cổng)' }).click();
    const ask = page.getByRole('dialog', { name: /Gỡ dây khỏi cổng Gi1\/0\/7/ });
    await expect(ask).toContainText('VLAN, người dùng và ghi chú của cổng Gi1/0/7 được giữ');
    await ask.getByRole('button', { name: 'Gỡ dây', exact: true }).click();
    await expect(page.getByText('Đã gỡ dây khỏi cổng Gi1/0/7.')).toBeVisible();
    const rows = (await (await page.request.get(`/api/v1/devices/${swId}/ports`)).json()) as {
      ports: { portLabel: string; connectedDeviceId: string | null; vlan: string | null }[];
    };
    expect(rows.ports).toEqual([expect.objectContaining({ portLabel: 'Gi1/0/7', connectedDeviceId: null, vlan: '20' })]);
  });

  test('T-08 + T-09: lọc theo Phòng ban (?department=); chân Tóm tắt ghi tên người sửa, email khi rê chuột', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const pc = await typeId(page, 'PC');
    const dept = `Phòng E2E UX2 ${stamp}`;
    const inId = await createDevice(page, { code: `PC-E2E-PB${stamp}`, name: 'Trong phòng', deviceTypeId: pc, department: dept });
    await createDevice(page, { code: `PC-E2E-NB${stamp}`, name: 'Ngoài phòng', deviceTypeId: pc });

    await page.goto(`/devices?department=${encodeURIComponent(dept)}`);
    await expect(page.getByRole('button', { name: 'Phòng ban' })).toContainText(dept);
    await expect(page.getByRole('link', { name: `PC-E2E-PB${stamp}` })).toBeVisible();
    await expect(page.getByRole('link', { name: `PC-E2E-NB${stamp}` })).toHaveCount(0);

    await page.goto(`/devices/${inId}`);
    const foot = page.getByText(/sửa lần cuối .* · E2E Super Admin/);
    await expect(foot).toBeVisible();
    await expect(foot).toHaveAttribute('title', E2E_SA.email);
  });
});
