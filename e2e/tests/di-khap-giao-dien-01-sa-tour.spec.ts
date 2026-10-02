import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  devicesPageButton,
  firstLogin,
  resetDevices,
  isoInDays,
  resetSoftware,
  resetUsers,
  writeHeaders,
  uniqueStamp,
  openNavGroup,
} from './helpers';

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

  /** Bản đồ menu của vai SA — mọi link trong `web/src/shell/app-nav.ts`. */
  const NAV_STOPS: NavStop[] = [
    { link: 'Bảng điều khiển', path: '/', heading: /^Bảng điều khiển$/ },
    { link: 'Thiết bị', path: '/devices', heading: /^Thiết bị$/ },
    { link: 'Phần mềm', path: '/software', heading: /^Phần mềm$/ },
    { link: 'Đường truyền', path: '/isp-lines', heading: /^Đường truyền$/ },
    { link: 'Sắp hết hạn', path: '/expiry', heading: /^Sắp hết hạn$/ },
    { link: 'Địa chỉ IP', path: '/ip-addresses', heading: /^Địa chỉ IP$/ },
    { link: 'Sổ NAT', path: '/nat', heading: /^Sổ NAT$/ },
    { link: 'Tài khoản dịch vụ', path: '/service-accounts', heading: /^Tài khoản dịch vụ$/ },
    { link: 'Duyệt mở két', path: '/approvals', heading: /^Duyệt mở két$/ },
    { link: 'Két sắt', path: '/vault', heading: /^Két sắt$/ },
    { link: 'Kho thanh lý', path: '/disposal', heading: /^Kho thanh lý$/ },
    { link: 'Người dùng IMS', path: '/admin/accounts', heading: /^Người dùng IMS$/ },
    { link: 'Danh mục', path: '/admin/catalog', heading: /^Danh mục$/ },
    { link: 'Quyền két sắt', path: '/admin/vault-access', heading: /^Quyền két sắt$/ },
    { link: 'Nhật ký hệ thống', path: '/admin/audit-log', heading: /^Nhật ký hệ thống$/ },
    { link: 'Tham số hệ thống', path: '/admin/settings', heading: /^Tham số hệ thống$/ },
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
   * `<h1>` đổi chữ mà i18n không đổi theo, hoặc một mục cho màn chưa có quay lại menu.
   */
  test('SA đi hết mọi mục trên thanh điều hướng bằng chuột', async ({ page }) => {
    // 15 lượt điều hướng + một luồng đăng nhập lần đầu: 60 giây mặc định không đủ.
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });

    for (const stop of NAV_STOPS) {
      // Nhóm "Hệ thống" mặc định khép (Q-18); mở lại mỗi chặng vì rời nhóm thì nó không tự mở.
      await openNavGroup(page);
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

    // Màn Tài liệu chưa có — menu không bày chỗ cho nó (Q-18).
    await expect(nav.getByText('Tài liệu', { exact: true }), 'menu chỉ liệt kê màn đã có').toHaveCount(0);
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

    const stamp = uniqueStamp();
    const code = `SW-E2E-TOUR-${stamp}`;

    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Thiết bị', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();

    // Tạo qua GIAO DIỆN (không phải API): cửa vào phải là đúng cái người dùng thật bấm.
    await devicesPageButton(page, 'Thêm thiết bị').click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Mã thiết bị').fill(code);
    await form.getByLabel('Tên thiết bị').fill('Switch của bài đi một vòng');
    await form.getByRole('button', { name: 'Loại' }).click();
    await page.getByRole('option', { name: 'Switch', exact: true }).click();
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();

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

    for (const required of [/^Tổng quan/, /^Giấy tờ/, /^Két sắt/, /^Lịch sử/]) {
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

    const stamp = uniqueStamp();
    const soon = isoInDays(3);
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
      await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();
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
    // Máy để tối mà người chưa chọn vẫn phải thấy sáng: mặc định không theo hệ điều hành (Q-21).
    await page.emulateMedia({ colorScheme: 'dark' });
    await firstLogin(page, E2E_SA);

    const topbar = page.getByRole('banner');
    const themeOf = () => page.evaluate(() => document.documentElement.dataset.theme ?? '');

    expect(await themeOf(), 'Người chưa chọn giao diện phải thấy giao diện sáng').toBe('light');

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
  /**
   * ĐIỂM DỪNG TAB ĐẦU TIÊN LÀ "BỎ QUA MENU" (WCAG 2.4.1).
   *
   * `css/base.css` có luật `.skip-link` — ẩn off-screen, hiện ra khi Tab tới. Không component
   * nào render nó thì luật ấy là CSS chết và người đi bàn phím phải Tab qua trọn sidebar ở MỖI
   * lần đổi trang. Bài "Bàn phím một mình cũng đi được"
   * ngay dưới đây đếm tới 80 lượt Tab để tới được nút đầu trang — đó chính là quãng đường ấy.
   *
   * Phải là một bài RIÊNG, ngay sau một lượt nạp trang: sau khi bấm chuột vào link điều hướng
   * thì tiêu điểm đang nằm ở link đó, nên Tab kế tiếp đi tới phần tử SAU nó chứ không quay về
   * đầu tài liệu — bản gộp vào bài kia đỏ đúng vì lý do này.
   *
   * Kiểm luôn nó ĐI TỚI ĐÂU: một skip-link trỏ vào hư không còn tệ hơn không có.
   */
  test('Tab lần đầu chạm ngay "Bỏ qua menu", và nó trỏ vào vùng nội dung', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/devices');
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();

    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: /Bỏ qua menu/ });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute('href', '#noi-dung');
    // Đích đến phải CÓ THẬT, và phải đúng là vùng nội dung chính.
    await expect(page.getByRole('main')).toHaveAttribute('id', 'noi-dung');
  });

  test('Bàn phím một mình cũng đi được: Tab tới nút, Enter mở, Esc đóng', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Thiết bị', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();

    const addButton = devicesPageButton(page, 'Thêm thiết bị');
    await expect(addButton).toBeVisible();

    /*
     * Gõ Tab cho tới khi tới nút — KHÔNG dùng `.focus()`. Chính việc đi tới được mới là điều
     * cần chứng minh: `.focus()` gọi được trên cả thứ không hề nằm trong luồng Tab.
     * 80 lượt là dư cho sidebar (~12 mục khi "Hệ thống" khép) + chân sidebar + topbar + hàng nút
     * đầu trang.
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
