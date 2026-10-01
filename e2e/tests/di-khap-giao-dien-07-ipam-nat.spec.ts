import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  E2E_SA,
  confirmAction,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetIpam,
  resetUsers,
  rowAction,
  rowActionNames,
  writeHeaders,
} from './helpers';

test.describe('Phòng Địa chỉ IP và phòng Sổ NAT — bên trong có gì', () => {
  test.beforeEach(() => {
    resetUsers();
    resetIpam();
    resetDevices();
    resetCatalog();
  });

  /*
   * ===== VÌ SAO CẢ KHỐI NÀY TỒN TẠI =====
   *
   * Bốn spec cũ (`ipam.spec.ts`, `ipam-nat-redesign.spec.ts`, `nat.spec.ts`,
   * `ip-lifecycle.spec.ts`) kiểm rất kỹ NGHIỆP VỤ của hai màn này: cấp trùng IP bị chặn, dải
   * gõ sai được giải thích tử tế, ba chip port ra ba dòng, hai rule chồng port bị chặn. Nhưng
   * chúng luôn đi vào phòng để LÀM MỘT VIỆC, nên chúng chỉ chạm đúng những tay nắm cần cho
   * việc ấy.
   *
   * Kết quả là cả một lớp hỏng không ai bắt được: một mục biến mất khỏi menu ba chấm, một ô
   * lặng lẽ rơi khỏi hộp thoại, một cột mất khỏi bảng, một nút mọc thêm ra ở đầu trang. Không
   * bài nào đỏ — bài cũ chỉ hỏi "thứ tôi cần có ở đó không", không bao giờ hỏi "trong phòng
   * này CÓ ĐÚNG những gì".
   *
   * Nên mọi khẳng định ở đây là SO TẬP HỢP. Tập hợp bắt được cả thứ THIẾU lẫn thứ THỪA;
   * `toBeVisible()` từng cái thì chỉ bắt được một nửa.
   *
   * ===== HAI CÁI BẪY ĐÃ TRẢ GIÁ =====
   *
   * 1. `allTextContents()` KHÔNG chờ. Nó chụp DOM đúng một lần, ngay lúc gọi. Gọi nó ngay sau
   *    `page.goto()` là chụp một trang chưa vẽ xong và nhận về `[]` — bài đỏ trong khi ảnh
   *    chụp lúc đỏ cho thấy màn hình có ĐÚNG thứ bài kiểm chờ. Nên mọi phép
   *    so tập ở đây đi qua `expect(locator).toHaveText([...])`: nó vẫn so ĐỦ BỘ (mảng, không
   *    phải `toContainText`), nhưng có thử lại cho tới khi trang lắng xuống.
   *
   * 2. MÁY CHẠY TEST KHÔNG CÓ DB TRẮNG. `resetIpam()` chỉ xóa dải có TÊN chứa "E2E"; máy này
   *    còn một dải thật `172.16.15.0/24` tên "TT2" (đã vô hiệu hóa, còn 1 hồ sơ IP mang lịch
   *    sử) nằm ngoài tầm với của nó. Nghĩa là màn Địa chỉ IP KHÔNG BAO GIỜ rỗng, và mọi câu
   *    hỏi kiểu "cả trang có đúng ngần này thứ" phải hoặc đếm phần dữ liệu lạ tại chỗ, hoặc
   *    thu hẹp về đúng thẻ/dòng của chính bài này. Bài kiểm đi mượn dữ liệu của người khác là
   *    bài kiểm sẽ im lặng bỏ đi vào một ngày nào đó.
   */

  /** Thoát ký tự regex — địa chỉ IP và CIDR đầy dấu chấm, để trần là khớp bừa. */
  function esc(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Khẳng định `scope` có ĐÚNG bộ tay nắm mang vai `role` này — không thừa, không thiếu.
   *
   * Hai vế phải đi cùng nhau: `toHaveCount` bắt thứ THỪA ra (một ô mới mọc thêm mà không ai
   * khai), vòng lặp bắt thứ THIẾU đi (một ô rơi khỏi form, và từ đó không ai nhập được nó
   * nữa mà chẳng có gì đỏ lên). Cả hai đều là `expect` nên đều có thử lại.
   */
  async function expectHandles(
    scope: Locator,
    role: 'textbox' | 'button' | 'combobox' | 'checkbox' | 'radio',
    names: (string | RegExp)[],
    what: string,
  ): Promise<void> {
    await expect(
      scope.getByRole(role),
      `${what}: phải có đúng ${names.length} tay nắm vai "${role}" — thừa một cái là có thứ vừa mọc thêm, thiếu một cái là có thứ vừa biến mất`,
    ).toHaveCount(names.length);
    for (const name of names) {
      await expect(
        scope.getByRole(role, { name, exact: true }),
        `${what}: phải có đúng một "${String(name)}" mang vai "${role}"`,
      ).toHaveCount(1);
    }
  }

  /**
   * Như trên, nhưng cho phép MỘT TÊN xuất hiện nhiều lần ("Cấp IP này" có mặt ở mọi ô trống).
   *
   * Dùng khi cần so đủ bộ trên một vùng rộng: tổng số bắt thứ thừa, từng con số bắt thứ thiếu.
   */
  async function expectHandleCounts(
    scope: Locator,
    role: 'button',
    expected: [string | RegExp, number][],
    what: string,
  ): Promise<void> {
    const total = expected.reduce((sum, [, times]) => sum + times, 0);
    await expect(
      scope.getByRole(role),
      `${what}: phải có đúng ${total} nút — thừa một cái là có thứ vừa mọc thêm mà không ai khai`,
    ).toHaveCount(total);
    for (const [name, times] of expected) {
      await expect(
        scope.getByRole(role, { name, exact: true }),
        `${what}: "${String(name)}" phải xuất hiện đúng ${times} lần`,
      ).toHaveCount(times);
    }
  }

  /** Dòng của một địa chỉ trong bảng IP — neo đầu để `.1` không vớ nhầm `.10`. */
  function ipRow(page: Page, address: string): Locator {
    return page.getByRole('row', { name: new RegExp(`^${esc(address)}\\b`) });
  }

  /** Thẻ dải trong cột trái — thu hẹp về ĐÚNG dải của bài này, vì rail còn dải lạ của máy. */
  function subnetCard(page: Page, cidr: string): Locator {
    return page.getByRole('link', { name: new RegExp(esc(cidr)) });
  }

  /**
   * Octet thứ ba cho dải của một bài. Giữ trong khoảng 20–249 (không đụng `.0`/`.255`) và
   * TRÁNH XA `172.16.15.0/24` — dải thật "TT2" nằm sẵn trên máy chạy test; đụng vào là API
   * từ chối vì chồng dải, và bài đỏ ở một chỗ chẳng liên quan gì tới điều nó đang kiểm.
   */
  function octetFor(stamp: string, shift: number): number {
    return (Number(stamp) % 100) + 20 + shift;
  }

  async function createSubnet(
    page: Page,
    cidr: string,
    name: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await page.request.post('/api/v1/ipam/subnets', {
      headers: await writeHeaders(page),
      data: { cidr, name, ...extra },
    });
    expect(res.status(), `dàn cảnh: phải khai được dải ${cidr}`).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  async function createAddress(
    page: Page,
    subnetId: string,
    address: string,
    usedBy: string,
  ): Promise<string> {
    const res = await page.request.post('/api/v1/ipam/addresses', {
      headers: await writeHeaders(page),
      data: { subnetId, address, usedBy },
    });
    expect(res.status(), `dàn cảnh: phải cấp được hồ sơ IP ${address}`).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  interface NatFixture {
    routerId: string;
    routerCode: string;
    internalIp: string;
    siteCode: string;
  }

  /**
   * Dàn cảnh cho phòng NAT: một site, một router, một dải kèm một hồ sơ IP.
   *
   * Site mang mã `E2E-…` vì script dọn lọc site theo `code LIKE 'E2E-%'` — đặt tên khác là
   * để lại rác vĩnh viễn trong danh mục dùng chung.
   */
  async function setUpNat(page: Page, stamp: string, octet: number): Promise<NatFixture> {
    const headers = await writeHeaders(page);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const type = catalog.deviceTypes.find((one) => one.name === 'Firewall');
    if (!type) {
      throw new Error('Danh mục thiếu loại "Firewall" — migration phải gieo sẵn loại này.');
    }

    const siteCode = `E2E-ST${stamp}`;
    const site = await page.request.post('/api/v1/catalog/site', {
      headers,
      data: { code: siteCode, name: `Site phòng NAT E2E ${stamp}` },
    });
    expect(site.status(), 'dàn cảnh: phải khai được site').toBeLessThan(300);

    const routerCode = `RT-E2E-PHONG-${stamp}`;
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: routerCode, name: 'Draytek cổng chính', deviceTypeId: type.id },
    });
    expect(device.status(), 'dàn cảnh: phải khai được router').toBe(201);
    const routerId = ((await device.json()) as { device: { id: string } }).device.id;

    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN NAT E2E ${stamp}`);
    const internalIp = `172.16.${octet}.5`;
    // KHÔNG gắn thiết bị cho hồ sơ IP này: có thiết bị thì hộp Sửa rule mở ra ở nhánh
    // "đã chọn máy đích" (ô IP thành Select), và bài kiểm hộp Sửa bên dưới soi nhánh gõ tay.
    await createAddress(page, subnetId, internalIp, 'Máy chấm công');

    return { routerId, routerCode, internalIp, siteCode };
  }

  /* ===================== PHÒNG ĐỊA CHỈ IP ===================== */

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Cột trái của màn Địa chỉ IP là thứ DUY NHẤT trong hệ thống không phải một bảng: nó là một
   * `<nav>` chứa các thẻ dải, mỗi thẻ có menu ba chấm riêng. Và bộ mục trong menu ấy KHÔNG cố
   * định — `SubnetCard` chọn giữa **Xóa** (dải chưa từng có hồ sơ IP nào) và **Vô hiệu hóa**
   * (dải đã mang lịch sử) theo `addressCount`. Đó là một nhánh nghiệp vụ thật, dựa trên AD-13
   * (`ip_history` chỉ-thêm), nhưng nó chỉ tồn tại trong giao diện.
   *
   * ĐỎ KHI: một nút mọc thêm (hoặc rơi mất) ở bất kỳ đâu trên màn, một thẻ dải mất nút ba
   * chấm (từ đó dải ấy hết sửa được), rail mất `aria-label` (người dùng bàn phím hết đường
   * phân biệt nó với thanh điều hướng chính), hoặc hai nhánh Xóa/Vô hiệu hóa bị gộp lại thành
   * một — lúc đó một dải khai nhầm ba giây trước sẽ không xóa nổi, hoặc tệ hơn, một dải đang
   * mang lịch sử lại bày ra nút Xóa để bấm rồi ăn lỗi.
   */
  test('Phòng Địa chỉ IP: nút đầu trang, rail dải, và menu mỗi thẻ đổi theo dải trống hay dải đã dùng', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 0);
    const emptyCidr = `172.16.${octet}.0/29`;
    const usedCidr = `172.16.${octet + 1}.0/29`;

    const emptyId = await createSubnet(page, emptyCidr, `LAN trống E2E ${stamp}`);
    const usedId = await createSubnet(page, usedCidr, `LAN đã dùng E2E ${stamp}`, { vlan: 30 });
    await createAddress(page, usedId, `172.16.${octet + 1}.1`, 'Chị Lan — Kế toán');

    await page.goto(`/ip-addresses/${emptyId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Địa chỉ IP' })).toBeVisible();

    /* ----- Rail: mỗi thẻ đúng một link + đúng một nút ba chấm ----- */
    const rail = page.getByRole('navigation', { name: 'Danh sách dải mạng' });
    await expect(
      rail,
      'rail phải là một landmark CÓ TÊN RIÊNG — không thì nó lẫn với thanh điều hướng chính',
    ).toBeVisible();
    await expect(rail.getByRole('heading', { level: 2 })).toHaveText(['Dải mạng / VLAN']);
    await expect(
      rail.getByRole('button', { name: `Thao tác với ${emptyCidr}`, exact: true }),
    ).toHaveCount(1);
    await expect(
      rail.getByRole('button', { name: `Thao tác với ${usedCidr}`, exact: true }),
    ).toHaveCount(1);

    /*
     * Số thẻ trong rail do dữ liệu SẴN CÓ của máy quyết định (dải không mang tên "E2E" thì
     * script dọn không đụng tới — máy này còn dải thật "TT2"). Nên đếm nó tại chỗ, rồi mọi
     * thứ CÒN LẠI trong `main` thì bài này biết chính xác và so đủ bộ.
     */
    const cards = await rail.getByRole('link').count();
    expect(cards, 'ít nhất phải có hai thẻ của chính bài này').toBeGreaterThanOrEqual(2);
    /* Ô "Lọc theo site" (Q-20) chỉ mọc khi máy có dải gắn site — dữ liệu của máy, không phải
       của bài, nên đếm tại chỗ như số thẻ. */
    const siteFilter = await rail
      .getByRole('button', { name: 'Lọc theo site', exact: true })
      .count();
    await expect(
      rail.getByRole('button'),
      'mỗi thẻ đúng MỘT nút ba chấm — thẻ nào mất nút là dải đó hết sửa được mà không có gì báo',
    ).toHaveCount(cards + siteFilter);

    /*
     * Cả `main` có ĐÚNG ngần này nút. Dải đang chọn còn trống hoàn toàn (/29 = 6 host) nên
     * phần bảng là con số biết trước: 6 nút "Cấp IP", 2 nút lật trang — cộng nút "Tra" của ô tra
     * IP/máy cấp trang, và ở đầu cột phải "Giấy tờ (n)" (NET-016) + "Cấp IP trống kế tiếp"
     * (NET-007). 3 lựa chọn lọc (dải đang dùng không có chip hồ sơ tắt, Q-15) và cặp "Danh sách
     * | Bản đồ" (NET-006) là radio, đếm riêng ngay dưới.
     */
    await expectHandleCounts(
      page.getByRole('main'),
      'button',
      [
        ['Xuất Excel', 1],
        ['Thêm dải mạng', 1],
        ['Lọc theo site', siteFilter],
        ['Tra', 1],
        [/^Thao tác với /, cards],
        ['Giấy tờ (0)', 1],
        ['Cấp IP trống kế tiếp', 1],
        ['Cấp IP', 6],
        ['Trang trước', 1],
        ['Trang sau', 1],
      ],
      'Màn Địa chỉ IP, dải đang chọn còn trống hoàn toàn',
    );
    // Nút lọc trạng thái và cặp kiểu xem là chọn-một (radio), không phải nút lệnh.
    await expectHandles(
      page.getByRole('main'),
      'radio',
      ['Tất cả 6', 'Đang dùng 0', 'Trống 6', 'Danh sách', 'Bản đồ'],
      'Màn Địa chỉ IP, dải đang chọn còn trống hoàn toàn',
    );

    /*
     * ĐÂY LÀ ĐIỀU BÀI NÀY TỒN TẠI VÌ NÓ.
     *
     * Dải chưa có hồ sơ nào → **Xóa** hẳn được. Dải đã mang lịch sử → chỉ **Vô hiệu hóa**.
     * Hai bộ mục phải KHÁC NHAU; giống nhau là một trong hai nhánh vừa chết.
     */
    expect(
      await rowActionNames(page, emptyCidr),
      'dải chưa có hồ sơ IP nào thì xóa hẳn được — khai nhầm ba giây trước mà phải sống chung với nó mãi là phiền vô lý',
    ).toEqual(['Sửa', 'Xóa']);
    expect(
      await rowActionNames(page, usedCidr),
      'dải đã mang lịch sử thì KHÔNG có "Xóa" — `ip_history` là bảng chỉ-thêm (AD-13), bày nút ra là bày để bấm rồi ăn lỗi',
    ).toEqual(['Sửa', 'Ngừng dùng']);

    /* ----- Hộp "Thêm dải mạng": bên trong có đúng những ô nào ----- */
    await page.getByRole('button', { name: 'Thêm dải mạng' }).first().click();
    const addForm = page.getByRole('dialog', { name: 'Thêm dải mạng' });
    await expect(addForm).toBeVisible();
    await expect(
      addForm.getByRole('heading', { level: 2 }),
      'hộp KHAI MỚI không chia khối — chỉ có đúng tiêu đề hộp',
    ).toHaveText(['Thêm dải mạng']);
    await expectHandles(
      addForm,
      'textbox',
      ['Dải', 'Tên gọi', 'VLAN', 'Gateway', 'Mô tả'],
      'Hộp "Thêm dải mạng"',
    );
    // Site là `Select` → tay nắm của nó là NÚT, không phải ô nhập. Nhầm vai nghĩa là người
    // dùng bàn phím thao tác khác hẳn điều ta tưởng.
    await expectHandles(
      addForm,
      'button',
      ['Đóng hộp thoại', 'Site', 'Hủy', 'Lưu'],
      'Hộp "Thêm dải mạng"',
    );
    await expect(
      addForm.getByRole('combobox'),
      'hộp khai dải KHÔNG có ô gõ-để-lọc nào — có nghĩa là một ô vừa đổi kiểu tay nắm',
    ).toHaveCount(0);
    // Khai MỚI thì chưa có id để gắn giấy tờ, nên khu đính kèm phải chưa hiện.
    await expect(
      addForm.getByRole('button', { name: 'Giải thích: Giấy tờ đính kèm' }),
    ).toHaveCount(0);

    // Lựa chọn của `Select` PORTAL ra ngoài phần thân hộp — bắt ở cấp trang.
    await addForm.getByRole('button', { name: 'Site', exact: true }).click();
    await expect(
      page.getByRole('option', { name: 'Tất cả site (dùng chung)', exact: true }),
      'phải có đường "không gắn site" — không thì mọi dải bị ép thuộc về một site nào đó',
    ).toBeVisible();
    // Esc trong `Select` chỉ đóng menu, KHÔNG được đóng luôn cả hộp thoại.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option', { name: 'Tất cả site (dùng chung)', exact: true })).toHaveCount(0);
    await expect(addForm, 'Esc đóng menu chọn thì hộp thoại phải còn nguyên').toBeVisible();

    await addForm.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(addForm, 'nút ✕ phải đóng được hộp').toHaveCount(0);
  });

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Cột phải trả lời hai câu người ta mở màn này ra để hỏi: "IP này của ai" và "còn chỗ nào
   * trống". Câu thứ hai sống trong nhóm nút lọc `role="group"` mang con số đếm của CẢ dải, và
   * trong những dòng "Trống" có nút "Cấp IP này" ngay tại chỗ.
   *
   * `ipam.spec.ts` đã kiểm rằng lọc ra ĐÚNG dòng. Bài này hỏi câu khác: nhóm lọc có ĐÚNG BA
   * lựa chọn ấy không, bảng có ĐÚNG SÁU cột ấy không, và dòng trống có đúng một nút.
   *
   * ĐỎ KHI: một trạng thái rơi khỏi `SLOT_FILTERS` (từ đó không lọc ra được nữa và cũng không
   * ai đếm), một cột biến mất khỏi bảng, chip hồ sơ đã xóa quay lại dải đang dùng (Q-15: xóa
   * là để nhập lại, không có đường khôi phục trên giao diện), hoặc dòng đã cấp lại mọc ra nút
   * "Cấp IP này" thứ hai.
   */
  test('Pane phải màn Địa chỉ IP: nhóm nút lọc, bảng địa chỉ, ô trống, không chip hồ sơ đã xóa', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 20);
    const cidr = `172.16.${octet}.0/29`;
    const name = `LAN pane E2E ${stamp}`;
    const taken = `172.16.${octet}.1`;
    const free = `172.16.${octet}.2`;

    const subnetId = await createSubnet(page, cidr, name);
    await createAddress(page, subnetId, taken, 'Chị Lan — Kế toán');
    await page.goto(`/ip-addresses/${subnetId}`);

    // Hai tiêu đề cấp hai của cả màn: đầu rail và đầu pane (thẻ dải là LINK, không phải tiêu
    // đề — nên dải lạ của máy không chen vào đây). Nhiều hơn nghĩa là có khối mới mọc ra.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Dải mạng / VLAN',
      `${cidr} — ${name}`,
    ]);

    /* ----- Nhóm nút lọc: đúng ba lựa chọn (Q-02), kèm con số của CẢ dải ----- */
    const filters = page.getByRole('radiogroup', { name: 'Trạng thái' });
    await expect(
      filters.getByRole('radio'),
      '/29 = 6 host; một đã cấp nên còn 5 trống. Con số phải nằm NGAY trên nút, đúng thứ tự SLOT_FILTERS',
    ).toHaveText(['Tất cả 6', 'Đang dùng 1', 'Trống 5']);

    /* ----- Bảng: đúng bảy cột (Site của máy — Q-20) ----- */
    const table = page.getByRole('table');
    await expect(
      table.getByRole('columnheader'),
      'mất một cột ở đây là mất một câu trả lời mà người ta mở màn này ra để tra',
    ).toHaveText([
      'Địa chỉ',
      'Trạng thái',
      'Thiết bị',
      'Site',
      'Người / phòng ban dùng',
      'Ngày cấp',
      'Thao tác',
    ]);
    await expect(table.getByRole('row'), 'một hàng tiêu đề + 6 địa chỉ').toHaveCount(7);

    /* ----- Bấm một lựa chọn thì bảng đổi THẬT, không chỉ đổi màu cái nút ----- */
    await filters.getByRole('radio', { name: /^Trống/ }).click();
    await expect(table.getByRole('row'), 'lọc "Trống" còn 5 dòng + tiêu đề').toHaveCount(6);
    await expect(
      page.getByText('Chị Lan — Kế toán'),
      'lọc "Trống" thì hàng đã cấp phải biến khỏi bảng',
    ).toHaveCount(0);

    await filters.getByRole('radio', { name: /^Đang dùng/ }).click();
    await expect(
      table.getByRole('row'),
      'lọc "Đang dùng" còn đúng một dòng + tiêu đề, chứ không phải bảng cũ đứng im',
    ).toHaveCount(2);

    await filters.getByRole('radio', { name: /^Tất cả/ }).click();
    await expect(table.getByRole('row')).toHaveCount(7);

    /* ----- Ô trống có nút cấp ngay tại chỗ; ô đã cấp thì KHÔNG ----- */
    await expect(
      ipRow(page, free).getByRole('button', { name: 'Cấp IP', exact: true }),
      'ô trống phải cấp được ngay tại dòng — đó là đường ngắn nhất khi đang cắm máy',
    ).toHaveCount(1);
    await expect(
      ipRow(page, taken).getByRole('button', { name: 'Cấp IP', exact: true }),
      'hàng đã có chủ mà vẫn bày nút cấp là mời người ta ghi đè',
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cấp IP', exact: true })).toHaveCount(5);

    /* ----- Phân trang: 50 dòng/trang, và nó nói rõ đang xem tới đâu ----- */
    const pager = page.getByRole('navigation', { name: 'Trang' });
    await expect(pager).toBeVisible();
    await expect(
      pager.getByText(/1–6\s+trên\s+6\s+dòng/),
      'con số này tính trên TOÀN bộ lọc đang chọn, không phải trên trang đang xem',
    ).toBeVisible();
  });

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hộp "Cấp IP" là cửa duy nhất đưa một địa chỉ vào sổ, và nó có bốn ô mang bốn kiểu tay nắm
   * KHÁC NHAU: một giá trị cố định (địa chỉ), hai ô gõ-để-lọc (`Combobox` / `SuggestInput`,
   * đều `role="combobox"` chứ không phải `textbox`), một nút mở lịch (`DatePicker`), và một
   * ô chữ. Nhầm vai ở đây nghĩa là người dùng bàn phím thao tác khác hẳn điều ta tưởng.
   *
   * Và hộp SỬA phải mở ra kèm GIÁ TRỊ CŨ. Form sửa hiện ra trống là kiểu hỏng tệ nhất: người
   * dùng bấm Lưu và ghi đè sạch dữ liệu mà không hề biết.
   *
   * ĐỎ KHI: một ô rơi khỏi form (từ đó không ai nhập được trường ấy nữa), một ô đổi kiểu tay
   * nắm, hộp Sửa mở ra trống, hoặc một trong hai đường đóng hộp (✕ và Esc) chết.
   */
  test('Bên trong hộp "Cấp IP" và hộp "Sửa hồ sơ IP": đủ ô, đúng vai, và mở Sửa phải có giá trị cũ', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 40);
    const cidr = `172.16.${octet}.0/29`;
    const first = `172.16.${octet}.1`;

    const subnetId = await createSubnet(page, cidr, `LAN hộp E2E ${stamp}`);
    await page.goto(`/ip-addresses/${subnetId}`);

    /* ----- Hộp CẤP ----- */
    await ipRow(page, first).getByRole('button', { name: 'Cấp IP', exact: true }).click();
    const assign = page.getByRole('dialog', { name: `Cấp IP — ${first}` });
    await expect(assign).toBeVisible();
    await expect(
      assign.getByText(first, { exact: true }),
      'địa chỉ là giá trị CỐ ĐỊNH trong hộp này — sửa được nó thì nút "Cấp IP này" của dòng mất hết ý nghĩa',
    ).toBeVisible();

    await expectHandles(assign, 'textbox', ['Ghi chú', 'Lý do'], 'Hộp "Cấp IP"');
    // HAI ô gõ-để-lọc, cả hai gọi được tên: "Thiết bị" và "Người / phòng ban dùng".
    await expectHandles(
      assign,
      'combobox',
      ['Thiết bị', 'Người / phòng ban dùng'],
      'Hộp "Cấp IP"',
    );
    // "Ngày cấp" là NÚT mở lịch, không phải ô gõ ngày; nó điền sẵn hôm nay nên có nút "Xóa ngày".
    // Nút chính mang đúng tên việc: "Cấp IP".
    // "Chép Mask": khối "Cấu hình cho máy" — thứ người cắm máy gõ vào card mạng.
    await expectHandles(
      assign,
      'button',
      [/^Ngày cấp/, 'Xóa ngày', 'Đóng hộp thoại', 'Hủy', 'Cấp IP', 'Chép Mask'],
      'Hộp "Cấp IP"',
    );

    // Đường đóng thứ nhất: phím Esc.
    await page.keyboard.press('Escape');
    await expect(assign, 'Esc phải đóng được hộp khi không có lượt ghi nào đang chạy').toHaveCount(
      0,
    );

    // Mở lại và cấp thật — để có một hồ sơ mà soi hộp SỬA.
    await ipRow(page, first).getByRole('button', { name: 'Cấp IP', exact: true }).click();
    const again = page.getByRole('dialog', { name: `Cấp IP — ${first}` });
    await again
      .getByRole('combobox', { name: 'Người / phòng ban dùng', exact: true })
      .fill('Chị Lan — Kế toán');
    await again
      .getByRole('textbox', { name: 'Ghi chú', exact: true })
      .fill(`máy bàn tầng 2 E2E ${stamp}`);
    await again.getByRole('button', { name: 'Cấp IP', exact: true }).click();
    await expect(again).toHaveCount(0);
    await expect(ipRow(page, first).getByText('Chị Lan — Kế toán')).toBeVisible();

    /* ----- Hộp SỬA: cùng bộ ô, nhưng phải mang giá trị cũ ----- */
    await rowAction(page, first, 'Sửa');
    const edit = page.getByRole('dialog', { name: `Sửa hồ sơ ${first}` });
    await expect(edit).toBeVisible();
    await expectHandles(edit, 'textbox', ['Ghi chú'], 'Hộp "Sửa hồ sơ IP"');
    await expect(edit.getByRole('combobox')).toHaveCount(2);
    await expectHandles(
      edit,
      'button',
      // Hồ sơ đã cấp luôn có ngày cấp (hộp Cấp điền sẵn hôm nay), nên có nút "Xóa ngày".
      ['Đóng hộp thoại', /^Ngày cấp/, 'Xóa ngày', 'Hủy', 'Lưu'],
      'Hộp "Sửa hồ sơ IP"',
    );
    await expect(
      edit.getByRole('combobox', { name: 'Người / phòng ban dùng', exact: true }),
      'mở Sửa mà ô trống thì bấm Lưu là xóa sạch chủ cũ, im lặng',
    ).toHaveValue('Chị Lan — Kế toán');
    await expect(edit.getByRole('textbox', { name: 'Ghi chú', exact: true })).toHaveValue(
      `máy bàn tầng 2 E2E ${stamp}`,
    );

    // Đường đóng thứ hai: nút ✕. Và đóng KHÔNG được ghi gì.
    await edit.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(edit).toHaveCount(0);
    await expect(ipRow(page, first).getByText('Chị Lan — Kế toán')).toBeVisible();
  });

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Menu ba chấm của một hồ sơ IP là chỗ DUY NHẤT trên giao diện bày ra máy trạng thái vòng
   * đời: `NEXT_STATUSES` quyết định có những bước nào, và `RowActions` đẩy việc nguy hiểm
   * xuống cuối. Nghĩa là bộ mục ấy phải ĐỔI theo trạng thái của chính hàng đó.
   *
   * `ip-lifecycle.spec.ts` đã kiểm rằng bước sai bị API từ chối. Bài này kiểm phía trước cái
   * hàng rào ấy: nút cho một bước KHÔNG đi được thì đừng vẽ ra, và nút cho bước đi được thì
   * đừng thiếu.
   *
   * ĐỎ KHI: `NEXT_STATUSES` bên web lệch khỏi máy trạng thái bên API (menu bày ra một bước
   * bấm vào là ăn 400), thứ tự "việc nguy hiểm xuống cuối" bị phá (ngón tay rơi vào "Thu hồi"
   * lúc menu vừa bung), hoặc menu đứng im không đổi khi trạng thái đã đổi.
   */
  test('Menu của một hồ sơ IP đổi theo trạng thái, và hộp chuyển trạng thái hỏi đúng thứ cần hỏi', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 60);
    const cidr = `172.16.${octet}.0/29`;
    const address = `172.16.${octet}.3`;

    const subnetId = await createSubnet(page, cidr, `LAN vòng đời E2E ${stamp}`);
    await createAddress(page, subnetId, address, 'Chị Lan — Kế toán');
    await page.goto(`/ip-addresses/${subnetId}`);

    /* ----- Trạng thái 1: ĐANG CẤP ----- */
    await expect(ipRow(page, address).getByText('Đang dùng')).toBeVisible();
    expect(
      await rowActionNames(page, address),
      'từ "Đang dùng" chỉ đi được sang Thu hồi (Q-02); Lịch sử luôn có; Xóa của SA. Thu hồi (cam, Q-19) xếp sau việc thường, Xóa hồ sơ nhập nhầm (xám) xếp CUỐI',
    ).toEqual(['Lịch sử', 'Thu hồi IP', 'Xóa']);
    // Q-18: "Sửa" đứng ngoài menu.
    await expect(ipRow(page, address).getByRole('button', { name: `Sửa ${address}` })).toBeVisible();

    /* ----- Hộp "Thu hồi": KHÔNG hỏi chủ mới — chủ cũ đi khỏi, không ai dọn vào ----- */
    await rowAction(page, address, 'Thu hồi IP');
    const reclaim = page.getByRole('dialog', {
      name: new RegExp(`Thu hồi IP\\s*—\\s*${esc(address)}`),
    });
    await expect(reclaim).toBeVisible();
    await expectHandles(reclaim, 'textbox', ['Lý do'], 'Hộp "Thu hồi"');
    await expect(
      reclaim.getByRole('combobox'),
      'thu hồi KHÔNG cấp cho ai — hỏi "ai dùng" ở đây là một câu hỏi trá hình',
    ).toHaveCount(0);
    await expectHandles(
      reclaim,
      'button',
      ['Đóng hộp thoại', 'Hủy', 'Thu hồi IP'],
      'Hộp "Thu hồi"',
    );
    // Hộp nói IP đang của ai trước khi lấy lại.
    await expect(reclaim.getByText('Đang cấp cho Chị Lan — Kế toán')).toBeVisible();
    await reclaim.getByRole('textbox', { name: 'Lý do', exact: true }).fill('máy đã thanh lý');
    await confirmAction(page, 'Thu hồi IP');
    await expect(reclaim).toHaveCount(0);

    /* ----- Trạng thái 2: TRỐNG — menu phải ĐỔI ----- */
    await expect(ipRow(page, address).getByText('Trống', { exact: true })).toBeVisible();
    expect(
      await rowActionNames(page, address),
      'từ "Trống" KHÔNG còn "Thu hồi"; bước cấp là nút "Cấp IP" ngay trên dòng, và "Sửa" một hồ sơ trống chính là cấp nên không bày riêng',
    ).toEqual(['Lịch sử', 'Xóa']);
    await expect(ipRow(page, address).getByRole('button', { name: /^Sửa / })).toHaveCount(0);

    /* ----- Hồ sơ Trống mở CÙNG hộp "Cấp IP" với ô trống: có ô Thiết bị, ô người dùng mở ra trống ----- */
    await ipRow(page, address).getByRole('button', { name: 'Cấp IP', exact: true }).click();
    const assign = page.getByRole('dialog', {
      name: new RegExp(`Cấp IP\\s*—\\s*${esc(address)}`),
    });
    await expect(assign).toBeVisible();
    await expectHandles(
      assign,
      'combobox',
      ['Thiết bị', 'Người / phòng ban dùng'],
      'Hộp "Cấp IP"',
    );
    await expect(
      assign.getByRole('combobox', { name: 'Người / phòng ban dùng', exact: true }),
      'chủ cũ đã đi khỏi lúc thu hồi — điền sẵn tên họ là hồi sinh một chủ không còn',
    ).toHaveValue('');
    await expectHandles(assign, 'textbox', ['Ghi chú', 'Lý do'], 'Hộp "Cấp IP"');
    await assign.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(assign).toHaveCount(0);
    await expect(ipRow(page, address).getByText('Trống', { exact: true })).toBeVisible();
  });

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hai hộp còn lại của phòng Địa chỉ IP chưa ai kiểm phần RUỘT: hộp "Sửa dải" (phải mang đủ
   * sáu giá trị cũ, cộng khu giấy tờ chỉ mở ra khi đã có id) và hộp "Vô hiệu hóa dải" (một
   * hộp RIÊNG chứ không phải `useConfirm` chung, vì lý do ở đây là dữ liệu bắt buộc đi vào
   * audit).
   *
   * ĐỎ KHI: một ô của hộp Sửa mở ra trống (bấm Lưu là xóa sạch VLAN/gateway/mô tả đang có),
   * khu giấy tờ tuột mất, hoặc hộp Vô hiệu hóa mất ô Lý do và tụt về một câu hỏi có/không —
   * lúc đó sáu tháng sau không ai trả lời được "sao dải này biến mất".
   */
  test('Bên trong hộp "Sửa dải" và hộp "Vô hiệu hóa dải": giá trị cũ phải còn nguyên, lý do vẫn bắt buộc', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 80);
    const cidr = `172.16.${octet}.0/29`;
    const name = `LAN sửa E2E ${stamp}`;
    const gateway = `172.16.${octet}.1`;
    const description = `dải thử của bài E2E ${stamp}`;

    const subnetId = await createSubnet(page, cidr, name, {
      vlan: 42,
      gateway,
      description,
    });
    // Có hồ sơ IP → thẻ dải chuyển sang nhánh "Vô hiệu hóa".
    await createAddress(page, subnetId, `172.16.${octet}.2`, 'Phòng Kỹ thuật');
    await page.goto(`/ip-addresses/${subnetId}`);

    /* ----- Hộp SỬA DẢI ----- */
    await rowAction(page, cidr, 'Sửa');
    const form = page.getByRole('dialog', { name: /^Sửa dải — / });
    await expect(form).toBeVisible();
    await expect(
      form.getByRole('heading', { level: 2 }),
      'hộp sửa dải vẫn là một khối phẳng — khu giấy tờ ở đây không dựng FormSection riêng',
      /* Tiêu đề hộp LÀ một `h2`, nên nó nằm trong danh sách này. Tiêu đề kèm luôn đối
         tượng — một chữ "Sửa dải" không nói được đang sửa dải nào. */
    ).toHaveText([`Sửa dải — ${cidr}`]);

    await expect(form.getByRole('textbox', { name: 'Dải', exact: true })).toHaveValue(cidr);
    await expect(form.getByRole('textbox', { name: 'Tên gọi', exact: true })).toHaveValue(name);
    await expect(
      form.getByRole('textbox', { name: 'VLAN', exact: true }),
      'ô VLAN để trống nghĩa là XÓA số đang có — mở ra trống là một cái bẫy',
    ).toHaveValue('42');
    await expect(form.getByRole('textbox', { name: 'Gateway', exact: true })).toHaveValue(gateway);
    await expect(form.getByRole('textbox', { name: 'Mô tả', exact: true })).toHaveValue(description);
    // Dải đã có hồ sơ IP: CIDR chỉ đọc (API cũng từ chối đổi) — nói trước, không để ăn lỗi.
    await expect(form.getByRole('textbox', { name: 'Dải', exact: true })).toHaveAttribute(
      'readonly',
      '',
    );
    await expect(
      form.getByRole('button', { name: 'Giải thích: Giấy tờ đính kèm' }),
      'giấy tờ của dải ghi thẳng nên KHÔNG nằm trong hộp có nút Hủy — nó ở đầu cột phải',
    ).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Giấy tờ (0)' })).toBeVisible();

    /* ----- Hộp VÔ HIỆU HÓA DẢI ----- */
    await rowAction(page, cidr, 'Ngừng dùng');
    const hide = page.getByRole('dialog', { name: `Ngừng dùng dải ${cidr}` });
    await expect(hide).toBeVisible();
    await expect(
      hide.getByText('Dải vẫn ở danh sách', { exact: false }),
      'phải nói rõ ngừng dùng KHÔNG phải xóa — người dùng đọc "biến mất" là "đã mất"',
    ).toBeVisible();
    await expectHandles(hide, 'textbox', ['Lý do'], 'Hộp "Ngừng dùng dải"');
    await expectHandles(
      hide,
      'button',
      ['Đóng hộp thoại', 'Hủy', 'Ngừng dùng'],
      'Hộp "Ngừng dùng dải"',
    );
    await expect(
      hide.getByRole('textbox', { name: 'Lý do', exact: true }),
      'lý do là DỮ LIỆU BẮT BUỘC, không phải một ô ghi chú — nó đi vào audit',
    ).toHaveAttribute('required');

    await hide.getByRole('button', { name: 'Hủy' }).click();
    await expect(hide).toHaveCount(0);
    /*
     * Hủy là hủy. Thu hẹp về ĐÚNG thẻ của bài này: rail còn dải lạ của máy ("TT2") vốn đã
     * mang sẵn huy hiệu "Đã vô hiệu hóa", nên hỏi cả trang là hỏi nhầm người.
     */
    await expect(
      subnetCard(page, cidr).getByText('Đã ngừng dùng'),
      'bấm Hủy mà dải vẫn bị tắt nghĩa là hộp thoại ghi trước khi hỏi',
    ).toHaveCount(0);
  });

  /* ===================== PHÒNG SỔ NAT ===================== */

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Sổ NAT tồn tại để trả lời ba câu của auditor — **port nào mở, cho ai, vì sao** — nên cả
   * ba phải nằm NGAY TRÊN BẢNG. Một cột rơi mất là cuốn sổ mất một câu trả lời, và không có
   * bài nào đỏ vì mọi bài cũ chỉ đọc đúng ô nó vừa ghi.
   *
   * Bài này cũng chốt lại một điều dễ tưởng nhầm: màn NAT KHÔNG có phân trang (khác màn Địa
   * chỉ IP). Danh sách về trong một lượt và vẽ hết.
   *
   * ĐỎ KHI: một nút mọc thêm ở đầu trang, ô tìm mất `aria-label` (bàn phím và trình đọc màn
   * hình hết đường tới), bộ lọc site không đổi được bảng, một cột rơi khỏi sổ, hoặc menu dòng
   * bày ra việc mà vai đang đăng nhập không được làm.
   */
  test('Phòng Sổ NAT: nút đầu trang, bộ lọc, đủ cột trên bảng và menu của một dòng', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 100);

    /*
     * Sổ NAT thì RỖNG được thật: `resetIpam` gỡ mọi rule gắn với dải/thiết bị E2E, và máy
     * này không có rule nào khác. Nên đây là lúc so được TRỌN BỘ nút của cả màn.
     */
    await page.goto('/nat');
    await expect(page.getByRole('heading', { level: 1, name: 'Sổ NAT' })).toBeVisible();
    await expect(page.getByText('Chưa có luật NAT nào')).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('button'),
      'đầu trang hai nút + ba ô lọc (site · router · giao thức) + ba chip trạng thái + chip port nhạy cảm + ô sắp xếp + nút "Thêm luật NAT" của câu rỗng (Q-19); nút nào khác mọc ra ở đây là thứ không ai khai',
    ).toHaveText([
      'Xuất Excel',
      'Thêm luật NAT',
      'Tất cả site',
      'Mọi router',
      'Mọi giao thức',
      /^Đang mở \d+$/,
      /^Đã ngừng dùng \d+$/,
      /^Đã gỡ \d+$/,
      'Chỉ cổng nhạy cảm',
      'Sắp theo cổng ngoài',
      'Thêm luật NAT',
    ]);
    // Sổ mặc định chỉ bày rule còn hiệu lực: rule đã gỡ phải bật chip mới thấy.
    const chips = page.getByRole('group', { name: 'Lọc theo trạng thái luật' });
    await expect(chips.getByRole('button', { name: /^Đang mở/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.getByRole('button', { name: /^Đã gỡ/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(
      page.getByRole('searchbox', { name: 'Tìm theo cổng, IP, người dùng hoặc lý do…' }),
      'ô tìm phải mang tên trợ năng = chính dòng gợi ý của nó',
    ).toBeVisible();

    const fixture = await setUpNat(page, stamp, octet);
    const rule = await page.request.post('/api/v1/ipam/nat', {
      headers: await writeHeaders(page),
      data: {
        deviceId: fixture.routerId,
        protocol: 'tcp',
        externalPorts: '8080',
        internalIp: fixture.internalIp,
        internalPort: 80,
        usedBy: 'Phòng Nhân sự',
        reason: `chấm công truy cập từ ngoài E2E ${stamp}`,
        enabled: true,
      },
    });
    expect(rule.status(), 'dàn cảnh: phải ghi được một rule NAT').toBeLessThan(300);

    await page.goto('/nat');

    /* ----- Bảng: đủ sáu cột, và ba câu của auditor nằm trên chính bảng ----- */
    const table = page.getByRole('table');
    await expect(
      table.getByRole('columnheader'),
      'mất cột "Mở cho ai" hoặc "Lý do mở" là cuốn sổ mất đúng thứ nó sinh ra để giữ',
      /* "Chuyển tiếp" đọc ngang ngoài → trong; trạng thái là cột riêng, không dính vào số port. */
    ).toHaveText(['Router', 'Chuyển tiếp', 'Mở cho ai', 'Lý do mở', 'Trạng thái', 'Thao tác']);
    const row = page.getByRole('row', { name: new RegExp(esc(fixture.routerCode)) });
    await expect(row.getByText('TCP 8080')).toBeVisible();
    await expect(row.getByText(`${fixture.internalIp}:80`)).toBeVisible();
    await expect(row.getByText('Đang mở', { exact: true })).toBeVisible();

    await expect(
      page.getByRole('navigation', { name: 'Trang' }),
      'sổ NAT có phân trang như mọi danh sách khác — sổ vài trăm rule không đổ một lèo',
    ).toHaveCount(1);

    /* ----- Menu của một dòng ----- */
    expect(
      await rowActionNames(page, 'TCP 8080'),
      'SA gỡ được rule; "Gỡ" là việc lấy đi nên phải xếp CUỐI; Lịch sử và Tắt rule ngay từ bảng; Sửa đứng ngoài (Q-18)',
    ).toEqual(['Lịch sử', 'Ngừng dùng', 'Gỡ']);
    await expect(page.getByRole('button', { name: 'Sửa TCP 8080' })).toBeVisible();

    /* ----- Bộ lọc site: bấm là bảng đổi THẬT ----- */
    await page.getByRole('button', { name: 'Site', exact: true }).click();
    await expect(
      page.getByRole('option').first(),
      'lựa chọn đầu luôn là đường bỏ lọc',
    ).toHaveText('Tất cả site');
    await expect(
      page.getByRole('option', { name: fixture.siteCode, exact: true }),
      'site vừa khai phải có trong danh sách — không thì bộ lọc chỉ bày ra thứ không dùng được',
    ).toHaveCount(1);
    await page.getByRole('option', { name: fixture.siteCode, exact: true }).click();
    // Router của bài này KHÔNG gắn site, nên lọc theo site vừa khai phải ra RỖNG — và câu rỗng
    // nói là LỌC không ra, không phải sổ trống.
    await expect(
      page.getByText('Không có luật nào khớp bộ lọc.'),
      'lọc site mà bảng đứng im nghĩa là tham số không đi tới API',
    ).toBeVisible();
    await expect(page.getByText('Chưa có luật NAT nào')).toHaveCount(0);
  });

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hộp "Thêm luật NAT" là form phức tạp nhất hệ thống: ba khối theo đúng đường đi của một gói
   * tin, một ô cổng dạng CHIP nhận nhiều khoảng, một nhóm giao thức `role="group"`, và HAI
   * đường mở tiếp hộp con ("Thêm thiết bị mới", "Thêm dịch vụ") cho thứ chưa có trong kho.
   *
   * Ba khối ấy không phải trang trí: một dây mười ô xếp dọc làm "Loại thiết bị" — một BỘ LỌC
   * của ô ngay dưới — đứng như thể là dữ liệu của rule.
   *
   * ĐỎ KHI: một khối biến mất, một ô rơi khỏi form, nhóm giao thức mất một lựa chọn (từ đó
   * port UDP âm thầm được ghi thành TCP), chip cổng không bỏ ra được, hộp con mở ra làm hộp
   * CHA đóng theo (mất trắng form đang khai dở), hoặc bấm Lưu với danh sách cổng rỗng mà hộp
   * vẫn đóng.
   */
  test('Bên trong hộp "Thêm rule" NAT: ba khối, chip cổng, nhóm giao thức và hai hộp con', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 120);
    const fixture = await setUpNat(page, stamp, octet);

    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm luật NAT' }).first().click();
    const form = page.getByRole('dialog', { name: 'Thêm luật NAT', exact: true });
    await expect(form).toBeVisible();

    /* ----- BA KHỐI, đúng đường đi của một gói tin ----- */
    await expect(
      form.getByRole('heading', { level: 2 }),
      'vào từ đâu → chuyển tới đâu → vì sao mở. Thêm mới thì chưa có giấy tờ và lịch sử để kể',
    ).toHaveText([
      'Thêm luật NAT',
      'Cổng mở ra ngoài',
      'Chuyển tới máy bên trong',
      'Mở cho ai và vì sao',
    ]);

    /* ----- Đủ ô, đúng vai ----- */
    await expectHandles(
      form,
      'combobox',
      [
        'Router',
        'Lọc dịch vụ cho Cổng ngoài',
        'Lọc dịch vụ cho Cổng trong',
        'Máy đích (được NAT)',
        'Mở cho ai',
      ],
      'Hộp "Thêm luật NAT"',
    );
    await expectHandles(
      form,
      'textbox',
      ['Cổng ngoài', 'Cổng trong', 'IP trong', 'Lý do mở', 'Ghi chú'],
      'Hộp "Thêm luật NAT"',
    );
    /* Dải chip lọc loại dưới ô Router (Q-20): "Tất cả loại" + mỗi loại thiết bị đang dùng —
       danh mục của máy chạy test, nên đọc tại chỗ. */
    const catalog = (await (await page.request.get('/api/v1/catalog')).json()) as {
      deviceTypes: { name: string; active: boolean }[];
    };
    const typeChips = catalog.deviceTypes.filter((type) => type.active).map((type) => type.name);
    await expectHandles(
      form,
      'button',
      /* Ba nút (i) "Giải thích: …" mang lời dặn dài khỏi dưới ô (Q-19) — mất một cái là lời
         dặn đó biến khỏi form. */
      [
        'Tất cả loại',
        ...typeChips,
        'Đóng hộp thoại',
        'Giải thích: Cổng ngoài',
        'Thêm',
        'Giải thích: Máy đích (được NAT)',
        'Giải thích: Ghi chú',
        'Hủy',
        'Lưu',
      ],
      'Hộp "Thêm luật NAT"',
    );
    await expectHandles(form, 'radio', ['TCP', 'UDP', 'TCP + UDP'], 'Hộp "Thêm luật NAT"');
    /*
     * Ô tick "Đang dùng" mang tên là chính nhãn đứng cùng hàng (NET-047); câu "Bỏ tick nếu…"
     * là MÔ TẢ của nó, không phải tên.
     */
    await expectHandles(
      form,
      'checkbox',
      ['Đang dùng'],
      'Hộp "Thêm luật NAT"',
    );
    const enabledBox = form.getByRole('checkbox', { name: 'Đang dùng', exact: true });
    await expect(enabledBox, 'rule khai mới thì mặc định là ĐANG BẬT').toBeChecked();
    await expect(enabledBox).toHaveAccessibleDescription(/^Bỏ tick nếu luật đã tắt/);

    /* ----- Nhóm giao thức: đúng ba lựa chọn, TCP là mặc định ----- */
    const protocols = form.getByRole('radiogroup', { name: 'Giao thức' });
    await expect(
      protocols.getByRole('radio'),
      'mất "TCP + UDP" thì mọi rule VPN phải khai làm hai dòng',
    ).toHaveText(['TCP', 'UDP', 'TCP + UDP']);
    await expect(protocols.getByRole('radio', { name: 'TCP', exact: true })).toBeChecked();

    /* ----- Ô cổng dạng CHIP: thêm, bỏ ra, và nhận cả một DẢI ----- */
    const portInput = form.getByRole('textbox', { name: 'Cổng ngoài', exact: true });
    await portInput.fill('8080');
    await portInput.press('Enter');
    await expect(
      form.getByRole('button', { name: 'Bỏ cổng 8080' }),
      'gõ xong Enter là thành chip — Enter ở đây KHÔNG được gửi cả form đi với danh sách rỗng',
    ).toBeVisible();
    await form.getByRole('button', { name: 'Bỏ cổng 8080' }).click();
    await expect(
      form.getByRole('button', { name: 'Bỏ cổng 8080' }),
      'bấm ✕ là chip biến mất — không thì port đã bỏ vẫn vào sổ',
    ).toHaveCount(0);

    await portInput.fill('8000-8010');
    await portInput.press('Enter');
    await expect(
      form.getByRole('button', { name: 'Bỏ cổng 8000-8010' }),
      'ô này nhận cả một DẢI cổng, không chỉ một số',
    ).toBeVisible();

    /* ----- Hộp con 1: "Thêm thiết bị mới" — hộp CHA phải sống ----- */
    await form.getByRole('combobox', { name: 'Mở cho ai', exact: true }).fill('Phòng Nhân sự');
    await form.getByRole('combobox', { name: 'Router', exact: true }).click();
    await form.getByRole('button', { name: 'Thêm thiết bị mới', exact: true }).click();
    const deviceForm = page.getByRole('dialog', { name: 'Thêm thiết bị' });
    await expect(
      deviceForm,
      'router chưa có trong kho thì khai NGAY tại đây, không bắt thoát ra màn Thiết bị',
    ).toBeVisible();
    await deviceForm.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(deviceForm).toHaveCount(0);

    await expect(form, 'đóng hộp con KHÔNG được kéo theo hộp cha').toBeVisible();
    await expect(
      form.getByRole('button', { name: 'Bỏ cổng 8000-8010' }),
      'và form đang khai dở phải còn nguyên — mất nó là gõ lại từ đầu',
    ).toBeVisible();
    await expect(form.getByRole('combobox', { name: 'Mở cho ai', exact: true })).toHaveValue(
      'Phòng Nhân sự',
    );

    /* ----- Hộp con 2: "Thêm dịch vụ" ----- */
    await form.getByRole('combobox', { name: 'Lọc dịch vụ cho Cổng ngoài', exact: true }).click();
    await form.getByRole('button', { name: 'Thêm dịch vụ', exact: true }).click();
    const serviceForm = page.getByRole('dialog', { name: 'Thêm dịch vụ' });
    await expect(serviceForm).toBeVisible();
    await serviceForm.getByRole('button', { name: 'Hủy' }).click();
    await expect(serviceForm).toHaveCount(0);
    await expect(form).toBeVisible();

    /* ----- Đường hỏng: bấm Lưu khi chưa có cổng nào ----- */
    await form.getByRole('button', { name: 'Bỏ cổng 8000-8010' }).click();
    await form.getByRole('combobox', { name: 'Router', exact: true }).fill(fixture.routerCode);
    await form.getByRole('option', { name: new RegExp(esc(fixture.routerCode)) }).click();
    await form.getByRole('textbox', { name: 'IP trong', exact: true }).fill(fixture.internalIp);
    await form.getByRole('textbox', { name: 'Cổng trong', exact: true }).fill('80');
    // "Mở cho ai" cũng bắt buộc (API từ chối rule không có người dùng) — điền để chỉ còn đúng lỗi port.
    await form.getByRole('combobox', { name: 'Mở cho ai', exact: true }).fill('P. Kỹ thuật');
    await form.getByRole('textbox', { name: 'Lý do mở', exact: true }).fill(`thử E2E ${stamp}`);
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(
      form.getByRole('alert'),
      'một lỗi, một chỗ nói ra — không phải hai câu chồng nhau',
    ).toHaveCount(1);
    await expect(
      form.getByRole('alert'),
      'không có cổng nào thì phải nói ra bằng ĐÚNG câu của vi.ts, chứ không lặng lẽ ghi một dòng rỗng',
    ).toHaveText('Thêm ít nhất một cổng ngoài.');
    await expect(form, 'lỗi thì hộp Ở LẠI — đóng là mất trắng thứ vừa gõ').toBeVisible();

    // Form đã gõ dở: Hủy đi cùng cửa với Esc — hỏi lại trước khi vứt.
    await form.getByRole('button', { name: 'Hủy' }).click();
    await confirmAction(page, 'Bỏ và đóng');
    await expect(form).toHaveCount(0);
    await expect(page.getByText('Chưa có luật NAT nào'), 'bấm Hủy là không ghi gì cả').toBeVisible();
  });

  /**
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hộp SỬA rule là một hộp KHÁC hộp Thêm, dù dùng chung component: nó mở thêm hai khối (giấy
   * tờ và lịch sử), và nó cắt ô cổng về đúng MỘT khoảng — sửa là đổi một dòng đang có, còn
   * tách nó thành ba dòng là chuyện khác hẳn.
   *
   * Và nó phải mang GIÁ TRỊ CŨ. Một form sửa mở ra trống rồi được bấm Lưu là lệnh ghi đè sạch
   * một dòng trong cuốn sổ mà auditor sẽ đọc.
   *
   * ĐỎ KHI: một ô mở ra trống, hai khối giấy tờ/lịch sử tuột mất (từ đó "ai mở port này, ngày
   * nào" lại chỉ tra được bằng SQL), ô cổng vẫn cho thêm khoảng thứ hai ở chế độ sửa, hoặc
   * hộp "Gỡ" tụt về một câu hỏi có/không không kèm lý do.
   */
  test('Bên trong hộp "Sửa rule" và hộp "Gỡ rule": giá trị cũ còn nguyên, cổng chỉ còn một khoảng', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = octetFor(stamp, 130);
    const fixture = await setUpNat(page, stamp, octet);
    const reason = `chấm công truy cập từ ngoài E2E ${stamp}`;

    const rule = await page.request.post('/api/v1/ipam/nat', {
      headers: await writeHeaders(page),
      data: {
        deviceId: fixture.routerId,
        protocol: 'udp',
        externalPorts: '9000-9010',
        internalIp: fixture.internalIp,
        internalPort: 9000,
        usedBy: 'Phòng Nhân sự',
        reason,
        enabled: true,
      },
    });
    expect(rule.status(), 'dàn cảnh: phải ghi được một rule NAT').toBeLessThan(300);

    await page.goto('/nat');
    await rowAction(page, 'UDP 9000-9010', 'Sửa');
    const form = page.getByRole('dialog', { name: /^Sửa luật NAT — / });
    await expect(form).toBeVisible();

    /* ----- Sửa mở thêm khối giấy tờ; lịch sử nằm ở menu ⋮, không nhúng vào hộp Sửa ----- */
    await expect(
      form.getByRole('heading', { level: 2 }),
      'sửa một rule đang có thì mở thêm giấy tờ; lịch sử đã có mục riêng ở menu ⋮',
      /* Tiêu đề hộp LÀ một `h2`, và nó kèm giao thức và cổng. */
    ).toHaveText([
      'Sửa luật NAT — UDP 9000-9010',
      'Cổng mở ra ngoài',
      'Chuyển tới máy bên trong',
      'Mở cho ai và vì sao',
      'Giấy tờ đính kèm',
    ]);

    /* ----- Giá trị cũ ----- */
    await expect(form.getByRole('combobox', { name: 'Router', exact: true })).toHaveValue(
      fixture.routerCode,
    );
    await expect(
      form.getByRole('button', { name: 'Bỏ cổng 9000-9010' }),
      'khoảng cổng đang có phải hiện ra dưới dạng chip, không phải một ô trống',
    ).toBeVisible();
    await expect(form.getByRole('textbox', { name: 'IP trong', exact: true })).toHaveValue(
      fixture.internalIp,
    );
    await expect(form.getByRole('textbox', { name: 'Cổng trong', exact: true })).toHaveValue('9000');
    await expect(form.getByRole('combobox', { name: 'Mở cho ai', exact: true })).toHaveValue(
      'Phòng Nhân sự',
    );
    await expect(form.getByRole('textbox', { name: 'Lý do mở', exact: true })).toHaveValue(reason);
    await expect(form.getByRole('checkbox', { name: 'Đang dùng', exact: true })).toBeChecked();
    await expect(
      form
        .getByRole('radiogroup', { name: 'Giao thức' })
        .getByRole('radio', { name: 'UDP', exact: true }),
      'giao thức cũ phải được giữ — nhảy về TCP là âm thầm đổi nghĩa cả rule',
    ).toBeChecked();

    /* ----- Chế độ sửa: đúng MỘT khoảng, nên ô nhập bị tháo hẳn ----- */
    await expect(
      form.getByRole('textbox', { name: 'Cổng ngoài', exact: true }),
      'đã đủ một khoảng thì ô nhập biến mất — một điều khiển bấm vào mà không xảy ra gì là thứ người dùng sẽ bấm vài lần rồi nghĩ máy hỏng',
    ).toHaveCount(0);
    await expect(
      form.getByText('Đang sửa một dòng nên chỉ giữ một khoảng cổng.', { exact: false }),
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);

    /* ----- Hộp GỠ: vẫn hỏi lý do, không phải một câu có/không ----- */
    await rowAction(page, 'UDP 9000-9010', 'Gỡ');
    const remove = page.getByRole('dialog', { name: 'Gỡ luật NAT UDP 9000-9010' });
    await expect(remove).toBeVisible();
    await expect(
      remove.getByText('vẫn xem lại được', { exact: false }),
    ).toBeVisible();
    await expectHandles(remove, 'textbox', ['Lý do gỡ'], 'Hộp "Gỡ luật NAT"');
    await expectHandles(remove, 'button', ['Đóng hộp thoại', 'Hủy', 'Gỡ'], 'Hộp "Gỡ luật NAT"');
    await expect(
      remove.getByRole('textbox', { name: 'Lý do gỡ', exact: true }),
      '"port này đóng ngày nào, ai đóng, vì sao" sẽ có người hỏi',
    ).toHaveAttribute('required');

    await remove.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(remove).toHaveCount(0);
    await expect(
      page.getByRole('row', { name: new RegExp(esc(fixture.routerCode)) }),
      'đóng hộp Gỡ là không gỡ gì cả',
    ).toBeVisible();
  });
});
