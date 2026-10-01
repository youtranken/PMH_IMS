import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  confirmAction,
  firstLogin,
  resetDevices,
  resetDigestRules,
  resetSoftware,
  resetUsers,
  rowAction,
  mailpitMessages,
  rowActionNames,
  searchAndWaitForFilter,
  writeHeaders,
  uniqueStamp,
} from './helpers';

/*
 * ===== VÀO HẲN TRONG PHÒNG: PHẦN MỀM và SẮP HẾT HẠN =====
 *
 * Mười bốn bài phía trên đi HÀNH LANG — menu, breadcrumb, ranh giới vai. Chúng chứng minh
 * "bấm vào đây thì tới được đó", nhưng không bao giờ hỏi "tới nơi rồi thì trong phòng có
 * những gì". Sáu bài dưới đây làm đúng việc còn thiếu đó cho hai phòng:
 *
 *   /software      — danh sách, hộp Thêm/Sửa hồ sơ, hộp Gán vào máy, trang hồ sơ và các tab
 *   /expiry        — tab Danh sách, tab Luật gửi báo cáo, hộp Gia hạn, hộp Thêm/Sửa luật
 *
 * VÌ SAO KHÔNG PHẢI `toBeVisible()` TỪNG CÁI. Khẳng định "nút X có mặt" chỉ bắt được thứ MẤT
 * ĐI. Thứ THỪA RA — một nút chưa gỡ sau khi bỏ tính năng, một ô nhập của module khác lọt vào
 * form, một mục menu bày ra cho hồ sơ đã thanh lý — thì luôn xanh. Nên ở đây đếm cả tập
 * (`toHaveCount` trên tập + `toEqual` trên danh sách tên), không liệt kê từng cái rồi thôi.
 *
 * Bộ E2E đã có `software.spec.ts`, `license-assignment.spec.ts`, `expiry.spec.ts`,
 * `expiry-digest.spec.ts` — chúng kiểm NGHIỆP VỤ (seat có tăng không, email có đi không, gia
 * hạn lùi có bị chặn không). Sáu bài này KHÔNG kiểm lại nghiệp vụ: chúng kiểm ĐỒ ĐẠC trong
 * phòng và tay nắm trên đồ đạc đó.
 */
test.describe('Phòng Phần mềm và phòng Sắp hết hạn — bên trong có gì', () => {
  test.beforeEach(() => {
    resetUsers();
    resetSoftware();
    // Bài "Gán vào máy" và bài tab "Máy đang dùng" cần máy thật; bài Sắp hết hạn cần một cái
    // máy còn hạn bảo hành để chứng minh vế KHÔNG gia hạn được.
    resetDevices();
    resetDigestRules();
  });

  /** Mã hồ sơ / mã máy / tên luật đều phải mang dấu "E2E" — script dọn bám vào đúng dấu đó. */
  const stampOf = () => uniqueStamp();

  async function createSoftware(
    page: Page,
    data: Record<string, unknown>,
  ): Promise<string> {
    const res = await page.request.post('/api/v1/software', {
      headers: await writeHeaders(page),
      data,
    });
    expect(res.status(), `tạo hồ sơ ${String(data.code)} phải thành công`).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  async function createDevice(
    page: Page,
    code: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const catalog = await page.request.get('/api/v1/catalog');
    const types = ((await catalog.json()) as { deviceTypes: { id: string; name: string }[] })
      .deviceTypes;
    const type = types.find((item) => item.name === 'PC') ?? types[0];
    const res = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: { code, name: `Máy ${code}`, deviceTypeId: type.id, ...extra },
    });
    expect(res.status(), `tạo máy ${code} phải thành công`).toBe(201);
    return ((await res.json()) as { device: { id: string } }).device.id;
  }

  /** Bày sẵn một cái ghế đã gán để tab "Máy đang dùng" có BẢNG chứ không phải khung rỗng. */
  async function assignSeat(
    page: Page,
    softwareId: string,
    deviceId: string,
    terms: Record<string, unknown>,
  ): Promise<void> {
    const res = await page.request.post(`/api/v1/software/${softwareId}/assignments`, {
      headers: await writeHeaders(page),
      data: { deviceId, overSeatReason: '', ...terms },
    });
    expect(res.status(), 'gán ghế license phải thành công').toBe(201);
  }

  /**
   * Tên các cột, đọc từ NỘI DUNG VĂN BẢN chứ không phải chữ đã qua CSS.
   *
   * ĐÃ ĐO: `allInnerTexts()` trả về chữ SAU khi trình duyệt áp
   * `text-transform: uppercase` của `th`, nên nó ra "MÃ HỒ SƠ" trong khi chuỗi thật trong
   * `vi.ts` là "Mã hồ sơ". So với `vi.ts` mà lấy `innerText` là so hai thứ khác nhau: đổi
   * một dòng CSS sẽ làm đỏ một bài kiểm nội dung, còn đổi chữ trong `vi.ts` thì… cũng đỏ,
   * nhưng vì lý do trộn lẫn. `allTextContents()` không dính CSS.
   *
   * Cũng không dùng TÊN TRỢ NĂNG: tên trợ năng của ô tiêu đề sắp-xếp-được là "Sắp xếp theo
   * …" (nút con mang `aria-label` đó), một chuỗi khác hẳn thứ người dùng nhìn thấy.
   */
  async function columnTexts(page: Page): Promise<string[]> {
    const texts = await page.getByRole('columnheader').allTextContents();
    return texts.map((text) => text.trim());
  }

  /*
   * ===================================================================================
   * BÀI 1 — PHÒNG DANH SÁCH PHẦN MỀM: đầu trang có gì, lọc được gì, bảng có cột nào,
   *          và menu ba chấm của mỗi dòng bày ra ĐÚNG những việc làm được.
   * ===================================================================================
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `software.spec.ts` đã kiểm sắp xếp chạy ở server và tạo hồ sơ qua form. Nhưng chưa bài
   * nào chốt BỘ ĐỒ của màn này: đúng hai nút đầu trang, đúng hai ô lọc, đúng tám cột, và —
   * quan trọng nhất — đúng những mục trong menu ba chấm. Ba mục đó có hai luật ẩn nằm trong
   * `software-screen.tsx`: "Gán vào máy" CHỈ có với loại license (`supportsSeats`), và "Đưa
   * vào kho thanh lý" BIẾN MẤT khi hồ sơ đã ở trạng thái `retired`.
   *
   * ĐỎ KHI: có thêm/bớt một nút ở đầu trang, một cột bị đổi tên hoặc rơi mất, ô tìm ngừng
   * lọc thật (bảng không thu hẹp), `aria-sort` không lật khi bấm tiêu đề, hàng không đảo
   * thứ tự, hoặc một trong hai luật ẩn của menu ba chấm bị gỡ — bày "Gán vào máy" cho một
   * hợp đồng bảo trì, hoặc bày "Đưa vào kho thanh lý" cho hồ sơ đã bỏ.
   */
  test('Phòng Phần mềm: đúng bộ nút, ô tìm thu hẹp thật, đủ cột, và menu ba chấm theo loại', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = stampOf();
    const prefix = `PHONG-E2E-${stamp}`;
    const licenseCode = `${prefix}-A-LIC`;
    const sslCode = `${prefix}-B-SSL`;
    const maintCode = `${prefix}-C-MAINT`;

    const licenseId = await createSoftware(page, {
      code: licenseCode,
      name: 'Zulu — license xếp cuối theo tên',
      kind: 'license',
      seatTotal: 5,
      startDate: '2026-01-01',
      endDate: '2028-12-31',
    });
    await createSoftware(page, {
      code: sslCode,
      name: 'Alpha — chứng chỉ xếp đầu theo tên',
      kind: 'ssl',
      endDate: '2029-01-31',
    });
    await createSoftware(page, {
      code: maintCode,
      name: 'Mike — hợp đồng xếp giữa theo tên',
      kind: 'maintenance',
      endDate: '2029-02-28',
    });

    await page.goto('/software');
    const main = page.getByRole('main');
    const search = page.getByRole('searchbox', { name: 'Tìm theo mã, tên, ghi chú hoặc mã máy' });

    /*
     * BỘ NÚT ĐẦU TRANG — đếm khi bảng RỖNG.
     *
     * Lúc bảng có dòng thì mỗi tiêu đề sắp-xếp-được là một nút, mỗi dòng thêm một nút ba
     * chấm, và phân trang thêm ba nút nữa — không còn đếm được cái gì. Gõ một chuỗi chắc
     * chắn không khớp là dọn sạch phần đó đi, chỉ còn lại đúng bộ đồ cố định của phòng:
     * hai nút đầu trang + hai ô lọc.
     */
    await search.fill(`KHONG-CO-HO-SO-NAO-E2E-${stamp}`);
    await expect(
      page.getByText('Không có hồ sơ nào khớp bộ lọc.'),
      'Lọc không ra gì phải nói rõ là rỗng, không phải bảng trắng',
    ).toBeVisible();

    await expect(
      main.getByRole('button'),
      'Phòng Phần mềm lúc rỗng chỉ được có 6 nút: Xuất Excel · Thêm phần mềm · ô lọc Loại · Trạng thái · Nhà cung cấp · Kỳ hạn',
    ).toHaveCount(6);
    for (const name of ['Xuất Excel', 'Thêm phần mềm', 'Loại', 'Trạng thái', 'Nhà cung cấp', 'Kỳ hạn']) {
      await expect(
        main.getByRole('button', { name, exact: true }),
        `Đầu phòng Phần mềm phải có đúng một nút "${name}"`,
      ).toHaveCount(1);
    }

    // ===== Ô TÌM PHẢI THU HẸP BẢNG THẬT, không chỉ đổi chữ trong ô =====
    await search.fill(prefix);
    await expect(
      page.getByRole('row'),
      'Gõ tiền tố chung phải ra đúng 3 hồ sơ vừa tạo (cộng 1 dòng tiêu đề)',
    ).toHaveCount(4);

    await search.fill(sslCode);
    await expect(
      page.getByRole('row'),
      'Gõ đích danh một mã thì bảng phải còn đúng dòng đó',
    ).toHaveCount(2);
    await expect(
      page.getByRole('row', { name: new RegExp(licenseCode) }),
      'Hồ sơ không khớp ô tìm phải BIẾN MẤT — nếu còn thì ô tìm chỉ là trang trí',
    ).toHaveCount(0);

    // ===== ĐỦ BỘ CỘT =====
    await search.fill(prefix);
    await expect(page.getByRole('row')).toHaveCount(4);
    expect(
      await columnTexts(page),
      /* Loại là dòng phụ dưới tên; "Tình trạng" gộp hạn + trạng thái Q-03 — để bảng vừa
         1280px với cột Thao tác trong khung. */
      'Bảng phần mềm phải có đúng 6 cột này, đúng thứ tự này',
    ).toEqual(['Mã hồ sơ', 'Tên hồ sơ', 'Nhà cung cấp', 'Ghế', 'Tình trạng', 'Thao tác']);

    // ===== SẮP XẾP: aria-sort phải lật, VÀ thứ tự dòng phải đảo theo =====
    const sortByCode = page.getByRole('button', { name: 'Sắp xếp theo Mã hồ sơ' });
    const codeHeader = page
      .getByRole('columnheader')
      .filter({ has: page.getByRole('button', { name: 'Sắp xếp theo Mã hồ sơ' }) });

    await expect(
      codeHeader,
      'Mặc định danh sách sắp theo mã tăng dần — ô tiêu đề phải nói ra điều đó',
    ).toHaveAttribute('aria-sort', 'ascending');
    await expect(
      page.getByRole('row').nth(1),
      'Sắp tăng theo mã thì hồ sơ ...-A-LIC đứng đầu',
    ).toContainText(licenseCode);

    await sortByCode.click();
    await expect(
      codeHeader,
      'Bấm lần nữa phải lật sang giảm dần — `aria-sort` là thứ duy nhất người dùng trình đọc màn hình nghe được',
    ).toHaveAttribute('aria-sort', 'descending');
    await expect(
      page.getByRole('row').nth(1),
      'Lật `aria-sort` mà thứ tự dòng không đổi thì cái mũi tên đang nói dối',
    ).toContainText(maintCode);

    /*
     * ===== MENU BA CHẤM: ĐÚNG NHỮNG MỤC NÀO =====
     *
     * `toEqual` chứ không phải "có chứa": mục thừa ra mới là kiểu hỏng im lặng. Bày "Gán vào
     * máy" trên một hợp đồng bảo trì thì bấm vào sẽ mở hộp gán seat cho thứ không có seat.
     */
    expect(
      await rowActionNames(page, licenseCode),
      'Hồ sơ LICENSE còn dùng: Sửa · Gán vào máy · Gia hạn · Đưa vào kho thanh lý (việc nguy hiểm xếp cuối)',
    ).toEqual(['Sửa', 'Gán vào máy', 'Gia hạn', 'Đưa vào kho thanh lý']);

    expect(
      await rowActionNames(page, maintCode),
      'Hợp đồng bảo trì KHÔNG có ghế để gán — mục "Gán vào máy" không được xuất hiện',
    ).toEqual(['Sửa', 'Gia hạn', 'Đưa vào kho thanh lý']);

    /*
     * Vế còn lại của luật ẩn: hồ sơ ĐÃ BỎ thì không bày mục bỏ nữa. Đưa vào kho bằng API cho
     * gọn — bài này kiểm CÁI MENU, không kiểm luồng thanh lý (đã có `disposal.spec.ts`).
     */
    const retired = await page.request.patch(`/api/v1/software/${licenseId}`, {
      headers: await writeHeaders(page),
      data: { status: 'retired' },
    });
    expect(retired.status(), 'đưa hồ sơ vào kho thanh lý qua API phải thành công').toBeLessThan(300);

    // Mặc định danh sách giấu hồ sơ Thanh lý (SW-006) — chọn "Mọi trạng thái" qua URL.
    await page.goto('/software?status=all');
    await search.fill(prefix);
    await expect(page.getByRole('row', { name: new RegExp(licenseCode) })).toBeVisible();
    expect(
      await rowActionNames(page, licenseCode),
      'Hồ sơ đã bỏ: không Gán, không Gia hạn, không bỏ lần hai — chỉ Sửa và Khôi phục…',
    ).toEqual(['Sửa', 'Khôi phục…']);
  });

  /*
   * ===================================================================================
   * BÀI 2 — MỞ HỘP "THÊM HỒ SƠ" RA XEM BÊN TRONG, rồi mở hộp "SỬA HỒ SƠ" xem nó có
   *          mang giá trị cũ vào không.
   * ===================================================================================
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `software.spec.ts` điền ba ô rồi bấm Lưu — đủ để chứng minh form GHI được, không đủ để
   * chứng minh form còn ĐỦ Ô. Một `<Field>` lặng lẽ rơi mất khỏi `software-form.tsx` là một
   * trường không bao giờ được nhập nữa: hồ sơ vẫn lưu thành công, cột trên bảng vẫn hiện dấu
   * gạch, và không có bài nào đỏ.
   *
   * Bài này chốt cả BA thứ: đủ ô, đúng vai của từng ô (textbox / nút chọn / ô ngày / nút chọn
   * file), và đúng danh sách lựa chọn bên trong mỗi ô chọn.
   *
   * ĐỎ KHI: thêm hoặc bớt một ô trong form; một ô đổi từ `Select` sang `<input>` (người dùng
   * bàn phím thao tác khác hẳn); ô "Trạng thái" rò rỉ sang form THÊM MỚI (mở đường cho một
   * hồ sơ vừa tạo đã ở trạng thái "đã thanh lý"); danh sách loại/kỳ hạn/nhà cung cấp lệch
   * khỏi danh mục thật; câu báo lỗi đổi mà không ai biết; hoặc form Sửa mở ra TRỐNG.
   */
  test('Bên trong hộp "Thêm phần mềm" và hộp "Sửa hồ sơ" — đủ ô, đúng vai, đúng lựa chọn', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = stampOf();
    const code = `HOP-E2E-${stamp}-LIC`;
    await createSoftware(page, {
      code,
      name: 'License để mở form sửa',
      kind: 'license',
      seatTotal: 7,
      startDate: '2026-02-01',
      endDate: '2028-11-30',
      note: 'Ghi chú cũ của hồ sơ E2E',
    });

    // Danh mục nhà cung cấp là dữ liệu THẬT của hệ thống — đọc từ API rồi so với ô chọn,
    // chứ không gõ cứng vài cái tên (gõ cứng thì bài đỏ mỗi lần ai đó khai thêm một hãng).
    const catalogRes = await page.request.get('/api/v1/catalog?includeInactive=true');
    const vendorNames = ((await catalogRes.json()) as { vendors: { name: string }[] }).vendors.map(
      (vendor) => vendor.name,
    );

    await page.goto('/software');
    await page.getByRole('button', { name: 'Thêm phần mềm' }).first().click();

    const add = page.getByRole('dialog', { name: 'Thêm phần mềm' });
    await expect(add, 'Bấm "Thêm phần mềm" phải mở đúng hộp mang tên đó').toBeVisible();

    /*
     * ===== TIÊU ĐỀ HỘP + CÁC KHỐI CỦA FORM =====
     *
     * Radix vẽ TIÊU ĐỀ HỘP THOẠI cũng bằng `<h2>`, nên nó đứng cùng hạng với các tiêu đề khối
     * bên dưới. Đọc `textContent` (không phải `innerText`) vì
     * `.form-section-title` viết hoa toàn bộ bằng CSS.
     */
    expect(
      (await add.getByRole('heading', { level: 2 }).allTextContents()).map((text) => text.trim()),
      'Hộp thêm hồ sơ (license): tiêu đề hộp, rồi các khối — hồ sơ, thời hạn, ghế + ghi chú, giấy tờ',
    ).toEqual(['Thêm phần mềm', 'Hồ sơ', 'Thời hạn', 'Ghế và ghi chú', 'Giấy tờ đính kèm']);

    // ===== Ô GÕ CHỮ =====
    await expect(
      add.getByRole('textbox'),
      'Form thêm hồ sơ có đúng 4 ô gõ chữ: Mã hồ sơ · Tên hồ sơ · Số ghế · Ghi chú',
    ).toHaveCount(4);
    for (const name of ['Mã hồ sơ', 'Tên hồ sơ', 'Số ghế', 'Ghi chú']) {
      await expect(
        add.getByRole('textbox', { name, exact: true }),
        `Ô "${name}" phải là ô gõ chữ và phải có đúng một cái`,
      ).toHaveCount(1);
    }

    /*
     * ===== NÚT: ô chọn, ô ngày, nút (i), +1/+2/+3 năm, ô chọn file, và hai nút chân hộp =====
     *
     * `<input type="file">` được trình duyệt phơi ra như một NÚT mang tên của nhãn — nên nó
     * nằm trong phép đếm này chứ không nằm trong phép đếm ô gõ chữ ở trên.
     */
    await expect(
      add.getByRole('button'),
      'Hộp thêm hồ sơ có đúng 11 nút — thừa một cái là có thứ gì đó vừa lọt vào form',
    ).toHaveCount(11);
    for (const name of [
      'Đóng hộp thoại',
      'Nhà cung cấp',
      'Giải thích: Kỳ hạn',
      'Bắt đầu',
      'Hết hạn',
      '+1 năm',
      '+2 năm',
      '+3 năm',
      'Chọn file để đính kèm',
      'Hủy',
      'Lưu',
    ]) {
      await expect(
        add.getByRole('button', { name, exact: true }),
        `Hộp thêm hồ sơ phải có đúng một nút "${name}"`,
      ).toHaveCount(1);
    }

    await expect(
      add.getByRole('button', { name: 'Trạng thái', exact: true }),
      'THÊM MỚI thì không được có ô Trạng thái: hồ sơ vừa tạo mà chọn được "đã thanh lý" là vô nghĩa',
    ).toHaveCount(0);

    /*
     * ===== BÊN TRONG TỪNG Ô CHỌN =====
     *
     * Danh sách lựa chọn PORTAL ra khỏi khung `<form>`, nên hỏi từ `page` chứ không từ `add`.
     * Đóng menu bằng cách bấm lại đúng lựa chọn đang chọn — không đổi dữ liệu, và không phải
     * mượn phím Esc (Esc ở đây còn có nghĩa "đóng cả hộp thoại").
     */
    // Loại là dải nút chọn ĐẦU form (SW-026): nó quyết định form có những ô nào.
    const kindGroup = add.getByRole('radiogroup', { name: 'Loại' });
    expect(
      (await kindGroup.getByRole('radio').evaluateAll((els) =>
        els.map((el) => (el.closest('label')?.textContent ?? '').trim()),
      )),
      'Ô "Loại" phải bày đủ 5 loại hồ sơ mà hệ thống biết',
    ).toEqual([
      'License phần mềm',
      'Chứng chỉ SSL',
      'Tên miền',
      'Hợp đồng bảo trì',
      'Khác',
    ]);
    await expect(kindGroup.getByRole('radio', { name: 'License phần mềm' })).toBeChecked();

    const modelGroup = add.getByRole('radiogroup', { name: 'Kỳ hạn' });
    await expect(
      modelGroup.getByRole('radio'),
      'Kỳ hạn chỉ có hai đường: thuê bao (có hạn) hoặc mua đứt',
    ).toHaveCount(2);
    await expect(modelGroup.getByRole('radio', { name: 'Thuê bao' })).toBeChecked();
    // Vĩnh viễn: ô Hết hạn thành chữ tĩnh "Không hết hạn", không biến mất (bố cục không nhảy).
    await modelGroup.getByRole('radio', { name: 'Vĩnh viễn' }).check();
    await expect(add.getByText('Không hết hạn')).toBeVisible();
    await expect(add.getByRole('button', { name: 'Hết hạn', exact: true })).toHaveCount(0);
    await modelGroup.getByRole('radio', { name: 'Thuê bao' }).check();

    const vendorSelect = add.getByRole('button', { name: 'Nhà cung cấp', exact: true });
    await vendorSelect.click();
    expect(
      (await page.getByRole('option').allInnerTexts()).map((text) => text.trim()),
      'Ô nhà cung cấp phải bày đúng danh mục hãng đang có, không nhiều không ít',
    ).toEqual(vendorNames);
    // Bấm lại chính cái nút để đóng danh sách: danh mục hãng có thể rỗng nên không chắc có
    // lựa chọn nào để bấm, và Esc ở đây còn mang nghĩa thứ hai là "đóng cả hộp thoại".
    await vendorSelect.click();
    await expect(page.getByRole('option'), 'Danh sách hãng phải đóng lại').toHaveCount(0);

    /*
     * ===== ĐƯỜNG HỎNG (SW-024) =====
     *
     * Điền hai ô bắt buộc bằng KHOẢNG TRẮNG: luật `trim()` của form phải bắt, và câu lỗi là
     * tiếng Việt dưới từng ô — không còn bong bóng tiếng Anh của trình duyệt (form `noValidate`).
     */
    await add.getByRole('textbox', { name: 'Mã hồ sơ', exact: true }).fill('   ');
    await add.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }).fill('   ');
    await add.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu' }).click();

    await expect(
      add.getByRole('textbox', { name: 'Mã hồ sơ', exact: true }),
      'Lưu hồ sơ trống phải nói rõ thiếu gì, ngay dưới ô Mã',
    ).toHaveAccessibleDescription('Bắt buộc — chưa nhập ô này.');
    await expect(
      add.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }),
      'và dưới ô Tên',
    ).toHaveAccessibleDescription('Bắt buộc — chưa nhập ô này.');
    // Kỳ hạn đang là Thuê bao mà chưa có ngày hết hạn: báo ngay tại ô (SW-028), nên là BA ô.
    await expect(
      add.getByText('Nhập ngày hết hạn để hệ thống nhắc gia hạn.'),
    ).toBeVisible();
    await expect(add.getByText('Còn 3 ô cần sửa trước khi lưu.')).toBeVisible();
    await expect(
      add,
      'Lưu hỏng thì hộp phải Ở LẠI — đóng mất là người dùng tưởng đã lưu xong',
    ).toBeVisible();

    // ===== HAI ĐƯỜNG ĐÓNG HỘP =====
    /* Form đã gõ dở, nên lối đóng TÌNH CỜ phải hỏi lại trước (`Dialog guardUnsaved`) — trả
       lời xong mới đóng. */
    await add.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await confirmAction(page, 'Bỏ và đóng');
    await expect(add, 'Nút ✕ phải đóng được hộp').toHaveCount(0);

    await page.getByRole('button', { name: 'Thêm phần mềm' }).first().click();
    await expect(add).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(add, 'Phím Esc cũng phải đóng được hộp (hộp không đang ghi)').toHaveCount(0);

    /*
     * ===== CHẾ ĐỘ SỬA: form phải mang giá trị cũ vào =====
     *
     * Form sửa mở ra trống là kiểu hỏng tệ nhất của màn nhập: bấm Lưu một phát là ghi đè sạch
     * mọi thứ, và trên màn hình không có gì báo rằng dữ liệu vừa bị xóa.
     */
    await searchAndWaitForFilter(page, code);
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
    await rowAction(page, code, 'Sửa');

    const edit = page.getByRole('dialog', { name: `Sửa hồ sơ — ${code}` });
    await expect(edit, 'Hộp sửa phải mang tên hồ sơ đang sửa trên tiêu đề').toBeVisible();

    await expect(
      edit.getByRole('textbox', { name: 'Mã hồ sơ', exact: true }),
      'Ô mã phải mang mã cũ',
    ).toHaveValue(code);
    await expect(
      edit.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }),
      'Ô tên phải mang tên cũ',
    ).toHaveValue('License để mở form sửa');
    await expect(
      edit.getByRole('textbox', { name: 'Số ghế', exact: true }),
      'Ô số ghế phải mang số cũ',
    ).toHaveValue('7');
    await expect(
      edit.getByRole('textbox', { name: 'Ghi chú', exact: true }),
      'Ô ghi chú phải mang ghi chú cũ',
    ).toHaveValue('Ghi chú cũ của hồ sơ E2E');

    await expect(
      edit.getByRole('radio', { name: 'License phần mềm' }),
      'Ô chọn Loại phải đang đứng ở loại cũ',
    ).toBeChecked();
    await expect(
      edit.getByRole('radio', { name: 'Thuê bao' }),
      'Ô chọn Kỳ hạn phải đang đứng ở kỳ hạn cũ',
    ).toBeChecked();
    await expect(
      edit.getByRole('button', { name: 'Hết hạn', exact: true }),
      'Ô ngày hết hạn phải mang hạn cũ (2028), không phải chữ mời chọn ngày',
    ).toContainText('2028');

    // Ô Trạng thái CHỈ có ở chế độ sửa — đây là vế đối chứng của phép đếm bên form thêm mới.
    const statusSelect = edit.getByRole('button', { name: 'Trạng thái', exact: true });
    await expect(statusSelect, 'Sửa hồ sơ thì phải đổi được trạng thái').toHaveCount(1);
    await expect(statusSelect, 'Hồ sơ vừa tạo đang ở trạng thái đang dùng').toHaveText('Đang dùng');
    await statusSelect.click();
    expect(
      (await page.getByRole('option').allInnerTexts()).map((text) => text.trim()),
      'Người chỉ chọn Đang dùng / Thanh lý — "Hết hạn" do hệ thống tự đặt theo ngày (DOM-03)',
    ).toEqual(['Đang dùng', 'Đã thanh lý']);
    await statusSelect.click();
    await expect(page.getByRole('option'), 'Danh sách trạng thái phải đóng lại').toHaveCount(0);

    // Đóng mà KHÔNG lưu — bài này chỉ đi xem, không được để lại dấu vết trên dữ liệu.
    await edit.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(edit).toHaveCount(0);
  });

  /*
   * ===================================================================================
   * BÀI 3 — HỘP "GÁN VÀO MÁY": một cái hộp, HAI chế độ.
   * ===================================================================================
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `AssignDialog` phục vụ cả "gán máy mới" lẫn "sửa kỳ hạn/chi phí của một ghế đã gán" —
   * cùng một bộ ô, khác nhau đúng hai chỗ: có ô chọn máy hay không, và nút chân hộp ghi
   * "Gán vào máy" hay "Lưu". Gộp như thế là cố ý (AD-15), nhưng nó cũng có nghĩa là một thay
   * đổi cho chế độ này lặng lẽ đổi luôn chế độ kia.
   *
   * `license-assignment.spec.ts` kiểm NGHIỆP VỤ của hai chế độ (seat tăng, vượt seat, kỳ hạn
   * ngược). Bài này kiểm HÌNH DẠNG: đủ ô, đúng vai, và hai chế độ khác nhau đúng ở hai chỗ đó.
   *
   * ĐỎ KHI: một ô kỳ hạn/chi phí rơi mất ở một trong hai chế độ; ô chọn máy đổi vai (từ
   * combobox gõ-để-tìm sang một danh sách thả xuống); ô chọn máy rò sang chế độ SỬA (đổi máy
   * bằng cách sửa ghế thì lịch sử "key này từng nhập máy nào" mất một chặng); ô "Lý do vượt
   * seat" hiện ngay từ đầu; hoặc câu chặn "Chọn máy để gán." biến mất.
   */
  test('Bên trong hộp "Gán vào máy" — chế độ gán mới và chế độ sửa ghế', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = stampOf();
    const licenseCode = `GAN-E2E-${stamp}-LIC`;
    const deviceCode = `PC-E2E-GAN-${stamp}`;

    const licenseId = await createSoftware(page, {
      code: licenseCode,
      name: 'License để mở hộp gán',
      kind: 'license',
      seatTotal: 5,
      endDate: '2028-12-31',
    });
    const deviceId = await createDevice(page, deviceCode);

    // ===== CHẾ ĐỘ GÁN MỚI, mở thẳng từ menu ba chấm của danh sách =====
    await page.goto('/software');
    await searchAndWaitForFilter(page, licenseCode);
    await expect(page.getByRole('row', { name: new RegExp(licenseCode) })).toBeVisible();
    await rowAction(page, licenseCode, 'Gán vào máy');

    const assign = page.getByRole('dialog', { name: `Gán license vào máy — ${licenseCode}` });
    await expect(assign, 'Hộp gán phải nói rõ đang gán license nào').toBeVisible();

    await expect(
      assign.getByRole('combobox'),
      'Chọn máy là ô GÕ ĐỂ TÌM (combobox), không phải danh sách thả xuống — kho có hàng nghìn máy',
    ).toHaveCount(1);

    await expect(
      assign.getByRole('textbox'),
      'Hộp gán có đúng 3 ô gõ chữ: Chi phí · Hợp đồng · Ghi chú',
    ).toHaveCount(3);
    for (const name of ['Chi phí', 'Hợp đồng', 'Ghi chú']) {
      await expect(
        assign.getByRole('textbox', { name, exact: true }),
        `Hộp gán phải có đúng một ô "${name}"`,
      ).toHaveCount(1);
    }

    await expect(
      assign.getByRole('button'),
      'Hộp gán có đúng 5 nút: ✕ · hai ô ngày · Hủy · Gán vào máy',
    ).toHaveCount(5);
    // Chọn máy theo Máy | Phòng ban | Người sử dụng (Q-15) — dải radio, mặc định là Máy.
    const pickBy = assign.getByRole('radiogroup', { name: 'Chọn máy theo' });
    await expect(pickBy.getByRole('radio')).toHaveText(['Máy', 'Phòng ban', 'Người sử dụng']);
    await expect(pickBy.getByRole('radio', { name: 'Máy', exact: true })).toBeChecked();
    for (const name of [
      'Đóng hộp thoại',
      'Bắt đầu',
      'Kết thúc',
      'Hủy',
      'Gán vào máy',
    ]) {
      await expect(
        assign.getByRole('button', { name, exact: true }),
        `Hộp gán phải có đúng một nút "${name}"`,
      ).toHaveCount(1);
    }

    await expect(
      assign.getByRole('textbox', { name: 'Lý do vượt số ghế', exact: true }),
      'Ô lý do vượt seat chỉ mở ra KHI hết seat — bày sẵn là mời người ta khai một thứ chưa cần',
    ).toHaveCount(0);

    // ===== ĐƯỜNG HỎNG: bấm gán mà chưa chọn máy =====
    await assign.getByTestId('dialog-footer').getByRole('button', { name: 'Gán vào máy' }).click();
    await expect(
      assign.getByRole('alert'),
      'Chưa chọn máy mà bấm gán thì phải nói đúng câu trong vi.ts',
    ).toHaveText('Chọn máy để gán.');
    await expect(assign, 'Gán hỏng thì hộp phải ở lại để người dùng sửa').toBeVisible();

    // ===== Ô CHỌN MÁY CÓ GÕ RA MÁY THẬT KHÔNG =====
    await assign.getByRole('combobox').fill(deviceCode);
    await expect(
      page.getByRole('option', { name: new RegExp(deviceCode) }),
      'Gõ mã máy vào ô tìm phải bung ra đúng cái máy đó — ô tìm không tìm ra gì thì hộp này vô dụng',
    ).toBeVisible();

    await assign.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(assign, 'Đóng hộp gán mà không lưu gì').toHaveCount(0);

    /*
     * ===== CHẾ ĐỘ SỬA GHẾ =====
     *
     * Bày sẵn một ghế có ĐỦ kỳ hạn và chi phí qua API, rồi mở hộp sửa của nó: đây là chỗ duy
     * nhất chứng minh hộp mang giá trị cũ vào chứ không mở ra trống.
     */
    await assignSeat(page, licenseId, deviceId, {
      cost: 1500000,
      contract: 'HD-E2E-2026-07',
      startDate: '2026-03-01',
      endDate: '2027-02-28',
      note: 'Ghế của phòng Kế toán',
    });

    /*
     * BẤM VÀO TAB, KHÔNG GÕ `?tab=devices`.
     *
     * Link sâu `?tab=devices` vào tab mọc-theo-dữ-liệu có bài riêng ở cuối khối này (BÀI 7).
     * Ở đây thì đi đường của người dùng: bấm tab.
     */
    await page.goto(`/software/${licenseId}`);
    await page.getByRole('tab', { name: /^Máy đang dùng/ }).click();
    const seatRow = page.getByRole('row', { name: new RegExp(deviceCode) });
    await expect(seatRow, 'Ghế vừa gán phải hiện trong tab Máy đang dùng').toBeVisible();
    /* "Sửa" và "Gỡ" ở trong menu ba chấm, không phải hai nút sát nhau. */
    await seatRow.getByRole('button', { name: /^Thao tác với / }).click();
    await page.getByRole('menuitem', { name: 'Sửa', exact: true }).click();

    const editSeat = page.getByRole('dialog', { name: `Sửa ghế license — ${deviceCode}` });
    await expect(editSeat, 'Hộp sửa ghế phải mang mã máy trên tiêu đề').toBeVisible();

    await expect(
      editSeat.getByRole('combobox'),
      'Sửa ghế KHÔNG được đổi máy: đổi máy là gỡ ghế cũ rồi gán ghế mới, không phải sửa tại chỗ',
    ).toHaveCount(0);
    await expect(
      editSeat.getByText(deviceCode, { exact: true }),
      'Máy của ghế phải hiện ra dạng chữ tĩnh để biết đang sửa ghế nào',
    ).toBeVisible();

    await expect(
      editSeat.getByRole('textbox', { name: 'Chi phí', exact: true }),
      'Chi phí cũ phải nằm sẵn trong ô — mở ra trống là bấm Lưu một phát mất luôn con số',
    ).toHaveValue('1.500.000');
    await expect(
      editSeat.getByRole('textbox', { name: 'Hợp đồng', exact: true }),
      'Số hợp đồng cũ phải nằm sẵn trong ô',
    ).toHaveValue('HD-E2E-2026-07');
    await expect(
      editSeat.getByRole('textbox', { name: 'Ghi chú', exact: true }),
      'Ghi chú cũ phải nằm sẵn trong ô',
    ).toHaveValue('Ghế của phòng Kế toán');
    await expect(
      editSeat.getByRole('button', { name: 'Kết thúc', exact: true }),
      'Kỳ hạn riêng của ghế phải mang ngày cũ (2027)',
    ).toContainText('2027');

    const seatFooter = editSeat.getByTestId('dialog-footer');
    await expect(
      seatFooter.getByRole('button', { name: 'Lưu', exact: true }),
      'Chân hộp ở chế độ SỬA ghi "Lưu"',
    ).toHaveCount(1);
    await expect(
      seatFooter.getByRole('button', { name: 'Gán vào máy', exact: true }),
      'Chân hộp ở chế độ SỬA không được ghi "Gán vào máy" — nó không gán thêm ghế nào',
    ).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(editSeat, 'Esc đóng được hộp sửa ghế').toHaveCount(0);
  });

  /*
   * ===================================================================================
   * BÀI 4 — TRANG HỒ SƠ PHẦN MỀM: mỗi tab bên trong có gì.
   * ===================================================================================
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Bài "đi hết các tab" ở khối 1 chỉ khẳng định bấm tab nào thì tab đó sáng và panel không
   * rỗng — nó cố ý không biết panel chứa gì. Nhưng "panel không rỗng" vẫn xanh khi một tab
   * vẽ nhầm nội dung của tab khác, hoặc khi khu giấy tờ mất bảng chỉ còn một câu.
   *
   * Bài này đi vào từng tab và chốt thứ ĐẶC TRƯNG của tab đó, kèm luật ẩn quan trọng nhất
   * của trang: tab "Máy đang dùng" CHỈ có với loại license.
   *
   * ĐỎ KHI: thanh tab thêm/bớt một tab; tab "Máy đang dùng" mọc ra ở hồ sơ không phải license
   * (hoặc mất khỏi license); bảng ghế đổi cột; khu Két sắt hay khu Giấy tờ mất nút/mất câu
   * dẫn; hoặc lịch sử không ghi lại việc tạo hồ sơ và việc gán ghế.
   */
  test('Hồ sơ phần mềm: mỗi tab có đúng đồ của tab đó, và "Máy đang dùng" chỉ dành cho license', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = stampOf();
    const licenseCode = `TAB-E2E-${stamp}-LIC`;
    const domainCode = `TAB-E2E-${stamp}-DOM`;
    const deviceCode = `PC-E2E-TAB-${stamp}`;

    const licenseId = await createSoftware(page, {
      code: licenseCode,
      name: 'License có ghế để xem tab',
      kind: 'license',
      seatTotal: 4,
      startDate: '2026-01-15',
      endDate: '2028-10-31',
      note: 'Ghi chú của hồ sơ license',
    });
    const domainId = await createSoftware(page, {
      code: domainCode,
      name: 'Tên miền không có ghế',
      kind: 'domain',
      endDate: '2028-09-30',
    });
    const deviceId = await createDevice(page, deviceCode);
    await assignSeat(page, licenseId, deviceId, { contract: 'HD-E2E-TAB' });

    await page.goto(`/software/${licenseId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(licenseCode) }),
      'Trang hồ sơ phải mở đúng license vừa tạo',
    ).toBeVisible();

    // ===== THANH THAO TÁC ĐẦU TRANG =====
    for (const name of ['Sửa hồ sơ', 'Gia hạn', `Thao tác với ${licenseCode}`]) {
      await expect(
        page.getByRole('button', { name, exact: true }),
        `Đầu trang hồ sơ phải có đúng một nút "${name}"`,
      ).toHaveCount(1);
    }
    // Thanh lý nằm trong menu "⋯" (mục nguy hiểm ở cuối), không còn là nút đỏ đứng lẻ.
    expect(
      await rowActionNames(page, licenseCode),
      'Menu "⋯" đầu trang hồ sơ có mục Đưa vào kho thanh lý',
    ).toEqual(['Đưa vào kho thanh lý']);

    /*
     * ===== THANH TAB =====
     *
     * Nhãn tab có số đếm nối sau ("Giấy tờ 0"), và con số đó đến sau khi dữ liệu về — so tên
     * nguyên văn là bài sẽ chập chờn theo tốc độ mạng. Cắt phần số đi rồi mới so cả tập.
     */
    const tabNames = async () =>
      (await page.getByRole('tab').allInnerTexts()).map((text) =>
        text.trim().replace(/\s+\d+$/, ''),
      );

    expect(
      await tabNames(),
      'Hồ sơ LICENSE có đủ năm tab, đúng thứ tự này',
    ).toEqual(['Hồ sơ', 'Máy đang dùng', 'Két sắt', 'Giấy tờ', 'Lịch sử']);

    // License mở sẵn tab "Máy đang dùng" — thứ người ta mở hồ sơ để xem.
    await expect(page.getByRole('tab', { name: /^Máy đang dùng/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // ===== TAB HỒ SƠ =====
    await page.getByRole('tab', { name: 'Hồ sơ', exact: true }).click();
    const profile = page.getByRole('tabpanel');
    /*
     * HẠN NẰM Ở THẺ ĐỊNH DANH, KHÔNG Ở TAB HỒ SƠ.
     *
     * Một thẻ "Hết hạn" chiếm trọn bề ngang ở cột chính sẽ bị dải chỉ số vẽ LẠI y hệt cách đó
     * hai dòng, nên hạn chỉ có một chỗ — cột phải.
     *
     * Yêu cầu không hạ: vẫn phải có thanh thời hạn đầy đủ
     * (thanh tiến trình + hai mốc ngày), và cột chính KHÔNG được vẽ lại lần nữa.
     */
    const identityCard = page.getByRole('region', { name: 'Thẻ định danh' });
    await expect(
      identityCard.getByRole('progressbar'),
      'Hồ sơ có hạn thì thẻ định danh phải vẽ thanh thời hạn đầy đủ',
    ).toHaveCount(1);
    await expect(
      profile.getByRole('progressbar'),
      'Cột chính KHÔNG được vẽ lại thanh thời hạn — đó đúng là chỗ trùng lặp đợt dựng lại đi bỏ',
    ).toHaveCount(0);
    for (const label of ['Kỳ hạn', 'Ghi chú']) {
      await expect(
        profile.getByText(label, { exact: true }),
        `Lưới thông tin của tab Hồ sơ phải có ô "${label}"`,
      ).toHaveCount(1);
    }

    // ===== TAB MÁY ĐANG DÙNG =====
    await page.getByRole('tab', { name: /^Máy đang dùng/ }).click();
    for (const name of [/^Gán vào máy$/, /^Đang dùng \d+$/, /^Đã gỡ \d+$/]) {
      await expect(
        page.getByRole('button', { name }),
        `Tab Máy đang dùng phải có nút "${name}"`,
      ).toHaveCount(1);
    }
    /*
     * CHỜ DÒNG GHẾ TRƯỚC, ĐỌC CỘT SAU.
     *
     * ĐÃ ĐO: đọc cột ngay sau khi bấm tab thì nhận về MẢNG RỖNG — lúc đó
     * panel còn đang hỏi danh sách ghế và chưa vẽ bảng nào. `allTextContents()` là một lượt
     * đọc MỘT LẦN, không chờ lại như `expect`, nên nó chụp đúng khoảnh khắc trống ấy. Một
     * khẳng định biết chờ phải đứng trước nó.
     */
    await expect(
      page.getByRole('row', { name: new RegExp(deviceCode) }),
      'Máy đã gán phải nằm trong bảng ghế',
    ).toBeVisible();
    expect(
      await columnTexts(page),
      'Bảng ghế license phải có đủ 5 cột này — mất cột Chi phí hay Hợp đồng là mất chỗ đối chiếu lúc quyết toán',
    ).toEqual(['Máy', 'Chi phí', 'Kỳ hạn', 'Hợp đồng · Ghi chú', 'Thao tác']);

    // ===== TAB KÉT SẮT =====
    await page.getByRole('tab', { name: /^Két sắt/ }).click();
    await expect(
      page.getByText(/Nơi cất mật khẩu và license key/),
      'Tab Két sắt phải nói ngay nó là gì — key KHÔNG nằm trong hồ sơ phần mềm',
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cất mật khẩu/khóa', exact: true }),
      'SA phải cất được secret ngay tại hồ sơ',
    ).toHaveCount(1);
    await expect(
      page.getByText('Két chưa có ngăn nào'),
      'Két rỗng phải nói là rỗng, không phải bảng trắng',
    ).toBeVisible();

    // ===== TAB GIẤY TỜ =====
    await page.getByRole('tab', { name: /^Giấy tờ/ }).click();
    await expect(
      page.getByText('Chưa có giấy tờ nào.'),
      'Khu giấy tờ chưa có gì phải nói rõ',
    ).toBeVisible();

    // ===== TAB LỊCH SỬ =====
    await page.getByRole('tab', { name: /^Lịch sử/ }).click();
    // Bám vào KHU lịch sử: chữ "Gia hạn" còn nằm trên nút đầu trang, tìm toàn trang là trúng hai chỗ.
    const history = page.getByLabel('Lịch sử');
    await expect(
      history.getByText('Tạo hồ sơ'),
      'Lịch sử phải ghi lại việc hồ sơ được tạo — không có dòng đó thì sổ bắt đầu từ hư không',
    ).toBeVisible();
    await expect(
      history.getByText('Gán license vào máy'),
      'Lịch sử phải ghi lại việc gán ghế, và ghi bằng tiếng Việt chứ không phải mã thô',
    ).toBeVisible();

    /*
     * ===== CHIỀU NGƯỢC: hồ sơ KHÔNG phải license thì không có tab "Máy đang dùng" =====
     *
     * Thiếu vế này thì một bản sửa thô bạo (luôn vẽ tab đó) vẫn xanh ở trên.
     */
    await page.goto(`/software/${domainId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(domainCode) }),
    ).toBeVisible();
    expect(
      await tabNames(),
      'Tên miền không có ghế nào để gán — thanh tab phải thiếu đúng tab "Máy đang dùng"',
    ).toEqual(['Hồ sơ', 'Két sắt', 'Giấy tờ', 'Lịch sử']);
  });

  /*
   * ===================================================================================
   * BÀI 5 — PHÒNG SẮP HẾT HẠN, TAB "DANH SÁCH".
   * ===================================================================================
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `expiry.spec.ts` chứng minh cỗ máy gom đúng nguồn và lọc đúng loại. Nhưng danh sách LOẠI
   * và danh sách CỬA SỔ NGÀY là hai ô người dùng nhìn thấy đầu tiên, và chưa ai chốt chúng
   * đầy đủ: một nguồn hạn quên đăng ký thì bộ lọc thiếu một mục, danh sách vẫn hiện bình
   * thường, và cả hệ thống lặng lẽ ngừng cảnh báo một loại tài sản.
   *
   * Cột "Thao tác" của màn này cũng có một luật ẩn: nguồn nào khai `renew` thì có NÚT "Gia
   * hạn", nguồn nào không thì chỉ có chữ mờ "Không gia hạn tại đây" — bảo hành do nhà cung cấp
   * quyết, không phải thứ bấm một nút là xong.
   *
   * ĐỎ KHI: một nguồn hạn biến khỏi bộ lọc; danh sách cửa sổ ngày đổi; bảng đổi cột; một dòng
   * gia hạn được lại hiện chữ mờ (hoặc ngược lại, bảo hành mọc ra nút gia hạn để bấm vào rồi
   * ăn lỗi 400); hoặc hộp Gia hạn mất ô ngày / mất câu chặn khi chưa chọn ngày.
   */
  test('Phòng Sắp hết hạn — tab Danh sách: bộ lọc, bảng, và nút Gia hạn chỉ ở nơi gia hạn được', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = stampOf();
    const licenseCode = `HAN-E2E-${stamp}-LIC`;
    const deviceCode = `PC-E2E-HAN-${stamp}`;

    /** Ngày cách hôm nay N ngày theo GIỜ ĐỊA PHƯƠNG — `toISOString()` lệch một ngày lúc sáng sớm. */
    const inDays = (days: number): string => {
      const date = new Date();
      date.setDate(date.getDate() + days);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${date.getFullYear()}-${month}-${day}`;
    };

    await createSoftware(page, {
      code: licenseCode,
      name: 'License sắp hết hạn',
      kind: 'license',
      seatTotal: 3,
      endDate: inDays(12),
    });

    // Máy còn hạn bảo hành — nguồn hạn KHÔNG gia hạn được, là vế đối chứng của cột Thao tác.
    await createDevice(page, deviceCode, { warrantyEnd: inDays(12) });

    await page.goto('/expiry');
    await expect(page.getByRole('heading', { level: 1, name: /^Sắp hết hạn$/ })).toBeVisible();

    // ===== HAI TAB CỦA PHÒNG =====
    expect(
      (await page.getByRole('tab').allInnerTexts()).map((text) => text.trim()),
      'Phòng Sắp hết hạn có đúng ba tab',
    ).toEqual(['Danh sách', 'Đã gia hạn', 'Luật gửi báo cáo']);

    /*
     * ===== BA CON SỐ NGƯỜI TA NHÌN ĐẦU TIÊN MỖI SÁNG =====
     *
     * Ba Ô SỐ — số to đứng trước, nhãn nhỏ bên dưới — và mỗi ô là một NÚT LỌC. Bài kiểm hỏi
     * "ba con số ấy có mặt không" và thêm một vế: chúng phải bấm được, và phải khai
     * `aria-pressed` để trình đọc màn hình biết đây là nút bật/tắt chứ không phải nút lệnh.
     */
    for (const label of ['Đã quá hạn', 'Gấp \\(≤7 ngày\\)', 'Sắp tới \\(≤30 ngày\\)']) {
      const o = page.getByRole('button', { name: new RegExp(`\\d+\\s*${label}`) });
      await expect(o, `Dải tóm tắt phải có con số "${label}"`).toHaveCount(1);
      await expect(
        o,
        `Ô số "${label}" phải là nút lọc bật/tắt — con số mà không bấm được thì biết rồi vẫn phải tự dò trong bảng`,
      ).toHaveAttribute('aria-pressed', 'false');
    }

    await expect(
      page.getByRole('button', { name: 'Xuất Excel', exact: true }),
      'Màn cảnh báo hạn phải xuất được đúng cái đang xem (FR-028)',
    ).toHaveCount(1);

    // ===== Ô CHỌN CỬA SỔ NGÀY =====
    await page.getByRole('button', { name: 'Khoảng thời gian', exact: true }).click();
    expect(
      (await page.getByRole('option').allInnerTexts()).map((text) => text.trim()),
      'Sáu mốc cửa sổ ngày + ba mốc theo lịch (EX-003) — không cho gõ số tùy ý, nhưng cũng không được thiếu mốc nào',
    ).toEqual([
      'Quá hạn + 7 ngày tới',
      'Quá hạn + 30 ngày tới',
      'Quá hạn + 60 ngày tới',
      'Quá hạn + 90 ngày tới',
      'Quá hạn + 180 ngày tới',
      'Quá hạn + 365 ngày tới',
      'Quá hạn + tới hết tháng này',
      'Quá hạn + tới hết quý này',
      'Quá hạn + tới ngày…',
    ]);
    await page.getByRole('option', { name: 'Quá hạn + 30 ngày tới', exact: true }).click();

    /*
     * ===== Ô CHỌN LOẠI =====
     *
     * Thứ tự do thứ tự đăng ký nguồn quyết định (AD-7) nên so TẬP chứ không so thứ tự — sắp
     * cả hai vế bằng cùng một phép sắp rồi mới so.
     */
    // Loại là nhóm nút bật/tắt chọn NHIỀU loại cùng lúc (EX-010), không còn là ô chọn một.
    const kindGroup = page.getByRole('group', { name: 'Loại', exact: true });
    const kindOptions = (await kindGroup.getByRole('button').allInnerTexts()).map((text) =>
      text.trim(),
    );
    expect(
      [...kindOptions].sort(),
      'Bộ lọc loại phải bày đủ 6 nguồn hạn đang đăng ký (cả "Khác" — Q-14), cộng mục "tất cả" — đường truyền không có hạn (Q-04)',
    ).toEqual(
      [
        'Mọi loại',
        'License phần mềm',
        'Chứng chỉ SSL',
        'Tên miền',
        'Hợp đồng bảo trì',
        'Khác',
        'Bảo hành thiết bị',
      ].sort(),
    );
    await expect(
      kindGroup.getByRole('button', { name: 'Mọi loại', exact: true }),
      'Chưa chọn loại nào thì nút "Mọi loại" đang bật',
    ).toHaveAttribute('aria-pressed', 'true');

    // ===== BẢNG (chờ dòng có thật rồi mới đọc cột — đọc cột không biết chờ lại) =====
    const licenseRow = page.getByRole('row', { name: new RegExp(licenseCode) });
    await expect(licenseRow, 'License sắp hết hạn phải có mặt trong cửa sổ 30 ngày').toBeVisible();
    expect(
      await columnTexts(page),
      'Bảng sắp hết hạn có đúng 5 cột này (cộng cột ô chọn để gia hạn theo lô)',
    ).toEqual(['', 'Mục', 'Loại', 'Hết hạn', 'Tình trạng', 'Thao tác']);

    // ===== CỘT THAO TÁC: nút hay chữ mờ, tùy nguồn có gia hạn được không =====
    await expect(
      licenseRow.getByRole('button', { name: 'Gia hạn', exact: true }),
      'License gia hạn được ngay tại đây — module chủ có hàm renew',
    ).toHaveCount(1);
    await expect(
      licenseRow.getByRole('link', { name: 'Mở hồ sơ →' }),
      'Dòng gia hạn được thì KHÔNG kèm lối "Mở hồ sơ →" ở cột Thao tác',
    ).toHaveCount(0);

    const warrantyRow = page.getByRole('row', { name: new RegExp(deviceCode) });
    await expect(warrantyRow, 'Bảo hành sắp hết cũng phải có mặt').toBeVisible();
    await expect(
      warrantyRow.getByRole('link', { name: 'Mở hồ sơ →' }),
      'Bảo hành do nhà cung cấp quyết — cho lối sang hồ sơ để sửa ngày, không để nút chết',
    ).toHaveCount(1);
    await expect(
      warrantyRow.getByRole('button', { name: 'Gia hạn', exact: true }),
      'Không được bày nút gia hạn cho bảo hành: bấm vào là ăn lỗi EXPIRY_NOT_RENEWABLE',
    ).toHaveCount(0);

    // ===== BÊN TRONG HỘP "GIA HẠN" =====
    await licenseRow.getByRole('button', { name: 'Gia hạn', exact: true }).click();
    const renew = page.getByRole('dialog', { name: new RegExp(`^Gia hạn ${licenseCode}`) });
    await expect(renew, 'Hộp gia hạn phải nói rõ đang gia hạn mục nào').toBeVisible();

    /*
     * Hạn mới vẫn KHÔNG có ô gõ — chọn trên lịch để khỏi gõ sai định dạng. Hai ô gõ duy nhất
     * là số hợp đồng và chi phí của lần gia hạn này (Q-15: ghi vào sổ gia hạn).
     */
    await expect(
      renew.getByRole('textbox'),
      'Hộp gia hạn có đúng 2 ô gõ chữ: Số hợp đồng · Chi phí kỳ mới — không có ô gõ ngày',
    ).toHaveCount(2);
    for (const name of ['Số hợp đồng', 'Chi phí kỳ mới']) {
      await expect(
        renew.getByRole('textbox', { name, exact: true }),
        `Hộp gia hạn phải có đúng một ô "${name}"`,
      ).toHaveCount(1);
    }
    await expect(
      renew.getByRole('button'),
      'Hộp gia hạn có đúng 9 nút: ✕ · năm nút chọn nhanh · ô ngày Hạn mới · Hủy · Gia hạn',
    ).toHaveCount(9);
    for (const name of [
      'Đóng hộp thoại',
      '+1 tháng',
      '+6 tháng',
      '+1 năm',
      '+2 năm',
      '+3 năm',
      'Hạn mới',
      'Hủy',
      'Gia hạn',
    ]) {
      await expect(
        renew.getByRole('button', { name, exact: true }),
        `Hộp gia hạn phải có đúng một nút "${name}"`,
      ).toHaveCount(1);
    }

    await renew.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
    await expect(
      renew.getByRole('alert'),
      'Bấm gia hạn mà chưa chọn ngày phải nói đúng câu trong vi.ts',
    ).toHaveText('Chọn hạn mới.');
    await expect(renew, 'Gia hạn hỏng thì hộp phải ở lại').toBeVisible();

    await renew.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(renew, 'Đóng hộp gia hạn mà không đổi hạn của ai').toHaveCount(0);
  });

  /*
   * ===================================================================================
   * BÀI 6 — PHÒNG SẮP HẾT HẠN, TAB "LUẬT GỬI BÁO CÁO", và bên trong hộp "Thêm luật".
   * ===================================================================================
   *
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `expiry-digest.spec.ts` chứng minh email đi đúng và luật lọc đúng loại — nhưng nó chỉ
   * điền hai ô rồi bấm Lưu. Form luật có SÁU ô, trong đó ba ô quyết định "gửi lúc nào" nằm
   * trong `SchedulePicker` dùng chung và tự đổi hình theo tần suất (hằng tuần thì có "Vào
   * thứ", hằng tháng thì có "Ngày trong tháng"). Ô tick loại thì dựng từ danh sách nguồn hạn
   * — thiếu một ô tick là một loại tài sản không bao giờ vào được email tổng hợp.
   *
   * ĐỎ KHI: bảng luật đổi cột; menu ba chấm của dòng luật mất mục nào (đặc biệt "Gửi thử" —
   * không có nó thì cấu hình xong phải chờ tới thứ Hai mới biết đúng sai); form mất một ô;
   * `SchedulePicker` không đổi hình theo tần suất; hai câu chặn tiếng Việt đổi; hoặc form
   * Sửa luật mở ra không mang cấu hình cũ (bấm Lưu là ghi đè sạch danh sách người nhận).
   */
  test('Phòng Sắp hết hạn — tab Luật gửi báo cáo, và bên trong hộp "Thêm luật"', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = stampOf();
    const ruleName = `E2E luật phòng ${stamp}`;

    const created = await page.request.post('/api/v1/expiry/rules', {
      headers: await writeHeaders(page),
      data: {
        name: ruleName,
        kinds: ['ssl'],
        withinDays: 45,
        recipients: ['sep@pmh.com.vn'],
        frequency: 'weekly',
        hour: 8,
        weekday: 1,
        active: true,
      },
    });
    expect(created.status(), 'tạo luật gửi báo cáo qua API phải thành công').toBe(201);

    await page.goto('/expiry');
    await page.getByRole('tab', { name: 'Luật gửi báo cáo' }).click();

    await expect(
      page.getByRole('button', { name: 'Thêm luật', exact: true }).first(),
      'SA phải thêm được luật ngay tại tab này',
    ).toHaveCount(1);

    // Chờ dòng luật có thật rồi mới đọc cột — phép đọc cột không biết chờ lại.
    await expect(
      page.getByRole('row', { name: new RegExp(ruleName) }),
      'Luật vừa tạo phải hiện trong bảng',
    ).toBeVisible();
    expect(
      await columnTexts(page),
      'Bảng luật gửi báo cáo có đúng 7 cột này',
    ).toEqual([
      'Tên luật',
      'Theo dõi loại',
      'Kỳ gửi',
      // Lần gửi kế tiếp tính sẵn (EX-021): người đọc không phải tự cộng lịch trong đầu.
      'Lần gửi tới',
      'Người nhận',
      'Gửi gần nhất',
      'Thao tác',
    ]);

    expect(
      await rowActionNames(page, ruleName),
      'Menu của một dòng luật: Sửa luật · Tạm ngưng · Xem trước thư · Gửi thử cho tôi · Gửi thử · Xóa (việc nguy hiểm xếp cuối)',
    ).toEqual(['Sửa luật', 'Tạm ngưng', 'Xem trước thư', 'Gửi thử cho tôi', 'Gửi thử', 'Xóa']);

    /*
     * "GỬI THỬ" PHẢI HỎI LẠI, VÀ CÂU HỎI PHẢI NÊU ĐÍCH DANH NGƯỜI NHẬN.
     *
     * Chữ "thử" đọc ra như gửi vào đâu đó an toàn. Nó không: lượt này bắn email THẬT tới đúng
     * danh sách người nhận của luật — ở đây là `sep@pmh.com.vn` — và thư đã đi thì không thu
     * lại được. Đây là chỗ hiếm hoi phải hỏi lại dù thao tác không ghi gì xuống DB.
     *
     * Vế chốt là HỘP THƯ: bấm Hủy xong mà Mailpit vẫn nhận thêm thư thì câu hỏi lại chỉ là
     * trang trí — hộp hiện lên trong khi lượt gửi đã chạy ở phía sau.
     */
    const mailCountBefore = (await mailpitMessages()).length;
    // Khớp nguyên văn: menu còn có "Gửi thử cho tôi" (EX-021), đây là bản gửi cả danh sách.
    await rowAction(page, ruleName, /^Gửi thử$/);
    await expect(
      page.getByRole('dialog').getByText(/sep@pmh\.com\.vn/),
      'câu hỏi phải nói THẲNG thư sẽ tới hộp nào — đó mới là thứ giúp người ta dừng đúng lúc',
    ).toBeVisible();

    await page.getByTestId('dialog-footer').getByRole('button').first().click();
    await expect(page.getByRole('dialog'), 'bấm Hủy thì hộp phải đóng').toHaveCount(0);
    expect(
      (await mailpitMessages()).length,
      'bấm Hủy mà hộp thư vẫn nhận thêm thư nghĩa là câu hỏi lại chỉ để trang trí',
    ).toBe(mailCountBefore);

    // ===== BÊN TRONG HỘP "THÊM LUẬT" =====
    await page.getByRole('button', { name: 'Thêm luật', exact: true }).first().click();
    const add = page.getByRole('dialog', { name: 'Thêm luật' });
    await expect(add).toBeVisible();

    await expect(
      add.getByRole('textbox'),
      'Form luật có đúng 3 ô gõ chữ: Tên luật · Trong vòng (ngày) · Người nhận',
    ).toHaveCount(3);
    for (const name of ['Tên luật', 'Trong vòng (ngày)', 'Người nhận']) {
      await expect(
        add.getByRole('textbox', { name, exact: true }),
        `Form luật phải có đúng một ô "${name}"`,
      ).toHaveCount(1);
    }

    /*
     * Ô tick loại, và MỘT công tắc "Đang chạy" (EX-020: trạng thái cả luật là công tắc có chữ
     * đổi theo, không phải một ô tick lẫn trong hàng ô tick loại).
     */
    await expect(
      add.getByRole('checkbox'),
      'Sáu ô tick loại (đúng bằng số nguồn hạn)',
    ).toHaveCount(6);
    await expect(
      add.getByRole('switch', { name: 'Đang chạy', exact: true }),
      'Trạng thái chạy của luật là một công tắc, mặc định bật',
    ).toBeChecked();
    for (const label of [
      'License phần mềm',
      'Chứng chỉ SSL',
      'Tên miền',
      'Hợp đồng bảo trì',
      'Khác',
      'Bảo hành thiết bị',
    ]) {
      await expect(
        add.getByRole('checkbox', { name: label, exact: true }),
        `Form luật phải có đúng một ô tick "${label}"`,
      ).toHaveCount(1);
    }

    // ===== BỘ CHỌN LỊCH DÙNG CHUNG =====
    await expect(
      add.getByRole('group', { name: 'Lịch gửi' }),
      'Kỳ gửi phải là bộ chọn lịch dùng chung (AD-15), không phải ô ngày tự dựng',
    ).toHaveCount(1);
    // Ô chọn lịch là `Select` chung (nút mở menu), không còn `<select>` gốc của trình duyệt.
    await expect(add.getByRole('combobox'), 'Không còn <select> gốc trong bộ chọn lịch').toHaveCount(0);
    for (const name of ['Tần suất', 'Vào thứ', 'Lúc']) {
      await expect(
        add.getByRole('button', { name, exact: true }),
        `Bộ chọn lịch ở chế độ hằng tuần phải có ô "${name}"`,
      ).toHaveCount(1);
    }

    // Đổi sang hằng tháng thì bộ chọn phải ĐỔI HÌNH — "Vào thứ" vô nghĩa với luật hằng tháng.
    await add.getByRole('button', { name: 'Tần suất', exact: true }).click();
    await page.getByRole('option', { name: 'Hằng tháng', exact: true }).click();
    await expect(
      add.getByRole('button', { name: 'Vào thứ', exact: true }),
      'Hằng tháng thì không hỏi thứ mấy nữa',
    ).toHaveCount(0);
    await expect(
      add.getByRole('button', { name: 'Ngày trong tháng', exact: true }),
      'Hằng tháng thì phải hỏi ngày nào trong tháng',
    ).toHaveCount(1);

    /*
     * Ba ô chọn lịch giờ là `Select` chung — cũng là nút (EX-019). Ngoài ra là các nút gợi ý
     * người nhận (EX-020): số lượng tùy hộp thư đã dùng ở luật khác, nhưng hộp thư của chính
     * người đang đăng nhập thì luôn có — chờ nó hiện rồi mới đếm.
     */
    const suggestions = add.getByRole('group', { name: 'Gợi ý người nhận' }).getByRole('button');
    await expect(
      suggestions.filter({ hasText: E2E_SA.email }),
      'Gợi ý người nhận luôn có hộp thư của chính mình',
    ).toHaveCount(1);
    await expect(suggestions, 'mỗi gợi ý là một nút "Thêm <email>"').toHaveText(
      Array(await suggestions.count()).fill(/^\+ \S+@\S+$/),
    );
    await expect(
      add.getByRole('button'),
      'Hộp thêm luật (hằng tháng) có đúng 6 nút ngoài gợi ý: ✕ · Tần suất · Ngày trong tháng · Lúc · Hủy · Lưu',
    ).toHaveCount(6 + (await suggestions.count()));
    for (const name of ['Đóng hộp thoại', 'Tần suất', 'Ngày trong tháng', 'Lúc', 'Hủy', 'Lưu']) {
      await expect(add.getByRole('button', { name, exact: true })).toHaveCount(1);
    }

    // ===== HAI ĐƯỜNG HỎNG =====
    const save = add.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu' });

    // Mỗi câu lỗi nằm DƯỚI đúng ô của nó (SW-024) — form `noValidate`, không còn bong bóng.
    await add.getByRole('textbox', { name: 'Tên luật', exact: true }).fill('   ');
    await save.click();
    await expect(
      add.getByRole('textbox', { name: 'Tên luật', exact: true }),
      'Luật không tên thì sau này không ai biết nó là luật gì — báo đúng câu trong vi.ts',
    ).toHaveAccessibleDescription('Đặt tên cho luật, vd "SSL sắp hết hạn → sếp".');

    await add.getByRole('textbox', { name: 'Tên luật', exact: true }).fill(`E2E luật hỏng ${stamp}`);
    await add.getByRole('textbox', { name: 'Người nhận', exact: true }).fill('   ');
    await save.click();
    await expect(
      add.getByRole('alert'),
      'Luật không người nhận là một cái đồng hồ chạy mà không đổ chuông',
    ).toHaveText('Nhập ít nhất một email người nhận.');
    await expect(add, 'Lưu hỏng thì hộp phải ở lại').toBeVisible();

    /*
     * Form đã gõ hai ô, nên Esc HỎI LẠI thay vì đóng thẳng (`Dialog guardUnsaved`). Phải trả
     * lời xong mới đóng — bỏ bước này thì hộp hỏi lại đứng chắn giữa
     * màn và mọi cú bấm sau đó trong bài đều treo.
     */
    await page.keyboard.press('Escape');
    await confirmAction(page, 'Bỏ và đóng');
    await expect(add, 'trả lời "Bỏ và đóng" rồi thì hộp thêm luật phải đóng').toHaveCount(0);

    // ===== HỘP "SỬA LUẬT" PHẢI MANG CẤU HÌNH CŨ VÀO =====
    await rowAction(page, ruleName, 'Sửa luật');
    const edit = page.getByRole('dialog', { name: 'Sửa luật' });
    await expect(edit).toBeVisible();

    await expect(
      edit.getByRole('textbox', { name: 'Tên luật', exact: true }),
      'Tên luật cũ phải nằm sẵn trong ô',
    ).toHaveValue(ruleName);
    await expect(
      edit.getByRole('textbox', { name: 'Người nhận', exact: true }),
      'Danh sách người nhận cũ phải nằm sẵn trong ô — mở ra trống là bấm Lưu một phát mất hết',
    ).toHaveValue('sep@pmh.com.vn');
    await expect(
      edit.getByRole('textbox', { name: 'Trong vòng (ngày)', exact: true }),
      'Số ngày cũ phải nằm sẵn trong ô',
    ).toHaveValue('45');
    await expect(
      edit.getByRole('checkbox', { name: 'Chứng chỉ SSL', exact: true }),
      'Loại đang theo dõi phải được tick sẵn',
    ).toBeChecked();
    await expect(
      edit.getByRole('checkbox', { name: 'License phần mềm', exact: true }),
      'Loại KHÔNG theo dõi thì không được tự tick — tick nhầm là luật đổi phạm vi mà không ai biết',
    ).not.toBeChecked();
    await expect(
      edit.getByRole('button', { name: 'Tần suất', exact: true }),
      'Tần suất cũ phải nằm sẵn trong ô chọn',
    ).toContainText('Hằng tuần');

    await edit.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(edit, 'Đóng hộp sửa luật mà không đổi luật của ai').toHaveCount(0);
  });

  /*
   * ===================================================================================
   * BÀI 7 — LINK SÂU `?tab=` VÀO MỘT TAB MỌC-THEO-DỮ-LIỆU.
   * ===================================================================================
   *
   * TRIỆU CHỨNG KHI HỎNG: mở thẳng `/software/<id>?tab=devices` của một license CÓ ghế thì
   * trang dừng ở tab "Hồ sơ". Thanh tab vẫn hiện đủ "Máy đang dùng 1", nhưng tab được chọn là
   * "Hồ sơ".
   *
   * CƠ CHẾ (`web/src/ui/tabs.tsx` + `software-detail.tsx`): `initialTab` đọc `?tab=devices`
   * đúng, nhưng `useVisibleTab` chạy ngay từ lượt render ĐẦU — lúc `software.data` còn
   * `undefined`. Tab "Máy đang dùng" chỉ được ghép vào `tabItems` khi đã biết hồ sơ là
   * license; nếu ở lượt đó danh sách hợp lệ thiếu khóa này thì `useVisibleTab` kẹp về
   * `profile`, gọi `setTab('profile')`, và dữ liệu về sau không kéo lại được.
   *
   * VÌ SAO QUAN TRỌNG: đây là đường dẫn người ta DÁN CHO NHAU ("ghế
   * license nằm ở đây") và tự trang này sinh ra khi bấm tab. Nó im lặng đưa người nhận tới
   * một tab khác — không báo lỗi, không có dấu hiệu nào. Cùng một cơ chế sẽ đánh trượt
   * `?tab=ports` của hồ sơ thiết bị, vì tab đó cũng chỉ mọc theo dữ liệu.
   *
   * CÁCH CODE TRÁNH NÓ: giữ luôn tab mọc-theo-dữ-liệu trong danh sách KHI TRUY VẤN CÒN ĐANG
   * TẢI — `software-detail.tsx` (`software.isPending || …`) và `device-detail.tsx`
   * (`… || ports.isPending`). Danh sách khi ấy không bao giờ thiếu khóa ở lượt render đầu, nên
   * `useVisibleTab` không có gì để kẹp. Bài này là bài duy nhất chứng minh điều đó.
   */
  test(
    'Link sâu ?tab=devices phải mở đúng tab "Máy đang dùng", không rơi về tab Hồ sơ',
    async ({ page }) => {
      test.setTimeout(150_000);
      await firstLogin(page, E2E_SA);

      const stamp = stampOf();
      const licenseCode = `LINK-E2E-${stamp}-LIC`;
      const licenseId = await createSoftware(page, {
        code: licenseCode,
        name: 'License để thử link sâu',
        kind: 'license',
        seatTotal: 2,
        endDate: '2028-12-31',
      });

      await page.goto(`/software/${licenseId}?tab=devices`);
      await expect(
        page.getByRole('heading', { level: 1, name: new RegExp(licenseCode) }),
      ).toBeVisible();

      await expect(
        page.getByRole('tab', { name: /^Máy đang dùng/ }),
        'Tab "Máy đang dùng" phải là tab ĐANG CHỌN khi link chỉ đích danh nó',
      ).toHaveAttribute('aria-selected', 'true');
      await expect(
        page.getByRole('tabpanel'),
        'Và vùng nội dung phải là của chính tab đó',
      ).toHaveAccessibleName(/^Máy đang dùng/);
    },
  );
});
