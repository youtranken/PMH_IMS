import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  confirmAction,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  resetAccessList,
  resetDevices,
  resetIsp,
  resetSecrets,
  resetServiceAccounts,
  resetUsers,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetAccessList();
  resetDevices();
  // Hai bài cuối file cất secret vào ISP và tạo tài khoản dịch vụ — dọn luôn để lần chạy sau
  // không đụng ràng buộc "một chủ thể một nhãn" của lần chạy trước.
  resetSecrets();
  resetIsp();
  resetServiceAccounts();
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

    /*
     * Ma trận dựng lại thành LƯỚI (28/08/2026): hàng = người, cột = nhóm đối tượng.
     *
     * Người chưa gán gì vẫn HIỆN — nhưng giờ nó hiện thành một hàng toàn ô trống, chứ không
     * phải một thẻ có chữ "chưa có quyền nào". Ẩn họ đi thì SA tưởng đã gán rồi.
     */
    const row = page.getByRole('row').filter({ hasText: E2E_MEMBER.email });
    await expect(row).toBeVisible();
    const cell = row.getByRole('button', { name: /Thiết bị loại Switch: Không có quyền/ });
    await expect(cell).toBeVisible();

    // Gán qua nút của HÀNG (nhiều nhóm cho một người) — vẫn là hộp cũ, chỉ khác chỗ đứng.
    await row.getByRole('button', { name: 'Gán quyền' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('button', { name: 'Nhóm đối tượng' }).click();
    await page.getByRole('option').filter({ hasText: 'Thiết bị loại Switch' }).click();
    await form.getByRole('button', { name: 'Lưu' }).click();

    // Ô đổi ngay tại chỗ — không phải đi tìm trong một thẻ khác.
    const granted = row.getByRole('button', { name: /Thiết bị loại Switch: Cần duyệt/ });
    await expect(granted).toBeVisible();

    // Gỡ NGAY TRÊN Ô: bấm ô → hộp có nút Gỡ → hỏi lại.
    await granted.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Gỡ' }).click();
    await confirmAction(page);
    await expect(row.getByRole('button', { name: /Thiết bị loại Switch: Không có quyền/ })).toBeVisible();
  });

  /**
   * AC 6.2: "đối tượng không thuộc tầng nào với member đó = tầng CẤM mặc định (không xin được)".
   *
   * Mặc định phải là CẤM chứ không phải "cần duyệt": nếu mặc định là cần duyệt thì một member
   * mới toanh đã có thể xin mật khẩu mọi thiết bị trong công ty.
   */
  test('chưa gán gì thì tầng là CẤM, không phải "cần duyệt"', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
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
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
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

    /*
     * KIỂM ĐIỀU KIỆN TIÊN QUYẾT, KHÔNG BỌC `if` QUANH PHẦN DỰNG (rà soát 07/09, mục 6).
     *
     * Bài này chứng minh "gán theo LOẠI thắng gán theo SITE". Bản trước bọc lượt gán theo site
     * trong `if (bySite)`: không có nhóm site nào thì lượt gán ấy KHÔNG chạy, nên câu chốt
     * `tier: 'whitelist'` bên dưới đúng một cách tầm thường — chỉ còn đúng một quy tắc trong
     * cuộc, không có gì để mà thắng. Bài xanh, và nó chứng minh đúng con số không.
     */
    expect(bySite, 'phải có nhóm theo site, nếu không bài này không kiểm được thứ tự ưu tiên').toBeTruthy();
    await page.request.post('/api/v1/vault/access', {
      headers,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: bySite!.scopeType,
        scopeRef: bySite!.scopeRef,
        tier: 'needs_approval',
      },
    });

    const tier = await page.request.get(
      `/api/v1/vault/access/tier?ownerType=device&ownerId=${deviceId}&memberEmail=${E2E_MEMBER.email}`,
    );
    expect(await tier.json()).toMatchObject({ tier: 'whitelist' });
  });

  test('gán lại cùng nhóm = ĐỔI tầng, không đẻ dòng thứ hai', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
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
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
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
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

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

/**
 * Rà soát liên kết 28/08/2026 tìm ra hai lỗ hổng cùng một họ, migration 0036 vá cả hai:
 *
 *  - Két sắt chưa với tới ĐƯỜNG TRUYỀN, dù giấy tờ thì với tới từ lâu.
 *  - Ma trận quyền chưa có nhóm nào phủ TÀI KHOẢN DỊCH VỤ, nên nó cất được mật khẩu mà không
 *    ai cấp quyền xem được — một tính năng chết, không phải một quyết định.
 */
test.describe('Két sắt và ma trận quyền với tới ISP + tài khoản dịch vụ', () => {
  test('cất được mật khẩu PPPoE của đường truyền', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    const line = await page.request.post('/api/v1/isp-lines', {
      headers,
      data: { code: `FTTH-E2E-${stamp}`, provider: 'VNPT', bandwidth: '200 Mbps' },
    });
    expect(line.status()).toBe(201);
    const lineId = ((await line.json()) as { id: string }).id;

    /*
     * Đây là chỗ TRƯỚC 0036 trả 500: CHECK ở tầng DB chỉ nhận device/software/service_account.
     * Whitelist ba tầng và tầng DB là tầng bị quên — nên bài này gọi thẳng API để chạm đúng
     * tầng đó, không chỉ chạm cái mảng trong TypeScript.
     */
    const stashed = await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: {
        ownerType: 'isp',
        ownerId: lineId,
        kind: 'password',
        label: `pppoe-E2E-${stamp}`,
        username: 'ftth-lst@vnpt',
        value: 'MatKhau#2026',
      },
    });
    expect(stashed.status()).toBe(201);

    // Và nó hiện ở tab Két sắt của chính trang đường truyền.
    await page.goto(`/isp-lines/${lineId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText(`pppoe-E2E-${stamp}`)).toBeVisible();
  });

  test('gán quyền theo LOẠI tài khoản dịch vụ — Member hết bị cấm vĩnh viễn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    const account = await page.request.post('/api/v1/service-accounts', {
      headers,
      data: { code: `VPN-E2E-ACL-${stamp}`, kind: 'vpn', name: 'VPN kiểm quyền' },
    });
    expect(account.status()).toBe(201);
    const accountId = ((await account.json()) as { id: string }).id;

    // Chưa gán gì: CẤM — mặc định đóng vẫn nguyên, đây không phải chuyện nới lỏng.
    const before = await page.request.get(
      `/api/v1/vault/access/tier?memberEmail=${E2E_MEMBER.email}&ownerType=service_account&ownerId=${accountId}`,
    );
    expect(((await before.json()) as { tier: string }).tier).toBe('denied');

    // Gán "Tài khoản: VPN" → tầng đổi. Trước 0036 thì không có ô nào để chọn.
    const granted = await page.request.post('/api/v1/vault/access', {
      headers,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'service_account_kind',
        scopeRef: 'vpn',
        tier: 'whitelist',
      },
    });
    expect(granted.status()).toBe(201);

    const after = await page.request.get(
      `/api/v1/vault/access/tier?memberEmail=${E2E_MEMBER.email}&ownerType=service_account&ownerId=${accountId}`,
    );
    expect(((await after.json()) as { tier: string }).tier).toBe('whitelist');

    /*
     * Quyền theo LOẠI, nên nó không tràn sang loại khác: gán VPN thì tài khoản dùng chung vẫn
     * CẤM. Thiếu bài này thì một `scopeRef` gõ sai vẫn "chạy" mà không ai biết nó mở quá tay.
     */
    const shared = await page.request.post('/api/v1/service-accounts', {
      headers,
      data: { code: `TK-E2E-ACL-${stamp}`, kind: 'shared', name: 'Dùng chung kiểm quyền' },
    });
    const sharedId = ((await shared.json()) as { id: string }).id;
    const other = await page.request.get(
      `/api/v1/vault/access/tier?memberEmail=${E2E_MEMBER.email}&ownerType=service_account&ownerId=${sharedId}`,
    );
    expect(((await other.json()) as { tier: string }).tier).toBe('denied');
  });
});
