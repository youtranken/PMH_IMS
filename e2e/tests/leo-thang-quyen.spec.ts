import { randomUUID } from 'node:crypto';
import { expect, test, request as pwRequest } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  expireStepUp,
  firstLogin,
  freshTotpCode,
  resetSecrets,
  resetUsers,
  sql,
  writeHeaders,
  uniqueStamp,
} from './helpers';

/**
 * CHUỖI LEO THANG QUYỀN — nợ cũ trên `master`, đóng ngày 10/09.
 *
 * ===== ĐƯỜNG ĐI, SÁU BƯỚC, KHÔNG CẦN YẾU TỐ THỨ HAI CỦA NẠN NHÂN =====
 *
 * `@RequiresStepUp()` là opt-in, và tới 10/09 nó xuất hiện đúng 5 lần trong cả repo — tất cả ở
 * `vault.controller.ts`. Toàn bộ `/api/v1/accounts/*` đứng ngoài hàng rào. Với một phiên SA bị
 * chiếm — đúng mô hình đe doạ mà chính cửa két nêu ra: "cookie trộm, máy bỏ ngỏ, chưa từng gõ
 * mã, hoặc đã hết grace" — kẻ tấn công đi được trọn:
 *
 *   1. `GET /auth/me` lấy CSRF token (GET nên CsrfGuard bỏ qua).
 *   2. `POST /accounts` tạo tài khoản SA mới. Response trả THẲNG `temporaryPassword`.
 *   3. `POST /auth/login` bằng tài khoản đó, `totpLoginRequired: false` → vào ngay.
 *   4. `POST /auth/totp/enroll` trả `secret` base32 nguyên văn → tự sinh mã 6 số.
 *   5. `POST /auth/step-up` → đóng dấu `stepped_up_at`.
 *   6. `POST /vault/secrets/:id/reveal` → plaintext.
 *
 * Cửa két được dựng để "kể cả root cũng phải gõ mã". Đường trên vô hiệu hoá đúng lời hứa đó,
 * và nó không cần một lỗ hổng nào — chỉ cần đi qua những cửa không ai gắn hàng rào.
 *
 * ===== BÀI NÀY CHẶN Ở BƯỚC 2 =====
 *
 * Bước 2 là mắt xích ngắn nhất và cũng là chỗ đúng để chặn: nếu tạo tài khoản đòi gõ mã thì cả
 * chuỗi đứt ngay, và mọi biến thể của nó (`reset-password`, `reset-totp`,
 * `totp-login-required`) cũng đứt vì cùng lý do.
 *
 * Mỗi cửa đi kèm VẾ ĐỐI CHỨNG "gõ mã xong thì làm được". Không có chúng thì một bản vá
 * chặn-hết-cho-chắc cũng xanh, và SA mất luôn khả năng quản trị tài khoản.
 */

test.beforeEach(() => {
  resetUsers();
  resetSecrets();
});

/**
 * Gieo một phiếu break-glass ở trạng thái CHỜ, trả về id.
 *
 * MỘT DÒNG và không dấu nháy kép: `sql()` bọc câu lệnh trong `-c "..."` của shell, nên xuống
 * dòng làm cụt câu và `'{"hours": 2}'` đụng ngay dấu nháy bao ngoài. Dùng `jsonb_build_object`
 * thay cho JSON viết tay.
 *
 * Tự sinh `id` ở JS + `ON CONFLICT DO NOTHING`: `sql()` đi qua `dockerExec`, mà hàm đó THỬ LẠI
 * 3 lần. Lập luận "mọi lệnh qua cửa này đều toàn phần" chỉ đúng với 7 chỗ dùng hiện có — tất
 * cả đều `UPDATE ... SET`. Một `INSERT` trần ở đây là chỗ đầu tiên phá vỡ quy ước đó, và một
 * lượt docker chớp giữa chừng sẽ đẻ ra ba phiếu.
 */
function seedPendingBreakGlass(requester: string, deviceId: string): string {
  const id = randomUUID();
  sql(
    `INSERT INTO approval (id, kind, state, requester, subject_type, subject_id, reason, payload) ` +
      `VALUES ('${id}', 'break_glass', 'pending', '${requester}', 'device', '${deviceId}', ` +
      `'Su co ngoai gio E2E', jsonb_build_object('hours', 2)) ON CONFLICT (id) DO NOTHING`,
  );
  return id;
}

test.describe('Bề mặt quản trị tài khoản đòi step-up', () => {
  test('hết grace: TẠO TÀI KHOẢN bị chặn — mắt xích số 2 của chuỗi leo thang', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = await writeHeaders(page);
    const stamp = uniqueStamp();

    expireStepUp(E2E_SA.email);

    const blocked = await page.request.post('/api/v1/accounts', {
      headers,
      data: {
        email: `e2e-tao-moi-leo-thang-${stamp}@pmh.com.vn`,
        fullName: 'Tai khoan leo thang',
        role: 'sa',
        totpLoginRequired: false,
      },
    });

    expect(
      blocked.status(),
      'tạo tài khoản trả thẳng temporaryPassword — đây là cửa dựng đường vào, phải đòi mã',
    ).toBe(401);
    const body = (await blocked.json()) as { code?: string };
    expect(body.code).toBe('STEPUP_REQUIRED');

    // Và KHÔNG được tạo ra gì cả — chặn mà vẫn ghi thì tệ hơn không chặn.
    expect(
      sql(`SELECT count(*)::text FROM users WHERE email = 'e2e-tao-moi-leo-thang-${stamp}@pmh.com.vn'`),
    ).toBe('0');
  });

  test('VẾ ĐỐI CHỨNG: gõ mã xong thì SA vẫn tạo được tài khoản', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const headers = await writeHeaders(page);
    const stamp = uniqueStamp();

    expireStepUp(E2E_SA.email);
    const stepUp = await page.request.post('/api/v1/auth/step-up', {
      headers,
      data: { token: await freshTotpCode(secret) },
    });
    expect(stepUp.status(), 'gõ mã phải được chấp nhận').toBeLessThan(300);

    const created = await page.request.post('/api/v1/accounts', {
      headers,
      data: {
        email: `e2e-tao-moi-sau-ma-${stamp}@pmh.com.vn`,
        fullName: 'Tai khoan hop le',
        role: 'member',
        totpLoginRequired: true,
      },
    });
    expect(created.status(), 'hàng rào không được nhốt SA khỏi việc quản trị tài khoản').toBe(201);
  });

  /**
   * Cửa NGUY HIỂM NHẤT của bề mặt này: xoá yếu tố thứ hai của MỘT NGƯỜI KHÁC. Nếu chính nó
   * không đòi yếu tố thứ hai, toàn bộ 2FA của hệ thống chỉ mạnh bằng một cái cookie.
   */
  test('hết grace: XOÁ 2FA của người khác bị chặn', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const headers = await writeHeaders(page);
    const stamp = uniqueStamp();

    expireStepUp(E2E_SA.email);
    await page.request.post('/api/v1/auth/step-up', {
      headers,
      data: { token: await freshTotpCode(secret) },
    });
    const victim = await page.request.post('/api/v1/accounts', {
      headers,
      data: {
        email: `e2e-tao-moi-nan-nhan-${stamp}@pmh.com.vn`,
        fullName: 'Nan nhan',
        role: 'member',
        totpLoginRequired: true,
      },
    });
    expect(victim.status()).toBe(201);
    const victimId = ((await victim.json()) as { user: { id: string } }).user.id;

    expireStepUp(E2E_SA.email);
    const blocked = await page.request.post(`/api/v1/accounts/${victimId}/reset-totp`, { headers });
    expect(blocked.status()).toBe(401);
    expect(((await blocked.json()) as { code?: string }).code).toBe('STEPUP_REQUIRED');
  });

});

test.describe('Bắt đổi mật khẩu tạm là hàng rào của SERVER, không phải của giao diện', () => {
  /**
   * `must_change_password` mặc định `true` cho mọi tài khoản mới. Tới 10/09 cờ đó chỉ được ĐỌC
   * và trả về client — `nextStepPath()` bên web là ràng buộc duy nhất. Nghĩa là mật khẩu tạm
   * (đã đi qua email hoặc đọc qua điện thoại, và nằm nguyên trong response của `POST /accounts`)
   * dùng được VÔ THỜI HẠN nếu gọi API thẳng, không mở trình duyệt.
   *
   * Bài này KHÔNG dùng giao diện — đó là cả ý nghĩa của nó.
   */
  test('tài khoản chưa đổi mật khẩu tạm không gọi được API nghiệp vụ', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const headers = await writeHeaders(page);
    const stamp = uniqueStamp();

    expireStepUp(E2E_SA.email);
    await page.request.post('/api/v1/auth/step-up', {
      headers,
      data: { token: await freshTotpCode(secret) },
    });
    const email = `e2e-tao-moi-tam-${stamp}@pmh.com.vn`;
    const created = await page.request.post('/api/v1/accounts', {
      headers,
      data: { email, fullName: 'Mat khau tam', role: 'member', totpLoginRequired: false },
    });
    expect(created.status()).toBe(201);
    const temporaryPassword = ((await created.json()) as { temporaryPassword: string })
      .temporaryPassword;

    // Trình duyệt thứ hai, sạch — mô phỏng một client gọi API thẳng.
    const api = await pwRequest.newContext({ baseURL: APP_ORIGIN, ignoreHTTPSErrors: true });
    try {
      const login = await api.post('/api/v1/auth/login', {
        headers: { Origin: APP_ORIGIN },
        data: { email, password: temporaryPassword },
      });
      expect(login.status(), 'mật khẩu tạm vẫn đăng nhập được — đó là điểm bắt đầu').toBe(200);

      const me = await api.get('/api/v1/auth/me');
      expect(me.status(), '/auth/me phải mở, web cần nó để biết đang thiếu bước nào').toBe(200);
      expect(((await me.json()) as { mustChangePassword: boolean }).mustChangePassword).toBe(true);

      const blocked = await api.get('/api/v1/devices');
      expect(
        blocked.status(),
        'chưa đổi mật khẩu tạm mà đọc được dữ liệu nghiệp vụ = hàng rào chỉ nằm ở giao diện',
      ).toBe(403);
      expect(((await blocked.json()) as { code?: string }).code).toBe('PASSWORD_CHANGE_REQUIRED');
    } finally {
      await api.dispose();
    }
  });
});

test.describe('Break-glass — nguyên tắc bốn mắt (FR-023)', () => {
  /**
   * `POST /vault/break-glass` mở cho cả `member`, `admin` và `sa` ("ai cũng XIN được, kể cả
   * Admin"), còn `approve` mở cho `sa`/`admin`. Tới 10/09 `approve()` KHÔNG so `approver` với
   * `request.requester` — trong khi `cancel()` ngay bên dưới thì có, và có vì đúng lý do này
   * (code review Epic 6, finding 1).
   *
   * Tác động quyền thì hạn chế: Admin vốn đã đi thẳng qua ma trận nên grant không cho thêm gì.
   * Thứ mất đi là ĐỘ TIN CẬY CỦA SỔ: nhật ký FR-025 in ra một grant "đã được duyệt" nhìn hợp
   * lệ hoàn toàn, `decided_by` là chính người xin — và đó là thứ auditor đọc.
   *
   * ===== VÌ SAO GIEO PHIẾU BẰNG SQL =====
   *
   * Dựng một phiếu chờ qua API đòi cả một chuỗi cấp quyền không liên quan: `request()` gọi
   * `tierFor()`, mà `tierFor` trả `denied` khi chủ thể chưa thuộc nhóm nào trong ma trận. Cả
   * chuỗi đó là bối cảnh, không phải thứ đang kiểm.
   *
   * Và đây KHÁC với kiểu "gieo SQL rồi kiểm chính cái mình vừa gieo": thứ đang kiểm là
   * `approve()`, và bài này gọi ĐÚNG endpoint duyệt thật, qua đúng guard thật. Chỉ khâu tạo
   * phiếu là dựng sẵn.
   */
  test('người xin không tự duyệt cho chính mình được', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const headers = await writeHeaders(page);
    const stamp = uniqueStamp();

    const catalog = (await (
      await page.request.get('/api/v1/catalog', { headers })
    ).json()) as { deviceTypes: { id: string; name: string }[] };
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: {
        code: `BG-E2E-4M-${stamp}`,
        name: 'May xin break-glass',
        deviceTypeId: catalog.deviceTypes[0].id,
      },
    });
    expect(device.status()).toBe(201);
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    // Phiếu CHỜ, người xin chính là tài khoản đang đăng nhập.
    const requestId = seedPendingBreakGlass(E2E_SA.email, deviceId);
    expect(requestId, 'gieo được phiếu thì mới có gì để duyệt').toMatch(/[0-9a-f-]{36}/);

    // `approve` nay đòi step-up; gõ mã trước để lỗi trả về là lỗi BỐN MẮT, không phải thiếu mã.
    expireStepUp(E2E_SA.email);
    await page.request.post('/api/v1/auth/step-up', {
      headers,
      data: { token: await freshTotpCode(secret) },
    });

    const selfApprove = await page.request.post(
      `/api/v1/vault/break-glass/${requestId}/approve`,
      { headers, data: { hours: 2 } },
    );
    expect(
      selfApprove.status(),
      'tự duyệt cho chính mình = nhật ký in ra một grant hợp lệ mà không ai thật sự duyệt',
    ).toBe(403);
    expect(((await selfApprove.json()) as { code?: string }).code).toBe(
      'CANNOT_APPROVE_OWN_REQUEST',
    );

    // Chặn mà vẫn chuyển trạng thái thì vô nghĩa — phiếu phải nằm nguyên ở `pending`.
    expect(sql(`SELECT state FROM approval WHERE id = '${requestId}'`)).toBe('pending');
  });

  /**
   * VẾ ĐỐI CHỨNG: người KHÁC duyệt thì phải chạy. Không có nó thì một bản "approve luôn ném"
   * cũng xanh, và break-glass — đường cứu hộ lúc 2 giờ sáng — chết lặng.
   */
  test('người khác duyệt thì phiếu sang `approved`', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const headers = await writeHeaders(page);
    const stamp = uniqueStamp();

    const catalog = (await (
      await page.request.get('/api/v1/catalog', { headers })
    ).json()) as { deviceTypes: { id: string; name: string }[] };
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: {
        code: `BG-E2E-OK-${stamp}`,
        name: 'May xin break-glass 2',
        deviceTypeId: catalog.deviceTypes[0].id,
      },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    // Người xin là NGƯỜI KHÁC — đúng một chữ khác so với bài trên.
    const requestId = seedPendingBreakGlass('nguoi-khac-e2e@pmh.com.vn', deviceId);

    expireStepUp(E2E_SA.email);
    await page.request.post('/api/v1/auth/step-up', {
      headers,
      data: { token: await freshTotpCode(secret) },
    });

    const approved = await page.request.post(
      `/api/v1/vault/break-glass/${requestId}/approve`,
      { headers, data: { hours: 2 } },
    );
    expect(approved.status(), 'bốn mắt chặn người XIN, không chặn người duyệt').toBeLessThan(300);
    expect(sql(`SELECT state FROM approval WHERE id = '${requestId}'`)).toBe('approved');
    expect(sql(`SELECT decided_by FROM approval WHERE id = '${requestId}'`)).toBe(E2E_SA.email);
  });
});
