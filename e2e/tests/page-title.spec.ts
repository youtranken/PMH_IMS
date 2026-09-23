import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, resetUsers } from './helpers';

/**
 * TÊN TAB TRÌNH DUYỆT ĐỔI THEO MÀN (B-03).
 *
 * Trước 23/09 `document.title` không được đặt ở đâu trong `web/src`: mười lăm màn dùng chung
 * đúng một cái tên của `index.html`. Mở bốn tab IMS để đối chiếu thì cả bốn đọc y hệt nhau và
 * phải bấm từng cái để tìm; lịch sử duyệt và dấu trang cũng mang một tên duy nhất.
 *
 * VÌ SAO CẦN E2E chứ Vitest chưa đủ: bài Vitest gọi thẳng hook trong một `MemoryRouter`, tức
 * nó chứng minh cái hook đúng chứ không chứng minh có ai GỌI nó. Gỡ dòng `usePageTitle()` ở
 * `App.tsx` thì bài Vitest vẫn xanh nguyên. Bài này đi qua router thật, trong trình duyệt
 * thật, nên nó canh đúng chỗ kia.
 */
test.beforeEach(() => {
  resetUsers();
});

const MAN_HINH: [string, string][] = [
  ['/', 'Bảng điều khiển · IMS'],
  ['/devices', 'Thiết bị · IMS'],
  ['/software', 'Phần mềm · IMS'],
  ['/isp-lines', 'Đường truyền · IMS'],
  ['/expiry', 'Sắp hết hạn · IMS'],
  ['/ip-addresses', 'Địa chỉ IP · IMS'],
  ['/nat', 'Sổ NAT · IMS'],
  ['/service-accounts', 'Tài khoản dịch vụ · IMS'],
  ['/approvals', 'Duyệt yêu cầu · IMS'],
  ['/disposal', 'Kho thanh lý · IMS'],
  ['/admin/accounts', 'Tài khoản · IMS'],
  ['/admin/catalog', 'Danh mục · IMS'],
];

test('mỗi màn đội một tên tab khác nhau', async ({ page }) => {
  await firstLogin(page, E2E_SA);

  const daThay = new Set<string>();
  for (const [duong, ten] of MAN_HINH) {
    await page.goto(duong);
    await expect(page, `${duong} phải đội tên "${ten}"`).toHaveTitle(ten);
    daThay.add(ten);
  }

  /*
   * Vế đối chứng, và nó là vế đáng giá: mười hai khẳng định ở trên vẫn xanh trọn vẹn nếu ai
   * đó làm `ROUTE_TITLE_KEY` trả cùng một khoá cho mọi đường mà tình cờ khoá ấy đúng ở màn
   * đầu — không, nặng hơn: chúng xanh nếu bảng khai đúng nhưng `titleKeyOf` luôn rơi về một
   * tên. Đếm số tên PHÂN BIỆT là câu hỏi mà cả mười hai ô kia không hỏi.
   */
  expect(daThay.size, 'mười hai màn phải cho mười hai tên khác nhau').toBe(MAN_HINH.length);
});

test('trang chi tiết đội tên khu vực của nó, không rơi về tên sản phẩm trơn', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);

  await page.goto('/devices');
  // Mã thiết bị của bộ E2E có dạng `PC-E2E-123456` — chữ `E2E` ở GIỮA, không ở đầu.
  // Bản đầu dùng `/^E2E-/` nên chờ hết 60 giây một link không tồn tại.
  const link = page.getByRole('link', { name: /E2E/ }).first();
  await link.click();
  await expect(page).toHaveURL(/\/devices\/[0-9a-f-]{36}$/);

  await expect(page, 'trang chi tiết thiết bị vẫn thuộc khu "Thiết bị"').toHaveTitle(
    'Thiết bị · IMS',
  );
});
