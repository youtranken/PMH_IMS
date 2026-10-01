import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  SECOND_BROWSER,
  expireStepUp,
  firstLogin,
  freshTotpCode,
  logout,
  resetAccessList,
  resetApprovals,
  resetCatalog,
  resetDevices,
  resetSecrets,
  resetSoftware,
  resetUsers,
  rowAction,
  writeHeaders,
  uniqueStamp,
} from './helpers';

/*
 * ===== VÀO HẲN TRONG PHÒNG: KÉT SẮT · QUYỀN · DUYỆT · BẢNG ĐIỀU KHIỂN =====
 *
 * Bốn khối trên đi HÀNH LANG: bấm menu, bấm link, đổi vai, xem cửa nào mở cửa nào đóng. Chúng
 * chứng minh được là mỗi phòng CÓ CỬA và cửa dẫn đúng chỗ. Nhưng không bài nào trong đó bước
 * hẳn vào giữa phòng mà đếm: phòng này có mấy cái nút, bảng mấy cột, mấy ngăn, và mở từng cái
 * hộp ra thì bên trong có ô nào.
 *
 * Đó là khoảng trống thật, vì hỏng kiểu "thiếu một thứ trong phòng" KHÔNG làm hỏng đường đi:
 *   - `dashboard.available` của một khối lật sang false vì API rút gọn nhầm theo vai → khối
 *     "Két lâu chưa đổi" biến mất với SA. Mọi link còn sống, mọi bài link còn xanh.
 *   - Ngược chiều, nguy hơn nhiều: khối "Break-glass tuần qua" LỌT sang Member. Đó là danh
 *     sách ai đang xin quyền khẩn cấp vào mật khẩu nào — rò rỉ an ninh, mà giao diện vẫn đẹp.
 *   - Một `<li>` trong "Luật của két" bị xoá, một cột của bảng secret bị bỏ, một nút trong
 *     chân hộp thoại đổi tên: người dùng mất một thứ họ vẫn dùng, không bài nào đỏ.
 *
 * NÊN CÁCH KHẲNG ĐỊNH Ở ĐÂY LÀ SO TẬP HỢP, KHÔNG PHẢI `toBeVisible()` TỪNG CÁI. `toBeVisible`
 * chỉ bắt được thứ MẤT ĐI; `toEqual` trên cả danh sách còn bắt được thứ THỪA RA — và thứ thừa
 * ra ở đúng bốn phòng này (một khối lạ trên bảng điều khiển, một nút lạ trên phiếu chờ duyệt,
 * một ô lạ trong hộp gán quyền) mới là thứ đáng sợ.
 */

test.describe('Phòng Két sắt, Quyền, Duyệt và Bảng điều khiển — bên trong có gì', () => {
  test.beforeEach(() => {
    resetUsers();
    resetSecrets();
    resetDevices();
    resetSoftware();
    resetAccessList();
    resetApprovals();
    resetCatalog();
  });

  /* ------------------------------------------------------------------ *
   * Dàn cảnh — gọi API cho nhanh. ĐIỀU ĐANG KIỂM luôn đi qua giao diện.
   * ------------------------------------------------------------------ */

  /** Id loại thiết bị theo tên, lấy từ danh mục thật (không gõ cứng UUID). */
  async function deviceTypeId(page: Page, name: string): Promise<string> {
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const found = catalog.deviceTypes.find((type) => type.name === name);
    expect(found, `danh mục phải có loại thiết bị "${name}" — hạt giống hỏng thì cả bài vô nghĩa`)
      .toBeTruthy();
    return found!.id;
  }

  /** Dựng một thiết bị. Mã luôn chứa `E2E` để `resetDevices()` dọn được. */
  async function seedDevice(page: Page, code: string, typeName = 'PC'): Promise<string> {
    const created = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: { code, name: `Máy ${code}`, deviceTypeId: await deviceTypeId(page, typeName) },
    });
    expect(created.status(), `không dựng được thiết bị ${code}`).toBe(201);
    return ((await created.json()) as { device: { id: string } }).device.id;
  }

  /**
   * Cất một ngăn vào két của một chủ thể.
   *
   * NHÃN BẮT BUỘC CHỨA `E2E`: bảng `secret` không có FK sang thiết bị (tham chiếu lỏng, AD-4),
   * nên `resetDevices()` KHÔNG kéo theo secret. Nhãn không chứa `E2E` là nó ở lại DB vĩnh viễn
   * và lượt chạy sau đâm vào ràng buộc "một chủ thể một nhãn".
   */
  async function stash(
    page: Page,
    ownerType: 'device' | 'software',
    ownerId: string,
    label: string,
  ): Promise<string> {
    expect(label, 'nhãn secret PHẢI chứa E2E, không thì reset không dọn được').toContain('E2E');
    const created = await page.request.post('/api/v1/vault/secrets', {
      headers: await writeHeaders(page),
      data: { ownerType, ownerId, kind: 'password', label, value: 'Mat-Khau#2026' },
    });
    expect(created.status(), `không cất được secret "${label}"`).toBe(201);
    return ((await created.json()) as { id: string }).id;
  }

  /* ------------------------------------------------------------------ *
   * Đọc TÊN của cả một họ tay nắm — để so TẬP HỢP, không so từng cái.
   * ------------------------------------------------------------------ */

  /**
   * Nhãn của MỌI ô nhập chữ trong một vùng, theo đúng thứ tự DOM.
   *
   * Đọc qua `el.labels` (thuộc tính DOM chuẩn) chứ không qua selector CSS. Cắt dấu `*` vì
   * `Field` vẽ nó như một `<span aria-hidden>` NẰM TRONG `<label>`: mắt thấy "Tên gọi *",
   * trình đọc màn hình nghe "Tên gọi".
   *
   * Vì sao cần: `getByLabel('X')` chỉ trả lời "X có mặt không". Nó không bao giờ bắt được ô
   * THỨ SÁU vừa mọc thêm trong một hộp thoại lẽ ra có năm ô — mà thêm một ô vào hộp đứng ngay
   * cửa két thì đáng phải có người duyệt.
   */
  async function textboxLabels(scope: Locator): Promise<string[]> {
    return scope.getByRole('textbox').evaluateAll((nodes) =>
      nodes.map((node) => {
        const el = node as HTMLInputElement | HTMLTextAreaElement;
        const aria = el.getAttribute('aria-label');
        if (aria) return aria.trim();
        const label = el.labels?.[0];
        return (label?.textContent ?? '').replace('*', '').replace(/\s+/g, ' ').trim();
      }),
    );
  }

  /**
   * Nhãn của mọi ô CHỌN (`ui/select.tsx`) trong một vùng.
   *
   * Trigger của `Select` là một `<button aria-haspopup="listbox">`, KHÔNG phải `<select>` và
   * cũng không phải `combobox`. Lọc theo đúng thuộc tính đó để tách nó khỏi nút thường —
   * nhầm vai ở đây nghĩa là người dùng bàn phím thao tác khác hẳn điều ta tưởng.
   */
  async function selectLabels(scope: Locator): Promise<string[]> {
    return scope
      .getByRole('button')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => node.getAttribute('aria-haspopup') === 'listbox')
          .map((node) => (node.getAttribute('aria-label') ?? '').trim()),
      );
  }

  /**
   * Tên + trạng thái của mọi nút BẬT/TẮT (`aria-pressed`) trong một vùng, theo thứ tự DOM.
   *
   * KHÔNG dùng `getByRole('button', { pressed: false })` — ĐÃ ĐO và nó sai ở đây: Playwright
   * coi một nút KHÔNG có thuộc tính `aria-pressed` là "đang không được nhấn", nên bộ lọc đó
   * vớ luôn cả nút "Mở két" của từng dòng bảng, cho ra:
   * `["Thiết bị","Phần mềm","Tài khoản dịch vụ","Mở két","Mở két"]`.
   *
   * Đọc thẳng thuộc tính thì lưới khoanh đúng họ nút bật/tắt và KHÔNG nở ra theo số dòng dữ
   * liệu — nghĩa là nó vẫn bắt được nút lọc thứ tư mọc thêm, đúng điều nó sinh ra để làm.
   */
  async function toggleButtons(scope: Locator): Promise<{ toggleName: string; enabled: boolean }[]> {
    return scope.getByRole('button').evaluateAll((nodes) =>
      nodes
        .filter((node) => node.hasAttribute('aria-pressed'))
        .map((node) => ({
          /* Cắt SỐ ĐẾM ở đuôi nhãn ("Thiết bị 3" → "Thiết bị"): trang tổng Két sắt gắn số vào
             nút lọc như Kho thanh lý và Dải mạng. Bài này hỏi "có đúng bốn
             loại không", không hỏi "mỗi loại có mấy cái" — con số đổi theo dữ liệu gieo nên
             chốt cứng nó vào đây là tự tạo một bài kiểm đỏ ngẫu nhiên. */
          toggleName: (node.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\s+\d+$/, ''),
          enabled: node.getAttribute('aria-pressed') === 'true',
        })),
    );
  }

  /** Sắp xếp một danh sách tên để so tập hợp mà không phụ thuộc thứ tự vẽ trên màn. */
  function asSet(names: string[]): string[] {
    return [...names].sort();
  }

  /* ================================================================== *
   * BÀI 1 — Trang tổng Két sắt: nút lọc, popup của một dòng, luật của két
   * ================================================================== */

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `vault-home-scope.spec.ts` đã chứng minh trang tổng KHÔNG lộ tên ngăn và lọc được. Nó
   * không đếm cái gì cả: nó hỏi "dòng này còn thấy không", nên một nút lọc thứ tư mọc thêm,
   * một cột của bảng secret trong popup bị bỏ, hay khối "Luật của két" rụng mất một gạch đều
   * lọt qua.
   *
   * Bài này đứng giữa phòng và ĐẾM: ba nút lọc (không hai, không bốn), số dòng trước và sau
   * khi bật lọc, sáu cột của bảng secret trong popup, hai nút ở chân popup, bốn gạch luật.
   *
   * ĐỎ KHI: thêm/bớt một loại chủ thể mà quên nút lọc; nút lọc bấm vào mà bảng không đổi
   * (`aria-pressed` lật nhưng bộ lọc không nối vào danh sách); popup mất nút "Mở hồ sơ đầy
   * đủ" (xem xong két là cụt đường sang hồ sơ); hoặc một gạch trong "Luật của két" biến mất —
   * đó là chỗ DUY NHẤT trong sản phẩm nói cho người dùng biết luật mở két.
   */
  test('Trang tổng Két sắt: bốn nút lọc đổi bảng thật, popup mở đúng két, luật đủ bốn gạch', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const deviceCode = `PC-E2E-KS-${stamp}`;
    const deviceId = await seedDevice(page, deviceCode);
    const secretLabel = `admin web E2E ${stamp}`;
    await stash(page, 'device', deviceId, secretLabel);

    const swCode = `LIC-E2E-KS-${stamp}`;
    const sw = await page.request.post('/api/v1/software', {
      headers: await writeHeaders(page),
      data: { code: swCode, name: 'License có key', kind: 'license', endDate: '2028-12-31' },
    });
    expect(sw.status(), 'không dựng được hồ sơ phần mềm').toBe(201);
    await stash(page, 'software', ((await sw.json()) as { id: string }).id, `key E2E ${stamp}`);

    await page.goto('/vault');
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1, name: 'Két sắt' })).toBeVisible();

    /*
     * BỐN nút lọc, khoanh bằng THUỘC TÍNH `aria-pressed` chứ không bằng tên.
     *
     * Chỉ nút lọc mang thuộc tính đó (`vault-home-screen.tsx`), nên lưới này khoanh trúng cả
     * họ mà không phải liệt kê tên trước — nút lọc mọc thêm cũng rơi vào và làm đỏ.
     *
     * Dãy nút gõ tay mà thiếu một loại API có thì bật bất kỳ nút nào cũng làm mọi dòng của
     * loại đó biến mất im lặng. Danh sách dưới đây sinh ra từ `SECRET_OWNER_TYPES`, tức thứ tự
     * này là thứ tự khai bên API.
     */
    const table = main.getByRole('table');
    await expect(table, 'phải có bảng chủ thể trước khi đếm nút lọc').toBeVisible();
    expect(
      await toggleButtons(main),
      'trang tổng phải có ĐÚNG bốn nút lọc loại — một cho mỗi loại chủ thể cất được secret — ' +
        'và lúc mới vào cả bốn đều đang TẮT',
    ).toEqual([
      { toggleName: 'Thiết bị', enabled: false },
      { toggleName: 'Phần mềm', enabled: false },
      { toggleName: 'Tài khoản dịch vụ', enabled: false },
      { toggleName: 'Đường truyền', enabled: false },
    ]);

    const deviceRow = table.getByRole('row', { name: new RegExp(deviceCode) });
    const swRow = table.getByRole('row', { name: new RegExp(swCode) });
    await expect(deviceRow).toBeVisible();
    await expect(swRow).toBeVisible();

    // ĐẾM trước, để lát nữa còn có cái mà so. `+1` là dòng tiêu đề của `<thead>`.
    const rowsBefore = await table.getByRole('row').count();
    expect(rowsBefore, 'đã gieo hai chủ thể nên bảng phải có ít nhất hai dòng dữ liệu')
      .toBeGreaterThanOrEqual(3);

    await main.getByRole('button', { name: /^Thiết bị \d+$/ }).click();

    /*
     * Bật lọc "Thiết bị" phải làm BẢNG đổi, không chỉ làm cái nút sáng lên.
     *
     * Đây là cặp khẳng định cố ý đi đôi: `aria-pressed` chứng minh nút đã lật, số dòng chứng
     * minh danh sách đã nghe theo. Thiếu vế thứ hai thì một `useState` không nối vào `rows`
     * vẫn xanh — và đó đúng là kiểu hỏng mà mắt không thấy vì cái nút vẫn đổi màu.
     */
    // `poll`: đọc `aria-pressed` ngay sau cú bấm là đua với lượt render của React.
    await expect.poll(
      () => toggleButtons(main),
      { message: 'bấm "Thiết bị" thì đúng một nút được bật, ba nút kia phải giữ nguyên trạng thái tắt' },
    ).toEqual([
      { toggleName: 'Thiết bị', enabled: true },
      { toggleName: 'Phần mềm', enabled: false },
      { toggleName: 'Tài khoản dịch vụ', enabled: false },
      { toggleName: 'Đường truyền', enabled: false },
    ]);

    const rowsAfter = await table.getByRole('row').count();
    expect(
      rowsAfter,
      `lọc "Thiết bị" phải BỎ BỚT dòng khỏi bảng (trước ${rowsBefore}, sau ${rowsAfter}) — ` +
        'nút sáng mà bảng đứng im là bộ lọc chưa nối vào danh sách',
    ).toBeLessThan(rowsBefore);
    await expect(deviceRow, 'lọc "Thiết bị" mà dòng thiết bị biến mất là lọc ngược').toBeVisible();
    await expect(swRow, 'lọc "Thiết bị" mà dòng phần mềm còn ở lại là bộ lọc không có tác dụng')
      .toHaveCount(0);

    // Tắt lại — nút bật/tắt phải đi được cả hai chiều, không phải một chiều.
    await main.getByRole('button', { name: /^Thiết bị \d+$/ }).click();
    await expect(swRow, 'tắt lọc thì dòng phần mềm phải quay lại').toBeVisible();

    /* ---- POPUP của một dòng: mở ra rồi soi bên trong ---- */

    await deviceRow.getByRole('button', { name: `Mở két của ${deviceCode}` }).click();
    const popup = page.getByRole('dialog', { name: new RegExp(`^Két sắt — ${deviceCode}`) });
    await expect(
      popup,
      'tiêu đề popup phải nói RÕ đang mở két của chủ thể nào — mở nhầm két là xem nhầm mật khẩu',
    ).toBeVisible();

    /*
     * `expect.poll`, KHÔNG phải `expect(await …)` — cùng cái bẫy đã ghi ở bài Port map trong
     * chính file này. Popup hiện ra TRƯỚC khi bảng bên trong có dữ liệu: nó còn phải hỏi
     * `/vault/:ownerType/:ownerId` rồi mới vẽ. Đọc một phát bằng `await` là đọc trúng khoảnh
     * khắc đó và KHÔNG có lần đọc thứ hai — mảng rỗng, bài đỏ, ảnh chụp thì thấy đủ cột
     * nằm sờ sờ.
     */
    await expect
      .poll(() => popup.getByRole('columnheader').allTextContents(), {
        message:
          'bảng secret trong popup: bốn cột (Q-15: "Đổi lần cuối" để thấy hạn đổi mật khẩu), loại/ghi chú là dòng phụ — KHÔNG có cột giá trị (FR-026)',
      })
      .toEqual(['Tên gọi', 'Tên đăng nhập', 'Đổi lần cuối', 'Thao tác']);
    await expect(
      popup.getByRole('cell', { name: secretLabel }).first(),
      'popup phải liệt kê đúng ngăn vừa cất',
    ).toBeVisible();

    const footer = popup.getByTestId('dialog-footer');
    expect(
      await footer.getByRole('link').allTextContents(),
      'chân popup phải có đúng một đường sang hồ sơ đầy đủ — xem xong két thường là muốn xem cả máy',
    ).toEqual(['Mở hồ sơ đầy đủ']);
    expect(
      await footer.getByRole('button').allTextContents(),
      'chân popup phải có đúng một nút Đóng, không thừa nút nào',
    ).toEqual(['Đóng']);

    await footer.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(popup, 'bấm Đóng thì popup phải đóng thật').toBeHidden();
    await expect(page, 'popup đóng lại là vẫn đứng nguyên trang tổng, không bị chuyển trang')
      .toHaveURL(/\/vault$/);

    /* ---- Khối "Luật của két" ---- */

    await expect(page.getByRole('heading', { level: 2, name: 'Luật của két' })).toBeVisible();
    /*
     * `<ul class="vault-rules">` là danh sách DUY NHẤT trong `<main>` của màn này, nên gom
     * `listitem` là gom đúng bốn gạch luật. So nguyên văn: đây là chỗ duy nhất trong sản phẩm
     * nói cho người dùng biết luật mở két, sửa chữ ở đây phải là một quyết định có ý thức.
     */
    expect(
      await page.getByRole('main').getByRole('listitem').allTextContents(),
      '"Luật của két" phải đủ BỐN gạch: cất · gõ mã · tự ẩn · ghi nhật ký',
    /*
     * Vì sao từng câu nói đúng như thế:
     *
     * · gạch 1 — chỉ thẳng popup "Mở két" ngay trên màn này, không bắt người dùng đi vòng qua
     *   trang thiết bị;
     * · gạch 2 — không nói "mỗi phiên": luật thật là một khoảng ÂN HẠN
     *   (`secret.stepup_grace_minutes`) và chính hộp mở két có đồng hồ đếm ngược nói điều đó.
     *   Chữ ở chân trang nói ngược cái đồng hồ thì người dùng bị hỏi mã giữa chừng và tưởng
     *   hệ thống hỏng;
     * · gạch 3 — không ước lượng "vài chục giây", vì màn hình có đồng hồ thật.
     */
    ).toEqual([
      'Cất mật khẩu: bấm "Mở két" ở bảng trên, hoặc vào tab Két sắt của hồ sơ. Chỉ Quản trị và Super Admin cất được.',
      'Xem giá trị: phải nhập mã 6 số. Nhập một lần thì xem tiếp được trong ít phút, hết giờ phải nhập lại.',
      'Giá trị hiện ra rồi tự ẩn (có đồng hồ đếm ngược). Không có nút sao chép hàng loạt.',
      'Mỗi lần mở đều ghi nhật ký: ai xem, xem của ai, lúc nào — không xóa được.',
    ]);
  });

  /* ================================================================== *
   * BÀI 2 — Ma trận Quyền xem két sắt: lưới có cột gì, dòng ai có nút gì
   * ================================================================== */

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `vault-access.spec.ts` kiểm NGHIỆP VỤ của ma trận (gán, gỡ, tầng rộng nhất thắng, email
   * lạ bị chặn). Nó không hỏi lưới có hình dạng gì. Mà hình dạng mới là thứ trả lời được câu
   * "chỗ nào đang hổng": đúng một họ nhóm bị rụng khỏi danh sách cột là cả một mảng quyền
   * biến mất khỏi tầm mắt người rà soát, trong khi mọi bài nghiệp vụ vẫn xanh vì chúng gán
   * bằng API rồi mới đọc lại một ô.
   *
   * Lọc cột về đúng họ "Phần mềm" rồi mới so tập hợp là có chủ ý: `software_kind` là danh
   * sách CỐ ĐỊNH trong `access-list.service.ts`, không phụ thuộc danh mục của môi trường —
   * nên so được nguyên văn năm cột mà không sinh ra một bài đỏ theo máy.
   *
   * ĐỎ KHI: một loại phần mềm thêm vào API mà lưới không mọc cột; dòng của Member mất nút
   * "Gán quyền"; dòng của SA/Admin BỖNG có ô để bấm (mời người ta gán một quyền không có tác
   * dụng, rồi tưởng là đã siết); hoặc chú giải ba tầng rụng mất một tầng.
   */
  test('Ma trận Quyền xem két sắt: lưới đủ cột, Member có nút gán, SA/Admin ở khối "toàn quyền theo vai"', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    // Lưới là tab "Ma trận" (màn rộng); tab mặc định là "Theo người".
    await page.goto('/admin/vault-access?view=matrix');
    await expect(page.getByRole('heading', { level: 1, name: 'Quyền két sắt' })).toBeVisible();

    /*
     * Khung cuộn NGANG bọc lưới. Nó tồn tại vì vài chục cột là chuyện bình thường: cho cả
     * trang cuộn ngang thì cột tên người trôi khỏi màn và lưới hết đọc được.
     */
    const grid = page.getByTestId('access-grid');
    await expect(grid, 'ma trận phải nằm trong khung cuộn riêng, không để cả trang cuộn ngang')
      .toBeVisible();

    // Lọc CỘT về đúng họ "Phần mềm" — danh sách cố định, so được nguyên văn.
    await page.getByRole('button', { name: 'Nhóm đối tượng' }).click();
    await page.getByRole('option', { name: 'Phần mềm', exact: true }).click();

    /*
     * Tiêu đề cột loại là NÚT "Gán … cho nhiều người", kèm dấu `+` trang trí
     * (`aria-hidden`) cho thấy nó bấm được. `allTextContents` đọc cả phần trang trí nên cắt nó
     * đi trước khi so chữ; việc mỗi cột loại phải có nút đó thì kiểm riêng ngay dưới.
     */
    expect(
      asSet(
        (await grid.getByRole('columnheader').allTextContents()).map((text) =>
          text.replace(/\+$/, ''),
        ),
      ),
      'lọc về họ "Phần mềm" thì lưới phải còn đúng: cột tên người + tiêu đề họ + năm loại phần mềm',
    ).toEqual(
      asSet([
        'Người',
        'Phần mềm',
        'License',
        'Chứng chỉ SSL',
        'Tên miền',
        'Hợp đồng bảo trì',
        'Khác',
      ]),
    );
    await expect(
      grid.getByRole('columnheader').getByRole('button', { name: /^Gán ".+" cho nhiều người$/ }),
      'mỗi cột loại (năm cột) là một nút gán cả cột cho nhiều người',
    ).toHaveCount(5);

    /* ---- Dòng của Member: có nút gán, và có ô để bấm ---- */

    const memberRow = grid.getByRole('row', { name: new RegExp(E2E_MEMBER.email) });
    await expect(memberRow, 'ma trận phải liệt kê được tài khoản Member').toBeVisible();
    await expect(
      memberRow.getByRole('button', { name: 'Gán quyền' }),
      'dòng của Member phải có nút "Gán quyền" — đây là chiều gán theo NGƯỜI',
    ).toBeVisible();

    /* ---- SA/Admin: KHÔNG thành dòng trống trong lưới, mà nằm trong khối gập riêng ---- */

    await expect(
      grid.getByRole('row', { name: new RegExp(E2E_SA.email) }),
      'SA/Admin xem được mọi secret theo VAI — một dòng trống trong lưới đọc như "không có quyền gì"',
    ).toHaveCount(0);
    const roleBlock = page.getByText(/^Có toàn quyền theo vai \(\d+\)$/);
    await expect(roleBlock, 'ai có toàn quyền theo vai vẫn phải thấy được khi rà soát').toBeVisible();
    await roleBlock.click();
    await expect(
      page.getByText('Quản trị và Super Admin đã xem được mọi két theo vai, không cần gán ở đây.'),
      'khối đó phải NÓI RA vì sao không có gì để gán',
    ).toBeVisible();
    await expect(page.getByText(E2E_SA.email).first()).toBeVisible();

    /* ---- Bấm tiêu đề cột = chiều gán theo NHÓM ---- */

    await grid.getByRole('button', { name: 'Gán "Phần mềm: License" cho nhiều người' }).click();
    const bulk = page.getByRole('dialog', { name: 'Gán "Phần mềm: License" cho người dùng' });
    await expect(
      bulk,
      'bấm tiêu đề cột phải mở hộp gán HÀNG LOẠT cho đúng nhóm đó — mở vòng an toàn cho một ' +
        'nhóm thường là việc của cả tổ trực, không phải một người',
    ).toBeVisible();

    await bulk.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(bulk, 'nút ✕ phải đóng được hộp').toBeHidden();

    /* ---- Chú giải ba tầng ---- */

    await expect(
      page.getByText(/Xem thẳng.*Cần duyệt.*Không có quyền/),
      'lưới toàn ký hiệu ✓ ⏳ – nên PHẢI có chú giải đủ ba tầng, không thì không ai đọc được nó',
    ).toBeVisible();
  });

  /* ================================================================== *
   * BÀI 3 — Phòng Duyệt yêu cầu: ba ngăn, phiếu treo, đúng bộ nút
   * ================================================================== */

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * `break-glass.spec.ts` chứng minh NGHIỆP VỤ duyệt chạy đúng: xin → duyệt → xem được trong
   * hạn. Nó luôn tới bằng `getByRole('button', { name: 'Duyệt' }).first()`, nên nó không biết
   * — và không thể biết — cái phiếu đó còn nút nào khác, thanh tab còn ngăn nào, hay nút Xuất
   * Excel đang nằm ở tab nào.
   *
   * Ba câu bài này hỏi, không câu nào bài kia hỏi được:
   *   1. Thanh tab có ĐỦ BA ngăn, và ngăn "Chờ duyệt" có đếm số.
   *   2. Phiếu treo hiện đủ thứ người duyệt cần để QUYẾT (ai xin, lúc nào, lý do, đối tượng,
   *      xin bao lâu) và có ĐÚNG hai nút. Một nút thứ ba mọc ra ở đây — "Duyệt nhanh", "Duyệt
   *      tất cả" — là một quyết định an ninh, không phải một cải tiến giao diện.
   *   3. Nút Xuất Excel CHỈ ở tab Nhật ký. File luôn là toàn bộ lịch sử, nên để nó ở tab "Chờ
   *      duyệt" là người đang xem 1 phiếu bấm Xuất và im lặng nhận cả kho.
   *
   * Phiếu treo dựng bằng `page.request` từ một trình duyệt thứ hai của Member: điều đang kiểm
   * là PHÒNG CÓ GÌ, không phải nghiệp vụ duyệt.
   */
  test('Phòng Duyệt yêu cầu: đủ ba ngăn, phiếu treo nói đủ và có đúng hai nút', async ({
    page,
    browser,
  }) => {
    // Hai luồng đăng nhập lần đầu (SA ở đây, Member ở trình duyệt thứ hai).
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const typeId = await deviceTypeId(page, 'Switch');
    const deviceCode = `SW-E2E-DUYET-${stamp}`;
    const deviceId = await seedDevice(page, deviceCode, 'Switch');
    await stash(page, 'device', deviceId, `admin web E2E ${stamp}`);

    // Member phải ở tầng "cần duyệt" thì mới xin được: trắng trơn là xin cũng bị từ chối.
    const granted = await page.request.post('/api/v1/vault/access', {
      headers: await writeHeaders(page),
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: typeId,
        tier: 'needs_approval',
      },
    });
    expect(granted.ok(), 'không gán được tầng "cần duyệt" thì Member không xin được gì').toBeTruthy();

    const reason = `E2E ${stamp}: switch tầng 3 mất kết nối, cần vào cấu hình`;
    const memberCtx = await browser.newContext(SECOND_BROWSER);
    const memberPage = await memberCtx.newPage();
    try {
      await firstLogin(memberPage, E2E_MEMBER);
      const asked = await memberPage.request.post('/api/v1/vault/break-glass', {
        headers: await writeHeaders(memberPage),
        data: { ownerType: 'device', ownerId: deviceId, reason, hours: 4 },
      });
      expect(asked.status(), 'không dựng được phiếu treo thì cả bài không có gì để soi').toBe(201);
    } finally {
      await memberCtx.close();
    }

    await page.goto('/approvals');
    await expect(page.getByRole('heading', { level: 1, name: 'Duyệt mở két' })).toBeVisible();

    /*
     * ĐỦ BA NGĂN. Nhãn tab "Chờ duyệt" có số đếm nối sau kèm dấu cách, nên cắt phần số đi rồi
     * mới so tên — còn CÓ số hay không thì khẳng định riêng ngay dưới.
     */
    const tabNames = (await page.getByRole('tab').allTextContents()).map((name) =>
      name.replace(/\s*\d+$/, '').trim(),
    );
    expect(
      tabNames,
      'SA phải thấy đủ ba ngăn: việc phải làm · sổ để trình auditor · việc của chính mình',
    ).toEqual(['Chờ duyệt', 'Nhật ký', 'Yêu cầu của tôi']);
    await expect(
      page.getByRole('tab', { name: /^Chờ duyệt/ }),
      'ngăn "Chờ duyệt" phải đeo số đếm — người trực cần biết còn mấy phiếu mà không phải mở ra',
    ).toHaveText(/^Chờ duyệt \d+$/);

    /* ---- Phiếu treo: nói đủ những gì người duyệt cần để quyết ---- */

    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText(reason), 'phiếu phải hiện LÝ DO — không có lý do thì quyết bằng gì')
      .toBeVisible();
    await expect(
      panel.getByText('Chờ duyệt', { exact: true }),
      'phiếu phải đeo huy hiệu trạng thái "Chờ duyệt"',
    ).toBeVisible();
    await expect(panel.getByText(E2E_MEMBER.email), 'phiếu phải nói rõ AI xin').toBeVisible();
    await expect(
      panel.getByRole('link', { name: new RegExp(`^${deviceCode} · `) }),
      'phiếu phải nói xin quyền trên ĐỐI TƯỢNG nào — bằng mã + tên, bấm sang được hồ sơ',
    ).toHaveAttribute('href', `/devices/${deviceId}`);
    await expect(
      panel.getByText('Thiết bị', { exact: true }),
      'kèm loại đối tượng',
    ).toBeVisible();
    await expect(
      panel.getByText(/[0-9a-f]{8}-[0-9a-f]{4}/),
      'không còn in UUID ra thẻ phiếu',
    ).toHaveCount(0);
    await expect(panel.getByText('Thời hạn xin', { exact: true }), 'phiếu phải nói xin BAO LÂU').toBeVisible();
    await expect(panel.getByText('4 giờ', { exact: true })).toBeVisible();

    /*
     * Phiếu CHƯA quyết thì KHÔNG được có hai ô của phần quyết định. Cặp khẳng định âm này là
     * phần nói được nhiều nhất: nó chốt rằng vốn từ của thẻ phiếu đúng bằng những gì trạng
     * thái hiện tại cho phép, chứ không phải một khuôn cứng vẽ sẵn mọi ô rồi để trống.
     */
    await expect(
      panel.getByText('Người quyết', { exact: true }),
      'phiếu đang treo thì chưa có ai quyết — hiện ô đó ra là nói dối',
    ).toHaveCount(0);
    await expect(
      panel.getByText('Hết hạn', { exact: true }),
      'chưa duyệt thì chưa có mốc hết hạn',
    ).toHaveCount(0);

    expect(
      await panel.getByRole('button').allTextContents(),
      'phiếu treo phải có ĐÚNG hai nút: Từ chối (trái) và Duyệt (phải, vùng ngón cái). Một nút ' +
        'thứ ba ở đây ("duyệt tất cả") là một quyết định an ninh, không phải một cải tiến giao diện',
    ).toEqual(['Từ chối', 'Duyệt']);

    /* ---- Nút Xuất Excel CHỈ ở ngăn Nhật ký ---- */

    const exportBtn = page.getByRole('button', { name: 'Xuất Excel' });
    await expect(
      exportBtn,
      'ở ngăn "Chờ duyệt" mà có nút Xuất thì người xem 1 phiếu bấm vào sẽ im lặng nhận CẢ KHO',
    ).toHaveCount(0);

    await page.getByRole('tab', { name: 'Nhật ký', exact: true }).click();
    await expect(
      exportBtn,
      'ngăn "Nhật ký" là thứ đem đi trình auditor — nó PHẢI xuất được ra file',
    ).toBeVisible();
    await expect(
      page.getByRole('tabpanel').getByText(reason),
      'nhật ký phải chứa cả phiếu đang treo, không chỉ phiếu đã quyết',
    ).toBeVisible();
    /*
     * Nhật ký là sổ để TRA: phiếu đang treo ở đây không có nút Duyệt/Từ chối (hai nơi quyết
     * cùng một việc), chỉ có đường sang tab Chờ duyệt.
     */
    await expect(
      page.getByRole('tabpanel').getByRole('button', { name: 'Duyệt', exact: true }),
      'nhật ký không được là nơi thứ hai cấp quyền mở két',
    ).toHaveCount(0);
    await expect(
      page.getByRole('tabpanel').getByRole('button', { name: 'Đi tới Chờ duyệt' }).first(),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Yêu cầu của tôi', exact: true }).click();
    await expect(exportBtn, 'ngăn "Yêu cầu của tôi" không phải sổ trình auditor').toHaveCount(0);
    await expect(
      page.getByRole('tabpanel').getByText('Bạn chưa gửi yêu cầu nào'),
      'SA chưa tự xin bao giờ — ngăn này phải nói ĐÚNG câu đó, không mượn câu của Nhật ký',
    ).toBeVisible();
  });

  /* ================================================================== *
   * BÀI 4 — Bảng điều khiển: từng khối bên trong, và khối nào KHÔNG cho Member
   * ================================================================== */

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * File này đã có một bài đi hết các LINK "Xem toàn bộ" của bảng điều khiển. Link là sợi dây
   * đi RA; bài này đếm những gì đang nằm TRONG phòng.
   *
   * Và nó tồn tại chủ yếu vì nửa sau: hai khối "Két lâu chưa đổi" và "Break-glass tuần qua"
   * bị server rút gọn theo vai. "Két lâu chưa đổi" là danh sách chủ thể đang giữ mật khẩu cũ;
   * "Break-glass tuần qua" là danh sách ai đang xin quyền khẩn cấp vào mật khẩu nào. Lọt sang
   * Member là rò rỉ an ninh — mà nó lọt một cách hoàn toàn êm ái: giao diện đẹp, không lỗi,
   * không ai báo.
   *
   * `dashboard.spec.ts` đã kiểm phần dữ liệu của hai khối đó theo vai. Bài này kiểm phần KHÁC:
   * TẬP HỢP khối mà mỗi vai nhìn thấy, và so hai tập hợp với nhau — hiệu của chúng phải đúng
   * bằng hai cái tên đó, không hơn không kém. So bằng `toHaveCount(0)` hai chuỗi thì một khối
   * thứ ba rò sang Member sẽ không ai biết.
   *
   * ĐỎ KHI: thêm/bớt một khối mà quên; một khối rụng khỏi bảng của SA; hoặc một khối chỉ dành
   * cho SA xuất hiện ở bảng của Member.
   */
  test('Bảng điều khiển: SA thấy đủ sáu khối, Member thiếu đúng hai khối an ninh', async ({
    page,
  }) => {
    // Hai luồng đăng nhập lần đầu đầy đủ (SA rồi Member) trong cùng một bài.
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();

    /*
     * Mỗi khối là một `<section class="card">` mở đầu bằng `<h2>`, và trên màn này KHÔNG có
     * `<h2>` nào khác — nên gom hết `heading level 2` là gom đúng danh sách khối.
     */
    // Ngưỡng dải mạng nằm TRONG tiêu đề ("Dải mạng ≥ 80%", DASH-016) — quy về một tên để so.
    // Hai khối "việc của tôi" (Cần bạn duyệt / Yêu cầu mở két của tôi) chỉ hiện khi có việc,
    // tuỳ dữ liệu bài trước để lại — không thuộc danh sáu khối cố định.
    const blockTitles = async () =>
      (await page.getByRole('main').getByRole('heading', { level: 2 }).allTextContents())
        .map((title) => title.replace(/^Dải mạng ≥ \d+%$/, 'Dải mạng ≥ N%'))
        .filter((title) => !/^(Cần bạn duyệt|Yêu cầu mở két của tôi)/.test(title));

    const saBlocks = await blockTitles();
    expect(
      asSet(saBlocks),
      'SA phải thấy đủ sáu khối — mục tiêu của epic là "sếp 3 phút sáng thứ Hai tự trả lời mọi câu hỏi"',
    ).toEqual(
      asSet([
        'Hạn cần xử lý',
        'Dải mạng ≥ N%',
        'Két lâu chưa đổi',
        'Sự cố tuần qua',
        'Yêu cầu mở két tuần qua',
        'Vừa vào kho thanh lý (7 ngày)',
      ]),
    );

    /*
     * Khối của epic chưa mở vẫn HIỆN, và phải nói rõ là CHƯA THEO DÕI.
     *
     * "Chưa có phần này" khác hẳn "tuần qua không có sự cố nào". Giấu khối đi — hoặc để nó
     * hiện một ô trống — là cách nhanh nhất để sếp yên tâm nhầm.
     */
    await expect(
      page.getByText('IMS chưa theo dõi sự cố. Sự cố hiện vẫn ghi ở nơi cũ.'),
      'khối "Sự cố tuần qua" phải nói thẳng là epic chưa mở, không được im lặng như một khối rỗng',
    ).toBeVisible();

    /* ---- Đổi người: cùng một màn, ít khối hơn ---- */

    await logout(page);
    await firstLogin(page, E2E_MEMBER);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();
    // Chờ một khối chắc chắn có, để không đếm lúc trang mới dựng được nửa.
    await expect(
      page.getByRole('heading', { level: 2, name: 'Hạn cần xử lý' }),
      'Member vẫn phải thấy khối "Sắp hết hạn" — cắt theo vai không phải là cắt sạch',
    ).toBeVisible();

    const memberBlocks = await blockTitles();
    expect(
      asSet(memberBlocks),
      'Member phải thấy đúng bốn khối không dính bí mật',
    ).toEqual(
      asSet([
        'Hạn cần xử lý',
        'Dải mạng ≥ N%',
        'Sự cố tuần qua',
        'Vừa vào kho thanh lý (7 ngày)',
      ]),
    );

    /*
     * SO HAI TẬP HỢP, không so hai chuỗi.
     *
     * Hiệu của chúng phải đúng bằng hai cái tên dưới đây. Viết thành hai lượt
     * `toHaveCount(0)` thì một khối THỨ BA rò sang Member sẽ không làm đỏ gì cả — mà đó chính
     * là kiểu rò rỉ bài này sinh ra để chặn.
     */
    const missing = saBlocks.filter((title) => !memberBlocks.includes(title));
    expect(
      asSet(missing),
      'Member KHÔNG được thấy hai khối an ninh — và cũng không được thiếu khối nào khác: ' +
        `SA thấy [${saBlocks.join(' | ')}], Member thấy [${memberBlocks.join(' | ')}]`,
    ).toEqual(asSet(['Két lâu chưa đổi', 'Yêu cầu mở két tuần qua']));
  });

  /* ================================================================== *
   * BÀI 5 — Bên trong các hộp thoại của phòng Két sắt
   * ================================================================== */

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Ba hộp thoại đứng ngay cửa két — Cất mật khẩu/khóa, Xác nhận danh tính, Hiện secret — và cả ba
   * đều đã có bài kiểm ĐƯỜNG ĐI (`vault.spec.ts`, `vault-reveal.spec.ts`,
   * `vault-write-stepup-ui.spec.ts`). Không bài nào trong đó mở hộp ra rồi ĐẾM xem bên trong
   * có ô nào. Nghĩa là:
   *   - Một ô thứ năm mọc thêm vào hộp "Cất mật khẩu/khóa" (một ô "dán từ file", một ô "gửi mail
   *     cho") sẽ đi qua sạch sẽ.
   *   - Ô "Giá trị" đổi từ `type=password` sang `type=text` — mật khẩu hiện nguyên trên màn
   *     lúc gõ — không làm đỏ gì cả, vì mọi bài đều `fill()` được như nhau.
   *   - Thanh đo độ khó ĐỔI TỪ CẢNH BÁO THÀNH CHẶN. Đây là thứ `docs/SHARED-REGISTRY.md` nói
   *     thẳng là không được làm: chặn cứng không làm mật khẩu cái camera mạnh lên, nó chỉ đẩy
   *     người dùng ghi mật khẩu thật vào ô "Ghi chú" — chỗ KHÔNG mã hóa.
   *   - Hộp "Xác nhận danh tính" ĐÓNG khi gõ sai mã. Đây là hàng rào cuối trước khi lộ một bí
   *     mật; một hộp đóng nhầm ở đây là một lần lộ.
   *
   * Đi vào bằng popup của `/vault` chứ không bằng tab của trang chi tiết: đó là cửa của phòng
   * này, và `VaultPanel` nhúng trong popup phải cư xử y hệt bản nhúng ở trang chi tiết (AD-15).
   */
  test('Bên trong hộp Cất mật khẩu/khóa, hộp Xác nhận danh tính và hộp Hiện secret', async ({ page }) => {
    test.setTimeout(150_000);
    const totpSecret = await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const deviceCode = `PC-E2E-HOP-${stamp}`;
    const deviceId = await seedDevice(page, deviceCode);
    // Một ngăn có sẵn để trang tổng liệt kê được chủ thể này.
    await stash(page, 'device', deviceId, `ngan-co-san E2E ${stamp}`);

    await page.goto('/vault');
    await page
      .getByRole('main')
      .getByRole('row', { name: new RegExp(deviceCode) })
      .getByRole('button', { name: `Mở két của ${deviceCode}` })
      .click();
    const popup = page.getByRole('dialog', { name: new RegExp(`^Két sắt — ${deviceCode}`) });
    await expect(popup).toBeVisible();

    /* ---------- HỘP "CẤT SECRET": có ô nào, ô nào bắt buộc ---------- */

    await popup.getByRole('button', { name: 'Cất mật khẩu/khóa' }).click();
    const form = page.getByRole('dialog', { name: 'Cất mật khẩu/khóa' });
    await expect(form).toBeVisible();

    expect(
      await textboxLabels(form),
      'hộp "Cất mật khẩu/khóa" phải có ĐÚNG bốn ô chữ. Một ô thứ năm ở đây là một quyết định về nơi ' +
        'chứa bí mật, không phải một cải tiến giao diện',
    ).toEqual(['Tên gọi', 'Tên đăng nhập', 'Giá trị', 'Ghi chú']);

    expect(
      await selectLabels(form),
      'hộp "Cất mật khẩu/khóa" phải có ĐÚNG một ô chọn: Loại',
    ).toEqual(['Loại']);

    /*
     * Ô "Giá trị" phải là ô MẬT KHẨU.
     *
     * `type=password` không phải chi tiết trang trí: đổi nó sang `text` là mật khẩu hiện
     * nguyên trên màn hình lúc gõ, và mọi bài kiểm hiện có vẫn xanh vì `fill()` không phân
     * biệt hai loại ô.
     */
    await expect(
      form.getByLabel('Giá trị'),
      'ô Giá trị phải che ký tự lúc gõ — người ngồi cạnh không được đọc trộm mật khẩu qua vai',
    ).toHaveAttribute('type', 'password');

    // Ô chọn "Loại" có gì bên trong. Option PORTAL ra ngoài hộp → tìm ở cấp `page`.
    await form.getByRole('button', { name: 'Loại' }).click();
    expect(
      await page.getByRole('option').allTextContents(),
      'két chỉ nhận đúng bốn loại nội dung — thêm loại thứ năm là phải sửa cả CHECK ở tầng DB',
    ).toEqual(['Mật khẩu', 'License key', 'Mã 2 lớp', 'Khác']);
    /*
     * Đổi ý thì bấm Esc — đúng thứ người dùng làm, và nó phải đóng MENU chứ không đóng cả hộp
     * (`ui/dialog.tsx`; bài cuối khối này canh cho nó không tái phát).
     */
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('option'),
      'Esc phải đóng menu ô chọn — còn mở thì cú bấm kế tiếp rơi trúng một option',
    ).toHaveCount(0);

    /* ---- Đường hỏng 0: bấm Lưu khi trống hẳn (DEV-025) ---- */

    /*
     * Form đặt `noValidate`: bong bóng "Please fill out this field." của trình duyệt không còn
     * chặn trước. Hai ô bắt buộc cùng thiếu → hai câu tiếng Việt dưới hai ô + dòng tóm tắt.
     */
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form.getByText('Còn 2 ô cần sửa trước khi lưu.')).toBeVisible();
    await expect(
      form.getByRole('textbox', { name: 'Tên gọi' }),
      'câu lỗi nằm dưới và nối vào đúng ô Tên gọi',
    ).toHaveAccessibleDescription('Đặt tên gọi cho ngăn này (vd "admin web", "SSH root").');
    await expect(form.getByRole('textbox', { name: 'Tên gọi' }), 'tiêu điểm về ô lỗi đầu tiên').toBeFocused();

    /* ---- Đường hỏng 1: tên gọi chỉ có khoảng trắng ---- */

    // Khoảng trắng là "có nội dung" với trình duyệt nhưng thua phép `.trim()` của form.
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill('   ');
    await form.getByLabel(/^\s*Giá trị\s*\*?\s*$/).fill(`Tam#Thoi#${stamp}`);
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(
      form.getByRole('textbox', { name: 'Tên gọi' }),
      'bỏ trống tên gọi thì phải nói ra ĐÚNG câu tiếng Việt, ngay dưới ô',
    ).toHaveAccessibleDescription('Đặt tên gọi cho ngăn này (vd "admin web", "SSH root").');
    await expect(form, 'báo lỗi mà hộp vẫn phải mở — đóng đi là mất sạch thứ vừa gõ').toBeVisible();

    /* ---- Đường hỏng 2: có tên gọi nhưng chưa có giá trị ---- */

    const label = `admin web E2E ${stamp}`;
    await form.getByLabel('Tên gọi').fill(label);
    const valueField = form.getByLabel(/^\s*Giá trị\s*\*?\s*$/);
    await valueField.fill('');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(
      valueField,
      'ô Giá trị trống: câu tiếng Việt dưới ô (trước đây là bong bóng tiếng Anh, câu này chưa từng hiện)',
    ).toHaveAccessibleDescription(/Chưa nhập giá trị cần cất\./);
    await expect(valueField).toHaveAttribute('aria-invalid', 'true');
    await expect(
      form.getByRole('textbox', { name: 'Tên gọi' }),
      'ô Tên gọi đã sửa xong thì lỗi của nó phải tự tắt',
    ).not.toHaveAttribute('aria-invalid', 'true');
    await expect(form, 'bị chặn thì hộp vẫn phải mở, không mất thứ vừa gõ').toBeVisible();

    /* ---- Giá trị YẾU: cảnh báo hiện, nhưng VẪN LƯU ĐƯỢC ---- */

    const weakValue = `yeu${stamp}`; // đủ dài, có chữ thường + chữ số; thiếu chữ HOA và ký tự đặc biệt
    await form.getByLabel('Giá trị').fill(weakValue);
    await expect(
      form.getByTestId('secret-strength'),
      'gõ ký tự đầu tiên là thanh đo phải hiện — nó là lời khuyên lúc gõ, không phải phán xét sau',
    ).toBeVisible();
    await expect(
      form.getByTestId('secret-strength-warning'),
      'giá trị thiếu chữ HOA và ký tự đặc biệt thì phải bị chê',
    ).toHaveText(
      'Giá trị chưa đủ mạnh — vẫn lưu được, nhưng nếu do mình đặt thì nên đổi.',
    );
    await expect(
      form.getByRole('button', { name: 'Lưu' }),
      'CẢNH BÁO, KHÔNG CHẶN: khóa nút Lưu ở đây là đẩy người dùng ghi mật khẩu thật vào ô ' +
        'Ghi chú — chỗ không được mã hóa. Xem docs/SHARED-REGISTRY.md trước khi đổi',
    ).toBeEnabled();

    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form, 'lưu xong thì hộp phải đóng').toBeHidden();
    await expect(
      popup.getByRole('cell', { name: label }).first(),
      'giá trị yếu vẫn phải được cất thật, không chỉ là "hộp đóng lại rồi"',
    ).toBeVisible();

    /* ---------- HỘP "XOAY": một ô, và Esc đóng được ---------- */

    await rowAction(page, label, 'Đổi mật khẩu');
    const rotate = page.getByRole('dialog', { name: `Đổi mật khẩu — ${label}` });
    await expect(rotate).toBeVisible();
    expect(
      await textboxLabels(rotate),
      'hộp Xoay chỉ đổi GIÁ TRỊ — nó không được mọc thêm ô metadata nào (đó là việc của hộp Sửa)',
    ).toEqual(['Giá trị mới']);
    await expect(rotate.getByLabel('Giá trị mới')).toHaveAttribute('type', 'password');

    /*
     * Xoay RỖNG: cùng hàng rào với hộp Cất — form `noValidate`, câu tiếng Việt dưới ô.
     */
    await rotate.getByRole('button', { name: 'Đổi mật khẩu' }).click();
    await expect(
      rotate.getByLabel('Giá trị mới'),
      'xoay rỗng phải bị chặn bằng câu tiếng Việt ngay dưới ô',
    ).toHaveAccessibleDescription('Chưa nhập giá trị cần cất.');
    await expect(rotate, 'bị chặn thì hộp Xoay vẫn phải mở').toBeVisible();

    await rotate.getByLabel('Giá trị mới').fill('yeu');
    await expect(
      rotate.getByTestId('secret-strength-warning'),
      'xoay là lúc người ta ĐẶT giá trị mới — thanh đo ở đây còn đáng nói hơn lúc cất lần đầu',
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(rotate, 'Esc phải đóng được hộp Xoay').toBeHidden();
    await expect(popup, 'đóng hộp con thì popup két vẫn phải còn đó').toBeVisible();

    /* ---------- HỘP "XÁC NHẬN DANH TÍNH": hàng rào cuối ---------- */

    // Hết grace — từ đây mở két phải gõ lại mã 6 số.
    expireStepUp(E2E_SA.email);

    /*
     * Bấm "Xem" của ĐÚNG dòng vừa cất, không phải `.first()`.
     *
     * Trong két này có hai ngăn và API không hứa thứ tự nào cả; `.first()` là một bài kiểm
     * quay xổ số — nó sẽ mở ngăn kia, rồi khẳng định giá trị ở cuối bài đỏ theo kiểu chẳng
     * liên quan gì tới điều đang kiểm.
     */
    await popup
      .getByRole('row', { name: new RegExp(label) })
      .getByRole('button', { name: 'Xem' })
      .click();
    /*
     * VLT-062: popup két đã là một hộp, nên bước gõ mã và bước hiện giá trị chạy NGAY TRONG
     * hộp đó — không chồng thêm hộp nào. Luôn chỉ MỘT hộp đang mở.
     */
    const stepUp = popup.getByRole('region', { name: 'Xác nhận danh tính' });
    await expect(
      stepUp,
      'hết grace mà bấm Xem thì phải được HỎI MÃ, không phải một toast lỗi rồi bỏ mặc',
    ).toBeVisible();
    await expect(page.getByRole('dialog'), 'bước mã nằm trong popup, không chồng hộp').toHaveCount(1);
    // Hộp nêu ĐÚNG ngăn đang mở (VLT-047) — người ta biết mình gõ mã để xem cái gì.
    await expect(stepUp.getByText(`Nhập mã 6 số để xem "${label}".`)).toBeVisible();

    expect(
      await textboxLabels(stepUp),
      'hộp xác nhận danh tính phải có ĐÚNG một ô: mã 6 số. Thêm ô nào ở đây cũng là thêm một ' +
        'đường đi vòng qua hàng rào cuối',
    ).toEqual(['Mã xác thực']);
    // Không dùng `maxlength`: mã dán kèm khoảng trắng ("123 456") sẽ bị trình duyệt cắt trước khi
    // lọc. Ô tự bỏ ký tự không phải số và cắt còn 6 — gõ 5 số để không kích hoạt tự gửi.
    await stepUp.getByLabel('Mã xác thực').fill('12 34 5x');
    await expect(
      stepUp.getByLabel('Mã xác thực'),
      'ô mã chỉ giữ chữ số ngay tại chỗ gõ',
    ).toHaveValue('12345');
    await stepUp.getByLabel('Mã xác thực').fill('');
    expect(
      await stepUp.getByRole('button').allTextContents(),
      'bước mã phải có đúng cặp Quay lại / Xác nhận',
    ).toEqual(['Quay lại', 'Xác nhận']);

    /* ---- Gõ SAI mã: hộp KHÔNG được đóng ---- */

    await stepUp.getByLabel('Mã xác thực').fill('000000');
    await expect(
      stepUp.getByRole('alert'),
      'gõ sai mã phải nói thẳng là sai mã, không phải một lỗi chung chung',
    ).toHaveText('Mã xác thực không đúng.');
    await expect(
      stepUp,
      'GÕ SAI MÃ MÀ HỘP ĐÓNG LẠI LÀ MỘT LẦN LỘ BÍ MẬT — đây là hàng rào cuối, nó phải đứng nguyên',
    ).toBeVisible();
    await expect(
      stepUp.getByLabel('Mã xác thực'),
      'mã TOTP chỉ sống 30 giây — giữ lại con số vừa bị từ chối chỉ dụ người ta bấm lại lần nữa',
    ).toHaveValue('');
    await expect(
      page.getByTestId('secret-value'),
      'chưa qua được hàng rào thì tuyệt đối chưa được thấy giá trị',
    ).toHaveCount(0);

    /* ---- Gõ ĐÚNG mã: sang hộp hiện secret ---- */

    await stepUp.getByLabel('Mã xác thực').fill(await freshTotpCode(totpSecret));
    await expect(stepUp).toBeHidden();

    /* ---------- HỘP "HIỆN SECRET": đủ bộ ba, và một nút ẩn ngay ---------- */

    const reveal = popup.getByRole('region', { name: label });
    await expect(reveal).toBeVisible();
    await expect(page.getByRole('dialog'), 'bước giá trị cũng nằm trong popup').toHaveCount(1);
    await expect(
      reveal.getByTestId('secret-value'),
      'gõ đúng mã rồi thì phải thấy đúng giá trị vừa cất',
    ).toHaveText(weakValue);
    await expect(
      reveal.getByTestId('reveal-countdown'),
      'phải có đồng hồ "còn hiện bao lâu" — không có thì giá trị biến mất đột ngột giữa lúc đang chép',
    ).toBeVisible();
    await expect(
      reveal.getByTestId('stepup-countdown'),
      'phải có đồng hồ thứ hai "còn mở két được bao lâu" — thiếu nó thì mở ngăn kế tiếp bị hỏi ' +
        'mã giữa chừng mà không hiểu vì sao, dù mốc đó vốn đoán trước được',
    ).toBeVisible();
    await expect(
      reveal.getByText('Lượt xem này đã được ghi nhật ký.'),
      'người xem phải BIẾT là lượt xem này có vết — đó là nửa sức răn đe của cơ chế',
    ).toBeVisible();
    expect(
      await reveal.getByRole('button').allTextContents(),
      'bước hiện giá trị chỉ có nút đổi cách hiện và "Ẩn ngay" — không nút sao chép, FR-026',
    ).toEqual(['Hiện từng ký tự', 'Ẩn ngay']);

    await reveal.getByRole('button', { name: 'Ẩn ngay' }).click();
    await expect(reveal, 'bấm "Ẩn ngay" phải giấu giá trị đi ngay lập tức').toBeHidden();
    await expect(page.getByTestId('secret-value')).toHaveCount(0);
    // Ẩn xong là về lại danh sách ngăn của CÙNG popup, không đóng popup.
    await expect(popup.getByRole('row', { name: new RegExp(label) })).toBeVisible();
  });

  /* ================================================================== *
   * BÀI 6 — Bên trong hai hộp quyết định và hộp gán quyền hàng loạt
   * ================================================================== */

  /*
   * VÌ SAO BÀI NÀY TỒN TẠI
   *
   * Hộp "Duyệt" và hộp "Từ chối" nhìn ngoài giống nhau, và đó chính là bẫy: chúng KHÔNG được
   * giống nhau. Hộp Duyệt có ô SỐ GIỜ và ô đó sửa được — người duyệt nhìn lý do rồi quyết,
   * chứ không phải bấm đồng ý với con số người xin tự đặt ("xin 24 giờ để đổi một cái mật
   * khẩu" thì duyệt 2 giờ là đủ). Hộp Từ chối KHÔNG được có ô đó: cấp giờ cho một phiếu bị từ
   * chối là vô nghĩa, và một ô thừa ở đó là một cú bấm nhầm chờ sẵn.
   *
   * Hộp gán hàng loạt có một luật âm không kém quan trọng: danh sách người bên trong CHỈ gồm
   * Member. SA/Admin xem được mọi secret theo VAI, nên gán thêm cho họ là một dòng quyền không
   * có tác dụng gì — và người gán sẽ tưởng là đã siết xong.
   *
   * ĐỎ KHI: hai hộp quyết định trôi về giống nhau; ô "Cấp trong bao lâu" bị khóa hoặc biến
   * mất; hộp gán hàng loạt liệt kê cả SA/Admin; hoặc gửi hộp gán khi chưa chọn ai mà nó im
   * lặng đóng lại.
   */
  test('Bên trong hộp Duyệt, hộp Từ chối và hộp gán quyền hàng loạt', async ({ page, browser }) => {
    // Hai luồng đăng nhập lần đầu (SA ở đây, Member ở trình duyệt thứ hai).
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);

    const stamp = uniqueStamp();
    const typeId = await deviceTypeId(page, 'Switch');
    const deviceId = await seedDevice(page, `SW-E2E-HOPD-${stamp}`, 'Switch');
    await stash(page, 'device', deviceId, `admin web E2E ${stamp}`);
    await page.request.post('/api/v1/vault/access', {
      headers: await writeHeaders(page),
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: typeId,
        tier: 'needs_approval',
      },
    });

    const memberCtx = await browser.newContext(SECOND_BROWSER);
    const memberPage = await memberCtx.newPage();
    try {
      await firstLogin(memberPage, E2E_MEMBER);
      const asked = await memberPage.request.post('/api/v1/vault/break-glass', {
        headers: await writeHeaders(memberPage),
        data: {
          ownerType: 'device',
          ownerId: deviceId,
          reason: `E2E ${stamp}: cần vào cấu hình switch`,
          hours: 6,
        },
      });
      expect(asked.status(), 'không dựng được phiếu treo thì không có hộp nào để mở').toBe(201);
    } finally {
      await memberCtx.close();
    }

    /* ---------- HỘP "DUYỆT" ---------- */

    await page.goto('/approvals');
    await page.getByRole('tabpanel').getByRole('button', { name: 'Duyệt', exact: true }).click();

    const approve = page.getByRole('dialog', { name: 'Duyệt mở két', exact: true });
    await expect(approve).toBeVisible();
    await expect(
      approve.getByText(E2E_MEMBER.email),
      'thân hộp phải nêu đích danh người xin — người trực đêm mở ba phiếu liền là quyết nhầm phiếu',
    ).toBeVisible();

    expect(
      await textboxLabels(approve),
      'hộp Duyệt phải có ĐÚNG hai ô: số giờ cấp và ghi chú cho người xin',
    ).toEqual(['Cấp trong bao lâu (giờ)', 'Ghi chú cho người xin']);
    await expect(
      approve.getByLabel('Cấp trong bao lâu (giờ)'),
      'ô giờ điền sẵn con số NGƯỜI XIN đề nghị — người duyệt nhìn lý do rồi mới quyết',
    ).toHaveValue('6');
    await expect(
      approve.getByLabel('Cấp trong bao lâu (giờ)'),
      'và nó phải SỬA ĐƯỢC: khóa lại là biến người duyệt thành cái nút "đồng ý" cho con số ' +
        'người xin tự đặt',
    ).toBeEditable();
    await expect(
      approve.getByText(
        'Rút ngắn được, tối đa 6 giờ như người xin.',
      ),
      'và phải nói ra là sửa được (chỉ rút ngắn, không cấp quá số xin), không để người duyệt tự đoán',
    ).toBeVisible();
    expect(
      await approve.getByTestId('dialog-footer').getByRole('button').allTextContents(),
      'chân hộp Duyệt: Hủy rồi mới tới Duyệt — thứ tự này giống nhau ở mọi hộp trong app. Nút ' +
        'Duyệt ghi rõ số giờ sẽ cấp, để không ai cấp nhầm 6 giờ khi định cấp 1',
    ).toEqual(['Hủy', 'Duyệt 6 giờ']);

    await approve.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(approve, 'nút ✕ phải đóng được hộp Duyệt mà không quyết gì cả').toBeHidden();

    /* ---------- HỘP "TỪ CHỐI" — phải KHÁC hộp Duyệt ---------- */

    await page.getByRole('tabpanel').getByRole('button', { name: 'Từ chối', exact: true }).click();
    const deny = page.getByRole('dialog', { name: 'Từ chối yêu cầu', exact: true });
    await expect(deny).toBeVisible();
    await expect(deny.getByText(E2E_MEMBER.email)).toBeVisible();

    expect(
      await textboxLabels(deny),
      'hộp Từ chối chỉ có ô ghi chú. Ô "cấp bao lâu" ở đây là vô nghĩa — và một ô thừa cạnh ' +
        'một nút màu đỏ là một cú bấm nhầm đang chờ sẵn',
    ).toEqual(['Lý do từ chối']);
    expect(
      await deny.getByTestId('dialog-footer').getByRole('button').allTextContents(),
      'chân hộp Từ chối: Hủy rồi mới tới Từ chối',
    ).toEqual(['Hủy', 'Từ chối']);

    await page.keyboard.press('Escape');
    await expect(deny, 'Esc phải đóng được hộp Từ chối').toBeHidden();
    await expect(
      page.getByRole('tabpanel').getByRole('button', { name: 'Duyệt', exact: true }),
      'đóng hộp = KHÔNG quyết: phiếu phải còn treo nguyên với đủ nút',
    ).toBeVisible();

    /* ---------- HỘP GÁN QUYỀN HÀNG LOẠT ---------- */

    const accounts = await page.request.get('/api/v1/accounts?limit=200');
    expect(accounts.ok(), 'không đọc được danh sách tài khoản thì không so được tập hợp').toBeTruthy();
    const memberEmails = ((await accounts.json()) as {
      items: { email: string; role: string }[];
    }).items
      .filter((account) => account.role === 'member')
      .map((account) => account.email);
    expect(memberEmails.length, 'phải có ít nhất một Member để hộp gán có gì mà liệt kê')
      .toBeGreaterThan(0);

    await page.goto('/admin/vault-access?view=matrix');
    const grid = page.getByTestId('access-grid');
    await expect(grid).toBeVisible();
    await page.getByRole('button', { name: 'Nhóm đối tượng' }).click();
    await page.getByRole('option', { name: 'Phần mềm', exact: true }).click();
    await grid.getByRole('button', { name: 'Gán "Phần mềm: License" cho nhiều người' }).click();

    const bulk = page.getByRole('dialog', { name: 'Gán "Phần mềm: License" cho người dùng' });
    await expect(bulk).toBeVisible();

    /*
     * Danh sách người trong hộp phải ĐÚNG BẰNG tập Member của hệ thống.
     *
     * Đếm số ô tick rồi mới soi từng người: đủ số mà thiếu một người thì có nghĩa là có một
     * người LẠ lọt vào — và người lạ ở đây chỉ có thể là SA/Admin, đúng thứ không được có mặt.
     */
    await expect(
      bulk.getByRole('checkbox'),
      `hộp gán chỉ được liệt kê Member (${memberEmails.length} người) — SA/Admin đã xem được ` +
        'mọi secret theo VAI, gán thêm cho họ là một dòng quyền không có tác dụng gì',
    ).toHaveCount(memberEmails.length);
    for (const email of memberEmails) {
      await expect(
        bulk.getByRole('checkbox', { name: new RegExp(email) }),
        `Member ${email} phải có mặt trong hộp gán`,
      ).toHaveCount(1);
    }
    await expect(
      bulk.getByRole('checkbox', { name: new RegExp(E2E_SA.email) }),
      'tài khoản SA tuyệt đối KHÔNG được xuất hiện trong danh sách gán quyền',
    ).toHaveCount(0);

    expect(
      await textboxLabels(bulk),
      'hộp gán hàng loạt chỉ có ĐÚNG một ô chữ: ghi chú',
    ).toEqual(['Ghi chú']);
    expect(
      await selectLabels(bulk),
      'và ĐÚNG một ô chọn: tầng quyền',
    ).toEqual(['Tầng quyền']);

    // Ô chọn tầng có gì bên trong — chỉ hai tầng CẤP được; "không có quyền" là GỠ, không phải gán.
    await bulk.getByRole('button', { name: 'Tầng quyền', exact: true }).click();
    expect(
      await page.getByRole('option').allTextContents(),
      'chỉ gán được hai tầng. "Không có quyền" là mặc định và là kết quả của việc GỠ, ' +
        'không phải một lựa chọn để gán',
    ).toEqual(['Cần duyệt', 'Xem thẳng']);
    // Esc đóng MENU, không đóng hộp gán (`ui/dialog.tsx`).
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('option'),
      'Esc phải đóng menu tầng quyền',
    ).toHaveCount(0);

    /* ---- Đường hỏng: gửi khi chưa chọn ai ---- */

    await bulk.getByRole('button', { name: 'Lưu' }).click();
    await expect(
      bulk.getByRole('alert'),
      'chưa chọn ai mà bấm Lưu thì phải nói ra — im lặng đóng lại là người gán tưởng đã gán xong',
    ).toHaveText('Chọn ít nhất một người.');
    await expect(bulk, 'báo lỗi thì hộp phải còn mở').toBeVisible();

    await bulk.getByRole('button', { name: 'Đóng hộp thoại' }).click();
    await expect(bulk).toBeHidden();
  });

  /* ================================================================== *
   * BÀI 7 — hai lớp chồng nhau, một phím Esc: ai đóng phần của ai
   * ================================================================== */

  /*
   * ===== `Escape` LÚC MENU Ô CHỌN ĐANG MỞ KHÔNG ĐƯỢC THỔI BAY CẢ HỘP THOẠI =====
   *
   * TRIỆU CHỨNG KHI HỎNG: bài chờ nút "Lưu" tới hết giờ; ảnh chụp cho thấy nút không mất — CẢ
   * CÁI HỘP CHỨA NÓ đã biến mất, chỉ còn lớp dưới, ngay sau một cú `Escape` để đóng menu ô chọn.
   *
   * CƠ CHẾ: `ui/select.tsx` có nhánh
   * `else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }` — ý định
   * "Escape chỉ đóng MENU" được viết ra thành mã. Một mình nó không đạt được, vì
   * `react-dismissable-layer` của Radix nghe `keydown` ở tầng `document` với `capture: true`:
   * tầng bắt chạy XONG trước khi sự kiện kịp bò tới handler React của ô chọn. Không handler
   * nào của con chặn nổi một listener đăng ký ở tài liệu, pha bắt — đó là lý do một dòng
   * `stopPropagation` trông rất hợp lý lại vô hiệu.
   *
   * CHỐT Ở `ui/dialog.tsx`, tại `onEscapeKeyDown` — chỗ DUY NHẤT Radix hỏi ý trước
   * khi đóng. `preventDefault()` làm Radix bỏ lượt đóng, còn sự kiện vẫn bò tiếp nên ô chọn
   * vẫn tự đóng menu của nó: mỗi bên đóng đúng phần của mình. Biết "đang có popover mở" bằng
   * `portalEl.childElementCount > 0` — cả sáu thứ có thể mở đè lên hộp đều portal vào đúng
   * điểm neo ấy, nên không có sổ đăng ký nào để mà quên cập nhật.
   *
   * VÌ SAO BÀI NÀY PHẢI CÓ: chốt chặn nằm ở bộ dùng chung (AD-15), nên nó
   * đúng hoặc sai cho MỌI form trong repo cùng một lúc — mọi ô chọn đều dựng từ
   * `ui/select.tsx`, mọi hộp đều dựng từ `ui/dialog.tsx`. Và nó rất dễ bị gỡ mất trong một
   * lượt dọn dẹp tưởng vô hại: `onEscapeKeyDown` đọc như một handler thừa nếu không đọc chú
   * thích. Thứ hỏng lại thì KHÔNG ồn ào — Esc vẫn "đóng cái gì đó", chỉ là đóng nhầm cái, và
   * người dùng mất trắng form vừa gõ mà không có một dòng lỗi nào hiện ra.
   *
   * ĐỎ KHI: chặn ở `onEscapeKeyDown` bị gỡ (Esc lại nuốt cả hộp), hoặc chặn quá tay thành
   * chặn LUÔN cả lượt đóng menu của ô chọn (menu kẹt lại, Esc thành một phím chết).
   */
  test(
    'Esc lúc menu ô chọn đang mở chỉ đóng MENU, không đóng cả hộp thoại',
    async ({ page }) => {
      test.setTimeout(150_000);
      await firstLogin(page, E2E_SA);

      const stamp = uniqueStamp();
      const deviceCode = `PC-E2E-ESC-${stamp}`;
      const deviceId = await seedDevice(page, deviceCode);
      await stash(page, 'device', deviceId, `ngan-co-san E2E ${stamp}`);

      await page.goto('/vault');
      await page
        .getByRole('main')
        .getByRole('row', { name: new RegExp(deviceCode) })
        .getByRole('button', { name: `Mở két của ${deviceCode}` })
        .click();
      const popup = page.getByRole('dialog', { name: new RegExp(`^Két sắt — ${deviceCode}`) });
      await popup.getByRole('button', { name: 'Cất mật khẩu/khóa' }).click();

      const form = page.getByRole('dialog', { name: 'Cất mật khẩu/khóa' });
      await expect(form).toBeVisible();
      // Gõ sẵn một thứ vào form: đó chính là thứ người dùng mất khi hộp bị đóng oan.
      await form.getByLabel('Tên gọi').fill(`admin web E2E ${stamp}`);

      await form.getByRole('button', { name: 'Loại' }).click();
      await expect(page.getByRole('option').first(), 'menu ô chọn phải mở ra đã').toBeVisible();

      await page.keyboard.press('Escape');

      await expect(
        page.getByRole('option'),
        'Esc phải đóng MENU của ô chọn — đó là điều `ui/select.tsx` đã viết ra là mình làm',
      ).toHaveCount(0);
      await expect(
        form,
        'nhưng hộp thoại PHẢI còn đó: một cú Esc để rút lại lựa chọn không được xoá sạch form vừa gõ',
      ).toBeVisible();
      await expect(
        form.getByLabel('Tên gọi'),
        'và thứ đã gõ phải còn nguyên',
      ).toHaveValue(`admin web E2E ${stamp}`);

      /*
       * VÀ CÚ ESC THỨ HAI PHẢI ĐÓNG ĐƯỢC HỘP.
       *
       * Nửa khẳng định này mới làm nửa trên có nghĩa. Chặn Esc vô điều kiện cũng làm mọi
       * khẳng định ở trên xanh — và biến Esc thành một phím chết trên MỌI hộp thoại của
       * repo, một cái hỏng còn phiền hơn cái vừa vá. Chặn phải có ĐIỀU KIỆN: có popover đang
       * mở thì nhường, không thì đóng như thường.
       */
      await page.keyboard.press('Escape');
      await expect(
        form,
        'không còn menu nào mở thì Esc phải đóng hộp như mọi hộp khác — chặn vô điều kiện là ' +
          'giết luôn đường thoát bằng bàn phím',
      ).toBeHidden();
      await expect(
        popup,
        'và chỉ đóng ĐÚNG một lớp: popup két bên dưới vẫn phải còn',
      ).toBeVisible();
    },
  );
});
