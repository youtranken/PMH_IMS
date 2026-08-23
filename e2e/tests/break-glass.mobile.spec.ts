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
  resetSecrets,
  resetUsers,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetApprovals();
  resetAccessList();
  resetSecrets();
  resetDevices();
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

/**
 * UX-DR2 cho màn duyệt (AC 6.3 ghi rõ: "trang duyệt của Admin pass 390px").
 *
 * Lý do rất cụ thể: yêu cầu break-glass đến lúc 2 giờ sáng, người duyệt đang ở nhà và chỉ có
 * cái điện thoại. Duyệt không được trên điện thoại thì cả cơ chế này vô dụng đúng vào lúc cần
 * nhất — người trực sẽ đi tìm đường vòng, và đường vòng thì không có audit.
 */
test.describe('Duyệt break-glass ở 390px', () => {
  test('Admin đọc được lý do và duyệt được trên điện thoại', async ({ page }) => {
    const saTotp = await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const typeId = catalog.deviceTypes[0].id;
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: `SW-E2E-BG390-${stamp}`, name: 'Switch', deviceTypeId: typeId },
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

    // Member gửi một lý do DÀI — đúng thứ dễ tràn ngang trong khung 390px.
    await firstLogin(page, E2E_MEMBER);
    const longReason =
      'Switch tầng 3 mất kết nối từ 1h45 sáng, khách sạn báo mạng phòng họp chết, cần vào ' +
      'cấu hình VLAN để khôi phục trước giờ làm việc';
    await page.request.post('/api/v1/vault/break-glass', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' },
      data: { ownerType: 'device', ownerId: deviceId, reason: longReason, hours: 4 },
    });
    await logout(page);

    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    await page.goto('/duyet-yeu-cau');

    // Lý do là thứ người duyệt ĐỌC để quyết — phải đọc được đủ, không bị cắt.
    await expect(page.getByText(longReason)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Duyệt', exact: true })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // Và bấm duyệt được thật, không chỉ nhìn thấy nút.
    await page.getByRole('button', { name: 'Duyệt', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('textbox', { name: 'Cấp trong bao lâu (giờ)' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await dialog.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await expect(page.getByText('Đã duyệt')).toBeVisible();
  });
});

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
