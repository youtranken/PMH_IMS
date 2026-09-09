import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  SECOND_BROWSER,
  confirmAction,
  expireStepUp,
  fillLogin,
  firstLogin,
  freshTotpCode,
  logout,
  resetAccessList,
  resetApprovals,
  resetDevices,
  resetSecrets,
  resetSoftware,
  resetUsers,
  rowAction,
  sql,
  writeHeaders,
} from './helpers';

/**
 * ===== ĐI KHẮP GIAO DIỆN — MỘT LƯỢT ĐI NHƯ NGƯỜI THẬT =====
 *
 * VÌ SAO FILE NÀY TỒN TẠI
 *
 * 67 file E2E trước nó kiểm từng màn rất sâu, nhưng gần như luôn TỚI màn bằng
 * `page.goto('/duong-dan')` với id lấy từ một lượt gọi API. Cách đó bỏ lọt đúng ba thứ, và cả
 * ba đều là thứ người dùng gặp đầu tiên:
 *
 *   1. NHỮNG SỢI DÂY NỐI CÁC MÀN. Thanh điều hướng, link mã trên bảng, breadcrumb, link
 *      "Xem toàn bộ" ở bảng điều khiển, nút đổi giao diện ở topbar. Một mục menu trỏ vào 404,
 *      một `PATHS.device(id)` ghép sai, một breadcrumb mất đường quay ra — không bài nào đỏ,
 *      vì mọi bài đều tự gõ URL đúng.
 *
 *   2. VAI `admin`. Hệ thống có ba vai; hạt giống E2E chỉ gieo `sa` và `member`. Nghĩa là mọi
 *      luật dành riêng cho Quản trị viên chưa từng được chứng minh — cả phần họ ĐƯỢC làm lẫn
 *      phần họ KHÔNG được. Khối 2 tự dựng lấy người đó, qua đúng màn `/admin/accounts`.
 *
 *   3. NHỮNG CÁI NÚT ĐÃ CÓ BÀI KIỂM GỌI API NHƯNG CHƯA AI BẤM. Đặt lại mật khẩu, đặt lại 2
 *      lớp, khoá/mở tài khoản, từ chối và thu hồi phiếu break-glass. Bài kiểm API xanh không
 *      chứng minh cái nút còn nối vào đúng endpoint đó — hoặc còn tồn tại.
 *
 * BỐN KHỐI, BA NGƯỜI DÙNG. Mỗi khối đi bằng CHUỘT và BÀN PHÍM. Chỗ nào chỉ là dàn cảnh (dựng
 * sẵn một thiết bị, một phiếu chờ) thì gọi API cho nhanh và nói rõ — nhưng ĐIỀU ĐANG KIỂM thì
 * luôn phải đi qua giao diện.
 */

/*
 * PHẦN 1 — "Người SA đi một vòng cả hệ thống".
 *
 * Bộ E2E hiện tại kiểm từng màn một cách RẤT sâu, nhưng gần như luôn tới màn bằng
 * `page.goto('/duong-dan')`. Nghĩa là những thứ NỐI các màn với nhau — thanh điều hướng,
 * link trên bảng, breadcrumb, link "Xem toàn bộ" trên bảng điều khiển, cái nút đổi giao diện
 * ở topbar — chưa có ai đi thử. Một link chết, một `to=` gõ sai, một mục menu trỏ vào 404 sẽ
 * KHÔNG làm đỏ bài nào, vì mọi bài đều tự gõ URL đúng.
 *
 * Năm bài dưới đây đi bằng CHUỘT và BÀN PHÍM, đúng như người dùng thật.
 */
test.describe('SA đi một vòng cả hệ thống', () => {
  test.beforeEach(() => {
    resetUsers();
    resetDevices();
    resetSoftware();
  });

  /** Một chặng trên thanh điều hướng: bấm nhãn nào, tới đường nào, thấy tiêu đề nào. */
  interface NavStop {
    /** Nhãn mục trong sidebar — khớp CHÍNH XÁC ("Tài khoản" không được vớ "Tài khoản dịch vụ"). */
    link: string;
    /** `pathname` mong đợi sau khi bấm. */
    path: string;
    /** `<h1>` của màn đích. Neo hai đầu để không khớp nhầm một tiêu đề dài hơn. */
    heading: RegExp;
  }

  /**
   * Bản đồ menu của vai SA, đúng thứ tự trong `web/src/shell/app-nav.ts`.
   * Hai mục `planned` (Tài liệu, Nhật ký) KHÔNG có ở đây — chúng được kiểm riêng bên dưới,
   * vì chúng không phải link.
   */
  const NAV_STOPS: NavStop[] = [
    { link: 'Bảng điều khiển', path: '/', heading: /^Xin chào/ },
    { link: 'Thiết bị', path: '/devices', heading: /^Thiết bị$/ },
    { link: 'Phần mềm', path: '/software', heading: /^Phần mềm$/ },
    { link: 'Đường truyền', path: '/isp-lines', heading: /^Đường truyền$/ },
    { link: 'Sắp hết hạn', path: '/expiry', heading: /^Sắp hết hạn$/ },
    { link: 'Địa chỉ IP', path: '/ip-addresses', heading: /^Địa chỉ IP$/ },
    { link: 'Sổ NAT', path: '/nat', heading: /^Sổ NAT$/ },
    { link: 'Tài khoản dịch vụ', path: '/service-accounts', heading: /^Tài khoản dịch vụ$/ },
    { link: 'Duyệt yêu cầu', path: '/approvals', heading: /^Duyệt yêu cầu$/ },
    { link: 'Két sắt', path: '/vault', heading: /^Két sắt$/ },
    { link: 'Kho thanh lý', path: '/disposal', heading: /^Kho thanh lý$/ },
    { link: 'Tài khoản', path: '/admin/accounts', heading: /^Tài khoản$/ },
    { link: 'Danh mục', path: '/admin/catalog', heading: /^Danh mục$/ },
    { link: 'Quyền két sắt', path: '/admin/vault-access', heading: /^Quyền xem két sắt$/ },
    { link: 'Bộ giao diện', path: '/dev/components', heading: /^Bộ giao diện$/ },
  ];

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `app-nav.ts` và `App.tsx` là HAI danh sách đường dẫn riêng, chỉ tình cờ gặp nhau ở
   * `PATHS`. Thêm một mục menu mà quên khai `<Route>` (hoặc gác nhầm vai) thì mục đó bấm vào
   * ra trang 404 — và không bài kiểm nào hiện có bắt được, vì mọi bài đều `goto` thẳng URL
   * đúng thay vì bấm menu.
   *
   * ĐỎ KHI: một mục menu trỏ sai đường, một route bị xóa hoặc gác nhầm vai (ra 404), một
   * `<h1>` đổi chữ mà i18n không đổi theo, hoặc hai mục "chưa mở" bỗng thành link bấm được
   * (đưa người dùng vào màn của epic chưa làm).
   */
  test('SA đi hết mọi mục trên thanh điều hướng bằng chuột', async ({ page }) => {
    // 15 lượt điều hướng + một luồng đăng nhập lần đầu: 60 giây mặc định không đủ.
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });

    for (const stop of NAV_STOPS) {
      await nav.getByRole('link', { name: stop.link, exact: true }).click();

      await expect(
        page.getByRole('heading', { level: 1, name: stop.heading }),
        `Bấm menu "${stop.link}" phải mở đúng màn có tiêu đề ${stop.heading}`,
      ).toBeVisible();
      // Trang 404 cũng có <h1>, nên phải nói rõ nó KHÔNG được là trang 404.
      await expect(
        page.getByRole('heading', { name: 'Không tìm thấy trang' }),
        `Menu "${stop.link}" trỏ vào một đường không có route — người dùng nhận trang 404`,
      ).toHaveCount(0);
      expect(
        new URL(page.url()).pathname,
        `Menu "${stop.link}" phải đưa tới ${stop.path}`,
      ).toBe(stop.path);
    }

    /*
     * Hai mục của epic sau: `<span aria-disabled="true" title="…">`, KHÔNG phải `<a>`.
     * Chúng có mặt để bản đồ điều hướng không phải vẽ lại mỗi epic — nhưng có mặt mà bấm
     * được thì tệ hơn không có.
     */
    for (const planned of ['Tài liệu', 'Nhật ký']) {
      await expect(
        nav.getByRole('link', { name: planned, exact: true }),
        `"${planned}" thuộc epic sau — nó KHÔNG được là link bấm được`,
      ).toHaveCount(0);

      const label = nav.getByText(planned, { exact: true });
      await expect(
        label,
        `Mục "${planned}" vẫn phải hiện trong menu (chỗ đã dành sẵn cho epic sau)`,
      ).toBeVisible();

      const host = await label.evaluate((el) => {
        const owner = el.closest('[aria-disabled]');
        return {
          disabled: owner?.getAttribute('aria-disabled') ?? null,
          title: owner?.getAttribute('title') ?? null,
        };
      });
      expect(
        host.disabled,
        `"${planned}" phải mang aria-disabled cho trình đọc màn hình`,
      ).toBe('true');
      expect(
        host.title,
        `"${planned}" phải tự giải thích vì sao bấm không được, không im lặng`,
      ).toBe('Màn hình thuộc epic sau — chưa mở');
    }
  });

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Đây là khoảng trống thật: chưa bài nào đi từ DANH SÁCH sang CHI TIẾT bằng cách bấm rồi
   * quay ra bằng breadcrumb. Cột "Mã thiết bị" cố ý là `<Link>` chứ không phải `onClick` trên
   * `<tr>` (để mở tab mới và chép link được) — nếu ai đó đổi lại thành `onClick`, hoặc
   * `PATHS.device(id)` ghép sai id, thì mọi bài `goto('/devices/<id>')` vẫn xanh y nguyên.
   *
   * Breadcrumb cũng vậy: nó đã GÁNH việc của nút "Về danh sách" đã bị bỏ. Mục đầu tiên mất
   * `to` là trang chi tiết trở thành ngõ cụt, mà không bài nào biết.
   *
   * ĐỎ KHI: ô mã thôi không còn là link, link ghép sai id, breadcrumb mất đường quay ra,
   * hoặc một tab của trang chi tiết không mở được / không sáng lên khi bấm.
   */
  test('SA bấm từ danh sách sang hồ sơ rồi đi hết các tab', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = Date.now().toString().slice(-6);
    const code = `SW-E2E-TOUR-${stamp}`;

    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Thiết bị', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();

    // Tạo qua GIAO DIỆN (không phải API): cửa vào phải là đúng cái người dùng thật bấm.
    await page.getByRole('button', { name: 'Thêm thiết bị' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Mã thiết bị').fill(code);
    await form.getByLabel('Tên thiết bị').fill('Switch của bài đi một vòng');
    await form.getByRole('button', { name: 'Loại' }).click();
    await page.getByRole('option', { name: 'Switch', exact: true }).click();
    await form.getByRole('button', { name: 'Lưu' }).click();

    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row, 'Thiết bị vừa tạo phải xuất hiện ngay trên danh sách').toBeVisible();

    // BẤM vào ô mã — không `goto`. Đây chính là điều bài này sinh ra để kiểm.
    await page.getByRole('main').getByRole('link', { name: code, exact: true }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(code) }),
      'Bấm mã trên danh sách phải mở đúng hồ sơ của máy đó',
    ).toBeVisible();
    expect(
      new URL(page.url()).pathname,
      'Đường dẫn phải là /devices/<id>, không phải một đường ghép sai',
    ).toMatch(/^\/devices\/[0-9a-f-]{36}$/);

    /*
     * Đi hết CÁC TAB ĐANG CÓ, không gõ cứng danh sách: tab "Port map" chỉ hiện với loại
     * thiết bị bật port map, nên chốt cứng năm cái tên là bài kiểm sẽ đỏ vì lý do sai.
     * Đọc thanh tab ra rồi bấm từng cái — nhưng bốn tab LUÔN phải có mặt thì vẫn chốt cứng.
     */
    const tabNames = await page.getByRole('tab').allInnerTexts();
    expect(
      tabNames.length,
      `Hồ sơ thiết bị phải có ít nhất 4 tab, đang thấy: ${tabNames.join(' · ')}`,
    ).toBeGreaterThanOrEqual(4);

    for (const required of [/^Hồ sơ/, /^Giấy tờ/, /^Két sắt/, /^Lịch sử/]) {
      await expect(
        page.getByRole('tab', { name: required }),
        `Thanh tab của hồ sơ thiết bị thiếu đúng một tab khớp ${required}`,
      ).toHaveCount(1);
    }

    /*
     * Đi theo VỊ TRÍ chứ không theo tên đọc được ra: nhãn tab có số đếm nối sau ("Giấy tờ 3"),
     * nên vòng tên-đọc-ra → tên-trợ-năng thêm một chỗ để trượt mà chẳng kiểm được gì thêm.
     */
    for (let i = 0; i < tabNames.length; i += 1) {
      const tab = page.getByRole('tab').nth(i);
      await tab.click();
      await expect(
        tab,
        `Bấm tab "${tabNames[i]}" thì chính nó phải sáng lên (aria-selected)`,
      ).toHaveAttribute('aria-selected', 'true');
      await expect(
        page.getByRole('tabpanel'),
        `Tab "${tabNames[i]}" phải mở ra một vùng nội dung, không phải khoảng trắng`,
      ).toBeVisible();
    }

    // Quay ra bằng BREADCRUMB — đường về duy nhất của trang chi tiết.
    await page
      .getByRole('navigation', { name: 'breadcrumb' })
      .getByRole('link', { name: 'Thiết bị', exact: true })
      .click();

    await expect(
      page.getByRole('heading', { level: 1, name: /^Thiết bị$/ }),
      'Bấm mục đầu của breadcrumb phải quay lại danh sách thiết bị',
    ).toBeVisible();
    expect(new URL(page.url()).pathname, 'Breadcrumb phải trả về đúng /devices').toBe('/devices');
  });

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `dashboard.spec.ts` kiểm rất kỹ SỐ LIỆU của từng khối, nhưng không bấm cái link ở cuối
   * khối lần nào. Mà mỗi khối chỉ vẽ link ấy khi `available && total > 0` — nghĩa là chúng là
   * nhánh code hiếm khi chạy trong test, đúng chỗ một `to={PATHS.…}` gõ sai sống lâu nhất.
   *
   * Bảng điều khiển là màn người dùng mở đầu tiên mỗi sáng. Nếu nó chỉ để NGẮM mà không nhảy
   * đi đâu được thì nó là một tấm ảnh, không phải bàn đạp.
   *
   * ĐỎ KHI: một link "Xem toàn bộ …" trỏ sai màn hoặc trỏ vào 404.
   *
   * Gieo sẵn MỘT hồ sơ sắp hết hạn để khối đầu chắc chắn có link — bài kiểm không được phép
   * xanh vì nó chẳng kiểm gì cả. Ba khối còn lại phụ thuộc dữ liệu sẵn có nên bỏ qua TƯỜNG
   * MINH (kiểm `count()` trước), và cuối bài chốt lại link nào đã thật sự đi qua.
   */
  test('Bảng điều khiển là bàn đạp, không phải ảnh tĩnh', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = Date.now().toString().slice(-6);
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const seeded = await page.request.post('/api/v1/software', {
      headers: await writeHeaders(page),
      data: {
        code: `LIC-E2E-TOUR-${stamp}`,
        name: 'License mồi cho bài đi một vòng',
        kind: 'license',
        endDate: soon,
      },
    });
    expect(
      seeded.ok(),
      'Không gieo được hồ sơ sắp hết hạn thì phần còn lại của bài kiểm vô nghĩa',
    ).toBeTruthy();

    const stops: { label: string; path: string; heading: RegExp }[] = [
      { label: 'Xem toàn bộ danh sách hạn', path: '/expiry', heading: /^Sắp hết hạn$/ },
      { label: 'Xem toàn bộ dải mạng', path: '/ip-addresses', heading: /^Địa chỉ IP$/ },
      { label: 'Xem toàn bộ két sắt', path: '/vault', heading: /^Két sắt$/ },
      { label: 'Xem toàn bộ kho thanh lý', path: '/disposal', heading: /^Kho thanh lý$/ },
    ];

    const walked: string[] = [];
    const skipped: string[] = [];

    for (const stop of stops) {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: /^Xin chào/ })).toBeVisible();
      /*
       * Chờ ĐÚNG cái link chắc chắn có trước khi đếm mấy cái kia: cả bảng dựng từ MỘT lượt
       * gọi `/dashboard`, nên khi link này hiện là dữ liệu đã về hết. Đếm sớm hơn thì khối
       * nào cũng ra "không có dữ liệu" và bài kiểm bỏ qua sạch mà vẫn xanh.
       */
      await expect(
        page.getByRole('main').getByRole('link', { name: stops[0].label, exact: true }),
        'Đã gieo một hồ sơ hết hạn sau 3 ngày — khối "Sắp hết hạn" phải có link xem toàn bộ',
      ).toBeVisible();

      const link = page.getByRole('main').getByRole('link', { name: stop.label, exact: true });
      if ((await link.count()) === 0) {
        // Khối rỗng thì theo thiết kế nó KHÔNG vẽ link — bỏ qua, và nói ra là đã bỏ qua.
        skipped.push(stop.label);
        continue;
      }

      await link.click();
      await expect(
        page.getByRole('heading', { level: 1, name: stop.heading }),
        `Link "${stop.label}" phải mở đúng màn ${stop.path}`,
      ).toBeVisible();
      expect(new URL(page.url()).pathname, `Link "${stop.label}" trỏ sai đường`).toBe(stop.path);
      walked.push(stop.label);
    }

    expect(
      walked,
      `Phải đi được ít nhất link "Xem toàn bộ danh sách hạn" (đã bỏ qua: ${skipped.join(', ') || 'không có khối nào'})`,
    ).toContain(stops[0].label);
  });

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Nút đổi giao diện nằm ở topbar, ngoài mọi màn nghiệp vụ, nên không spec màn nào bấm nó.
   * `toggleTheme()` làm HAI việc: đặt `<html data-theme>` và ghi `localStorage`. Chỉ làm việc
   * đầu thì giao diện đổi ngay trước mắt nhưng mất sạch khi nạp lại — đúng kiểu hỏng người
   * dùng báo là "nó cứ tự sáng lại".
   *
   * ĐỎ KHI: nút không đổi `data-theme`, theme không dính lại sau khi chuyển màn hoặc nạp lại,
   * hoặc nhãn trợ năng của nút không lật theo trạng thái (người dùng bàn phím không biết bấm
   * vào sẽ ra sáng hay tối).
   */
  test('Đổi sáng/tối trên máy bàn và nó dính lại sau khi đổi trang', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    const topbar = page.getByRole('banner');
    const themeOf = () => page.evaluate(() => document.documentElement.dataset.theme ?? '');

    /*
     * Khởi điểm phụ thuộc `prefers-color-scheme` của trình duyệt chạy test, nên đưa về SÁNG
     * trước rồi mới đo. Không có bước này thì bài kiểm xanh/đỏ theo cấu hình máy chứ không
     * theo code.
     */
    if ((await themeOf()) === 'dark') {
      await topbar.getByRole('button', { name: 'Chuyển sang chế độ sáng' }).click();
    }
    expect(await themeOf(), 'Bài kiểm bắt đầu từ giao diện sáng').toBe('light');

    await topbar.getByRole('button', { name: 'Chuyển sang chế độ tối' }).click();
    expect(
      await themeOf(),
      'Bấm nút đổi giao diện phải đặt data-theme="dark" trên <html>',
    ).toBe('dark');
    await expect(
      topbar.getByRole('button', { name: 'Chuyển sang chế độ sáng' }),
      'Đang tối thì nhãn nút phải mời quay về sáng, không được đứng im',
    ).toBeVisible();

    // Đổi màn: theme phải theo người dùng, không theo từng trang.
    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Thiết bị', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();
    expect(await themeOf(), 'Đổi trang xong vẫn phải còn tối').toBe('dark');

    // Và nạp lại cứng cũng vậy — đó mới là chỗ `localStorage` được dùng thật.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();
    expect(
      await themeOf(),
      'Nạp lại trang mà mất theme = toggleTheme không ghi localStorage',
    ).toBe('dark');

    await page.getByRole('banner').getByRole('button', { name: 'Chuyển sang chế độ sáng' }).click();
    expect(await themeOf(), 'Bấm lần nữa phải quay về sáng').toBe('light');
  });

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Mọi bài kiểm hiện có mở hộp thoại bằng `.click()` của Playwright — thứ gọi thẳng sự kiện
   * click, kể cả trên một `<div onClick>` không bao giờ nhận được tiêu điểm bàn phím. Nghĩa
   * là "nút" có thể đã rơi khỏi luồng Tab từ lâu mà không bài nào biết.
   *
   * `ui/dialog.tsx` dựng trên Radix Dialog, và ba lời hứa của nó — tự đưa tiêu điểm VÀO hộp,
   * nhốt tiêu điểm ở đó, Esc đóng rồi TRẢ tiêu điểm về đúng nút đã mở — chưa ai kiểm. Mất lời
   * hứa thứ ba là người dùng bàn phím bị ném về đầu trang sau mỗi lần đóng hộp.
   *
   * ĐỎ KHI: nút "Thêm thiết bị" không tới được bằng Tab, Enter không mở hộp, tiêu điểm không
   * vào trong hộp, Esc không đóng, hoặc đóng xong tiêu điểm rơi mất.
   */
  test('Bàn phím một mình cũng đi được: Tab tới nút, Enter mở, Esc đóng', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Thiết bị', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();

    const addButton = page.getByRole('button', { name: 'Thêm thiết bị' });
    await expect(addButton).toBeVisible();

    /*
     * Gõ Tab cho tới khi tới nút — KHÔNG dùng `.focus()`. Chính việc đi tới được mới là điều
     * cần chứng minh: `.focus()` gọi được trên cả thứ không hề nằm trong luồng Tab.
     * 80 lượt là dư cho sidebar (~15 mục) + chân sidebar + topbar + hàng nút đầu trang.
     */
    let reached = false;
    for (let i = 0; i < 80 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await addButton.evaluate((el) => el === document.activeElement);
    }
    expect(
      reached,
      'Không gõ Tab tới được nút "Thêm thiết bị" — nút đã rơi khỏi luồng bàn phím',
    ).toBe(true);

    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog, 'Enter trên nút phải mở hộp thoại y như bấm chuột').toBeVisible();

    /*
     * Tiêu điểm phải NẰM TRONG hộp. Không chốt đúng phần tử nào: Radix đưa tiêu điểm tới ô
     * nhận được đầu tiên, và thứ tự đó là chuyện nội bộ của khung hộp — chốt cứng vào nút ✕
     * là bài kiểm sẽ đỏ vì một lần đổi bố cục hoàn toàn vô hại.
     */
    const focusInside = await page.evaluate(
      () => document.activeElement?.closest('[role="dialog"]') != null,
    );
    expect(
      focusInside,
      'Mở hộp xong tiêu điểm phải nhảy vào TRONG hộp, không ở lại sau lưng lớp nền mờ',
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog, 'Esc phải đóng hộp "Thêm thiết bị" (lúc này chưa ghi gì)').toHaveCount(0);

    await expect(
      addButton,
      'Đóng hộp xong tiêu điểm phải TRẢ về đúng nút đã mở nó, không rơi về đầu trang',
    ).toBeFocused();
  });
});

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
  async function taoTaiKhoanAdmin(page: Page): Promise<string> {
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
  async function loaiSwitch(page: Page): Promise<string> {
    const res = await page.request.get('/api/v1/catalog');
    expect(res.status(), 'danh mục phải đọc được thì mới tạo được thiết bị').toBe(200);
    const catalog = (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    const type = catalog.deviceTypes.find((item) => item.name === 'Switch');
    expect(type, 'hạt giống phải có loại thiết bị "Switch"').toBeTruthy();
    return type!.id;
  }

  /** Tạo một thiết bị (mã luôn chứa "E2E" để `resetDevices()` dọn được). */
  async function taoThietBi(page: Page, code: string, typeId: string): Promise<string> {
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
     * (0032) — khớp lỏng là trúng hai mục và Playwright từ chối ở chế độ strict.
     */
    await page.getByRole('link', { name: 'Tài khoản', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tài khoản', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Họ tên' }).fill(ADMIN_NAME);
    await form.getByRole('textbox', { name: 'Email' }).fill(ADMIN_EMAIL);
    // `<select>` gốc → vai trợ năng `combobox`; nhãn "Vai trò" gắn qua `htmlFor="acc-role"`.
    await form.getByRole('combobox', { name: 'Vai trò' }).selectOption({ label: 'Quản trị' });
    await form.getByRole('button', { name: 'Lưu' }).click();

    // Mật khẩu tạm hiện ĐÚNG MỘT LẦN — đọc trượt là bài này không đi tiếp được.
    await expect(page.getByText('Mật khẩu tạm')).toBeVisible();
    const matKhauTam = (await page.getByTestId('temp-password').innerText()).trim();
    expect(
      matKhauTam.length,
      'mật khẩu tạm phải đủ dài — đây là thứ duy nhất mở được tài khoản mới',
    ).toBeGreaterThanOrEqual(12);

    // `exact`: nút ✕ của hộp thoại mang nhãn "Đóng hộp thoại", đừng bắt nhầm nó.
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();

    const dong = page.getByRole('row', { name: new RegExp(ADMIN_NAME) });
    await expect(dong).toBeVisible();
    await expect(
      dong.getByText('Quản trị', { exact: true }),
      'dòng vừa tạo phải mang huy hiệu vai Quản trị, không phải Thành viên mặc định',
    ).toBeVisible();

    // Cửa DUY NHẤT để đăng xuất (helpers.logout) — bấm thẳng nút thì lượt POST logout bị hủy
    // giữa đường và phiên cũ sống tiếp.
    await logout(page);

    // ===== Người mới vào làm việc =====
    await firstLogin(page, { email: ADMIN_EMAIL, password: matKhauTam });

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
    await expect(menu.getByRole('link', { name: 'Duyệt yêu cầu', exact: true })).toBeVisible();

    // Phần admin KHÔNG được thấy.
    await expect(
      menu.getByRole('link', { name: 'Tài khoản', exact: true }),
      'quản trị tài khoản là việc của SA — admin không được thấy cửa vào',
    ).toHaveCount(0);
    await expect(
      menu.getByRole('link', { name: 'Bộ giao diện', exact: true }),
      'Bộ giao diện là trang nội bộ của đội phát triển, chỉ SA',
    ).toHaveCount(0);

    /*
     * Hai mục "chưa mở" (Tài liệu · Nhật ký) là `<span aria-disabled="true">`, KHÔNG phải
     * link. Kiểm bằng "không có link mang tên đó" thay vì bám `title` — nếu một ngày ai đó
     * biến chúng thành link trỏ vào hư không, bài này đỏ.
     */
    await expect(
      menu.getByRole('link', { name: 'Tài liệu', exact: true }),
      'màn thuộc epic sau chỉ được hiện mờ, không được là link',
    ).toHaveCount(0);
    await expect(menu.getByRole('link', { name: 'Nhật ký', exact: true })).toHaveCount(0);

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
   * ĐÃ ĐỌC `web/src/App.tsx` (bản 09/09) trước khi viết, và ba route ứng xử KHÁC NHAU:
   *
   *   • `/dev/components` — route chỉ được ĐĂNG KÝ khi `me.role === 'sa'` (App.tsx, khối
   *     `{me.role === 'sa' ? <Route …/> : null}`). Admin gõ URL rơi xuống `*` → 404. Gác thật
   *     ở web.
   *   • `/documents` và `/admin/audit-log` — CHƯA có route nào cả (mục menu còn `planned`),
   *     nên mọi vai đều nhận 404, kể cả SA.
   *   • `/admin/accounts` — **KHÔNG gác vai ở web**. `<Route path={PATHS.adminAccounts}
   *     element={<AccountsScreen me={me} />} />` nằm ngoài mọi điều kiện vai; `app-nav.ts` chỉ
   *     ẩn MỤC MENU (`roles: ['sa']`). Admin gõ thẳng URL thì màn VẪN dựng ra.
   *
   * Hàng rào thật của `/admin/accounts` nằm ở API: `AccountsController` mang `@Roles('sa')`
   * trên MỌI endpoint (AD-9), nên `GET /api/v1/accounts` trả 403 cho admin. Bài này vì thế
   * khẳng định hai thứ, và cả hai đều đáng giá:
   *   1. API là nơi chặn — 403, không phải 200 với danh sách rỗng.
   *   2. Màn PHẢI NÓI RA là nó không tải được (`LoadError`), tuyệt đối không được biến 403
   *      thành "Chưa có dữ liệu". Đây là kiểu hỏng nguy hiểm nhất của màn này: một Quản trị
   *      viên đọc "công ty không có tài khoản nào" và tin là mình vừa kiểm tra xong.
   *
   * ĐỎ KHI: một trong ba route 404 bỗng mở ra cho admin; hoặc `/admin/accounts` nuốt 403
   * thành bảng rỗng; hoặc API nới `@Roles` cho admin mà không ai bàn.
   */
  test('Quản trị viên gõ thẳng URL của SA thì hệ thống nói KHÔNG, chứ không im lặng', async ({
    page,
  }) => {
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);
    const matKhauTam = await taoTaiKhoanAdmin(page);
    await logout(page);

    await firstLogin(page, { email: ADMIN_EMAIL, password: matKhauTam });

    // --- Ba đường trả 404 thật.
    for (const url of ['/dev/components', '/documents', '/admin/audit-log']) {
      await page.goto(url);
      await expect(
        page.getByRole('heading', { name: 'Không tìm thấy trang' }),
        `admin gõ ${url} phải nhận trang 404 tử tế, không phải màn trắng hay redirect câm`,
      ).toBeVisible();
    }

    // --- `/admin/accounts`: màn MỞ (web không gác), API mới là nơi chặn.
    const truoc = await page.request.get('/api/v1/accounts');
    expect(
      truoc.status(),
      'hàng rào thật nằm ở API: @Roles(\'sa\') phải trả 403 cho vai admin',
    ).toBe(403);

    await page.goto('/admin/accounts');
    await expect(
      page.getByRole('heading', { name: 'Tài khoản', exact: true }),
      'ĐÂY LÀ SỰ THẬT, không phải điều mong muốn: route /admin/accounts không gác vai ở web ' +
        '(App.tsx), nên màn vẫn dựng ra cho admin',
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Không tìm thấy trang' }),
      'và nó KHÔNG ra 404 — ai muốn 404 thì phải sửa App.tsx, sửa xong hãy sửa bài này',
    ).toHaveCount(0);

    // Nhưng bảng phải nói ra là nó hỏng, không được hoá thành "không có ai".
    await expect(
      page.getByText('Không tải được dữ liệu.'),
      'API 403 phải hiện thành lỗi tải; nuốt nó thành danh sách rỗng là nói dối người quản trị',
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
    await expect(
      page.getByText('Chưa có dữ liệu'),
      '"chưa có dữ liệu" là câu trả lời cho một câu hỏi đã hỏi được — 403 thì chưa hỏi được',
    ).toHaveCount(0);
  });

  /**
   * ===== BÀI 3 =====
   *
   * Vai admin ĐƯỢC làm trọn việc két sắt: cất · xem · xoay. `vault-panel.tsx` dựng nút theo
   * `isAdmin = role === 'sa' || role === 'admin'`, nhưng cho tới nay chỉ nhánh `sa` từng chạy
   * trong E2E — nhánh `admin` là code chưa ai bấm thử.
   *
   * ĐỎ KHI: admin không thấy nút "Cất secret" hoặc menu Sửa/Xoay/Thu hồi; API chặn nhầm vai
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
    const matKhauTam = await taoTaiKhoanAdmin(page);
    await logout(page);

    const adminTotp = await firstLogin(page, { email: ADMIN_EMAIL, password: matKhauTam });

    const stamp = Date.now().toString().slice(-6);
    const code = `SW-E2E-ADMIN-${stamp}`;
    // Chính việc tạo được thiết bị đã là một khẳng định: vai admin có quyền GHI hồ sơ.
    const deviceId = await taoThietBi(page, code, await loaiSwitch(page));

    const label = `admin web E2E ${stamp}`;
    const giaTriGoc = `Adm1n#Goc#${stamp}`;
    const giaTriMoi = `Adm1n#Moi#${stamp}`;

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText('Chưa cất secret nào')).toBeVisible();

    // --- CẤT.
    await expect(
      page.getByRole('button', { name: 'Cất secret' }),
      'admin phải thấy nút cất secret — vault-panel dựng nút này theo isAdmin',
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cất secret' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill(label);
    await form.getByRole('textbox', { name: 'Tên đăng nhập' }).fill('admin');
    await form.getByRole('textbox', { name: 'Giá trị', exact: true }).fill(giaTriGoc);
    await form.getByRole('button', { name: 'Lưu' }).click();

    const dong = page.getByRole('row', { name: new RegExp(label) });
    await expect(dong).toBeVisible();
    // Bảng CHỈ có metadata (FR-021/FR-026): giá trị không được nằm ở đâu trên trang.
    await expect(
      page.getByText(giaTriGoc),
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
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
    await expect(
      page.getByTestId('secret-value'),
      'sau khi xác thực, admin phải đọc được đúng giá trị đã cất',
    ).toHaveText(giaTriGoc);
    await page.getByRole('button', { name: 'Ẩn ngay' }).click();

    // --- XOAY.
    await rowAction(page, label, 'Xoay');
    const hopXoay = page.getByRole('dialog');
    await hopXoay.getByRole('textbox', { name: 'Giá trị mới' }).fill(giaTriMoi);
    await hopXoay.getByRole('button', { name: 'Xoay' }).click();
    await expect(page.getByText('Đã xoay giá trị.')).toBeVisible();

    // --- XEM LẠI: grace còn hiệu lực nên không bị hỏi mã nữa, và giá trị phải là bản MỚI.
    await page.getByRole('button', { name: 'Xem' }).click();
    await expect(
      page.getByTestId('secret-value'),
      'xoay xong mà lượt xem vẫn trả giá trị cũ thì việc xoay chỉ là hình thức',
    ).toHaveText(giaTriMoi);
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
  test('Quản trị viên xử được phiếu xin quyền — cả từ chối lẫn thu hồi', async ({ page }) => {
    // Ba lượt đăng nhập đầy đủ (SA → Member → admin mới), mỗi lượt một lần chờ mã TOTP mới.
    test.setTimeout(150_000);

    const stamp = Date.now().toString().slice(-6);
    const lyDoA = `E2E xin xem switch A ${stamp}`;
    const lyDoB = `E2E xin xem switch B ${stamp}`;

    // ===== SA: dựng người, dựng máy, mở tầng "cần duyệt" cho Member =====
    await firstLogin(page, E2E_SA);
    const matKhauTam = await taoTaiKhoanAdmin(page);

    const typeId = await loaiSwitch(page);
    const deviceA = await taoThietBi(page, `SW-E2E-DUYET-A-${stamp}`, typeId);
    const deviceB = await taoThietBi(page, `SW-E2E-DUYET-B-${stamp}`, typeId);

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
    await firstLogin(page, E2E_MEMBER);
    const memberHeaders = await writeHeaders(page);
    for (const [ownerId, reason] of [
      [deviceA, lyDoA],
      [deviceB, lyDoB],
    ] as const) {
      const sent = await page.request.post('/api/v1/vault/break-glass', {
        headers: memberHeaders,
        data: { ownerType: 'device', ownerId, reason, hours: 4 },
      });
      expect(sent.status(), `Member phải gửi được phiếu: ${reason}`).toBe(201);
    }
    await logout(page);

    // ===== Quản trị viên: xử phiếu bằng tay =====
    await firstLogin(page, { email: ADMIN_EMAIL, password: matKhauTam });
    await page.goto('/approvals');

    // Ba tab của người duyệt — Member chỉ có một, nên đây cũng là một khẳng định về vai.
    await expect(page.getByRole('tab', { name: /Chờ duyệt/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Nhật ký' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Yêu cầu của tôi' })).toBeVisible();

    await expect(page.getByText(lyDoA)).toBeVisible();
    await expect(page.getByText(lyDoB)).toBeVisible();

    // --- TỪ CHỐI một phiếu. Không đoán thứ tự hai thẻ: bấm cái đầu tiên rồi ĐỌC hộp thoại để
    //     biết mình vừa từ chối phiếu nào.
    await page.getByRole('button', { name: 'Từ chối', exact: true }).first().click();
    const hopTuChoi = page.getByRole('dialog');
    const lyDoBiTuChoi = (
      await hopTuChoi.getByText(/E2E xin xem switch [AB] /).innerText()
    ).trim();
    const lyDoDuocDuyet = lyDoBiTuChoi === lyDoA ? lyDoB : lyDoA;
    await hopTuChoi.getByRole('textbox', { name: 'Ghi chú cho người xin' }).fill('E2E: chưa cần');
    await hopTuChoi.getByRole('button', { name: 'Từ chối', exact: true }).click();
    await expect(page.getByText('Đã từ chối.')).toBeVisible();
    /*
     * CHỜ hàng chờ thật sự rụng mất phiếu vừa từ chối, ĐỪNG bấm tiếp ngay sau toast.
     *
     * Toast hiện ra trong `onSuccess`, còn danh sách chỉ đổi sau khi lượt refetch của
     * `invalidateQueries` về. Ở giữa hai mốc đó màn vẫn còn HAI nút "Duyệt", và
     * `getByRole(...).click()` gặp hai phần tử là ném strict-mode violation NGAY — không
     * chờ lại. Đây là kiểu đỏ chập chờn tệ nhất: nó thắng cuộc đua trên máy nhanh.
     */
    await expect(page.getByText(lyDoBiTuChoi)).toHaveCount(0);

    // --- DUYỆT phiếu còn lại (giờ chỉ còn một, không cần `.first()`), cấp 1 giờ.
    await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
    const hopDuyet = page.getByRole('dialog');
    await hopDuyet.getByRole('textbox', { name: 'Cấp trong bao lâu (giờ)' }).fill('1');
    await hopDuyet.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await expect(page.getByText('Đã duyệt.')).toBeVisible();

    // Hàng chờ phải sạch — cả hai phiếu đã có người quyết.
    await expect(page.getByText('Không có yêu cầu nào đang chờ')).toBeVisible();

    // --- THU HỒI SỚM. Phiếu đã duyệt nằm ở tab Nhật ký; chỉ phiếu còn hiệu lực mới có nút này,
    //     nên trên màn chỉ tồn tại đúng MỘT nút "Thu hồi sớm" (phiếu bị từ chối thì không có).
    await page.getByRole('tab', { name: 'Nhật ký' }).click();
    await expect(page.getByText(lyDoDuocDuyet)).toBeVisible();
    await page.getByRole('button', { name: 'Thu hồi sớm' }).click();
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
      sql(`SELECT state FROM approval WHERE reason = '${lyDoBiTuChoi}'`),
      'phiếu bị bấm Từ chối phải nằm ở state denied',
    ).toBe('denied');
    expect(
      sql(`SELECT state FROM approval WHERE reason = '${lyDoDuocDuyet}'`),
      'phiếu đã duyệt rồi thu hồi sớm phải nằm ở state revoked, không phải approved',
    ).toBe('revoked');
    expect(
      sql(`SELECT decided_by FROM approval WHERE reason = '${lyDoBiTuChoi}'`),
      'người quyết phải là chính Quản trị viên vừa bấm — nhật ký phải chỉ đúng người',
    ).toBe(ADMIN_EMAIL);
  });
});

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
      // Nhóm "Nghiệp vụ" — 10 link + mục "Tài liệu" không phải link (xem dưới).
      'Bảng điều khiển',
      'Thiết bị',
      'Phần mềm',
      'Đường truyền',
      'Sắp hết hạn',
      'Địa chỉ IP',
      'Sổ NAT',
      'Tài khoản dịch vụ',
      'Duyệt yêu cầu',
      'Kho thanh lý',
      // Nhóm "Hệ thống" — đúng MỘT mục.
      'Danh mục',
    ].sort();
    expect(
      seen,
      'Thành viên phải thấy đúng 11 cửa bấm được — thừa một mục là quên gắn `roles`, thiếu một mục là gắn nhầm',
    ).toEqual(expected);

    // Hai nhãn nhóm vẫn phải còn: "Hệ thống" biến mất nghĩa là Danh mục cũng đã rơi mất.
    await expect(nav.getByText('Nghiệp vụ', { exact: true })).toBeVisible();
    await expect(nav.getByText('Hệ thống', { exact: true })).toBeVisible();

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
      nav.getByRole('link', { name: 'Tài khoản', exact: true }),
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
     * epic) nhưng KHÔNG phải link — `<span aria-disabled="true">`. Đây là chỗ dễ hỏng nhất
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

    for (const [path, why] of [
      ['/vault', 'trang tổng Két sắt gác vai ngay ở route'],
      ['/dev/components', 'Bộ giao diện là trang nội bộ, chỉ SA'],
      ['/documents', 'màn Tài liệu thuộc epic sau — chưa có route nào'],
    ] as const) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: 'Không tìm thấy trang' }),
        `${path}: ${why} — gõ thẳng URL cũng chỉ được nhận 404`,
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
    for (const [path, title, mustNotSay] of [
      // Chuỗi thứ ba là câu RỖNG của chính màn đó — thứ tuyệt đối không được hiện ra thay cho
      // một lượt bị từ chối quyền. Mỗi màn một câu khác nhau, nên không gộp làm một được.
      ['/admin/accounts', 'Tài khoản', 'Chưa có dữ liệu'],
      ['/admin/vault-access', 'Quyền xem két sắt', 'Không có tài khoản nào khớp'],
    ] as const) {
      await page.goto(path);

      await expect(
        page.getByRole('heading', { name: 'Không tìm thấy trang' }),
        `${path}: router KHÔNG gác vai ở đây — đừng khẳng định 404 cho một cửa vẫn mở`,
      ).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name: title, exact: true }),
        `${path}: màn vẫn render vì hàng rào nằm ở API, không ở router`,
      ).toBeVisible();

      // Vế quan trọng nhất: lỗi quyền phải NÓI RA LÀ LỖI.
      await expect(
        page.getByText('Không tải được dữ liệu.'),
        `${path}: 403 phải hiện thành khối lỗi + "Thử lại"`,
      ).toBeVisible();
      await expect(
        page.getByText(mustNotSay),
        `${path}: "bị từ chối quyền" mà hoá thành "${mustNotSay}" là hệ thống nói dối`,
      ).toHaveCount(0);
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
   * (nút "Cất secret" hoặc menu ba chấm hiện ra), khi panel im lặng thay vì nói tầng, hoặc
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
      page.getByRole('button', { name: 'Cất secret' }),
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
    await page.getByRole('button', { name: 'Xin quyền xem' }).click();
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
    await expect(page.getByRole('tab', { name: 'Yêu cầu của tôi' })).toBeVisible();
    await expect(
      page.getByRole('tab'),
      'Thành viên chỉ có đúng một tab trên màn duyệt',
    ).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'Chờ duyệt' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Nhật ký' })).toHaveCount(0);

    // Và mở ra là thấy NGAY yêu cầu vừa gửi, không phải đi tìm tab.
    await expect(page.getByText(`switch tour E2E ${stamp} mất kết nối`)).toBeVisible();
  });
});

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
      await page.getByRole('link', { name: 'Tài khoản', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Tài khoản', exact: true })).toBeVisible();

      // Lọc trước rồi mới bấm: danh sách phân trang 20 dòng, và người cần tìm không nhất
      // thiết nằm ở trang đang xem.
      await page.getByRole('searchbox').fill('E2E Thành viên');
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
      // `exact`: nút ✕ của hộp thoại mang nhãn "Đóng hộp thoại", đừng bắt nhầm nó.
      await page.getByRole('button', { name: 'Đóng', exact: true }).click();

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
      await rowAction(page, 'E2E Thành viên', 'Đặt lại 2 lớp');
      await confirmAction(page, 'Đặt lại 2 lớp');

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
   * vẫn đăng nhập bình thường — đúng lớp lỗi mà rà soát 07/09 gọi tên: hệ thống nói một đằng,
   * làm một nẻo.
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
    const stamp = Date.now().toString().slice(-6);

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

    await page.getByRole('link', { name: 'Tài khoản', exact: true }).click();
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
      ).toHaveText('Tài khoản đang bị khóa. Liên hệ SA để mở lại.');
      await expect(
        victimPage.getByRole('heading', { name: 'Cài xác thực 2 lớp' }),
        'không được đi tiếp một bước nào trong luồng đăng nhập',
      ).toHaveCount(0);

      // ===== VÀ MỞ KHÓA LẠI =====
      // Mở khóa KHÔNG hỏi lại (mở khóa không lấy đi gì của ai) — đừng chờ hộp xác nhận ở đây.
      await rowAction(page, fullName, 'Mở khóa');
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
