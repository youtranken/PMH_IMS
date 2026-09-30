import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, horizontalOverflow, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
});

/**
 * Khung ứng dụng (AD-15/UX-DR1) — bài kiểm CHỐNG TÁI PHÁT.
 *
 * Lỗi thật đã gặp: `app-shell.tsx` đặt tên lớp bọc là `shell` (theo file mockup), trong khi
 * CSS port từ QLTS chỉ có `.app-shell { display:flex }`. Không lớp nào khớp → khối bọc là
 * block thường: sidebar cao 100vh nằm trên, `.content` bị đẩy xuống DƯỚI màn hình. Người dùng
 * thấy "bên phải trống trơn ở mọi trang" mà console KHÔNG có lỗi nào.
 *
 * Vì sao 152 test cũ vẫn xanh: `toBeVisible()` chỉ đòi phần tử có kích thước, KHÔNG đòi nằm
 * trong tầm nhìn. Nên bài này kiểm bằng HÌNH HỌC (`toBeInViewport`, toạ độ) — thứ duy nhất
 * bắt được lỗi bố cục.
 */
test.describe('Khung ứng dụng', () => {
  test('đường hạnh phúc: nội dung nằm bên phải sidebar và trong tầm nhìn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/');

    const viewport = page.viewportSize()!;
    const sidebar = (await page.getByRole('navigation', { name: 'Điều hướng chính' }).boundingBox())!;
    const main = (await page.getByRole('main').boundingBox())!;

    // Cạnh trái của nội dung phải ở sau cạnh phải của sidebar → hai khối nằm CẠNH nhau.
    expect(main.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width - 1);
    // …và cùng một tầng, không phải khối này rơi xuống dưới khối kia.
    expect(main.y).toBeLessThan(sidebar.y + sidebar.height);

    await expect(page.getByRole('banner')).toBeInViewport();
    await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeInViewport();
    expect(main.width).toBeGreaterThan(viewport.width / 2);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  /** "Trang nào cũng trống" — nên kiểm ít nhất một trang danh sách nữa, không chỉ dashboard. */
  test('đổi trang vẫn giữ bố cục: danh sách thiết bị hiện ngay trong tầm nhìn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.getByRole('link', { name: 'Thiết bị' }).click();

    await expect(page.getByRole('heading', { name: 'Thiết bị' })).toBeInViewport();
    const sidebar = (await page.getByRole('navigation', { name: 'Điều hướng chính' }).boundingBox())!;
    const main = (await page.getByRole('main').boundingBox())!;
    expect(main.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width - 1);
    expect(main.y).toBeLessThan(sidebar.y + sidebar.height);
  });

  /**
   * Đường hỏng: URL không có thật vẫn phải nằm TRONG khung (sidebar còn đó để đi tiếp),
   * chứ không phải trang trắng hay 404 trần trụi.
   */
  test('đường hỏng: URL lạ vẫn ở trong khung, thấy được lời báo', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/khong-co-trang-nay');

    await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeInViewport();
    await expect(page.getByRole('main')).toBeInViewport();
  });
});

/**
 * Menu gọn (Q-18): menu SA từng cao ~950px nên màn laptop 768px phải cuộn sidebar mới thấy mục
 * cuối. "Hệ thống" mặc định khép, tự mở khi đứng ở màn trong nhóm, và nhớ lựa chọn của người
 * dùng qua lần nạp lại.
 *
 * `toBeInViewport` chứ không `toBeVisible`: mục nằm dưới đáy vùng cuộn vẫn "visible" dù người
 * dùng không thấy — chỉ phép đo giao với khung nhìn bắt được chuyện phải cuộn.
 */
test.describe('Menu gọn', () => {
  test('laptop 1366×768: SA thấy trọn menu (Hệ thống khép) không phải cuộn', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await firstLogin(page, E2E_SA);
    await page.goto('/devices');

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await expect(nav.getByRole('button', { name: 'Hệ thống', exact: true })).toBeInViewport({ ratio: 1 });
    // Mục cuối của menu trên bản dựng E2E (nhóm dev nằm SAU "Hệ thống").
    await expect(nav.getByRole('link', { name: 'Bộ giao diện', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(nav.getByText('Tài liệu', { exact: true })).toHaveCount(0);
  });

  test('"Hệ thống" khép mặc định, mở bằng tiêu đề, nhớ qua nạp lại; vào màn trong nhóm thì tự mở', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/devices');

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    const toggle = nav.getByRole('button', { name: 'Hệ thống', exact: true });
    const catalog = nav.getByRole('link', { name: 'Danh mục', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(catalog).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(catalog).toBeVisible();

    await page.reload();
    await expect(toggle, 'lựa chọn mở của người dùng phải được nhớ').toHaveAttribute('aria-expanded', 'true');

    // Đường hỏng: khép lại rồi gõ thẳng một màn trong nhóm — mục đang chọn không được nằm khuất.
    await toggle.click();
    await expect(catalog).toBeHidden();
    await page.goto('/admin/catalog');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(catalog).toHaveAttribute('aria-current', 'page');
  });
});
