import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  COMPOSE,
  E2E_MEMBER,
  E2E_SA,
  NEW_PASSWORD,
  expireStepUp,
  firstLogin,
  freshTotpCode,
  lastAudit,
  loginWithTotp,
  logout,
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

interface Fixture {
  deviceId: string;
  secretId: string;
  secretValue: string;
  typeId: string;
}

/** SA dựng thiết bị + secret, rồi gán cho Member tầng `tier` trên nhóm LOẠI của thiết bị đó. */
async function setUpAs(page: Page, stamp: string, tier: 'whitelist' | 'needs_approval' | null) {
  const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
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
    /**
     * Bài này đi qua BỐN luồng đăng nhập đầy đủ (SA enroll → Member enroll → SA lại → Member
     * lại), mỗi luồng có một lần chờ mã TOTP mới để tránh chống-replay. Chạy một mình mất ~50
     * giây — sát trần 60 giây mặc định, nên nó đỏ ngẫu nhiên khi cả bộ chạy cùng lúc.
     *
     * Nới trần thay vì cắt bớt bước: chính chuỗi bốn lượt đổi người NÀY là thứ story 6.3 phải
     * chứng minh — xin ở một phiên, duyệt ở phiên khác, rồi quay lại xem được.
     */
    test.setTimeout(150_000);
    const saTotp = await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { deviceId, secretId, secretValue } = await setUpAs(page, stamp, 'needs_approval');
    await logout(page);

    // --- Member: chưa duyệt thì KHÔNG xem được, nhưng THẤY được tên gọi để biết xin cái gì.
    const totpSecret = await firstLogin(page, E2E_MEMBER);
    const memberHeaders = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    const blocked = await page.request.post(`/api/v1/vault/secrets/${secretId}/reveal`, {
      headers: memberHeaders,
    });
    expect(blocked.status()).toBe(403);
    expect(await blocked.json()).toMatchObject({ code: 'BREAK_GLASS_REQUIRED' });

    await page.goto(`/devices/${deviceId}`);
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

    await page.goto('/approvals');
    await expect(page.getByText('switch tầng 3 mất kết nối')).toBeVisible();
    await page.getByRole('button', { name: 'Duyệt', exact: true }).first().click();
    const decide = page.getByRole('dialog');
    await decide.getByRole('textbox', { name: 'Cấp trong bao lâu (giờ)' }).fill('2');
    await decide.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await expect(page.getByText('Đã duyệt')).toBeVisible();

    // --- Member giờ xem được, và mỗi lần xem vẫn phải gõ TOTP (cơ chế 4.2 không đổi).
    await logout(page);
    await loginWithTotp(page, E2E_MEMBER.email, NEW_PASSWORD, totpSecret);
    expireStepUp(E2E_MEMBER.email);

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText(/Bạn được xem tới/)).toBeVisible();

    await page.getByRole('button', { name: 'Xem' }).click();
    await expect(page.getByRole('heading', { name: 'Xác nhận danh tính' })).toBeVisible();
    await page.getByLabel('Mã xác thực').fill(await freshTotpCode(totpSecret));
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.getByTestId('secret-value')).toHaveText(secretValue);

    /*
     * VẾT PHẢI NÓI XEM ĐƯỢC NHỜ PHIẾU NÀO (FR-025, thêm 18/09/2026).
     *
     * `VaultService.reveal` ghi `grantId` vào `detail` kèm chú thích "thiếu trường này thì
     * nhật ký break-glass chỉ nói 'có người xem' mà không nói được là xem hợp lệ theo grant
     * nào". `lastAudit` cũng được viết ra ĐÚNG để bắt việc mất trường đó — docblock của nó
     * nói y như vậy — nhưng tới 18/09 cả ba nơi gọi đều chỉ đọc `.actor`, nên gỡ `grantId`
     * khỏi service không làm bài nào đỏ.
     *
     * Đây là tờ giấy nộp cho auditor: "ai xem" mà không có "bằng quyền gì" thì trả lời được
     * một nửa câu hỏi, và nửa còn lại mới là nửa chứng minh quy trình duyệt có thật.
     */
    const vet = lastAudit('vault.secret.revealed', secretId);
    expect(vet?.actor, 'vết phải mang tên người vừa xem').toBe(E2E_MEMBER.email);
    const chiTiet = JSON.parse(vet?.detail ?? '{}') as { grantId?: string | null };
    expect(
      chiTiet.grantId,
      'xem qua đường break-glass thì vết PHẢI trỏ tới phiếu đã duyệt, không được null',
    ).toEqual(expect.any(String));

    // Và phải đúng phiếu của chính lượt xin này, không phải một phiếu cũ nào đó.
    const phieu = execSync(
      `${COMPOSE} exec -T postgres psql -U ims -d ims -t -A -c ` +
        `"SELECT id FROM approval WHERE reason = 'switch tầng 3 mất kết nối' ` +
        `ORDER BY created_at DESC LIMIT 1"`,
      { cwd: '..', stdio: 'pipe' },
    )
      .toString()
      .trim();
    expect(chiTiet.grantId, 'phải là ĐÚNG phiếu vừa được duyệt').toBe(phieu);
  });

  /**
   * AD-6, câu gắt nhất: "hiệu lực kiểm tại MỖI lần đọc bằng `expires_at > now()` — KHÔNG tin
   * status". Đẩy `expires_at` về quá khứ mà KHÔNG đụng `state` (state vẫn là 'approved', y
   * như khi sweep chưa kịp chạy) — quyền phải chết ngay.
   */
  test('grant hết hạn thì cắt NGAY, kể cả khi sweep chưa đổi status', async ({ page }) => {
    /*
     * Cùng lý do với bài ở trên: bài này cũng đổi người BỐN lượt (SA dựng → Member xin → SA
     * duyệt → Member xem lại), và `freshTotpCode` phải chờ sang chu kỳ 30 giây kế tiếp mỗi khi
     * mã đã bị dùng.
     *
     * Chạy riêng mất ~38 giây, dưới trần mặc định 60 giây. Nhưng chạy theo lô thì các bài
     * trước đã tiêu mã của chu kỳ hiện tại, nên chỉ một lần chờ là vượt trần — và nó đỏ ở
     * `locator.fill` của form đăng nhập, tức một chỗ chẳng liên quan gì tới điều đang kiểm.
     * Đã gặp thật ngày 08/09 khi chạy chung với sáu file khác.
     */
    test.setTimeout(150_000);
    const saTotp = await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { secretId, deviceId } = await setUpAs(page, stamp, 'needs_approval');
    await logout(page);

    const memberTotp = await firstLogin(page, E2E_MEMBER);
    const memberHeaders = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
    const asked = await page.request.post('/api/v1/vault/break-glass', {
      headers: memberHeaders,
      data: { ownerType: 'device', ownerId: deviceId, reason: 'sự cố mạng', hours: 4 },
    });
    expect(asked.status()).toBe(201);
    const approvalId = ((await asked.json()) as { id: string }).id;

    await logout(page);
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    const saHeaders = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
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
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
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
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
    });
    expect(opened.status()).toBe(200);
    expect(((await opened.json()) as { value: string }).value).toBe(secretValue);

    // Đã xem thẳng được thì XIN là vô nghĩa — API nói rõ thay vì đẻ ra một yêu cầu thừa.
    const pointless = await page.request.post('/api/v1/vault/break-glass', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
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
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

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
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      // Xin 100 giờ; trần mặc định là 24. Phải được CHẤP NHẬN và kẹp xuống, không bị từ chối.
      data: { ownerType: 'device', ownerId: deviceId, reason: 'xin quá nhiều', hours: 100 },
    });
    expect(asked.status()).toBe(201);
    expect(((await asked.json()) as { payload: { hours: number } }).payload.hours).toBe(24);
  });

  /**
   * Code review Epic 6, finding 1: `cancel()` không kiểm người gọi có phải người xin không.
   * Bất kỳ ai biết id (nhìn qua vai, ảnh chụp màn hình, URL bị chia sẻ) đều giết được yêu cầu
   * của người khác — người xin ngồi chờ tiếp lúc 2 giờ sáng, còn lịch sử ghi sai tên người hủy.
   */
  test('không hủy được yêu cầu của người khác', async ({ page }) => {
    const saTotp = await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { deviceId } = await setUpAs(page, stamp, 'needs_approval');
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    const asked = await page.request.post('/api/v1/vault/break-glass', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: { ownerType: 'device', ownerId: deviceId, reason: 'sự cố mạng tầng 3', hours: 4 },
    });
    const id = ((await asked.json()) as { id: string }).id;
    await logout(page);

    // SA cũng KHÔNG hủy hộ được — muốn chặn thì dùng "Từ chối", để lịch sử ghi đúng việc.
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    const stolen = await page.request.post(`/api/v1/vault/break-glass/${id}/cancel`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
    });
    expect(stolen.status()).toBe(403);
    expect(await stolen.json()).toMatchObject({ code: 'NOT_YOUR_REQUEST' });

    // Yêu cầu vẫn còn nguyên, vẫn chờ duyệt.
    const pending = await page.request.get('/api/v1/vault/break-glass/pending');
    expect(((await pending.json()) as { id: string }[]).some((r) => r.id === id)).toBe(true);
  });

  /**
   * Code review Epic 6, finding 6: luật "một yêu cầu treo cho mỗi chủ thể" trước đây chỉ có
   * một câu SELECT ngoài transaction canh — hai cú bấm cùng lúc là lọt cả hai.
   */
  test('bắn hai yêu cầu cùng lúc thì chỉ một cái lọt', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { deviceId } = await setUpAs(page, stamp, 'needs_approval');
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
    const body = {
      ownerType: 'device',
      ownerId: deviceId,
      reason: 'bấm hai lần liên tiếp',
      hours: 2,
    };

    const [a, b] = await Promise.all([
      page.request.post('/api/v1/vault/break-glass', { headers, data: body }),
      page.request.post('/api/v1/vault/break-glass', { headers, data: body }),
    ]);
    /**
     * Luôn là 201 + 409, dù cái thứ hai bị chặn bởi câu kiểm sớm hay bởi ràng buộc DB.
     *
     * Bản đầu ném 400 ở câu kiểm sớm và 409 ở DB — cùng một sai lầm mà hai mã, tùy nhịp. Bộ
     * E2E đầy đủ bắt được đúng chuyện đó (chạy riêng thì luôn trúng một nhánh).
     */
    expect([a.status(), b.status()].sort()).toEqual([201, 409]);
    const failed = a.status() === 409 ? a : b;
    expect(await failed.json()).toMatchObject({ code: 'BREAK_GLASS_PENDING' });

    const mine = await page.request.get('/api/v1/vault/break-glass/mine');
    const rows = (await mine.json()) as { state: string }[];
    expect(rows.filter((r) => r.state === 'pending').length).toBe(1);
  });

  /**
   * Code review Epic 6, finding 3: Member mở được tab Két sắt từ story 6.3, nên UI phải thôi
   * bày ra nút GHI — bấm vào chỉ nhận 403.
   */
  test('Member được cấp quyền xem vẫn KHÔNG thấy nút ghi vào két', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { deviceId } = await setUpAs(page, stamp, 'whitelist');
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByRole('button', { name: 'Xem' })).toBeVisible();

    // "Cất secret" vẫn là nút phẳng trên đầu panel.
    await expect(page.getByRole('button', { name: 'Cất secret' })).toHaveCount(0);
    /*
     * Sửa · Xoay · Thu hồi nằm trong menu ba chấm từ 28/08/2026, nên bám theo chữ trên nút
     * đã thành một khẳng định luôn xanh: mục menu không có trong DOM khi menu đóng, kể cả
     * với người CÓ quyền. Bám đúng cái nút mở menu — nó chỉ được vẽ khi `canEdit`.
     */
    await expect(page.getByRole('button', { name: /^Thao tác với/ })).toHaveCount(0);
  });

  /** Code review Epic 6, finding 2: Member mở màn duyệt phải thấy NGAY yêu cầu của mình. */
  test('Member mở màn duyệt thấy ngay yêu cầu của mình, không phải bấm lại tab', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { deviceId } = await setUpAs(page, stamp, 'needs_approval');
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    await page.request.post('/api/v1/vault/break-glass', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: { ownerType: 'device', ownerId: deviceId, reason: 'lý do của tôi', hours: 2 },
    });

    await page.goto('/approvals');
    // KHÔNG bấm tab nào cả — mở ra là phải thấy.
    await expect(page.getByText('lý do của tôi')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Chờ duyệt' })).toHaveCount(0);
  });

  test('Member không duyệt được yêu cầu của chính mình', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { deviceId } = await setUpAs(page, stamp, 'needs_approval');
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
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
