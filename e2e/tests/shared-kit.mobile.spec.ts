import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, horizontalOverflow, openNavDrawer, resetUsers } from './helpers';

test.beforeEach(() => resetUsers());

/**
 * UX-DR2: màn ĐỌC phải dùng được ở 390px (project `mobile-390` đặt viewport này).
 * Kiểm chứng cụ thể: KHÔNG có thanh cuộn ngang — lỗi kinh điển của bảng trên điện thoại.
 */
test.describe('390px', () => {
  test('màn đăng nhập không tràn ngang', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('bộ dùng chung (light + dark) không tràn ngang', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await openNavDrawer(page);
    await page.getByRole('link', { name: 'Bộ giao diện' }).click();
    await expect(page.getByRole('heading', { name: 'Bộ giao diện' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // Đổi sang chế độ tối: token đổi, layout không được vỡ.
    await page.getByRole('button', { name: /chế độ tối/i }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('danh sách tài khoản đọc được ở 390px', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await openNavDrawer(page);
    await page.getByRole('link', { name: 'Tài khoản', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tài khoản', exact: true })).toBeVisible();
    // Tên xuất hiện cả ở chân sidebar và trong bảng — chỉ kiểm dòng trong BẢNG.
    // Bám đúng ô HỌ TÊN: nút Sửa mang nhãn trợ năng "Sửa hồ sơ của {tên}" nên ô Thao tác
    // cũng chứa tên người, và khớp lỏng là trúng hai ô.
    await expect(
      page.getByRole('cell', { name: /E2E Super Admin/ }).filter({ hasText: 'e2e-sa@' }),
    ).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});

