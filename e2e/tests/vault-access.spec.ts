import { expect, test, type Page } from '@playwright/test';
import {
  confirmAction,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  resetAccessList,
  resetDevices,
  resetUsers,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetAccessList();
  resetDevices();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function scopes(page: Page) {
  const res = await page.request.get('/api/v1/vault/access/scopes');
  return (await res.json()) as { scopeType: string; scopeRef: string; label: string }[];
}

/** Story 6.2 — FR-023: ma trận quyền xem secret, CẤM là mặc định. */
test.describe('Ma trận quyền két sắt', () => {
  test('đường hạnh phúc: gán quyền cho member, thấy trên ma trận, gỡ lại được', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);

    await page.goto('/admin/vault-access');
    await expect(page.getByRole('heading', { name: 'Quyền xem két sắt' })).toBeVisible();

    // Người chưa gán gì vẫn HIỆN, kèm lời nói rõ là chưa có quyền — ẩn đi thì SA tưởng đã gán.
    const card = page
      .locator('section')
      .filter({ hasText: E2E_MEMBER.email });
    await expect(card.getByText('Chưa gán quyền nào')).toBeVisible();

    await card.getByRole('button', { name: 'Gán quyền' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('button', { name: 'Nhóm đối tượng' }).click();
    await page.getByRole('option').filter({ hasText: 'Thiết bị loại Switch' }).click();
    await form.getByRole('button', { name: 'Lưu' }).click();

    await expect(card.getByText('Thiết bị loại Switch')).toBeVisible();
    await expect(card.getByText('Cần duyệt')).toBeVisible();

    await card.getByRole('button', { name: 'Gỡ' }).click();
    await confirmAction(page);
    await expect(card.getByText('Chưa gán quyền nào')).toBeVisible();
  });

  /**
   * AC 6.2: "đối tượng không thuộc tầng nào với member đó = tầng CẤM mặc định (không xin được)".
   *
   * Mặc định phải là CẤM chứ không phải "cần duyệt": nếu mặc định là cần duyệt thì một member
   * mới toanh đã có thể xin mật khẩu mọi thiết bị trong công ty.
   */
  test('chưa gán gì thì tầng là CẤM, không phải "cần duyệt"', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const type = catalog.deviceTypes[0];
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: {
        code: `SW-E2E-ACL-${Date.now().toString().slice(-4)}`,
        name: 'Switch quyền',
        deviceTypeId: type.id,
      },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    const tier = await page.request.get(
      `/api/v1/vault/access/tier?ownerType=device&ownerId=${deviceId}&memberEmail=${E2E_MEMBER.email}`,
    );
    expect(tier.status()).toBe(200);
    expect(await tier.json()).toMatchObject({ tier: 'denied' });
  });

  /**
   * Hai luật cùng áp thì lấy cái RỘNG NHẤT. SA gán "mọi switch = xem thẳng" rồi gán thêm
   * "site HN = cần duyệt" — người trực đứng trước con switch ở HN vẫn phải được xem thẳng,
   * vì SA đã nói rõ họ được xem mọi switch.
   */
  test('nhiều luật cùng áp thì lấy tầng rộng nhất', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
    const options = await scopes(page);
    const byType = options.find((o) => o.scopeType === 'device_type')!;
    const bySite = options.find((o) => o.scopeType === 'device_site');

    await page.request.post('/api/v1/vault/access', {
      headers,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: byType.scopeType,
        scopeRef: byType.scopeRef,
        tier: 'whitelist',
      },
    });

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const typeId = byType.scopeRef;
    expect(catalog.deviceTypes.some((t) => t.id === typeId)).toBe(true);

    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: {
        code: `SW-E2E-WIDE-${Date.now().toString().slice(-4)}`,
        name: 'Switch rộng',
        deviceTypeId: typeId,
        ...(bySite ? { siteId: bySite.scopeRef } : {}),
      },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    if (bySite) {
      await page.request.post('/api/v1/vault/access', {
        headers,
        data: {
          memberEmail: E2E_MEMBER.email,
          scopeType: bySite.scopeType,
          scopeRef: bySite.scopeRef,
          tier: 'needs_approval',
        },
      });
    }

    const tier = await page.request.get(
      `/api/v1/vault/access/tier?ownerType=device&ownerId=${deviceId}&memberEmail=${E2E_MEMBER.email}`,
    );
    expect(await tier.json()).toMatchObject({ tier: 'whitelist' });
  });

  test('gán lại cùng nhóm = ĐỔI tầng, không đẻ dòng thứ hai', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
    const byType = (await scopes(page)).find((o) => o.scopeType === 'device_type')!;
    const body = {
      memberEmail: E2E_MEMBER.email,
      scopeType: byType.scopeType,
      scopeRef: byType.scopeRef,
    };

    await page.request.post('/api/v1/vault/access', {
      headers,
      data: { ...body, tier: 'needs_approval' },
    });
    await page.request.post('/api/v1/vault/access', {
      headers,
      data: { ...body, tier: 'whitelist' },
    });

    const list = await page.request.get(
      `/api/v1/vault/access?memberEmail=${E2E_MEMBER.email}`,
    );
    const rows = (await list.json()) as { tier: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].tier).toBe('whitelist');
  });

  test('đường hỏng: gán tầng "cấm" bị từ chối — cấm là gỡ, không phải gán', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
    const byType = (await scopes(page)).find((o) => o.scopeType === 'device_type')!;

    const res = await page.request.post('/api/v1/vault/access', {
      headers,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: byType.scopeType,
        scopeRef: byType.scopeRef,
        tier: 'denied',
      },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain('gỡ');
  });

  test('đường hỏng: nhóm không tồn tại và email lạ đều bị chặn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };

    const ghostScope = await page.request.post('/api/v1/vault/access', {
      headers,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: '00000000-0000-4000-8000-000000000000',
        tier: 'whitelist',
      },
    });
    expect(ghostScope.status()).toBe(400);
    expect(await ghostScope.json()).toMatchObject({ code: 'SCOPE_REF_NOT_FOUND' });

    const byType = (await scopes(page)).find((o) => o.scopeType === 'device_type')!;
    const ghostMember = await page.request.post('/api/v1/vault/access', {
      headers,
      data: {
        memberEmail: 'khong-ton-tai@pmh.com.vn',
        scopeType: byType.scopeType,
        scopeRef: byType.scopeRef,
        tier: 'whitelist',
      },
    });
    expect(ghostMember.status()).toBe(400);
    expect(await ghostMember.json()).toMatchObject({ code: 'MEMBER_NOT_FOUND' });
  });

  /** Ma trận là bản đồ phòng thủ — Member đọc được nó là biết chỗ nào yếu. */
  test('Member không đọc được ma trận quyền', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    expect((await page.request.get('/api/v1/vault/access')).status()).toBe(403);
    expect((await page.request.get('/api/v1/vault/access/scopes')).status()).toBe(403);
    await expect(page.getByRole('link', { name: 'Quyền két sắt' })).toHaveCount(0);
  });
});
