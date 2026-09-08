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
    expireStepUp();

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

    // Giá trị cũ phải còn nguyên: không lượt ghi nào lọt qua.
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
});
