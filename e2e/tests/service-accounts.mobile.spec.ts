import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetServiceAccounts,
  resetUsers,
  writeHeaders,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetServiceAccounts();
});

/**
 * UX-DR2 — danh sách và hồ sơ tài khoản dịch vụ là màn ĐỌC, nên phải dùng được ở 390px.
 *
 * Cảnh dùng thật: đang ở nhà khách hàng, cần biết tài khoản cổng VNPT thuộc về ai và mật khẩu
 * cất ở đâu. Bảng này rộng hơn danh sách thiết bị (mã · tên · loại · đăng nhập · bộ phận ·
 * người phụ trách · trạng thái) nên nó là chỗ dễ tràn ngang nhất trong đợt màn mới.
 */
test('danh sách và hồ sơ tài khoản dịch vụ đọc được ở 390px', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = Date.now().toString().slice(-6);
  const code = `VPN-E2E-M390-${stamp}`;

  // Tạo qua API: form nhập là màn desktop-only, không phải thứ kiểm ở 390px.
  const created = await page.request.post('/api/v1/service-accounts', {
    headers: await writeHeaders(page),
    data: {
      code,
      kind: 'vpn',
      name: 'VPN phòng Kế toán',
      login: 'vpn-ketoan@pmh.com.vn',
      department: 'Kế toán',
      ownerName: 'Chị Lan',
      groupName: 'vpn-ketoan',
      allowedIps: '203.113.1.5, 118.70.2.0/24',
    },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;

  await page.goto('/service-accounts');
  await expect(page.getByRole('link', { name: code })).toBeVisible();
  // Bảng gập thành thẻ dọc — nhãn cột phải đi theo giá trị, không thì đọc ra một cột số liệu
  // không biết của cái gì.
  await expect(page.getByText('vpn-ketoan@pmh.com.vn')).toBeVisible();
  await expect(page.getByText('Đang dùng')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.goto(`/service-accounts/${id}`);
  await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
  await expect(page.getByText('Chị Lan')).toBeVisible();
  /*
   * Dải IP là chuỗi DÀI không có khoảng trắng ở giữa mỗi mục ("118.70.2.0/24") — đúng thứ đẩy
   * cả trang rộng ra ở 390px nếu khu hồ sơ không cho ngắt dòng.
   */
  await expect(page.getByText('203.113.1.5, 118.70.2.0/24')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.getByRole('tab', { name: 'Lịch sử' }).click();
  await expect(page.getByText('Tạo hồ sơ')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
