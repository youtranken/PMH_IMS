import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  E2E_SA,
  confirmAction,
  devicesPageButton,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetUsers,
  rowActionNames,
  searchAndWaitForFilter,
  writeHeaders,
  uniqueStamp,
} from './helpers';

/**
 * ===== PHẦN HAI: VÀO HẲN TỪNG PHÒNG =====
 *
 * Bốn khối trên đi HÀNH LANG — menu nối đi đâu, ai mở được cửa nào, breadcrumb có đường về
 * không. Sáu khối dưới đây bước hẳn VÀO TRONG từng phòng và kiểm kê đồ đạc: đầu trang có đúng
 * những nút nào, lọc được theo gì, bảng có đúng những cột nào và cột nào sắp được, menu ba
 * chấm của một dòng có đúng những việc nào — và ở mỗi trạng thái khác nhau thì nó đổi ra sao.
 *
 * Rồi mở TỪNG hộp thoại ra soi bên trong: đủ ô chưa, mỗi ô đúng loại tay nắm chưa (ô chữ hay
 * ô chọn hay ô tra cứu — người dùng bàn phím thao tác khác hẳn nhau), bấm Lưu lúc còn thiếu
 * thì báo đúng câu gì và hộp có chịu ở lại không, mở form Sửa ra thì giá trị cũ còn nguyên
 * không, và đóng được bằng cả ✕ lẫn Esc không.
 *
 * VÌ SAO PHẢI SO TẬP HỢP, KHÔNG PHẢI `toBeVisible()` TỪNG CÁI: một khẳng định "nút X có mặt"
 * không bao giờ đỏ khi nút Y THỪA ra. Mà thừa mới là kiểu hỏng nguy hiểm — một nút ghi lọt vào
 * màn chỉ-đọc, một mục "Xóa" mọc ra ở hồ sơ đã khóa, một ô của danh mục này bày sang danh mục
 * kia. Nên gần như mọi khẳng định dưới đây là `toEqual` trên MỘT TẬP HỢP ĐẦY ĐỦ.
 */

/*
 * ===== PHÒNG THIẾT BỊ — BƯỚC HẲN VÀO TRONG, KHÔNG ĐỨNG Ở CỬA =====
 *
 * Bốn khối trên kia đi HÀNH LANG: menu dẫn tới đâu, breadcrumb quay ra lối nào, vai nào mở
 * được cửa nào. Chúng chứng minh cánh cửa `/devices` còn mở — nhưng KHÔNG nói gì về thứ nằm
 * sau cánh cửa đó.
 *
 * Năm bài dưới đây làm đúng phần còn thiếu: kiểm KIỂM KÊ của căn phòng. Đầu trang có đúng
 * mấy cái nút, thanh lọc có mấy ô và mỗi ô mở ra những lựa chọn nào, bảng có đủ cột không và
 * cột nào sắp xếp được, phân trang đổi số dòng có ăn thật không, mỗi hộp thoại ghi có đủ ô
 * nhập không — và trong hồ sơ một cái máy, từng tab bày ra cái gì.
 *
 * VÌ SAO KIỂM KÊ LẠI ĐÁNG MỘT BÀI RIÊNG. `devices.spec.ts` và `device-detail.spec.ts` kiểm
 * NGHIỆP VỤ: tạo được máy, lọc ra đúng máy, thanh lý thì khóa hồ sơ. Mọi bài đó vẫn xanh
 * nguyên khi một cái nút biến mất, một cột bị gỡ, một ô nhập lặng lẽ rơi khỏi form — vì chúng
 * chỉ chạm vào đúng những tay nắm chúng cần. Một trường không còn ô để nhập là một trường
 * không bao giờ được điền nữa, và không có gì đỏ lên.
 *
 * NÊN MỌI KHẲNG ĐỊNH Ở ĐÂY LÀ SO TẬP HỢP ĐẦY ĐỦ (`toEqual` trên một mảng tên), không phải
 * `toBeVisible()` từng cái. `toBeVisible()` bắt được thứ MẤT ĐI; chỉ so tập hợp mới bắt được
 * thứ THỪA RA — một nút mới ai đó nhét vào đầu trang, một ô chọn mọc thêm trong form.
 */

/*
 * ===== PHÒNG THIẾT BỊ — BƯỚC HẲN VÀO TRONG, KHÔNG ĐỨNG Ở CỬA =====
 *
 * Bốn khối trên kia đi HÀNH LANG: menu dẫn tới đâu, breadcrumb quay ra lối nào, vai nào mở
 * được cửa nào. Chúng chứng minh cánh cửa `/devices` còn mở — nhưng KHÔNG nói gì về thứ nằm
 * sau cánh cửa đó.
 *
 * Năm bài dưới đây làm đúng phần còn thiếu: kiểm KIỂM KÊ của căn phòng. Đầu trang có đúng
 * mấy cái nút, thanh lọc có mấy ô và mỗi ô mở ra những lựa chọn nào, bảng có đủ cột không và
 * cột nào sắp xếp được, phân trang đổi số dòng có ăn thật không, mỗi hộp thoại ghi có đủ ô
 * nhập không — và trong hồ sơ một cái máy, từng tab bày ra cái gì.
 *
 * VÌ SAO KIỂM KÊ LẠI ĐÁNG MỘT BÀI RIÊNG. `devices.spec.ts` và `device-detail.spec.ts` kiểm
 * NGHIỆP VỤ: tạo được máy, lọc ra đúng máy, thanh lý thì khóa hồ sơ. Mọi bài đó vẫn xanh
 * nguyên khi một cái nút biến mất, một cột bị gỡ, một ô nhập lặng lẽ rơi khỏi form — vì chúng
 * chỉ chạm vào đúng những tay nắm chúng cần. Một trường không còn ô để nhập là một trường
 * không bao giờ được điền nữa, và không có gì đỏ lên.
 *
 * NÊN MỌI KHẲNG ĐỊNH Ở ĐÂY LÀ SO TẬP HỢP ĐẦY ĐỦ (`toEqual` trên một mảng tên), không phải
 * `toBeVisible()` từng cái. `toBeVisible()` bắt được thứ MẤT ĐI; chỉ so tập hợp mới bắt được
 * thứ THỪA RA — một nút mới ai đó nhét vào đầu trang, một ô chọn mọc thêm trong form.
 */
test.describe('Phòng Thiết bị — bên trong có gì', () => {
  test.beforeEach(() => {
    resetUsers();
    resetDevices();
    // Loại thiết bị là danh mục CHUNG do migration gieo sẵn, nhưng site/tủ/NCC thì các bài
    // khác tự dựng bằng tiền tố `E2E-`. Không dọn thì tập hợp lựa chọn của ô lọc phình ra
    // theo lần chạy trước và bài này đỏ vì lý do chẳng liên quan.
    resetCatalog();
  });

  /**
   * 12 loại thiết bị gieo ở migration `0014_device_type.sql` — danh mục CHUNG của mọi công
   * ty, nên nó là hằng số kiểm được. Site · tủ · nhà cung cấp thì KHÔNG: đó là dữ liệu riêng
   * của PMH, nhập qua màn Danh mục, nên bài này chỉ chốt mục "Tất cả …" đứng đầu.
   */
  const BASE_DEVICE_TYPES = [
    'Switch',
    'Firewall',
    'Server',
    'NAS',
    'UPS',
    'Access Point',
    'PC',
    'Laptop',
    'Printer',
    'Camera',
    'Điện thoại IP',
    'Thiết bị khác',
  ];

  /**
   * Tập loại mà ô chọn phải bày = đúng danh mục server trả, không phải hằng số 12: chủ dự án
   * nhập thêm loại riêng qua màn Danh mục, và đó là dữ liệu thật chứ không phải rác E2E.
   * Hai điều vẫn chốt: đủ 12 loại gieo sẵn, và không còn loại mang chữ E2E sót lại.
   */
  async function catalogDeviceTypes(page: Page, onlyActive: boolean): Promise<string[]> {
    const res = await page.request.get('/api/v1/catalog');
    expect(res.status(), 'đọc danh mục để biết tập loại thiết bị hiện có').toBe(200);
    const rows = ((await res.json()) as { deviceTypes: { name: string; active: boolean }[] })
      .deviceTypes;
    const names = rows.filter((row) => !onlyActive || row.active).map((row) => row.name);
    expect(names, 'thiếu một loại gieo sẵn nghĩa là seed đã đổi').toEqual(
      expect.arrayContaining(BASE_DEVICE_TYPES),
    );
    expect(
      names.filter((name) => /e2e/i.test(name)),
      'loại thiết bị E2E sót lại — reset-e2e chưa dọn',
    ).toEqual([]);
    return names.sort();
  }

  /**
   * Tên TRỢ NĂNG của một tập điều khiển, đúng thứ tự chúng nằm trong DOM.
   *
   * Vì sao không dùng `allInnerTexts()`: một nửa số điều khiển của phòng này KHÔNG có chữ nào
   * bên trong. Nút mở `Select` hiện nhãn placeholder ("— Chọn loại —") chứ không hiện tên ô;
   * nút lịch chỉ có một cái icon; ô chọn file là `<input type="file">` bị giấu về 1px và mượn
   * tên từ `<label for>` bên cạnh. Người dùng trình đọc màn hình nghe đúng chuỗi mà hàm này
   * trả về — nên đó mới là thứ đáng chốt, không phải chữ vẽ trên màn hình.
   */
  async function controlName(scope: Locator): Promise<string[]> {
    return scope.evaluateAll((els) =>
      els.map((el) => {
        const aria = el.getAttribute('aria-label');
        if (aria) return aria.trim();
        const id = el.getAttribute('id');
        const tied = id ? el.ownerDocument.querySelector(`label[for="${id}"]`) : null;
        return ((tied ?? el).textContent ?? '').replace(/\s+/g, ' ').trim();
      }),
    );
  }

  /**
   * NHÃN của một tập phần tử — đọc `textContent`, KHÔNG đọc `innerText`.
   *
   * Lượt chạy đầu đã dạy đúng bài này: `allInnerTexts()` trả về chữ ĐÃ QUA `text-transform`
   * của hệ thiết kế, nên đầu bảng ra "MÃ THIẾT BỊ" còn tiêu đề hộp thoại (`.sheet-title`, không
   * bị biến hoa) vẫn ra "Thêm thiết bị" — cùng một mảng mà nửa hoa nửa thường. Cái ta muốn chốt
   * là NHÃN (chuỗi trong `vi.ts`), không phải kiểu chữ: đổi `text-transform` là một quyết định
   * thị giác, đổi nhãn mới là đổi nghĩa. `textContent` không bị biến đổi nên nói đúng nhãn.
   */
  async function labelOf(scope: Locator): Promise<string[]> {
    const texts = await scope.allTextContents();
    return texts.map((text) => text.replace(/\s+/g, ' ').trim());
  }

  /**
   * Mở một ô chọn, đọc hết lựa chọn, rồi ĐÓNG LẠI BẰNG CHÍNH NÚT ĐÓ.
   *
   * Không đóng bằng Esc: ô chọn của form nằm trong hộp thoại, và một phím Esc lọt ra ngoài là
   * đóng luôn cả hộp — bài kiểm sẽ đỏ ở bước sau, cách xa chỗ thật sự sai. Bấm lại nút mở thì
   * chỉ có một thứ đóng, và đó đúng là thứ ta vừa mở.
   */
  async function optionsOf(page: Page, trigger: Locator): Promise<string[]> {
    const options = page.getByRole('option');
    let names: string[] = [];
    /*
     * Lặp cả vòng mở–đọc–đóng: bảng nạp lại (sau khi sắp xếp, lọc) dựng lại thanh phân trang,
     * nút cũ bị gỡ khỏi DOM giữa hai cú bấm và cú thứ hai rơi vào một nút MỚI đang đóng — tức
     * là mở lại. Lỗi đó thuộc về nhịp của bài kiểm, không phải của `Select`.
     */
    await expect(async () => {
      if ((await options.count()) === 0) await trigger.click();
      await expect(options.first(), 'ô chọn mở ra phải có ít nhất một lựa chọn').toBeVisible({
        timeout: 2_000,
      });
      // `allTextContents` chứ không phải `allInnerTexts` — xem chú thích ở `labelOf`.
      names = await options.allTextContents();
      await trigger.click();
      await expect(options, 'bấm lại nút mở phải đóng danh sách lựa chọn').toHaveCount(0, {
        timeout: 2_000,
      });
    }).toPass({ timeout: 15_000 });
    return names.map((name) => name.trim());
  }

  /** Loại thiết bị "Switch" — loại duy nhất trong bài này cần BẬT port map (seed: `has_port_map`). */
  async function switchTypeId(page: Page): Promise<string> {
    const res = await page.request.get('/api/v1/catalog');
    const lists = (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    const found = lists.deviceTypes.find((type) => type.name === 'Switch');
    expect(found, 'danh mục gốc phải có loại "Switch" (migration gieo sẵn)').toBeTruthy();
    return found!.id;
  }

  /*
   * ===== BÀI 1 =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Đầu trang Thiết bị có bốn cái nút, và ba trong số đó là CỬA DUY NHẤT tới một việc: không
   * có "Tải file mẫu" thì không ai biết file nhập phải có cột nào; không có "Nhập từ Excel"
   * thì cả luồng nhập Excel không có lối vào từ giao diện. `devices.spec.ts` bấm "Thêm thiết bị"
   * suốt, `device-import.spec.ts` bấm "Nhập từ Excel" — nhưng KHÔNG bài nào hỏi "đầu trang có
   * đúng bốn nút này thôi chứ?". Gỡ một nút đi, hoặc nhét thêm một nút thứ năm, cả bộ E2E vẫn
   * xanh.
   *
   * Thanh lọc cũng vậy: bốn ô chọn là bốn câu hỏi người dùng hỏi kho thiết bị (ở site nào, tủ
   * nào, loại gì, còn dùng không). Bài này mở từng ô ra xem bên trong.
   *
   * ĐỎ KHI: đầu trang thừa/thiếu một nút hoặc một nút đổi nhãn, thanh lọc mất một ô chọn, ô
   * "Trạng thái" mọc thêm/rụng đi một trạng thái, ô "Loại" không còn khớp danh mục gốc, hoặc
   * ô tìm kiếm gõ vào mà bảng KHÔNG thu hẹp (lọc chạy hụt ở client thay vì đi tới server).
   */
  test('Đầu phòng Thiết bị: đúng bốn nút, bốn ô lọc, và ô tìm thu hẹp bảng thật', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const headers = await writeHeaders(page);
    const deviceTypeId = await switchTypeId(page);

    // Dàn cảnh qua API: điều đang kiểm là THANH LỌC, không phải đường tạo máy.
    for (const [suffix, name] of [
      ['A', 'Máy mồi thứ nhất của bài kiểm kê'],
      ['B', 'Máy mồi thứ hai của bài kiểm kê'],
    ]) {
      const created = await page.request.post('/api/v1/devices', {
        headers,
        data: { code: `TB-E2E-DAU-${stamp}-${suffix}`, name, deviceTypeId },
      });
      expect(created.ok(), `dựng máy mồi ${suffix} phải thành công`).toBe(true);
    }

    await page.goto('/devices');
    await expect(page.getByRole('heading', { level: 1, name: /^Thiết bị$/ })).toBeVisible();

    const main = page.getByRole('main');
    const search = page.getByRole('searchbox', {
      name: 'Tìm mã, tên, serial, IP hoặc người dùng',
    });

    /*
     * ĐẾM NÚT TRÊN MỘT BẢNG RỖNG, CÓ CHỦ Ý.
     *
     * Còn dòng nào là mỗi dòng đẻ thêm một nút "Sửa máy …" và một nút phân trang — tập hợp
     * cần chốt bị chôn giữa hai chục nút của dữ liệu. Lọc về rỗng thì trong `<main>` chỉ còn
     * đúng thứ LUÔN có mặt: ba nút đầu trang (file mẫu nằm TRONG hộp nhập), bốn ô lọc, nút
     * "Xóa lọc" của thanh lọc và nút "Xóa bộ lọc" của khối rỗng.
     */
    await search.fill(`KHONG-CO-MAY-NAO-E2E-${stamp}`);
    await expect(
      main.getByText(`Không có thiết bị nào khớp “KHONG-CO-MAY-NAO-E2E-${stamp}”.`),
      'lọc về rỗng phải ra empty-state, không phải bảng trắng',
    ).toBeVisible();

    await expect
      .poll(() => controlName(main.getByRole('button')), {
        message:
          'Bộ khung đầu phòng Thiết bị: ba nút hành động, bốn ô lọc, hai nút gỡ lọc — không thừa, không thiếu',
      })
      .toEqual([
        'Xuất Excel',
        'Nhập từ Excel',
        'Thêm thiết bị',
        'Site',
        'Tủ mạng',
        'Loại',
        'Trạng thái',
        'Xóa lọc (1)',
        'Xóa bộ lọc',
      ]);

    /*
     * Ô TÌM PHẢI THU HẸP THẬT — đếm dòng TRƯỚC và SAU.
     *
     * Chỉ khẳng định "thấy máy A" thì một ô tìm hỏng hoàn toàn (gửi lên server rồi bỏ qua)
     * vẫn xanh, vì máy A vốn đã nằm trong bảng. Hai con số mới nói được điều gì đó.
     */
    await search.fill(`TB-E2E-DAU-${stamp}`);
    await expect(
      page.getByRole('row'),
      'lọc theo dấu của lần chạy này phải còn đúng hai máy mồi (kèm dòng tiêu đề)',
    ).toHaveCount(3);

    await search.fill(`TB-E2E-DAU-${stamp}-A`);
    await expect(
      page.getByRole('row'),
      'gõ thêm hậu tố "-A" phải thu bảng xuống còn một máy — không thu tức là ô tìm không đi tới server',
    ).toHaveCount(2);
    await expect(
      // `exact: true` là bắt buộc: ô "Thao tác" của CHÍNH dòng đó chứa nút "Sửa máy <mã>", nên
      // khớp theo chuỗi con là trúng hai ô một lúc và Playwright báo strict-mode violation.
      page.getByRole('cell', { name: `TB-E2E-DAU-${stamp}-A`, exact: true }),
      'máy còn lại phải đúng là máy A',
    ).toBeVisible();

    await search.fill('');

    /*
     * BÊN TRONG TỪNG Ô LỌC.
     *
     * `exact: true` là bắt buộc ở đây: đầu bảng cũng có nút "Sắp xếp theo Trạng thái", và
     * `getByRole` khớp tên theo CHUỖI CON — không neo thì một cú bấm rơi nhầm vào đầu bảng.
     */
    const status = await optionsOf(
      page,
      main.getByRole('button', { name: 'Trạng thái', exact: true }),
    );
    expect(
      status,
      'Ô lọc Trạng thái phải bày đúng vòng đời thiết bị: mục "mọi" rồi bốn trạng thái của DEVICE_STATUSES',
    ).toEqual(['Mọi trạng thái', 'Đang dùng', 'Dự phòng', 'Hỏng', 'Đã thanh lý']);

    const kind = await optionsOf(page, main.getByRole('button', { name: 'Loại', exact: true }));
    expect(kind[0], 'Ô lọc Loại phải mở đầu bằng mục bỏ lọc').toBe('Mọi loại');
    // So theo TẬP HỢP đã sắp, không theo thứ tự: API sắp theo `name` bằng collation của
    // Postgres, mà thứ tự của "Điện thoại IP" trong bảng chữ cái phụ thuộc collation ấy —
    // chốt cứng thứ tự là chốt vào một thứ không thuộc về phòng này.
    expect(
      [...kind.slice(1)].sort(),
      'Ô lọc Loại phải khớp ĐÚNG danh mục loại thiết bị (kể cả loại đã ngưng — lọc thì vẫn cần tìm máy cũ)',
    ).toEqual(await catalogDeviceTypes(page, false));

    // Site và tủ là dữ liệu riêng của PMH (nhập qua màn Danh mục), nên chỉ chốt được mục đầu.
    expect(
      (await optionsOf(page, main.getByRole('button', { name: 'Site', exact: true })))[0],
      'Ô lọc Site phải mở đầu bằng mục bỏ lọc',
    ).toBe('Tất cả site');
    expect(
      (await optionsOf(page, main.getByRole('button', { name: 'Tủ mạng', exact: true })))[0],
      'Ô lọc Tủ mạng phải mở đầu bằng mục bỏ lọc',
    ).toBe('Mọi tủ');
  });

  /*
   * ===== BÀI 2 =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `devices.spec.ts` đã chứng minh sắp xếp CHẠY Ở SERVER và hai cột danh mục không sắp được.
   * Bài này hỏi câu khác: bảng có ĐỦ cột không, và cột nào là nút sắp xếp — chốt bằng tập
   * hợp, nên nó bắt được cả việc ai đó thêm một cột sắp-được thứ sáu mà API chưa có khóa
   * tương ứng trong `DEVICE_SORT_KEYS` (bấm vào là bảng im lặng bỏ qua).
   *
   * Và phần chưa ai chạm: PHÂN TRANG. `Pagination` là tài sản dùng chung, `total === 0` thì
   * nó KHÔNG vẽ gì cả — nghĩa là mọi bài kiểm chạy trên vài dòng dữ liệu đều không nhìn thấy
   * nó bao giờ. Ô "Số dòng" (10/20/50/100) chưa có bài nào bấm.
   *
   * ĐỎ KHI: một cột biến mất hay mọc thêm, một cột đang sắp được thôi sắp được (hoặc ngược
   * lại), `aria-sort` không lật asc→desc, thứ tự dòng không đổi theo cột vừa bấm, ô "Số dòng"
   * mất một cỡ, hoặc đổi cỡ mà số dòng thật không đổi theo.
   */
  test('Bảng thiết bị: đủ cột, đúng cột sắp được, và phân trang ăn thật', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const headers = await writeHeaders(page);
    const deviceTypeId = await switchTypeId(page);

    /*
     * 12 máy — đủ để trang thứ hai TỒN TẠI ở cỡ 10 dòng. Tên đi NGƯỢC chiều với mã (máy `-01`
     * tên "Máy L", máy `-12` tên "Máy A") để "sắp theo tên" không thể tình cờ trùng với "sắp
     * theo mã": trùng thì bài kiểm xanh cả khi nút sắp xếp chẳng làm gì.
     */
    const letters = ['L', 'K', 'J', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'];
    for (let i = 0; i < letters.length; i += 1) {
      const created = await page.request.post('/api/v1/devices', {
        headers,
        data: {
          code: `TB-E2E-BANG-${stamp}-${String(i + 1).padStart(2, '0')}`,
          name: `Máy ${letters[i]} của bài kiểm kê bảng`,
          deviceTypeId,
        },
      });
      expect(created.ok(), `dựng máy thứ ${i + 1} phải thành công`).toBe(true);
    }

    await page.goto('/devices');
    await page
      .getByRole('searchbox', { name: 'Tìm mã, tên, serial, IP hoặc người dùng' })
      .fill(`TB-E2E-BANG-${stamp}`);
    await expect(page.getByRole('row'), 'lọc xong phải còn đúng 12 máy vừa dựng').toHaveCount(13);

    await expect
      .poll(() => labelOf(page.getByRole('columnheader')), {
        message:
          'Bảng thiết bị có đúng 7 cột, đúng thứ tự này. Loại máy là dòng phụ dưới Tên (không bớt thông tin): thêm cột là cột Tên bị ép và nút Sửa bị đẩy khỏi khung ở 1280px',
      })
      .toEqual([
        'Mã thiết bị',
        'Tên thiết bị',
        'Vị trí',
        'Người sử dụng',
        'Bảo hành',
        'Trạng thái',
        'Thao tác',
      ]);

    /*
     * CỘT NÀO SẮP ĐƯỢC — chốt bằng TẬP HỢP nút trong dòng tiêu đề.
     *
     * Danh sách này phải soi gương `DEVICE_SORT_KEYS` bên API. "Loại" và "Vị trí và người
     * giữ" đứng ngoài vì sắp theo chúng đòi join sang module danh mục (AD-2); "Thao tác"
     * đứng ngoài vì nó không phải dữ liệu. Một nút thứ sáu mọc ra ở đây mà API chưa có khóa
     * tương ứng thì bấm vào bảng sẽ im lặng không đổi gì — không có tập hợp thì không ai biết.
     */
    const headerRow = page.getByRole('row').first();
    await expect
      .poll(() => controlName(headerRow.getByRole('button')), {
        message:
          'Đúng năm cột sắp xếp được, và nhãn phải NÓI RÕ đây là nút sắp xếp (thanh lọc cũng có nút tên "Loại")',
      })
      .toEqual([
        'Sắp xếp theo Mã thiết bị',
        'Sắp xếp theo Tên thiết bị',
        'Sắp xếp theo Người sử dụng',
        'Sắp xếp theo Bảo hành',
        'Sắp xếp theo Trạng thái',
      ]);

    const codeColumn = page.getByRole('columnheader', { name: /Mã thiết bị/ });
    const nameColumn = page.getByRole('columnheader', { name: /Tên thiết bị/ });
    const firstRow = page.getByRole('row').nth(1);

    await expect(codeColumn, 'mở màn bảng sắp theo Mã thiết bị tăng dần').toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await expect(firstRow, 'sắp theo mã tăng thì máy -01 đứng đầu').toContainText(`${stamp}-01`);

    await headerRow.getByRole('button', { name: 'Sắp xếp theo Tên thiết bị' }).click();
    await expect(
      nameColumn,
      'bấm nút sắp xếp của cột Tên thì CHÍNH cột đó phải mang aria-sort',
    ).toHaveAttribute('aria-sort', 'ascending');
    await expect(
      codeColumn,
      'và cột Mã phải về "none" (sắp được, đang không sắp) — hai cột cùng khai đang-sắp là nói dối trình đọc màn hình',
    ).toHaveAttribute('aria-sort', 'none');
    await expect(
      firstRow,
      'sắp theo tên tăng thì "Máy A" lên đầu — tức máy mang mã -12, khác hẳn thứ tự theo mã',
    ).toContainText(`${stamp}-12`);

    await headerRow.getByRole('button', { name: 'Sắp xếp theo Tên thiết bị' }).click();
    await expect(nameColumn, 'bấm lần hai phải lật sang giảm dần').toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await expect(
      firstRow,
      'sắp theo tên giảm thì "Máy L" lên đầu — thứ tự phải ĐỔI THẬT, không chỉ đổi mũi tên',
    ).toContainText(`${stamp}-01`);

    /*
     * CỘT THAO TÁC THEO Q-18: "Sửa" đứng ngoài, mọi việc khác vào menu ⋮.
     *
     * Đúng HAI nút mỗi dòng, cả hai mang mã máy. Ai đưa thêm nút phẳng ra ngoài (Thanh lý, Nhân
     * bản…) thì bài này đỏ — cột thao tác phình ra là cột Tên bị ép.
     */
    await expect
      .poll(
        () =>
          controlName(
            page.getByRole('row', { name: new RegExp(`${stamp}-01`) }).getByRole('button'),
          ),
        {
          message:
            'Mỗi dòng thiết bị có đúng nút Sửa + menu ⋮, và nhãn phải riêng cho từng dòng (hai chục nút cùng tên "Sửa" là không ai bấm đúng được)',
        },
      )
      .toEqual([`Sửa máy TB-E2E-BANG-${stamp}-01`, `Thao tác với TB-E2E-BANG-${stamp}-01`]);

    /*
     * PHÂN TRANG.
     *
     * `Pagination` không render gì khi `total === 0`, nên nó là khu vực gần như không bài nào
     * đi qua. 12 máy ở cỡ 10 dòng là cấu hình nhỏ nhất mà trang thứ hai thật sự tồn tại.
     */
    const pager = page.getByRole('navigation', { name: 'Trang', exact: true });
    await expect(pager, 'lọc ra 12 dòng thì thanh phân trang phải có mặt').toBeVisible();
    await expect(
      pager,
      'thanh phân trang phải nói rõ đang xem bao nhiêu trên tổng bao nhiêu',
    ).toContainText('trên 12 dòng');

    const rowCount = pager.getByLabel('Số dòng');
    expect(
      await optionsOf(page, rowCount),
      'Ô "Số dòng" phải bày đủ bốn cỡ của PAGE_SIZES — 10 cho điện thoại, 100 cho lúc soi cả kho',
    ).toEqual(['10', '20', '50', '100']);

    await rowCount.click();
    await page.getByRole('option', { name: '10', exact: true }).click();
    await expect(
      page.getByRole('row'),
      'đổi sang cỡ 10 thì bảng phải còn đúng 10 dòng dữ liệu — không đổi tức là ô "Số dòng" chỉ để trang trí',
    ).toHaveCount(11);

    const nextPage = pager.getByRole('button', { name: 'Trang sau' });
    await expect(nextPage, '12 dòng ở cỡ 10 thì phải còn trang thứ hai để đi tới').toBeEnabled();
    await nextPage.click();
    await expect(
      page.getByRole('row'),
      'trang hai của 12 dòng ở cỡ 10 phải còn đúng 2 dòng',
    ).toHaveCount(3);
    await expect(nextPage, 'hết trang thì nút "Trang sau" phải tắt').toBeDisabled();
    await expect(
      pager.getByRole('button', { name: 'Trang trước' }),
      'và nút "Trang trước" phải bật lên',
    ).toBeEnabled();

    // Dãy số trang: trang đang xem mang aria-current, bấm số là nhảy thẳng tới đó.
    await expect(
      pager.getByRole('button', { name: 'Trang 2', exact: true }),
      'trang đang xem phải được đánh dấu aria-current="page"',
    ).toHaveAttribute('aria-current', 'page');
    await pager.getByRole('button', { name: 'Trang 1', exact: true }).click();
    await expect(page.getByRole('row'), 'bấm số 1 thì về trang đầu, 10 dòng').toHaveCount(11);

    /*
     * FE-03 — trang KHÔNG TỒN TẠI trên thanh địa chỉ (link cũ, gõ tay) phải được kéo về trang
     * cuối, không phải "91–12 trên 12 dòng" kèm câu rỗng "chưa có thiết bị nào".
     */
    const currentUrl = new URL(page.url());
    currentUrl.searchParams.set('page', '99');
    await page.goto(currentUrl.toString());
    await expect(page.getByRole('row'), '?page=99 của 12 dòng phải rơi về trang 2').toHaveCount(3);
    await expect(
      page.getByRole('navigation', { name: 'Trang', exact: true }).getByRole('button', {
        name: 'Trang 2',
        exact: true,
      }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  });

  /*
   * ===== BÀI 3 =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `devices.spec.ts` mở hộp "Thêm thiết bị" hàng chục lần, nhưng lần nào cũng chỉ chạm ba ô:
   * Mã, Tên, Loại. Mười một ô còn lại — Model, Serial, Site, Tủ mạng, Người sử dụng, Phòng ban,
   * Nhà cung cấp, ba ô ngày, Ghi chú — chưa có bài nào biết chúng còn tồn tại hay không. Xóa
   * hẳn ô "Bảo hành đến" khỏi form thì cả bộ E2E vẫn xanh, và cái máy tiếp theo được khai sẽ
   * không có hạn bảo hành, mãi mãi.
   *
   * Bài này còn chốt hai quyết định thiết kế mà chỉ đọc chú thích trong code mới biết:
   *   - Ô "Trạng thái" KHÔNG hiện khi thêm mới (máy mới thì luôn "đang dùng"; bày một ô có
   *     đúng một câu trả lời hợp lý là mở đường cho hồ sơ vừa tạo đã "đã thanh lý").
   *   - Từng ô phải đúng LOẠI tay nắm: Phòng ban là `combobox` (gõ tự do được, vì phòng ban mới
   *     lập tuần này phải khai được ngay), Loại là `button` mở listbox, ngày là nút mở lịch.
   *     Nhầm vai nghĩa là người dùng bàn phím thao tác khác hẳn điều ta tưởng.
   *
   * ĐỎ KHI: một ô nhập rơi khỏi form hoặc mọc thêm, một ô đổi loại tay nắm, ô "Trạng thái"
   * lọt vào chế độ thêm mới, danh sách loại thiết bị trong form lệch khỏi danh mục, bấm Lưu
   * lúc thiếu dữ liệu mà hộp vẫn đóng, hoặc một trong hai đường đóng hộp (✕ / Esc) chết.
   */
  test('Hộp "Thêm thiết bị": đủ ô, đúng loại tay nắm, và không đóng khi còn thiếu', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    await page.goto('/devices');
    await devicesPageButton(page, 'Thêm thiết bị').click();

    const dialog = page.getByRole('dialog', { name: 'Thêm thiết bị' });
    await expect(dialog, 'bấm "Thêm thiết bị" phải mở đúng hộp mang tên đó').toBeVisible();

    /*
     * Năm tiêu đề cấp 2, không phải bốn: `Dialog` dựng tiêu đề hộp bằng `RD.Title` của Radix,
     * mà mặc định nó render ra `<h2>` — nên nó đứng CÙNG cấp với tiêu đề bốn khối bên trong và
     * lọt vào cùng tập hợp. Chốt cả năm, đúng thứ tự đọc từ trên xuống.
     */
    await expect
      .poll(() => labelOf(dialog.getByRole('heading', { level: 2 })), {
        message:
          'Form thiết bị chia đúng bốn khối dưới tiêu đề hộp, kể một mạch chuyện: là máy gì → đứng ở đâu → mua của ai → giấy tờ kèm theo',
      })
      .toEqual([
        'Thêm thiết bị',
        'Hồ sơ',
        'Vị trí và người giữ',
        'Mua sắm và bảo hành',
        'Giấy tờ đính kèm',
      ]);

    /*
     * TẬP HỢP Ô GÕ CHỮ. Sáu ô, không hơn không kém.
     *
     * Đếm `textbox` rồi mới soi từng nhãn: chỉ soi từng nhãn thì một ô THỪA ra (ai đó thêm ô
     * "Vị trí trong tủ" mà không khai vào API) sẽ lọt qua sạch sẽ.
     */
    await expect(
      dialog.getByRole('textbox'),
      'Hộp thêm thiết bị có đúng 6 ô gõ chữ: Mã · Tên · Model · Serial · Người sử dụng · Ghi chú',
    ).toHaveCount(6);
    for (const label of [
      'Mã thiết bị',
      'Tên thiết bị',
      'Model',
      'Serial',
      'Người sử dụng',
      'Ghi chú',
    ]) {
      await expect(
        dialog.getByLabel(label),
        `Ô "${label}" phải là một ô gõ chữ có nhãn nối đúng — mất nhãn là người dùng bàn phím mất luôn ô`,
      ).toHaveCount(1);
    }

    /*
     * ĐÚNG LOẠI TAY NẮM. Phòng ban là `combobox` chứ không phải `Select`: danh mục ở đây chỉ
     * HƯỚNG chứ không được ép, nên nó phải gõ tự do được. Đổi nó thành `Select` là lặng lẽ
     * cấm khai một phòng ban vừa lập.
     */
    await expect(
      dialog.getByRole('combobox', { name: 'Phòng ban sử dụng' }),
      'Ô Phòng ban phải là combobox (gõ tự do + gợi ý), không phải ô chọn cứng',
    ).toHaveCount(1);

    /*
     * TẬP HỢP NÚT — gộp cả ô chọn, ô ngày, ô chọn file và chân hộp.
     *
     * Đây là khẳng định gắt nhất của bài: nó chốt cùng lúc "có đủ" và "không thừa". Đặc biệt
     * là KHÔNG có "Trạng thái" — quyết định cố ý của form thêm mới.
     */
    await expect
      .poll(() => controlName(dialog.getByRole('button')), {
        message:
          'Bộ nút của hộp THÊM MỚI: bốn ô chọn, ba ô ngày + ba nút đặt nhanh hạn bảo hành, một ô chọn file, ba nút chân hộp — và TUYỆT NHIÊN không có ô "Trạng thái"',
      })
      .toEqual([
        'Đóng hộp thoại',
        'Loại',
        'Site',
        'Tủ mạng',
        'Nhà cung cấp',
        'Ngày mua',
        'Bảo hành từ',
        'Bảo hành đến',
        '+1 năm',
        '+2 năm',
        '+3 năm',
        'Chọn file để đính kèm',
        'Hủy',
        'Ghi rồi thêm máy khác',
        'Lưu',
      ]);

    await expect
      .poll(() => controlName(page.getByTestId('dialog-footer').getByRole('button')), {
        message: 'Chân hộp đi theo đúng nếp toàn app: Hủy trước, nút ghi chính sau cùng',
      })
      .toEqual(['Hủy', 'Ghi rồi thêm máy khác', 'Lưu']);

    /* Ô NGÀY mở ra một lịch thật, không phải một ô gõ chữ trá hình. */
    const purchaseDateField = dialog.getByRole('button', { name: 'Ngày mua' });
    await purchaseDateField.click();
    await expect(
      page.getByRole('button', { name: 'Tháng sau' }),
      'Ô "Ngày mua" phải mở ra lịch chọn được (có nút lật tháng), không phải một ô trống',
    ).toBeVisible();
    await purchaseDateField.click();
    await expect(page.getByRole('button', { name: 'Tháng sau' })).toHaveCount(0);

    /*
     * BÊN TRONG Ô CHỌN LOẠI. Khác ô lọc cùng tên ở ngoài: ở đây KHÔNG có mục "Mọi loại" —
     * một cái máy phải là một loại cụ thể. Mục "— Chọn loại —" chỉ là chữ hiện trên nút khi
     * chưa chọn, không phải một lựa chọn bấm được.
     */
    const typeInForm = await optionsOf(
      page,
      dialog.getByRole('button', { name: 'Loại', exact: true }),
    );
    expect(
      [...typeInForm].sort(),
      'Ô "Loại" trong form phải bày đúng các loại đang dùng của danh mục, KHÔNG kèm mục "Mọi loại" của thanh lọc',
    ).toEqual(await catalogDeviceTypes(page, true));

    /*
     * ĐƯỜNG HỎNG — BẤM LƯU KHI CÒN THIẾU (DEV-025).
     *
     * Form đặt `noValidate`: bong bóng "Please fill out this field." của trình duyệt không còn
     * chặn trước. Hàng rào là `useFormErrors` — câu tiếng Việt DƯỚI TỪNG Ô, nối vào ô bằng
     * `aria-describedby`, tiêu điểm về ô lỗi đầu tiên, và hộp phải còn nguyên (đóng im lặng là
     * nuốt mất mọi thứ người dùng vừa gõ). Loại thiết bị là `Select` (nút bấm) — ô dễ rơi nhất.
     */
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await expect(dialog, 'Bấm Lưu khi form trống: hộp PHẢI còn đó').toBeVisible();
    await expect(
      dialog.getByText('Còn 3 ô cần sửa trước khi lưu.'),
      'Ba ô bắt buộc cùng thiếu thì đầu form tóm tắt số ô phải sửa',
    ).toBeVisible();
    const codeField = dialog.getByRole('textbox', { name: 'Mã thiết bị' });
    await expect(codeField, 'Câu lỗi tiếng Việt nằm dưới và nối vào đúng ô Mã').toHaveAccessibleDescription(
      'Bắt buộc — chưa nhập ô này.',
    );
    await expect(codeField, 'Tiêu điểm về ô lỗi đầu tiên').toBeFocused();

    await codeField.fill(`TB-E2E-HOP-${stamp}`);
    await dialog.getByLabel('Tên thiết bị').fill('Máy chỉ để xem hộp thoại');
    await dialog.getByRole('button', { name: 'Lưu' }).click();

    await expect(
      dialog.getByRole('button', { name: 'Loại', exact: true }),
      'Thiếu LOẠI thiết bị thì chính ô Loại phải nói ra, bằng tiếng Việt',
    ).toHaveAccessibleDescription('Bắt buộc — chưa chọn ô này.');
    await expect(dialog.getByText(/ô cần sửa trước khi lưu/), 'Còn một lỗi thì không cần tóm tắt').toHaveCount(0);
    await expect(dialog, 'và hộp vẫn phải mở để người dùng sửa nốt').toBeVisible();

    /* HAI ĐƯỜNG ĐÓNG, KHÔNG LƯU GÌ. */
    /* Form đã gõ dở, nên lối đóng TÌNH CỜ phải hỏi lại trước (`Dialog guardUnsaved`) — trả
       lời xong mới đóng. */
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Bỏ những gì vừa nhập?' }),
      'form 15 ô đã gõ hai ô mà Esc xoá trắng không hỏi là chỗ mất mát nặng nhất của repo',
    ).toBeVisible();
    await confirmAction(page, 'Bỏ và đóng');
    await expect(dialog, 'trả lời xong thì Esc phải đóng được hộp thêm thiết bị').toHaveCount(0);

    await devicesPageButton(page, 'Thêm thiết bị').click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(dialog, 'nút ✕ cũng phải đóng được hộp').toHaveCount(0);

    await expect(
      page.getByRole('cell', { name: `TB-E2E-HOP-${stamp}` }),
      'Đóng hộp mà không bấm Lưu thì KHÔNG được có cái máy nào ra đời',
    ).toHaveCount(0);
  });

  /*
   * ===== BÀI 4 =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hai hộp còn lại của phòng, mỗi hộp một câu hỏi chưa ai hỏi:
   *
   *   - HỘP SỬA dùng CHUNG `DeviceForm` với hộp thêm mới (AD-15). Dùng chung nghĩa là chỉ
   *     khác nhau ở hai chỗ: có thêm ô "Trạng thái", và mọi ô đã ĐIỀN SẴN giá trị cũ. Cái thứ
   *     hai mới đáng sợ: form gửi ĐỦ mọi trường lên API (ô để trống = xóa giá trị), nên một
   *     form sửa hiện ra trống là bấm Lưu một cái xóa sạch hồ sơ mà người dùng không hề biết.
   *     Chưa bài nào đọc giá trị điền sẵn.
   *
   *   - HỘP NHẬP TỪ EXCEL có ba bước và `device-import.spec.ts` luôn đi hết cả ba với file
   *     thật. Không bài nào nhìn nó lúc VỪA MỞ RA — lúc mà hai nút ghi phải đang TẮT. Nếu
   *     "Xác nhận ghi" bật sẵn khi chưa chọn file, người ta bấm được vào một lượt ghi không
   *     có bảng đối chiếu nào.
   *
   * ĐỎ KHI: hộp sửa mở ra trống hoặc thiếu ô "Trạng thái", tiêu đề hộp sửa mất mã máy, hộp
   * nhập thiếu một trong ba nút, hoặc nút ghi của hộp nhập bật lên khi chưa có file.
   */
  test('Hộp "Sửa hồ sơ" điền sẵn đúng, hộp "Nhập từ Excel" khoá đúng lúc chưa có file', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const code = `TB-E2E-SUA-${stamp}`;
    const headers = await writeHeaders(page);
    const deviceTypeId = await switchTypeId(page);

    const created = await page.request.post('/api/v1/devices', {
      headers,
      data: {
        code,
        name: 'Switch tầng 3 của bài kiểm kê',
        deviceTypeId,
        model: 'C9200-24P',
        serial: `SN-E2E-${stamp}`,
        assignedTo: 'Anh Tuấn hạ tầng',
        department: 'Phòng CNTT',
        note: 'Ghi chú mồi để đọc lại ở form sửa',
      },
    });
    expect(created.ok(), 'dựng máy để đi soi form sửa phải thành công').toBe(true);

    await page.goto('/devices');
    await page
      .getByRole('searchbox', { name: 'Tìm mã, tên, serial, IP hoặc người dùng' })
      .fill(code);
    // `exact: true`: ô "Thao tác" cùng dòng mang nút "Sửa máy <mã>", nên khớp theo chuỗi con
    // là trúng hai ô một lúc — Playwright dừng ở strict-mode violation, không phải ở điều đang kiểm.
    await expect(page.getByRole('cell', { name: code, exact: true })).toBeVisible();

    await page.getByRole('button', { name: `Sửa máy ${code}` }).click();
    const editDialog = page.getByRole('dialog', { name: `Sửa hồ sơ — ${code}` });
    await expect(
      editDialog,
      'Tiêu đề hộp sửa phải mang MÃ MÁY — mở hai tab rồi lẫn lộn hai cái máy là hỏng thật, không phải hỏng đẹp',
    ).toBeVisible();

    /*
     * ĐIỀN SẴN — đọc lại từng ô.
     *
     * `toHaveValue` chứ không phải `toBeVisible`: một ô hiện ra nhưng RỖNG mới đúng là kiểu
     * hỏng đang rình ở đây.
     */
    for (const [label, value] of [
      ['Mã thiết bị', code],
      ['Tên thiết bị', 'Switch tầng 3 của bài kiểm kê'],
      ['Model', 'C9200-24P'],
      ['Serial', `SN-E2E-${stamp}`],
      ['Người sử dụng', 'Anh Tuấn hạ tầng'],
      ['Ghi chú', 'Ghi chú mồi để đọc lại ở form sửa'],
    ]) {
      await expect(
        editDialog.getByLabel(label),
        `Ô "${label}" của form SỬA phải mang sẵn giá trị cũ — form gửi đủ mọi trường lên API, ô trống nghĩa là XÓA`,
      ).toHaveValue(value);
    }
    await expect(
      editDialog.getByRole('combobox', { name: 'Phòng ban sử dụng' }),
      'Ô Phòng ban (combobox) cũng phải điền sẵn',
    ).toHaveValue('Phòng CNTT');
    await expect(
      editDialog.getByRole('button', { name: 'Loại', exact: true }),
      'Nút ô chọn Loại phải hiện đúng loại đang gắn, không phải chữ "— Chọn loại —"',
    ).toHaveText('Switch');
    await expect(
      editDialog.getByRole('button', { name: 'Trạng thái', exact: true }),
      'Nút ô chọn Trạng thái phải hiện đúng trạng thái hiện tại',
    ).toHaveText('Đang dùng');

    /*
     * BỘ NÚT CỦA CHẾ ĐỘ SỬA — đúng bằng bộ của chế độ thêm mới CỘNG hai thứ, BỚT một, không hơn:
     *   + "Trạng thái": máy đã tồn tại thì trạng thái mới là một quyết định thật.
     *   - "Ghi rồi thêm máy khác": đang sửa một máy thì không có "máy tiếp theo".
     *   + (i) cạnh "Giấy tờ đính kèm": khu này GHI THẲNG, nút Hủy của hộp không gỡ được file đã tải —
     *     nói ra ở nút giải thích thay cho băng cảnh báo (Q-18).
     */
    await expect
      .poll(() => controlName(editDialog.getByRole('button')), {
        message:
          'Chế độ SỬA = chế độ THÊM cộng ô "Trạng thái", bớt nút "Ghi rồi thêm máy khác"; khu giấy tờ ghi thẳng (chọn là tải, không có nút "Tải lên")',
      })
      .toEqual([
        'Đóng hộp thoại',
        'Loại',
        'Trạng thái',
        'Site',
        'Tủ mạng',
        'Nhà cung cấp',
        'Ngày mua',
        'Bảo hành từ',
        'Bảo hành đến',
        '+1 năm',
        '+2 năm',
        '+3 năm',
        'Giải thích: Giấy tờ đính kèm',
        'Chọn file để đính kèm',
        'Hủy',
        'Lưu',
      ]);

    await page.keyboard.press('Escape');
    await expect(editDialog, 'Esc đóng hộp sửa').toHaveCount(0);
    await expect(
      page.getByRole('cell', { name: 'Switch tầng 3 của bài kiểm kê' }),
      'Đóng bằng Esc thì hồ sơ phải y nguyên, không lưu gì cả',
    ).toBeVisible();

    /* ===== HỘP NHẬP TỪ EXCEL, LÚC VỪA MỞ RA ===== */
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    const importDialog = page.getByRole('dialog', { name: 'Nhập thiết bị từ Excel' });
    await expect(importDialog).toBeVisible();

    await expect
      .poll(() => controlName(importDialog.getByRole('button')), {
        message:
          'Hộp nhập có đúng: ✕ · ô chọn file · Tải file mẫu · Hủy · Đối chiếu · Xác nhận ghi — ba bước, đúng thứ tự đối chiếu-trước-ghi-sau',
      })
      // File mẫu là bước con của Nhập nên nằm TRONG hộp (DEV-007), không đứng ở đầu trang.
      .toEqual([
        'Đóng hộp thoại',
        'Chọn file .xlsx',
        'Tải file mẫu',
        'Hủy',
        'Đối chiếu',
        'Xác nhận ghi',
      ]);

    await expect(
      importDialog.getByRole('button', { name: 'Đối chiếu' }),
      'Chưa chọn file thì nút Đối chiếu phải TẮT',
    ).toBeDisabled();
    await expect(
      importDialog.getByRole('button', { name: 'Xác nhận ghi' }),
      'Chưa có bảng đối chiếu thì nút ghi phải TẮT — bật sẵn là mở đường ghi mù vào cả kho thiết bị',
    ).toBeDisabled();
    await expect(
      importDialog.getByText(
        'Dùng file mẫu hoặc file vừa xuất Excel. Site, tủ mạng, loại thiết bị, nhà cung cấp phải ' +
        'khai trong Danh mục trước — hệ thống không tự tạo.',
      ),
      'Hộp nhập phải tự nói ra điều kiện tiên quyết, không để người dùng đoán',
    ).toBeVisible();

    await importDialog.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(importDialog, 'nút ✕ đóng được hộp nhập').toHaveCount(0);
  });

  /*
   * ===== BÀI 5 =====
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Bài "đi hết các tab" ở khối 1 chỉ chứng minh mỗi tab BẤM ĐƯỢC và mở ra một vùng nội dung
   * KHÔNG rỗng — nó cố ý đi theo vị trí, không theo tên, và không nhìn vào bên trong. Nghĩa
   * là: đổi nội dung tab Két sắt thành một chữ "x" thì bài đó vẫn xanh.
   *
   * Bài này bước hẳn vào từng tab và hỏi "trong đây có đúng thứ phải có không". Nó cũng chốt
   * hai điều mà đọc code mới biết:
   *   - Tab Port map CHỈ hiện với loại thiết bị bật `has_port_map`. Bài này tạo một con Switch
   *     (seed: có port map) nên phải thấy ĐỦ NĂM tab.
   *   - Tab Két sắt hiện cho MỌI vai — panel tự nói tầng quyền của người xem chứ tab không bị
   *     ẩn theo vai.
   *
   * ĐỎ KHI: một tab biến mất khỏi hồ sơ (đặc biệt là Port map trên loại có port map), một tab
   * mở ra rỗng hoặc mất khối đặc trưng của nó, hai nút "Sửa hồ sơ"/"Thanh lý" ở đầu trang
   * thừa/thiếu, hoặc lịch sử KHÔNG ghi lại lượt tạo mới.
   */
  test('Hồ sơ một cái máy: năm tab, mỗi tab bày đúng thứ của nó', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const code = `TB-E2E-HOSO-${stamp}`;

    // Tạo qua GIAO DIỆN: lượt tạo này còn phải để lại một dòng trong tab Lịch sử ở cuối bài.
    await page.goto('/devices');
    await devicesPageButton(page, 'Thêm thiết bị').click();
    const form = page.getByRole('dialog', { name: 'Thêm thiết bị' });
    await form.getByLabel('Mã thiết bị').fill(code);
    await form.getByLabel('Tên thiết bị').fill('Switch của bài kiểm kê phòng');
    await form.getByRole('button', { name: 'Loại', exact: true }).click();
    await page.getByRole('option', { name: 'Switch', exact: true }).click();
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form, 'lưu xong thì hộp phải đóng').toHaveCount(0);

    await searchAndWaitForFilter(page, code);
    await page.getByRole('main').getByRole('link', { name: code, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(code) })).toBeVisible();

    /*
     * Nhãn tab có thể mang số đếm nối sau ("Giấy tờ 3"), và số đó về SAU hồ sơ một nhịp mạng
     * — nên cắt phần số đi rồi mới so tập hợp, và chờ bằng `expect.poll` thay vì đọc một lần.
     *
     * Số `0` thì KHÔNG vẽ ra: `ui/tabs.tsx` dùng phép thử truthy (`_SPEC.md:61`, `:529`).
     */
    await expect
      .poll(
        async () =>
          (await page.getByRole('tab').allInnerTexts()).map((name) =>
            name.replace(/\s+\d+$/, '').trim(),
          ),
        {
          message:
            'Hồ sơ một con Switch phải có ĐỦ NĂM tab — Port map chỉ có mặt vì loại này bật has_port_map (FR-006)',
        },
      )
      .toEqual(['Tổng quan', 'Sơ đồ cổng', 'Giấy tờ', 'Két sắt', 'Lịch sử']);

    const main = page.getByRole('main');
    const panel = page.getByRole('tabpanel');

    /* ===== TAB HỒ SƠ ===== */
    await expect
      .poll(() => controlName(main.getByRole('button')), {
        message:
          'Đầu hồ sơ thiết bị: "Sửa hồ sơ" + menu ⋮; tab Tổng quan thêm "Bổ sung n ô" và "Cấp IP" — không nút nào khác',
      })
      // "Thanh lý sẽ gỡ gì" nằm TRONG hộp Thanh lý (DEV-050), không còn là nút rời trên bản đồ.
      // Q-18: "Sửa hồ sơ" đứng ngoài; Đổi trạng thái (DEV-053) · Nhân bản (DEV-034) · Thanh lý
      // vào menu ⋮. Mã máy không còn nút chép (tiêu đề trang, bôi đen chép được). "Bổ sung n ô
      // còn thiếu" (DEV-066) và "Cấp IP" (DEV-089) ở tab Tổng quan — máy chưa có IP thì "Cấp IP"
      // là nút chính ngay trong ô "IP quản trị", nên đứng trước "Bổ sung".
      .toEqual([
        'Sửa hồ sơ',
        `Thao tác với ${code}`,
        'Cấp IP',
        'Bổ sung 6 ô còn thiếu',
      ]);
    await expect(panel.getByText('Chưa có IP', { exact: true })).toBeVisible();
    expect(await rowActionNames(page, code)).toEqual(['Đổi trạng thái', 'Nhân bản', 'Thanh lý']);

    /*
     * MỖI Ô KỂ MỘT LẦN — hoặc là một ô có giá trị, hoặc là một cái tên trong dòng "Chưa khai".
     *
     * Đòi CẢ HAI cùng lúc — ô "Model" rỗng (một dấu gạch ngang) VÀ dòng "Chưa khai: Model, …"
     * — là khoá lại một lưới toàn gạch ngang, rồi ngay dưới là một câu nói lại y hệt danh sách
     * ấy.
     *
     * Luật bài kiểm giữ: ô KHÔNG có giá trị thì không vẽ ra ô nào.
     */
    for (const label of ['Model', 'Serial', 'Nhà cung cấp', 'Ngày mua', 'Ghi chú']) {
      await expect(
        panel.getByText(label, { exact: true }),
        `Máy này chưa khai "${label}" nên KHÔNG được vẽ một ô rỗng cho nó — tên của nó chỉ được xuất hiện trong dòng "Chưa khai"`,
      ).toHaveCount(0);
    }
    await expect(
      panel.getByText('Chưa khai: Model, Serial, Nhà cung cấp, Phòng ban sử dụng, Ngày mua, Ghi chú.'),
      'Ô chưa khai phải gom về MỘT dòng nói rõ còn thiếu gì, thay cho một dãy hộp toàn dấu gạch ngang',
    ).toBeVisible();

    /* ===== TAB PORT MAP ===== */
    await page.getByRole('tab', { name: 'Sơ đồ cổng' }).click();
    /*
     * `expect.poll`, KHÔNG phải `expect(await …)`.
     *
     * Lượt chạy đầu đỏ ở đúng đây với mảng RỖNG, mà ảnh chụp lại cho thấy hai tiêu đề nằm sờ
     * sờ trong panel. Nguyên nhân không phải giao diện thiếu: `PortMapPanel` hỏi
     * `/devices/:id/ports` rồi mới vẽ, nên ngay sau cú bấm tab nó đang là khối "Đang tải".
     * Đọc một phát bằng `await` thì đọc trúng khoảnh khắc đó và KHÔNG có lần đọc thứ hai —
     * đây là cái bẫy của mọi khẳng định so-tập-hợp: `expect(locator)` tự thử lại, `expect(giá
     * trị đã await)` thì không.
     */
    await expect
      .poll(() => labelOf(panel.getByRole('heading', { level: 2 })), {
        message:
          'Port map luôn kể HAI chiều: cổng của máy này, và ai đang cắm vào nó (AD-14 — một sợi dây một bản ghi)',
      })
      .toEqual(['Cổng của thiết bị này', 'Đang cắm vào thiết bị này']);
    await expect(
      panel.getByRole('button', { name: 'Thêm cổng' }),
      'Máy chưa thanh lý thì phải khai được cổng',
    ).toBeVisible();
    await expect(panel.getByText('Chưa khai cổng nào.')).toBeVisible();
    await expect(
      panel.getByText('Chưa có thiết bị nào khai là đang cắm vào đây.'),
      'Chiều ngược rỗng vẫn phải nói ra, không được im lặng biến mất',
    ).toBeVisible();

    /* ===== TAB GIẤY TỜ ===== */
    await page.getByRole('tab', { name: /^Giấy tờ/ }).click();
    await expect(
      panel.getByRole('button', { name: 'Chọn file để đính kèm' }),
      'Tab Giấy tờ phải có khu chọn file',
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Tải lên' }),
      'Chọn file là tải ngay — không còn nút "Tải lên" riêng để người dùng quên bấm',
    ).toHaveCount(0);
    await expect(panel.getByText('Chưa có giấy tờ nào.')).toBeVisible();
    await expect(
      panel.getByText(
        'File chỉ tải về máy, không mở trong trình duyệt (chống mã độc).',
      ),
      'Luật "chỉ tải về, không mở inline" phải nói ra ngay chỗ người dùng đính kèm',
    ).toBeVisible();

    /* ===== TAB KÉT SẮT ===== */
    await page.getByRole('tab', { name: /^Két sắt/ }).click();
    await expect(
      panel.getByText(
        'Nơi cất mật khẩu và license key, đã mã hóa. Xem giá trị phải nhập mã 2 lớp.',
      ),
      'Két sắt phải tự nói ra luật chơi của nó trước khi ai bấm gì',
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Cất mật khẩu/khóa' }),
      'SA phải có cửa ghi vào két ngay tại hồ sơ máy',
    ).toBeVisible();
    await expect(panel.getByText('Két chưa có ngăn nào')).toBeVisible();

    /* ===== TAB LỊCH SỬ ===== */
    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    await expect(
      panel.getByRole('listitem'),
      'Máy vừa khai xong phải có ĐÚNG MỘT dòng lịch sử — không có dòng nào nghĩa là lượt tạo không được ghi sổ (AD-13)',
    ).toHaveCount(1);
    await expect(
      panel.getByText('Tạo hồ sơ', { exact: true }),
      'và dòng đó phải đọc được ra tiếng Việt, không phải chuỗi thô "created"',
    ).toBeVisible();
    // DEV-085: lịch sử nêu HỌ TÊN người làm (không phải email).
    await expect(
      panel.getByText(/^E2E Super Admin · /),
      'Lịch sử phải nói AI làm — "ai đổi gì, lúc nào" là cả lý do tab này tồn tại (FR-007)',
    ).toBeVisible();
  });
});
