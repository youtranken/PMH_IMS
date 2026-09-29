import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  E2E_SA,
  catalogItem,
  confirmAction,
  firstLogin,
  resetCatalog,
  resetUsers,
  rowAction,
  rowActionNames,
  catalogTab,
  sql,
  timVaChoLoc,
  uniqueStamp,
} from './helpers';

/*
 * ===== VÀO HẲN TRONG PHÒNG: DANH MỤC · TÀI KHOẢN · BỘ GIAO DIỆN =====
 *
 * Mười bốn bài phía trên đi HÀNH LANG: bấm menu, đọc breadcrumb, thử ranh giới vai. Chúng
 * chứng minh được cửa nào mở ra phòng nào, nhưng KHÔNG bước vào trong. Khối này bước vào:
 * phòng có mấy ngăn, mỗi ngăn bảng có cột nào, nút mở hộp thoại tên gì, và mở từng hộp ra
 * xem bên trong có đúng bộ ô nhập không.
 *
 * Vì sao ba phòng này đáng soi kỹ hơn cả:
 *
 *   - `/admin/catalog` là MỘT màn dùng cho BẢY danh mục, và `catalog-form.tsx` là MỘT form
 *     dùng cho bảy loại. Cả bảy chỉ khác nhau ở dữ liệu và ở vài nhánh `if` — nghĩa là một
 *     tab trỏ nhầm entity, hay một nhánh `if` viết thiếu, sẽ bày ô của danh mục này sang
 *     danh mục kia mà màn hình vẫn trông hoàn toàn bình thường. Người dùng sửa "nhà mạng"
 *     và ghi đè lên "nhà cung cấp"; không có gì đỏ lên.
 *   - `/admin/accounts` là nơi SA cầm chìa khóa của mọi người khác. Một mục lặng lẽ biến
 *     khỏi menu ba chấm là một việc SA không làm được nữa vào đúng lúc cần nhất.
 *   - `/dev/components` là nơi DUY NHẤT mọi component dùng chung được vẽ ra một lượt. Một
 *     component vỡ lộ ra ở đây trước khi lộ ra ở màn nghiệp vụ.
 */
test.describe('Phòng Danh mục, Tài khoản và Bộ giao diện — bên trong có gì', () => {
  test.beforeEach(() => {
    resetUsers();
    resetCatalog();
  });

  /**
   * Tên nhãn của một loạt tay nắm, đọc ĐÚNG cách trình đọc màn hình đọc chúng:
   * `aria-label` trước, rồi `<label for=…>`, cuối cùng mới tới chữ in trên nút.
   *
   * Vì sao cần: bài này khẳng định TẬP HỢP ô nhập chứ không phải vài ô tiêu biểu — chỉ so
   * tập hợp mới bắt được ô THỪA ra (nhánh `if` của danh mục khác lọt vào) lẫn ô MẤT ĐI (một
   * trường không bao giờ được nhập nữa). Playwright không có API đọc tên khả truy cập của
   * cả một danh sách, nên đọc bằng đúng thứ tự ưu tiên ấy tại đây.
   *
   * Dấu `*` của `Field` bị bỏ đi: nó mang `aria-hidden`, là chỉ dấu thị giác cho "bắt buộc"
   * chứ không thuộc tên gọi của ô. Cái bắt buộc THẬT nằm ở thuộc tính `required` của input.
   */
  async function tenTayNam(controls: Locator): Promise<string[]> {
    const names = await controls.evaluateAll((nodes) =>
      nodes.map((node) => {
        const el = node as HTMLElement;
        const aria = el.getAttribute('aria-label');
        if (aria) return aria.trim();
        const label = (el as HTMLInputElement).labels?.[0];
        if (label) return (label.textContent ?? '').replace('*', '').replace(/\s+/g, ' ').trim();
        return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      }),
    );
    return names.sort();
  }

  /** So tập hợp thì hai vế phải sắp cùng một kiểu — dùng chung đúng bộ so sánh mặc định. */
  const sapXep = (names: readonly string[]): string[] => [...names].sort();

  /**
   * Nhãn của một ô nhập dựng bởi `Field`, viết dưới dạng regex neo hai đầu.
   *
   * ===== HAI THỨ ĐÃ ĐO ĐƯỢC, KHÔNG PHẢI SUY =====
   *
   * 1. `getByLabel` KHÔNG đọc tên khả truy cập. Nó lấy toàn bộ chữ trong thẻ `<label>`
   *    (`elementText`), và `shouldSkipForTextMatching` chỉ bỏ qua SCRIPT/STYLE/NOSCRIPT/head
   *    — KHÔNG bỏ qua `aria-hidden`. Mà `Field` vẽ dấu sao của ô bắt buộc trong một
   *    `<span aria-hidden="true">`. Nên nhãn đọc ra là "Tên *", và `{ exact: true }` trượt.
   *
   * 2. Khi khớp bằng REGEX, Playwright thử trên chữ THÔ (`elementText.full`), không phải bản
   *    đã chuẩn hóa — chỉ chuỗi mới đi qua `normalizeWhiteSpace`. Mà `Field` luôn vẽ
   *    `{label}{' '}` rồi mới tới dấu sao (hoặc `null`), nên ô KHÔNG bắt buộc có nhãn thô
   *    là "Số U " — thừa một dấu cách ở cuối. `/^Số U( \*)?$/` trượt vì đúng dấu cách đó.
   *
   * Hai điều trên hợp lại giải thích trọn vẹn lượt đỏ đầu tiên: ba ô trượt (Số U · Địa chỉ /
   * ghi chú · Số điện thoại) đều là ô KHÔNG bắt buộc, còn Mã · Tên · Họ tên · Email thì qua.
   *
   * Vì vậy: neo hai đầu, nuốt khoảng trắng ở cả hai phía, dấu sao là tùy chọn. Vẫn chốt đúng
   * MỘT ô — "Mã" không vớ nhầm "Mã nhân viên" — mà không phải nhớ ô nào bắt buộc.
   */
  const nhan = (label: string): RegExp =>
    new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*\\*?\\s*$`);

  /** Bảy ngăn của phòng Danh mục, đúng thứ tự `TAB_KEYS` trong `catalog-screen.tsx`. */
  const TEN_TAB = [
    'Site',
    'Tủ mạng',
    'Loại thiết bị',
    'Nhà cung cấp',
    'Bộ phận',
    'Nhà mạng',
    'Dịch vụ / Port',
  ] as const;

  /** Một ngăn: nhãn nút "Thêm …" và bộ cột của bảng bên trong. */
  interface NganDanhMuc {
    tab: string;
    /** Nhãn nút mở hộp thêm mới — `catalog.add*` trong `vi.ts`, ĐỔI theo tab. */
    nutThem: string;
    /** Toàn bộ `columnheader` của bảng tab đó, đúng thứ tự trái→phải. */
    cot: string[];
    /** Bốn danh mục gốc có sheet trong file mẫu mới được nhập từ Excel. */
    nhapDuocExcel: boolean;
  }

  const BAY_NGAN: NganDanhMuc[] = [
    {
      tab: 'Site',
      nutThem: 'Thêm site',
      cot: ['Mã', 'Tên', 'Địa chỉ / ghi chú', 'Đang dùng ở', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: true,
    },
    {
      tab: 'Tủ mạng',
      nutThem: 'Thêm tủ mạng',
      cot: ['Mã', 'Thuộc site', 'Mô tả', 'Số U', 'Đang dùng ở', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: true,
    },
    {
      tab: 'Loại thiết bị',
      nutThem: 'Thêm loại thiết bị',
      cot: ['Tên', 'Có port map', 'Router/Firewall', 'Mô tả', 'Đang dùng ở', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: true,
    },
    {
      tab: 'Nhà cung cấp',
      nutThem: 'Thêm nhà cung cấp',
      cot: ['Tên', 'Cung cấp gì', 'Điện thoại', 'Email / người liên hệ', 'Đang dùng ở', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: true,
    },
    {
      tab: 'Bộ phận',
      nutThem: 'Thêm bộ phận',
      cot: ['Tên', 'Mô tả', 'Đang dùng ở', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: false,
    },
    {
      tab: 'Nhà mạng',
      nutThem: 'Thêm nhà mạng',
      cot: ['Tên', 'Hotline', 'Email / người liên hệ', 'Đang dùng ở', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: false,
    },
    {
      tab: 'Dịch vụ / Port',
      nutThem: 'Thêm dịch vụ',
      cot: ['Tên', 'Giao thức', 'Port', 'Mô tả', 'Trạng thái', 'Thao tác'],
      nhapDuocExcel: false,
    },
  ];

  /** Đi từ màn nào cũng được về phòng Danh mục bằng đúng cái link người dùng bấm. */
  async function moPhongDanhMuc(page: Page): Promise<void> {
    await page.getByRole('link', { name: 'Danh mục' }).click();
    await expect(page.getByRole('heading', { name: 'Danh mục', exact: true })).toBeVisible();
  }

  /*
   * ===== BÀI 1 — BẢY NGĂN, BẢY BỘ CỘT, BẢY CÁI NÚT KHÁC NHAU =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `catalog-screen.tsx` giữ BA bảng tra song song cho cùng bảy danh mục: `TAB_KEYS` (nhãn
   * tab), `TAB_SUFFIX` (khóa i18n của nút "Thêm …") và `ENTITY_COLUMNS` (cột của bảng). Ba
   * danh sách rời nhau, chỉ khớp nhau bằng lời hứa. Đổi thứ tự một danh sách, hoặc chép một
   * dòng rồi quên sửa hậu tố, là tab này bày dữ liệu của danh mục kia — và vì cả bảy đều là
   * "một bảng mã–tên–trạng thái" nên nhìn bằng mắt KHÔNG phân biệt được.
   *
   * Hậu quả không dừng ở chỗ nhìn nhầm: mọi nút Sửa / Vô hiệu / Xóa trên tab đó gửi lên
   * `/api/v1/catalog/${entity}` theo `entity` đang chọn. Tab lệch = sửa nhầm sang danh mục
   * khác, và bản ghi bị sửa thì không có nút hoàn tác.
   *
   * ĐỎ KHI: mất một tab, thêm một tab, đổi tên tab, nút "Thêm …" không đổi theo tab (hoặc
   * đổi sai chữ), hay bảng của một tab thừa/thiếu/đổi tên một cột.
   *
   * Khẳng định bằng TẬP HỢP ĐẦY ĐỦ (`toHaveText` dạng mảng) chứ không phải `toBeVisible()`
   * từng cái: chỉ so cả mảng mới bắt được cột THỪA ra.
   */
  test('Bảy ngăn của phòng Danh mục: nhãn nút "Thêm …" và bộ cột đổi theo từng tab', async ({
    page,
  }) => {
    // Một luồng đăng nhập lần đầu + bảy lượt đổi tab, mỗi lượt một lượt gọi API.
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    await moPhongDanhMuc(page);

    /*
     * `aria-label` của thanh tab là TIÊU ĐỀ MÀN ("Danh mục") — người dùng trình đọc màn hình
     * nghe "Danh mục, thanh tab" chứ không phải "thanh tab" trống không.
     */
    const thanhTab = page.getByRole('tablist', { name: 'Danh mục' });
    await expect(
      thanhTab.getByRole('tab'),
      'phòng Danh mục phải có ĐÚNG bảy ngăn, đúng tên, đúng thứ tự — thừa hay thiếu một ngăn đều là một danh mục không ai quản',
    ).toHaveText(TEN_TAB.map(catalogTab));

    for (const ngan of BAY_NGAN) {
      await thanhTab.getByRole('tab', { name: catalogTab(ngan.tab) }).click();
      await expect(
        page.getByRole('tabpanel'),
        `bấm ngăn ${ngan.tab} phải mở ra một vùng nội dung`,
      ).toBeVisible();

      /*
       * Lọc theo /^Thêm/ rồi so CẢ MẢNG: khẳng định vừa đúng MỘT nút thêm, vừa đúng chữ trên
       * nó. `toBeVisible()` trên một nhãn cố định sẽ xanh cả khi màn còn sót nút "Thêm site"
       * của tab trước.
       */
      await expect(
        page.getByRole('button', { name: /^Thêm/ }),
        `ngăn ${ngan.tab} phải có đúng một nút thêm và nó phải ghi "${ngan.nutThem}" — nút không đổi theo tab nghĩa là hộp thoại mở ra sẽ ghi vào nhầm danh mục`,
      ).toHaveText([ngan.nutThem]);

      const cot = page.getByRole('table').getByRole('columnheader');
      await expect(
        cot,
        `bảng của ngăn ${ngan.tab} phải có đúng ${ngan.cot.length} cột`,
      ).toHaveCount(ngan.cot.length);
      await expect(
        cot,
        `bộ cột của ngăn ${ngan.tab} sai — tab đang bày dữ liệu của một danh mục khác`,
      ).toHaveText(ngan.cot);
    }
  });

  /*
   * ===== BÀI 2 — MỞ CẢ BẢY HỘP "THÊM …" RA XEM BÊN TRONG =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `catalog-form.tsx` là MỘT form phục vụ BẢY danh mục: mỗi ô nhập nằm sau một nhánh
   * `entity === '…'`. Đó là chỗ dễ hỏng nhất trong cả màn, vì hỏng của nó IM LẶNG:
   *
   *   - thiếu một nhánh → ô biến mất, và trường đó không bao giờ được nhập nữa. Không có
   *     lỗi, không có cảnh báo; chỉ có một cột luôn luôn "—" mà vài tháng sau mới có người
   *     hỏi vì sao;
   *   - thừa một nhánh → ô của danh mục khác lọt vào. `buildBody` không gửi nó lên, nên
   *     người dùng gõ vào một ô rồi bấm Lưu và tin là đã lưu.
   *
   * Cả hai đều không làm đỏ bài kiểm nào hiện có: `catalog.spec.ts` chỉ điền những ô nó cần.
   *
   * ĐỎ KHI: một danh mục thừa hoặc thiếu một ô, một ô đổi nhãn, một ô đổi LOẠI TAY NẮM (ô
   * gõ thành ô chọn — người dùng bàn phím thao tác khác hẳn), hoặc một hộp không đóng được
   * bằng ✕ / Esc.
   *
   * Cả hai đường đóng đều được chạy: ngăn chẵn đóng bằng ✕, ngăn lẻ đóng bằng Esc.
   */
  test('Bên trong bảy hộp "Thêm …" của Danh mục: đủ ô, đúng loại tay nắm, đóng được cả ✕ lẫn Esc', async ({
    page,
  }) => {
    test.setTimeout(150_000);

    /** Bộ tay nắm của một hộp, đọc thẳng từ các nhánh `entity === …` của `catalog-form.tsx`. */
    interface HopThem {
      tab: string;
      tieuDe: string;
      /** `<input class="inp">` — vai `textbox`. */
      oGo: string[];
      /** `Select` dùng chung: tay nắm là BUTTON, không phải `<select>` gốc. */
      oChon: string[];
      /** Công tắc bật/tắt — vai `checkbox`. */
      congTac: string[];
    }

    const HOP: HopThem[] = [
      {
        tab: 'Site',
        tieuDe: 'Thêm site',
        oGo: ['Mã', 'Tên', 'Địa chỉ / ghi chú'],
        oChon: [],
        congTac: [],
      },
      {
        tab: 'Tủ mạng',
        tieuDe: 'Thêm tủ mạng',
        // "Số U" là ô SỐ (1–60) — vai `spinbutton`, không nằm trong bộ ô gõ chữ.
        oGo: ['Mã', 'Mô tả'],
        oChon: ['Thuộc site'],
        congTac: [],
      },
      {
        tab: 'Loại thiết bị',
        tieuDe: 'Thêm loại thiết bị',
        oGo: ['Tên', 'Mô tả'],
        oChon: [],
        congTac: ['Có port map', 'Router/Firewall'],
      },
      {
        tab: 'Nhà cung cấp',
        tieuDe: 'Thêm nhà cung cấp',
        oGo: ['Tên', 'Cung cấp gì', 'Điện thoại', 'Email / người liên hệ'],
        oChon: [],
        congTac: [],
      },
      {
        tab: 'Bộ phận',
        tieuDe: 'Thêm bộ phận',
        oGo: ['Tên', 'Mô tả'],
        oChon: [],
        congTac: [],
      },
      {
        tab: 'Nhà mạng',
        tieuDe: 'Thêm nhà mạng',
        oGo: ['Tên', 'Hotline', 'Email / người liên hệ'],
        oChon: [],
        congTac: [],
      },
      {
        tab: 'Dịch vụ / Port',
        tieuDe: 'Thêm dịch vụ',
        // `catalog.portFrom` = "Từ port", `catalog.portTo` = "Đến port (tuỳ chọn)" — hai ô, một dải.
        oGo: ['Tên', 'Từ port', 'Đến port (tùy chọn)', 'Mô tả'],
        oChon: ['Giao thức'],
        congTac: [],
      },
    ];

    await firstLogin(page, E2E_SA);
    await moPhongDanhMuc(page);

    for (const [index, hop] of HOP.entries()) {
      await page.getByRole('tab', { name: catalogTab(hop.tab) }).click();
      await page.getByRole('button', { name: hop.tieuDe, exact: true }).click();

      const hopThoai = page.getByRole('dialog', { name: hop.tieuDe, exact: true });
      await expect(
        hopThoai,
        `hộp thêm của ${hop.tab} phải mang đúng tiêu đề "${hop.tieuDe}" — tiêu đề là thứ duy nhất nói cho người dùng biết họ đang khai vào danh mục nào`,
      ).toBeVisible();

      expect(
        await tenTayNam(hopThoai.getByRole('textbox')),
        `bộ ô GÕ của hộp ${hop.tieuDe} sai — một nhánh "entity === …" trong catalog-form.tsx thừa hoặc thiếu`,
      ).toEqual(sapXep(hop.oGo));

      /*
       * Nút trong hộp = chân hộp (Hủy · Lưu) + ✕ + tay nắm của mỗi ô chọn. So cả mảng để bắt
       * được nút THỪA — vd một nút "Xóa" lọt vào hộp THÊM MỚI.
       */
      expect(
        await tenTayNam(hopThoai.getByRole('button')),
        `bộ NÚT của hộp ${hop.tieuDe} sai — ô chọn phải là button (Select dùng chung), và chân hộp chỉ được có Hủy + Lưu`,
      ).toEqual(sapXep(['Đóng hộp thoại', 'Hủy', 'Lưu', ...hop.oChon]));

      expect(
        await tenTayNam(hopThoai.getByRole('checkbox')),
        `bộ CÔNG TẮC của hộp ${hop.tieuDe} sai — chỉ Loại thiết bị mới có công tắc "có port map"`,
      ).toEqual(sapXep(hop.congTac));

      // Hai đường đóng đều phải chạy thật: một cái hỏng là người dùng kẹt trong hộp.
      if (index % 2 === 0) {
        await hopThoai.getByRole('button', { name: 'Đóng hộp thoại' }).click();
      } else {
        await page.keyboard.press('Escape');
      }
      await expect(
        page.getByRole('dialog'),
        `hộp ${hop.tieuDe} phải đóng được bằng ${index % 2 === 0 ? 'nút ✕' : 'phím Esc'}`,
      ).toHaveCount(0);
    }
  });

  /*
   * ===== BÀI 3 — HỘP DANH MỤC PHẢI BIẾT NÓI KHÔNG, VÀ NÓI Ở ĐÚNG CHỖ =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hai lời từ chối dưới đây do CHÍNH form tự phán (`buildBody` trả về một chuỗi), chưa hề
   * chạm tới API. Chúng không nằm trong `vi.ts` mà viết thẳng trong `catalog-form.tsx`, nên
   * không có bài kiểm i18n nào che được chúng, và cũng không có bài kiểm API nào đi qua
   * chúng.
   *
   * Kiểu hỏng cần chặn: `save.mutate` được gọi TRƯỚC khi kiểm, hoặc lỗi được báo bằng toast
   * rồi hộp tự đóng. Cả hai đều làm người dùng mất trắng những gì vừa gõ, và với trường hợp
   * "quên chọn site" thì bản ghi còn có thể đã kịp bay lên server.
   *
   * ĐỎ KHI: bấm Lưu lúc thiếu site mà hộp vẫn đóng, lời từ chối không nằm trong
   * `role="alert"` (trình đọc màn hình không đọc lên), hoặc số U ngoài khoảng 1–60 lọt qua.
   *
   * `catalog.spec.ts` đã kiểm đường hỏng của DẢI PORT — bài này cố ý đi hai lời từ chối khác
   * để không kiểm lại cùng một thứ.
   */
  test('Hộp Tủ mạng từ chối lưu khi thiếu site hoặc số U sai, và hộp KHÔNG đóng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    // Ô "Thuộc site" cần ít nhất một site; máy chủ mới dựng thì danh mục còn trắng.
    await catalogItem(page, 'site', { code: `S-E2E-TU-${uniqueStamp()}`, name: 'Site E2E hộp tủ' });
    await moPhongDanhMuc(page);

    await page.getByRole('tab', { name: catalogTab('Tủ mạng') }).click();
    await page.getByRole('button', { name: 'Thêm tủ mạng', exact: true }).click();

    const hop = page.getByRole('dialog', { name: 'Thêm tủ mạng', exact: true });
    await expect(hop).toBeVisible();

    /*
     * Mã phải có thật: không điền thì form báo thiếu Mã cùng lúc, và bài này thành ra kiểm hai
     * lỗi thay vì một. KHÔNG bao giờ bấm Lưu thành công nên bản ghi này không rơi vào DB.
     */
    await hop.getByLabel(nhan('Mã')).fill('E2E-KHONG-LUU');
    await hop.getByRole('button', { name: 'Lưu' }).click();

    await expect(
      hop.getByRole('alert'),
      'quên chọn site mà hộp im lặng thì người dùng bấm Lưu mãi không hiểu vì sao không xong',
    ).toHaveText('Chọn site cho tủ này.');
    await expect(
      hop,
      'hộp phải Ở LẠI cùng những gì vừa gõ — đóng đi là bắt gõ lại từ đầu',
    ).toBeVisible();

    // Chọn site thật rồi mới tới lời từ chối thứ hai. Option của `Select` được vẽ ra NGOÀI
    // locator của hộp thoại nên phải tìm từ `page`.
    await hop.getByRole('button', { name: 'Thuộc site' }).click();
    const luaChonSite = page.getByRole('option');
    await expect(
      luaChonSite.first(),
      'ô "Thuộc site" phải có ít nhất một lựa chọn — rỗng thì không ai khai được tủ mạng nào',
    ).toBeVisible();
    await luaChonSite.first().click();

    await hop.getByLabel(nhan('Số U')).fill('99');
    await hop.getByRole('button', { name: 'Lưu' }).click();
    await expect(
      hop.getByRole('alert'),
      'số U ngoài khoảng phải bị chặn TẠI FORM — để nó bay lên API là đổi một câu tiếng Việt rõ ràng lấy một lỗi 400',
    ).toHaveText('Số U phải là số nguyên từ 1 đến 60.');
    await expect(hop).toBeVisible();

    /* Form đã gõ dở, nên lối đóng TÌNH CỜ phải hỏi lại trước (`Dialog guardUnsaved`) — trả
       lời xong mới đóng. */
    await page.keyboard.press('Escape');
    await confirmAction(page, 'Bỏ và đóng');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  /*
   * ===== BÀI 4 — MỘT SITE ĐI TỪ LÚC SINH RA TỚI LÚC BỊ XÓA =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Menu ba chấm của Danh mục ĐỔI theo trạng thái hồ sơ: đang dùng thì mục giữa là "Ngừng
   * dùng", đã ngừng dùng thì là "Dùng lại". Kiểm đúng MỘT trạng thái là để lọt nguyên một nửa:
   * một hồ sơ đã ngừng dùng mà menu vẫn ghi "Ngừng dùng" thì không ai dùng lại được nó nữa, và
   * không có đường nào khác trong giao diện để làm việc đó.
   *
   * Bài này cũng chốt hai thứ mà `catalog.spec.ts` chưa chốt:
   *   - hộp SỬA phải MANG THEO giá trị cũ. Form sửa hiện ra trống là kiểu hỏng tệ nhất của
   *     màn nhập liệu: người dùng sửa một ô rồi bấm Lưu, và ba ô kia bị ghi đè thành rỗng;
   *   - site vừa khai phải xuất hiện NGAY trong ô "Thuộc site" của hộp Tủ mạng — hai màn ăn
   *     chung một `queryKey`, quên `invalidateQueries` là người dùng phải tải lại trang mới
   *     thấy thứ mình vừa tạo.
   *
   * ĐỎ KHI: menu không đổi theo trạng thái, menu thừa/thiếu một mục, hộp Sửa mở ra trống,
   * hoặc danh mục vừa tạo không tới được ô chọn của màn khác.
   */
  test('Menu dòng của Danh mục đổi theo trạng thái, hộp Sửa nhớ giá trị cũ, và site mới tới ngay ô "Thuộc site"', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    await moPhongDanhMuc(page);

    /*
     * Mã sinh theo thời gian và BẮT ĐẦU BẰNG `E2E-`: đó là mẫu `resetCatalog()` dùng để dọn.
     * Mã cố định sẽ đụng bản ghi của lần chạy trước; mã sai mẫu thì ở lại DB vĩnh viễn.
     */
    const stamp = uniqueStamp();
    const maSite = `E2E-${stamp}`;
    const tenSite = `Site soi phòng ${stamp}`;
    const diaChi = `Tầng ${stamp}, tòa E2E`;

    await page.getByRole('button', { name: 'Thêm site', exact: true }).click();
    const hopThem = page.getByRole('dialog', { name: 'Thêm site', exact: true });
    await hopThem.getByLabel(nhan('Mã')).fill(maSite);
    await hopThem.getByLabel(nhan('Tên')).fill(tenSite);
    await hopThem.getByLabel(nhan('Địa chỉ / ghi chú')).fill(diaChi);
    await hopThem.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Lọc trước rồi mới tìm dòng: bảng phân trang 20 dòng, site mới không chắc nằm ở trang 1.
    await page.getByRole('searchbox').fill(maSite);
    const dongSite = page.getByRole('row', { name: new RegExp(maSite) });
    await expect(dongSite, 'site vừa khai phải hiện ra trong bảng').toBeVisible();
    await expect(dongSite.getByText('Đang dùng')).toBeVisible();

    /*
     * `RowActions` xếp việc NGUY HIỂM xuống cuối, luôn luôn — đó là một lời hứa có ghi trong
     * `row-actions.tsx`, nên khẳng định cả THỨ TỰ chứ không chỉ tập hợp.
     */
    expect(
      await rowActionNames(page, maSite),
      'menu của một hồ sơ ĐANG DÙNG: việc thường trước, Ngừng dùng (cảnh báo) rồi Xóa xếp cuối',
    ).toEqual(['Sửa', 'Lịch sử', 'Xem thiết bị dùng mục này', 'Nhật ký thao tác', 'Ngừng dùng', 'Xóa']);

    // --- Hộp SỬA phải mang theo cả ba giá trị cũ.
    await rowAction(page, maSite, 'Sửa');
    const hopSua = page.getByRole('dialog', { name: /^Sửa — / });
    await expect(hopSua).toBeVisible();
    // Mã là khoá tra cứu: ở hộp Sửa nó khoá sẵn, phải bấm "Đổi mã…" mới gõ được.
    await expect(hopSua.getByText(maSite, { exact: true })).toBeVisible();
    await hopSua.getByRole('button', { name: 'Đổi mã…' }).click();
    await expect(
      hopSua.getByLabel(nhan('Mã')),
      'ô Mã trong hộp Sửa mở ra trống là ghi đè sạch dữ liệu ngay khi bấm Lưu',
    ).toHaveValue(maSite);
    await expect(hopSua.getByLabel(nhan('Tên'))).toHaveValue(tenSite);
    await expect(hopSua.getByLabel(nhan('Địa chỉ / ghi chú'))).toHaveValue(diaChi);
    await hopSua.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // --- Site vừa khai phải có mặt trong ô chọn của hộp Tủ mạng, không cần tải lại trang.
    await page.getByRole('tab', { name: catalogTab('Tủ mạng') }).click();
    await page.getByRole('button', { name: 'Thêm tủ mạng', exact: true }).click();
    const hopTu = page.getByRole('dialog', { name: 'Thêm tủ mạng', exact: true });
    await hopTu.getByRole('button', { name: 'Thuộc site' }).click();
    await expect(
      page.getByRole('option', { name: new RegExp(maSite) }),
      'site vừa khai chưa tới được ô chọn — hai màn ăn chung queryKey mà thiếu một lượt làm mới',
    ).toBeVisible();
    await page.keyboard.press('Escape'); // đóng danh sách lựa chọn
    await hopTu.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // --- Ngừng dùng rồi mở lại menu: mục giữa phải ĐỔI CHỮ.
    await page.getByRole('tab', { name: catalogTab('Site') }).click();
    await page.getByRole('searchbox').fill(maSite);
    await expect(dongSite).toBeVisible();

    await rowAction(page, maSite, 'Ngừng dùng');
    await confirmAction(page, 'Ngừng dùng');
    await expect(
      dongSite.getByText('Đã ngừng dùng'),
      'ngừng dùng xong bảng phải nói ra điều đó — không thì SA bấm lại lần nữa',
    ).toBeVisible();

    expect(
      await rowActionNames(page, maSite),
      'hồ sơ ĐÃ NGỪNG DÙNG mà menu vẫn ghi "Ngừng dùng" thì không còn đường nào dùng lại nó',
    ).toEqual(['Sửa', 'Lịch sử', 'Xem thiết bị dùng mục này', 'Nhật ký thao tác', 'Dùng lại', 'Xóa']);

    // Dọn ngay trong bài, không đợi `resetCatalog()` của lần chạy sau.
    await rowAction(page, maSite, 'Xóa');
    await confirmAction(page, 'Xóa');
    await expect(dongSite, 'site kiểm thử phải biến khỏi bảng sau khi xóa').toHaveCount(0);
  });

  /*
   * ===== BÀI 5 — ĐƯỜNG NHẬP EXCEL: NÓ CHỈ ĐƯỢC CÓ MẶT Ở NƠI NÓ CHẠY ĐƯỢC =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * File mẫu chỉ có sheet cho BỐN danh mục gốc. Nếu "Tải file mẫu" / "Nhập từ Excel" hiện ra
   * ở ba danh mục sinh sau (Bộ phận · Nhà mạng · Dịch vụ) thì đó là một lời hứa hão: người
   * dùng tải mẫu về, không tìm thấy sheet của mình, và đi hỏi. Ngược lại, nút biến mất khỏi
   * bốn danh mục gốc thì đường nhập hàng loạt coi như không còn.
   *
   * Bên trong hộp, ba bước là một dây chuyền có KHÓA: chưa chọn file thì không đối chiếu
   * được, chưa đối chiếu thì không ghi được. Khóa ấy chính là thứ giữ cho không ai bấm "Xác
   * nhận ghi" khi chưa hề nhìn bảng đối chiếu — mà `ImportDialog` dùng chung cho cả import
   * thiết bị, nên gỡ nhầm một `disabled` là hỏng cả hai màn.
   *
   * ĐỎ KHI: nút import mọc ở danh mục không có sheet, biến mất ở danh mục có sheet, chân hộp
   * đổi bộ nút, hoặc một trong hai khóa bị gỡ.
   *
   * `catalog.spec.ts` đã đi TRỌN đường nhập (tải mẫu → nhập lại → đối chiếu "không đổi"), nên
   * bài này chỉ soi hình dạng của hộp, không nhập lại lần nữa.
   */
  test('Nút "Tải file mẫu" · "Nhập từ Excel" chỉ có ở danh mục có sheet, và hộp nhập có ba bước khóa nhau', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await moPhongDanhMuc(page);

    for (const ngan of BAY_NGAN) {
      await page.getByRole('tab', { name: catalogTab(ngan.tab) }).click();
      const soNut = ngan.nhapDuocExcel ? 1 : 0;
      // File mẫu nằm TRONG hộp nhập, không bao giờ ở đầu trang.
      await expect(
        page.getByRole('button', { name: /Tải file mẫu/ }),
        `ngăn ${ngan.tab}: đầu trang KHÔNG có nút tải file mẫu — nó nằm trong hộp nhập`,
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Nhập từ Excel' }),
        `ngăn ${ngan.tab} ${ngan.nhapDuocExcel ? 'phải có' : 'KHÔNG được có'} nút nhập từ Excel`,
      ).toHaveCount(soNut);
    }

    // --- Bên trong hộp nhập, ở bước MỘT (chưa chọn file).
    await page.getByRole('tab', { name: catalogTab('Site') }).click();
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();

    const hop = page.getByRole('dialog', {
      name: 'Nhập danh mục từ Excel',
      exact: true,
    });
    await expect(hop).toBeVisible();
    await expect(
      hop.getByRole('button', { name: /Tải file mẫu/ }),
      'file mẫu phải nằm ngay trong hộp nhập — bước con của việc nhập',
    ).toBeVisible();
    await expect(
      hop.getByText('Chọn file .xlsx', { exact: true }),
      'hộp nhập phải có chỗ chọn file — không thì ba cái nút ở chân chẳng để làm gì',
    ).toBeVisible();
    await expect(
      hop.getByText(/File có 4 sheet: Site, Tủ mạng, Loại thiết bị, Nhà cung cấp/),
      'lời dặn dùng đúng file mẫu phải đứng ngay cạnh ô chọn file, chỗ người ta đang nhìn',
    ).toBeVisible();

    const chanHop = page.getByTestId('dialog-footer');
    await expect(
      chanHop.getByRole('button'),
      'chân hộp nhập phải đúng ba nút theo đúng thứ tự Hủy → Đối chiếu → Xác nhận ghi',
    ).toHaveText(['Hủy', 'Đối chiếu', 'Xác nhận ghi']);

    await expect(
      chanHop.getByRole('button', { name: 'Đối chiếu' }),
      'chưa chọn file mà đối chiếu được là gửi một request rỗng lên server',
    ).toBeDisabled();
    await expect(
      chanHop.getByRole('button', { name: 'Xác nhận ghi' }),
      'chưa đối chiếu mà ghi được là bỏ qua đúng bước sinh ra để người dùng nhìn trước khi ghi',
    ).toBeDisabled();
    await expect(
      chanHop.getByRole('button', { name: 'Hủy' }),
      'nút Hủy phải luôn bấm được — đó là đường thoát',
    ).toBeEnabled();

    await hop.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  /*
   * ===== BÀI 6 — PHÒNG TÀI KHOẢN: NÚT, CỘT, MENU NĂM VIỆC, VÀ HỘP PHIÊN =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Menu ba chấm của màn Tài khoản gánh NĂM việc — nhiều nhất hệ thống. Bốn trong năm việc
   * là thứ vài tháng mới dùng một lần (đá phiên, đặt lại mật khẩu, đặt lại 2 lớp, khóa), tức
   * là nếu một mục lặng lẽ rơi khỏi `items` thì phải mất vài tháng mới có người phát hiện —
   * và người phát hiện là một SA đang cần dùng nó gấp.
   *
   * Hộp "Phiên đang mở" thì có một cái bẫy riêng, đã ghi trong `accounts-screen.tsx`: nhánh
   * hỏng của nó dễ nói "Chưa có dữ liệu" khi API 500. Bài này chốt rằng bên trong hộp có
   * BẢNG THẬT với đủ bốn cột và có nút đá phiên — tức là nó đã hỏi được và đã trả lời.
   *
   * ĐỎ KHI: mất nút "Thêm tài khoản", bảng thừa/thiếu/đổi tên một cột (nhất là cột Vai trò —
   * không thấy vai trò thì không ai biết mình đang khóa nhầm ai), menu rụng một mục, hoặc
   * hộp Phiên mở ra mà bên trong không có bảng.
   *
   * Họ tên của SA đọc từ DB chứ không gõ cứng: nó là dữ liệu hạt giống, đổi lúc nào không
   * biết, và một bài kiểm đỏ vì hạt giống đổi tên là một bài kiểm nói dối.
   */
  test('Phòng Tài khoản: nút, bộ cột, menu năm việc và bên trong hộp "Phiên đang mở"', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    // `exact`: menu có cả "Tài khoản" lẫn "Tài khoản dịch vụ".
    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Người dùng IMS', exact: true })).toBeVisible();

    await expect(
      page.getByRole('button', { name: /^Thêm/ }),
      'màn Tài khoản phải có đúng một nút thêm và nó ghi "Thêm tài khoản"',
    ).toHaveText(['Thêm tài khoản']);

    const cot = page.getByRole('table').getByRole('columnheader');
    await expect(
      cot,
      'bộ cột của bảng Tài khoản sai — mất cột Vai trò là SA thao tác trong khi không biết mình đang đụng vào ai',
    ).toHaveText([
      'Họ tên',
      'Vai trò',
      'Trạng thái',
      '2 lớp',
      'Đăng nhập gần nhất',
      'Thao tác',
    ]);

    const hoTenSa = sql(`SELECT full_name FROM users WHERE email = '${E2E_SA.email}'`);
    expect(hoTenSa.length, 'tài khoản SA hạt giống phải có họ tên để bám vào').toBeGreaterThan(0);

    /*
     * Lọc trước: bảng phân trang 20 dòng, SA không chắc nằm ở trang đang xem.
     *
     * PHẢI CHỜ BỘ LỌC ÁP XONG, KHÔNG CHỈ CHỜ HÀNG HIỆN RA.
     *
     * Gọi thẳng `fill()` rồi khẳng định nút ba chấm của SA đã hiện là không đủ: hàng SA VỐN ĐÃ
     * nằm ở trang 1 của danh sách CHƯA lọc, nên câu khẳng định ấy xanh ngay lập tức,
     * trước khi nhịp lắng 300ms của ô tìm kịp bắn. Bài đi tiếp, mở menu ba chấm, rồi lượt nạp
     * lại đổ xuống giữa chừng: bảng từ 7 dòng còn 1 dòng, hàng được dựng lại, và mục menu đang
     * mở bị giật khỏi DOM. Playwright báo "element is not stable" rồi "detached", đợi đủ 150
     * giây mới chịu thua — một thông báo chẳng liên quan gì tới thứ bài này đang kiểm.
     *
     * Cuộc đua ấy thường thắng nhờ MAY: quãng `rowActionNames` (mở menu · đọc chữ · Esc) tình
     * cờ dài hơn 300ms. Một thay đổi khác làm lệch nhịp vài chục mili-giây là mặt sấp ngửa lên.
     *
     * `timVaChoLoc` chờ đúng GIÁ TRỊ `q=` trên thanh địa chỉ — tức nhịp lắng đã bắn thật.
     * Kèm thêm câu chốt "bảng còn đúng một dòng" để chắc rằng dữ liệu ĐÃ LỌC cũng đã về, chứ
     * không chỉ cái URL đổi.
     */
    await timVaChoLoc(page, E2E_SA.email);
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: `Thao tác với ${hoTenSa}` })).toBeVisible();

    /*
     * So TẬP HỢP (đã sắp) chứ không so thứ tự: thứ tự trong menu do `RowActions` tự xếp lại
     * theo cờ `danger`, còn điều bài này bảo vệ là "còn đủ năm việc hay không".
     */
    expect(
      sapXep(await rowActionNames(page, hoTenSa)),
      'menu dòng CỦA CHÍNH SA đang đăng nhập: không có Khóa / Vô hiệu / Đặt lại 2 lớp / Đổi vai (API chặn tự làm với mình)',
    ).toEqual(
      sapXep([
        // ADM-035: bấm dòng hay chọn mục này đều mở hộp Chi tiết tài khoản.
        'Xem chi tiết',
        'Sửa',
        'Phiên đang mở',
        'Nhật ký thao tác',
        'Đặt lại mật khẩu',
        // Hạt giống SA luôn bị bắt 2 lớp (`reset-e2e.mjs`), nên mục bật/tắt đang ở vế "Bỏ".
        'Bỏ bắt buộc 2 lớp khi đăng nhập',
      ]),
    );

    // --- Bên trong hộp "Phiên đang mở". SA đang ngồi đây, nên chắc chắn có ít nhất một phiên.
    await rowAction(page, hoTenSa, 'Phiên đang mở');
    const hopPhien = page.getByRole('dialog', { name: `Phiên đang mở: ${hoTenSa}` });
    await expect(
      hopPhien,
      'tiêu đề hộp phải kèm TÊN người — mở nhầm hộp của người khác rồi đá phiên là một tai nạn không hoàn tác được',
    ).toBeVisible();

    await expect(
      hopPhien.getByRole('columnheader'),
      'bảng phiên phải đủ ba cột có chữ + một cột chứa nút; thiếu IP hay "hoạt động gần nhất" thì SA không phân biệt nổi phiên của mình với phiên của kẻ khác',
    ).toHaveText(['IP', 'Trình duyệt', 'Đăng nhập lúc', 'Hoạt động gần nhất', '']);
    await expect(
      hopPhien.getByText('Phiên này'),
      'phiên của chính SA đang xem phải được đánh dấu — nhìn là biết dòng nào là máy mình',
    ).toBeVisible();

    await expect(
      hopPhien.getByRole('button', { name: 'Đóng phiên' }).first(),
      'phiên của chính SA đang mở phải hiện ra kèm nút đá — bảng rỗng ở đây nghĩa là hộp không hỏi được server',
    ).toBeVisible();

    await hopPhien.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  /*
   * ===== BÀI 7 — HỘP TÀI KHOẢN: TẠO KHÁC SỬA, VÀ KHÁC ĐÚNG BA CHỖ =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `account-form.tsx` là MỘT hộp cho cả TẠO lẫn SỬA, khác nhau đúng ba chỗ: chế độ tạo có ô
   * Email nhập được, ô chọn Vai trò và công tắc "bắt 2 lớp"; chế độ sửa thì email là CHỮ
   * TĨNH, không phải ô nhập bị khóa.
   *
   * Ba kiểu hỏng đi qua mọi cổng hiện có:
   *   - ô Email hiện ra nhập được ở chế độ SỬA. Email là danh tính đăng nhập và là thứ mọi
   *     dòng nhật ký đang trỏ tới; cho sửa nó là đổi người mà vết cũ vẫn chỉ vào tên mới;
   *   - ô Vai trò rụng mất một lựa chọn — SA không tạo nổi một Quản trị viên nào nữa;
   *   - hộp SỬA mở ra trống. `PATCH /profile` gửi cả ba ô, nên trống nghĩa là bấm Lưu một
   *     phát xóa sạch số điện thoại và mã nhân viên của người ta.
   *
   * ĐỎ KHI: bất kỳ điều nào ở trên, hoặc bộ ô của một trong hai chế độ thừa/thiếu.
   */
  test('Hộp tài khoản: chế độ TẠO có Email và ba vai trò, chế độ SỬA thì email là chữ tĩnh và các ô còn nguyên giá trị cũ', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    await page.getByRole('link', { name: 'Người dùng IMS', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Người dùng IMS', exact: true })).toBeVisible();

    /*
     * Tiền tố `e2e-tao-moi-` là mẫu `resetUsers()` dùng để dọn. Sai mẫu thì tài khoản này ở
     * lại DB vĩnh viễn và ràng buộc email duy nhất sẽ làm đỏ mọi lượt chạy sau.
     */
    const stamp = uniqueStamp();
    const email = `e2e-tao-moi-${stamp}@pmh.com.vn`;
    const hoTen = `E2E Tạo Mới ${stamp}`;
    const soDienThoai = '0912 345 678';
    const maNhanVien = `NV-${stamp}`;

    // ===== CHẾ ĐỘ TẠO =====
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const hopTao = page.getByRole('dialog', { name: 'Thêm tài khoản', exact: true });
    await expect(hopTao).toBeVisible();

    expect(
      await tenTayNam(hopTao.getByRole('textbox')),
      'bộ ô GÕ của chế độ tạo sai — thiếu Email thì không tạo được ai, thừa một ô thì có một trường gõ vào mà không được gửi lên',
    ).toEqual(sapXep(['Họ tên', 'Email', 'Số điện thoại', 'Mã nhân viên']));

    /*
     * Ngày sinh KHÔNG phải ô gõ: `DatePicker` dùng chung có tay nắm là một BUTTON mở lịch.
     * Nhầm vai ở đây nghĩa là người dùng bàn phím thao tác khác hẳn điều ta tưởng.
     */
    await expect(
      hopTao.getByRole('button', { name: 'Ngày sinh' }),
      'ô Ngày sinh phải là nút mở lịch (DatePicker dùng chung), không phải một ô gõ tự do',
    ).toBeVisible();

    const oVaiTro = hopTao.getByRole('group', { name: 'Vai trò' });
    await expect(
      oVaiTro,
      'nhóm Vai trò chỉ có ở chế độ TẠO — vai trò của người đang có thì đổi bằng "Đổi vai trò…"',
    ).toBeVisible();
    await expect(
      oVaiTro.getByRole('radio'),
      'Vai trò phải đủ BA lựa chọn — rụng "Quản trị" là SA không tạo nổi một Quản trị viên nào nữa',
    ).toHaveCount(3);
    for (const vai of ['Thành viên', 'Quản trị', 'Super Admin']) {
      await expect(oVaiTro.getByRole('radio', { name: new RegExp(`^${vai}`) })).toBeVisible();
    }
    await expect(
      oVaiTro.getByRole('radio', { name: /^Thành viên/ }),
      'mặc định là vai thấp nhất',
    ).toBeChecked();

    const congTac = hopTao.getByRole('checkbox');
    await expect(congTac, 'chế độ tạo có đúng một công tắc: bắt buộc 2 lớp').toHaveCount(1);
    await expect(
      congTac,
      'công tắc "bắt buộc 2 lớp" phải BẬT sẵn — mặc định an toàn, ai muốn tắt thì phải chủ động tắt',
    ).toBeChecked();

    await hopTao.getByLabel(nhan('Họ tên')).fill(hoTen);
    await hopTao.getByLabel(nhan('Email')).fill(email);
    await hopTao.getByLabel(nhan('Số điện thoại')).fill(soDienThoai);
    await hopTao.getByLabel(nhan('Mã nhân viên')).fill(maNhanVien);
    await hopTao.getByRole('button', { name: 'Lưu' }).click();

    // Mật khẩu tạm chỉ hiện MỘT LẦN — nó là dấu hiệu tài khoản đã thật sự vào sổ.
    await expect(page.getByRole('dialog', { name: 'Mật khẩu tạm' })).toBeVisible();
    expect(
      (await page.getByTestId('temp-password').innerText()).trim().length,
      'tạo xong mà không có mật khẩu tạm thì SA không có gì để đọc cho người dùng',
    ).toBeGreaterThanOrEqual(12);
    // Nhãn nút là LỜI XÁC NHẬN, không phải "Đóng": hộp chặn Esc và click-nền nên đây là
    // đường ra duy nhất, và người bấm phải tự khẳng định đã ghi lại.
    await page
      .getByRole('button', { name: 'Tôi đã ghi lại mật khẩu này', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // ===== CHẾ ĐỘ SỬA =====
    // Chờ bộ lọc ÁP XONG chứ không chỉ chờ hàng hiện ra: hàng cần tìm vốn đã nằm ở trang 1
    // của danh sách CHƯA lọc, nên câu chờ xanh ngay, rồi lượt nạp lại đổ xuống giữa lúc menu
    // ba chấm đang mở và giật nó khỏi DOM. Lý do đầy đủ: chú thích ở bài
    // "Phòng Tài khoản" trong chính file này.
    await timVaChoLoc(page, email);
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: `Thao tác với ${hoTen}` })).toBeVisible();
    await rowAction(page, hoTen, 'Sửa');

    const hopSua = page.getByRole('dialog', { name: `Sửa hồ sơ: ${hoTen}` });
    await expect(hopSua).toBeVisible();

    expect(
      await tenTayNam(hopSua.getByRole('textbox')),
      'chế độ SỬA còn ô Email nhập được nghĩa là email — danh tính đăng nhập, thứ mọi dòng nhật ký trỏ tới — sửa được',
    ).toEqual(sapXep(['Họ tên', 'Số điện thoại', 'Mã nhân viên']));

    await expect(
      hopSua.getByTestId('account-email'),
      'ở chế độ sửa email phải hiện thành CHỮ; ô khóa thì người dùng còn ngồi bấm thử và tự hỏi vì sao không gõ được',
    ).toHaveText(email);

    await expect(
      hopSua.getByRole('radio'),
      'chế độ sửa KHÔNG được có ô Vai trò (đổi vai là việc riêng, có step-up)',
    ).toHaveCount(0);
    await expect(
      hopSua.getByRole('checkbox'),
      'chế độ sửa KHÔNG được có công tắc "bắt buộc 2 lớp"',
    ).toHaveCount(0);

    await expect(
      hopSua.getByLabel(nhan('Họ tên')),
      'hộp Sửa mở ra trống là bấm Lưu một phát xóa sạch hồ sơ của người ta',
    ).toHaveValue(hoTen);
    await expect(hopSua.getByLabel(nhan('Số điện thoại'))).toHaveValue(soDienThoai);
    await expect(hopSua.getByLabel(nhan('Mã nhân viên'))).toHaveValue(maNhanVien);

    // Đóng bằng Esc — không lưu gì cả.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  /*
   * ===== BÀI 8 — PHÒNG BỘ GIAO DIỆN: NƠI MỌI COMPONENT ĐƯỢC VẼ MỘT LƯỢT =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `/dev/components` là bản kê SỐNG của tài sản dùng chung (AD-15). Nó có hai
   * công dụng, và bài kiểm này giữ cả hai:
   *
   *   1. Nó là nơi người viết story sau mở ra xem "đã có sẵn chưa" trước khi viết component
   *      mới. Một khu biến mất khỏi trang này = một component dùng chung vô hình, và người
   *      tiếp theo sẽ viết lại bản riêng của nó — đúng điều AD-15 cấm.
   *   2. Nó là nơi DUY NHẤT mọi component được dựng ra cùng lúc với dữ liệu mẫu. Một
   *      component ném lỗi lúc render sẽ làm sập cả cây React và cuốn theo mọi khu phía sau
   *      — nên so CẢ MẢNG tiêu đề bắt được ngay, trong khi `toBeVisible()` từng cái thì chỉ
   *      bắt được cái đầu tiên.
   *
   * ĐỎ KHI: thêm/bớt/đổi tên một khu, hoặc một component vỡ khiến các khu sau nó không được
   * vẽ ra nữa.
   *
   * HAI dòng trong mảng KHÔNG phải tên khu, và cố ý giữ lại: "Thông tin chung" (nằm trong
   * khu "Form") và "Giấy tờ đính kèm" (nằm trong khu AttachmentDraftSection) đều là tiêu đề
   * do `FormSection` dựng — mà `FormSection` cũng vẽ `<h2>`. Có mặt trong mảng chính là bằng
   * chứng hai khối ấy còn dựng được phần thân, không chỉ cái vỏ ngoài. Bỏ chúng đi để mảng
   * "gọn" là làm yếu phép so tập hợp.
   */
  test('Phòng Bộ giao diện liệt kê đủ mọi khu, đúng thứ tự', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    await page.getByRole('link', { name: 'Bộ giao diện' }).click();
    await expect(page.getByRole('heading', { name: 'Bộ giao diện', exact: true })).toBeVisible();

    await expect(
      page.getByRole('heading', { level: 2 }),
      'bản kê tài sản dùng chung thiếu hoặc thừa một khu — hoặc một component vỡ lúc render và cuốn theo mọi khu sau nó',
    ).toHaveText([
      'Màu nền tảng — nguồn duy nhất là tokens.css',
      'Nút',
      'Nhãn trạng thái hạn — ExpiryBadge (một luật duy nhất)',
      'Thông báo & xác nhận — useToast / useConfirm',
      'Thanh lọc & phân trang',
      'Lưới ghế — .seat-list (khu bung dòng)',
      'Form',
      'Thông tin chung',
      'Lịch định kỳ — SchedulePicker',
      'Lịch sử nghiệp vụ — HistoryPanel (AD-13)',
      'Tabs — Tabs (bàn phím ←/→, Home/End)',
      'Chọn file — FilePicker (kéo-thả được)',
      'Giấy tờ chọn trước khi lưu — AttachmentDraftSection',
      // Cũng KHÔNG phải một khu: `AttachmentDraftSection` tự dựng một `FormSection` bên
      // trong, và `FormSection` nào cũng vẽ `<h2>`. Có mặt ở đây là bằng chứng khối chọn
      // giấy tờ trước khi lưu còn dựng được phần thân của nó, không chỉ cái tiêu đề ngoài.
      'Giấy tờ đính kèm',
      'Đối chiếu trước khi ghi — ImportPreview',
      'Trạng thái rỗng',
    ]);
  });
});
