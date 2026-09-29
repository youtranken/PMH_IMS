import { expect, test } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  fillLogin,
  firstLogin,
  horizontalOverflow,
  logout,
  openNavDrawer,
  resetUsers,
} from './helpers';

test.beforeEach(() => resetUsers());

/**
 * Đợt UX vừa + nhẹ của đăng nhập, khung app và trang lỗi — mỗi mục một đường hạnh phúc và một
 * đường hỏng, màn đọc có thêm 390px. Không tạo hàng dữ liệu nào (chỉ tài khoản E2E có sẵn).
 */
test.describe('Đăng nhập', () => {
  test('sai mật khẩu: ô mật khẩu bị xoá, con trỏ quay về, email giữ nguyên (AUTH-006)', async ({
    page,
  }) => {
    await fillLogin(page, E2E_MEMBER.email, 'mat-khau-sai-hoan-toan');
    await expect(page.getByRole('alert')).toHaveText('Email hoặc mật khẩu không đúng.');
    const password = page.getByLabel('Mật khẩu', { exact: true });
    await expect(password).toHaveValue('');
    await expect(password).toBeFocused();
    await expect(page.getByLabel('Email')).toHaveValue(E2E_MEMBER.email);
    // Lỗi của server không kéo theo câu "bắt buộc" cho ô vừa bị xoá có chủ đích.
    await expect(page.getByText('Bắt buộc — chưa nhập ô này.')).toHaveCount(0);
  });

  test('nút hiện/ẩn mật khẩu; đăng xuất xong màn đăng nhập nói "Bạn đã đăng xuất." (AUTH-004/028)', async ({
    page,
  }) => {
    await page.goto('/login');
    const password = page.getByLabel('Mật khẩu', { exact: true });
    await password.fill('thu-hien-an');
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Hiện mật khẩu' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Ẩn mật khẩu' }).click();
    await expect(password).toHaveAttribute('type', 'password');

    await firstLogin(page, E2E_SA);
    await logout(page);
    await expect(page.getByRole('status').filter({ hasText: 'Bạn đã đăng xuất.' })).toBeVisible();
    await page.getByLabel('Email').fill('a');
    await expect(page.getByText('Bạn đã đăng xuất.')).toHaveCount(0);
  });
});

test.describe('Trang lỗi', () => {
  test('Thành viên mở trang quản trị → 403 nói thiếu quyền, có Quay lại và Về trang chủ (MISC-001)', async ({
    page,
  }) => {
    await firstLogin(page, E2E_MEMBER);
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Bạn không có quyền xem trang này' })).toBeVisible();
    await expect(page.getByText(/Trang này dành cho Super Admin/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Về trang chủ' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();
  });

  test('đường dẫn sai → 404 nói đúng đường vừa mở; "Về trang chủ" là link, không lồng nút (MISC-002/003)', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/khong-co-trang-nay');
    await expect(page.getByText('Đường dẫn /khong-co-trang-nay không tồn tại hoặc đã đổi.')).toBeVisible();
    const home = page.getByRole('link', { name: 'Về trang chủ' });
    await expect(home).toBeVisible();
    await expect(home.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Quay lại' })).toBeVisible();
  });
});

test.describe('Khung app và Tìm nhanh', () => {
  test('topbar nói tên màn; ô tìm giả mở Tìm nhanh với "Đi tới"; không khớp thì có lối "Tìm trong …"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/devices');
    const banner = page.getByRole('banner');
    await expect(banner.getByTestId('topbar-title')).toHaveText('Thiết bị');
    await expect(banner.getByText('E2E Super Admin')).toHaveCount(0);

    await banner.getByRole('button', { name: /^Tìm nhanh \((Ctrl K|⌘K)\)$/ }).click();
    const palette = page.getByRole('dialog', { name: 'Tìm nhanh' });
    await expect(palette.getByRole('group', { name: 'Đi tới' })).toBeVisible();

    await palette.getByRole('combobox').fill('zzqq-khong-co-E2E');
    await expect(palette.getByText('Không có hồ sơ nào khớp "zzqq-khong-co-E2E".')).toBeVisible();
    await palette.getByRole('option', { name: 'Tìm "zzqq-khong-co-E2E" trong Thiết bị' }).click();
    await expect(page).toHaveURL(/\/devices\?q=zzqq-khong-co-E2E$/);
  });
});

test.describe('390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('drawer có nút Đóng và lối vào Tìm nhanh; trang chủ có tiêu đề, không tràn ngang (SHELL-021, DASH-013)', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await openNavDrawer(page);
    const drawer = page.getByRole('dialog', { name: 'Điều hướng chính' });
    await drawer.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(drawer).toHaveCount(0);

    await openNavDrawer(page);
    await page.getByRole('dialog', { name: 'Điều hướng chính' }).getByRole('button', { name: 'Tìm nhanh' }).click();
    const palette = page.getByRole('dialog', { name: 'Tìm nhanh' });
    await expect(palette.getByRole('combobox')).toBeFocused();
    // Màn cảm ứng: nút Huỷ bằng chữ thay cho phím Esc.
    await palette.getByRole('button', { name: 'Hủy' }).click();
    await expect(palette).toHaveCount(0);
  });
});
