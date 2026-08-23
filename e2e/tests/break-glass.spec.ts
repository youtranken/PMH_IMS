import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  NEW_PASSWORD,
  expireStepUp,
  firstLogin,
  freshTotpCode,
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

/**
 * Đăng xuất từ một trang TRUNG TÍNH.
 *
 * Bấm thẳng nút "Đăng xuất" khi đang đứng ở trang có bảng dài thì bảng che mất nút và
 * Playwright báo "intercepts pointer events". Về trang chủ trước là hết, và cũng đúng thói
 * quen thật của người dùng hơn.
 */
async function logout(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
}

interface Fixture {
  deviceId: string;
  secretId: string;
  secretValue: string;
  typeId: string;
}

/** SA dựng thiết bị + secret, rồi gán cho Member tầng `tier` trên nhóm LOẠI của thiết bị đó. */
async function setUpAs(page: Page, stamp: string, tier: 'whitelist' | 'needs_approval' | null) {
  const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const typeId = catalog.deviceTypes.find((t) => t.name === 'Switch')!.id;

  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: `SW-E2E-BG-${stamp}`, name: 'Switch break-glass', deviceTypeId: typeId },
  });
  const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

  const secretValue = `BreakGlass#${stamp}`;
  const secret = await page.request.post('/api/v1/vault/secrets', {
    headers,
    data: {
      ownerType: 'device',
      ownerId: deviceId,
      kind: 'password',
      label: `admin web E2E ${stamp}`,
      value: secretValue,
    },
  });
  const secretId = ((await secret.json()) as { id: string }).id;

  if (tier) {
    await page.request.post('/api/v1/vault/access', {
      headers,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: typeId,
        tier,
      },
    });
  }
  return { deviceId, secretId, secretValue, typeId } satisfies Fixture;
}

/** Story 6.3 — FR-023: ba tầng, xin–duyệt, và hiệu lực tính bằng đồng hồ (AD-6). */
test.describe('Break-glass', () => {
  /**
   * Kịch bản đầy đủ của AC: Member cần-duyệt → xin → SA duyệt → xem được → nhật ký ghi đủ.
   */
  test('đường hạnh phúc: xin → duyệt → xem được trong hạn, nhật ký ghi đủ', async ({ page }) => {
    const saTotp = await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { deviceId, secretId, secretValue } = await setUpAs(page, stamp, 'needs_approval');
    await logout(page);

    // --- Member: chưa duyệt thì KHÔNG xem được, nhưng THẤY được tên gọi để biết xin cái gì.
    const totpSecret = await firstLogin(page, E2E_MEMBER);
    const memberHeaders = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    const blocked = await page.request.post(`/api/v1/vault/secrets/${secretId}/reveal`, {
      headers: memberHeaders,
    });
    expect(blocked.status()).toBe(403);
    expect(await blocked.json()).toMatchObject({ code: 'BREAK_GLASS_REQUIRED' });

    await page.goto(`/thiet-bi/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText(`admin web E2E ${stamp}`)).toBeVisible();
    await expect(page.getByText(/cần được duyệt trước khi xem/i)).toBeVisible();

    await page.getByRole('button', { name: 'Xin quyền xem' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Lý do' }).fill('switch tầng 3 mất kết nối');
    await form.getByRole('textbox', { name: 'Xin trong bao lâu (giờ)' }).fill('4');
    await form.getByRole('button', { name: 'Gửi yêu cầu' }).click();
    await expect(page.getByText('Đang chờ duyệt')).toBeVisible();

    // --- SA duyệt.
    await logout(page);
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);

    await page.goto('/duyet-yeu-cau');
    await expect(page.getByText('switch tầng 3 mất kết nối')).toBeVisible();
    await page.getByRole('button', { name: 'Duyệt', exact: true }).first().click();
    const decide = page.getByRole('dialog');
    await decide.getByRole('textbox', { name: 'Cấp trong bao lâu (giờ)' }).fill('2');
    await decide.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await expect(page.getByText('Đã duyệt')).toBeVisible();

    // --- Member giờ xem được, và mỗi lần xem vẫn phải gõ TOTP (cơ chế 4.2 không đổi).
    await logout(page);
    await loginWithTotp(page, E2E_MEMBER.email, NEW_PASSWORD, totpSecret);
    expireStepUp();

    await page.goto(`/thiet-bi/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText(/Bạn được xem tới/)).toBeVisible();

    await page.getByRole('button', { name: 'Xem' }).click();
    await expect(page.getByRole('heading', { name: 'Xác nhận danh tính' })).toBeVisible();
    await page.getByLabel('Mã xác thực').fill(await freshTotpCode(totpSecret));
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.getByTestId('secret-value')).toHaveText(secretValue);
  });

  /**
   * AD-6, câu gắt nhất: "hiệu lực kiểm tại MỖI lần đọc bằng `expires_at > now()` — KHÔNG tin
   * status". Đẩy `expires_at` về quá khứ mà KHÔNG đụng `state` (state vẫn là 'approved', y
   * như khi sweep chưa kịp chạy) — quyền phải chết ngay.
   */
  test('grant hết hạn thì cắt NGAY, kể cả khi sweep chưa đổi status', async ({ page }) => {
    const saTotp = await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { secretId, deviceId } = await setUpAs(page, stamp, 'needs_approval');
    await logout(page);

    const memberTotp = await firstLogin(page, E2E_MEMBER);
    const memberHeaders = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };
    const asked = await page.request.post('/api/v1/vault/break-glass', {
      headers: memberHeaders,
      data: { ownerType: 'device', ownerId: deviceId, reason: 'sự cố mạng', hours: 4 },
    });
    expect(asked.status()).toBe(201);
    const approvalId = ((await asked.json()) as { id: string }).id;

    await logout(page);
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    const saHeaders = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };
    await page.request.post(`/api/v1/vault/break-glass/${approvalId}/approve`, {
      headers: saHeaders,
      data: { hours: 4 },
    });

    // Đẩy hạn về quá khứ, KHÔNG đụng `state`.
    const { execSync } = await import('node:child_process');
    const { COMPOSE } = await import('./helpers');
    execSync(
      `${COMPOSE} exec -T postgres psql -U ims -d ims -c "UPDATE approval SET expires_at = now() - interval '1 minute' WHERE id = '${approvalId}'"`,
      { cwd: '..', stdio: 'pipe' },
    );
    const stillApproved = execSync(
      `${COMPOSE} exec -T postgres psql -U ims -d ims -t -A -c "SELECT state FROM approval WHERE id = '${approvalId}'"`,
      { cwd: '..', encoding: 'utf8' },
    ).trim();
    expect(stillApproved, 'state vẫn phải là approved — đó chính là điều đang kiểm').toBe(
      'approved',
    );

    await logout(page);
    await loginWithTotp(page, E2E_MEMBER.email, NEW_PASSWORD, memberTotp);
    const denied = await page.request.post(`/api/v1/vault/secrets/${secretId}/reveal`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' },
    });
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toMatchObject({ code: 'BREAK_GLASS_REQUIRED' });
  });

  /** Whitelist: xem thẳng, không phải xin — nhưng vẫn phải gõ mã mỗi lần (cơ chế 4.2). */
  test('whitelist thì xem thẳng, không hiện nút xin', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { secretId, secretValue, deviceId } = await setUpAs(page, stamp, 'whitelist');
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    const opened = await page.request.post(`/api/v1/vault/secrets/${secretId}/reveal`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' },
    });
    expect(opened.status()).toBe(200);
    expect(((await opened.json()) as { value: string }).value).toBe(secretValue);

    // Đã xem thẳng được thì XIN là vô nghĩa — API nói rõ thay vì đẻ ra một yêu cầu thừa.
    const pointless = await page.request.post('/api/v1/vault/break-glass', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' },
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        reason: 'không cần thiết',
        hours: 2,
      },
    });
    expect(pointless.status()).toBe(400);
    expect(await pointless.json()).toMatchObject({ code: 'ACCESS_ALREADY_GRANTED' });
  });

  /** Tầng CẤM: không xem, và cũng KHÔNG XIN được (AC 6.2). */
  test('không được gán gì thì không xem và cũng không xin được', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { secretId, deviceId } = await setUpAs(page, stamp, null);
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    const reveal = await page.request.post(`/api/v1/vault/secrets/${secretId}/reveal`, { headers });
    expect(reveal.status()).toBe(403);
    expect(await reveal.json()).toMatchObject({ code: 'ACCESS_DENIED' });

    const ask = await page.request.post('/api/v1/vault/break-glass', {
      headers,
      data: { ownerType: 'device', ownerId: deviceId, reason: 'thử xin', hours: 2 },
    });
    expect(ask.status()).toBe(403);
    expect(await ask.json()).toMatchObject({ code: 'ACCESS_DENIED' });

    // Metadata cũng không đọc được — chủ thể ngoài quyền là 403, không phải danh sách rỗng.
    const meta = await page.request.get(
      `/api/v1/vault/secrets?ownerType=device&ownerId=${deviceId}`,
    );
    expect(meta.status()).toBe(403);
  });

  test('trần thời hạn kẹp theo system_config, không từ chối', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { deviceId } = await setUpAs(page, stamp, 'needs_approval');
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    const asked = await page.request.post('/api/v1/vault/break-glass', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' },
      // Xin 100 giờ; trần mặc định là 24. Phải được CHẤP NHẬN và kẹp xuống, không bị từ chối.
      data: { ownerType: 'device', ownerId: deviceId, reason: 'xin quá nhiều', hours: 100 },
    });
    expect(asked.status()).toBe(201);
    expect(((await asked.json()) as { payload: { hours: number } }).payload.hours).toBe(24);
  });

  test('Member không duyệt được yêu cầu của chính mình', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { deviceId } = await setUpAs(page, stamp, 'needs_approval');
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };
    const asked = await page.request.post('/api/v1/vault/break-glass', {
      headers,
      data: { ownerType: 'device', ownerId: deviceId, reason: 'tự duyệt thử', hours: 2 },
    });
    const id = ((await asked.json()) as { id: string }).id;

    const selfApprove = await page.request.post(`/api/v1/vault/break-glass/${id}/approve`, {
      headers,
      data: { hours: 2 },
    });
    expect(selfApprove.status()).toBe(403);

    // Hàng chờ của người duyệt cũng không đọc được.
    expect((await page.request.get('/api/v1/vault/break-glass/pending')).status()).toBe(403);
  });
});
