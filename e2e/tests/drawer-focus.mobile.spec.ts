import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, openNavDrawer, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
});

/**
 * DRAWER ĐIỀU HƯỚNG Ở 390px PHẢI QUẢN LÝ TIÊU ĐIỂM (F-06, vế 4).
 *
 * ===== VÌ SAO CẦN TẦNG NÀY, DÙ ĐÃ CÓ `focus-trap.test.tsx` =====
 *
 * Bài Vitest dựng một khung DOM giả rồi hỏi hook. Nó chứng minh cái BẪY đúng; nó không chứng
 * minh có ai GẮN bẫy vào drawer thật, không biết `narrow` có bật đúng ở 390px không, và không
 * thấy được gì về bố cục. Gỡ dòng `useFocusTrap(...)` khỏi `app-shell.tsx` thì bài Vitest vẫn
 * xanh nguyên — bài này thì đỏ.
 *
 * ===== LỖ MÀ BÀI NÀY CANH =====
 *
 * Nút mở drawer nằm trong topbar, tức SAU `<nav>` trong DOM. Không có bẫy tiêu điểm thì mở
 * drawer xong lượt Tab kế tiếp đi vào NỘI DUNG TRANG và không bao giờ vào được menu: người đi bàn
 * phím mở được cái menu ra rồi không vào nổi nó. Esc thì đóng được, nhưng tiêu điểm rơi về
 * `<body>` nên lượt Tab sau đó bắt đầu lại từ đầu trang.
 */

test('mở drawer là tiêu điểm vào trong, Esc trả nó về đúng nút đã mở', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  await page.goto('/');

  const openButton = page.getByRole('button', { name: 'Mở menu' });
  await expect(openButton).toBeVisible();
  await openNavDrawer(page);

  /* ----- 1. Drawer là một HỘP THOẠI, và landmark điều hướng vẫn còn nguyên bên trong ----- */
  const dialog = page.getByRole('dialog', { name: 'Điều hướng chính' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('navigation', { name: 'Điều hướng chính' }),
    'bọc ngoài chứ không đè role lên <nav> — mất landmark là mất đường nhảy bằng phím tắt',
  ).toBeVisible();

  /* ----- 2. Tiêu điểm đã Ở TRONG drawer, không nằm lại ở nút mở ----- */
  await expect(
    dialog.locator(':focus'),
    'mở menu xong mà tiêu điểm còn ngoài thì Tab kế tiếp đi vào nội dung trang',
  ).toHaveCount(1);

  /* ----- 3. Tab không thoát ra được ----- */
  for (let i = 0; i < 25; i += 1) await page.keyboard.press('Tab');
  await expect(
    dialog.locator(':focus'),
    '25 lượt Tab vẫn phải quẩn trong drawer — nó đang che kín màn hình',
  ).toHaveCount(1);

  /* ----- 4. Esc đóng, và TRẢ tiêu điểm về nút đã mở ----- */
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(
    openButton,
    'trả về nút đã mở, không rơi về <body> — nếu không, lượt Tab sau bắt đầu lại từ đầu trang',
  ).toBeFocused();
});

test('nội dung trang bị inert trong lúc drawer mở, nhưng nút đóng thì không', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  await page.goto('/');
  await openNavDrawer(page);

  /*
   * `inert` đặt trên `<main>` chứ không trên cả `.content`, vì nút đóng drawer nằm trong
   * topbar — mà topbar là con của `.content`. Làm cả khối inert là khoá luôn chính cái nút để
   * thoát ra, và khoá cả chỗ mà bẫy tiêu điểm sẽ trả tiêu điểm về.
   *
   * Hai khẳng định dưới đây đi thành một CẶP. Vế đầu một mình sẽ xanh với một bản vá làm inert
   * cả `.content`; vế sau là thứ bắt được bản vá ấy.
   */
  await expect(page.getByTestId('page-main')).toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: 'Đóng menu' })).toBeEnabled();
});

test('desktop KHÔNG bị khoá tiêu điểm vào sidebar (vế đối chứng)', async ({ page }) => {
  /*
   * Ô này là lý do `useFocusTrap` nhận cờ `active` thay vì tự bật. Ở màn rộng sidebar là một
   * phần của trang chứ không phải lớp phủ — khoá tiêu điểm vào đó là dựng một cái bẫy cho
   * người không hề yêu cầu mở gì. Bài nằm trong file `.mobile` nhưng tự đổi viewport, vì nó
   * canh đúng ranh giới giữa hai chế độ.
   */
  await page.setViewportSize({ width: 1280, height: 900 });
  await firstLogin(page, E2E_SA);
  // `/devices` chứ không phải `/`: bảng điều khiển không có ô tìm để đặt tiêu điểm ra ngoài sidebar.
  await page.goto('/devices');

  await expect(page.getByRole('dialog', { name: 'Điều hướng chính' })).toHaveCount(0);
  await expect(page.getByTestId('page-main')).not.toHaveAttribute('inert', '');

  /*
   * Tiêu điểm đặt NGOÀI sidebar rồi Tab: nếu bẫy lỡ bật ở màn rộng thì lượt Tab ấy bị kéo
   * ngược vào sidebar.
   *
   * Đừng bấm Tab N lượt từ link đầu sidebar rồi đòi tiêu điểm phải nằm ngoài sidebar: vòng Tab
   * của trang là một VÒNG KHÉP KÍN — đi hết trang thì nó quay lại đầu, tức trở về sidebar. Đếm
   * số lượt Tab để suy ra tiêu điểm đang ở đâu là một phép đo không bao giờ chắc.
   */
  const searchBox = page.getByRole('searchbox').first();
  await searchBox.focus();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('navigation', { name: 'Điều hướng chính' }).locator(':focus'),
    'màn rộng KHÔNG được kéo tiêu điểm về sidebar — sidebar ở đây là một phần của trang',
  ).toHaveCount(0);
});
