import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, horizontalOverflow, openNavDrawer, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
});

/**
 * UX-DR2 ở mức KHUNG, không phải mức từng màn.
 *
 * Bài học vừa trả giá: 11 file `*.mobile.spec.ts` cùng xanh trong khi bố cục 390px thật ra
 * hỏng, vì tất cả chỉ hỏi "có thấy không / có tràn ngang không" — mà sidebar 236px + nội dung
 * 154px thì đúng bằng 390px, không tràn tí nào. Nên bài này hỏi thứ khác: nội dung có được
 * BAO NHIÊU bề ngang, và có cách nào mở menu không.
 */
test.describe('Khung ứng dụng ở 390px', () => {
  test('mặc định nội dung chiếm gần trọn bề ngang, menu mở bằng nút trong topbar', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/');

    const viewport = page.viewportSize()!;
    // Sidebar 236px không được nằm chình ình ở màn 390px.
    await expect(page.locator('aside.sidebar')).toHaveCount(0);
    const main = (await page.locator('main.page').boundingBox())!;
    expect(main.width).toBeGreaterThan(viewport.width * 0.9);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // …nhưng vẫn phải đi được tới mọi trang: nút mở menu nằm trong topbar.
    await openNavDrawer(page);
    // Drawer trượt vào bằng animation 0.2s — đo ngay là bắt trúng lúc còn ngoài màn hình.
    await expect
      .poll(async () => (await page.locator('aside.sidebar.is-drawer').boundingBox())!.x)
      .toBe(0);
    await expect(
      page.locator('aside.sidebar').getByRole('link', { name: 'Thiết bị' }),
    ).toBeInViewport();
  });

  test('chọn một mục thì drawer tự khép lại, không che trang vừa mở', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/');

    await openNavDrawer(page);
    await page.locator('aside.sidebar').getByRole('link', { name: 'Thiết bị' }).click();

    await expect(page.getByRole('heading', { name: 'Thiết bị' })).toBeInViewport();
    await expect(page.locator('aside.sidebar')).toHaveCount(0);
  });

  /** Đường hỏng: mở nhầm menu thì phải thoát được — bấm ra ngoài hoặc Esc. */
  test('đường hỏng: mở nhầm menu vẫn đóng được bằng backdrop và Esc', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/');

    await openNavDrawer(page);
    // Bấm ở nửa PHẢI: nửa trái là chỗ drawer đang nằm, bấm vào đó là bấm trúng menu.
    await page.locator('.drawer-backdrop').click({ position: { x: 330, y: 400 } });
    await expect(page.locator('aside.sidebar')).toHaveCount(0);

    await openNavDrawer(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('aside.sidebar')).toHaveCount(0);
  });
});
