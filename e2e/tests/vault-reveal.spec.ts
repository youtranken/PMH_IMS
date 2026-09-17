import { expect, test, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import {
  APP_ORIGIN,
  COMPOSE,
  E2E_MEMBER,
  E2E_SA,
  NEW_PASSWORD,
  SECOND_BROWSER,
  countAudit,
  expireStepUp,
  firstLogin,
  freshTotpCode,
  lastAudit,
  loginWithTotp,
  logout,
  resetDevices,
  resetSecrets,
  resetAccessList,
  resetUsers,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
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

async function setUpDeviceWithSecrets(
  page: Page,
  stamp: string,
  secrets: { label: string; value: string }[],
): Promise<{ deviceId: string; ids: string[]; typeId: string }> {
  const csrf = await csrfOf(page);
  const headers = { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN };
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const type = catalog.deviceTypes.find((t) => t.name === 'Switch')!;
  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: {
      code: `SW-E2E-RV-${stamp}`,
      name: 'Switch có két',
      deviceTypeId: type.id,
      serial: `FOC-RV-${stamp}`,
    },
  });
  const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

  const ids: string[] = [];
  for (const secret of secrets) {
    const created = await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: secret.label,
        value: secret.value,
      },
    });
    expect(created.status()).toBe(201);
    ids.push(((await created.json()) as { id: string }).id);
  }
  return { deviceId, ids, typeId: type.id };
}

/** Story 4.2 — FR-022: mở két phải gõ TOTP, hiện rồi tự ẩn, mỗi lần một dòng audit. */
test.describe('Mở két với TOTP step-up', () => {
  test('đường hạnh phúc: hết grace → gõ mã → giá trị hiện → xem tiếp secret khác không phải gõ lại', async ({
    page,
  }) => {
    const totpSecret = await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { deviceId } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
      { label: `SSH root E2E ${stamp}`, value: `Ssh#Pass#${stamp}` },
    ]);

    // Enroll TOTP vừa xong đã tính là step-up — đẩy mốc lùi để đúng cảnh "đã quá grace".
    expireStepUp(E2E_SA.email);

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();

    await page
      .getByRole('row', { name: new RegExp(`admin web E2E ${stamp}`) })
      .getByRole('button', { name: 'Xem' })
      .click();

    // Phải hỏi mã, KHÔNG được hiện giá trị và cũng không được đá về màn đăng nhập.
    await expect(page.getByRole('heading', { name: 'Xác nhận danh tính' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/devices/${deviceId}`));

    await page.getByLabel('Mã xác thực').fill(await freshTotpCode(totpSecret));
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();

    await expect(page.getByTestId('secret-value')).toHaveText(`Web#Pass#${stamp}`);
    /*
     * HAI đồng hồ đếm ngược, không phải một:
     *   trái  — giá trị này còn hiện bao lâu (`secret.reveal_seconds`, mặc định 60)
     *   phải  — còn mở được két bao lâu nữa mà không phải gõ lại mã (grace 10 phút)
     *
     * Số phải mới là thứ trả lời được câu ngay bên dưới ("xem tiếp secret khác không phải gõ
     * lại") — thiếu nó thì người dùng đoán mò và bị hỏi mã giữa chừng mà không hiểu vì sao.
     */
    const countdown = page.getByTestId('reveal-countdown');
    await expect(countdown).toContainText(/^\d+s/);
    await expect(page.getByTestId('stepup-countdown')).toContainText(/\d+s/);
    await page.getByRole('button', { name: 'Ẩn ngay' }).click();
    await expect(page.getByTestId('secret-value')).toHaveCount(0);

    // Trong grace: xem secret THỨ HAI không phải gõ mã lần nữa.
    await page
      .getByRole('row', { name: new RegExp(`SSH root E2E ${stamp}`) })
      .getByRole('button', { name: 'Xem' })
      .click();
    await expect(page.getByTestId('secret-value')).toHaveText(`Ssh#Pass#${stamp}`);
    await expect(page.getByRole('heading', { name: 'Xác nhận danh tính' })).toHaveCount(0);
  });

  test('đường hỏng: gõ sai mã thì không mở, ô nhập bị xóa để không bấm lại mã cũ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { deviceId } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
    ]);
    expireStepUp(E2E_SA.email);

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await page.getByRole('button', { name: 'Xem' }).click();

    await page.getByLabel('Mã xác thực').fill('000000');
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();

    await expect(page.getByRole('alert')).toContainText('Mã xác thực không đúng');
    await expect(page.getByTestId('secret-value')).toHaveCount(0);
    await expect(page.getByLabel('Mã xác thực')).toHaveValue('');
  });

  test('phiên hết grace không phải phiên chết: bị hỏi mã chứ không bị đá về đăng nhập', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { ids } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
    ]);
    expireStepUp(E2E_SA.email);

    const denied = await page.request.post(`/api/v1/vault/secrets/${ids[0]}/reveal`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
    });
    expect(denied.status()).toBe(401);
    expect(await denied.json()).toMatchObject({ code: 'STEPUP_REQUIRED' });
  });

  test('mỗi lần giải mã = một dòng audit, và response không được lưu đệm', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { ids } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
    ]);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    expect(countAudit('vault.secret.revealed', ids[0])).toBe(0);

    for (let i = 1; i <= 3; i += 1) {
      const opened = await page.request.post(`/api/v1/vault/secrets/${ids[0]}/reveal`, {
        headers,
      });
      expect(opened.status()).toBe(200);
      // Thiếu no-store thì bí mật nằm lại trong đệm trình duyệt — bấm Back ở máy dùng chung
      // là hiện lại, không cần đăng nhập.
      expect(opened.headers()['cache-control']).toContain('no-store');
      expect(((await opened.json()) as { value: string }).value).toBe(`Web#Pass#${stamp}`);
      expect(countAudit('vault.secret.revealed', ids[0])).toBe(i);
    }

    /*
     * DÒNG AUDIT PHẢI GHI ĐÚNG NGƯỜI — thêm 17/09/2026.
     *
     * Ba khẳng định ở trên chỉ ĐẾM. Đổi `actor` trong `vault.service.ts` thành hằng `'system'`
     * thì cả ba vẫn xanh, và nhật ký nộp auditor nói "có người xem" mà không nói được ai — thứ
     * vô dụng đúng vào lúc cần nó nhất.
     */
    const row = lastAudit('vault.secret.revealed', ids[0]);
    expect(row?.actor, 'dòng audit phải mang email người vừa mở, không phải một hằng số').toBe(
      E2E_SA.email,
    );
  });

  /**
   * THU HỒI LÀ CHẤM DỨT, KHÔNG PHẢI ẨN ĐI — bài này thêm 17/09/2026.
   *
   * Người ta bấm thu hồi đúng vào lúc nghi một mật khẩu đã lộ. Bộ kiểm trước đó chỉ khẳng định
   * "ngăn biến khỏi danh sách" — mà biến khỏi danh sách và không mở được là HAI chuyện khác
   * nhau: `listFor()` có vị từ `revokedAt` riêng của nó, nên bỏ hẳn vế `isNull(revokedAt)` ở
   * `requireAlive()` vẫn để danh sách sạch sẽ trong khi mọi id cũ vẫn mở ra plaintext. Toàn bộ
   * bộ kiểm khi đó vẫn xanh.
   *
   * Vế đầu (mở được TRƯỚC khi thu hồi) là vế đối chứng: thiếu nó thì bài này xanh cả khi đường
   * mở két hỏng hoàn toàn.
   */
  /**
   * CHỐNG REPLAY Ở ĐƯỜNG MỞ KÉT — bài này thêm 17/09/2026, và trước đó chỗ này trống.
   *
   * Mã Authenticator sống 30 giây; mối lo là người nhìn qua vai (hoặc bắt được gói tin) bắn lại
   * CHÍNH mã đó khi còn hạn. Hệ thống có chống — "đốt" mã bằng CAS trong cùng transaction với
   * lượt mở phiên — nhưng bộ kiểm chỉ canh điều đó ở đường ĐĂNG NHẬP (`auth.spec.ts`) và ở
   * tầng câu SQL (`api/test/totp-replay-cas.spec.ts`). Cửa `POST /auth/step-up` là một cửa gõ
   * mã KHÁC, và chưa bài nào gửi lại một mã đã dùng tới đó. Đổi `lastUsedTimeStep` thành `null`
   * trong `stepUp()` là xanh hết.
   *
   * Cố ý KHÔNG dùng `freshTotpCode` cho lượt thứ hai: chính helper đó tránh dùng lại mã, tức
   * tránh đúng thứ bài này sinh ra để thử.
   */
  test('mã 6 số đã dùng để mở két không dùng lại được', async ({ page }) => {
    const totpSecret = await firstLogin(page, E2E_SA);
    const code = await freshTotpCode(totpSecret);

    // Về trạng thái "cần gõ mã" rồi mới gõ — nếu không, lượt đầu đã nằm trong thời gian ân hạn.
    expireStepUp(E2E_SA.email);
    const first = await page.request.post('/api/v1/auth/step-up', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: { token: code },
    });
    expect(first.status(), 'vế đối chứng: mã còn hạn phải qua được bước xác thực').toBe(200);

    // Đẩy phiên về "cần gõ lại", rồi bắn lại ĐÚNG mã vừa dùng.
    expireStepUp(E2E_SA.email);
    const replay = await page.request.post('/api/v1/auth/step-up', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: { token: code },
    });
    expect(
      replay.status(),
      `mã đã dùng phải bị từ chối; nhận được ${replay.status()} ${await replay.text()}`,
    ).not.toBe(200);
  });

  test('thu hồi rồi thì id cũ KHÔNG mở ra giá trị nữa', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { ids } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
    ]);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    const before = await page.request.post(`/api/v1/vault/secrets/${ids[0]}/reveal`, { headers });
    expect(before.status(), 'chưa thu hồi thì phải mở được — vế đối chứng').toBe(200);

    const revoked = await page.request.delete(`/api/v1/vault/secrets/${ids[0]}`, { headers });
    expect(revoked.status()).toBe(200);

    const after = await page.request.post(`/api/v1/vault/secrets/${ids[0]}/reveal`, { headers });
    expect(after.status(), 'ngăn đã thu hồi mà vẫn mở được là thu hồi không có nghĩa gì').toBe(404);
    expect(await after.json()).toMatchObject({ code: 'SECRET_NOT_FOUND' });
    expect(
      await after.text(),
      'và thân phản hồi tuyệt đối không được mang theo giá trị cũ',
    ).not.toContain(`Web#Pass#${stamp}`);
  });

  test('Member gọi đường mở két nhận 403, không phải lời mời gõ mã', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { ids } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
    ]);
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    const denied = await page.request.post(`/api/v1/vault/secrets/${ids[0]}/reveal`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
    });
    // 403 chứ KHÔNG phải 401/STEPUP_REQUIRED: Member gõ mã đúng cũng vẫn không được xem.
    expect(denied.status()).toBe(403);
  });

  /**
   * Tự ẩn kiểm bằng ĐÚNG giá trị `secret.reveal_seconds` đang cấu hình, đọc từ chính API —
   * viết cứng 30 ở đây thì đổi cấu hình xong test vẫn xanh trong khi màn hình đã sai (AD-11).
   */
  test('giá trị tự ẩn sau đúng số giây trong system_config @slow', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { deviceId } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
    ]);

    const revealSeconds = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { config: { secretRevealSeconds: number } }).config
        .secretRevealSeconds;
    });
    test.setTimeout((revealSeconds + 40) * 1000);

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await page.getByRole('button', { name: 'Xem' }).click();
    await expect(page.getByTestId('secret-value')).toBeVisible();

    await expect(page.getByTestId('secret-value')).toHaveCount(0, {
      timeout: (revealSeconds + 10) * 1000,
    });
  });
  /**
   * Code review Epic 4, finding 1: trước đây gõ sai mã step-up chỉ ghi audit chứ không đếm,
   * nên kẻ cầm cookie phiên trộm được cứ thử cho tới khi trúng.
   *
   * Thu hồi PHIÊN chứ không khóa TÀI KHOẢN là có chủ ý — nên bài này kiểm cả hai vế: phiên
   * chết, mà tài khoản vẫn đăng nhập lại được bình thường. Khóa tài khoản thì chính kẻ tấn
   * công lại khóa được người dùng thật ra ngoài.
   */
  test('gõ sai mã liên tiếp đủ ngưỡng thì THU HỒI PHIÊN, nhưng không khóa tài khoản @slow', async ({
    page,
  }) => {
    const totpSecret = await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { ids } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
    ]);
    expireStepUp(E2E_SA.email);

    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    // Ngưỡng mặc định là 5 (system_config `secret.stepup_max_failures`).
    let lastStatus = 0;
    let lastBody: { code?: string } = {};
    for (let i = 0; i < 5; i += 1) {
      const res = await page.request.post('/api/v1/auth/step-up', {
        headers,
        data: { token: '000000' },
      });
      lastStatus = res.status();
      lastBody = (await res.json()) as { code?: string };
    }
    expect(lastStatus).toBe(401);
    expect(lastBody.code).toBe('SESSION_REVOKED');

    // Phiên chết thật: mở két bằng cookie cũ không còn ăn thua.
    const afterRevoke = await page.request.post(`/api/v1/vault/secrets/${ids[0]}/reveal`, {
      headers,
    });
    expect(afterRevoke.status()).toBe(401);

    // Tài khoản KHÔNG bị khóa — đăng nhập lại là dùng được ngay.
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, totpSecret);
    await expect(page.getByRole('heading', { name: /Xin chào/ })).toBeVisible();
  });

  /**
   * G-19 — Story 4.1 AC-2: trần 30 lần mở két mỗi phút, ĐẾM THEO USER.
   *
   * Hình dạng route "một id mỗi lần" một mình không giữ nổi FR-026: một phiên đã step-up cứ
   * liệt kê rồi mở lần lượt là rút cả két trong vài phút. Trần này là hàng rào PHÒNG, và nó
   * đã từng lặng lẽ lùi về đếm theo IP vì thứ tự guard sai — không có gì đỏ lúc đó.
   *
   * Vế thứ hai mới là vế khó làm giả: người thứ hai mở từ CÙNG MỘT IP (mọi test đều chạy từ
   * localhost) mà vẫn thông, thì con số 30 kia chắc chắn đang tính theo tài khoản.
   */
  test('mở quá 30 lần một phút thì bị chặn, và trần đếm theo USER chứ không theo IP @slow', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const testStart = Date.now();
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const { ids, typeId } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: `Web#Pass#${stamp}` },
    ]);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    // Member được whitelist để lát nữa mở được — không thì 403 và bài mất nghĩa.
    await page.request.post('/api/v1/vault/access', {
      headers,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: typeId,
        tier: 'whitelist',
      },
    });

    /**
     * Các bài phía trên trong CÙNG FILE cũng vừa mở két vài lần, và hit của họ vẫn nằm
     * trong cửa sổ 60 giây của throttler (khóa theo user). Không chờ chúng trôi hết thì
     * lần mở "thứ 30" của bài này thực chất là lần thứ 31+ và bị chặn oan. Mốc tính từ
     * LÚC BÀI BẮT ĐẦU là đủ: mọi hit cũ đều xảy ra trước đó, nên thời gian setup phía
     * trên đã được tính vào phần chờ.
     */
    const cleanAt = testStart + 61_000;
    if (Date.now() < cleanAt) {
      await new Promise((resolve) => setTimeout(resolve, cleanAt - Date.now()));
    }

    const windowStart = Date.now();
    try {
      for (let i = 1; i <= 30; i += 1) {
        const res = await page.request.post(`/api/v1/vault/secrets/${ids[0]}/reveal`, { headers });
        expect(res.status(), `lần mở thứ ${i} phải thông`).toBe(200);
      }
      const blocked = await page.request.post(`/api/v1/vault/secrets/${ids[0]}/reveal`, {
        headers,
      });
      expect(blocked.status(), 'lần thứ 31 phải bị chặn').toBe(429);

      const memberCtx = await browser.newContext(SECOND_BROWSER);
      const memberPage = await memberCtx.newPage();
      try {
        await firstLogin(memberPage, E2E_MEMBER);
        const byMember = await memberPage.request.post(
          `/api/v1/vault/secrets/${ids[0]}/reveal`,
          { headers: { 'X-CSRF-Token': await csrfOf(memberPage), Origin: APP_ORIGIN } },
        );
        expect(byMember.status(), 'người khác, cùng IP — trần của người kia không được dính').toBe(
          200,
        );
      } finally {
        await memberCtx.close();
      }
    } finally {
      /**
       * Chờ hết cửa sổ 60 giây TRƯỚC KHI rời bài — trong `finally` để bài đỏ giữa chừng
       * cũng vẫn dọn.
       *
       * Kho đếm của throttler nằm trong bộ nhớ tiến trình api và khóa theo (user, handler) —
       * nên bài này ăn sạch hạn mức mở-két của SA, và bài NGAY SAU đó nhận 429 vì lý do
       * chẳng liên quan gì tới nó. Dọn sau lưng mình ở đây rẻ hơn là bắt mọi bài khác phải
       * biết bài này tồn tại.
       */
      const left = 61_000 - (Date.now() - windowStart);
      if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
    }
  });

  /**
   * G-20 — Story 4.2 AC-2: giá trị secret không được xuất hiện trong log.
   *
   * `no-store` và audit đã có bài giữ. Phần log thì chưa: một `console.log` lỡ tay trong
   * service là secret nằm trong `docker compose logs` vĩnh viễn — nơi không mã hóa, không
   * xoay chìa, và ai có quyền đọc log là đọc được.
   */
  test('mở két xong thì log của api không chứa giá trị secret', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const secretValue = `LogRedact#${stamp}`;
    const { ids } = await setUpDeviceWithSecrets(page, stamp, [
      { label: `admin web E2E ${stamp}`, value: secretValue },
    ]);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    // Tự phòng vệ trước trần 30 lần/phút: nếu bài trước vừa ăn hết cửa sổ (kể cả khi nó đỏ
    // và không kịp dọn), thử lại tới khi cửa sổ trôi qua thay vì đỏ dây chuyền theo.
    let opened = await page.request.post(`/api/v1/vault/secrets/${ids[0]}/reveal`, { headers });
    for (let waited = 0; opened.status() === 429 && waited < 70; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      opened = await page.request.post(`/api/v1/vault/secrets/${ids[0]}/reveal`, { headers });
    }
    expect(opened.status()).toBe(200);
    expect(((await opened.json()) as { value: string }).value).toBe(secretValue);

    const logs = execSync(`${COMPOSE} logs api --since 5m --no-log-prefix`, {
      cwd: '..',
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(logs, 'giá trị secret lọt vào log api').not.toContain(secretValue);
    // Cả thân request lúc CẤT cũng không được lọt — đó mới là chỗ giá trị đi qua dạng thô.
    expect(logs, 'giá trị secret lọt vào log lúc cất').not.toContain(`"value":"${secretValue}"`);
  });
});
