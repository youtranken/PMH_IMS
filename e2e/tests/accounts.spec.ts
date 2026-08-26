import { expect, test } from '@playwright/test';
import {
  confirmAction,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  resetUsers,
  SECOND_BROWSER,
  writeHeaders,
} from './helpers';

test.beforeEach(() => resetUsers());

/** Story 1.4 — SA quản trị tài khoản và phiên. */
test.describe('Quản trị tài khoản', () => {
  test('SA tạo tài khoản mới và nhận mật khẩu tạm', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    await page.getByRole('link', { name: 'Tài khoản' }).click();
    await expect(page.getByRole('heading', { name: 'Tài khoản' })).toBeVisible();

    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const unique = `e2e-tao-moi-${Date.now()}@pmh.com.vn`;
    // Dùng vai + tên trợ năng (accessible name) thay vì getByLabel: nhãn có kèm dấu *
    // trang trí, còn ô tìm kiếm phía trên cũng chứa chữ "email".
    await page.getByRole('textbox', { name: 'Họ tên' }).fill('Nhân viên mới tạo');
    await page.getByRole('textbox', { name: 'Email' }).fill(unique);
    await page.getByRole('button', { name: 'Lưu' }).click();

    // Mật khẩu tạm chỉ hiện MỘT LẦN.
    await expect(page.getByText('Mật khẩu tạm')).toBeVisible();
    const temp = await page.locator('.temp-password').innerText();
    expect(temp.trim().length).toBeGreaterThanOrEqual(12);

    // `exact`: nút ✕ của hộp thoại có nhãn "Đóng hộp thoại", đừng bắt nhầm nó.
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(page.getByText(unique)).toBeVisible();
  });

  test('member không thấy mục Tài khoản và bị chặn khi gõ thẳng URL', async ({ page }) => {
    await firstLogin(page, { email: 'e2e-member@pmh.com.vn', password: 'E2e@Test#2026' });

    await expect(page.getByRole('link', { name: 'Tài khoản' })).toHaveCount(0);

    const response = await page.request.get('/api/v1/accounts');
    expect(response.status()).toBe(403);
  });

  test('SA xem và đá được phiên đang mở', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.getByRole('link', { name: 'Tài khoản' }).click();

    const row = page.getByRole('row', { name: /E2E Super Admin/ });
    await row.getByRole('button', { name: 'Phiên đang mở' }).click();
    await expect(page.getByRole('dialog')).toContainText('Phiên đang mở');
    await expect(page.getByRole('button', { name: 'Đá phiên' }).first()).toBeVisible();
  });

  test('khóa rồi mở lại tài khoản (hồi quy: body chỉ được chứa field của DTO)', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.getByRole('link', { name: 'Tài khoản' }).click();

    const row = page.getByRole('row', { name: /E2E Thành viên/ });
    await row.getByRole('button', { name: 'Khóa' }).click();
    // Chốt luôn CHỮ trên nút: hộp hỏi "Khóa tài khoản X?" thì nút phải ghi "Khóa", không
    // phải "Đồng ý" chung chung. Đây là chỗ duy nhất canh chữ — 15 chỗ còn lại bám vị trí.
    await confirmAction(page, 'Khóa');

    await expect(row.getByText('Đang khóa')).toBeVisible();
    // Không được có toast lỗi kiểu "property id should not exist".
    await expect(page.getByText(/should not exist/i)).toHaveCount(0);

    await row.getByRole('button', { name: 'Mở khóa' }).click();
    await expect(row.getByText('Đang hoạt động')).toBeVisible();
  });

  test('tìm kiếm chạy phía server: tìm được cả người không nằm ở trang đang xem', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.getByRole('link', { name: 'Tài khoản' }).click();

    await page.getByRole('searchbox').fill('E2E Thành viên');
    await expect(page.getByRole('cell', { name: /E2E Thành viên/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /E2E Super Admin/ })).toHaveCount(0);

    // Từ khóa không khớp ai: phải nói rõ "chưa có dữ liệu", không để bảng trắng.
    await page.getByRole('searchbox').fill('khong-ton-tai-zzz');
    await expect(page.getByText('Chưa có dữ liệu')).toBeVisible();
  });

  /**
   * G-04 — Story 1.4 AC-2: khóa tài khoản thì MỌI phiên của người đó chết ngay.
   *
   * Bài "khóa rồi mở lại" ở trên chỉ khẳng định huy hiệu đổi thành "Đang khóa" — tức là
   * khẳng định CÁI NHÃN, không khẳng định hệ quả. Nhân viên nghỉ việc mà phiên còn sống là
   * chuyện thật, và nó sẽ không làm đỏ bài nào ở trên.
   */
  test('khóa tài khoản thì phiên đang mở của người đó chết ngay', async ({ page, browser }) => {
    const memberCtx = await browser.newContext(SECOND_BROWSER);
    const memberPage = await memberCtx.newPage();
    try {
      await firstLogin(memberPage, E2E_MEMBER);
      expect((await memberPage.request.get('/api/v1/auth/me')).status()).toBe(200);

      await firstLogin(page, E2E_SA);
      await page.getByRole('link', { name: 'Tài khoản' }).click();
      const row = page.getByRole('row', { name: /E2E Thành viên/ });
      await row.getByRole('button', { name: 'Khóa' }).click();
      await confirmAction(page);
      await expect(row.getByText('Đang khóa')).toBeVisible();

      // `expect.poll` chứ không đọc một phát: thu hồi phiên đi qua DB, và response của lệnh
      // khóa có thể về trước khi UPDATE kịp commit.
      await expect
        .poll(async () => (await memberPage.request.get('/api/v1/auth/me')).status())
        .toBe(401);

      // Và người đó bị đá về trang đăng nhập chứ không ngồi lại trong app với dữ liệu cũ.
      await memberPage.goto('/thiet-bi');
      await expect(memberPage).toHaveURL(/dang-nhap/);
    } finally {
      await memberCtx.close();
    }
  });

  /**
   * G-05 — Story 1.4 AC-3: nút "Đá phiên" thật sự cắt phiên.
   *
   * Bài cũ dừng ở `toBeVisible()` trên chính nút đó. Một nút hiện ra và một nút làm được
   * việc là hai chuyện khác nhau.
   */
  test('SA bấm đá phiên thì trình duyệt kia bị đá về đăng nhập', async ({ page, browser }) => {
    const memberCtx = await browser.newContext(SECOND_BROWSER);
    const memberPage = await memberCtx.newPage();
    try {
      await firstLogin(memberPage, E2E_MEMBER);
      expect((await memberPage.request.get('/api/v1/auth/me')).status()).toBe(200);

      await firstLogin(page, E2E_SA);
      await page.getByRole('link', { name: 'Tài khoản' }).click();
      const row = page.getByRole('row', { name: /E2E Thành viên/ });
      await row.getByRole('button', { name: 'Phiên đang mở' }).click();

      // Lọc theo nội dung: lát nữa hộp xác nhận mở chồng lên, `getByRole('dialog')` trơ
      // sẽ khớp hai cái và Playwright báo strict mode.
      const dialog = page.getByRole('dialog').filter({ hasText: 'Phiên đang mở' });
      await dialog.getByRole('button', { name: 'Đá phiên' }).first().click();
      // Đá phiên có hỏi lại ("Đá phiên đăng nhập này?") — không bấm Đồng ý thì chưa có gì xảy ra.
      await confirmAction(page);

      await expect
        .poll(async () => (await memberPage.request.get('/api/v1/auth/me')).status())
        .toBe(401);
      await memberPage.goto('/thiet-bi');
      await expect(memberPage).toHaveURL(/dang-nhap/);
    } finally {
      await memberCtx.close();
    }
  });

  /**
   * Sắp xếp PHẢI chạy ở server, không phải ở trang đang xem — cùng luật với danh sách thiết
   * bị (devices.spec.ts, AD-15). Cũng kiểm cột "Hành động" không có nút sắp: nó không phải
   * cột dữ liệu, không có gì để `ORDER BY`.
   *
   * Email tạo tài khoản đặt tiền tố `e2e-tao-moi-` để `dropAccountsCreatedByE2e` trong
   * `resetUsers()` tự dọn — không cần script xóa riêng cho bài này.
   */
  test('sắp xếp theo cột chạy ở server, cột không sắp được thì không có nút', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const headers = await writeHeaders(page);

    // Vai trò cố tình KHÔNG cùng thứ tự với họ tên: admin < member < sa theo bảng chữ cái,
    // trong khi họ tên tăng dần là Alpha, Mike, Zulu — hai cách sắp phải ra hai kết quả khác.
    for (const [suffix, fullName, role] of [
      ['a', `E2E Sort Zulu ${stamp}`, 'admin'],
      ['b', `E2E Sort Alpha ${stamp}`, 'sa'],
      ['c', `E2E Sort Mike ${stamp}`, 'member'],
    ] as const) {
      await page.request.post('/api/v1/accounts', {
        headers,
        data: { email: `e2e-tao-moi-sort-${suffix}-${stamp}@pmh.com.vn`, fullName, role },
      });
    }

    await page.goto('/');
    await page.getByRole('link', { name: 'Tài khoản' }).click();
    // Tìm bằng RIÊNG dấu thời gian: họ tên là "E2E Sort Zulu 123456" nên chuỗi
    // "E2E Sort 123456" KHÔNG nằm trong đó — dấu thời gian thì có mặt ở cả tên lẫn email.
    await page.getByRole('searchbox').fill(stamp);
    await expect(page.getByRole('row')).toHaveCount(4); // 1 dòng tiêu đề + 3 tài khoản

    const firstDataRow = () => page.getByRole('row').nth(1);
    await expect(firstDataRow()).toContainText('Alpha'); // mặc định: theo họ tên tăng dần

    // Bám vào ĐẦU BẢNG: ô tìm kiếm phía trên không chứa nút tên "Vai trò".
    const head = page.locator('thead');
    await head.getByRole('button', { name: 'Vai trò' }).click();
    await expect(firstDataRow()).toContainText('Zulu'); // admin trước tiên

    await head.getByRole('button', { name: 'Vai trò' }).click();
    await expect(firstDataRow()).toContainText('Alpha'); // sa trước tiên (đảo chiều)

    // Cột Hành động không có dữ liệu để sắp — không phải nút bấm được.
    await expect(head.getByRole('button', { name: 'Hành động' })).toHaveCount(0);
  });
});
