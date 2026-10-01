import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  devicesPageButton,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetIpam,
  resetSoftware,
  resetUsers,
  writeHeaders,
} from './helpers';

/**
 * "KHÔNG CÓ" LÀ MỘT KHẲNG ĐỊNH. Màn hình không được nói nó khi chưa hỏi được.
 *
 * ===== MẪU LỖI BÀI NÀY CANH =====
 *
 * Viết `query.data ?? []` / `?? 0` là để một lỗi 500 rơi đúng vào hình dạng của "không có gì"
 * và màn hình trông HOÀN CHỈNH. Không toast,
 * không khối đỏ, không có gì để người dùng nghi ngờ.
 *
 * Bốn chỗ đau nhất, và vì sao chúng không phải chuyện giao diện:
 *
 *   1. KHU MỞ RỘNG của trang thiết bị — nơi trả lời "máy này còn giữ IP / rule NAT / ghế
 *      license nào không". Đây đúng là câu người ta hỏi TRƯỚC KHI THANH LÝ. Đọc im lặng
 *      thành "sạch rồi" là thanh lý nhầm một máy còn đang giữ đồ.
 *
 *   2. DANH SÁCH PHIÊN của một tài khoản — màn người ta mở đúng lúc nghi tài khoản bị chiếm.
 *      "Chưa có dữ liệu" nghĩa là "không ai đang đăng nhập", nên admin đóng hộp thoại lại và
 *      tin rằng mình đã kiểm tra xong, trong khi phiên của kẻ kia vẫn sống.
 *
 *   3. Ô CHỌN THIẾT BỊ ở form NAT / cấp IP / gán license — không thấy máy đang có thì người
 *      dùng khai một máy mới trùng, hoặc chọn đại máy khác. Cả hai đều ghi vào DB.
 *
 *   4. Ô CHỌN DANH MỤC ở form thêm mới ("Loại thiết bị" là ô BẮT BUỘC) — hiện "— Không có
 *      lựa chọn —", đọc y như lúc chưa ai khai danh mục.
 *
 * ===== VÌ SAO BÀI NÀY CHẶN Ở TẦNG MẠNG =====
 *
 * Bài này dùng `page.route` vì không có cách nào khác: hàng rào cần chứng
 * minh là hành vi khi API HỎNG, mà API thật thì không hỏng theo yêu cầu. Chỉ chặn đúng MỘT
 * đường mỗi bài — phần còn lại của màn vẫn chạy thật, nên bài kiểm cũng chứng minh luôn rằng
 * một khối hỏng không kéo sập cả trang.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetIpam();
  resetSoftware();
  resetCatalog();
});

/*
 * Bài này giả lập 500, nên câu đúng của nó là câu dành cho 500 — xem `lib/load-error-text.ts`:
 * `LoadError` chọn câu theo nguyên nhân.
 */
const LOAD_ERROR =
  'Máy chủ IMS đang lỗi. Thử lại sau ít phút; nếu vẫn lỗi, gửi "Chi tiết kỹ thuật" bên dưới cho Super Admin.';
const PICKER_ERROR = 'Không tải được danh sách. Thử lại sau.';

/** Bắt một đường API trả 500. Trả về hàm gỡ, để phần sau của bài chạy trên API thật. */
async function breakRoute(page: Page, pattern: string | RegExp) {
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'INTERNAL', message: 'sập giả lập' }),
    }),
  );
  return () => page.unroute(pattern);
}

async function typeIdFor(page: Page, name: string): Promise<string> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  return (catalog.deviceTypes.find((t) => t.name === name) ?? catalog.deviceTypes[0]).id;
}

async function makeDevice(page: Page, code: string): Promise<string> {
  const res = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { code, name: `May ${code}`, deviceTypeId: await typeIdFor(page, 'PC') },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { device: { id: string } }).device.id;
}

test.describe('API hỏng phải nói ra, không được hóa thành rỗng', () => {
  test('trang thiết bị: khu mở rộng hỏng thì báo hỏng, không biến mất im lặng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const deviceId = await makeDevice(page, `PC-E2E-M3-${stamp}`);

    await breakRoute(page, /\/api\/v1\/devices\/[^/]+\/panels/);
    await page.goto(`/devices/${deviceId}`);

    /*
     * Hồ sơ máy vẫn hiện đầy đủ — đó chính là điều khiến lỗi cũ nguy hiểm: trang trông xong
     * xuôi. Nên bài này khẳng định CẢ HAI vế: phần lành vẫn lành, phần hỏng nói ra là hỏng.
     */
    await expect(page.getByText(`PC-E2E-M3-${stamp}`).first()).toBeVisible();
    await expect(page.getByText(LOAD_ERROR)).toBeVisible();
  });

  test('phiên đăng nhập: API hỏng KHÔNG được hiện "Chưa có dữ liệu"', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await breakRoute(page, /\/api\/v1\/accounts\/[^/]+\/sessions/);

    await page.goto('/admin/accounts');
    await page.getByRole('button', { name: 'Thao tác với', exact: false }).first().click();
    await page.getByRole('menuitem', { name: 'Phiên đang mở' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(LOAD_ERROR)).toBeVisible();
    /*
     * Vế phủ định là vế quan trọng: chính "Chưa có dữ liệu" mới là câu nói dối. Thiếu dòng
     * này thì một bản sửa hiện CẢ HAI câu cùng lúc vẫn xanh, mà màn hình thì vẫn lừa người đọc.
     */
    /* Câu rỗng của hộp này không phải 'Chưa có dữ liệu' (chữ của một cái bảng trống): màn
       NÀY người ta mở đúng lúc nghi tài khoản bị chiếm — câu trả lời phải là một khẳng định
       đọc được. API hỏng thì KHÔNG được nói câu đó. */
    await expect(dialog.getByText('Không còn phiên đăng nhập nào đang mở.')).toHaveCount(0);
  });

  test('ô chọn thiết bị ở form NAT: tìm kiếm hỏng thì nói hỏng, không nói "không có máy"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await makeDevice(page, `RT-E2E-M3-${Date.now().toString().slice(-4)}`);

    // CHỈ chặn đường tìm kiếm thiết bị. Danh mục và bảng NAT vẫn tải thật.
    await breakRoute(page, /\/api\/v1\/devices\?.*search=/);
    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm luật NAT' }).first().click();

    const picker = page.getByRole('combobox', { name: 'Router' });
    await picker.fill('RT-E2E');
    await expect(page.getByText(PICKER_ERROR)).toBeVisible();
  });

  test('form thêm thiết bị: danh mục hỏng thì ô bắt buộc nói hỏng, không nói "không có lựa chọn"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/devices');
    // Chặn SAU khi màn danh sách đã tải xong, để cache của react-query cũng trống khi form mở.
    await breakRoute(page, /\/api\/v1\/catalog\?/);
    await page.reload();

    await devicesPageButton(page, 'Thêm thiết bị').click();
    /*
     * Bám vào hộp thoại, không bám vào cả trang: thanh lọc phía sau có một ô chọn TRÙNG TÊN
     * trợ năng ("Loại"), và `getByRole` khớp theo chuỗi con — không thu hẹp thì bài kiểm bấm
     * vào ô lọc rồi khẳng định về đúng thứ nó không định kiểm.
     */
    const form = page.getByRole('dialog');
    await form.getByRole('button', { name: 'Loại' }).click();

    await expect(page.getByText(PICKER_ERROR)).toBeVisible();
    await expect(page.getByText('— Không có lựa chọn —')).toHaveCount(0);
  });

  /**
   * Vế đối chứng — và là vế giữ cho hàng rào không kêu oan.
   *
   * Không có bài này thì một bản sửa cẩu thả (luôn hiện khối lỗi) cũng xanh ở bốn bài trên,
   * và cả hệ thống kêu hỏng suốt ngày. Đúng chế độ hỏng tôi đã gây ra một lần ở đợt C khi
   * `assertUsable` khóa luôn cả đường sửa hồ sơ ISP.
   */
  test('API lành: không một khối lỗi nào xuất hiện', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const deviceId = await makeDevice(page, `PC-E2E-M3OK-${Date.now().toString().slice(-4)}`);

    await page.goto(`/devices/${deviceId}`);
    await expect(page.getByRole('button', { name: 'Sửa hồ sơ' })).toBeVisible();
    await expect(page.getByText(LOAD_ERROR)).toHaveCount(0);

    await page.goto('/devices');
    await devicesPageButton(page, 'Thêm thiết bị').click();
    const form = page.getByRole('dialog');
    await form.getByRole('button', { name: 'Loại' }).click();
    await expect(page.getByRole('option').first()).toBeVisible();
    await expect(page.getByText(PICKER_ERROR)).toHaveCount(0);
  });
});
