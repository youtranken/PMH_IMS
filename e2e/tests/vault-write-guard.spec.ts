import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  expireStepUp,
  firstLogin,
  resetAccessList,
  resetSecrets,
  resetServiceAccounts,
  resetUsers,
  writeHeaders,
} from './helpers';

/**
 * Hai hàng rào của đợt A mà rà soát 07/09 xếp vào mẫu N1 — "hàng rào dựng ở một cửa, không áp
 * cho cửa tương đương ngay bên cạnh".
 *
 * C2: ĐỌC bí mật thì phải gõ mã 6 số (step-up), nhưng GHI ĐÈ thì không. Kẻ ngồi vào máy đang
 *     mở không đọc được mật khẩu switch cũ, nhưng xoay được nó thành chuỗi hắn tự chọn rồi
 *     dùng chính chuỗi đó — hoặc thu hồi bí mật đang dùng để phá.
 *
 * C1: két có ma trận quyền ba tầng, mặc định CẤM; kho file đính kèm thì không kiểm gì. Member
 *     bị `denied` trên một tài khoản dịch vụ vẫn liệt kê và tải được biên bản bàn giao của nó
 *     — loại giấy tờ hay chép sẵn thông tin đăng nhập.
 */

test.beforeEach(() => {
  resetUsers();
  resetSecrets();
  resetServiceAccounts();
  resetAccessList();
});

async function createServiceAccount(page: Page, code: string): Promise<string> {
  const created = await page.request.post('/api/v1/service-accounts', {
    headers: await writeHeaders(page),
    data: { code, name: `TK dich vu ${code}`, kind: 'shared', login: `u-${code}` },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

test.describe('C2 — ghi vào két cũng phải step-up', () => {
  test('hết grace thì XOAY và THU HỒI bị chặn, gõ mã xong mới làm được', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const ownerId = await createServiceAccount(page, `E2E-SU-${stamp}`);

    // Cất một bí mật lúc còn trong grace (vừa đăng nhập bằng TOTP).
    const created = await page.request.post('/api/v1/vault/secrets', {
      headers: await writeHeaders(page),
      data: {
        ownerType: 'service_account',
        ownerId,
        label: `E2E buoc ghi ${stamp}`,
        kind: 'password',
        value: 'Mat#Khau@Cu2026',
      },
    });
    expect(created.status()).toBe(201);
    const secretId = ((await created.json()) as { id: string }).id;

    // Đẩy mốc step-up lùi 1 giờ = giả lập "grace đã hết", không phải chờ 10 phút thật.
    expireStepUp(E2E_SA.email);

    /*
     * ĐỌC bị chặn — hàng rào này đã có từ story 4.2, đây chỉ là mốc đối chiếu.
     * Nếu dòng này đỏ thì hàng rào cũ hỏng, và hai khẳng định dưới mất ý nghĩa.
     */
    const reveal = await page.request.post(`/api/v1/vault/secrets/${secretId}/reveal`, {
      headers: await writeHeaders(page),
    });
    expect(reveal.status()).toBe(401);
    expect(((await reveal.json()) as { code: string }).code).toBe('STEPUP_REQUIRED');

    // XOAY phải bị chặn y như đọc. Bản chưa sửa trả 200 và mật khẩu bị ghi đè.
    const rotate = await page.request.post(`/api/v1/vault/secrets/${secretId}/rotate`, {
      headers: await writeHeaders(page),
      data: { value: 'Ke#Tan@Cong2026' },
    });
    expect(
      ((await rotate.json()) as { code?: string }).code,
      'xoay mật khẩu phải đòi step-up như khi đọc',
    ).toBe('STEPUP_REQUIRED');

    // THU HỒI cũng vậy — đây là đường phá hoại thẳng, không cần đọc được gì.
    const revoke = await page.request.delete(`/api/v1/vault/secrets/${secretId}`, {
      headers: await writeHeaders(page),
    });
    expect(
      ((await revoke.json()) as { code?: string }).code,
      'thu hồi bí mật phải đòi step-up',
    ).toBe('STEPUP_REQUIRED');

    /*
     * Ngăn két vẫn còn — tức lượt THU HỒI không lọt (thu hồi là xóa mềm, lọt thì nó biến khỏi
     * danh sách).
     *
     * Cố ý KHÔNG khẳng định "giá trị cũ còn nguyên" ở đây: `listFor` chỉ trả metadata, nên nó
     * không thể phát hiện một lượt XOAY lọt qua. Việc chứng minh xoay bị chặn nằm ở khẳng định
     * `STEPUP_REQUIRED` phía trên, và luồng xoay thành công sau khi gõ mã được chứng minh ở
     * `vault-write-stepup-ui.spec.ts`. Chú thích cũ hứa nhiều hơn thứ dòng dưới kiểm được
     * (rà soát 08/09, #8).
     */
    const stillThere = await page.request.get(
      `/api/v1/vault/secrets?ownerType=service_account&ownerId=${ownerId}`,
    );
    expect(stillThere.status()).toBe(200);
    expect((await stillThere.json()) as unknown[]).toHaveLength(1);
  });
});

test.describe('C1 — file đính kèm theo ma trận quyền của két', () => {
  test('Member bị cấm trên chủ thể thì KHÔNG liệt kê và KHÔNG tải được đính kèm', async ({
    page,
    browser,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const ownerId = await createServiceAccount(page, `E2E-FILE-${stamp}`);

    // SA đính một "biên bản bàn giao" vào tài khoản dịch vụ đó.
    const uploaded = await page.request.post('/api/v1/files', {
      headers: { 'X-CSRF-Token': (await writeHeaders(page))['X-CSRF-Token'], Origin: APP_ORIGIN },
      multipart: {
        ownerType: 'service_account',
        ownerId,
        file: {
          name: 'bien-ban-ban-giao.pdf',
          mimeType: 'application/pdf',
          // Magic `%PDF` là bắt buộc: `file-validation.ts` sniff byte đầu, không tin phần mở
          // rộng lẫn `Content-Type` client khai (NFR-9 whitelist).
          buffer: Buffer.from('%PDF-1.4\nmat khau VPN ghi tay tren giay to\n%%EOF\n'),
        },
      },
    });
    expect(uploaded.status()).toBe(201);
    const fileId = ((await uploaded.json()) as { id: string }).id;

    /*
     * Member CHƯA được gán quyền gì trên chủ thể này. Mặc định của ma trận là CẤM
     * (`access-list.service.ts` trả 'denied' khi không có luật nào), nên cả hai đường dưới
     * phải là 403. Bản chưa sửa: cả hai đều 200.
     */
    const memberCtx = await browser.newContext({
      baseURL: APP_ORIGIN,
      ignoreHTTPSErrors: true,
    });
    const memberPage = await memberCtx.newPage();
    try {
      await firstLogin(memberPage, E2E_MEMBER);

      const listed = await memberPage.request.get(
        `/api/v1/files?ownerType=service_account&ownerId=${ownerId}`,
      );
      expect(listed.status(), 'member bị cấm không được liệt kê đính kèm').toBe(403);

      const downloaded = await memberPage.request.get(`/api/v1/files/${fileId}/download`);
      expect(downloaded.status(), 'member bị cấm không được tải đính kèm').toBe(403);

      // Xóa đính kèm siết về SA/Admin — member không xóa được dù có id trong tay.
      const deleted = await memberPage.request.delete(`/api/v1/files/${fileId}`, {
        headers: await writeHeaders(memberPage),
      });
      expect(deleted.status(), 'member không được xóa đính kèm').toBe(403);
    } finally {
      await memberCtx.close();
    }

    // SA vẫn tải được bình thường — hàng rào không được chặn nhầm người có quyền.
    const saDownload = await page.request.get(`/api/v1/files/${fileId}/download`);
    expect(saDownload.status()).toBe(200);
  });

  /**
   * HÀNG RÀO CHỈ ÁP CHO `service_account` VÀ `isp` — Member vẫn xem được giấy tờ THIẾT BỊ.
   *
   * Bài này canh một hồi quy tôi ĐÃ gây ra rồi phải sửa (code review 08/09, #1): bản đầu gác
   * cả bốn loại của `SECRET_OWNER_TYPES`. Ma trận quyền là opt-in và `resolveTier` mặc định
   * `'denied'`, nên MỌI Member mất quyền xem MỌI hóa đơn, biên bản bàn giao thiết bị — đo
   * được HTTP 403. Story 2.3 nói đó là thứ cả team IT xem hằng ngày, và điều đó vẫn đúng.
   *
   * Bộ test cũ không bắt được vì `attachments.spec.ts` chỉ đăng nhập bằng SA. Bài này là chỗ
   * duy nhất chạy đường đó bằng Member.
   */
  test('nhưng Member VẪN xem được giấy tờ thiết bị — hàng rào không được rộng quá', async ({
    page,
    browser,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const typeId = catalog.deviceTypes.find((t) => t.name === 'PC')!.id;
    const device = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: { code: `PC-E2E-ATT-${stamp}`, name: 'May co hoa don', deviceTypeId: typeId },
    });
    expect(device.status()).toBe(201);
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    const uploaded = await page.request.post('/api/v1/files', {
      headers: { 'X-CSRF-Token': (await writeHeaders(page))['X-CSRF-Token'], Origin: APP_ORIGIN },
      multipart: {
        ownerType: 'device',
        ownerId: deviceId,
        file: {
          name: 'hoa-don.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\nhoa don mua may\n%%EOF\n'),
        },
      },
    });
    expect(uploaded.status()).toBe(201);
    const fileId = ((await uploaded.json()) as { id: string }).id;

    const memberCtx = await browser.newContext({ baseURL: APP_ORIGIN, ignoreHTTPSErrors: true });
    const memberPage = await memberCtx.newPage();
    try {
      await firstLogin(memberPage, E2E_MEMBER);

      const listed = await memberPage.request.get(
        `/api/v1/files?ownerType=device&ownerId=${deviceId}`,
      );
      expect(
        listed.status(),
        'story 2.3: hóa đơn thiết bị là thứ cả team IT xem hằng ngày',
      ).toBe(200);

      const downloaded = await memberPage.request.get(`/api/v1/files/${fileId}/download`);
      expect(downloaded.status(), 'Member phải tải được giấy tờ thiết bị').toBe(200);
    } finally {
      await memberCtx.close();
    }
  });
});
