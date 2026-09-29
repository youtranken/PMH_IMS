import { expect, test, type Page } from '@playwright/test';
import {
  confirmAction,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  logout,
  resetAccessList,
  resetUsers,
  rowAction,
  sql,
  searchAndWaitForFilter,
  uniqueStamp,
  writeHeaders,
} from './helpers';

test.beforeEach(() => resetUsers());

/** Tạo một tài khoản `e2e-tao-moi-…` qua API (SA vừa đăng nhập bằng 2 lớp nên còn ân hạn step-up). */
async function createAccount(
  page: Page,
  totpLoginRequired: boolean,
): Promise<{ id: string; email: string; fullName: string }> {
  const stamp = uniqueStamp();
  const email = `e2e-tao-moi-${stamp}@pmh.com.vn`;
  const fullName = `E2E Tài khoản ${stamp}`;
  const res = await page.request.post('/api/v1/accounts', {
    headers: await writeHeaders(page),
    data: { email, fullName, role: 'member', totpLoginRequired },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { user: { id: string } };
  return { id: body.user.id, email, fullName };
}

test.describe('Tài khoản — phản hồi, 2 lớp, bước tiếp theo', () => {
  test('Mở khóa hỏi lại, có toast, và xoá sạch bộ đếm sai + giãn chậm theo IP', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const acc = await createAccount(page, true);
    sql(
      `UPDATE users SET status = 'locked', failed_attempts = 6, locked_until = now() + interval '1 hour' WHERE id = '${acc.id}'`,
    );
    sql(
      `INSERT INTO login_failure (user_id, ip, failed_attempts, locked_until) VALUES ('${acc.id}', '198.51.100.7', 5, now() + interval '1 hour')`,
    );

    await page.goto('/admin/accounts');
    await searchAndWaitForFilter(page, acc.email);
    await rowAction(page, acc.fullName, 'Mở khóa');
    // Đường hỏng: bấm Hủy thì KHÔNG có gì xảy ra.
    await page.getByTestId('dialog-footer').getByRole('button', { name: 'Hủy' }).click();
    const row = page.getByRole('row', { name: new RegExp(acc.email) });
    await expect(row.getByText('Đang khóa')).toBeVisible();
    expect(sql(`SELECT status FROM users WHERE id = '${acc.id}'`)).toBe('locked');

    await rowAction(page, acc.fullName, 'Mở khóa');
    await confirmAction(page, 'Mở khóa');
    await expect(page.getByText(`Đã mở khóa ${acc.fullName}.`)).toBeVisible();
    await expect(row.getByText('Đang hoạt động')).toBeVisible();
    expect(sql(`SELECT failed_attempts FROM users WHERE id = '${acc.id}'`)).toBe('0');
    expect(sql(`SELECT count(*) FROM login_failure WHERE user_id = '${acc.id}'`)).toBe('0');
  });

  test('cột "2 lớp" ba trạng thái + bật/tắt "Bắt buộc 2 lớp khi đăng nhập" từ menu', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const acc = await createAccount(page, true);
    await page.goto('/admin/accounts');
    await searchAndWaitForFilter(page, acc.email);
    const row = page.getByRole('row', { name: new RegExp(acc.email) });
    await expect(row.getByText('Bắt buộc – chưa cài')).toBeVisible();

    await rowAction(page, acc.fullName, 'Bỏ bắt buộc 2 lớp khi đăng nhập');
    await confirmAction(page, 'Bỏ bắt buộc 2 lớp khi đăng nhập');
    await expect(page.getByText(`Đã bỏ bắt buộc 2 lớp cho ${acc.fullName}.`)).toBeVisible();
    await expect(row.getByText('Không bắt buộc')).toBeVisible();
    expect(sql(`SELECT totp_login_required FROM users WHERE id = '${acc.id}'`)).toBe('f');

    await rowAction(page, acc.fullName, 'Bắt buộc 2 lớp khi đăng nhập');
    await confirmAction(page, 'Bắt buộc 2 lớp khi đăng nhập');
    await expect(row.getByText('Bắt buộc – chưa cài')).toBeVisible();
    expect(sql(`SELECT totp_login_required FROM users WHERE id = '${acc.id}'`)).toBe('t');
  });

  test('TẤN CÔNG: Thành viên gọi thẳng PATCH totp-login-required → 403, cờ giữ nguyên', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const acc = await createAccount(page, true);
    await logout(page);
    await firstLogin(page, E2E_MEMBER);
    const res = await page.request.patch(`/api/v1/accounts/${acc.id}/totp-login-required`, {
      headers: await writeHeaders(page),
      data: { required: false },
    });
    expect(res.status()).toBe(403);
    expect(sql(`SELECT totp_login_required FROM users WHERE id = '${acc.id}'`)).toBe('t');
  });

  test('tạo tài khoản: mật khẩu tạm có Ẩn/Hiện + Chép, "Gán quyền két sắt" mở sẵn đúng người', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/accounts');
    const stamp = uniqueStamp();
    const email = `e2e-tao-moi-${stamp}@pmh.com.vn`;
    const fullName = `E2E Onboard ${stamp}`;
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    await page.getByRole('textbox', { name: 'Họ tên' }).fill(fullName);
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByRole('button', { name: 'Lưu' }).click();

    const dialog = page.getByRole('dialog', { name: new RegExp(`Mật khẩu tạm — ${email}`) });
    await expect(page.getByTestId('temp-password')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Chép mật khẩu tạm' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Ẩn' }).click();
    await expect(page.getByTestId('temp-password')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Hiện' }).click();
    await expect(page.getByTestId('temp-password')).toBeVisible();

    await expect(dialog.getByRole('button', { name: 'Gán thiết bị' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Gán quyền két sắt' }).click();
    await expect(page).toHaveURL(/\/admin\/vault-access\?user=/);
    await expect(page.getByRole('heading', { name: fullName })).toBeVisible();
  });
});

/**
 * ADM-040 — onboarding: "Sao chép quyền từ…" một đồng nghiệp (chỉ qua API gán sẵn có) và
 * "Gán thiết bị" mở danh sách thiết bị tìm sẵn theo tên người mới.
 */
test.describe('ADM-040 · sao chép quyền két, gán thiết bị theo tên', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test.beforeEach(() => resetAccessList());

  async function firstScope(page: Page): Promise<{ scopeType: string; scopeRef: string; label: string }> {
    const res = await page.request.get('/api/v1/vault/access/scopes');
    expect(res.status()).toBe(200);
    const scopes = (await res.json()) as { scopeType: string; scopeRef: string; label: string }[];
    expect(scopes.length, 'cần ít nhất một nhóm đối tượng để gán').toBeGreaterThan(0);
    return scopes[0];
  }

  async function grant(
    page: Page,
    memberEmail: string,
    scope: { scopeType: string; scopeRef: string },
    tier: 'whitelist' | 'needs_approval',
  ): Promise<void> {
    const res = await page.request.post('/api/v1/vault/access', {
      headers: await writeHeaders(page),
      data: { memberEmail, scopeType: scope.scopeType, scopeRef: scope.scopeRef, tier, note: 'E2E' },
    });
    expect(res.status(), await res.text()).toBe(201);
  }

  const tierOf = (email: string, scope: { scopeType: string; scopeRef: string }) =>
    sql(
      `SELECT tier FROM access_list WHERE member_email = '${email}' AND scope_type = '${scope.scopeType}' AND scope_ref = '${scope.scopeRef}'`,
    );

  test('người mới nhận đúng nhóm + tầng của đồng nghiệp', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const scope = await firstScope(page);
    const source = await createAccount(page, false);
    const target = await createAccount(page, false);
    await grant(page, source.email, scope, 'whitelist');

    await page.goto(`/admin/vault-access?user=${target.id}`);
    await expect(page.getByRole('heading', { name: target.fullName })).toBeVisible();
    await page.getByRole('button', { name: 'Sao chép quyền từ…' }).click();
    const dialog = page.getByRole('dialog', { name: `Sao chép quyền két cho ${target.fullName}` });
    await dialog.getByRole('button', { name: 'Đồng nghiệp' }).click();
    await page.getByRole('option', { name: new RegExp(source.fullName) }).click();
    await expect(dialog.getByText('Sẽ gán 1 nhóm:')).toBeVisible();
    await expect(dialog.getByText(`${scope.label} · Xem thẳng`)).toBeVisible();

    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gán quyền' }).click();
    await confirmAction(page, 'Gán quyền');
    await expect(page.getByText(`Đã sao chép 1 nhóm từ ${source.fullName}.`)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(tierOf(target.email, scope)).toBe('whitelist');
  });

  test('đường hỏng: nhóm người nhận đã có thì KHÔNG bị ghi đè tầng; hết nhóm thì báo, không ghi', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const scope = await firstScope(page);
    const source = await createAccount(page, false);
    const target = await createAccount(page, false);
    await grant(page, source.email, scope, 'whitelist');
    await grant(page, target.email, scope, 'needs_approval');

    await page.goto(`/admin/vault-access?user=${target.id}`);
    await page.getByRole('button', { name: 'Sao chép quyền từ…' }).click();
    const dialog = page.getByRole('dialog', { name: `Sao chép quyền két cho ${target.fullName}` });
    await dialog.getByRole('button', { name: 'Đồng nghiệp' }).click();
    await page.getByRole('option', { name: new RegExp(source.fullName) }).click();
    await expect(dialog.getByText('Bỏ qua 1 nhóm người này đã có:')).toBeVisible();

    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gán quyền' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Không còn nhóm nào để sao chép — người này đã có mọi nhóm của đồng nghiệp.',
    );
    expect(tierOf(target.email, scope), 'tầng riêng của người nhận phải giữ nguyên').toBe(
      'needs_approval',
    );
  });

  test('"Gán thiết bị" mở danh sách thiết bị tìm sẵn theo tên người mới', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/accounts');
    const stamp = uniqueStamp();
    const email = `e2e-tao-moi-${stamp}@pmh.com.vn`;
    const fullName = `E2E Gán máy ${stamp}`;
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    await page.getByRole('textbox', { name: 'Họ tên' }).fill(fullName);
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByRole('button', { name: 'Lưu' }).click();

    const dialog = page.getByRole('dialog', { name: new RegExp(`Mật khẩu tạm — ${email}`) });
    await expect(dialog.getByText(new RegExp(`tìm theo "${fullName}"`))).toBeVisible();
    await dialog.getByRole('button', { name: 'Gán thiết bị' }).click();
    await expect(page).toHaveURL(/\/devices\?q=/);
    await expect(page.getByRole('searchbox').first()).toHaveValue(fullName);
  });
});
