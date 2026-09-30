import { expect, test } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  SECOND_BROWSER,
  confirmAction,
  fillLogin,
  firstLogin,
  resetUsers,
  rowAction,
  sql,
  searchAndWaitForFilter,
  writeHeaders,
  uniqueStamp,
  openNavGroup,
} from './helpers';

test.describe('Ba cửa quản trị chưa ai bấm bằng tay', () => {
  test.beforeEach(() => {
    resetUsers();
  });

  /**
   * TẠI SAO BÀI NÀY TỒN TẠI
   *
   * "Đặt lại mật khẩu" và "Đặt lại 2 lớp" là hai việc SA làm đúng vào lúc căng nhất: người
   * dùng mất điện thoại, hoặc nghi tài khoản bị chiếm. Cả hai đã có bài kiểm ở tầng API và
   * tầng service — nhưng NÚT thì chưa một lần nào được bấm trong cả bộ E2E (`grep "Đặt lại
   * mật khẩu" tests/` không ra dòng nào trước bài này). Nghĩa là ba kiểu hỏng dưới đây đi
   * qua toàn bộ cổng CI mà không ai biết:
   *
   *   - mục biến mất khỏi menu ba chấm (đổi `RowActions` mà quên một `items`);
   *   - mục còn đó nhưng gọi nhầm endpoint / nhầm `account.id`;
   *   - lệnh chạy đúng nhưng mật khẩu tạm không hiện ra — và mật khẩu tạm chỉ hiện MỘT LẦN,
   *     mất là phải làm lại từ đầu với một người đang chờ máy ở đầu dây bên kia.
   *
   * Bài này bấm cả hai nút và chốt HỆ QUẢ, không chốt cái nhãn: mật khẩu tạm hiện ra,
   * `must_change_password` bật lên, phiên đang mở của người đó chết, và `totp_secret_ct` về
   * null. Ba mốc "trước" đều được đo trước khi bấm, để không có khẳng định nào luôn-xanh.
   */
  test('SA đặt lại mật khẩu và xoá 2 lớp của người khác — bấm bằng tay trên màn Tài khoản', async ({
    page,
    browser,
  }) => {
    // Hai lượt đăng nhập đầy đủ: Member (ở trình duyệt thứ hai, để có phiên SỐNG mà giết) và SA.
    test.setTimeout(150_000);

    const memberCtx = await browser.newContext(SECOND_BROWSER);
    const memberPage = await memberCtx.newPage();
    try {
      /*
       * Member phải đi TRỌN luồng lần đầu, không chỉ đăng nhập: chính lượt đó mới đặt
       * `must_change_password = false` và ghi `totp_secret_ct`. Bỏ bước này thì hai khẳng
       * định cuối bài trở thành luôn-xanh — `resetUsers()` ở `beforeEach` đã để sẵn
       * `must_change_password = true` và `totp_secret_ct = NULL` rồi.
       */
      await firstLogin(memberPage, E2E_MEMBER);
      expect(
        (await memberPage.request.get('/api/v1/auth/me')).status(),
        'phiên của Member phải sống trước khi SA ra tay — không thì "phiên chết" chẳng chứng minh gì',
      ).toBe(200);

      const memberWhere = `email = '${E2E_MEMBER.email}'`;
      expect(
        sql(`SELECT must_change_password FROM users WHERE ${memberWhere}`),
        'Member vừa đổi mật khẩu xong nên cờ này phải TẮT — đây là mốc "trước"',
      ).toBe('f');
      expect(
        sql(`SELECT totp_secret_ct IS NULL FROM users WHERE ${memberWhere}`),
        'Member vừa cài 2 lớp xong nên secret phải CÓ — đây là mốc "trước"',
      ).toBe('f');

      const liveSessions = () =>
        Number(
          sql(
            `SELECT count(*) FROM sessions WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE ${memberWhere})`,
          ),
        );
      expect(liveSessions(), 'Member đang có ít nhất một phiên mở').toBeGreaterThan(0);

      // --- SA vào màn Tài khoản và bấm nút, đúng như người thật.
      await firstLogin(page, E2E_SA);
      await openNavGroup(page);
      await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Người dùng IMS', exact: true })).toBeVisible();

      // Lọc trước rồi mới bấm: danh sách phân trang 20 dòng, và người cần tìm không nhất
      // thiết nằm ở trang đang xem.
      // Chờ bộ lọc ÁP XONG chứ không chỉ chờ hàng hiện ra: hàng cần tìm vốn đã nằm ở trang 1
      // của danh sách CHƯA lọc, nên câu chờ xanh ngay, rồi lượt nạp lại đổ xuống giữa lúc menu
      // ba chấm đang mở và giật nó khỏi DOM. Lý do đầy đủ: `di-khap-giao-dien-09-catalog-accounts-kit.spec.ts`, bài
      // "Phòng Tài khoản".
      await searchAndWaitForFilter(page, 'E2E Thành viên');
      await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'Thao tác với E2E Thành viên' })).toBeVisible();

      // ===== CỬA 1: ĐẶT LẠI MẬT KHẨU =====
      await rowAction(page, 'E2E Thành viên', 'Đặt lại mật khẩu');
      // Chốt luôn CHỮ trên nút xác nhận: hộp hỏi "Đặt lại mật khẩu cho X?" mà nút ghi "Đồng ý"
      // thì người bấm phải đọc lại câu hỏi mới biết mình sắp làm gì.
      await confirmAction(page, 'Đặt lại mật khẩu');

      await expect(page.getByText('Mật khẩu tạm')).toBeVisible();
      const temporaryPassword = (await page.getByTestId('temp-password').innerText()).trim();
      expect(
        temporaryPassword.length,
        'mật khẩu tạm chỉ hiện MỘT LẦN — không hiện ra là SA phải làm lại cả quy trình',
      ).toBeGreaterThanOrEqual(12);
      // Nhãn nút là LỜI XÁC NHẬN, không phải "Đóng": hộp chặn Esc và click-nền nên đây là
      // đường ra duy nhất, và người bấm phải tự khẳng định đã ghi lại.
      await page
        .getByRole('button', { name: 'Tôi đã ghi lại mật khẩu này', exact: true })
        .click();

      expect(
        sql(`SELECT must_change_password FROM users WHERE ${memberWhere}`),
        'đặt lại mật khẩu phải BUỘC đổi ở lần đăng nhập tới — không thì mật khẩu tạm sống mãi',
      ).toBe('t');

      /*
       * `expect.poll` chứ không đọc một phát: việc thu hồi phiên chạy trong cùng transaction
       * với lượt ghi, và phản hồi HTTP có thể về trước khi COMMIT kịp hiện ra ở kết nối khác.
       */
      await expect
        .poll(() => liveSessions(), {
          message: 'đặt lại mật khẩu mà phiên cũ còn sống là người bị nghi chiếm tài khoản vẫn ngồi trong hệ thống',
        })
        .toBe(0);
      await expect
        .poll(async () => (await memberPage.request.get('/api/v1/auth/me')).status())
        .toBe(401);

      // ===== CỬA 2: ĐẶT LẠI 2 LỚP =====
      await rowAction(page, 'E2E Thành viên', 'Đặt lại xác thực 2 lớp');
      await confirmAction(page, 'Đặt lại xác thực 2 lớp');

      // Toast tự tắt sau 4 giây — khẳng định nó TRƯỚC, rồi mới đi hỏi DB (mỗi câu SQL đi qua
      // một lượt `docker compose exec`, đủ chậm để toast kịp biến mất).
      await expect(
        page.getByText('Đã đặt lại xác thực 2 lớp.'),
        'giao diện phải báo đã xong — im lặng thì SA không biết có nên bấm lại không',
      ).toBeVisible();

      expect(
        sql(`SELECT totp_secret_ct IS NULL FROM users WHERE ${memberWhere}`),
        'xoá 2 lớp phải XOÁ THẬT secret: người mất điện thoại phải quét lại được mã QR mới',
      ).toBe('t');
    } finally {
      await memberCtx.close();
    }
  });

  /**
   * TẠI SAO BÀI NÀY TỒN TẠI
   *
   * "Khóa tài khoản" đã có hai bài kiểm, nhưng cả hai đều dừng ở nửa đường:
   *   - `accounts.spec.ts` bấm nút rồi chốt CÁI NHÃN đổi thành "Đang khóa";
   *   - `account-locked-guard.spec.ts` chứng minh `status = 'locked'` chặn được đăng nhập,
   *     nhưng nó đặt trạng thái ấy bằng một câu `UPDATE` thẳng vào DB.
   *
   * Giữa hai bài đó có một khoảng trống đúng bằng thứ SA thật sự bấm: nếu nút "Khóa" gửi sai
   * `status`, hoặc gửi đúng nhưng vào nhầm `account.id`, thì bài thứ nhất vẫn xanh (nhãn đổi
   * theo dữ liệu server trả về) và bài thứ hai cũng xanh (nó không đi qua nút). Người bị khóa
   * vẫn đăng nhập bình thường: hệ thống nói một đằng, làm một nẻo.
   *
   * Bài này nối liền hai đầu: bấm nút, rồi ở một trình duyệt KHÁC thử đăng nhập thật và đọc
   * đúng câu báo lỗi trên màn. Rồi mở khóa và chứng minh cửa mở lại được — vế đối chứng, thứ
   * chặn một bản vá thô bạo kiểu "chặn hết cho chắc".
   */
  test('SA khoá rồi mở khoá một tài khoản, và người bị khoá thật sự không vào được', async ({
    page,
    browser,
    request,
  }) => {
    // Một lượt đăng nhập đầy đủ của SA + hai lượt thử đăng nhập của người bị khóa.
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    /*
     * Tài khoản DÙNG MỘT LẦN, không đụng vào `E2E_MEMBER` mà mấy chục bài khác đang dùng —
     * khóa nhầm người dùng chung là một lượt chạy đỏ hàng loạt ở những chỗ chẳng liên quan.
     * Tiền tố `e2e-tao-moi-` để `resetUsers()` tự dọn, không cần script xóa riêng.
     */
    const email = `e2e-tao-moi-khoa-tay-${stamp}@pmh.com.vn`;
    const fullName = `E2E Khoa Tay ${stamp}`;
    const created = await page.request.post('/api/v1/accounts', {
      headers: await writeHeaders(page),
      data: { email, fullName, role: 'member' },
    });
    expect(created.status(), 'dựng một tài khoản dùng một lần để khóa').toBe(201);
    const temporaryPassword = ((await created.json()) as { temporaryPassword: string })
      .temporaryPassword;

    await openNavGroup(page);
    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
    await page.getByRole('searchbox').fill(stamp);
    const row = page.getByRole('row', { name: new RegExp(fullName) });
    await expect(row).toBeVisible();

    /*
     * MỐC "TRƯỚC", VÀ VÌ SAO NÓ KHÔNG ĐI QUA GIAO DIỆN.
     *
     * Không có vế này thì lượt thử sau khi khóa chẳng chứng minh được gì — mật khẩu có thể
     * sai ngay từ đầu, và bài kiểm vẫn xanh.
     *
     * Nhưng nó phải đi bằng `request` (một hũ cookie RIÊNG, không dính vào phiên nào): một
     * lượt đăng nhập THÀNH CÔNG qua giao diện để lại phiên sống ở trình duyệt đó, và từ lúc
     * ấy `AppRoutes` đá mọi lượt `goto('/login')` về đúng bước còn thiếu (`/totp-enroll`).
     * `fillLogin` kế tiếp sẽ ngồi chờ ô Email trên một màn không hề có ô Email — đỏ ở
     * `locator.fill`, một chỗ chẳng liên quan gì tới việc khóa tài khoản.
     */
    const beforeLock = await request.post('/api/v1/auth/login', {
      headers: { Origin: APP_ORIGIN },
      data: { email, password: temporaryPassword },
      failOnStatusCode: false,
    });
    expect(
      beforeLock.status(),
      'còn active thì mật khẩu tạm phải vào được — đây là mốc "trước"',
    ).toBeLessThan(400);

    const victimCtx = await browser.newContext(SECOND_BROWSER);
    const victimPage = await victimCtx.newPage();
    try {
      // ===== CỬA 3: KHÓA =====
      await rowAction(page, fullName, 'Khóa');
      await page.getByRole('dialog').getByRole('textbox', { name: /Lý do/ }).fill('E2E khóa thử');
      await confirmAction(page, 'Khóa');
      await expect(
        row.getByText('Đang khóa'),
        'huy hiệu trạng thái phải đổi — nhưng đây MỚI LÀ NỬA ĐẦU của việc',
      ).toBeVisible();

      await fillLogin(victimPage, email, temporaryPassword);
      /*
       * Chốt ĐÚNG CÂU trên màn, không chỉ chốt "có lỗi gì đó". Câu này đến từ
       * `auth.service.ts` (mã `ACCOUNT_LOCKED`) và cố tình KHÁC câu của tài khoản bị vô hiệu
       * hóa: khóa là tạm và mở lại được, vô hiệu hóa là dứt điểm. Gộp một câu thì người trực
       * không biết nên bảo người dùng chờ hay bảo họ đi gặp SA.
       */
      await expect(
        victimPage.getByRole('alert'),
        'SA đã bấm Khóa thì người đó phải bị chặn NGAY ở cửa đăng nhập, và được nói rõ vì sao',
      ).toContainText('Tài khoản đang bị khóa. Liên hệ Super Admin để mở khóa.');
      await expect(
        victimPage.getByRole('heading', { name: 'Cài xác thực 2 lớp' }),
        'không được đi tiếp một bước nào trong luồng đăng nhập',
      ).toHaveCount(0);

      // ===== VÀ MỞ KHÓA LẠI =====
      // Mở khóa hỏi lại ngắn: nút nằm sát "Vô hiệu hóa", bấm trượt là mở một tài khoản bị nghi.
      await rowAction(page, fullName, 'Mở khóa');
      await confirmAction(page, 'Mở khóa');
      await expect(row.getByText('Đang hoạt động')).toBeVisible();

      await fillLogin(victimPage, email, temporaryPassword);
      await expect(
        victimPage.getByRole('heading', { name: 'Cài xác thực 2 lớp' }),
        'mở khóa phải mở THẬT — một bản vá kiểu "chặn hết cho chắc" sẽ đỏ ở đây',
      ).toBeVisible();
    } finally {
      await victimCtx.close();
    }
  });
});
