import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  NEW_PASSWORD,
  firstLogin,
  loginWithTotp,
  logout,
  resetAccessList,
  resetApprovals,
  resetDevices,
  resetSecrets,
  resetUsers,
  sql,
  writeHeaders,
} from './helpers';

/**
 * Q-15 — quyền mở két gắn với PHIÊN đăng nhập đã gửi yêu cầu.
 *
 * Đòn cần chặn: người trực được duyệt 4 giờ trên máy trực, đăng xuất rồi đi; ai đó đăng nhập
 * tài khoản đó ở máy khác (hoặc chính họ về nhà) và mở két bằng quyền còn giờ. Quyền xem mật
 * khẩu không được sống lâu hơn người đang ngồi trước máy đã xin.
 *
 * Người duyệt ngồi ở `page`; người xin ở một ngữ cảnh trình duyệt riêng để phiên của họ SỐNG
 * suốt lúc được duyệt — đó chính là luồng thật sau Q-15.
 */

test.beforeEach(() => {
  resetUsers();
  resetApprovals();
  resetAccessList();
  resetSecrets();
  resetDevices();
});

interface Kit {
  deviceId: string;
  secretId: string;
}

/** SA dựng thiết bị + một ngăn két, gán Member tầng "cần duyệt" trên loại Switch. */
async function setUp(page: Page, stamp: string): Promise<Kit> {
  const headers = await writeHeaders(page);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const typeId = (catalog.deviceTypes.find((t) => t.name === 'Switch') ??
    catalog.deviceTypes[0]).id;
  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: `SW-E2E-BGP-${stamp}`, name: 'Switch phiên', deviceTypeId: typeId },
  });
  expect(device.status()).toBe(201);
  const deviceId = ((await device.json()) as { device: { id: string } }).device.id;
  const secret = await page.request.post('/api/v1/vault/secrets', {
    headers,
    data: {
      ownerType: 'device',
      ownerId: deviceId,
      kind: 'password',
      label: `admin web E2E ${stamp}`,
      value: `Phien#${stamp}`,
    },
  });
  expect(secret.status()).toBeLessThan(300);
  const secretId = ((await secret.json()) as { id: string }).id;
  const access = await page.request.post('/api/v1/vault/access', {
    headers,
    data: {
      memberEmail: E2E_MEMBER.email,
      scopeType: 'device_type',
      scopeRef: typeId,
      tier: 'needs_approval',
    },
  });
  expect(access.status()).toBeLessThan(300);
  return { deviceId, secretId };
}

async function ask(memberPage: Page, deviceId: string, reason: string): Promise<string> {
  const res = await memberPage.request.post('/api/v1/vault/break-glass', {
    headers: await writeHeaders(memberPage),
    data: { ownerType: 'device', ownerId: deviceId, reason, hours: 4 },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function approve(saPage: Page, id: string) {
  const res = await saPage.request.post(`/api/v1/vault/break-glass/${id}/approve`, {
    headers: await writeHeaders(saPage),
    data: { hours: 4 },
  });
  expect(res.status()).toBe(201);
}

/** Mã lỗi của một lượt mở két; `OK` khi mở được. */
async function revealCode(memberPage: Page, secretId: string): Promise<string> {
  const res = await memberPage.request.post(`/api/v1/vault/secrets/${secretId}/reveal`, {
    headers: await writeHeaders(memberPage),
  });
  if (res.ok()) return 'OK';
  return ((await res.json()) as { code: string }).code;
}

function stateOf(id: string): string {
  return sql(`SELECT state FROM approval WHERE id = '${id}'`);
}

test.describe('Xin mở két — quyền gắn với phiên đăng nhập (Q-15)', () => {
  test('đòn: quyền của phiên A không mở được két từ phiên B; A đăng xuất là quyền hết', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const kit = await setUp(page, stamp);

    const ctxA = await browser.newContext({ ignoreHTTPSErrors: true });
    const pageA = await ctxA.newPage();
    const memberTotp = await firstLogin(pageA, E2E_MEMBER);
    const id = await ask(pageA, kit.deviceId, 'E2E switch tầng 3 mất kết nối');
    await approve(page, id);

    // Vế đối chứng: đúng phiên đã xin thì quyền MỞ (còn chặn thì chỉ được vì mã 6 số).
    expect(await revealCode(pageA, kit.secretId)).not.toBe('BREAK_GLASS_REQUIRED');

    // Cùng người, phiên thứ hai (máy khác): không mở được, và màn hình nói vì sao.
    const ctxB = await browser.newContext({ ignoreHTTPSErrors: true });
    const pageB = await ctxB.newPage();
    await loginWithTotp(pageB, E2E_MEMBER.email, NEW_PASSWORD, memberTotp);
    expect(await revealCode(pageB, kit.secretId)).toBe('BREAK_GLASS_REQUIRED');
    await pageB.goto(`/devices/${kit.deviceId}?tab=vault`);
    await expect(pageB.getByText(/thuộc một phiên đăng nhập khác/)).toBeVisible();
    await expect(pageB.getByRole('button', { name: 'Xin mở két' })).toBeVisible();
    await ctxB.close();

    // Phiên A đăng xuất → đăng nhập lại ngay trên chính máy đó: quyền cũ KHÔNG theo sang.
    await logout(pageA);
    await loginWithTotp(pageA, E2E_MEMBER.email, NEW_PASSWORD, memberTotp);
    expect(await revealCode(pageA, kit.secretId)).toBe('BREAK_GLASS_REQUIRED');

    // Nhật ký: lượt quét đóng phiếu, ghi rõ vì phiên đã kết thúc (không cần ai thu hồi tay).
    await expect.poll(() => stateOf(id), { timeout: 120_000 }).toBe('expired');
    expect(
      sql(
        `SELECT detail->>'note' FROM approval_history WHERE approval_id = '${id}' AND to_state = 'expired'`,
      ),
    ).toMatch(/phiên đăng nhập/i);
    await ctxA.close();
  });

  test('đường hạnh phúc: người xin tự Trả quyền — két đóng ngay, nhật ký ghi đúng người', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const kit = await setUp(page, stamp);

    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await ctx.newPage();
    await firstLogin(memberPage, E2E_MEMBER);

    // Hộp xin nói TRƯỚC rằng quyền hết khi đăng xuất.
    await memberPage.goto(`/devices/${kit.deviceId}?tab=vault`);
    await memberPage.getByRole('button', { name: 'Xin mở két' }).click();
    const form = memberPage.getByRole('dialog');
    await expect(form.getByText(/đăng xuất hay hết phiên/)).toBeVisible();
    await form.getByRole('textbox', { name: 'Lý do' }).fill('E2E đổi cấu hình VLAN');
    await form.getByRole('textbox', { name: 'Xin trong bao lâu (giờ)' }).fill('4');
    await form.getByRole('button', { name: 'Gửi yêu cầu' }).click();
    await expect(memberPage.getByText('Đang chờ duyệt')).toBeVisible();
    const id = sql(
      `SELECT id FROM approval WHERE requester = '${E2E_MEMBER.email}' AND state = 'pending' ORDER BY created_at DESC LIMIT 1`,
    );
    await approve(page, id);

    await memberPage.reload();
    await expect(memberPage.getByText(/Bạn được xem tới/)).toBeVisible();
    await expect(memberPage.getByText(/đăng xuất hay hết phiên/)).toBeVisible();
    await memberPage.getByRole('button', { name: 'Trả quyền' }).click();
    const confirm = memberPage.getByRole('dialog');
    await confirm.getByRole('button', { name: 'Trả quyền' }).click();
    await expect(memberPage.getByText(/Đã trả quyền/)).toBeVisible();
    await expect(memberPage.getByRole('button', { name: 'Xin mở két' })).toBeVisible();

    expect(stateOf(id)).toBe('revoked');
    expect(await revealCode(memberPage, kit.secretId)).toBe('BREAK_GLASS_REQUIRED');
    expect(
      sql(
        `SELECT actor FROM approval_history WHERE approval_id = '${id}' AND to_state = 'revoked'`,
      ),
    ).toBe(E2E_MEMBER.email);
    await ctx.close();
  });

  test('đường hỏng: không trả hộ được quyền của người khác, không "trả" phiếu chưa duyệt', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const kit = await setUp(page, stamp);

    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await ctx.newPage();
    await firstLogin(memberPage, E2E_MEMBER);
    const id = await ask(memberPage, kit.deviceId, 'E2E kiểm tra cấu hình');

    // Phiếu còn chờ: "trả" là sai cửa — dùng Rút yêu cầu.
    const early = await memberPage.request.post(`/api/v1/vault/break-glass/${id}/release`, {
      headers: await writeHeaders(memberPage),
    });
    expect(early.status()).toBe(400);
    expect(stateOf(id)).toBe('pending');

    await approve(page, id);

    // Dựng lại đòn: biết id phiếu (ảnh chụp màn hình, URL) mà cắt quyền của người đang xử sự cố.
    const stolen = await page.request.post(`/api/v1/vault/break-glass/${id}/release`, {
      headers: await writeHeaders(page),
    });
    expect(stolen.status()).toBe(403);
    expect(await stolen.json()).toMatchObject({ code: 'NOT_YOUR_REQUEST' });
    expect(stateOf(id)).toBe('approved');
    expect(await revealCode(memberPage, kit.secretId)).not.toBe('BREAK_GLASS_REQUIRED');
    await ctx.close();
  });

  test('phiên người xin kết thúc khi phiếu còn chờ → phiếu tự rút, người duyệt bấm Duyệt nhận 409 rõ ràng', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const kit = await setUp(page, stamp);

    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await ctx.newPage();
    await firstLogin(memberPage, E2E_MEMBER);
    const id = await ask(memberPage, kit.deviceId, 'E2E cổng uplink chập chờn');

    // Khung chờ nói trước: hết phiên là phiếu bị rút.
    await memberPage.goto(`/devices/${kit.deviceId}?tab=vault`);
    await expect(memberPage.getByText(/Giữ trang này mở/)).toBeVisible();

    // Đường hỏng thật: người xin đăng xuất (hoặc hết phiên) trong lúc chờ.
    await logout(memberPage);
    await expect.poll(() => stateOf(id), { timeout: 120_000 }).toBe('cancelled');
    expect(
      sql(
        `SELECT actor || '|' || (detail->>'note') FROM approval_history WHERE approval_id = '${id}' AND to_state = 'cancelled'`,
      ),
    ).toBe('system|Phiên đăng nhập của người xin đã kết thúc.');

    // Người duyệt còn mở đúng phiếu đó: bấm Duyệt nhận câu nói rõ đã được rút, không cấp gì.
    const late = await page.request.post(`/api/v1/vault/break-glass/${id}/approve`, {
      headers: await writeHeaders(page),
      data: { hours: 4 },
    });
    expect(late.status()).toBe(409);
    expect(await late.json()).toMatchObject({ code: 'BREAK_GLASS_WITHDRAWN' });
    expect(stateOf(id)).toBe('cancelled');
    await ctx.close();
  });
});
