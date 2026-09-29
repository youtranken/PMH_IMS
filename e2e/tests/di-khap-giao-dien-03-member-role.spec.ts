import { expect, test } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  logout,
  resetAccessList,
  resetApprovals,
  resetDevices,
  resetSecrets,
  resetUsers,
  writeHeaders,
} from './helpers';

/* ===========================================================================================
 * PHẦN 3 — "Thành viên nhìn hệ thống hẹp hơn" + "Ba cửa quản trị chưa ai bấm bằng tay"
 * ===========================================================================================
 *
 * Hai khối dưới đây hỏi hai câu mà cả bộ E2E hiện tại chưa hỏi trọn vẹn:
 *
 *  1. Hệ thống HẸP LẠI đúng chỗ nào khi người ngồi trước máy là Thành viên? Từng bài lẻ có
 *     kiểm một mục ("member không thấy mục Tài khoản"), nhưng chưa bài nào KIỂM KÊ cả thanh
 *     điều hướng một lượt. Thêm một mục quản trị mà quên gắn `roles` là lỗi im lặng: nó không
 *     làm đỏ bài nào, chỉ bày một cánh cửa ra cho người không được vào.
 *
 *  2. Ba việc quản trị nặng nhất — đặt lại mật khẩu, đặt lại 2 lớp, khóa/mở tài khoản — đã có
 *     bài kiểm GỌI API và bài kiểm SỬA THẲNG DB, nhưng NÚT trên màn Tài khoản thì chưa một
 *     lần nào được bấm. Nút gọi sai endpoint, nút mất nhãn, nút mất luôn khỏi menu ba chấm:
 *     cả ba đều để bộ E2E xanh nguyên.
 */

test.describe('Thành viên thấy một hệ thống hẹp hơn', () => {
  test.beforeEach(() => {
    resetUsers();
    resetApprovals();
    resetAccessList();
    resetSecrets();
    resetDevices();
  });

  /**
   * TẠI SAO BÀI NÀY TỒN TẠI
   *
   * `app-nav.ts` là nơi DUY NHẤT quyết định ai thấy cửa nào, và nó quyết định bằng một
   * trường tùy chọn: `roles?: Me['role'][]`. Quên trường đó khi thêm mục mới thì mục ấy hiện
   * cho MỌI vai — TypeScript không đỏ (nó tùy chọn), lint không đỏ, và không bài kiểm nào
   * hiện có đếm số mục. Thành viên sẽ thấy một cửa mà bấm vào chỉ nhận 404 hoặc màn lỗi.
   *
   * Bài này đỏ khi: một mục quản trị rò rỉ sang vai member (danh sách dài ra), một mục
   * nghiệp vụ bị gắn `roles` nhầm (danh sách ngắn lại), hoặc mục "Tài liệu" của epic sau
   * biến thành link bấm được trong khi màn hình chưa hề tồn tại.
   */
  test('Thanh điều hướng của Thành viên thiếu đúng những thứ phải thiếu', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await expect(nav).toBeVisible();

    /*
     * KIỂM KÊ chứ không chỉ kiểm một mục: so cả danh sách, sắp xếp trước khi so để thứ tự
     * hiển thị đổi (việc UX làm được) không kéo bài này đỏ theo.
     */
    const seen = (await nav.getByRole('link').allInnerTexts())
      .map((text) => text.trim())
      .sort();
    const expected = [
      // 10 link nghiệp vụ (chia nhóm Tổng quan · Tài sản · Mạng · Bảo mật) + mục "Tài liệu"
      // không phải link (xem dưới).
      'Bảng điều khiển',
      'Thiết bị',
      'Phần mềm',
      'Đường truyền',
      'Sắp hết hạn',
      'Địa chỉ IP',
      'Sổ NAT',
      'Tài khoản dịch vụ',
      // Member chỉ xin, không duyệt — nên cửa này mang tên việc của họ (VLT-026), cùng
      // đường `/approvals` mà SA/Admin thấy là "Duyệt yêu cầu".
      'Xin mở két',
      'Kho thanh lý',
      // Nhóm "Hệ thống" — đúng MỘT mục.
      'Danh mục',
    ].sort();
    expect(
      seen,
      'Thành viên phải thấy đúng 11 cửa bấm được — thừa một mục là quên gắn `roles`, thiếu một mục là gắn nhầm',
    ).toEqual(expected);

    // Nhãn nhóm vẫn phải còn: "Hệ thống" biến mất nghĩa là Danh mục cũng đã rơi mất; nhóm
    // "Dành cho nhà phát triển" chỉ SA thấy (SHELL-008, SHELL-012).
    for (const nhom of ['Tổng quan', 'Tài sản', 'Mạng', 'Bảo mật', 'Hệ thống']) {
      await expect(nav.getByText(nhom, { exact: true })).toBeVisible();
    }
    await expect(nav.getByText('Dành cho nhà phát triển', { exact: true })).toHaveCount(0);

    /*
     * Bốn cửa PHẢI KHÔNG có. Viết rời từng cái thay vì tin vào phép so danh sách ở trên, vì
     * thông điệp lúc đỏ mới là thứ có giá trị: "Két sắt lọt vào menu member" đọc một phát
     * hiểu ngay, còn "hai mảng khác nhau" thì phải ngồi so mắt.
     *
     * `exact: true` ở "Tài khoản": menu còn có "Tài khoản dịch vụ" — thứ hoàn toàn khác, và
     * member ĐƯỢC thấy. Khớp lỏng là bài này đỏ oan.
     */
    await expect(
      nav.getByRole('link', { name: 'Két sắt', exact: true }),
      'trang tổng Két sắt là bản đồ "công ty giữ bí mật ở đâu" — chỉ SA/Admin',
    ).toHaveCount(0);
    await expect(
      nav.getByRole('link', { name: 'Người dùng IMS', exact: true }),
      'màn quản trị tài khoản chỉ của SA',
    ).toHaveCount(0);
    await expect(
      nav.getByRole('link', { name: 'Quyền két sắt', exact: true }),
      'ma trận quyền là bản đồ phòng thủ — chỉ SA/Admin',
    ).toHaveCount(0);
    await expect(
      nav.getByRole('link', { name: 'Bộ giao diện', exact: true }),
      'trang nội bộ của đội phát triển — chỉ SA',
    ).toHaveCount(0);

    // Còn Danh mục thì PHẢI có: form thiết bị cần biết danh mục có gì (quyền sửa do API chặn).
    await expect(nav.getByRole('link', { name: 'Danh mục', exact: true })).toBeVisible();

    /*
     * "Tài liệu" là mục của epic sau: nó HIỆN RA (để bản đồ điều hướng không phải vẽ lại mỗi
     * epic) nhưng KHÔNG phải link — chữ thường `<span>`. Đây là chỗ dễ hỏng nhất
     * trong cả file `app-shell.tsx`: bỏ cờ `planned` sớm một epic là người dùng bấm vào và
     * rơi thẳng xuống trang 404, mà không lỗi biên dịch nào báo.
     */
    await expect(
      nav.getByText('Tài liệu', { exact: true }),
      'mục của epic sau vẫn phải hiện để giữ chỗ trên bản đồ điều hướng',
    ).toBeVisible();
    await expect(
      nav.getByRole('link', { name: 'Tài liệu', exact: true }),
      'màn Tài liệu chưa tồn tại — bày nó thành link là hứa một đường đi không có thật',
    ).toHaveCount(0);
  });

  /**
   * TẠI SAO BÀI NÀY TỒN TẠI
   *
   * Ẩn mục menu KHÔNG phải là gác cửa. Người dùng chép URL cho nhau qua chat, ghim vào trình
   * duyệt, hoặc chỉ đơn giản là gõ tay. Bài này đi thẳng vào bốn đường mà menu của Thành viên
   * đã đóng, rồi khẳng định ĐÚNG điều thật sự xảy ra ở mỗi đường — chứ không khẳng định điều
   * ta mong nó xảy ra.
   *
   * Và đó là hai chuyện khác nhau, vì `App.tsx` gác KHÔNG ĐỀU:
   *  - `/vault` và `/dev/components` bọc trong `me.role === ...` → route không tồn tại → 404.
   *  - `/documents` chưa có route nào cả → 404.
   *  - `/admin/accounts` và `/admin/vault-access` KHÔNG gác vai ở router. Màn VẪN render.
   *    Hàng rào thật nằm ở API (`@Roles('sa')` trên `accounts.controller.ts`), nên cái Thành
   *    viên nhìn thấy là một màn đầu trang bình thường + khối "Không tải được dữ liệu."
   *
   * Bài này đỏ khi: có người gỡ nhầm điều kiện vai ở `App.tsx` (404 thành màn thật), HOẶC
   * khi màn quản trị nuốt lỗi 403 thành "Chưa có dữ liệu" — thứ đọc lên nghe như "hệ thống
   * chưa có tài khoản nào", một câu nói dối trắng trợn với người vừa bị từ chối quyền.
   */
  test('Gõ thẳng URL không mở được cửa mà menu đã đóng', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);

    for (const [path, why, heading] of [
      ['/vault', 'trang tổng Két sắt gác vai ngay ở route', 'Bạn không có quyền xem trang này'],
      ['/dev/components', 'Bộ giao diện là trang nội bộ, chỉ SA', 'Bạn không có quyền xem trang này'],
      ['/admin/settings', 'Tham số hệ thống chỉ SA (Q-14)', 'Bạn không có quyền xem trang này'],
      ['/documents', 'màn Tài liệu thuộc epic sau — chưa có route nào', 'Không tìm thấy trang'],
    ] as const) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: heading }),
        `${path}: ${why} — gõ thẳng URL nhận "${heading}"`,
      ).toBeVisible();
    }

    /*
     * ===== HAI CỬA CÒN LẠI KHÔNG PHẢI 404, VÀ ĐÓ LÀ SỰ THẬT PHẢI GHI RA =====
     *
     * `/admin/accounts` và `/admin/vault-access` nằm ngoài mọi điều kiện vai trong `App.tsx`
     * — chúng chỉ bị ẩn khỏi menu. Viết `toBeVisible()` cho tiêu đề 404 ở đây là viết một bài
     * kiểm sai sự thật; viết `getByText('Chưa có dữ liệu')` cũng sai nốt.
     *
     * Điều THẬT SỰ xảy ra: màn render (đầu trang, cả nút "Thêm tài khoản" — nút đó không gác
     * vai), rồi lượt `GET /api/v1/accounts` nhận 403 và khối bảng đổi thành `LoadError`.
     * Hàng rào thật là `@Roles('sa')` ở API, và vế cuối bài này chốt đúng nó.
     */
    /*
     * HAI CỬA NÀY NAY CŨNG 404 (B-09, sửa 22/09).
     *
     * Chú thích ngay trên đây từng ghi: "Viết `toBeVisible()` cho tiêu đề 404 ở đây là viết
     * một bài kiểm sai sự thật", và bài chị em ở trên dặn thẳng: "ai muốn 404 thì phải sửa
     * App.tsx, sửa xong hãy sửa bài này". Đã sửa `App.tsx` — quyền theo đường dẫn nay nằm
     * trong bảng `ROUTE_ROLES` và cả năm cửa gác cùng một kiểu — nên bài này sửa theo.
     *
     * Vế "403 phải nói ra là lỗi QUYỀN, không hoá thành Chưa có dữ liệu" chuyển về
     * `web/src/ui/load-state.test.tsx`, nơi nó áp cho MỌI màn chứ không riêng hai màn này.
     */
    for (const path of ['/admin/accounts', '/admin/vault-access'] as const) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: 'Bạn không có quyền xem trang này' }),
        `${path}: router gác vai — Member gõ thẳng URL nhận trang 403`,
      ).toBeVisible();
    }

    // Hàng rào THẬT, ở đúng chỗ nó nằm.
    expect(
      (await page.request.get('/api/v1/accounts')).status(),
      'API mới là nơi chặn — ẩn mục menu chỉ là dọn nhà cho gọn',
    ).toBe(403);
    expect(
      (await page.request.get('/api/v1/vault/access')).status(),
      'ma trận quyền két sắt cũng chặn ở API',
    ).toBe(403);
  });

  /**
   * TẠI SAO BÀI NÀY TỒN TẠI
   *
   * Story 6.3 mở tab "Két sắt" cho MỌI vai, kể cả Thành viên chưa có quyền — cố ý, vì quyền
   * đến từ ma trận 6.2 cộng với grant còn hạn, và client không suy ra được từ vai. Đổi lại,
   * cái tab ấy phải tự nói rõ ba điều cùng lúc:
   *
   *   1. CÓ gì trong két (tên gọi secret) — không thì người ta không biết mình đang xin cái gì;
   *   2. mình đang đứng ở tầng nào và phải làm gì tiếp;
   *   3. và KHÔNG bày ra một nút ghi nào — bấm vào chỉ nhận 403, tức là bày ra để lừa.
   *
   * Bài này đi trọn cung đường của một Thành viên đứng trước két: nhìn, đọc, xin, và thấy
   * trạng thái đổi sang "Đang chờ duyệt". Nó đỏ khi `canEdit` của `VaultPanel` bị nới lỏng
   * (nút "Cất mật khẩu/khóa" hoặc menu ba chấm hiện ra), khi panel im lặng thay vì nói tầng, hoặc
   * khi hộp xin quyền gửi xong mà giao diện không đổi trạng thái — cái cuối là kiểu hỏng
   * khiến người dùng bấm gửi ba lần rồi đi hỏi tay.
   */
  test('Thành viên đứng trước két: thấy tên gọi, xin được quyền, nhưng không có một nút ghi nào', async ({
    page,
  }) => {
    // Hai lượt đăng nhập đầy đủ (SA dựng dữ liệu → Member đi xem), mỗi lượt phải chờ một mã
    // TOTP chưa dùng để tránh chống-replay. Trần 60 giây mặc định không đủ.
    test.setTimeout(150_000);

    // --- SA dựng: một thiết bị + một secret, rồi gán Member tầng "cần được duyệt".
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = await writeHeaders(page);

    const catalogRes = await page.request.get('/api/v1/catalog');
    expect(catalogRes.status(), 'SA phải đọc được danh mục để lấy loại thiết bị').toBe(200);
    const catalog = (await catalogRes.json()) as { deviceTypes: { id: string; name: string }[] };
    const switchTypeId = catalog.deviceTypes.find((type) => type.name === 'Switch')!.id;

    const deviceRes = await page.request.post('/api/v1/devices', {
      headers,
      data: {
        code: `SW-E2E-TOUR-${stamp}`,
        name: `Switch tour E2E ${stamp}`,
        deviceTypeId: switchTypeId,
      },
    });
    expect(deviceRes.status(), 'dựng thiết bị cho bài kiểm').toBe(201);
    const deviceId = ((await deviceRes.json()) as { device: { id: string } }).device.id;

    const secretLabel = `admin web E2E ${stamp}`;
    const secretRes = await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: secretLabel,
        value: `TourE2E#${stamp}`,
      },
    });
    expect(secretRes.status(), 'cất một secret vào két của thiết bị vừa dựng').toBe(201);

    const grantRes = await page.request.post('/api/v1/vault/access', {
      headers,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: switchTypeId,
        tier: 'needs_approval',
      },
    });
    expect(grantRes.status(), 'gán Member tầng cần-được-duyệt trên nhóm loại thiết bị').toBeLessThan(300);

    await logout(page);

    // --- Member: nhìn thấy két, đọc được mình đang ở đâu, và không có nút ghi nào.
    await firstLogin(page, E2E_MEMBER);
    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();

    await expect(
      page.getByText(secretLabel),
      'phải THẤY tên gọi — không biết trong két có gì thì xin quyền cũng không biết xin cái gì',
    ).toBeVisible();
    await expect(
      page.getByText(/cần được duyệt trước khi xem/i),
      'panel phải nói rõ tầng của người đang xem, không để họ bấm rồi bị từ chối mà không hiểu vì sao',
    ).toBeVisible();

    await expect(
      page.getByRole('button', { name: 'Cất mật khẩu/khóa' }),
      'Member không ghi được vào két — bày nút ra là hứa một việc mà API sẽ từ chối bằng 403',
    ).toHaveCount(0);
    /*
     * Sửa · Xoay · Thu hồi nằm trong menu ba chấm, và mục menu chỉ vào DOM khi menu đang mở
     * — nên bám theo chữ "Sửa"/"Xoay" ở đây là một khẳng định LUÔN XANH, kể cả với người có
     * đủ quyền. Bám đúng cái nút MỞ menu: nó chỉ được vẽ khi `canEdit`.
     */
    await expect(
      page.getByRole('button', { name: /^Thao tác với/ }),
      'nút mở menu ghi chỉ được vẽ khi canEdit — Member không có nó',
    ).toHaveCount(0);

    // --- Xin quyền, bằng tay, đúng đường người thật đi.
    await page.getByRole('button', { name: 'Xin mở két' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Lý do' }).fill(`switch tour E2E ${stamp} mất kết nối`);
    await form.getByRole('textbox', { name: 'Xin trong bao lâu (giờ)' }).fill('3');
    await form.getByRole('button', { name: 'Gửi yêu cầu' }).click();

    await expect(
      page.getByText('Đang chờ duyệt'),
      'gửi xong mà giao diện không đổi trạng thái thì người dùng sẽ bấm gửi lần nữa — và lần hai là 409',
    ).toBeVisible();

    /*
     * Màn duyệt của Thành viên chỉ có MỘT tab. "Chờ duyệt" là hàng chờ của người duyệt và
     * "Nhật ký" là toàn bộ lịch sử của cả công ty — cả hai đều chặn ở API, nên bày tab ra
     * chỉ để bấm vào rồi nhận màn lỗi.
     */
    await page.goto('/approvals');
    await expect(page.getByRole('heading', { level: 1, name: 'Xin mở két' })).toBeVisible();
    await expect(
      page.getByRole('tab'),
      'Thành viên chỉ có một ngăn — thanh tab một-tab là vạch trang trí, không vẽ',
    ).toHaveCount(0);

    // Và mở ra là thấy NGAY yêu cầu vừa gửi, không phải đi tìm tab.
    await expect(page.getByText(`switch tour E2E ${stamp} mất kết nối`)).toBeVisible();
  });
});
