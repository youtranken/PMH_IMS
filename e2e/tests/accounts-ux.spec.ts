import { expect, test, type Page } from '@playwright/test';
import {
  confirmAction,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  logout,
  resetUsers,
  rowAction,
  sql,
  timVaChoLoc,
  uniqueStamp,
  writeHeaders,
} from './helpers';

test.beforeEach(() => resetUsers());

/** Tạo một tài khoản `e2e-tao-moi-…` qua API (SA vừa đăng nhập bằng 2 lớp nên còn ân hạn step-up). */
async function taoTaiKhoan(
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
    const acc = await taoTaiKhoan(page, true);
    sql(
      `UPDATE users SET status = 'locked', failed_attempts = 6, locked_until = now() + interval '1 hour' WHERE id = '${acc.id}'`,
    );
    sql(
      `INSERT INTO login_failure (user_id, ip, failed_attempts, locked_until) VALUES ('${acc.id}', '198.51.100.7', 5, now() + interval '1 hour')`,
    );

    await page.goto('/admin/accounts');
    await timVaChoLoc(page, acc.email);
    await rowAction(page, acc.fullName, 'Mở khóa');
    // Đường hỏng: bấm Hủy thì KHÔNG có gì xảy ra.
    await page.getByRole('dialog').getByRole('button', { name: 'Hủy' }).click();
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
    const acc = await taoTaiKhoan(page, true);
    await page.goto('/admin/accounts');
    await timVaChoLoc(page, acc.email);
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
    const acc = await taoTaiKhoan(page, true);
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
