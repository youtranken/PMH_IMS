import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  logout,
  resetServiceAccounts,
  resetUsers,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * NET-072: trang hồ sơ tài khoản dịch vụ có "Sửa hồ sơ" và menu ⋯ "Vô hiệu hóa…/Bật lại…"
 * (SA/Admin) — trước đây phải quay ra danh sách, tìm dòng rồi mở ⋯.
 */

test.beforeEach(() => {
  resetUsers();
  resetServiceAccounts();
});

async function createAccount(page: Page): Promise<{ id: string; code: string }> {
  const code = `TK-E2E-CT-${uniqueStamp()}`;
  const res = await page.request.post('/api/v1/service-accounts', {
    headers: await writeHeaders(page),
    data: { code, kind: 'shared', name: 'Email kế toán E2E', login: `ketoan-${code}@pmh.com.vn` },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { id: ((await res.json()) as { id: string }).id, code };
}

test.describe('Trang hồ sơ TKDV — thao tác ngay tại chỗ (NET-072)', () => {
  test('SA: Sửa hồ sơ từ trang chi tiết, rồi Vô hiệu hóa… và Bật lại… kèm lý do', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const { id, code } = await createAccount(page);
    await page.goto(`/service-accounts/${id}`);

    await page.getByRole('button', { name: 'Sửa hồ sơ' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Ghi chú' }).fill('đổi từ trang hồ sơ E2E');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByText('đổi từ trang hồ sơ E2E')).toBeVisible();

    await page.getByRole('button', { name: `Thao tác với ${code}` }).click();
    await page.getByRole('menuitem', { name: 'Vô hiệu hóa…' }).click();
    const off = page.getByRole('dialog', { name: `Vô hiệu hóa — ${code}` });
    await off.getByRole('button', { name: 'Vô hiệu hóa' }).click();
    // Đường hỏng: lý do bắt buộc, báo tiếng Việt dưới ô, không gửi.
    await expect(off.getByText(/Bắt buộc/)).toBeVisible();
    await off.getByRole('textbox', { name: /Lý do vô hiệu hóa/ }).fill('nhân sự đã nghỉ E2E');
    await off.getByRole('button', { name: 'Vô hiệu hóa' }).click();
    await expect(off).toHaveCount(0);
    await expect(page.getByText('Đã vô hiệu hóa', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: `Thao tác với ${code}` }).click();
    await page.getByRole('menuitem', { name: 'Bật lại…' }).click();
    const on = page.getByRole('dialog', { name: `Bật lại — ${code}` });
    await on.getByRole('textbox', { name: /Lý do bật lại/ }).fill('người mới nhận E2E');
    await on.getByRole('button', { name: 'Bật lại' }).click();
    await expect(on).toHaveCount(0);
    await expect(page.getByText('Đang dùng', { exact: true }).first()).toBeVisible();
  });

  test('member: trang hồ sơ không bày nút ghi', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const { id, code } = await createAccount(page);
    await logout(page);
    await firstLogin(page, E2E_MEMBER);
    await page.goto(`/service-accounts/${id}`);
    await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sửa hồ sơ' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Thao tác với ${code}` })).toHaveCount(0);
  });
});

test.describe('390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('nút Sửa hồ sơ và ⋯ nằm trong màn, không tràn ngang', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const { id, code } = await createAccount(page);
    await page.goto(`/service-accounts/${id}`);
    await expect(page.getByRole('button', { name: 'Sửa hồ sơ' })).toBeInViewport();
    await expect(page.getByRole('button', { name: `Thao tác với ${code}` })).toBeInViewport();
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
