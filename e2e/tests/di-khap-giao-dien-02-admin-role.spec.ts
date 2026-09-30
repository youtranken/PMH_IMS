import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  SECOND_BROWSER,
  confirmAction,
  expireStepUp,
  firstLogin,
  freshTotpCode,
  logout,
  resetAccessList,
  resetApprovals,
  resetDevices,
  resetSecrets,
  resetUsers,
  rowAction,
  sql,
  writeHeaders,
  uniqueStamp,
} from './helpers';

/**
 * ===== PHẦN 2 — "SA dựng một Quản trị viên, rồi người đó vào làm việc" =====
 *
 * VÌ SAO KHỐI NÀY TỒN TẠI: hệ thống có ba vai (`sa` · `admin` · `member`) nhưng 67 file E2E
 * hiện có KHÔNG file nào chạm vai `admin` — hạt giống chỉ gieo hai tài khoản `e2e-sa@` và
 * `e2e-member@`. Nghĩa là mọi luật phân quyền dành riêng cho Quản trị viên chưa từng được
 * chứng minh: cả phần họ ĐƯỢC làm (két sắt, duyệt phiếu) lẫn phần họ KHÔNG được làm (quản trị
 * tài khoản, bộ giao diện). Khối này lấp đúng khoảng trống đó, và lấp bằng con đường một
 * người thật đi: SA tạo tài khoản QUA MÀN `/admin/accounts`, đọc mật khẩu tạm, rồi người mới
 * tự đăng nhập lần đầu.
 */
test.describe('Quản trị viên — vai chưa từng ai kiểm', () => {
  /**
   * Email BẮT BUỘC theo mẫu `e2e-tao-moi-%`: script dọn (`api/scripts/reset-e2e.mjs`, vùng
   * `users`) chỉ xoá đúng mẫu này. Sai một chữ là tài khoản ở lại DB vĩnh viễn và làm đỏ mọi
   * lượt chạy sau vì email trùng.
   */
  const ADMIN_EMAIL = 'e2e-tao-moi-admin@pmh.com.vn';
  const ADMIN_NAME = 'E2E Quản trị viên';

  test.beforeEach(() => {
    resetUsers();
    resetApprovals();
    resetAccessList();
    resetSecrets();
    resetDevices();
  });

  /**
   * Tạo tài khoản Quản trị bằng API của SA — dùng cho ba bài SAU, không dùng cho bài 1.
   *
   * Bài 1 cố tình đi qua GIAO DIỆN (đó chính là điều nó kiểm). Ba bài còn lại kiểm việc admin
   * LÀM ĐƯỢC GÌ, nên khúc dựng người được rút ngắn — mỗi bài đã phải trả giá hai lượt đăng
   * nhập đầy đủ kèm hai lần chờ mã TOTP mới rồi.
   */
  async function createAdminAccount(page: Page): Promise<string> {
    const created = await page.request.post('/api/v1/accounts', {
      headers: await writeHeaders(page),
      data: {
        email: ADMIN_EMAIL,
        fullName: ADMIN_NAME,
        role: 'admin',
        totpLoginRequired: true,
        phone: '',
        employeeCode: '',
        birthDate: '',
      },
    });
    expect(created.status(), 'SA phải tạo được tài khoản vai admin').toBe(201);
    const body = (await created.json()) as { temporaryPassword: string };
    expect(
      body.temporaryPassword.length,
      'API phải trả mật khẩu tạm — không có nó thì không ai đăng nhập lần đầu được',
    ).toBeGreaterThanOrEqual(12);
    return body.temporaryPassword;
  }

  /** Lấy id loại thiết bị "Switch" từ danh mục — mọi vai đều đọc được danh mục. */
  async function switchType(page: Page): Promise<string> {
    const res = await page.request.get('/api/v1/catalog');
    expect(res.status(), 'danh mục phải đọc được thì mới tạo được thiết bị').toBe(200);
    const catalog = (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    const type = catalog.deviceTypes.find((item) => item.name === 'Switch');
    expect(type, 'hạt giống phải có loại thiết bị "Switch"').toBeTruthy();
    return type!.id;
  }

  /** Tạo một thiết bị (mã luôn chứa "E2E" để `resetDevices()` dọn được). */
  async function createDevice(page: Page, code: string, typeId: string): Promise<string> {
    const created = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: { code, name: `Switch ${code}`, deviceTypeId: typeId, serial: `FOC-${code}` },
    });
    expect(created.status(), `phải tạo được thiết bị ${code}`).toBe(201);
    return ((await created.json()) as { device: { id: string } }).device.id;
  }

  /**
   * ===== BÀI 1 =====
   *
   * Đây là bài NỀN của cả khối: nó dựng ra vai `admin` bằng đúng con đường con người dùng —
   * SA bấm vào màn `/admin/accounts`, điền form, đọc mật khẩu tạm hiện MỘT LẦN, rồi người mới
   * tự đi hết luồng lần đầu (mật khẩu tạm → cài 2 lớp → đổi mật khẩu).
   *
   * ĐỎ KHI: form tạo tài khoản không nhận vai `admin`; mật khẩu tạm không hiện ra (người mới
   * không bao giờ vào được); hoặc — quan trọng nhất — menu của admin sai. `visibleGroups()`
   * lọc theo `item.roles`, nên một lần thêm/xoá `roles` nhầm ở `app-nav.ts` sẽ bày ra cho
   * Quản trị viên một cánh cửa họ không được vào ("Tài khoản", "Bộ giao diện"), hoặc giấu mất
   * cửa họ cần ("Quyền két sắt", "Két sắt"). Không bài nào khác trong repo bắt được chuyện đó.
   */
  test('SA tạo tài khoản Quản trị, người đó đăng nhập lần đầu và thấy đúng phần việc của mình', async ({
    page,
  }) => {
    // Hai lượt đăng nhập đầy đủ (SA enroll → admin mới enroll), mỗi lượt chờ một mã TOTP chưa
    // dùng — vượt xa trần 60 giây mặc định.
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);

    /*
     * `exact: true`: menu có cả "Tài khoản" (tài khoản đăng nhập IMS) lẫn "Tài khoản dịch vụ"
     * — khớp lỏng là trúng hai mục và Playwright từ chối ở chế độ strict.
     */
    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Người dùng IMS', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Họ tên' }).fill(ADMIN_NAME);
    await form.getByRole('textbox', { name: 'Email' }).fill(ADMIN_EMAIL);
    // Vai trò là ba lựa chọn radio có mô tả (nhóm "Vai trò").
    await form.getByRole('group', { name: 'Vai trò' }).getByRole('radio', { name: /^Quản trị/ }).check();
    await form.getByRole('button', { name: 'Lưu' }).click();

    // Mật khẩu tạm hiện ĐÚNG MỘT LẦN — đọc trượt là bài này không đi tiếp được.
    await expect(page.getByText('Mật khẩu tạm')).toBeVisible();
    const tempPassword = (await page.getByTestId('temp-password').innerText()).trim();
    expect(
      tempPassword.length,
      'mật khẩu tạm phải đủ dài — đây là thứ duy nhất mở được tài khoản mới',
    ).toBeGreaterThanOrEqual(12);

    /*
     * Nhãn nút là một LỜI XÁC NHẬN chứ không phải "Đóng": hộp này chặn Esc
     * và chặn click-nền, nên bấm nút là đường ra DUY NHẤT — và người bấm phải tự khẳng định
     * đã ghi lại mật khẩu, vì không có lần hiện thứ hai.
     */
    await page.getByRole('button', { name: 'Tôi đã ghi lại mật khẩu này', exact: true }).click();

    const row = page.getByRole('row', { name: new RegExp(ADMIN_NAME) });
    await expect(row).toBeVisible();
    await expect(
      row.getByText('Quản trị', { exact: true }),
      'dòng vừa tạo phải mang huy hiệu vai Quản trị, không phải Thành viên mặc định',
    ).toBeVisible();

    // Cửa DUY NHẤT để đăng xuất (helpers.logout) — bấm thẳng nút thì lượt POST logout bị hủy
    // giữa đường và phiên cũ sống tiếp.
    await logout(page);

    // ===== Người mới vào làm việc =====
    await firstLogin(page, { email: ADMIN_EMAIL, password: tempPassword });

    const menu = page.getByRole('navigation', { name: 'Điều hướng chính' });

    // Phần admin ĐƯỢC thấy.
    await expect(
      menu.getByRole('link', { name: 'Quyền két sắt', exact: true }),
      'Quản trị viên phải thấy ma trận Quyền két sắt — đó là việc của họ',
    ).toBeVisible();
    await expect(
      menu.getByRole('link', { name: 'Két sắt', exact: true }),
      'Quản trị viên phải thấy trang tổng Két sắt (Member thì không)',
    ).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Danh mục', exact: true })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Duyệt mở két', exact: true })).toBeVisible();

    // Phần admin KHÔNG được thấy.
    await expect(
      menu.getByRole('link', { name: 'Người dùng IMS', exact: true }),
      'quản trị tài khoản là việc của SA — admin không được thấy cửa vào',
    ).toHaveCount(0);
    await expect(
      menu.getByRole('link', { name: 'Bộ giao diện', exact: true }),
      'Bộ giao diện là trang nội bộ của đội phát triển, chỉ SA',
    ).toHaveCount(0);
    await expect(
      menu.getByRole('link', { name: 'Tham số hệ thống', exact: true }),
      'nới/siết hàng rào đăng nhập và két là việc của SA (Q-14)',
    ).toHaveCount(0);

    /*
     * Mục "chưa mở" (Tài liệu) là chữ thường `<span>`, KHÔNG phải link. Kiểm bằng
     * "không có link mang tên đó" thay vì bám `title` — nếu một ngày ai đó biến nó thành link
     * trỏ vào hư không, bài này đỏ.
     */
    await expect(
      menu.getByRole('link', { name: 'Tài liệu', exact: true }),
      'màn thuộc epic sau chỉ được hiện mờ, không được là link',
    ).toHaveCount(0);
    // `audit.controller.ts` mở cho sa + admin — menu phải khớp cửa sau nó.
    await expect(
      menu.getByRole('link', { name: 'Nhật ký hệ thống', exact: true }),
      'Quản trị viên phải thấy Nhật ký hệ thống',
    ).toBeVisible();

    // Và cửa Két sắt phải MỞ THẬT, không chỉ hiện trên menu.
    await menu.getByRole('link', { name: 'Két sắt', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Két sắt', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Không tìm thấy trang' }),
      '/vault phải mở được với vai admin (App.tsx gác cho sa + admin)',
    ).toHaveCount(0);
  });

  /**
   * ===== BÀI 2 =====
   *
   * Một cánh cửa bị khoá phải NÓI ra là nó khoá. Bài này gõ thẳng bốn URL của SA bằng phiên
   * admin và khẳng định ĐIỀU THẬT SỰ XẢY RA — không phải điều dễ nghe.
   *
   * Các route ứng xử KHÁC NHAU (đọc `web/src/App.tsx`):
   *
   *   • `/dev/components` và `/admin/accounts` — gác theo bảng `ROUTE_ROLES`
   *     (`lib/routes`): vai không đủ thì nhận trang 403 "Bạn không có quyền xem trang này".
   *   • `/documents` — CHƯA có route nào cả (mục menu còn `planned`), nên mọi vai đều nhận
   *     404, kể cả SA.
   *
   * Hàng rào thật của `/admin/accounts` nằm ở API: `AccountsController` mang `@Roles('sa')`
   * trên MỌI endpoint (AD-9), nên `GET /api/v1/accounts` trả 403 cho admin. Bài này vì thế
   * khẳng định hai thứ, và cả hai đều đáng giá:
   *   1. API là nơi chặn — 403, không phải 200 với danh sách rỗng.
   *   2. Router cũng gác: admin gõ thẳng URL nhận trang 403, không bao giờ thấy "Chưa có dữ
   *      liệu" — một Quản trị viên đọc "công ty không có tài khoản nào" sẽ tin là mình vừa
   *      kiểm tra xong.
   *
   * ĐỎ KHI: một route bị gác bỗng mở ra cho admin; hoặc `/admin/accounts` nuốt 403
   * thành bảng rỗng; hoặc API nới `@Roles` cho admin mà không ai bàn.
   */
  test('Quản trị viên gõ thẳng URL của SA thì hệ thống nói KHÔNG, chứ không im lặng', async ({
    page,
  }) => {
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);
    const tempPassword = await createAdminAccount(page);
    await logout(page);

    await firstLogin(page, { email: ADMIN_EMAIL, password: tempPassword });

    // --- Trang có thật nhưng không dành cho vai này → 403 nói rõ thiếu quyền (MISC-001);
    //     trang chưa có route → 404.
    await page.goto('/dev/components');
    await expect(
      page.getByRole('heading', { name: 'Bạn không có quyền xem trang này' }),
      'admin gõ /dev/components phải nhận trang 403 nói rõ thiếu quyền, không phải "không tồn tại"',
    ).toBeVisible();
    await page.goto('/documents');
    await expect(
      page.getByRole('heading', { name: 'Không tìm thấy trang' }),
      'admin gõ /documents phải nhận trang 404 tử tế, không phải màn trắng hay redirect câm',
    ).toBeVisible();

    // --- `/admin/accounts`: API là hàng rào thật, router gác thêm một lớp.
    const before = await page.request.get('/api/v1/accounts');
    expect(
      before.status(),
      'hàng rào thật nằm ở API: @Roles(\'sa\') phải trả 403 cho vai admin',
    ).toBe(403);

    await page.goto('/admin/accounts');
    /*
     * `/admin/accounts` — HAI HÀNG RÀO, và bài này chốt cả hai (B-09): router gác bằng bảng
     * `ROUTE_ROLES` trong `App.tsx`, và API gác bằng `@Roles('sa')`.
     *
     * Vế API ngay trên phải giữ: router gác là tiện cho người dùng, `@Roles('sa')` mới là
     * hàng rào. Bỏ vế ấy thì một lượt "dọn dẹp" App.tsx sau này gỡ mất lớp router mà không gì
     * kêu lên rằng cửa sau đang mở.
     */
    await expect(
      page.getByRole('heading', { name: 'Bạn không có quyền xem trang này' }),
      'router cũng gác: admin gõ thẳng URL của SA nhận trang 403',
    ).toBeVisible();

    /*
     * VẾ "403 phải nói ra là lỗi QUYỀN" Ở TẦNG MÀN KHÔNG NẰM Ở ĐÂY (B-09).
     *
     * Điều đó vẫn đáng giá: 403 phải hiện thành khối lỗi nói rõ "Bạn không có quyền", KHÔNG
     * được hoá thành "Chưa có dữ liệu" — câu đọc lên nghe như "công ty chưa có tài khoản nào",
     * một lời nói dối với người vừa bị từ chối.
     *
     * Router đã gác thì admin không tới được nhánh ấy qua cửa này. Vế đó được canh ở
     * `web/src/ui/load-state.test.tsx`, tầng component — "in đúng câu API gửi về" và "403 không có câu kèm → nói là thiếu quyền,
     * không nói là lỗi tải". Đó mới là chỗ đúng của một component dùng chung: nó áp cho MỌI
     * màn, không chỉ cho hai màn quản trị.
     */
  });

  /**
   * ===== BÀI 3 =====
   *
   * Vai admin ĐƯỢC làm trọn việc két sắt: cất · xem · xoay. `vault-panel.tsx` dựng nút theo
   * `isAdmin = role === 'sa' || role === 'admin'`; các bài khác chỉ chạy nhánh `sa`, nên bài này
   * bấm thử nhánh `admin`.
   *
   * ĐỎ KHI: admin không thấy nút "Cất mật khẩu/khóa" hoặc menu Sửa/Xoay/Thu hồi; API chặn nhầm vai
   * admin ở đường ghi két; bước xác thực (step-up) không bật lên khi grace đã hết; hoặc — tệ
   * nhất — giá trị xoay xong mà lượt Xem vẫn trả giá trị cũ.
   *
   * Thứ tự cố ý: cất → XEM (qua step-up) → xoay → XEM LẠI. Chỉ tốn MỘT lần gõ TOTP: sau
   * step-up thành công server mở grace, nên lượt xem thứ hai không bị hỏi lại — và chính lượt
   * thứ hai mới chứng minh việc xoay có tác dụng thật.
   */
  test('Quản trị viên làm được việc két sắt: cất, xem, xoay', async ({ page }) => {
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);
    const tempPassword = await createAdminAccount(page);
    await logout(page);

    const adminTotp = await firstLogin(page, { email: ADMIN_EMAIL, password: tempPassword });

    const stamp = uniqueStamp();
    const code = `SW-E2E-ADMIN-${stamp}`;
    // Chính việc tạo được thiết bị đã là một khẳng định: vai admin có quyền GHI hồ sơ.
    const deviceId = await createDevice(page, code, await switchType(page));

    const label = `admin web E2E ${stamp}`;
    const originalValue = `Adm1n#Goc#${stamp}`;
    const newValue = `Adm1n#Moi#${stamp}`;

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText('Két chưa có ngăn nào')).toBeVisible();

    // --- CẤT.
    await expect(
      page.getByRole('button', { name: 'Cất mật khẩu/khóa' }),
      'admin phải thấy nút cất secret — vault-panel dựng nút này theo isAdmin',
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cất mật khẩu/khóa' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill(label);
    await form.getByRole('textbox', { name: 'Tên đăng nhập' }).fill('admin');
    await form.getByRole('textbox', { name: 'Giá trị', exact: true }).fill(originalValue);
    await form.getByRole('button', { name: 'Lưu' }).click();

    const row = page.getByRole('row', { name: new RegExp(label) });
    await expect(row).toBeVisible();
    // Bảng CHỈ có metadata (FR-021/FR-026): giá trị không được nằm ở đâu trên trang.
    await expect(
      page.getByText(originalValue),
      'giá trị bí mật không được lộ trên bảng, kể cả trong DOM ẩn',
    ).toHaveCount(0);

    /*
     * Ép hết grace step-up thay vì ngồi chờ 10 phút. Không có bước này thì hộp "Xác nhận danh
     * tính" có thể không bật lên (vì vừa đăng nhập xong), và bài kiểm sẽ treo ở chỗ chờ một
     * hộp thoại không bao giờ tới — một lượt đỏ chẳng nói lên điều gì.
     */
    expireStepUp(ADMIN_EMAIL);

    // --- XEM (đi qua bước xác thực bằng mã TOTP thật).
    await page.getByRole('button', { name: 'Xem' }).click();
    await expect(page.getByRole('dialog', { name: 'Xác nhận danh tính' })).toBeVisible();
    await page.getByLabel('Mã xác thực').fill(await freshTotpCode(adminTotp));
    await expect(
      page.getByTestId('secret-value'),
      'sau khi xác thực, admin phải đọc được đúng giá trị đã cất',
    ).toHaveText(originalValue);
    await page.getByRole('button', { name: 'Ẩn ngay' }).click();

    // --- XOAY.
    await rowAction(page, label, 'Đổi giá trị');
    const rotateDialog = page.getByRole('dialog');
    await rotateDialog.getByRole('textbox', { name: 'Giá trị mới' }).fill(newValue);
    await rotateDialog.getByRole('button', { name: 'Đổi giá trị' }).click();
    await expect(page.getByText('Đã đổi giá trị.')).toBeVisible();

    // --- XEM LẠI: grace còn hiệu lực nên không bị hỏi mã nữa, và giá trị phải là bản MỚI.
    await page.getByRole('button', { name: 'Xem' }).click();
    await expect(
      page.getByTestId('secret-value'),
      'xoay xong mà lượt xem vẫn trả giá trị cũ thì việc xoay chỉ là hình thức',
    ).toHaveText(newValue);
  });

  /**
   * ===== BÀI 4 =====
   *
   * Hai nút "Từ chối" và "Thu hồi sớm" trên `/approvals` CHƯA BAO GIỜ được bấm trên giao diện
   * trong cả bộ E2E — `break-glass.spec.ts` chỉ đi đường "Duyệt". Đó là khoảng trống thật, và
   * nó nằm đúng ở hai nhánh lấy-quyền-đi: từ chối một phiếu đang chờ, và cắt sớm một quyền đã
   * cấp (`BREAK_GLASS_FLOW`: `pending→denied`, `approved→revoked`).
   *
   * ĐỎ KHI: hộp quyết định không mở cho vai admin; nút "Thu hồi sớm" không hiện ở tab Nhật ký
   * cho phiếu còn hiệu lực; hoặc — thứ chỉ DB nói ra được — bấm nút mà `state` trong bảng
   * `approval` không đổi, tức là giao diện báo xong mà quyền vẫn còn sống.
   *
   * Phần của Member dựng bằng `page.request` cho nhanh (đó không phải thứ bài này kiểm); phần
   * của admin thì BẤM THẬT từng nút.
   */
  test('Quản trị viên xử được phiếu xin quyền — cả từ chối lẫn thu hồi', async ({ page, browser }) => {
    // Ba lượt đăng nhập đầy đủ (SA → Member → admin mới), mỗi lượt một lần chờ mã TOTP mới.
    test.setTimeout(150_000);

    const stamp = uniqueStamp();
    const reasonA = `E2E xin xem switch A ${stamp}`;
    const reasonB = `E2E xin xem switch B ${stamp}`;

    // ===== SA: dựng người, dựng máy, mở tầng "cần duyệt" cho Member =====
    await firstLogin(page, E2E_SA);
    const tempPassword = await createAdminAccount(page);

    const typeId = await switchType(page);
    const deviceA = await createDevice(page, `SW-E2E-DUYET-A-${stamp}`, typeId);
    const deviceB = await createDevice(page, `SW-E2E-DUYET-B-${stamp}`, typeId);

    const saHeaders = await writeHeaders(page);
    const granted = await page.request.post('/api/v1/vault/access', {
      headers: saHeaders,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: typeId,
        tier: 'needs_approval',
      },
    });
    expect(granted.status(), 'phải gán được tầng cần-duyệt thì Member mới xin được').toBeLessThan(300);
    await logout(page);

    // ===== Member: gửi HAI phiếu (mỗi chủ thể chỉ được một phiếu treo — nên phải hai máy) =====
    // Ngữ cảnh riêng cho người xin; phiếu chờ không gắn phiên (Q-15) nên đóng ngữ cảnh hay
    // đăng xuất đều không làm mất phiếu admin cần xử.
    const memberCtx = await browser.newContext(SECOND_BROWSER);
    const memberPage = await memberCtx.newPage();
    await firstLogin(memberPage, E2E_MEMBER);
    const memberHeaders = await writeHeaders(memberPage);
    for (const [ownerId, reason] of [
      [deviceA, reasonA],
      [deviceB, reasonB],
    ] as const) {
      const sent = await memberPage.request.post('/api/v1/vault/break-glass', {
        headers: memberHeaders,
        data: { ownerType: 'device', ownerId, reason, hours: 4 },
      });
      expect(sent.status(), `Member phải gửi được phiếu: ${reason}`).toBe(201);
    }
    await memberCtx.close();

    // ===== Quản trị viên: xử phiếu bằng tay =====
    await firstLogin(page, { email: ADMIN_EMAIL, password: tempPassword });
    await page.goto('/approvals');

    // Ba tab của người duyệt — Member chỉ có một, nên đây cũng là một khẳng định về vai.
    await expect(page.getByRole('tab', { name: /Chờ duyệt/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Nhật ký' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Yêu cầu của tôi' })).toBeVisible();

    await expect(page.getByText(reasonA)).toBeVisible();
    await expect(page.getByText(reasonB)).toBeVisible();

    // --- TỪ CHỐI một phiếu. Không đoán thứ tự hai thẻ: bấm cái đầu tiên rồi ĐỌC hộp thoại để
    //     biết mình vừa từ chối phiếu nào.
    await page.getByRole('button', { name: 'Từ chối', exact: true }).first().click();
    const rejectDialog = page.getByRole('dialog');
    const rejectedReason = (
      await rejectDialog.getByText(/E2E xin xem switch [AB] /).innerText()
    ).trim();
    const approvedReason = rejectedReason === reasonA ? reasonB : reasonA;
    await rejectDialog.getByRole('textbox', { name: 'Lý do từ chối' }).fill('E2E: chưa cần');
    await rejectDialog.getByRole('button', { name: 'Từ chối', exact: true }).click();
    await expect(page.getByText('Đã từ chối.')).toBeVisible();
    /*
     * CHỜ hàng chờ thật sự rụng mất phiếu vừa từ chối, ĐỪNG bấm tiếp ngay sau toast.
     *
     * Toast hiện ra trong `onSuccess`, còn danh sách chỉ đổi sau khi lượt refetch của
     * `invalidateQueries` về. Ở giữa hai mốc đó màn vẫn còn HAI nút "Duyệt", và
     * `getByRole(...).click()` gặp hai phần tử là ném strict-mode violation NGAY — không
     * chờ lại. Đây là kiểu đỏ chập chờn tệ nhất: nó thắng cuộc đua trên máy nhanh.
     */
    await expect(page.getByText(rejectedReason)).toHaveCount(0);

    // --- DUYỆT phiếu còn lại (giờ chỉ còn một, không cần `.first()`), cấp 1 giờ.
    await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
    const approveDialog = page.getByRole('dialog');
    await approveDialog.getByRole('textbox', { name: 'Cấp trong bao lâu (giờ)' }).fill('1');
    await approveDialog.getByRole('button', { name: 'Duyệt 1 giờ', exact: true }).click();
    await expect(page.getByText('Đã duyệt.')).toBeVisible();

    // Hàng chờ phải sạch — cả hai phiếu đã có người quyết.
    await expect(page.getByText('Không có yêu cầu nào đang chờ')).toBeVisible();

    // --- THU HỒI SỚM. Phiếu đã duyệt nằm ở tab Nhật ký; chỉ phiếu còn hiệu lực mới có nút này
    //     (phiếu bị từ chối thì không có). Quyền đang chạy nay được ghim thành nhóm "Đang có hiệu lực" ở đầu tab (VLT-020) nên
    //     nó hiện hai lần (nhóm + dòng nhật ký) — bấm ở nhóm ghim, chỗ người trực tìm tới.
    await page.getByRole('tab', { name: 'Nhật ký' }).click();
    const activeGroup = page.getByRole('region', { name: /^Đang có hiệu lực/ });
    await expect(activeGroup.getByText(approvedReason)).toBeVisible();
    await activeGroup.getByRole('button', { name: 'Thu hồi sớm' }).click();

    /*
     * NÚT NÀY PHẢI HỎI LẠI.
     *
     * Nó cắt một quyền ĐANG CHẠY của người khác — có thể họ đang mở két giữa lúc xử sự cố —
     * mà lại nằm ngay dưới cặp Duyệt/Từ chối trên cùng một thẻ phiếu, nên trượt tay là cắt
     * nhầm. Hai chỗ anh em trong cụm Két sắt (gỡ quyền ở ma trận, thu hồi ngăn ở panel) cũng
     * qua `askConfirm({ danger: true })`.
     *
     * Vế "chưa xác nhận thì CHƯA thu hồi" mới là vế có giá trị: một bản vá dựng hộp lên rồi
     * vẫn gọi API ngay cũng làm câu `toBeVisible` phía dưới xanh.
     */
    const revokeDialog = page.getByRole('dialog');
    await expect(
      revokeDialog.getByText(/Quyền này đang có hiệu lực/),
      'câu hỏi lại phải nói rõ đang cắt thứ đang chạy, không phải một câu "chắc chưa?"',
    ).toBeVisible();
    expect(
      sql(`SELECT state FROM approval WHERE reason = '${approvedReason}'`),
      'mới mở hộp hỏi lại thì TUYỆT ĐỐI chưa được đụng vào sổ',
    ).toBe('approved');

    await revokeDialog.getByRole('textbox', { name: 'Lý do thu hồi' }).fill('E2E: xong việc, cắt sớm');
    await confirmAction(page, 'Thu hồi sớm');
    await expect(page.getByText('Đã thu hồi quyền.')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Thu hồi sớm' }),
      'thu hồi xong thì không còn gì để thu hồi nữa',
    ).toHaveCount(0);

    /*
     * VÀ HỎI THẲNG CƠ SỞ DỮ LIỆU.
     *
     * Toast là lời của giao diện; `approval.state` mới là thứ quyết định lần đọc két kế tiếp
     * (AD-6: hiệu lực kiểm tại MỖI lần đọc). Không có ba câu dưới đây thì một bản sửa làm nút
     * bấm xong chỉ hiện toast mà không ghi gì vẫn xanh — đúng kiểu hỏng để lại một quyền
     * break-glass còn sống trong khi mọi người tin là đã cắt.
     */
    expect(
      sql(`SELECT state FROM approval WHERE reason = '${rejectedReason}'`),
      'phiếu bị bấm Từ chối phải nằm ở state denied',
    ).toBe('denied');
    expect(
      sql(`SELECT state FROM approval WHERE reason = '${approvedReason}'`),
      'phiếu đã duyệt rồi thu hồi sớm phải nằm ở state revoked, không phải approved',
    ).toBe('revoked');
    expect(
      sql(`SELECT decided_by FROM approval WHERE reason = '${rejectedReason}'`),
      'người quyết phải là chính Quản trị viên vừa bấm — nhật ký phải chỉ đúng người',
    ).toBe(ADMIN_EMAIL);
  });
});
