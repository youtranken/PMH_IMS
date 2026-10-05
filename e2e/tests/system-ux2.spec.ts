import { expect, test, type Page } from '@playwright/test';
import { E2E_MEMBER, E2E_SA, firstLogin, resetDevices, resetIpam, resetUsers, sql, uniqueStamp, writeHeaders } from './helpers';

/*
 * Soát UX đợt 2 — Hệ thống (Q-25, 05/10/2026): tham số NAT/break-glass lên màn Tham số (X-02),
 * SA thấy IP đang tạm chặn (X-04, chỉ đọc), link thẳng tới một luật NAT (X-05).
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetIpam();
});

async function natRule(page: Page): Promise<string> {
  const headers = await writeHeaders(page);
  const stamp = uniqueStamp();
  const catalog = (await (await page.request.get('/api/v1/catalog', { headers })).json()) as { deviceTypes: { id: string; name: string }[] };
  const routerType = catalog.deviceTypes.find((t) => t.name === 'Firewall') ?? catalog.deviceTypes[0];
  const router = await page.request.post('/api/v1/devices', { headers, data: { code: `FW-E2E-X5-${stamp}`, name: 'Tường lửa E2E X5', deviceTypeId: routerType.id } });
  expect(router.status(), await router.text()).toBe(201);
  const routerId = ((await router.json()) as { device: { id: string } }).device.id;
  const octet = Number(stamp) % 200;
  const subnet = await page.request.post('/api/v1/ipam/subnets', { headers, data: { cidr: `172.22.${octet}.0/29`, name: `LAN E2E X5 ${stamp}` } });
  expect(subnet.status(), await subnet.text()).toBe(201);
  const subnetId = ((await subnet.json()) as { id: string }).id;
  const ip = await page.request.post('/api/v1/ipam/addresses', { headers, data: { subnetId, address: `172.22.${octet}.5`, usedBy: 'E2E X5' } });
  expect(ip.status(), await ip.text()).toBe(201);
  const rule = await page.request.post('/api/v1/ipam/nat', {
    headers,
    data: { deviceId: routerId, protocol: 'tcp', externalPorts: '18443', internalIp: `172.22.${octet}.5`, internalPort: 443, usedBy: 'E2E X5', reason: `Luật link E2E ${stamp}` },
  });
  expect(rule.status(), await rule.text()).toBe(201);
  return ((await rule.json()) as { id: string }).id;
}

test.describe('Hệ thống — soát UX đợt 2', () => {
  test('X-05: /nat?rule=<id> tô sáng đúng dòng; menu dòng có "Sao chép link"', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const id = await natRule(page);
    await page.goto(`/nat?rule=${id}`);
    const row = page.locator('tr[aria-current="true"]');
    await expect(row).toContainText('18443');
    await row.getByRole('button', { name: /^Thao tác với/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Sao chép link' })).toBeVisible();
  });

  test('X-04: IP đang tạm chặn hiện ở khối "Đang tạm chặn" của màn Tài khoản', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    sql(
      `INSERT INTO login_failure (user_id, ip, failed_attempts, locked_until) SELECT id, '203.0.113.77', 7, now() + interval '1 hour' FROM users WHERE email = '${E2E_MEMBER.email}' ON CONFLICT (user_id, ip) DO UPDATE SET failed_attempts = 7, locked_until = now() + interval '1 hour'`,
    );
    try {
      await page.goto('/admin/accounts');
      const block = page.getByRole('heading', { name: /^Đang tạm chặn · \d+$/ }).locator('xpath=ancestor::section[1]');
      await expect(block).toContainText('203.0.113.77');
      await expect(block).toContainText('E2E Thành viên');
    } finally {
      sql(`DELETE FROM login_failure WHERE ip = '203.0.113.77'`);
    }
  });

  test('X-02: màn Tham số có "Cổng nhạy cảm khi mở ra Internet" và cửa sổ break-glass gần đây', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/settings?group=ipam');
    await expect(page.getByLabel('Cổng nhạy cảm khi mở ra Internet')).toBeVisible();
    await page.goto('/admin/settings?group=approval');
    await expect(page.getByLabel('Đếm yêu cầu mở két gần đây trong')).toBeVisible();
  });
});
