import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  mailedApprovalCode,
  fillOtp,
  resetAccessList,
  resetApprovals,
  resetDevices,
  resetSecrets,
  resetUsers,
  stepUpViaApi,
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

/**
 * UX-DR2 cho màn duyệt (AC 6.3 ghi rõ: "trang duyệt của Admin pass 390px").
 *
 * Lý do rất cụ thể: yêu cầu break-glass đến lúc 2 giờ sáng, người duyệt đang ở nhà và chỉ có
 * cái điện thoại. Q-30: người duyệt đồng ý bằng cách đọc mã trong thư; trên điện thoại họ vẫn phải
 * đọc đủ lý do ở màn duyệt, và người xin phải nhập được mã ở 390px — không thì người trực đi
 * tìm đường vòng, và đường vòng thì không có audit.
 */
test.describe('Duyệt break-glass ở 390px', () => {
  test('Admin đọc được lý do trên điện thoại; người xin nhập mã ở 390px', async ({ page, browser }) => {
    await stepUpViaApi(page, await firstLogin(page, E2E_SA));
    const stamp = Date.now().toString().slice(-5);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

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

    // Member gửi một lý do DÀI — đúng thứ dễ tràn ngang trong khung 390px. Người xin ở ngữ
    // cảnh riêng và giữ phiên: quyền chỉ dùng được trong phiên đã xin (Q-15).
    const memberCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const member = await memberCtx.newPage();
    await stepUpViaApi(member, await firstLogin(member, E2E_MEMBER));
    const longReason =
      'Switch tầng 3 mất kết nối từ 1h45 sáng, khách sạn báo mạng phòng họp chết, cần vào ' +
      'cấu hình VLAN để khôi phục trước giờ làm việc';
    const asked = await member.request.post('/api/v1/vault/break-glass', {
      headers: { 'X-CSRF-Token': await csrfOf(member), Origin: APP_ORIGIN },
      data: { ownerType: 'device', ownerId: deviceId, reason: longReason, hours: 4, approver: E2E_SA.email },
    });
    const approvalId = ((await asked.json()) as { id: string }).id;

    await page.goto('/approvals');

    // Lý do là thứ người duyệt ĐỌC để quyết — phải đọc được đủ, không bị cắt.
    await expect(page.getByText(longReason)).toBeVisible();
    await expect(page.getByText(/Mã đã gửi cho/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Duyệt', exact: true })).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // Người xin nhập mã ở 390px — được duyệt thật, không chỉ nhìn thấy ô.
    await member.setViewportSize({ width: 390, height: 844 });
    await member.goto(`/devices/${deviceId}?tab=vault`);
    await fillOtp(member, await mailedApprovalCode(approvalId), 'Mã duyệt');
    await expect(member.getByText('Đã được duyệt — bấm "Xem" ở ngăn cần mở.')).toBeVisible();
    expect(await horizontalOverflow(member)).toBeLessThanOrEqual(1);
    await memberCtx.close();
  });
});

