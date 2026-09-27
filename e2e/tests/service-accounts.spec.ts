import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  csrfOf,
  firstLogin,
  logout,
  resetServiceAccounts,
  resetUsers,
  rowAction,
  rowActionNames,
  uniqueStamp,
} from './helpers';

/**
 * Tài khoản dịch vụ (0032) — tài khoản DÙNG CHUNG và tài khoản VPN.
 *
 * Vì sao tồn tại: két sắt chỉ gắn được vào thiết bị hoặc hồ sơ phần mềm, nên mật khẩu email
 * dùng chung của Kế toán, tài khoản cổng VNPT… không có chỗ nào để đứng.
 *
 * Vì sao MỘT bảng cho hai loại: cả hai đều là "một tài khoản có mật khẩu trong két + có người
 * chịu trách nhiệm", chỉ khác vài ô. Bài kiểm dưới đây khoá đúng chỗ đó lại: ô của loại này
 * lọt sang loại kia phải bị chặn.
 */
test.beforeEach(() => {
  resetUsers();
  resetServiceAccounts();
});

async function createViaApi(page: Page, data: Record<string, unknown>) {
  const response = await page.request.post('/api/v1/service-accounts', {
    headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
    data,
  });
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

test.describe('Tài khoản dịch vụ', () => {
  test('đường hạnh phúc: khai email dùng chung trên UI → cất mật khẩu vào két', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `TK-E2E-${stamp}`;

    await page.goto('/service-accounts');
    await expect(page.getByRole('heading', { name: 'Tài khoản dịch vụ' })).toBeVisible();
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();

    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Mã tài khoản' }).fill(code);
    await form.getByRole('textbox', { name: 'Tên tài khoản' }).fill('Email kế toán');
    await form.getByRole('textbox', { name: 'Tên đăng nhập' }).fill('ketoan@pmh.com.vn');
    await form.getByRole('textbox', { name: 'Người phụ trách' }).fill('Chị Lan');

    // Loại mặc định là "dùng chung" nên khối VPN KHÔNG được hiện.
    await expect(form.getByRole('textbox', { name: 'Nhóm VPN' })).toHaveCount(0);
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Đã lưu tài khoản dịch vụ.')).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await expect(row.getByText('ketoan@pmh.com.vn')).toBeVisible();

    // Mật khẩu KHÔNG nằm trong hồ sơ — nó ở tab Két sắt, y hệt thiết bị và phần mềm.
    await row.getByRole('link', { name: code }).click();
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText('Chưa cất secret nào')).toBeVisible();

    await page.getByRole('button', { name: 'Cất secret' }).click();
    const vaultForm = page.getByRole('dialog');
    await vaultForm.getByRole('textbox', { name: 'Tên gọi' }).fill(`mk-email-E2E-${stamp}`);
    await vaultForm.getByLabel('Giá trị').fill('MatKhau#2026');
    await vaultForm.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText(`mk-email-E2E-${stamp}`)).toBeVisible();
  });

  /*
   * Khai nhanh: chỉ gõ TÊN ĐĂNG NHẬP và mật khẩu.
   *
   * "Mã" và "tên gọi" là thứ hệ thống cần chứ người dùng không cần — bắt gõ là bắt bịa. Và
   * mật khẩu cất ngay trong popup: bắt đi năm bước để cất nó thì phần lớn sẽ để "làm sau",
   * rồi mật khẩu ở lại trong Excel hay tin nhắn Zalo, đúng chỗ IMS sinh ra để dọn đi.
   */
  test('chỉ gõ tên đăng nhập + mật khẩu: mã và tên tự đặt, mật khẩu vào thẳng két', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const login = `ke-toan-e2e-${stamp}@pmh.com.vn`;

    await page.goto('/service-accounts');
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Tên đăng nhập' }).fill(login);
    await form.getByLabel('Mật khẩu', { exact: true }).fill('MatKhau#2026');

    // Thanh đo hiện tick xanh khi gõ đủ — và KHÔNG khóa nút Lưu, vì nó là lời khuyên.
    await expect(form.getByTestId('secret-strength')).toBeVisible();
    await expect(form.getByTestId('secret-strength-warning')).toHaveCount(0);

    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Đã lưu tài khoản dịch vụ.')).toBeVisible();
    await expect(page.getByText('Đã cất mật khẩu vào két.')).toBeVisible();

    // Mã tự đặt từ phần trước @, viết hoa.
    const code = `KE-TOAN-E2E-${stamp}`;
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await expect(row.getByText(login).first()).toBeVisible();

    // Và mật khẩu nằm trong két của chính hồ sơ vừa tạo, không phải ô ghi chú.
    await row.getByRole('link', { name: code }).click();
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText('Mật khẩu đăng nhập')).toBeVisible();
  });

  test('tài khoản VPN có thêm nhóm và dải IP; loại dùng chung thì không', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `VPN-E2E-${stamp}`;

    await page.goto('/service-accounts');
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Mã tài khoản' }).fill(code);
    await form.getByRole('textbox', { name: 'Tên tài khoản' }).fill('VPN kế toán');

    await form.getByRole('button', { name: 'Loại', exact: true }).click();
    await page.getByRole('option', { name: 'Tài khoản VPN', exact: true }).click();

    // Đổi sang VPN thì khối cấu hình VPN hiện ra.
    await form.getByRole('textbox', { name: 'Nhóm VPN' }).fill('vpn-ketoan');
    await form.getByRole('textbox', { name: 'Dải IP được phép' }).fill('203.113.1.5, 118.70.2.0/24');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Đã lưu tài khoản dịch vụ.')).toBeVisible();

    await page.getByRole('row', { name: new RegExp(code) }).getByRole('link', { name: code }).click();
    await expect(page.getByText('vpn-ketoan')).toBeVisible();
    await expect(page.getByText('203.113.1.5, 118.70.2.0/24')).toBeVisible();
  });

  test('đường hỏng: ô của loại VPN lọt vào tài khoản dùng chung thì bị chặn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    // Dữ liệu vô nghĩa mà sáu tháng sau không ai dám xóa vì không biết nó từng có ý gì.
    const result = await createViaApi(page, {
      code: `TK-E2E-BAD-${stamp}`,
      kind: 'shared',
      name: 'Email có nhóm VPN',
      groupName: 'vpn-ketoan',
      allowedIps: '1.2.3.4',
    });
    expect(result.status).toBe(400);
    expect(String(result.body.message)).toContain('dùng chung');
  });

  test('đường hỏng: dải IP sai định dạng bị chặn; dải quá rộng thì CẢNH BÁO chứ không chặn', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    const bad = await createViaApi(page, {
      code: `VPN-E2E-BAD-${stamp}`,
      kind: 'vpn',
      name: 'VPN dải hỏng',
      allowedIps: '1.2.3.4, rác',
    });
    expect(bad.status).toBe(400);
    expect(String(bad.body.message)).toContain('rác');

    // Cảnh báo ≠ lỗi: mở rộng vẫn lưu được, nhưng phải nói ra.
    const wide = await createViaApi(page, {
      code: `VPN-E2E-WIDE-${stamp}`,
      kind: 'vpn',
      name: 'VPN mở rộng',
      allowedIps: '0.0.0.0/0',
    });
    expect(wide.status).toBe(201);
    expect(String(wide.body.warnings)).toContain('rất rộng');

    /*
     * Sửa mà KHÔNG gửi lại dải IP thì cảnh báo vẫn phải còn.
     *
     * Ô không gửi = "đừng đụng tới", nên dòng trong DB vẫn nguyên `0.0.0.0/0`. Nếu luật chỉ
     * chạy trên body thì `PATCH {code, kind, name}` trả `warnings: []` — đọc thành "kiểm rồi,
     * sạch" cho một tài khoản VPN vẫn đang mở toang cho cả internet.
     */
    const id = wide.body.id as string;
    const patched = await page.request.patch(`/api/v1/service-accounts/${id}`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: { code: `VPN-E2E-WIDE-${stamp}`, kind: 'vpn', name: 'VPN mở rộng (đổi tên)' },
    });
    expect(patched.status()).toBe(200);
    const patchedBody = (await patched.json()) as Record<string, unknown>;
    expect(String(patchedBody.warnings)).toContain('rất rộng');
  });

  test('đường hỏng: trùng mã bị chặn kèm chính cái mã đang trùng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `TK-E2E-DUP-${stamp}`;

    expect((await createViaApi(page, { code, kind: 'shared', name: 'A' })).status).toBe(201);
    // Không phân biệt hoa/thường: "TK-x" và "tk-x" là cùng một thứ.
    const clash = await createViaApi(page, { code: code.toLowerCase(), kind: 'shared', name: 'B' });
    expect(clash.status).toBe(409);
    expect(String(clash.body.message)).toContain(code.toLowerCase());
  });

  test('Member đọc được nhưng KHÔNG ghi được', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const created = await createViaApi(page, {
      code: `TK-E2E-ROLE-${stamp}`,
      kind: 'shared',
      name: 'Tài khoản kiểm quyền',
    });
    expect(created.status).toBe(201);

    await logout(page);
    await firstLogin(page, E2E_MEMBER);

    // Đọc được: biết công ty có những tài khoản nào là việc bình thường của team IT.
    expect((await page.request.get('/api/v1/service-accounts?limit=5')).status()).toBe(200);

    // Ghi thì 403 — một tài khoản dùng chung bị sửa sai là cả phòng mất đường đăng nhập.
    const write = await page.request.post('/api/v1/service-accounts', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: { code: `TK-E2E-M-${stamp}`, kind: 'shared', name: 'Member thử ghi' },
    });
    expect(write.status()).toBe(403);

    // Và màn hình không bày nút ra để bấm rồi mới 403.
    await page.goto('/service-accounts');
    await expect(page.getByRole('button', { name: 'Thêm tài khoản' })).toHaveCount(0);
  });

  test('Member KHÔNG xem được mật khẩu của tài khoản dịch vụ — mặc định CẤM', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const created = await createViaApi(page, {
      code: `TK-E2E-SEC-${stamp}`,
      kind: 'shared',
      name: 'Tài khoản có mật khẩu',
    });
    const id = String(created.body.id);
    const stash = await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        ownerType: 'service_account',
        ownerId: id,
        kind: 'password',
        label: `mk-E2E-${stamp}`,
        value: 'MatKhau#2026',
      },
    });
    expect(stash.status()).toBe(201);

    await logout(page);
    await firstLogin(page, E2E_MEMBER);
    /*
     * Loại chủ thể mới CHƯA có nhóm đối tượng trong ma trận quyền, nên Member luôn bị từ chối.
     * Bài này khóa đúng chỗ đó: nếu ai đó lỡ để nó rơi vào nhánh "phần mềm" của `tierFor`,
     * một id trùng nhau giữa hai bảng có thể mở quyền theo một hồ sơ chẳng liên quan.
     */
    const read = await page.request.get(
      `/api/v1/vault/secrets?ownerType=service_account&ownerId=${id}`,
    );
    expect(read.status()).toBe(403);
  });

  test('đính kèm file cấu hình vào tài khoản VPN', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const created = await createViaApi(page, {
      code: `VPN-E2E-FILE-${stamp}`,
      kind: 'vpn',
      name: 'VPN có cấu hình',
      groupName: 'vpn-it',
    });
    const id = String(created.body.id);

    const pdf = join(tmpdir(), `cau-hinh-${stamp}.pdf`);
    writeFileSync(pdf, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n');

    await page.goto(`/service-accounts/${id}`);
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    await page.getByLabel('Chọn file để đính kèm').setInputFiles(pdf);
    await page.getByRole('button', { name: 'Tải lên' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`cau-hinh-${stamp}`) })).toBeVisible();
  });

  test('trang tổng Két sắt liệt kê cả tài khoản dịch vụ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `TK-E2E-VAULT-${stamp}`;
    const created = await createViaApi(page, { code, kind: 'shared', name: 'Có két' });
    const id = String(created.body.id);
    await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        ownerType: 'service_account',
        ownerId: id,
        kind: 'password',
        label: `mk-E2E-${stamp}`,
        value: 'MatKhau#2026',
      },
    });

    await page.goto('/vault');
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Tài khoản dịch vụ')).toBeVisible();

    // Lọc riêng loại này ra được.
    await page.getByRole('button', { name: /^Tài khoản dịch vụ \d+$/ }).click();
    await expect(row).toBeVisible();
  });

  /*
   * "Xóa" một tài khoản dịch vụ = vô hiệu hóa, và nó phải đi qua ĐÚNG MỘT cửa: hộp riêng bắt
   * ghi lý do. Nếu trạng thái còn là một ô chọn bình thường trong form Sửa thì người dùng đóng
   * tài khoản bằng `PATCH` thường — không lý do, lịch sử chỉ ghi "Sửa hồ sơ" — và sáu tháng sau
   * không ai trả lời được vì sao cái email dùng chung của Kế toán ngừng hoạt động.
   */
  test('vô hiệu hóa đi qua hộp riêng bắt ghi lý do; ô Trạng thái trong form là CHỈ ĐỌC', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `TK-E2E-OFF-${stamp}`;
    const created = await createViaApi(page, {
      code,
      kind: 'shared',
      name: 'Tài khoản sắp đóng',
      login: 'sapdong@pmh.com.vn',
    });
    expect(created.status).toBe(201);
    const id = String(created.body.id);

    await page.goto('/service-accounts');
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row.getByText('Đang dùng')).toBeVisible();

    // Cửa sau đã khóa: form Sửa chỉ HIỆN trạng thái, không cho chọn.
    await rowAction(page, code, 'Sửa');
    const editForm = page.getByRole('dialog');
    await expect(editForm.getByText('Đang dùng')).toBeVisible();
    await expect(editForm.getByRole('button', { name: 'Trạng thái', exact: true })).toHaveCount(0);
    await editForm.getByRole('button', { name: 'Hủy' }).click();

    // Cửa trước: nút riêng ngoài danh sách, và nó BẮT lý do.
    await rowAction(page, code, 'Vô hiệu hóa');
    const offForm = page.getByRole('dialog');
    await expect(offForm.getByText(/mật khẩu trong két .* vẫn còn/)).toBeVisible();
    await offForm.getByRole('textbox', { name: 'Lý do vô hiệu hóa' }).fill('nhân sự phụ trách đã nghỉ');
    await offForm.getByRole('button', { name: 'Vô hiệu hóa' }).click();

    await expect(page.getByText('Đã vô hiệu hóa tài khoản.')).toBeVisible();
    await expect(row.getByText('Đã vô hiệu hóa')).toBeVisible();
    // Đã đóng rồi thì không còn nút đóng nữa — bấm lần hai chỉ đẻ thêm một dòng lịch sử rỗng nghĩa.
    // Cột Thao tác là menu ba chấm từ 28/08/2026 — mở ra mới đọc được có mục nào.
    expect(await rowActionNames(page, code)).not.toContain('Vô hiệu hóa');

    // Lý do đi thẳng vào lịch sử, kèm chuyển trạng thái — đó mới là chỗ trả lời câu hỏi sáu tháng sau.
    await page.goto(`/service-accounts/${id}?tab=history`);
    const entry = page.getByRole('listitem').filter({ hasText: 'Vô hiệu hóa' });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('nhân sự phụ trách đã nghỉ');
    await expect(entry).toContainText('Đang dùng → Đã vô hiệu hóa');
  });

  /*
   * Đóng rồi phải mở lại được — và mở lại cũng kèm lý do.
   *
   * Bỏ nửa sau thì nửa đầu thành cái bẫy: hồ sơ đã đóng là đóng vĩnh viễn với người dùng giao
   * diện, vì ô Trạng thái trong form đã thành chỉ-đọc. Còn cho mở lại bằng `PATCH` thường thì
   * lý do lại rơi mất đúng ở chiều mà người ta cần nó nhất.
   */
  test('bật lại tài khoản đã đóng cũng bắt ghi lý do, và PATCH thường không lách được', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `TK-E2E-ON-${stamp}`;
    const created = await createViaApi(page, { code, kind: 'shared', name: 'Tài khoản mở lại' });
    expect(created.status).toBe(201);
    const id = String(created.body.id);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    const off = await page.request.patch(`/api/v1/service-accounts/${id}/disable`, {
      headers,
      data: { reason: 'tạm đóng chờ bàn giao' },
    });
    expect(off.status()).toBe(200);

    /*
     * Cửa sau bịt ở TẦNG API, không chỉ ẩn nút: `status` không còn trong DTO sửa, mà
     * `ValidationPipe` bật `forbidNonWhitelisted` — nên `PATCH {status:'active'}` bị chặn
     * thẳng, không phải "nhận rồi lặng lẽ bỏ qua".
     */
    const sneak = await page.request.patch(`/api/v1/service-accounts/${id}`, {
      headers,
      data: { code, kind: 'shared', name: 'Tài khoản mở lại', status: 'active' },
    });
    expect(sneak.status()).toBe(400);
    const stillOff = await page.request.get(`/api/v1/service-accounts/${id}`);
    expect(((await stillOff.json()) as { status: string }).status).toBe('disabled');

    // Cửa trước: nút Bật lại ngay trên dòng, kèm ô lý do.
    await page.goto('/service-accounts');
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row.getByText('Đã vô hiệu hóa')).toBeVisible();
    await rowAction(page, code, 'Bật lại');
    const onForm = page.getByRole('dialog');
    await onForm.getByRole('textbox', { name: 'Lý do bật lại' }).fill('nhân sự mới nhận bàn giao');
    await onForm.getByRole('button', { name: 'Bật lại' }).click();

    await expect(page.getByText('Đã bật lại tài khoản.')).toBeVisible();
    await expect(row.getByText('Đang dùng')).toBeVisible();

    await page.goto(`/service-accounts/${id}?tab=history`);
    const entry = page.getByRole('listitem').filter({ hasText: 'Bật lại' });
    await expect(entry).toContainText('nhân sự mới nhận bàn giao');
    await expect(entry).toContainText('Đã vô hiệu hóa → Đang dùng');

    // Mở một tài khoản đang mở không đẻ ra dòng lịch sử rỗng nghĩa.
    const again = await page.request.patch(`/api/v1/service-accounts/${id}/enable`, {
      headers,
      data: { reason: 'bấm nhầm lần hai' },
    });
    expect(again.status()).toBe(400);
    expect(String(((await again.json()) as Record<string, unknown>).message)).toContain(
      'đang dùng bình thường',
    );
  });

  test('đường hỏng: vô hiệu hóa không lý do bị chặn, và Member không đóng được tài khoản', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const created = await createViaApi(page, {
      code: `TK-E2E-OFF-BAD-${stamp}`,
      kind: 'shared',
      name: 'Tài khoản kiểm lý do',
    });
    expect(created.status).toBe(201);
    const id = String(created.body.id);

    // Lý do toàn khoảng trắng KHÔNG phải là lý do.
    const blank = await page.request.patch(`/api/v1/service-accounts/${id}/disable`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: { reason: '   ' },
    });
    expect(blank.status()).toBe(400);
    expect(String(((await blank.json()) as Record<string, unknown>).message)).toContain('lý do');

    // Và hồ sơ vẫn nguyên trạng — 400 không được để lại nửa lần ghi.
    const still = await page.request.get(`/api/v1/service-accounts/${id}`);
    expect(((await still.json()) as { status: string }).status).toBe('active');

    await logout(page);
    await firstLogin(page, E2E_MEMBER);
    const asMember = await page.request.patch(`/api/v1/service-accounts/${id}/disable`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: { reason: 'member thử đóng' },
    });
    expect(asMember.status()).toBe(403);
  });
});
