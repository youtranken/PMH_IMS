import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetDevices, resetIpam, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetIpam();
  resetDevices();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

/**
 * UX-DR2 — sổ NAT là màn ĐỌC, và là màn dễ tràn ngang nhất của cả hệ thống: sáu cột, trong
 * đó cột Lý do là văn xuôi. Đúng cảnh dùng thật: auditor ngồi cạnh, mình cầm điện thoại.
 */
test.describe('Sổ NAT ở 390px', () => {
  test('bảng NAT xếp dọc, đọc đủ port/lý do/người dùng, không tràn ngang', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const type = catalog.deviceTypes[0];
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: `RT-E2E-M390-${stamp}`, name: 'Draytek', deviceTypeId: type.id },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    const octet = Number(stamp) % 200;
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.16.${octet}.0/29`, name: `LAN NAT 390 E2E ${stamp}` },
    });
    const subnetId = ((await subnet.json()) as { id: string }).id;
    await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId, address: `172.16.${octet}.5`, usedBy: 'Máy chấm công' },
    });
    await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: {
        deviceId,
        protocol: 'tcp',
        externalPorts: '8000-8010',
        internalIp: `172.16.${octet}.5`,
        internalPort: 80,
        usedBy: 'Phòng Nhân sự tầng 3',
        reason: 'phần mềm chấm công cần truy cập từ ngoài văn phòng khi đi công tác',
      },
    });

    await page.goto('/so-nat');
    await expect(page.getByText('TCP 8000-8010')).toBeVisible();
    await expect(page.getByText('Phòng Nhân sự tầng 3')).toBeVisible();
    await expect(page.getByText(/phần mềm chấm công cần truy cập/)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
