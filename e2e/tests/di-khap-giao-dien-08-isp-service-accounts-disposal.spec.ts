import { expect, test, type Locator } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  confirmAction,
  firstLogin,
  ispProviderId,
  logout,
  resetCatalog,
  resetDevices,
  resetIsp,
  resetSecrets,
  resetServiceAccounts,
  resetUsers,
  rowAction,
  rowActionNames,
  searchAndWaitForFilter,
  writeHeaders,
  uniqueStamp,
} from './helpers';

/*
 * ===== PHẦN 5 — VÀO HẲN TRONG PHÒNG: ĐƯỜNG TRUYỀN · TÀI KHOẢN DỊCH VỤ · KHO THANH LÝ =====
 *
 * Bốn khối trước đi HÀNH LANG: bấm menu, đọc breadcrumb, kiểm ranh giới vai. Chúng chứng minh
 * được rằng CÁC CỬA còn mở đúng chỗ, nhưng không nói gì về thứ nằm SAU cửa.
 *
 * Khối này đi vào trong. Ba phòng ở đây có một điểm chung: chúng là những màn ÍT AI MỞ NHẤT
 * trong ngày thường, nên một cái nút biến mất, một cột rơi khỏi bảng, một ô rơi khỏi form sẽ
 * sống rất lâu trước khi có người nhận ra. Bộ E2E hiện có kiểm NGHIỆP VỤ của chúng khá kỹ
 * (`isp.spec.ts`, `service-accounts.spec.ts`, `disposal.spec.ts`) — nhưng luôn bằng cách bấm
 * đúng vào cái nút mình cần, nên không bài nào trả lời được câu "phòng này CÓ ĐÚNG những gì".
 *
 * Vì thế mọi khẳng định ở đây là khẳng định TẬP HỢP: danh sách nút, danh sách cột, danh sách
 * mục menu, danh sách ô trong hộp thoại. So từng cái một bằng `toBeVisible()` chỉ bắt được
 * thứ MẤT ĐI; so cả tập bắt thêm được thứ THỪA RA — và ở phòng "Kho thanh lý" thì một cái nút
 * thừa ra chính là một hồ sơ đã thanh lý bị ai đó sửa được.
 */
test.describe('Phòng Đường truyền, Tài khoản dịch vụ và Kho thanh lý — bên trong có gì', () => {
  test.beforeEach(() => {
    resetUsers();
    resetIsp();
    resetServiceAccounts();
    resetDevices();
    resetCatalog();
    resetSecrets();
  });

  /** Sáu chữ số cuối của mốc thời gian — đủ riêng cho một lượt chạy, đủ ngắn để đọc trong log. */
  const timestamp = (): string => uniqueStamp();

  /**
   * Gọn một nhãn đọc được về dạng so sánh được: gộp mọi khoảng trắng, bỏ dấu `*` của ô bắt buộc.
   *
   * Dấu `*` là chỉ dấu THỊ GIÁC (`aria-hidden`), nó không thuộc về tên gọi của ô. Giữ lại thì
   * mọi mảng mong đợi phải gõ kèm một ký tự mà trình đọc màn hình không bao giờ đọc lên.
   */
  function tidyLabel(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim().replace(/\s*\*$/, '').trim();
  }

  /**
   * TÊN của mọi tay nắm mang vai trò `role` bên trong `scope`, đã sắp xếp.
   *
   * Vì sao phải tự đọc thay vì `allInnerTexts()`: nửa số tay nắm trong repo KHÔNG có chữ bên
   * trong. Nút sắp xếp mang `aria-label="Sắp xếp theo Mã đường"`, ô chọn `Select` là một
   * `<button>` chỉ chứa giá trị đang chọn, nút ‹ › của phân trang chỉ có một hình SVG. Đọc
   * `textContent` ở những chỗ đó ra chuỗi rỗng — và một mảng đầy chuỗi rỗng thì so tập hợp
   * kiểu gì cũng vô nghĩa.
   *
   * Thứ tự tra đúng theo thứ tự tính TÊN KHẢ TRUY CẬP của trình duyệt: `aria-label` → `<label
   * for>` → `placeholder` → chữ bên trong.
   *
   * `textContent` chứ KHÔNG phải `innerText`, và đây là bài học của lượt chạy đầu: `innerText`
   * trả về chữ SAU KHI CSS đã tô vẽ, nên `text-transform: uppercase` của `.form-section-title`
   * biến "Hồ sơ" thành "HỒ SƠ" và mọi phép so tập hợp đỏ hàng loạt vì một luật CSS. Tên một
   * tay nắm thuộc về DOM, không thuộc về bảng màu.
   *
   * Cái KHÔNG có trong mảng này cũng có nghĩa: nút mũi tên của mỗi `Combobox` mang
   * `aria-hidden="true"` (và `tabIndex={-1}`) nên nó không nằm trong cây trợ năng —
   * `getByRole` bỏ qua nó, đúng như ý người viết component. Ngày nào ai đó gỡ `aria-hidden`
   * đi thì một cái nút không tên sẽ lọt vào mảng và bài này đỏ, đúng lúc cần đỏ.
   */
  async function nameByRole(
    scope: Locator,
    role: 'button' | 'textbox' | 'combobox' | 'radio',
  ): Promise<string[]> {
    const raw = await scope.getByRole(role).evaluateAll((els) =>
      els.map((el) => {
        const aria = el.getAttribute('aria-label');
        if (aria) return aria;
        const labels = (el as HTMLInputElement).labels;
        if (labels && labels.length > 0) return labels[0].textContent ?? '';
        return el.getAttribute('placeholder') ?? el.textContent ?? '';
      }),
    );
    return raw.map(tidyLabel).sort();
  }

  /**
   * Tiêu đề các KHỐI trong một hộp thoại, đã sắp xếp.
   *
   * `FormSection` vẽ `<h2>`, mà `Dialog` cũng vẽ tiêu đề hộp bằng `<h2>` (Radix `Title`) — nên
   * mảng này luôn có phần tử đầu là tên hộp. Đó là chủ ý: tên hộp sai cũng phải đỏ.
   *
   * `allTextContents` chứ không `allInnerTexts`: `.form-section-title` có
   * `text-transform: uppercase`, nên `innerText` trả về "HỒ SƠ" còn DOM ghi "Hồ sơ".
   */
  async function dialogBlockNames(scope: Locator): Promise<string[]> {
    const raw = await scope.getByRole('heading', { level: 2 }).allTextContents();
    return raw.map(tidyLabel).sort();
  }

  /** Mảng mong đợi, sắp cùng một kiểu với `nameByRole` để `toEqual` so được. */
  function sortVi(names: string[]): string[] {
    return [...names].sort();
  }

  /**
   * Chữ trong các ô tiêu đề cột — đọc CHỮ TRONG DOM, không phải tên khả truy cập.
   *
   * Không dùng tên khả truy cập vì `<th>` chứa nút sắp xếp sẽ lấy luôn tên của nút đó
   * ("Sắp xếp theo Mã đường"), còn `<th>` không sắp được thì lấy chính chữ của nó ("Site") —
   * hai kiểu tên cho cùng một hàng tiêu đề.
   *
   * Và phải là `allTextContents`: CSS của bảng đặt `text-transform: uppercase` cho `th`, nên
   * `allInnerTexts` trả về "MÃ ĐƯỜNG". Lượt chạy đầu đỏ đúng vì chuyện này ở cả ba bảng.
   */
  async function tableColumnNames(scope: Locator): Promise<string[]> {
    return (await scope.getByRole('columnheader').allTextContents()).map(tidyLabel);
  }

  /*
   * ===== BÀI 1 — MÀN ĐƯỜNG TRUYỀN =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `isp.spec.ts` kiểm hotline/số hợp đồng có mặt trên bảng và kiểm thứ tự sắp xếp chạy ở
   * server. Cả hai đều bấm đúng vào cái nút cần bấm. Không bài nào hỏi "màn này có ĐÚNG những
   * nút nào" — mà đó lại là câu duy nhất bắt được một nút LẠ mọc thêm.
   *
   * Điểm riêng của màn này: nó KHÔNG có cột Thao tác, không có menu ba chấm. Sửa và thanh lý
   * chỉ làm được từ trang hồ sơ. Đó không phải chuyện tình cờ mà là hình dạng thật của
   * `isp-screen.tsx`, và nếu một ngày có người thêm `RowActions` vào đây thì phải có cái gì đó
   * đỏ lên để hỏi lại "đã bàn chưa".
   *
   * ĐỎ KHI: mọc thêm/mất đi một nút đầu trang, một ô lọc, một cột, một nút sắp xếp; ô tìm
   * thôi thu hẹp bảng (lọc client giả vờ chạy trên 20 dòng đang xem); `aria-sort` không lật;
   * hoặc cột Thao tác lẻn vào màn này.
   */
  test('Màn Đường truyền: đủ nút, đủ cột, ô tìm thu hẹp bảng thật, và KHÔNG có menu ba chấm', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = timestamp();
    const codeA = `ISP-E2E-PHONG-${stamp}-A`;
    const codeB = `ISP-E2E-PHONG-${stamp}-B`;
    const headers = await writeHeaders(page);

    // Dàn cảnh bằng API — điều đang kiểm là HÌNH DẠNG của màn, không phải đường tạo hồ sơ.
    for (const [code, provider] of [
      [codeA, 'Alpha Telecom E2E'],
      [codeB, 'Zulu Telecom E2E'],
    ]) {
      const providerId = await ispProviderId(page, provider);
      const created = await page.request.post('/api/v1/isp-lines', {
        headers,
        data: { code, providerId, hotline: '18001166', contractNo: `HD-${stamp}` },
      });
      expect(created.status(), `Dàn cảnh: tạo đường truyền ${code} phải thành công`).toBe(201);
    }

    await page.goto('/isp-lines');
    await expect(page.getByRole('heading', { level: 1, name: /^Đường truyền$/ })).toBeVisible();

    const main = page.getByRole('main');
    const searchBox = page.getByRole('searchbox', {
      name: 'Tìm theo mã, nhà mạng, IP WAN hoặc số hợp đồng',
    });

    /*
     * Ô TÌM PHẢI THU HẸP BẢNG THẬT.
     *
     * Gõ mã của lượt chạy này vào thì hai đường vừa tạo còn đúng hai — nghĩa là câu tìm đã đi
     * tới server, không phải lọc lại 20 dòng đang cầm trên tay.
     */
    await searchBox.fill(`ISP-E2E-PHONG-${stamp}`);
    await expect(
      page.getByRole('row'),
      'Gõ mã của lượt chạy này thì bảng phải còn đúng 1 dòng tiêu đề + 2 đường truyền',
    ).toHaveCount(3);

    // ĐỦ CỘT, ĐÚNG THỨ TỰ. Cột rơi mất là một thông tin không ai còn đọc được trên danh sách.
    expect(
      await tableColumnNames(main),
      'Bảng đường truyền phải có đúng 7 cột, đúng thứ tự của `isp-screen.tsx` — không có cột hạn (Q-04)',
    ).toEqual([
      'Mã đường',
      'Nhà mạng',
      'Site',
      'Thiết bị biên',
      'Hotline',
      'Số hợp đồng',
      'Trạng thái',
    ]);

    /*
     * SẮP XẾP LẬT `aria-sort`.
     *
     * `isp.spec.ts` đã kiểm THỨ TỰ DÒNG đổi đúng chiều. Thứ chưa ai kiểm là cái ô tiêu đề có
     * NÓI RA điều đó không: người dùng trình đọc màn hình không nhìn thấy mũi tên chevron, họ
     * chỉ nghe `aria-sort`. Thiếu nó thì bảng vẫn sắp đúng mà không ai biết nó đang sắp theo gì.
     */
    const codeColumn = main.getByRole('columnheader').filter({ hasText: /^Mã đường$/ });
    const providerColumn = main.getByRole('columnheader').filter({ hasText: /^Nhà mạng$/ });
    await expect(
      codeColumn,
      'Mở màn ra là đang sắp theo Mã đường tăng dần — cột đó phải tự khai `aria-sort`',
    ).toHaveAttribute('aria-sort', 'ascending');

    await main.getByRole('button', { name: 'Sắp xếp theo Nhà mạng' }).click();
    await expect(
      providerColumn,
      'Bấm sắp xếp theo Nhà mạng lần đầu phải thành tăng dần',
    ).toHaveAttribute('aria-sort', 'ascending');
    await expect(
      codeColumn,
      'Sắp theo cột khác thì cột Mã đường phải về `aria-sort="none"` — hai cột cùng khai đang sắp là nói dối',
    ).toHaveAttribute('aria-sort', 'none');

    await main.getByRole('button', { name: 'Sắp xếp theo Nhà mạng' }).click();
    await expect(providerColumn, 'Bấm lần hai phải lật xuống giảm dần').toHaveAttribute(
      'aria-sort',
      'descending',
    );

    /*
     * ĐÚNG BỘ NÚT — thu hẹp còn MỘT dòng trước đã, để phần phân trang có hình dạng cố định.
     *
     * Đây là khẳng định trung tâm của bài: liệt kê HẾT nút trong vùng nội dung rồi so với bản
     * mong đợi. `toBeVisible()` từng cái chỉ bắt được nút mất đi; so cả tập bắt được cả nút
     * mọc thêm — và cột Thao tác mọc thêm ở đây là thứ bài này sinh ra để chặn.
     */
    await searchBox.fill(codeA);
    await expect(page.getByRole('row'), 'Lọc còn đúng một đường truyền').toHaveCount(2);

    expect(
      await nameByRole(main, 'button'),
      'Màn Đường truyền phải có ĐÚNG bộ nút này — không thừa một cái nào',
    ).toEqual(
      sortVi([
        'Xuất Excel',
        'Thêm đường truyền',
        'Site',
        'Nhà mạng',
        'Trạng thái',
        'Sắp xếp theo Mã đường',
        'Sắp xếp theo Nhà mạng',
        'Sắp xếp theo Hotline',
        'Sắp xếp theo Số hợp đồng',
        'Sắp xếp theo Trạng thái',
        'Số dòng',
        'Trang trước',
        'Trang sau',
      ]),
    );

    // Nói thẳng ra điều vừa suy ra được từ tập hợp trên — để lúc đỏ đọc log là hiểu ngay.
    await expect(
      main.getByRole('button', { name: /^Thao tác với/ }),
      'Màn Đường truyền KHÔNG có cột Thao tác: sửa và thanh lý chỉ làm từ trang hồ sơ',
    ).toHaveCount(0);
  });

  /*
   * ===== BÀI 2 — BÊN TRONG HỘP "THÊM ĐƯỜNG TRUYỀN" =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Một ô lặng lẽ rơi khỏi form là một trường KHÔNG BAO GIỜ được nhập nữa, và không có gì đỏ
   * lên: hồ sơ vẫn lưu được, API vẫn nhận, chỉ là từ hôm đó không ai khai số hợp đồng nữa. Bộ
   * E2E hiện có luôn `fill` đúng những ô nó cần rồi bấm Lưu, nên nó mù hoàn toàn với chuyện này.
   *
   * Bài này liệt kê HẾT ô trong hộp, theo ĐÚNG LOẠI tay nắm. Loại quan trọng ngang nội dung:
   * "Nhà mạng" và "Site" là `button` mở danh sách chọn, không phải ô gõ — nhầm vai nghĩa là
   * người dùng bàn phím thao tác khác hẳn điều ta tưởng.
   *
   * ĐỎ KHI: một ô rơi mất hoặc mọc thêm; một ô đổi loại tay nắm; ô Trạng thái (đổi trạng thái
   * chỉ đi menu ⋮ của trang chi tiết) lọt vào hộp; lời báo lỗi đổi chữ; hoặc một trong hai đường đóng hộp
   * (Esc và ✕) thôi hoạt động.
   */
  test('Hộp "Thêm đường truyền": đủ ô, đúng loại tay nắm, chặn thiếu nhà mạng, đóng được cả hai đường', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = timestamp();
    const itemCode = `ISP-E2E-HOP-${stamp}`;
    // Dàn cảnh TRƯỚC khi mở màn: ô chọn Nhà mạng đọc danh mục lúc nạp trang (Q-11).
    await ispProviderId(page, 'FPT E2E');

    await page.goto('/isp-lines');
    await page.getByRole('button', { name: 'Thêm đường truyền' }).click();

    const dialog = page.getByRole('dialog', { name: 'Thêm đường truyền' });
    await expect(dialog, 'Bấm "Thêm đường truyền" phải mở ra hộp thoại').toBeVisible();

    expect(
      await dialogBlockNames(dialog),
      'Hộp thêm đường truyền có đúng ba khối: Hồ sơ · Hợp đồng và liên hệ sự cố · Giấy tờ đính kèm',
    ).toEqual(sortVi([
      'Thêm đường truyền',
      'Hồ sơ',
      'Hợp đồng và liên hệ sự cố',
      'Giấy tờ đính kèm',
    ]));

    expect(
      await nameByRole(dialog, 'textbox'),
      'Sáu ô gõ chữ của hộp thêm đường truyền — thiếu một ô là một trường không ai khai nữa',
    ).toEqual(sortVi(['Mã đường', 'Tốc độ gói cước', 'IP WAN', 'Hotline', 'Số hợp đồng', 'Ghi chú']));

    /*
     * Ô này là `combobox`, KHÔNG phải `textbox`: "Thiết bị biên" tra ngược vào kho thiết bị.
     * "Nhà mạng" KHÔNG còn ở đây — nó là khoá ngoại tới danh mục, chọn chứ không gõ (Q-11),
     * nên nằm trong bộ nút bên dưới.
     *
     * F-06: `Field` tự nối `id` vào `Combobox`, nên tên khả truy cập là NHÃN thật: "Thiết bị
     * biên". Không có nhãn nối vào thì tên rơi về `placeholder` — trình đọc màn hình đọc "Tìm
     * thiết bị trong kho…" thay vì tên của ô.
     */
    expect(
      await nameByRole(dialog, 'combobox'),
      'Hộp có đúng một ô gợi ý: ô tra thiết bị biên',
    ).toEqual(sortVi(['Thiết bị biên']));

    /*
     * "Chọn file để đính kèm" nằm trong bộ NÚT chứ không phải bộ ô nhập, và đó là điều đúng:
     * `<input type="file">` được ánh xạ sang vai trò `button`, tên lấy từ `<label for>`. Nó
     * bị CSS thu về 1×1 px nhưng KHÔNG bị `visibility: hidden` — cố ý, để trình đọc màn hình
     * vẫn với tới được. Bỏ nó khỏi mảng này là bỏ luôn khả năng thấy khi khối giấy tờ rơi mất.
     */
    expect(
      await nameByRole(dialog, 'button'),
      'Bộ nút trong hộp thêm mới: ô chọn Nhà mạng, ô chọn Site, ô ngày Bắt đầu, ô chọn file, ' +
        '✕, Hủy, Lưu — không có ô Hết hạn vì đường truyền không có hạn (Q-04)',
    ).toEqual(
      sortVi([
        'Đóng hộp thoại',
        'Nhà mạng',
        // Nhà mạng mới khai ngay tại chỗ (SA/Admin) — không bắt huỷ form sang Danh mục.
        '+ Thêm vào danh mục',
        'Site',
        'Bắt đầu',
        'Chọn file để đính kèm',
        'Hủy',
        'Lưu',
      ]),
    );

    /*
     * KHÔNG CÓ Ô TRẠNG THÁI — nói thẳng ra, đừng để nó chìm trong tập hợp trên. Hồ sơ mới
     * luôn "Đang dùng"; đổi trạng thái chỉ đi menu ⋮ của trang chi tiết.
     */
    await expect(
      dialog.getByRole('button', { name: 'Trạng thái', exact: true }),
      'Hộp THÊM MỚI không được có ô Trạng thái — hồ sơ mới luôn là "Đang dùng"',
    ).toHaveCount(0);

    /*
     * ĐƯỜNG HỎNG: có mã, thiếu nhà mạng (NET-023).
     *
     * Ô Nhà mạng là nút chọn — ô dễ rơi nhất. Câu lỗi tiếng Việt phải nằm dưới và nối vào
     * chính nút đó; form đặt `noValidate` nên không còn bong bóng tiếng Anh của trình duyệt.
     */
    await dialog.getByRole('textbox', { name: 'Mã đường' }).fill(itemCode);
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu' }).click();

    await expect(
      dialog.getByRole('button', { name: 'Nhà mạng', exact: true }),
      'Thiếu nhà mạng phải nói ra ngay dưới ô Nhà mạng, không phải im lặng',
    ).toHaveAccessibleDescription(/Bắt buộc — chưa chọn ô này\./);
    await expect(dialog, 'Báo lỗi thì hộp phải Ở LẠI để người dùng sửa, không được đóng').toBeVisible();

    // ĐƯỜNG ĐÓNG THỨ NHẤT: phím Esc.
    /* Form đã gõ dở, nên lối đóng TÌNH CỜ phải hỏi lại trước (`Dialog guardUnsaved`) — trả
       lời xong mới đóng. */
    await page.keyboard.press('Escape');
    await confirmAction(page, 'Bỏ và đóng');
    await expect(dialog, 'Esc phải đóng được hộp khi chưa có lượt ghi nào đang chạy').toHaveCount(0);

    // ĐƯỜNG ĐÓNG THỨ HAI: nút ✕. Hai đường, hai đoạn code khác nhau — kiểm cả hai.
    await page.getByRole('button', { name: 'Thêm đường truyền' }).click();
    const secondDialog = page.getByRole('dialog', { name: 'Thêm đường truyền' });
    await secondDialog.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(secondDialog, 'Nút ✕ phải đóng được hộp').toHaveCount(0);

    // Và cuối cùng: khai đủ thì hộp đóng, dòng mới nằm ngay trên bảng.
    await page.getByRole('button', { name: 'Thêm đường truyền' }).click();
    const thirdDialog = page.getByRole('dialog', { name: 'Thêm đường truyền' });
    await thirdDialog.getByRole('textbox', { name: 'Mã đường' }).fill(itemCode);
    await thirdDialog.getByRole('button', { name: 'Nhà mạng' }).click();
    await page.getByRole('option', { name: 'FPT E2E', exact: true }).click();
    await thirdDialog.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu' }).click();

    await expect(page.getByText('Đã lưu hồ sơ đường truyền.')).toBeVisible();
    await expect(
      page.getByRole('row', { name: new RegExp(itemCode) }),
      'Khai đủ mã và nhà mạng thì đường truyền phải xuất hiện ngay trên danh sách',
    ).toBeVisible();
  });

  /*
   * ===== BÀI 3 — HỒ SƠ ĐƯỜNG TRUYỀN: MỖI TAB CÓ GÌ, VÀ HỘP SỬA CỦA NÓ =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Trang hồ sơ đường truyền là trang mở ra lúc 2 giờ sáng khi đứt cáp. Bốn tab của nó là bốn
   * nguồn dữ liệu KHÁC NHAU (hồ sơ, két sắt, giấy tờ, lịch sử) và ba trong bốn chỉ được nạp
   * khi bấm vào tab — nghĩa là ba nhánh code gần như không bao giờ chạy trong bộ E2E hiện tại.
   *
   * Bài này vào bằng cách BẤM từ danh sách (không `goto`): đường `PATHS.ispLine(id)` ghép sai
   * thì không bài nào khác đỏ, vì mọi bài khác tự gõ URL đúng.
   *
   * Đường truyền không có hạn (Q-04): không nút Gia hạn, không thanh thời hạn, không ô Hết
   * hạn trong form Sửa. Bài này khoá cả ba vế vắng mặt đó.
   *
   * ĐỎ KHI: link mã trên bảng trỏ sai; một nút đầu trang hồ sơ mất/mọc thêm; một tab biến mất;
   * một tab mở ra khoảng trắng; cái gì đó về hạn quay lại; hoặc form Sửa hiện ra TRỐNG (kiểu
   * hỏng ghi đè sạch dữ liệu cũ ngay khi bấm Lưu).
   */
  test('Hồ sơ đường truyền: bấm từ danh sách, đủ nút và đủ tab, không có gì về hạn, mở hộp Sửa', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = timestamp();
    const itemCode = `ISP-E2E-TAB-${stamp}`;
    const note = `Ghi chú E2E cho ${itemCode}`;
    const created = await page.request.post('/api/v1/isp-lines', {
      headers: await writeHeaders(page),
      data: {
        code: itemCode,
        providerId: await ispProviderId(page, 'VNPT E2E'),
        bandwidth: '100 Mbps',
        wanIp: '203.113.99.9',
        hotline: '18001166',
        contractNo: `HD-E2E-${stamp}`,
        startDate: '2026-01-01',
        note: note,
      },
    });
    expect(created.status(), 'Dàn cảnh: tạo đường truyền đầy đủ trường phải thành công').toBe(201);

    await page.goto('/isp-lines');
    await searchAndWaitForFilter(page, itemCode);

    // BẤM vào mã — không `goto`. Đây chính là sợi dây mà mọi bài kiểm khác đi vòng qua.
    await page.getByRole('main').getByRole('link', { name: itemCode, exact: true }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(itemCode) }),
      'Bấm mã trên danh sách phải mở đúng hồ sơ đường truyền đó',
    ).toBeVisible();
    expect(
      new URL(page.url()).pathname,
      'Đường dẫn phải là /isp-lines/<id>, không phải một đường ghép sai',
    ).toMatch(/^\/isp-lines\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole('navigation', { name: 'breadcrumb' }).getByRole('link', {
        name: 'Đường truyền',
        exact: true,
      }),
      'Trang hồ sơ phải có đúng một đường quay ra: mục đầu của breadcrumb',
    ).toBeVisible();

    const main = page.getByRole('main');

    /*
     * ĐÚNG BỘ NÚT ĐẦU TRANG. Hai cái, không hơn:
     *   - "Chép IP tĩnh" (nằm ở dòng định danh, chỉ vẽ khi hồ sơ có IP WAN),
     *   - "Sửa hồ sơ" ở góc phải. KHÔNG có "Gia hạn hợp đồng" — line không có hạn (Q-04).
     * Mã hồ sơ CỐ Ý không có nút chép — nó là tiêu đề, bôi đen chép như mọi chữ khác. Tập hợp
     * này giữ đúng quyết định đó.
     */
    expect(
      await nameByRole(main, 'button'),
      'Đầu trang hồ sơ đường truyền: Chép IP WAN · Sửa hồ sơ · menu ⋯ (đổi trạng thái) · Chép số hợp đồng (thẻ "Khi mất mạng")',
    ).toEqual(sortVi(['Chép IP WAN', 'Sửa hồ sơ', `Thao tác với ${itemCode}`, 'Chép số hợp đồng']));
    // Thẻ "Khi mất mạng": gọi hotline là MỘT cú chạm.
    await expect(main.getByRole('link', { name: 'Gọi 1800 1166' })).toHaveAttribute(
      'href',
      'tel:18001166',
    );

    /*
     * BỐN TAB, ĐÚNG THỨ TỰ. Nhãn hai tab giữa có số đếm nối sau ("Két sắt 0"), nên cắt phần số
     * đi rồi mới so — thứ đang kiểm là DANH SÁCH TAB, không phải con số của lượt chạy này.
     */
    const tabName = (await page.getByRole('tab').allTextContents()).map((raw) =>
      tidyLabel(raw).replace(/\s+\d+$/, ''),
    );
    expect(
      tabName,
      'Hồ sơ đường truyền phải có đúng bốn tab, đúng thứ tự: Hồ sơ · Két sắt · Giấy tờ · Lịch sử',
    ).toEqual(['Hồ sơ', 'Két sắt', 'Giấy tờ', 'Lịch sử']);

    /** Mỗi tab kèm MỘT dấu hiệu chỉ tab đó mới có — để "bấm sang tab khác" không thể xanh nhầm. */
    const tabMarkers: { name: RegExp; marker: () => Promise<void> }[] = [
      {
        name: /^Hồ sơ$/,
        marker: async () => {
          /* Thẻ định danh ở cột phải hiện ngày bắt đầu, và KHÔNG còn thanh thời hạn: đường
             truyền không có hạn (Q-04). */
          const the = page.getByRole('region', { name: 'Thẻ định danh' });
          await expect(
            the.getByText('Bắt đầu', { exact: true }),
            'Thẻ định danh phải hiện ngày bắt đầu đã khai',
          ).toBeVisible();
          await expect(
            the.getByRole('progressbar'),
            'Không còn thanh thời hạn hợp đồng — line không có hạn',
          ).toHaveCount(0);
          await expect(
            main.getByText(note, { exact: true }),
            'Tab Hồ sơ phải hiện lại đúng ghi chú đã khai',
          ).toBeVisible();
        },
      },
      {
        name: /^Két sắt/,
        marker: async () => {
          await expect(
            main.getByText(/Nơi cất mật khẩu và license key/),
            'Tab Két sắt phải mở ra panel két, không phải khoảng trắng',
          ).toBeVisible();
          await expect(
            main.getByRole('button', { name: 'Cất mật khẩu/khóa' }),
            'SA cất được mật khẩu PPPoE của đường truyền — nút phải có mặt',
          ).toBeVisible();
        },
      },
      {
        name: /^Giấy tờ/,
        marker: async () => {
          await expect(
            main.getByText('Chưa có giấy tờ nào.'),
            'Đường truyền mới khai thì tab Giấy tờ phải nói rõ là trống',
          ).toBeVisible();
          await expect(
            main.getByRole('button', { name: 'Chọn file để đính kèm' }),
            'Tab Giấy tờ phải có đường đính kèm bản scan hợp đồng',
          ).toBeVisible();
        },
      },
      {
        name: /^Lịch sử$/,
        marker: async () => {
          await expect(
            main.getByRole('listitem').filter({ hasText: 'Tạo hồ sơ' }),
            'Tab Lịch sử phải có sẵn dòng "Tạo hồ sơ" — mọi hồ sơ đều sinh ra từ một lượt ghi',
          ).toBeVisible();
        },
      },
    ];

    for (const tab of tabMarkers) {
      const button = page.getByRole('tab', { name: tab.name });
      await button.click();
      await expect(button, `Bấm tab ${tab.name} thì chính nó phải sáng lên`).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await tab.marker();
    }

    /*
     * ===== HỘP "SỬA HỒ SƠ" — GIÁ TRỊ PHẢI ĐIỀN SẴN =====
     *
     * Form sửa hiện ra trống là kiểu hỏng tệ nhất trong nhóm này: nó không báo lỗi gì cả, chỉ
     * lặng lẽ gửi chuỗi rỗng đè lên mọi trường ngay khi người dùng bấm Lưu.
     */
    await page.getByRole('button', { name: 'Sửa hồ sơ' }).click();
    const editDialog = page.getByRole('dialog', { name: new RegExp(`^Sửa hồ sơ — ${itemCode}$`) });
    await expect(editDialog).toBeVisible();

    for (const [label, value] of [
      ['Mã đường', itemCode],
      ['Tốc độ gói cước', '100 Mbps'],
      ['IP WAN', '203.113.99.9'],
      ['Hotline', '18001166'],
      ['Số hợp đồng', `HD-E2E-${stamp}`],
      ['Ghi chú', note],
    ]) {
      await expect(
        editDialog.getByRole('textbox', { name: label, exact: true }),
        `Ô "${label}" của form Sửa phải mang sẵn giá trị cũ, không được trống`,
      ).toHaveValue(value);
    }
    await expect(
      editDialog.getByRole('button', { name: 'Nhà mạng' }),
      'Ô Nhà mạng cũng phải chọn sẵn — nó là ô BẮT BUỘC, trống là lưu không nổi',
    ).toContainText('VNPT E2E');
    await expect(
      editDialog.getByRole('button', { name: 'Bắt đầu' }),
      'Ô ngày bắt đầu phải hiện lại năm 2026 đã khai',
    ).toContainText('2026');
    await expect(
      editDialog.getByRole('button', { name: 'Hết hạn' }),
      'Form Sửa không còn ô Hết hạn — đường truyền không có hạn (Q-04)',
    ).toHaveCount(0);

    /*
     * Form Sửa KHÔNG có ô Trạng thái: đổi trạng thái chỉ đi menu ⋮ của trang chi tiết, nơi hộp
     * hỏi lại nhắc ngăn két PPPoE/modem và thiết bị biên. Ô chọn ở đây là lối tắt bỏ qua cả hai.
     */
    await expect(
      editDialog.getByRole('button', { name: 'Trạng thái', exact: true }),
      'Form Sửa đường truyền không được có ô Trạng thái — Thanh lý phải đi menu ⋮ và hỏi lại',
    ).toHaveCount(0);

    /*
     * ĐÓNG DANH SÁCH bằng cách bấm lại chính ô chọn, rồi đóng hộp bằng nút ✕.
     * Các option `portal` ra khỏi locator của hộp, nên phải hỏi ở tầng `page`.
     */
    await editDialog.getByRole('button', { name: 'Nhà mạng', exact: true }).click();
    await expect(page.getByRole('option').first(), 'Ô chọn Nhà mạng phải bung ra').toBeVisible();
    await editDialog.getByRole('button', { name: 'Nhà mạng', exact: true }).click();
    await expect(
      page.getByRole('option'),
      'Bấm lại vào ô chọn thì danh sách phải thu lại',
    ).toHaveCount(0);
    await expect(editDialog, 'Đóng danh sách chọn thì hộp Sửa vẫn phải còn đó').toBeVisible();

    await editDialog.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(editDialog, 'Nút ✕ phải đóng được hộp Sửa').toHaveCount(0);
  });

  /*
   * ===== BÀI 3b — Esc TRONG Ô CHỌN CHỈ ĐƯỢC ĐÓNG Ô CHỌN =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI: hàng rào giữ cho một lỗi thật không quay lại.
   *
   * TRIỆU CHỨNG KHI HỎNG: mở hồ sơ đường truyền → "Sửa hồ sơ" → bấm ô chọn Nhà mạng → gõ Esc.
   * Danh sách chọn không đóng một mình: CẢ HỘP Sửa biến mất, mang theo mọi ô vừa gõ. Người
   * dùng bàn phím gõ Esc để bỏ một menu vừa lỡ bung ra thì mất trắng lần nhập.
   *
   * NGUYÊN NHÂN, đã truy tới tận nơi:
   *   - `ui/select.tsx` và `ui/combobox.tsx` bắt Esc bằng `onKeyDown` của React rồi gọi
   *     `e.stopPropagation()` — chú thích ở `combobox.tsx` nói thẳng ý định: "đóng menu tại
   *     chỗ — KHÔNG để Escape lan lên đóng cả modal".
   *   - Nhưng Radix (`@radix-ui/react-dismissable-layer`) nghe `keydown` ở `document` với
   *     `capture: true`. Pha BẮT chạy xong trước khi sự kiện kịp bò tới handler của React,
   *     nên tới lượt ô chọn thì hộp đã đóng rồi. Một dòng `stopPropagation` trông rất hợp lý
   *     mà hoàn toàn vô hiệu.
   *   - Bản vá nằm ở `ui/dialog.tsx`: chặn tại `onEscapeKeyDown` — chỗ DUY NHẤT Radix hỏi ý
   *     trước khi đóng — và nhận ra "đang có popover mở" bằng việc điểm neo portal có con.
   *
   * ĐỎ KHI: bản vá đó bị gỡ, hoặc một hộp thoại nào đó thôi đi qua `ui/dialog.tsx`.
   */
  test('Esc khi đang mở ô chọn chỉ đóng ô chọn, KHÔNG đóng cả hộp Sửa', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = timestamp();
    const itemCode = `ISP-E2E-ESC-${stamp}`;
    const created = await page.request.post('/api/v1/isp-lines', {
      headers: await writeHeaders(page),
      data: { code: itemCode, providerId: await ispProviderId(page, 'VNPT E2E') },
    });
    expect(created.status(), 'Dàn cảnh: tạo một đường truyền để mở form Sửa').toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    await page.goto(`/isp-lines/${id}`);
    await page.getByRole('button', { name: 'Sửa hồ sơ' }).click();
    const editDialog = page.getByRole('dialog', { name: new RegExp(`^Sửa hồ sơ — ${itemCode}$`) });
    await expect(editDialog).toBeVisible();

    // Gõ dở một ô, để chỗ mất mát nhìn thấy được chứ không chỉ là "hộp biến mất".
    await editDialog.getByRole('textbox', { name: 'Ghi chú', exact: true }).fill('đang gõ dở E2E');

    await editDialog.getByRole('button', { name: 'Nhà mạng', exact: true }).click();
    await expect(page.getByRole('option').first(), 'Ô chọn phải bung ra danh sách').toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('option'), 'Esc phải đóng danh sách chọn').toHaveCount(0);
    await expect(
      editDialog,
      'Esc chỉ được đóng DANH SÁCH CHỌN — đóng luôn cả hộp là ném đi cả form đang gõ dở',
    ).toBeVisible();
    await expect(
      editDialog.getByRole('textbox', { name: 'Ghi chú', exact: true }),
      'Chữ đang gõ dở phải còn nguyên sau khi bỏ danh sách chọn',
    ).toHaveValue('đang gõ dở E2E');

    /*
     * ===== VÀ CÚ ESC THỨ HAI: KHÔNG CÒN MENU NÀO, NHƯNG VẪN CÒN CHỮ ĐANG GÕ =====
     *
     * `dismissible={!save.isPending}` chỉ chặn lúc lượt ghi ĐANG BAY; trước khi bấm Lưu thì cú
     * Esc này sẽ đóng thẳng hộp và ném đi cả form — nặng nhất là form Thiết bị với 15 ô.
     *
     * Nên `Dialog guardUnsaved` so chữ ký các ô nhập với ảnh chụp lúc mở hộp. Hai vế phải đi
     * đôi, và vế thứ hai (ở dưới) mới là vế giữ cho cửa này có nghĩa: hỏi lại ở MỌI lần đóng
     * cũng làm vế thứ nhất xanh, mà đó là bản tệ hơn — người dùng sẽ học cách bấm "Bỏ và đóng"
     * theo phản xạ, rồi bấm nó cả vào hôm có dữ liệu thật.
     */
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Bỏ những gì vừa nhập?' }),
      'còn chữ đang gõ mà Esc đóng thẳng là ném đi công sức người dùng, không hỏi một câu',
    ).toBeVisible();

    /*
     * KHÔNG khẳng định `editDialog` còn nhìn thấy Ở ĐÂY, dù nó vẫn nằm nguyên trong DOM.
     *
     * Radix đánh `aria-hidden` lên mọi thứ phía sau một modal đang mở — đúng chuẩn, để trình
     * đọc màn hình không lạc ra ngoài lớp trên cùng. Mà `aria-hidden` thì biến mất khỏi CÂY
     * TRỢ NĂNG, nên `getByRole('dialog')` không còn tìm ra nó. Một khẳng định ở đây sẽ đỏ vì
     * lý do chẳng liên quan gì tới thứ bài này muốn bảo vệ.
     *
     * Vế "hộp gốc sống sót" được chốt ngay bên dưới, SAU khi lớp trên đóng lại — lúc đó nó
     * trở lại cây trợ năng, và câu trả lời mới có nghĩa.
     */

    // Chọn "Ở lại nhập tiếp" → hộp gốc còn, và chữ vẫn y nguyên.
    await page.getByTestId('dialog-footer').last().getByRole('button').first().click();
    await expect(editDialog).toBeVisible();
    await expect(
      editDialog.getByRole('textbox', { name: 'Ghi chú', exact: true }),
    ).toHaveValue('đang gõ dở E2E');

    /*
     * VẾ ĐỐI CHỨNG: xoá về đúng như lúc mở hộp thì KHÔNG còn gì để mất, và Esc phải đóng
     * thẳng như mọi hộp khác. Thiếu vế này thì một bản vá chặn Esc vô điều kiện vẫn xanh.
     */
    await editDialog.getByRole('textbox', { name: 'Ghi chú', exact: true }).fill('');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Bỏ những gì vừa nhập?' }),
      'không còn gì khác lúc mở hộp thì hỏi lại là báo động giả',
    ).toHaveCount(0);
    await expect(editDialog, 'và lúc đó Esc phải đóng hộp như cũ').toBeHidden();
  });

  /*
   * ===== BÀI 4 — MÀN VÀ HỒ SƠ TÀI KHOẢN DỊCH VỤ =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Menu ba chấm của màn này ĐỔI THEO TRẠNG THÁI: tài khoản đang dùng có "Vô hiệu hóa", tài
   * khoản đã đóng có "Bật lại". `service-accounts.spec.ts` mới chỉ kiểm rằng sau khi đóng thì
   * mục "Vô hiệu hóa" biến đi (`not.toContain`) — nó KHÔNG nói gì về việc mục "Bật lại" có
   * thật sự mọc ra hay không. Một menu rỗng đi ở nhánh đó thì hồ sơ đã đóng là đóng vĩnh viễn
   * với người dùng giao diện, và không bài nào đỏ.
   *
   * Phần cuối bài đổi vai sang Thành viên: `RowActions` cố ý KHÔNG vẽ nút khi không có việc
   * nào làm được, và cả cột Thao tác cũng biến mất. Bài cũ chỉ kiểm nút "Thêm tài khoản" vắng
   * mặt — ở đây kiểm cả bộ nút, tức là kiểm luôn rằng không còn ba chấm nào sót lại.
   *
   * ĐỎ KHI: menu dòng thiếu/thừa mục ở một trong hai trạng thái; cột Thao tác lọt vào màn của
   * Thành viên; trang hồ sơ thiếu/thừa nút (chép, "Sửa hồ sơ", ba chấm đổi theo trạng thái); hoặc
   * nút "Chép tên đăng nhập" rơi mất.
   */
  test('Tài khoản dịch vụ: menu dòng đúng ở cả hai trạng thái, hồ sơ có Chép · Sửa hồ sơ · ba chấm, Thành viên không thấy ba chấm', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = timestamp();
    const activeCode = `TK-E2E-PHONG-${stamp}-A`;
    const disabledCode = `TK-E2E-PHONG-${stamp}-B`;
    const headers = await writeHeaders(page);

    const create = async (code: string, login: string): Promise<string> => {
      const res = await page.request.post('/api/v1/service-accounts', {
        headers,
        data: { code, kind: 'shared', name: `Tài khoản ${code}`, login },
      });
      expect(res.status(), `Dàn cảnh: tạo tài khoản ${code}`).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };

    await create(activeCode, 'e2e-dang-dung@pmh.com.vn');
    const disabledId = await create(disabledCode, 'e2e-da-dong@pmh.com.vn');
    expect(
      (
        await page.request.patch(`/api/v1/service-accounts/${disabledId}/disable`, {
          headers,
          data: { reason: 'dàn cảnh cho bài đi khắp giao diện' },
        })
      ).status(),
      'Dàn cảnh: đóng sẵn một tài khoản để có đủ HAI trạng thái trên cùng một màn',
    ).toBe(200);

    await page.goto('/service-accounts');
    const searchBox = page.getByRole('searchbox', { name: 'Tìm theo mã, tên, đăng nhập, phòng ban…' });
    await searchBox.fill(`TK-E2E-PHONG-${stamp}`);
    await expect(page.getByRole('row'), 'Lọc còn đúng hai tài khoản của lượt chạy này').toHaveCount(
      3,
    );

    /*
     * MENU DÒNG Ở HAI TRẠNG THÁI — khẳng định trung tâm của bài.
     * "Vô hiệu hóa" mang cờ `danger` nên `RowActions` luôn xếp nó XUỐNG CUỐI; "Bật lại" thì
     * không, nên thứ tự hai mục giữ nguyên như lúc khai. Cả thứ tự cũng được chốt ở đây, vì
     * nó là lời hứa về trí nhớ cơ bắp: mục cuối cùng luôn là mục phải nghĩ trước khi bấm.
     */
    expect(
      (await rowActionNames(page, activeCode)).map(tidyLabel),
      'Tài khoản ĐANG DÙNG có đúng hai việc: Sửa, rồi Vô hiệu hóa (việc nguy hiểm xếp cuối)',
    ).toEqual(['Sửa', 'Ngừng dùng']);
    expect(
      (await rowActionNames(page, disabledCode)).map(tidyLabel),
      'Tài khoản ĐÃ ĐÓNG phải có đường mở lại — thiếu nó là hồ sơ đóng vĩnh viễn với giao diện',
    ).toEqual(['Sửa', 'Dùng lại']);

    // Bộ nút và bộ cột đầy đủ của vai SA — thu hẹp còn một dòng cho phần phân trang cố định.
    await searchBox.fill(activeCode);
    await expect(page.getByRole('row')).toHaveCount(2);
    const main = page.getByRole('main');

    expect(
      await tableColumnNames(main),
      'Bảng tài khoản dịch vụ của SA có đúng 7 cột (Q-15: thêm "Đổi lần cuối"), cột cuối là Thao tác',
    ).toEqual([
      'Mã tài khoản',
      'Loại',
      'Tên đăng nhập',
      'Thuộc về',
      'Trạng thái',
      'Đổi lần cuối',
      'Thao tác',
    ]);
    expect(
      await nameByRole(main, 'button'),
      'Bộ nút của màn Tài khoản dịch vụ khi đăng nhập bằng SA',
    ).toEqual(
      sortVi([
        'Xuất Excel',
        'Thêm tài khoản',
        'Loại',
        'Trạng thái',
        // NET-074: chip lọc tài khoản VPN không giới hạn IP nguồn.
        'VPN mở mọi IP',
        'Sắp theo',
        'Sắp xếp theo Mã tài khoản',
        'Sắp xếp theo Loại',
        'Sắp xếp theo Trạng thái',
        `Thao tác với ${activeCode}`,
        'Số dòng',
        'Trang trước',
        'Trang sau',
      ]),
    );

    /*
     * ===== TRANG HỒ SƠ =====
     * Vào bằng cách BẤM mã. SA/Admin sửa và đóng được NGAY tại đây ("Sửa hồ sơ" + ba chấm),
     * không phải quay ra danh sách tìm lại dòng. Nút chép tên đăng nhập vẫn phải có — thứ
     * người ta dán thẳng vào ô đăng nhập và gõ tay thì sai.
     */
    await main.getByRole('link', { name: activeCode, exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(activeCode) }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toMatch(/^\/service-accounts\/[0-9a-f-]{36}$/);

    expect(
      await nameByRole(page.getByRole('main'), 'button'),
      'Hồ sơ tài khoản dịch vụ của SA: Chép tên đăng nhập, Sửa hồ sơ, ba chấm — và nút cất của tab Két sắt đang mở sẵn (NET-075)',
    ).toEqual(
      sortVi([
        'Chép tên đăng nhập',
        'Sửa hồ sơ',
        `Thao tác với ${activeCode}`,
        'Cất mật khẩu/khóa',
      ]),
    );
    await page.getByRole('button', { name: `Thao tác với ${activeCode}` }).click();
    await expect(
      page.getByRole('menuitem'),
      'ba chấm của hồ sơ đang dùng chỉ có việc đóng nó',
    ).toHaveText(['Ngừng dùng…']);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    const tabName = (await page.getByRole('tab').allTextContents()).map((raw) =>
      tidyLabel(raw).replace(/\s+\d+$/, ''),
    );
    /* NET-075: khu Hồ sơ (ghi chú + "Chưa khai") đứng thẳng đầu cột chính, không sau một
       tab — thanh tab mở vào Két sắt. */
    expect(
      tabName,
      'Hồ sơ tài khoản dịch vụ: ba tab Két sắt · Giấy tờ · Lịch sử, khu Hồ sơ nằm trên thanh tab',
    ).toEqual(['Két sắt', 'Giấy tờ', 'Lịch sử']);
    await expect(page.getByText('Chưa khai:')).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Két sắt/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    for (const [name, marker] of [
      [/^Két sắt/, page.getByText(/Nơi cất mật khẩu và license key/)],
      [/^Giấy tờ/, page.getByText('Chưa có giấy tờ nào.')],
      [/^Lịch sử$/, page.getByRole('listitem').filter({ hasText: 'Tạo hồ sơ' })],
    ] as [RegExp, Locator][]) {
      const button = page.getByRole('tab', { name: name });
      await button.click();
      await expect(button, `Bấm tab ${name} thì chính nó phải sáng lên`).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(marker, `Tab ${name} phải mở ra nội dung riêng của nó`).toBeVisible();
    }

    /*
     * ===== ĐỔI VAI: THÀNH VIÊN =====
     * Ghi chỉ SA/Admin. Giao diện không được bày nút ra để bấm rồi mới 403 — kể cả cái nút ba
     * chấm chỉ dẫn tới hai việc đều bị chặn.
     */
    await logout(page);
    await firstLogin(page, E2E_MEMBER);
    await page.goto('/service-accounts');
    await page
      .getByRole('searchbox', { name: 'Tìm theo mã, tên, đăng nhập, phòng ban…' })
      .fill(activeCode);
    await expect(page.getByRole('row')).toHaveCount(2);

    const mainMember = page.getByRole('main');
    expect(
      await tableColumnNames(mainMember),
      'Thành viên KHÔNG thấy cột Thao tác — cột đó chỉ dựng khi có quyền ghi',
    ).toEqual(['Mã tài khoản', 'Loại', 'Tên đăng nhập', 'Thuộc về', 'Trạng thái']);
    expect(
      await nameByRole(mainMember, 'button'),
      'Bộ nút của Thành viên: không có "Thêm tài khoản", không có một nút ba chấm nào (Xuất Excel thì có — file không chứa mật khẩu)',
    ).toEqual(
      sortVi([
        'Xuất Excel',
        'Loại',
        'Trạng thái',
        // NET-074: chip lọc tài khoản VPN không giới hạn IP nguồn.
        'VPN mở mọi IP',
        'Sắp theo',
        'Sắp xếp theo Mã tài khoản',
        'Sắp xếp theo Loại',
        'Sắp xếp theo Trạng thái',
        'Số dòng',
        'Trang trước',
        'Trang sau',
      ]),
    );
  });

  /*
   * ===== BÀI 5 — BÊN TRONG HAI CÁI HỘP CỦA TÀI KHOẢN DỊCH VỤ =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Form tài khoản dịch vụ là form DUY NHẤT trong phòng này ĐỔI HÌNH giữa chừng: chọn loại
   * "Tài khoản VPN" thì mọc thêm cả một khối gồm Nhóm VPN và Dải IP được phép; chọn lại "dùng
   * chung" thì khối đó biến đi VÀ hai ô vừa gõ bị xóa. `service-accounts.spec.ts` có bấm qua
   * nhánh VPN, nhưng chỉ để điền hai ô rồi lưu — nó không hỏi "trước khi đổi loại thì form có
   * những ô nào", nên nếu hai ô VPN lỡ hiện ra với CẢ tài khoản dùng chung thì không gì đỏ.
   *
   * Hộp "Vô hiệu hóa" soi ở đây vì đường hỏng của nó chưa từng đi qua giao diện: bài cũ gọi
   * thẳng API với lý do rỗng. Trên màn hình, thứ chặn lại là `required` của HTML — không có
   * `role="alert"` nào cả, và đó là điều phải ghi ra đúng như thật.
   *
   * ĐỎ KHI: một ô rơi khỏi form ở một trong hai loại; hai ô VPN rò sang loại dùng chung; ô Mật
   * khẩu đổi thành ô chữ thường (giá trị hiện nguyên trên màn hình); ô Trạng thái thành ô chọn
   * được (cửa sau lách qua đường bắt-ghi-lý-do); hoặc hộp Vô hiệu hóa cho đóng tài khoản mà
   * không cần lý do.
   */
  test('Hộp "Thêm tài khoản" đổi hình theo loại, và hộp "Vô hiệu hóa" không cho bỏ trống lý do', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = timestamp();
    const itemCode = `TK-E2E-HOP-${stamp}`;

    await page.goto('/service-accounts');
    await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
    const dialog = page.getByRole('dialog', { name: 'Thêm tài khoản' });
    await expect(dialog).toBeVisible();

    /**
     * Ô gõ chữ của loại "dùng chung" — chưa có Nhóm VPN và Dải IP.
     *
     * "Mật khẩu" NẰM TRONG mảng này: `input[type=password]` được ánh xạ sang vai trò `textbox`
     * y như một ô chữ thường (cây trợ năng không có vai trò riêng cho ô mật khẩu). Nghĩa là
     * thứ DUY NHẤT ngăn mật khẩu hiện nguyên hình trên màn hình một phòng làm việc chung là
     * thuộc tính `type` — nên nó được kiểm riêng ngay dưới đây.
     */
    const SHARED_FIELDS = [
      'Tên đăng nhập',
      'Mã tài khoản',
      'Tên tài khoản',
      'Người phụ trách',
      'Mật khẩu',
      'Ghi chú',
    ];

    expect(
      await dialogBlockNames(dialog),
      'Hộp thêm tài khoản dùng chung có năm khối — CHƯA có khối Cấu hình VPN',
    ).toEqual(
      sortVi([
        'Thêm tài khoản',
        'Hồ sơ',
        'Thuộc về ai',
        'Mật khẩu (cất vào két)',
        /* Khu Ghi chú KHÔNG còn tiêu đề riêng: nó chỉ có một ô, mà nhãn ô cũng là
           "Ghi chú" — hai dòng y hệt chồng nhau. */
        'Giấy tờ đính kèm',
      ]),
    );
    expect(
      await nameByRole(dialog, 'textbox'),
      'Loại "dùng chung" có đúng sáu ô gõ chữ — hai ô VPN không được rò sang đây',
    ).toEqual(sortVi(SHARED_FIELDS));
    expect(
      await nameByRole(dialog, 'combobox'),
      'Phòng ban là ô GỢI Ý (gõ tự do được), không phải ô chọn cứng',
    ).toEqual(['Phòng ban']);
    expect(
      await nameByRole(dialog, 'button'),
      'Hộp thêm tài khoản có đúng bảy nút: ô chọn Loại, Hiện + Tạo ngẫu nhiên của ô mật khẩu, ô chọn file, ✕, Hủy, Lưu',
    ).toEqual(
      sortVi([
        'Đóng hộp thoại',
        'Loại',
        'Hiện',
        'Tạo ngẫu nhiên',
        'Chọn file để đính kèm',
        'Hủy',
        'Lưu',
      ]),
    );

    /*
     * Ô MẬT KHẨU: cây trợ năng KHÔNG phân biệt nó với một ô chữ thường.
     *
     * Nó nằm chung trong tập `textbox` ở trên, nên tập hợp đó một mình không đủ để nói "mật
     * khẩu vẫn được che". Thứ duy nhất che ký tự là thuộc tính `type`, và đổi một chữ ở đó là
     * mật khẩu hiện nguyên hình trên màn hình của một phòng làm việc chung — nên nó phải có
     * một khẳng định riêng.
     */
    const passwordField = dialog.getByLabel('Mật khẩu', { exact: true });
    await expect(passwordField, 'Hộp thêm mới phải có ô cất mật khẩu thẳng vào két').toHaveCount(1);
    await expect(passwordField, 'Ô mật khẩu phải là ô che ký tự').toHaveAttribute('type', 'password');

    /*
     * KHÔNG có ô Trạng thái trong form — đổi trạng thái bắt buộc đi qua hộp riêng có ghi lý do.
     * (Tập hợp nút ở trên đã nói điều này; câu dưới nói ra thành lời.)
     */
    await expect(
      dialog.getByRole('button', { name: 'Trạng thái', exact: true }),
      'Có ô chọn trạng thái ở đây là mở cửa sau cho lượt đóng không lý do',
    ).toHaveCount(0);
    await expect(dialog.getByText('Trạng thái', { exact: true })).toHaveCount(0);

    /*
     * ===== ĐỔI LOẠI: HÌNH DẠNG PHẢI ĐỔI THEO =====
     */
    await dialog.getByRole('button', { name: 'Loại', exact: true }).click();
    expect(
      (await page.getByRole('option').allTextContents()).map(tidyLabel),
      'Tài khoản dịch vụ có đúng hai loại của `SERVICE_ACCOUNT_KINDS`',
    ).toEqual(['Tài khoản dùng chung', 'Tài khoản VPN']);
    await page.getByRole('option', { name: 'Tài khoản VPN', exact: true }).click();

    expect(
      await dialogBlockNames(dialog),
      'Chọn loại VPN thì khối "Cấu hình VPN" phải mọc ra',
    ).toEqual(
      sortVi([
        'Thêm tài khoản',
        'Hồ sơ',
        'Thuộc về ai',
        'Cấu hình VPN',
        'Mật khẩu (cất vào két)',
        /* Khu Ghi chú KHÔNG còn tiêu đề riêng: nó chỉ có một ô, mà nhãn ô cũng là
           "Ghi chú" — hai dòng y hệt chồng nhau. */
        'Giấy tờ đính kèm',
      ]),
    );
    expect(
      await nameByRole(dialog, 'textbox'),
      'Loại VPN có thêm đúng hai ô: Nhóm VPN và Dải IP được phép',
    ).toEqual(sortVi([...SHARED_FIELDS, 'Nhóm VPN', 'Dải IP được phép']));

    // Đổi NGƯỢC lại: hai ô kia phải biến đi, không được nằm ẩn rồi vẫn gửi lên.
    await dialog.getByRole('textbox', { name: 'Nhóm VPN' }).fill('vpn-e2e-ketoan');
    await dialog.getByRole('button', { name: 'Loại', exact: true }).click();
    await page.getByRole('option', { name: 'Tài khoản dùng chung', exact: true }).click();
    expect(
      await nameByRole(dialog, 'textbox'),
      'Quay về loại dùng chung thì hai ô VPN phải biến mất — giữ lại là ghi ra dữ liệu vô nghĩa',
    ).toEqual(sortVi(SHARED_FIELDS));

    /*
     * Ô BẮT BUỘC: bỏ trống hết rồi bấm Lưu.
     * Ô Tên đăng nhập bắt buộc khi ô Mã còn trống. Form đặt `noValidate` nên không còn bong bóng
     * tiếng Anh: câu tiếng Việt nằm dưới và nối vào chính ô đó, hộp KHÔNG đóng.
     */
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu' }).click();
    await expect(dialog, 'Form trống mà bấm Lưu thì hộp phải ở lại').toBeVisible();
    expect(
      await dialog
        .getByRole('textbox', { name: 'Tên đăng nhập' })
        .evaluate((el) => (el as HTMLInputElement).validity.valueMissing),
      'Chưa khai mã thì Tên đăng nhập là ô BẮT BUỘC — không có nó thì hồ sơ không có gì để gọi tên',
    ).toBe(true);
    await expect(
      dialog.getByRole('textbox', { name: 'Tên đăng nhập' }),
      'và nói ra bằng tiếng Việt, ngay dưới ô',
    ).toHaveAccessibleDescription(/Nhập tên đăng nhập, hoặc tự đặt Mã bên dưới\./);

    await dialog.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(dialog, 'Nút ✕ phải đóng được hộp thêm tài khoản').toHaveCount(0);

    /*
     * ===== HỘP "VÔ HIỆU HÓA" =====
     */
    const created = await page.request.post('/api/v1/service-accounts', {
      headers: await writeHeaders(page),
      data: { code: itemCode, kind: 'shared', name: 'Tài khoản kiểm hộp đóng', login: 'e2e-hop@pmh.com.vn' },
    });
    expect(created.status(), 'Dàn cảnh: tạo tài khoản để mở hộp Vô hiệu hóa').toBe(201);

    await page.goto('/service-accounts');
    await page.getByRole('searchbox', { name: 'Tìm theo mã, tên, đăng nhập, phòng ban…' }).fill(itemCode);
    await expect(page.getByRole('row')).toHaveCount(2);
    await rowAction(page, itemCode, 'Ngừng dùng');

    const disableDialog = page.getByRole('dialog', { name: new RegExp(`^Ngừng dùng — ${itemCode}$`) });
    await expect(disableDialog, 'Menu dòng phải mở ra hộp mang đúng mã tài khoản').toBeVisible();

    expect(
      await dialogBlockNames(disableDialog),
      'Hộp ngừng dùng không chia khối — chỉ có tiêu đề',
    ).toEqual([`Ngừng dùng — ${itemCode}`]);
    expect(
      await nameByRole(disableDialog, 'textbox'),
      'Hộp ngừng dùng có đúng MỘT ô: lý do. Không có ô nào khác để lách.',
    ).toEqual(['Lý do ngừng dùng']);
    expect(
      await nameByRole(disableDialog, 'button'),
      'Hộp ngừng dùng có đúng ba nút: ✕, Hủy, Ngừng dùng',
    ).toEqual(sortVi(['Đóng hộp thoại', 'Hủy', 'Ngừng dùng']));
    await expect(
      disableDialog.getByText(/Hồ sơ không bị xóa/),
      'Hộp phải nói rõ đóng ≠ xóa — người bấm đang quyết định một việc, không phải bấm cho xong',
    ).toBeVisible();

    // BỎ TRỐNG LÝ DO: không đi được. Sáu tháng sau sẽ có người hỏi "vì sao đóng".
    await disableDialog.getByTestId('dialog-footer').getByRole('button', { name: 'Ngừng dùng' }).click();
    await expect(disableDialog, 'Bỏ trống lý do thì hộp phải ở lại, không được đóng tài khoản').toBeVisible();
    expect(
      await disableDialog
        .getByRole('textbox', { name: 'Lý do ngừng dùng' })
        .evaluate((el) => (el as HTMLInputElement).validity.valueMissing),
      'Ô lý do phải là ô BẮT BUỘC — đó là toàn bộ lý do hộp này tồn tại',
    ).toBe(true);
    await expect(
      disableDialog.getByRole('textbox', { name: 'Lý do ngừng dùng' }),
      'Câu lỗi tiếng Việt dưới ô lý do, không phải bong bóng trình duyệt',
    ).toHaveAccessibleDescription('Bắt buộc — chưa nhập ô này.');
    // Gõ quá ngắn: `minLength` của trình duyệt không còn chặn (form `noValidate`) — hook phải nói.
    await disableDialog.getByRole('textbox', { name: 'Lý do ngừng dùng' }).fill('ab');
    await expect(
      disableDialog.getByRole('textbox', { name: 'Lý do ngừng dùng' }),
    ).toHaveAccessibleDescription('Cần ít nhất 3 ký tự.');

    // Ô lý do đã có chữ ('ab') nên Esc hỏi lại trước khi bỏ — đúng luật hộp có dữ liệu chưa lưu.
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Bỏ những gì vừa nhập?' }).getByRole('button', { name: 'Bỏ và đóng' }).click();
    await expect(disableDialog, 'Esc (rồi xác nhận bỏ) phải đóng được hộp vô hiệu hóa').toHaveCount(0);
    await expect(
      page.getByRole('row', { name: new RegExp(itemCode) }).getByText('Đang dùng'),
      'Hủy giữa chừng thì tài khoản phải còn nguyên trạng thái đang dùng',
    ).toBeVisible();
  });

  /*
   * ===== BÀI 6 — KHO THANH LÝ LÀ PHÒNG CHỈ ĐỌC =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI — và vì sao nó là bài quan trọng nhất của khối này
   *
   * `disposal-screen.tsx` viết rõ trong chú thích: "Màn này KHÔNG ghi gì. Đưa một hồ sơ vào kho
   * là việc của chính module chủ." Đó là một lời hứa kiến trúc, và cho tới nay nó chỉ được giữ
   * bằng kỷ luật của người viết — không có gì cưỡng chế.
   *
   * Một cái nút lọt vào đây không hỏng ngay: nó chạy, nó gọi API, và nó tạo ra ĐƯỜNG GHI THỨ
   * HAI cho cùng một trạng thái. Từ đó "thiết bị đã thanh lý" có hai nguồn sự thật, và câu
   * "công ty đã bỏ những gì trong quý này" lại thành câu không ai trả lời được — đúng cái mà
   * màn này sinh ra để giải quyết.
   *
   * Vì thế khẳng định ở đây là khẳng định TẬP HỢP RỖNG-TRỪ-BỘ-LỌC: toàn bộ nút trong vùng nội
   * dung phải đúng bằng năm nút lọc theo loại. Không nút thêm, không nút sửa, không nút xóa,
   * không một cái ba chấm nào.
   *
   * ĐỎ KHI: bất kỳ nút nào khác năm nút lọc xuất hiện; nhóm lọc thiếu/thừa một loại; con số
   * đếm rời khỏi nút lọc; bảng đổi số cột; hoặc dòng ghi chú giải thích biến mất.
   */
  test('Kho thanh lý: năm nút lọc kèm số đếm, bốn cột, một dòng ghi chú — và KHÔNG một nút ghi nào', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = timestamp();
    const headers = await writeHeaders(page);

    /*
     * Dàn cảnh: đưa HAI loại hồ sơ vào kho qua đúng đường của module chủ.
     * Bảng phải có ít nhất một dòng, không thì màn rơi vào nhánh `EmptyState` và bài kiểm này
     * xanh vì chẳng có gì để kiểm — đúng kiểu khẳng định luôn-xanh phải tránh.
     */
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const pcType = catalog.deviceTypes.find((type) => type.name === 'PC');
    expect(pcType, 'Dàn cảnh: danh mục phải có sẵn loại thiết bị "PC"').toBeTruthy();

    const deviceCode = `PC-E2E-KHO-${stamp}`;
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: deviceCode, name: 'Máy cũ của bài đi khắp giao diện', deviceTypeId: pcType!.id },
    });
    expect(device.status(), 'Dàn cảnh: tạo thiết bị').toBe(201);
    const idMay = ((await device.json()) as { device: { id: string } }).device.id;
    expect(
      (
        await page.request.patch(`/api/v1/devices/${idMay}/status`, {
          headers,
          data: { status: 'retired' },
        })
      ).status(),
      'Dàn cảnh: thanh lý thiết bị qua đúng module chủ',
    ).toBe(200);

    const accountCode = `TK-E2E-KHO-${stamp}`;
    const account = await page.request.post('/api/v1/service-accounts', {
      headers,
      data: { code: accountCode, kind: 'shared', name: 'Tài khoản cũ' },
    });
    expect(account.status(), 'Dàn cảnh: tạo tài khoản dịch vụ').toBe(201);
    const accountId = ((await account.json()) as { id: string }).id;
    expect(
      (
        await page.request.patch(`/api/v1/service-accounts/${accountId}/disable`, {
          headers,
          data: { reason: 'dàn cảnh cho bài kho thanh lý' },
        })
      ).status(),
      'Dàn cảnh: vô hiệu hóa tài khoản qua đúng đường bắt-ghi-lý-do',
    ).toBe(200);

    await page.goto('/disposal');
    await expect(page.getByRole('heading', { level: 1, name: /^Kho thanh lý$/ })).toBeVisible();
    const main = page.getByRole('main');

    await expect(
      main.getByRole('row', { name: new RegExp(deviceCode) }),
      'Thiết bị đã thanh lý phải nằm trong kho',
    ).toBeVisible();
    await expect(
      main.getByRole('row', { name: new RegExp(accountCode) }),
      'Tài khoản đã vô hiệu hóa cũng vào chung một kho — đó là toàn bộ lý do màn này tồn tại',
    ).toBeVisible();

    /*
     * ===== KHẲNG ĐỊNH QUAN TRỌNG NHẤT =====
     * Toàn bộ điều khiển trong vùng nội dung = năm lựa chọn lọc theo loại + ba khoảng thanh lý
     * (radio) + bộ nút CHỈ ĐỌC (từ–đến ngày, sắp xếp, lật trang, Xuất Excel — DP-004). Không
     * một nút nào ghi. Con số đếm cắt ra so riêng, vì nó thay đổi theo dữ liệu; phần CHỮ thì
     * cố định.
     */
    // Nút ⋯ của từng dòng (chỉ dẫn đường, không ghi gì) không tính vào bộ nút.
    const typeGroup = main.getByRole('radiogroup', { name: 'Lọc theo loại hồ sơ' });
    const buttonName = await nameByRole(typeGroup, 'radio');
    expect(
      buttonName.map((name) => name.replace(/\s+\d+$/, '')),
      'Nhóm lọc theo loại có đúng năm lựa chọn',
    ).toEqual(sortVi(['Tất cả', 'Thiết bị', 'Phần mềm', 'Tài khoản dịch vụ', 'Đường truyền']));
    expect(
      sortVi((await nameByRole(main, 'radio')).map((name) => name.replace(/\s+\d+$/, ''))),
      'Lựa chọn lọc của kho: năm loại + ba khoảng thanh lý (DP-004)',
    ).toEqual(
      sortVi([
        'Tất cả',
        'Thiết bị',
        'Phần mềm',
        'Tài khoản dịch vụ',
        'Đường truyền',
        'Tháng này',
        'Quý này',
        'Năm nay',
      ]),
    );
    expect(
      sortVi(
        (await nameByRole(main, 'button'))
          .filter((name) => !name.startsWith('Thao tác với'))
          .map((name) => name.replace(/\s+\d+$/, '')),
      ),
      'Kho thanh lý CHỈ được có nút lọc/đọc — một nút ghi ở đây là một hồ sơ đã thanh lý bị sửa',
    ).toEqual(
      sortVi([
        // DP-004: từ–đến ngày, sắp xếp, lật trang, xuất đúng cái đang xem.
        'Thanh lý từ ngày',
        'Thanh lý đến ngày',
        'Sắp xếp',
        'Số dòng',
        'Trang trước',
        'Trang sau',
        'Xuất Excel',
      ]),
    );
    for (const name of buttonName) {
      expect(name, `Nút lọc "${name}" phải mang số đếm — nút lọc không có số thì hết là bộ đếm`).toMatch(
        /\s\d+$/,
      );
    }

    // Nói thẳng ra ba thứ tuyệt đối không được có, để log lúc đỏ đọc là hiểu ngay.
    /*
     * Menu ⋯ của kho CHỈ dẫn đường (DP-006): "Mở hồ sơ", và "Khôi phục…" cho phần mềm — không
     * mục nào ghi dữ liệu ngay tại đây, sửa vẫn về đúng module chủ.
     */
    expect(
      await rowActionNames(page, deviceCode),
      'Thiết bị trong kho: chỉ có lối mở hồ sơ gốc',
    ).toEqual(['Mở hồ sơ']);
    // "Xuất Excel" ĐƯỢC có (DP-004): nó chỉ đọc, và lượt xuất vẫn ghi sổ `disposal.exported`.
    for (const forbiddenLabel of [/Thêm/, /^Sửa/, /^Xóa/, /Khôi phục/]) {
      await expect(
        main.getByRole('button', { name: forbiddenLabel }),
        `Kho thanh lý không được có nút khớp ${forbiddenLabel} — sửa thì về đúng module chủ`,
      ).toHaveCount(0);
    }

    /*
     * SỐ ĐẾM PHẢI LÀ SỐ ĐẾM: "Tất cả" bằng tổng bốn loại. Đếm trên tập ĐÃ LỌC thì bấm vào đâu
     * cũng thấy "đúng", và con số hết mang thông tin nào.
     */
    const countOf = (name: string): number => {
      const match = buttonName.find((raw) => raw.startsWith(`${name} `));
      expect(match, `Phải tìm được nút lọc "${name}"`).toBeTruthy();
      return Number(match!.replace(/^.*\s(\d+)$/, '$1'));
    };
    expect(
      countOf('Tất cả'),
      'Số của "Tất cả" phải bằng tổng bốn loại — nếu không thì nó đang đếm trên tập đã lọc',
    ).toBe(
      countOf('Thiết bị') + countOf('Phần mềm') + countOf('Tài khoản dịch vụ') + countOf('Đường truyền'),
    );

    await expect(
      main.getByRole('radiogroup', { name: 'Lọc theo loại hồ sơ' }),
      'Năm nút lọc phải nằm trong một nhóm có tên — rời rạc thì trình đọc màn hình không biết chúng là một bộ',
    ).toBeVisible();

    // ĐỦ CỘT, không hơn: ai thanh lý và khi nào lấy từ lịch sử module chủ (DP-002).
    expect(
      await tableColumnNames(main),
      'Bảng kho thanh lý: Mã · Loại · Chi tiết · Ngày thanh lý · Người thanh lý · Thao tác (chỉ dẫn đường)',
    ).toEqual(['Mã', 'Loại', 'Chi tiết', 'Ngày thanh lý', 'Người thanh lý', 'Thao tác']);

    await expect(
      main.getByText(/không còn tính hạn và không vào email nhắc gia hạn/),
      'Phải còn dòng giải thích: vì sao hồ sơ ở đây thôi làm phiền, và muốn dùng lại thì đi đâu',
    ).toBeVisible();

    // Bộ lọc CHẠY THẬT: bấm "Thiết bị" thì tài khoản dịch vụ biến đi.
    await main.getByRole('radio', { name: /^Thiết bị \d+$/ }).click();
    await expect(
      main.getByRole('row', { name: new RegExp(deviceCode) }),
      'Lọc theo Thiết bị thì thiết bị phải còn',
    ).toBeVisible();
    await expect(
      main.getByRole('row', { name: new RegExp(accountCode) }),
      'Lọc theo Thiết bị thì tài khoản dịch vụ phải biến đi — không thì nút lọc chỉ để trang trí',
    ).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('kind'), 'Bộ lọc loại nằm trên URL (DP-005)').toBe(
      'device',
    );

    /*
     * Và vẫn mở được hồ sơ GỐC: "đã thanh lý" không phải "đã xoá". Người ta mở nó ra chính để
     * đọc lịch sử vì sao bỏ — đó là đường ĐỌC duy nhất mà màn này cung cấp.
     */
    await main.getByRole('link', { name: deviceCode, exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(deviceCode) }),
      'Bấm mã trong kho phải mở đúng hồ sơ gốc ở module chủ',
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toMatch(/^\/devices\/[0-9a-f-]{36}$/);
  });
});
