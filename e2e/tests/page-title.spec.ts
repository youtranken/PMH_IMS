import { expect, test } from '@playwright/test';
import { APP_ORIGIN, E2E_SA, csrfOf, firstLogin, resetUsers, uniqueStamp } from './helpers';

/**
 * TÊN TAB TRÌNH DUYỆT ĐỔI THEO MÀN (B-03).
 *
 * Không đặt `document.title` thì mọi màn dùng chung đúng một cái tên của `index.html`. Mở bốn tab IMS để đối chiếu thì cả bốn đọc y hệt nhau và
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

const SCREENS: [string, string][] = [
  ['/', 'Bảng điều khiển · IMS'],
  ['/devices', 'Thiết bị · IMS'],
  ['/software', 'Phần mềm · IMS'],
  ['/isp-lines', 'Đường truyền · IMS'],
  ['/expiry', 'Sắp hết hạn · IMS'],
  ['/ip-addresses', 'Địa chỉ IP · IMS'],
  ['/nat', 'Sổ NAT · IMS'],
  ['/service-accounts', 'Tài khoản dịch vụ · IMS'],
  ['/approvals', 'Duyệt mở két · IMS'],
  ['/disposal', 'Kho thanh lý · IMS'],
  ['/admin/accounts', 'Người dùng IMS · IMS'],
  ['/admin/catalog', 'Danh mục · IMS'],
];

test('mỗi màn đội một tên tab khác nhau', async ({ page }) => {
  await firstLogin(page, E2E_SA);

  const seen = new Set<string>();
  for (const [route, name] of SCREENS) {
    await page.goto(route);
    await expect(page, `${route} phải đội tên "${name}"`).toHaveTitle(name);
    seen.add(name);
  }

  /*
   * Vế đối chứng, và nó là vế đáng giá: mười hai khẳng định ở trên vẫn xanh trọn vẹn nếu ai
   * đó làm `ROUTE_TITLE_KEY` trả cùng một khoá cho mọi đường mà tình cờ khoá ấy đúng ở màn
   * đầu — không, nặng hơn: chúng xanh nếu bảng khai đúng nhưng `titleKeyOf` luôn rơi về một
   * tên. Đếm số tên PHÂN BIỆT là câu hỏi mà cả mười hai ô kia không hỏi.
   */
  expect(seen.size, 'mười hai màn phải cho mười hai tên khác nhau').toBe(SCREENS.length);
});

test('trang chi tiết đội tên khu vực của nó, không rơi về tên sản phẩm trơn', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);

  // Tự tạo thiết bị của mình: dựa vào hàng do bài khác để lại thì chạy lẻ bài này là đỏ.
  const code = `PC-E2E-TITLE-${uniqueStamp()}`;
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string }[] };
  });
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
    data: { code, name: 'Máy kiểm tên tab', deviceTypeId: catalog.deviceTypes[0].id },
  });
  expect(created.status()).toBe(201);

  await page.goto('/devices');
  await page.getByRole('link', { name: code }).click();
  await expect(page).toHaveURL(/\/devices\/[0-9a-f-]{36}$/);

  await expect(page, 'trang chi tiết thiết bị vẫn thuộc khu "Thiết bị"').toHaveTitle(
    'Thiết bị · IMS',
  );
});
