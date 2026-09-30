import { expect, request, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  NEW_PASSWORD,
  fillLogin,
  firstLogin,
  freshTotpCode,
  logout,
  resetAccessList,
  resetDevices,
  resetSecrets,
  resetUsers,
  sql,
  uniqueStamp,
  writeHeaders,
} from './helpers';

test.beforeEach(() => resetUsers());

/**
 * Kịch bản tấn công — mỗi test ở đây dựng lại đúng một đòn tấn công vào lỗ đã vá.
 * Đỏ ở đây nghĩa là một hàng rào an ninh đã bị gỡ mất.
 */
test.describe('Hàng rào an ninh', () => {
  test('không đi vòng qua chống-replay bằng đường enroll (tài khoản đã cài 2 lớp)', async ({
    page,
  }) => {
    const secret = await firstLogin(page, E2E_MEMBER);
    const usedCode = await freshTotpCode(secret);

    // Đăng nhập lại tới bước chờ TOTP rồi thử "enroll lại" bằng một mã bất kỳ.
    await logout(page);
    await fillLogin(page, E2E_MEMBER.email, NEW_PASSWORD);
    await expect(page.getByRole('heading', { name: 'Xác thực 2 lớp' })).toBeVisible();

    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });

    const response = await page.request.post('/api/v1/auth/totp/enroll/confirm', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { token: usedCode },
    });

    // Phải bị chặn vì tài khoản ĐÃ enroll — không được cấp phiên đã xác thực qua đường này.
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'TOTP_ALREADY_ENROLLED' });
  });

  test('mã phiên đọc được trong nhật ký audit không dùng làm cookie được (SEC-01)', async ({
    page,
    request,
  }) => {
    await firstLogin(page, E2E_MEMBER);
    const sessionIdInAudit = sql(
      `SELECT object_id FROM audit_log WHERE action = 'auth.login.ok' ` +
        `AND actor = '${E2E_MEMBER.email}' ORDER BY created_at DESC LIMIT 1`,
    ).trim();
    expect(sessionIdInAudit).toMatch(/^[0-9a-f-]{36}$/);

    const cookies = await page.context().cookies();
    const real = cookies.find((c) => c.name === 'ims_session');
    expect(real?.value).toBeTruthy();
    expect(real?.value).not.toBe(sessionIdInAudit);

    const forged = await request.get('/api/v1/auth/me', {
      headers: { Cookie: `ims_session=${sessionIdInAudit}` },
    });
    expect(forged.status()).toBe(401);

    const genuine = await request.get('/api/v1/auth/me', {
      headers: { Cookie: `ims_session=${real!.value}` },
    });
    expect(genuine.status()).toBe(200);
  });

  test('đoán mật khẩu hiện tại ở cửa Đổi mật khẩu: đủ ngưỡng thì phiên chết (SEC-06)', async ({
    page,
  }) => {
    await firstLogin(page, E2E_MEMBER);
    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const guess = () =>
      page.request.post('/api/v1/auth/change-password', {
        headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
        data: { currentPassword: 'doan-sai-#2026', newPassword: 'Ims#MoiHoanToan2026!' },
      });

    const first = await guess();
    expect(first.status()).toBe(401);
    expect(await first.json()).toMatchObject({ code: 'CURRENT_PASSWORD_WRONG', attemptsLeft: 4 });
    for (let i = 0; i < 3; i += 1) await guess();
    const fifth = await guess();
    expect(await fifth.json()).toMatchObject({ code: 'SESSION_REVOKED' });

    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(401);
  });

  test('member không mở được trang nội bộ /dev/components', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    await expect(page.getByRole('link', { name: 'Bộ giao diện' })).toHaveCount(0);

    await page.goto('/dev/components');
    await expect(page.getByRole('heading', { name: 'Bạn không có quyền xem trang này' })).toBeVisible();
  });

  test('thao tác ghi thiếu CSRF token bị từ chối', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    const response = await page.request.post('/api/v1/auth/logout', {
      headers: { Origin: APP_ORIGIN },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'CSRF_TOKEN_INVALID' });
  });

  test('thao tác ghi từ nguồn lạ (Origin sai) bị từ chối', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const response = await page.request.post('/api/v1/auth/logout', {
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://ke-tan-cong.example' },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'ORIGIN_MISMATCH' });
  });

  /*
   * Login-CSRF (SEC-11): trang lạ tự POST form đăng nhập bằng tài khoản CỦA KẺ TẤN CÔNG, nạn nhân
   * bị đăng nhập vào đó mà không biết. Trình duyệt cũ không gửi `Origin` cho form cùng-trang-khác-
   * gốc, nên thiếu Origin không được là "cho qua". Email ở đây không tồn tại: nếu hàng rào hỏng thì
   * API trả 401 (đã vào tới bước kiểm mật khẩu) thay vì 403.
   */
  test('đăng nhập từ trang lạ không có Origin bị chặn trước khi kiểm mật khẩu (SEC-11)', async () => {
    const ghost = { email: 'e2e-login-csrf@pmh.com.vn', password: 'khong-quan-trong-#2026' };
    const cases: { headers: Record<string, string>; code: string }[] = [
      { headers: { 'Sec-Fetch-Site': 'cross-site' }, code: 'ORIGIN_MISMATCH' },
      { headers: { Referer: 'https://ke-tan-cong.example/dang-nhap' }, code: 'ORIGIN_MISMATCH' },
      { headers: {}, code: 'ORIGIN_MISSING' },
    ];
    for (const { headers, code } of cases) {
      const api = await request.newContext({
        baseURL: APP_ORIGIN,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: headers,
      });
      try {
        const res = await api.post('/api/v1/auth/login', { data: ghost });
        expect(res.status(), JSON.stringify(headers)).toBe(403);
        expect(await res.json()).toMatchObject({ code });
      } finally {
        await api.dispose();
      }
    }

    // Đối chứng: cùng request, cùng gốc thì đi tiếp tới bước kiểm mật khẩu.
    const same = await request.newContext({
      baseURL: APP_ORIGIN,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'Sec-Fetch-Site': 'same-origin' },
    });
    try {
      const res = await same.post('/api/v1/auth/login', { data: ghost });
      expect(res.status()).toBe(401);
    } finally {
      await same.dispose();
    }
  });
});

/**
 * SEC-20 — ghi chú của ngăn két là cột dạng rõ.
 *
 * Đòn gốc: người thử gõ mật khẩu vào ô Ghi chú khi cất ngăn; danh sách két mở cho Member
 * "cần duyệt" (để họ biết xin gì), nên Member đọc được mật khẩu mà không qua duyệt, không mã
 * 6 số, không dòng "đã xem" nào trong nhật ký.
 */
test.describe('SEC-20 · ghi chú két không lộ mật khẩu', () => {
  test.beforeEach(() => {
    resetAccessList();
    resetSecrets();
    resetDevices();
  });

  /** SA dựng một switch + gán Member tầng "cần duyệt" trên loại Switch. */
  async function switchWithMemberNeedsApproval(page: Page, stamp: string) {
    const headers = await writeHeaders(page);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const typeId = catalog.deviceTypes.find((t) => t.name === 'Switch')!.id;
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: `SW-E2E-NOTE-${stamp}`, name: 'Switch ghi chú két', deviceTypeId: typeId },
    });
    expect(device.status(), await device.text()).toBe(201);
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;
    const access = await page.request.post('/api/v1/vault/access', {
      headers,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: typeId,
        tier: 'needs_approval',
      },
    });
    expect(access.ok(), await access.text()).toBe(true);
    return { deviceId, headers };
  }

  test('dựng lại đòn: Member cần-duyệt liệt kê két — không nhận chữ nào của ghi chú', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const { deviceId, headers } = await switchWithMemberNeedsApproval(page, stamp);
    const label = `admin web E2E ${stamp}`;
    const created = await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label,
        value: `Leak#E2E${stamp}Pw`,
        note: `Gọi NOC E2E ${stamp} trước khi reboot`,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const secretId = ((await created.json()) as { id: string }).id;
    /* Dữ liệu cất TRƯỚC khi có hàng rào ghi: ghi chú chứa đúng mật khẩu. Server giờ từ chối
       ghi như thế, nên dựng thẳng trong DB — đây là hàng thật đang nằm trên máy người thử. */
    const leaked = `Leak#E2E${stamp}Pw`;
    sql(`UPDATE secret SET note = 'mk: ${leaked}' WHERE id = '${secretId}'`);
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    const list = await page.request.get(
      `/api/v1/vault/secrets?ownerType=device&ownerId=${deviceId}`,
    );
    expect(list.status()).toBe(200);
    const body = await list.text();
    // Vế đối chứng: Member VẪN thấy tên ngăn — chỉ ghi chú bị giấu, không phải cả danh sách.
    expect(body).toContain(label);
    expect(body).not.toContain(leaked);
    expect(body).not.toContain('mk:');
    expect(JSON.parse(body)).toEqual([
      expect.objectContaining({ label, note: null, hasNote: true }),
    ]);

    // Màn hình cũng không in: chỉ nói "có ghi chú".
    await page.goto(`/devices/${deviceId}?tab=vault`);
    await expect(page.getByRole('row', { name: new RegExp(label) })).toBeVisible();
    await expect(page.getByText('Có ghi chú — hiện khi bạn mở được ngăn này')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(leaked);
  });

  test('đường hỏng: cất ngăn mà ghi chú là chính mật khẩu (hoặc trông như mật khẩu) bị từ chối', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const { deviceId, headers } = await switchWithMemberNeedsApproval(page, stamp);
    const value = `Sw#E2E${stamp}Core`;
    const base = { ownerType: 'device', ownerId: deviceId, kind: 'password', value };

    const same = await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: { ...base, label: `E2E trùng ${stamp}`, note: value.toLowerCase() },
    });
    expect(same.status()).toBe(400);
    const sameBody = await same.text();
    expect(JSON.parse(sameBody)).toMatchObject({ code: 'NOTE_CONTAINS_SECRET' });
    // Lỗi không được nhắc lại giá trị — thân lỗi đi qua log, toast và công cụ trình duyệt.
    expect(sameBody.toLowerCase()).not.toContain(value.toLowerCase());

    const looks = await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: { ...base, label: `E2E giống ${stamp}`, note: 'mk cũ Admin@123456' },
    });
    expect(looks.status()).toBe(400);
    expect(await looks.json()).toMatchObject({ code: 'NOTE_LOOKS_LIKE_SECRET' });

    // Form báo ngay tại ô và không gửi — không phải qua mã 6 số rồi mới biết.
    await page.goto(`/devices/${deviceId}?tab=vault`);
    await page.getByRole('button', { name: 'Cất mật khẩu/khóa' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill(`E2E form ${stamp}`);
    await form.getByRole('textbox', { name: 'Giá trị', exact: true }).fill(value);
    await form.getByRole('textbox', { name: 'Ghi chú' }).fill(`mk là ${value}`);
    await expect(form.getByText(/Ghi chú đang chứa chính giá trị/).first()).toBeVisible();
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form).toBeVisible();

    // Không ngăn nào lọt vào két qua ba lượt trên.
    const list = await page.request.get(
      `/api/v1/vault/secrets?ownerType=device&ownerId=${deviceId}`,
    );
    expect(await list.json()).toEqual([]);
  });
});
