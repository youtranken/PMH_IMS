import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetDevices,
  resetIpam,
  resetSoftware,
  resetUsers,
} from './helpers';

/**
 * UX-DR2 × M3 — khối LỖI của các màn danh sách, đọc ở 390px.
 *
 * `api-error-not-empty.spec.ts` (nhánh này) đã chứng minh phần NGHIỆP VỤ: API hỏng
 * phải nói ra chứ không hóa thành "chưa có dữ liệu". Nó chạy ở project desktop. Nhưng khối lỗi
 * cũng là một bề mặt ĐỌC, và UX-DR2 không miễn trừ cho nó:
 *
 *   - đúng lúc mạng chập chờn là lúc người ta cầm điện thoại chứ không ngồi trước desktop;
 *   - khối lỗi được dựng bằng `style` inline trong `ui/load-state.tsx`, không đi qua lớp
 *     responsive nào của bảng — nên nó là đúng loại khối dễ tràn mà không ai để ý, vì ở
 *     desktop nó luôn vừa.
 *
 * Mỗi bài chặn ĐÚNG MỘT đường API bằng `page.route` (cùng lối với bài desktop) và hỏi ba câu:
 * khối lỗi có hiện không · câu nói dối "rỗng" có vắng mặt không · khối đó có nằm gọn trong
 * 390px không.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetIpam();
  resetSoftware();
});

/*
 * Câu của khối lỗi khi API trả 500.
 *
 * `LoadError` chọn câu THEO NGUYÊN NHÂN: 403 nói thiếu quyền, 404 nói không tìm thấy, mất
 * mạng nói mất kết nối, và 500 ra câu này — bài này giả lập 500, nên đây là câu đúng của nó.
 */
const LOAD_ERROR =
  'Máy chủ IMS đang lỗi. Thử lại sau ít phút; nếu vẫn lỗi, gửi "Chi tiết kỹ thuật" bên dưới cho Super Admin.';

/** Bắt một đường API trả 500 — giống `breakRoute` của bài desktop, cùng hình dạng lỗi. */
async function breakRoute(page: Page, pattern: RegExp): Promise<void> {
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'INTERNAL', message: 'sập giả lập' }),
    }),
  );
}

/**
 * Khối lỗi có nằm gọn trong bề ngang máy không.
 *
 * Hai câu hỏi khác nhau nên hỏi cả hai: `horizontalOverflow` bắt việc CẢ TRANG đẩy ra thanh
 * cuộn ngang, còn hộp bao của chính dòng chữ lỗi bắt việc riêng khối đó thò ra khỏi mép — thứ
 * xảy ra được mà trang vẫn không cuộn ngang, vì phần thò ra bị `overflow: hidden` của tổ tiên
 * cắt cụt. Cắt cụt thì người dùng đọc mất chữ, mà `toBeVisible()` vẫn xanh.
 */
async function expectErrorBlockFits(page: Page): Promise<void> {
  const message = page.getByText(LOAD_ERROR);
  await expect(message).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();

  const box = await message.boundingBox();
  expect(box, 'khối lỗi phải có hộp bao đo được').not.toBeNull();
  const width = page.viewportSize()?.width ?? 390;
  expect(box!.x, 'khối lỗi không được bắt đầu ở ngoài mép trái').toBeGreaterThanOrEqual(-1);
  expect(
    box!.x + box!.width,
    'khối lỗi không được thò qua mép phải màn 390px',
  ).toBeLessThanOrEqual(width + 1);

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
}

test.describe('Màn danh sách hỏng, đọc ở 390px', () => {
  test('danh sách thiết bị: hỏng thì hiện khối lỗi, không hiện "chưa có thiết bị"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await breakRoute(page, /\/api\/v1\/devices\?/);
    await page.goto('/devices');

    /*
     * Vế phủ định là vế quan trọng: một lượt gọi API hỏng KHÔNG được đọc ra thành một cái kho
     * sạch — người trực đóng máy về, và cái máy họ đang đi tìm vẫn nằm đó.
     *
     * Có HAI câu rỗng phải loại trừ, không phải một: màn tách "chưa khai gì" khỏi "lọc không
     * ra". Câu NGUY HIỂM hơn là 'Kho thiết bị đang trống.' — nó khẳng định thẳng thừng rằng kho
     * rỗng, trong khi câu kia ít ra còn nhắc tới bộ lọc. Kiểm thiếu một vế là cổng này có thể
     * xanh vì đang canh một câu không xuất hiện ở cảnh này.
     */
    await expect(page.getByText('Không có thiết bị nào khớp bộ lọc.')).toHaveCount(0);
    await expect(page.getByText('Kho thiết bị đang trống.')).toHaveCount(0);
    await expectErrorBlockFits(page);
  });

  test('danh sách dải IP: hỏng thì hiện khối lỗi, không hiện "chưa khai báo dải nào"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await breakRoute(page, /\/api\/v1\/ipam\/subnets(\?|$)/);
    await page.goto('/ip-addresses');

    await expect(page.getByText('Chưa khai báo dải nào')).toHaveCount(0);
    await expectErrorBlockFits(page);
  });

  test('màn Sắp hết hạn: hỏng thì hiện khối lỗi, không hiện "không có gì sắp hết hạn"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await breakRoute(page, /\/api\/v1\/expiry\?/);
    await page.goto('/expiry');

    /*
     * Đây là câu nói dối đắt nhất trong ba câu: màn này tồn tại để trả lời "tháng này có gì
     * phải gia hạn không". Trả lời "không có gì" khi thật ra không hỏi được là cách bỏ lỡ một
     * chứng chỉ SSL hết hạn.
     */
    await expect(page.getByText('Không có gì sắp hết hạn trong khoảng này.')).toHaveCount(0);
    await expectErrorBlockFits(page);
  });

  /**
   * Vế đối chứng — không có nó thì một bản hỏng "luôn luôn hiện khối lỗi" cũng xanh cả ba bài
   * trên, và cả hệ thống kêu hỏng suốt ngày ở điện thoại.
   */
  test('API lành ở 390px: không một khối lỗi nào xuất hiện', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    for (const path of ['/devices', '/ip-addresses', '/expiry']) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByText(LOAD_ERROR), `${path} không được kêu hỏng`).toHaveCount(0);
    }
  });
});
