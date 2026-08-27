import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_MEMBER, E2E_SA, firstLogin, logout, resetUsers, sql } from './helpers';

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

function resetServiceAccounts(): void {
  sql(
    "ALTER TABLE service_account_history DISABLE TRIGGER service_account_history_no_delete; " +
      "DELETE FROM secret WHERE owner_type = 'service_account' AND owner_id IN (SELECT id FROM service_account WHERE code ILIKE '%E2E%'); " +
      "DELETE FROM file WHERE owner_type = 'service_account' AND owner_id IN (SELECT id FROM service_account WHERE code ILIKE '%E2E%'); " +
      "DELETE FROM service_account_history WHERE service_account_id IN (SELECT id FROM service_account WHERE code ILIKE '%E2E%'); " +
      "ALTER TABLE service_account_history ENABLE TRIGGER service_account_history_no_delete; " +
      "DELETE FROM service_account WHERE code ILIKE '%E2E%'",
  );
}

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function createViaApi(page: Page, data: Record<string, unknown>) {
  const response = await page.request.post('/api/v1/service-accounts', {
    headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
    data,
  });
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

test.describe('Tài khoản dịch vụ', () => {
  test('đường hạnh phúc: khai email dùng chung trên UI → cất mật khẩu vào két', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
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

  test('tài khoản VPN có thêm nhóm và dải IP; loại dùng chung thì không', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
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
    const stamp = Date.now().toString().slice(-6);

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
    const stamp = Date.now().toString().slice(-6);

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
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
      data: { code: `VPN-E2E-WIDE-${stamp}`, kind: 'vpn', name: 'VPN mở rộng (đổi tên)' },
    });
    expect(patched.status()).toBe(200);
    const patchedBody = (await patched.json()) as Record<string, unknown>;
    expect(String(patchedBody.warnings)).toContain('rất rộng');
  });

  test('đường hỏng: trùng mã bị chặn kèm chính cái mã đang trùng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `TK-E2E-DUP-${stamp}`;

    expect((await createViaApi(page, { code, kind: 'shared', name: 'A' })).status).toBe(201);
    // Không phân biệt hoa/thường: "TK-x" và "tk-x" là cùng một thứ.
    const clash = await createViaApi(page, { code: code.toLowerCase(), kind: 'shared', name: 'B' });
    expect(clash.status).toBe(409);
    expect(String(clash.body.message)).toContain(code.toLowerCase());
  });

  test('Member đọc được nhưng KHÔNG ghi được', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
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
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
      data: { code: `TK-E2E-M-${stamp}`, kind: 'shared', name: 'Member thử ghi' },
    });
    expect(write.status()).toBe(403);

    // Và màn hình không bày nút ra để bấm rồi mới 403.
    await page.goto('/service-accounts');
    await expect(page.getByRole('button', { name: 'Thêm tài khoản' })).toHaveCount(0);
  });

  test('Member KHÔNG xem được mật khẩu của tài khoản dịch vụ — mặc định CẤM', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const created = await createViaApi(page, {
      code: `TK-E2E-SEC-${stamp}`,
      kind: 'shared',
      name: 'Tài khoản có mật khẩu',
    });
    const id = String(created.body.id);
    const stash = await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
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
    const stamp = Date.now().toString().slice(-6);
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
    const stamp = Date.now().toString().slice(-6);
    const code = `TK-E2E-VAULT-${stamp}`;
    const created = await createViaApi(page, { code, kind: 'shared', name: 'Có két' });
    const id = String(created.body.id);
    await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
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
    await page.getByRole('button', { name: 'Tài khoản dịch vụ', exact: true }).click();
    await expect(row).toBeVisible();
  });
});
