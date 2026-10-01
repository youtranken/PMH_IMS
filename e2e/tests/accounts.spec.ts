import { expect, test } from '@playwright/test';
import {
  confirmAction,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  loginWithTotp,
  NEW_PASSWORD,
  resetUsers,
  rowAction,
  rowActionNames,
  searchAndWaitForFilter,
  SECOND_BROWSER,
  writeHeaders,
  uniqueStamp,
  openNavGroup,
} from './helpers';

test.beforeEach(() => resetUsers());

/** SA quản trị tài khoản và phiên. */
/*
 * `exact: true` ở MỌI chỗ bám mục "Tài khoản" trên sidebar.
 *
 * Menu có cả mục "Tài khoản dịch vụ" (tài khoản dùng chung + VPN, thứ khác hẳn với
 * tài khoản đăng nhập IMS). Khớp lỏng là trúng cả hai và Playwright từ chối ở chế độ strict.
 */
test.describe('Quản trị tài khoản', () => {
  test('SA tạo tài khoản mới và nhận mật khẩu tạm', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    await openNavGroup(page);
    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Người dùng IMS', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Thêm người dùng' }).click();
    const unique = `e2e-tao-moi-${Date.now()}@pmh.com.vn`;
    // Dùng vai + tên trợ năng (accessible name) thay vì getByLabel: nhãn có kèm dấu *
    // trang trí, còn ô tìm kiếm phía trên cũng chứa chữ "email".
    await page.getByRole('textbox', { name: 'Họ tên' }).fill('Nhân viên mới tạo');
    await page.getByRole('textbox', { name: 'Email' }).fill(unique);
    await page.getByRole('button', { name: 'Lưu' }).click();

    /*
     * Mật khẩu tạm chỉ hiện MỘT LẦN — và tiêu đề phải nói nó của AI.
     * Mở hộp này từ dòng thứ sáu trong bảng thì tiêu đề trần "Mật khẩu tạm" không đủ để
     * người đọc biết đang đặt lại cho ai.
     */
    await expect(page.getByText(`Mật khẩu tạm — ${unique}`)).toBeVisible();
    const temp = await page.getByTestId('temp-password').innerText();
    expect(temp.trim().length).toBeGreaterThanOrEqual(12);

    /*
     * ESC KHÔNG ĐƯỢC ĐÓNG HỘP NÀY, và đây là cả lý do bài kiểm này dài thêm.
     *
     * Chuỗi vừa hiện không tồn tại ở đâu khác: API sinh ra, trả về một lần, rồi quên. Bản
     * trước để `dismissible` mặc định (true), nên một phím Esc lỡ tay là mất hẳn — trong khi
     * chính chú thích trong hộp ghi "Hệ thống sẽ không hiển thị lại".
     */
    await page.keyboard.press('Escape');
    await expect(
      page.getByTestId('temp-password'),
      'Esc không được đóng hộp chứa thứ không xem lại được',
    ).toBeVisible();

    /*
     * Nhãn nút đóng là một LỜI XÁC NHẬN, không phải "Đóng": người bấm phải tự khẳng định đã
     * ghi lại. `exact` vì nút ✕ của hộp thoại có nhãn "Đóng hộp thoại".
     */
    await page.getByRole('button', { name: 'Tôi đã ghi lại mật khẩu này', exact: true }).click();
    await expect(page.getByTestId('temp-password'), 'bấm nút thì PHẢI đóng được').toHaveCount(0);

    // Chốt vào DÒNG BẢNG: email nay xuất hiện ở cả tiêu đề hộp, `getByText` trần sẽ khớp hai chỗ.
    await expect(page.getByRole('row', { name: new RegExp(unique) })).toBeVisible();
  });

  test('member không thấy mục Tài khoản và bị chặn khi gõ thẳng URL', async ({ page }) => {
    await firstLogin(page, { email: 'e2e-member@pmh.com.vn', password: 'E2e@Test#2026' });

    await openNavGroup(page);
    await expect(page.getByRole('link', { name: 'Người dùng IMS', exact: true })).toHaveCount(0);

    const response = await page.request.get('/api/v1/accounts');
    expect(response.status()).toBe(403);
  });

  test('SA xem và đá được phiên đang mở', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await openNavGroup(page);
    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();

    await rowAction(page, 'E2E Super Admin', 'Phiên đang mở');
    await expect(page.getByRole('dialog')).toContainText('Phiên đang mở');
    await expect(page.getByRole('button', { name: 'Đóng phiên' }).first()).toBeVisible();
  });

  test('khóa rồi mở lại tài khoản (hồi quy: body chỉ được chứa field của DTO)', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await openNavGroup(page);
    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();

    const row = page.getByRole('row', { name: /E2E Thành viên/ });
    await rowAction(page, 'E2E Thành viên', 'Khóa');
    // Khóa / Vô hiệu hóa bắt ghi lý do (vết an ninh) trước khi nút xác nhận chạy.
    await page.getByRole('dialog').getByRole('textbox', { name: /Lý do/ }).fill('E2E khóa thử');
    // Chốt luôn CHỮ trên nút: hộp hỏi "Khóa tài khoản X?" thì nút phải ghi "Khóa", không
    // phải "Đồng ý" chung chung. Đây là chỗ duy nhất canh chữ — 15 chỗ còn lại bám vị trí.
    await confirmAction(page, 'Khóa');

    await expect(row.getByText('Đang khóa')).toBeVisible();
    // Không được có toast lỗi kiểu "property id should not exist".
    await expect(page.getByText(/should not exist/i)).toHaveCount(0);

    await rowAction(page, 'E2E Thành viên', 'Mở khóa');
    await confirmAction(page, 'Mở khóa');
    await expect(row.getByText('Đang hoạt động')).toBeVisible();
    await expect(page.getByText('Đã mở khóa E2E Thành viên.')).toBeVisible();
  });

  /*
   * VÔ HIỆU HÓA LÀ VIỆC KHÁC KHÓA — và menu phải gọi đúng tên việc.
   *
   * `users.status` có BA giá trị, `auth.service.ts` cố ý trả hai mã lỗi khác nhau cho hai
   * trong số đó (khóa là tạm, vô hiệu hóa là cho người đã nghỉ hẳn). Màn quản trị mà chỉ
   * hỏi `status === 'active'` rồi chia đôi thì một tài khoản ĐANG VÔ HIỆU HÓA được mời bấm
   * "Mở khóa" — trong khi nó có bị khóa đâu.
   *
   * Bài này đi cả vòng qua giao diện, và vế chốt là `not.toContain('Mở khóa')`.
   */
  test('vô hiệu hóa rồi kích hoạt lại — và tài khoản đã vô hiệu hóa KHÔNG được mời "Mở khóa"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await openNavGroup(page);
    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();

    const row = page.getByRole('row', { name: /E2E Thành viên/ });
    await expect(row.getByText('Đang hoạt động')).toBeVisible();

    expect(
      await rowActionNames(page, 'E2E Thành viên'),
      'tài khoản đang hoạt động phải có CẢ HAI đường: khóa tạm, và vô hiệu hóa hẳn',
    ).toEqual(expect.arrayContaining(['Khóa', 'Vô hiệu hóa']));

    await rowAction(page, 'E2E Thành viên', 'Vô hiệu hóa');
    // Khóa / Vô hiệu hóa bắt ghi lý do (vết an ninh) trước khi nút xác nhận chạy.
    await page.getByRole('dialog').getByRole('textbox', { name: /Lý do/ }).fill('E2E nghỉ việc');
    await confirmAction(page, 'Vô hiệu hóa');
    await expect(
      row.getByText('Đã vô hiệu hóa', { exact: true }),
      'huy hiệu phải nói đúng trạng thái — "Đang khóa" ở đây là một câu sai',
    ).toBeVisible();

    const menu = await rowActionNames(page, 'E2E Thành viên');
    expect(
      menu,
      'ĐÂY LÀ LỖI ĐÃ VÁ: tài khoản vô hiệu hóa không bị khóa, nên không có gì để "Mở khóa"',
    ).not.toContain('Mở khóa');
    expect(menu, 'thay vào đó là "Bật lại" — cùng động từ với danh mục và tài khoản dịch vụ').toContain(
      'Bật lại',
    );

    await rowAction(page, 'E2E Thành viên', 'Bật lại');
    await confirmAction(page, 'Bật lại');
    await expect(
      row.getByText('Đang hoạt động'),
      'kích hoạt lại phải mở THẬT, không chỉ đổi chữ',
    ).toBeVisible();
  });

  test('tìm kiếm chạy phía server: tìm được cả người không nằm ở trang đang xem', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await openNavGroup(page);
    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();

    await page.getByRole('searchbox').fill('E2E Thành viên');
    // Bám đúng ô HỌ TÊN: nút ba chấm mang nhãn trợ năng "Thao tác với {tên}" nên ô Thao tác
    // cũng chứa tên người, và khớp lỏng là trúng hai ô.
    await expect(
      page.getByRole('cell', { name: /E2E Thành viên/ }).filter({ hasText: 'e2e-member@' }),
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: /E2E Super Admin/ })).toHaveCount(0);

    /*
     * Từ khóa không khớp ai: phải nói rõ là LỌC KHÔNG RA, không để bảng trắng — và cũng
     * không nói "Chưa có dữ liệu": câu đó tuyên bố hệ thống chưa có tài khoản nào — trên chính
     * màn quản trị tài khoản, nơi nó đọc như một sự cố.
     */
    await page.getByRole('searchbox').fill('khong-ton-tai-zzz');
    await expect(page.getByText('Không có tài khoản nào khớp ô tìm.')).toBeVisible();
  });

  /**
   * G-04: khóa tài khoản thì MỌI phiên của người đó chết ngay.
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
      await openNavGroup(page);
      await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
      const row = page.getByRole('row', { name: /E2E Thành viên/ });
      await rowAction(page, 'E2E Thành viên', 'Khóa');
      await page.getByRole('dialog').getByRole('textbox', { name: /Lý do/ }).fill('E2E khóa thử');
      await confirmAction(page);
      await expect(row.getByText('Đang khóa')).toBeVisible();

      // `expect.poll` chứ không đọc một phát: thu hồi phiên đi qua DB, và response của lệnh
      // khóa có thể về trước khi UPDATE kịp commit.
      await expect
        .poll(async () => (await memberPage.request.get('/api/v1/auth/me')).status())
        .toBe(401);

      // Và người đó bị đá về trang đăng nhập chứ không ngồi lại trong app với dữ liệu cũ.
      await memberPage.goto('/devices');
      await expect(memberPage).toHaveURL(/login/);
    } finally {
      await memberCtx.close();
    }
  });

  /**
   * G-05: nút "Đóng phiên" thật sự cắt phiên.
   *
   * Dừng ở `toBeVisible()` trên chính nút đó là chưa đủ: một nút hiện ra và một nút làm được
   * việc là hai chuyện khác nhau.
   */
  test('SA bấm đóng phiên thì trình duyệt kia bị đẩy về đăng nhập', async ({ page, browser }) => {
    const memberCtx = await browser.newContext(SECOND_BROWSER);
    const memberPage = await memberCtx.newPage();
    try {
      await firstLogin(memberPage, E2E_MEMBER);
      expect((await memberPage.request.get('/api/v1/auth/me')).status()).toBe(200);

      await firstLogin(page, E2E_SA);
      await openNavGroup(page);
      await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
      await rowAction(page, 'E2E Thành viên', 'Phiên đang mở');

      // Lọc theo nội dung: lát nữa hộp xác nhận mở chồng lên, `getByRole('dialog')` trơ
      // sẽ khớp hai cái và Playwright báo strict mode.
      const dialog = page.getByRole('dialog').filter({ hasText: 'Phiên đang mở' });
      await dialog.getByRole('button', { name: 'Đóng phiên' }).first().click();
      // Đóng phiên có hỏi lại ("Đóng phiên đăng nhập từ IP …?") — không bấm Đồng ý thì chưa có gì xảy ra.
      await confirmAction(page);

      await expect
        .poll(async () => (await memberPage.request.get('/api/v1/auth/me')).status())
        .toBe(401);
      await memberPage.goto('/devices');
      await expect(memberPage).toHaveURL(/login/);
    } finally {
      await memberCtx.close();
    }
  });

  test('ADM-049: "Đóng tất cả phiên" đẩy người đó khỏi mọi máy; SA tự đóng thì giữ phiên đang dùng', async ({
    page,
    browser,
  }) => {
    const memberCtx = await browser.newContext(SECOND_BROWSER);
    const memberPage = await memberCtx.newPage();
    const saCtx = await browser.newContext(SECOND_BROWSER);
    const saOther = await saCtx.newPage();
    try {
      await firstLogin(memberPage, E2E_MEMBER);
      // Cùng một SA ở hai máy: máy thứ hai đăng nhập lại bằng mật khẩu mới + TOTP đã cài.
      const saSecret = await firstLogin(saOther, E2E_SA);
      await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saSecret);
      await openNavGroup(page);
      await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();

      await rowAction(page, 'E2E Thành viên', 'Phiên đang mở');
      const dialog = page.getByRole('dialog').filter({ hasText: 'Phiên đang mở' });
      await dialog.getByRole('button', { name: 'Đóng tất cả phiên' }).click();
      await confirmAction(page);
      await expect(page.getByText(/Đã đóng \d+ phiên\./)).toBeVisible();
      await expect
        .poll(async () => (await memberPage.request.get('/api/v1/auth/me')).status())
        .toBe(401);
      await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();

      // Đường hỏng cần tránh: SA đóng phiên của chính mình mà không tick thì KHÔNG được tự văng.
      await rowAction(page, 'E2E Super Admin', 'Phiên đang mở');
      await dialog.getByRole('button', { name: 'Đóng tất cả phiên' }).click();
      await expect(page.getByRole('checkbox', { name: /Đóng cả phiên bạn đang dùng/ })).not.toBeChecked();
      await confirmAction(page);
      await expect
        .poll(async () => (await saOther.request.get('/api/v1/auth/me')).status())
        .toBe(401);
      expect((await page.request.get('/api/v1/auth/me')).status()).toBe(200);
    } finally {
      await memberCtx.close();
      await saCtx.close();
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
  test('sắp xếp theo cột chạy ở server, cột không sắp được thì không có nút (tài khoản)', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
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
    await openNavGroup(page);
    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
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


/**
 * TRẠNG THÁI DANH SÁCH SỐNG TRÊN THANH ĐỊA CHỈ (B-02).
 *
 * Đo trước khi sửa: `/devices` gõ "CC" thì URL thành `?q=CC` và reload giữ nguyên; `/admin/accounts`
 * gõ "Cao" thì bảng còn 1 dòng nhưng URL **không đổi**, bấm sắp xếp URL cũng không đổi, reload
 * thì về đủ dòng và ô tìm trắng.
 *
 * Hệ quả đáng kiểm không phải tiện nghi mà là **nút Back**: sáu màn kia gỡ bộ lọc, màn này RỜI
 * TRANG. Cùng một phản xạ, hai kết quả khác nhau — và người dùng học phản xạ từ sáu màn kia.
 */
test('/admin/accounts giữ ô tìm và thứ tự trên URL — chia sẻ được, reload giữ nguyên', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  await openNavGroup(page);
  await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/accounts$/);

  await searchAndWaitForFilter(page, 'e2e-thanh-vien');
  // Đếm khi bảng đã vẽ xong; đếm sớm ra 0 rồi so với bảng sau reload là đỏ chập chờn.
  await expect(page.getByRole('row').first()).toBeVisible();
  const rowCount = await page.getByRole('row').count();

  // 1. Reload giữ nguyên kết quả — tức link chia sẻ được.
  await page.reload();
  await expect(page.getByRole('searchbox', { name: /Tìm/ })).toHaveValue('e2e-thanh-vien');
  await expect(page.getByRole('row')).toHaveCount(rowCount);

  // 2. Sắp xếp cũng đi vào URL.
  await page.getByRole('button', { name: 'Họ tên' }).click();
  await expect(page).toHaveURL(/[?&]sort=/);

  /*
   * 3. Nút Back RỜI MÀN — và ĐÓ LÀ THIẾT KẾ, không phải lỗi.
   *
   * Đừng coi *"nút Back của trình duyệt rời trang thay vì gỡ bộ lọc"* là lỗi.
   * `useListUrlState` ghi bằng `replace` CÓ CHỦ Ý, kèm lý do viết ngay tại chỗ — *"người
   * dùng bấm Back là muốn rời khỏi màn, không phải đi lùi qua mười hai lần chỉnh bộ lọc"*. Sáu
   * màn kia cũng vậy, nên đây là hành vi ĐỒNG NHẤT chứ không phải chỗ `/admin/accounts` lệch đi.
   *
   * Khoá lại hành vi THẬT ở đây, vì nó là một quyết định đáng giữ: Back phải rời màn.
   */
  await page.goBack();
  await expect(page).not.toHaveURL(/\/admin\/accounts/);
});
