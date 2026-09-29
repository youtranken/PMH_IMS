import { expect, test } from '@playwright/test';
import {
  confirmAction,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  logout,
  resetAccessList,
  resetUsers,
  sql,
  writeHeaders,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetAccessList();
});

/**
 * Quyền két theo NGƯỜI (mô hình chính): trái danh sách Thành viên, phải thẻ quyền của người đang
 * chọn; "+ Thêm quyền" chọn nhiều nhóm một lượt. SA/Admin không thành dòng trống.
 */
test.describe('Quyền két sắt — theo người', () => {
  test('?user= mở sẵn người đó; thêm HAI nhóm một lượt; chip hiện ngay, số quyền cập nhật', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const memberId = sql(`SELECT id FROM users WHERE email = '${E2E_MEMBER.email}'`);
    const fullName = sql(`SELECT full_name FROM users WHERE email = '${E2E_MEMBER.email}'`);

    await page.goto(`/admin/vault-access?user=${memberId}`);
    await expect(page.getByRole('heading', { name: fullName })).toBeVisible();
    await expect(page.getByText(/Chưa có quyền nào/)).toBeVisible();

    await page.getByRole('button', { name: '+ Thêm quyền' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: 'Phần mềm: License' }).check();
    await dialog.getByRole('checkbox', { name: 'Phần mềm: Chứng chỉ SSL' }).check();
    await expect(dialog.getByText('Bấm Lưu sẽ tạo 2 dòng quyền, cùng tầng và cùng ghi chú.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await confirmAction(page);

    await expect(page.getByText('Đã gán 2 nhóm.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Phần mềm: License: Cần duyệt/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Chứng chỉ SSL: Cần duyệt/ })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Danh sách thành viên' }).getByRole('button', {
        name: new RegExp(`${E2E_MEMBER.email}.*2 quyền`),
      }),
    ).toBeVisible();
  });

  test('đường hỏng: Lưu mà chưa chọn nhóm nào → báo lỗi, không ghi gì', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const memberId = sql(`SELECT id FROM users WHERE email = '${E2E_MEMBER.email}'`);
    await page.goto(`/admin/vault-access?user=${memberId}`);
    await page.getByRole('button', { name: '+ Thêm quyền' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Chọn ít nhất một nhóm.');
    expect(
      sql(`SELECT count(*) FROM access_list WHERE member_email = '${E2E_MEMBER.email}'`),
    ).toBe('0');
  });

  test('SA/Admin không nằm trong danh sách thành viên mà ở khối "Có toàn quyền theo vai"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/vault-access');
    const list = page.getByRole('navigation', { name: 'Danh sách thành viên' });
    await expect(list.getByText(E2E_MEMBER.email)).toBeVisible();
    await expect(list.getByText(E2E_SA.email)).toHaveCount(0);
    await page.getByText(/^Có toàn quyền theo vai \(\d+\)$/).click();
    await expect(page.getByText(E2E_SA.email)).toBeVisible();
  });

  test('tab "Ma trận" vẫn còn cho rà soát tổng (màn rộng), địa chỉ nhớ tab', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/vault-access');
    await page.getByRole('tab', { name: 'Ma trận' }).click();
    await expect(page).toHaveURL(/view=matrix/);
    await expect(page.getByTestId('access-grid')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Người', exact: true })).toBeVisible();
  });

  /**
   * Màn này mở cho SA VÀ Admin, nhưng danh sách người từng lấy từ `/accounts` (chỉ SA) nên
   * Admin mở ra là "Không tải được dữ liệu". Sửa bằng đường đọc hẹp `/vault/access/people`;
   * `/accounts` KHÔNG được mở rộng cho Admin, và Member không đọc được danh bạ két.
   */
  test('Admin mở được màn Quyền két (desktop + 390px); /accounts vẫn chỉ SA', async ({ page }) => {
    // Hai lượt đăng nhập đầy đủ, mỗi lượt chờ một mã TOTP mới.
    test.setTimeout(150_000);
    const adminEmail = 'e2e-tao-moi-admin-quyen-ket@pmh.com.vn';

    await firstLogin(page, E2E_SA);
    const created = await page.request.post('/api/v1/accounts', {
      headers: await writeHeaders(page),
      data: {
        email: adminEmail,
        fullName: 'E2E Quản trị quyền két',
        role: 'admin',
        totpLoginRequired: true,
        phone: '',
        employeeCode: '',
        birthDate: '',
      },
    });
    expect(created.status()).toBe(201);
    const { temporaryPassword } = (await created.json()) as { temporaryPassword: string };
    await logout(page);

    await firstLogin(page, { email: adminEmail, password: temporaryPassword });
    const memberName = sql(`SELECT full_name FROM users WHERE email = '${E2E_MEMBER.email}'`);

    await page.goto('/admin/vault-access');
    const list = page.getByRole('navigation', { name: 'Danh sách thành viên' });
    await expect(list).toContainText(memberName);
    await expect(page.getByText('Không tải được dữ liệu.')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Danh sách thành viên' })).toContainText(
      memberName,
    );
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // Đường đọc hẹp: chỉ năm cột, không có gì của hồ sơ nhân sự.
    const people = await page.request.get('/api/v1/vault/access/people');
    expect(people.status()).toBe(200);
    const rows = (await people.json()) as Record<string, unknown>[];
    expect(Object.keys(rows[0]).sort()).toEqual(['email', 'fullName', 'id', 'role', 'status']);

    // Không mở rộng quyền: Admin vẫn bị chặn ở danh sách tài khoản.
    expect((await page.request.get('/api/v1/accounts')).status()).toBe(403);
  });

  test('Member không đọc được danh bạ của màn Quyền két', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    const res = await page.request.get('/api/v1/vault/access/people');
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });
});
