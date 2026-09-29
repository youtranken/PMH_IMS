import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  isoInDays,
  resetSoftware,
  resetUsers,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Màn ĐỌC của đợt trau chuốt Q-15 ở 390px: Nhật ký (tiêu đề ngày + thẻ "giờ · việc", bộ lọc
 * gập), Kho thanh lý (thẻ gọn), Người dùng IMS (ba con số), Sắp hết hạn (bốn con số).
 */

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
});

test('Nhật ký 390px: tiêu đề "Hôm nay", thẻ "HH:mm · việc", ô lọc gập sau nút "Bộ lọc"', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  await page.goto('/admin/audit-log');
  await expect(page.getByRole('heading', { level: 3, name: 'Hôm nay' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^\d{2}:\d{2} · / }).first()).toBeVisible();

  // Ô lọc gập: chưa mở thì không thấy ô Hành động; mở ra là có.
  await expect(page.getByRole('button', { name: 'Hành động', exact: true })).toHaveCount(0);
  const toggle = page.getByRole('button', { name: /^Bộ lọc/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Hành động', exact: true })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test('Kho thanh lý 390px: thẻ gọn (không bảng) — mã là link, loại là huy hiệu, không trôi ngang', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  const headers = await writeHeaders(page);
  const code = `LIC-E2E-THE-${uniqueStamp()}`;
  const created = await page.request.post('/api/v1/software', {
    headers,
    data: { code, name: 'License vào kho', kind: 'license', endDate: isoInDays(60) },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;
  const retired = await page.request.patch(`/api/v1/software/${id}`, {
    headers,
    data: { status: 'retired' },
  });
  expect(retired.status()).toBe(200);

  await page.goto('/disposal?kind=software');
  await expect(page.getByRole('link', { name: code })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  const card = page.getByRole('listitem').filter({ hasText: code });
  await expect(card).toContainText('Phần mềm');
  await expect(card).toContainText('Đã thanh lý');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test('Người dùng IMS và Sắp hết hạn 390px: hàng con số đầu trang không đẩy trang trôi ngang', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  await page.goto('/admin/accounts');
  await expect(page.getByRole('button', { name: /Chưa cài 2 lớp/ })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.goto('/expiry');
  await expect(page.getByRole('button', { name: /Chờ tự thanh lý/ })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
