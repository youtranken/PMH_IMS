import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  NEW_PASSWORD,
  firstLogin,
  loginWithTotp,
  resetAccessList,
  resetApprovals,
  resetDevices,
  resetIpam,
  resetSecrets,
  resetSoftware,
  resetUsers,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetApprovals();
  resetAccessList();
  resetSecrets();
  resetIpam();
  resetDevices();
  resetSoftware();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function logout(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
}

/** Story 7.1 — FR-025: ba khối, mọi số liệu qua public api, rút gọn theo vai. */
test.describe('Bảng điều khiển', () => {
  test('đường hạnh phúc: ba khối hiện đủ, sắp-hết-hạn xếp gấp nhất lên đầu', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    // Hai hồ sơ: một cái hết hạn gấp hơn cái kia.
    await page.request.post('/api/v1/software', {
      headers,
      data: {
        code: `LIC-E2E-DASH-A-${stamp}`,
        name: 'License gấp',
        kind: 'license',
        endDate: isoInDays(3),
      },
    });
    await page.request.post('/api/v1/software', {
      headers,
      data: {
        code: `LIC-E2E-DASH-B-${stamp}`,
        name: 'License thong tha',
        kind: 'license',
        endDate: isoInDays(25),
      },
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Xin chào/ })).toBeVisible();

    const expiring = page.locator('section').filter({ hasText: 'Sắp hết hạn (30 ngày)' });
    await expect(expiring.getByText('License gấp')).toBeVisible();
    await expect(expiring.getByText('License thong tha')).toBeVisible();

    // Gấp nhất lên đầu — sếp đọc từ trên xuống và thường chỉ đọc mấy dòng đầu.
    const labels = await expiring.locator('.dash-list > li').allInnerTexts();
    expect(labels[0]).toContain('License gấp');

    // Khối sự cố PHẢI hiện và nói rõ là chưa có phần này (Epic 9 chưa mở).
    const incidents = page.locator('section').filter({ hasText: 'Sự cố tuần qua' });
    await expect(incidents.getByText(/chưa mở/i)).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Break-glass tuần qua' })).toBeVisible();
  });

  /**
   * "Chưa có phần này" và "tuần qua không có sự cố nào" là HAI CÂU khác hẳn nhau. Sếp đọc
   * nhầm câu thứ hai thì tưởng mọi thứ đang yên — trong khi hệ thống chưa hề theo dõi mục đó.
   */
  test('khối chưa mở nói rõ là CHƯA THEO DÕI, không phải "không có gì"', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/');

    const incidents = page.locator('section').filter({ hasText: 'Sự cố tuần qua' });
    await expect(incidents.getByText(/CHƯA theo dõi/i)).toBeVisible();
    await expect(incidents.getByText('Tuần qua không có sự cố nào.')).toHaveCount(0);
  });

  test('break-glass tuần qua nói rõ AI, THIẾT BỊ GÌ, lý do', async ({ page }) => {
    const saTotp = await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const typeId = catalog.deviceTypes.find((t) => t.name === 'Switch')!.id;
    const code = `SW-E2E-DASH-${stamp}`;
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: { code, name: 'Switch tầng 3', deviceTypeId: typeId },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;
    await page.request.post('/api/v1/vault/access', {
      headers,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: typeId,
        tier: 'needs_approval',
      },
    });
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    await page.request.post('/api/v1/vault/break-glass', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' },
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        reason: 'switch tầng 3 mất kết nối lúc 2 giờ sáng',
        hours: 4,
      },
    });

    // Member: dashboard RÚT GỌN — không có khối break-glass toàn cục.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Break-glass tuần qua' })).toHaveCount(0);
    const asMember = (await (await page.request.get('/api/v1/dashboard')).json()) as {
      breakGlass: { available: boolean; items: unknown[] };
    };
    expect(asMember.breakGlass.available).toBe(false);
    expect(asMember.breakGlass.items).toEqual([]);
    await logout(page);

    // SA: thấy đủ ba thứ AC đòi — ai, thiết bị gì, lý do. Mã thiết bị chứ không phải uuid.
    // `loginWithTotp` chứ không phải `firstLogin`: tài khoản này đã cài 2 lớp ở đầu bài.
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    await page.goto('/');
    const block = page.locator('section').filter({ hasText: 'Break-glass tuần qua' });
    await expect(block.getByText(E2E_MEMBER.email)).toBeVisible();
    await expect(block.getByText(new RegExp(code))).toBeVisible();
    await expect(block.getByText('switch tầng 3 mất kết nối lúc 2 giờ sáng')).toBeVisible();
  });

  /**
   * AD-2: mọi số liệu đi qua public api của module chủ. Không kiểm được "không có SQL chéo"
   * từ ngoài, nhưng kiểm được HỆ QUẢ: nhãn thiết bị phải là mã thật (tra qua `devices.api`),
   * và dashboard vẫn dựng được khi một module không có dữ liệu nào.
   */
  test('dashboard trống vẫn dựng được, không lỗi', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Xin chào/ })).toBeVisible();
    await expect(page.getByText('Không có gì hết hạn trong 30 ngày tới.')).toBeVisible();
    await expect(page.getByText('Tuần qua không ai xin quyền xem tạm thời.')).toBeVisible();
  });
});

function isoInDays(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000);
  return at.toISOString().slice(0, 10);
}
