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
 * Q-15 — yêu cầu mở két đang chờ KHÔNG gắn phiên; quyền gắn với phiên đã XEM nó lần đầu.
 *
 * Đòn cần chặn: người trực được duyệt 4 giờ, xem trên máy trực rồi đăng xuất đi về; ai đó đăng
 * nhập tài khoản đó ở máy khác (hoặc chính họ ở nhà) và mở két bằng quyền còn giờ. Quyền xem
 * mật khẩu không được sống lâu hơn phiên đang ngồi trước máy.
 *
 * Đồng thời việc CHỜ duyệt không bắt người xin canh trang: phiên idle chết sau 30 phút, người
 * duyệt có thể quyết sau nhiều giờ. Chờ quá `breakglass.pending_expire_hours` (8) thì phiếu tự
 * hết hạn.
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
  value: string;
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
  const value = `Phien#${stamp}`;
  const secret = await page.request.post('/api/v1/vault/secrets', {
    headers,
    data: {
      ownerType: 'device',
      ownerId: deviceId,
      kind: 'password',
      label: `admin web E2E ${stamp}`,
      value,
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
  return { deviceId, secretId, value };
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

function claimed(id: string): boolean {
  return sql(`SELECT claimed_session_id IS NOT NULL FROM approval WHERE id = '${id}'`) === 't';
}

test.describe('Xin mở két — chờ không gắn phiên, quyền gắn phiên xem lần đầu (Q-15)', () => {
  test('đường hạnh phúc: A xin rồi đăng xuất → vẫn chờ → duyệt → phiên B bấm Xem, mở được', async ({
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
    await pageA.goto(`/devices/${kit.deviceId}?tab=vault`);
    await pageA.getByRole('button', { name: 'Xin mở két' }).click();
    const form = pageA.getByRole('dialog');
    await expect(form.getByText(/lần bấm "Xem" đầu tiên/)).toBeVisible();
    await form.getByRole('textbox', { name: 'Lý do' }).fill('E2E switch tầng 3 mất kết nối');
    await form.getByRole('textbox', { name: 'Xin trong bao lâu (giờ)' }).fill('4');
    await form.getByRole('button', { name: 'Gửi yêu cầu' }).click();
    // Khung chờ nói cứ đóng trang — không còn câu "giữ trang này mở".
    await expect(pageA.getByText(/Bạn có thể đóng trang/)).toBeVisible();
    await expect(pageA.getByText(/Giữ trang này mở/)).toHaveCount(0);
    const id = sql(
      `SELECT id FROM approval WHERE requester = '${E2E_MEMBER.email}' AND state = 'pending' ORDER BY created_at DESC LIMIT 1`,
    );

    // Người xin đăng xuất trong lúc chờ: phiếu KHÔNG bị rút, người duyệt duyệt bình thường.
    await logout(pageA);
    await ctxA.close();
    expect(stateOf(id)).toBe('pending');
    await approve(page, id);
    expect(claimed(id)).toBe(false);

    // Phiên mới (máy khác): khung chỉ đường "bấm Xem, nhập mã 6 số", không có nút riêng.
    const ctxB = await browser.newContext({ ignoreHTTPSErrors: true });
    const pageB = await ctxB.newPage();
    await loginWithTotp(pageB, E2E_MEMBER.email, NEW_PASSWORD, memberTotp);
    await pageB.goto(`/devices/${kit.deviceId}?tab=vault`);
    await expect(pageB.getByText(/Đã được duyệt — bấm "Xem"/)).toBeVisible();
    await expect(pageB.getByText(/tính từ lúc duyệt/)).toBeVisible();
    await expect(pageB.getByRole('button', { name: /Nhận quyền/ })).toHaveCount(0);

    // Vừa đăng nhập bằng mã 2 lớp = còn ân hạn step-up: bấm Xem là thấy giá trị.
    await pageB.getByRole('button', { name: 'Xem' }).click();
    await expect(pageB.getByTestId('secret-value')).toHaveText(kit.value);
    expect(claimed(id)).toBe(true);
    await expect(pageB.getByText(/Bạn được xem tới/)).toBeVisible();

    // Nhật ký: có dòng "xem lần đầu" của chính người xin.
    expect(
      sql(
        `SELECT actor FROM approval_history WHERE approval_id = '${id}' AND detail->>'event' = 'claimed'`,
      ),
    ).toBe(E2E_MEMBER.email);
    await ctxB.close();
  });

  test('đòn: quyền đã gắn phiên B thì phiên C không dùng được; B đăng xuất là quyền hết', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const kit = await setUp(page, stamp);

    const ctxB = await browser.newContext({ ignoreHTTPSErrors: true });
    const pageB = await ctxB.newPage();
    const memberTotp = await firstLogin(pageB, E2E_MEMBER);
    const id = await ask(pageB, kit.deviceId, 'E2E cổng uplink chập chờn');
    await approve(page, id);

    // Lần xem đầu ở B gắn quyền vào B.
    expect(await revealCode(pageB, kit.secretId)).toBe('OK');
    expect(claimed(id)).toBe(true);

    // Cùng người, phiên thứ hai (máy khác): bị từ chối rõ ràng, và màn hình nói vì sao.
    const ctxC = await browser.newContext({ ignoreHTTPSErrors: true });
    const pageC = await ctxC.newPage();
    await loginWithTotp(pageC, E2E_MEMBER.email, NEW_PASSWORD, memberTotp);
    expect(await revealCode(pageC, kit.secretId)).toBe('BREAK_GLASS_OTHER_SESSION');
    await pageC.goto(`/devices/${kit.deviceId}?tab=vault`);
    await expect(pageC.getByText(/đã gắn với một phiên đăng nhập khác/)).toBeVisible();
    await expect(pageC.getByRole('button', { name: 'Xin mở két' })).toBeVisible();
    await ctxC.close();

    // Phiên B đăng xuất → đăng nhập lại ngay trên chính máy đó: quyền cũ KHÔNG theo sang.
    await logout(pageB);
    await loginWithTotp(pageB, E2E_MEMBER.email, NEW_PASSWORD, memberTotp);
    expect(await revealCode(pageB, kit.secretId)).not.toBe('OK');

    // Nhật ký: lượt quét đóng phiếu, ghi rõ vì phiên đã kết thúc (không cần ai thu hồi tay).
    await expect.poll(() => stateOf(id), { timeout: 120_000 }).toBe('expired');
    expect(
      sql(
        `SELECT detail->>'note' FROM approval_history WHERE approval_id = '${id}' AND to_state = 'expired'`,
      ),
    ).toMatch(/phiên đăng nhập/i);
    expect(await revealCode(pageB, kit.secretId)).toBe('BREAK_GLASS_REQUIRED');
    await ctxB.close();
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
    const id = await ask(memberPage, kit.deviceId, 'E2E đổi cấu hình VLAN');
    await approve(page, id);
    expect(await revealCode(memberPage, kit.secretId)).toBe('OK');

    await memberPage.goto(`/devices/${kit.deviceId}?tab=vault`);
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
    expect(await revealCode(memberPage, kit.secretId)).toBe('OK');
    await ctx.close();
  });

  test(`đường hỏng: chờ quá 8 giờ không ai duyệt → tự hết hạn; bấm Duyệt nhận 409 rõ ràng`, async ({
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
    const id = await ask(memberPage, kit.deviceId, 'E2E chờ quá hạn');
    await memberPage.goto(`/devices/${kit.deviceId}?tab=vault`);
    await expect(memberPage.getByText(/trong 8 giờ thì yêu cầu tự hết hạn/)).toBeVisible();

    // Lùi mốc gửi quá hạn chờ: Duyệt bị chặn NGAY theo đồng hồ, không chờ lượt quét.
    sql(`UPDATE approval SET created_at = now() - interval '9 hours' WHERE id = '${id}'`);
    const late = await page.request.post(`/api/v1/vault/break-glass/${id}/approve`, {
      headers: await writeHeaders(page),
      data: { hours: 4 },
    });
    expect(late.status()).toBe(409);
    expect(await late.json()).toMatchObject({ code: 'BREAK_GLASS_PENDING_EXPIRED' });

    // Lượt quét ghi hết hạn + nhật ký "không ai duyệt"; người xin được xin lại.
    await expect.poll(() => stateOf(id), { timeout: 120_000 }).toBe('expired');
    expect(
      sql(
        `SELECT actor || '|' || (detail->>'note') FROM approval_history WHERE approval_id = '${id}' AND to_state = 'expired'`,
      ),
    ).toBe('system|Quá 8 giờ không ai duyệt.');
    await memberPage.reload();
    await expect(memberPage.getByRole('button', { name: 'Xin mở két' })).toBeVisible();
    await ctx.close();
  });

  test('vô hiệu hóa tài khoản người xin → yêu cầu đang chờ tự rút; bấm Duyệt nhận 409 nói rõ', async ({
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
    const id = await ask(memberPage, kit.deviceId, 'E2E người sắp nghỉ việc');
    await ctx.close();

    const memberId = sql(`SELECT id FROM users WHERE email = '${E2E_MEMBER.email}'`);
    const off = await page.request.patch(`/api/v1/accounts/${memberId}/status`, {
      headers: await writeHeaders(page),
      data: { status: 'disabled', reason: 'E2E nghỉ việc' },
    });
    expect(off.status()).toBeLessThan(300);
    expect(stateOf(id)).toBe('cancelled');
    expect(
      sql(
        `SELECT actor || '|' || (detail->>'by') FROM approval_history WHERE approval_id = '${id}' AND to_state = 'cancelled'`,
      ),
    ).toBe(`${E2E_SA.email}|account-disabled`);

    const late = await page.request.post(`/api/v1/vault/break-glass/${id}/approve`, {
      headers: await writeHeaders(page),
      data: { hours: 4 },
    });
    expect(late.status()).toBe(409);
    const body = (await late.json()) as { code: string; message: string };
    expect(body.code).toBe('BREAK_GLASS_WITHDRAWN');
    expect(body.message).toMatch(/vô hiệu hóa/);
  });
});
