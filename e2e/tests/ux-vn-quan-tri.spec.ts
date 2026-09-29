import { expect, test, type Page } from '@playwright/test';
import {
  catalogItem,
  catalogTab,
  confirmAction,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  lastAudit,
  resetAccessList,
  resetCatalog,
  resetUsers,
  rowAction,
  rowActionNames,
  sql,
  timVaChoLoc,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Đợt UX vừa/nhẹ nhóm Quản trị: Danh mục · Tài khoản · Nhật ký hệ thống · Quyền két sắt.
 * Mỗi khối một đường hạnh phúc + một đường hỏng. Mọi hàng tạo ra mang chữ `E2E`.
 */

test.beforeEach(() => {
  resetUsers();
});

test.afterAll(() => {
  resetCatalog();
  resetAccessList();
});

async function taoThanhVien(page: Page): Promise<{ id: string; email: string; fullName: string }> {
  const stamp = uniqueStamp();
  const email = `e2e-tao-moi-${stamp}@pmh.com.vn`;
  const fullName = `E2E Nghỉ việc ${stamp}`;
  const res = await page.request.post('/api/v1/accounts', {
    headers: await writeHeaders(page),
    data: { email, fullName, role: 'member', totpLoginRequired: false },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { user: { id: string } };
  return { id: body.user.id, email, fullName };
}

test.describe('Danh mục — trạng thái trên URL, lọc, file mẫu trong hộp nhập', () => {
  test('tab + lọc trạng thái sống trên URL; F5 mở lại đúng chỗ; đổi mã phải bấm "Đổi mã…"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const code = `E2E-URL-${uniqueStamp()}`;
    await catalogItem(page, 'site', { code, name: 'Site E2E url' });

    await page.goto('/admin/catalog?tab=cabinet');
    await expect(page.getByRole('tab', { name: catalogTab('Tủ mạng') })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: catalogTab('Site') }).click();
    await page.getByRole('button', { name: 'Lọc theo trạng thái' }).click();
    await page.getByRole('option', { name: 'Đang dùng' }).click();
    await expect(page).toHaveURL(/status=active/);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Lọc theo trạng thái' })).toContainText('Đang dùng');

    await timVaChoLoc(page, code);
    await rowAction(page, code, 'Sửa');
    const hop = page.getByRole('dialog', { name: new RegExp(`Sửa — ${code}`) });
    await expect(hop.getByText(code, { exact: true })).toBeVisible();
    await expect(hop.getByRole('textbox', { name: 'Mã' })).toHaveCount(0);
    await hop.getByRole('button', { name: 'Đổi mã…' }).click();
    await expect(hop.getByText(/dùng để tra cứu và nhập Excel/)).toBeVisible();
    await hop.getByRole('button', { name: 'Đóng hộp thoại' }).click();
  });

  test('đường hỏng: trùng mã site thì lỗi nằm ngay dưới ô Mã, hộp không đóng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const code = `E2E-TRUNG-${uniqueStamp()}`;
    await catalogItem(page, 'site', { code, name: 'Site E2E trùng' });
    await page.goto('/admin/catalog');
    await page.getByRole('button', { name: 'Thêm site', exact: true }).click();
    const hop = page.getByRole('dialog', { name: 'Thêm site', exact: true });
    await hop.getByRole('textbox', { name: 'Mã' }).fill(code);
    await hop.getByRole('textbox', { name: 'Tên' }).fill('Site E2E trùng 2');
    await hop.getByRole('button', { name: 'Lưu' }).click();
    await expect(hop.getByRole('textbox', { name: 'Mã' })).toHaveAttribute('aria-invalid', 'true');
    await expect(hop).toBeVisible();
    await page.keyboard.press('Escape');
    await confirmAction(page, 'Bỏ và đóng');
  });

  test('file mẫu nằm trong hộp nhập; menu dòng tách Ngừng dùng (cảnh báo) khỏi Xóa', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const code = `E2E-MENU-${uniqueStamp()}`;
    await catalogItem(page, 'site', { code, name: 'Site E2E menu' });
    await page.goto('/admin/catalog');
    await expect(page.getByRole('button', { name: /Tải file mẫu/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    await expect(
      page
        .getByRole('dialog', { name: 'Nhập danh mục từ Excel' })
        .getByRole('button', { name: /Tải file mẫu/ }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await timVaChoLoc(page, code);
    await page.getByRole('button', { name: `Thao tác với ${code}` }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('separator')).toHaveCount(2);
    await page.keyboard.press('Escape');
    expect(await rowActionNames(page, code)).toContain('Xem thiết bị dùng mục này');
  });
});

test.describe('Tài khoản — lọc, lý do khóa, đổi vai', () => {
  test('lọc "Chưa cài 2 lớp" lên URL; khóa bắt ghi lý do và lý do vào nhật ký', async ({ page }) => {
    test.setTimeout(120_000);
    await firstLogin(page, E2E_SA);
    const nguoi = await taoThanhVien(page);
    await page.goto('/admin/accounts?totp=none');
    await timVaChoLoc(page, nguoi.email);
    await expect(page.getByRole('row', { name: new RegExp(nguoi.fullName) })).toBeVisible();

    await rowAction(page, nguoi.fullName, 'Khóa');
    const hop = page.getByRole('dialog');
    // Đường hỏng: bỏ trống lý do thì không gửi.
    await hop.getByRole('button', { name: 'Khóa' }).click();
    await expect(hop.getByText('Bắt buộc — chưa nhập ô này.')).toBeVisible();
    await hop.getByRole('button', { name: 'Nghi bị chiếm tài khoản' }).click();
    await hop.getByRole('button', { name: 'Khóa' }).click();
    await expect(page.getByRole('row', { name: new RegExp(nguoi.fullName) }).getByText('Đang khóa')).toBeVisible();
    await expect.poll(() => lastAudit('account.locked', nguoi.id)?.detail ?? '').toContain(
      'Nghi bị chiếm tài khoản',
    );
  });

  test('đổi vai Thành viên → Quản trị; tự đổi vai của mình thì không có mục', async ({ page }) => {
    test.setTimeout(120_000);
    await firstLogin(page, E2E_SA);
    const nguoi = await taoThanhVien(page);
    await page.goto('/admin/accounts');
    await timVaChoLoc(page, nguoi.email);
    await rowAction(page, nguoi.fullName, 'Đổi vai trò…');
    const hop = page.getByRole('dialog', { name: `Đổi vai trò: ${nguoi.fullName}` });
    await hop.getByRole('radio', { name: /^Quản trị/ }).check();
    await hop.getByRole('button', { name: 'Đổi vai trò', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(nguoi.fullName) }).getByText('Quản trị')).toBeVisible();
    expect(sql(`SELECT role FROM users WHERE id = '${nguoi.id}'`)).toBe('admin');

    const hoTenSa = sql(`SELECT full_name FROM users WHERE email = '${E2E_SA.email}'`);
    await timVaChoLoc(page, E2E_SA.email);
    const menu = await rowActionNames(page, hoTenSa);
    expect(menu).not.toContain('Đổi vai trò…');
    expect(menu).not.toContain('Khóa');
  });

  test('đường hỏng API: tự đổi vai của chính mình bị từ chối', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const saId = sql(`SELECT id FROM users WHERE email = '${E2E_SA.email}'`);
    const res = await page.request.patch(`/api/v1/accounts/${saId}/role`, {
      headers: await writeHeaders(page),
      data: { role: 'member' },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('SELF_ROLE_CHANGE');
  });
});

test.describe('Nhật ký hệ thống — chi tiết, lọc, xuất', () => {
  test('bấm dòng mở chi tiết; lọc loại đối tượng lên URL; Xuất Excel tải được file', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/audit-log');
    await expect(page.getByRole('heading', { level: 1, name: 'Nhật ký hệ thống' })).toBeVisible();

    await page.getByRole('button', { name: /Xem chi tiết dòng nhật ký lúc/ }).first().click();
    const hop = page.getByRole('dialog');
    await expect(hop.getByText('Người thao tác')).toBeVisible();
    await hop.getByRole('button', { name: 'Đóng', exact: true }).click();

    await page.getByRole('button', { name: 'Loại đối tượng' }).click();
    await page.getByRole('option', { name: 'Phiên' }).click();
    await expect(page).toHaveURL(/objectType=session/);

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Xuất Excel' }).click(),
    ]).then(([event]) => event);
    expect(download.suggestedFilename()).toBe('nhat-ky.xlsx');
  });

  test('đường hỏng: Thành viên gọi thẳng file xuất nhật ký nhận 403', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    const res = await page.request.get('/api/v1/admin/audit/export');
    expect(res.status()).toBe(403);
  });
});

test.describe('Quyền két sắt — người đã nghỉ, kiểm tra quyền', () => {
  test('người vô hiệu hóa ẩn mặc định; tick "Hiện cả người đã nghỉ" thì hiện kèm nhãn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const nguoi = await taoThanhVien(page);
    sql(`UPDATE users SET status = 'disabled' WHERE id = '${nguoi.id}'`);
    await page.goto('/admin/vault-access');
    const list = page.getByRole('navigation', { name: 'Danh sách thành viên' });
    await expect(list).toBeVisible();
    await expect(list.getByText(nguoi.fullName)).toHaveCount(0);
    await page.getByRole('checkbox', { name: /Hiện cả người đã nghỉ/ }).check();
    await expect(list.getByText(nguoi.fullName)).toBeVisible();
  });

  test('đường hỏng: Kiểm tra quyền với mã không có thật thì nói rõ không tìm thấy', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/vault-access');
    await page.getByRole('button', { name: 'Kiểm tra quyền' }).click();
    const hop = page.getByRole('dialog', { name: 'Kiểm tra quyền xem két' });
    await hop.getByRole('button', { name: 'Người' }).click();
    await page.getByRole('option').first().click();
    await hop.getByRole('textbox', { name: 'Mã hồ sơ' }).fill('E2E-KHONG-CO-MAY-NAY');
    await hop.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(hop.getByRole('alert')).toContainText('Không tìm thấy hồ sơ mã "E2E-KHONG-CO-MAY-NAY"');
  });
});
