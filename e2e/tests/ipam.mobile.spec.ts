import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetIpam, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetIpam();
});

/**
 * UX-DR2 — danh sách dải và bảng IP là màn ĐỌC. Cảnh dùng thật: đứng ở tủ mạng, cầm điện
 * thoại, cần biết "IP này của ai" hoặc "còn chỗ trống nào".
 */
test.describe('Địa chỉ IP ở 390px', () => {
  test('danh sách dải và bảng IP đọc được, không tràn ngang', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.16.${octet}.0/29`, name: `LAN 390 E2E ${stamp}` },
    });
    const subnetId = ((await subnet.json()) as { id: string }).id;
    await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: {
        subnetId,
        address: `172.16.${octet}.1`,
        usedBy: 'Chị Lan — Phòng Kế toán tầng 3',
      },
    });

    await page.goto('/dia-chi-ip');
    await expect(page.getByRole('cell', { name: new RegExp(`LAN 390 E2E ${stamp}`) })).toBeVisible();
    // Thanh mức sử dụng phải co được, không đẩy bảng rộng ra.
    await expect(page.getByRole('meter')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await page.goto(`/dia-chi-ip/${subnetId}`);
    await expect(page.getByText('Chị Lan — Phòng Kế toán tầng 3')).toBeVisible();
    await expect(page.getByText(`172.16.${octet}.1`)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
