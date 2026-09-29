import { expect, test } from '@playwright/test';
import { E2E_MEMBER, E2E_SA, firstLogin, resetUsers, uniqueStamp, writeHeaders } from './helpers';

test.beforeEach(() => resetUsers());

/** Mã kỹ thuật trần — thứ KHÔNG được hiện ra làm nhãn trên ô chọn hành động. */
const ACTION_CODE_PATTERN = /^[a-z_]+(\.[a-z0-9_-]+)+$/;

test.describe('Nhật ký — nhãn hành động và đối tượng người đọc được', () => {
  test('ô "Mọi hành động" liệt kê nhãn tiếng Việt cho MỌI mã đang có trong nhật ký', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto(`/admin/audit-log?q=${encodeURIComponent(E2E_SA.email)}`);
    // Dòng đăng nhập: nhãn tiếng Việt ở trên, mã ở dòng phụ.
    // Nhãn là nút chữ trần đứng cạnh `<span>` mã, nên phải khớp cả ô: nhãn rồi ngay sau là mã.
    await expect(page.getByText(/^Đăng nhập\s*auth\.login\.ok$/).first()).toBeVisible();
    await expect(page.getByText(/^auth\.(login|password)\.ok$/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Hành động' }).click();
    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();
    const labels = await options.allTextContents();
    /*
     * Đây là cửa canh LÚC CHẠY cho bài điểm danh đọc mã nguồn: mã nào ghép ra mà không khớp
     * bảng nhãn (một họ mới, một động từ mới) sẽ hiện nguyên mã ở đây.
     */
    expect(labels.filter((label) => ACTION_CODE_PATTERN.test(label.trim()))).toEqual([]);
  });

  test('tạo tài khoản → dòng nhật ký nói "Tài khoản · <email>" và bấm vào mở đúng người', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const email = `e2e-tao-moi-${uniqueStamp()}@pmh.com.vn`;
    const created = await page.request.post('/api/v1/accounts', {
      headers: await writeHeaders(page),
      data: { email, fullName: 'E2E Nhật ký đối tượng', role: 'member', totpLoginRequired: true },
    });
    expect(created.status()).toBe(201);
    const userId = ((await created.json()) as { user: { id: string } }).user.id;

    await page.goto(`/admin/audit-log?objectId=${userId}`);
    const row = page.getByRole('row', { name: /Tạo tài khoản/ });
    await expect(row).toBeVisible();
    const link = row.getByRole('link', { name: new RegExp(email.replace(/[.+]/g, '\\$&')) });
    await expect(link).toBeVisible();
    // UUID không mất: vẫn ở tooltip và có nút chép.
    await expect(link).toHaveAttribute('title', userId);
    await expect(row.getByRole('button', { name: 'Chép mã đối tượng' })).toBeVisible();

    await link.click();
    await expect(page).toHaveURL(/\/admin\/accounts\?q=/);
    await expect(page.getByRole('row', { name: new RegExp(email.replace(/[.+]/g, '\\$&')) })).toBeVisible();
  });

  test('đường hỏng: Thành viên không đọc được nhật ký (nhãn đối tượng không mở thêm cửa nào)', async ({
    page,
  }) => {
    await firstLogin(page, E2E_MEMBER);
    const res = await page.request.get('/api/v1/admin/audit?page=1&pageSize=20');
    expect(res.status()).toBe(403);
  });
});
