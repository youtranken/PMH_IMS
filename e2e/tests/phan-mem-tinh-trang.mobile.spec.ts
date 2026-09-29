import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  isoInDays,
  resetSoftware,
  resetUsers,
  searchAndWaitForFilter,
  uniqueStamp,
  writeHeaders,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
});

/**
 * SW-022 — 390px: mỗi hồ sơ là thẻ 3 dòng (mã + badge tình trạng · tên · "loại · ghế · NCC"),
 * không còn thẻ 8 dòng "nhãn : giá trị". Chạm thẻ mở hồ sơ. Sáng lẫn tối vì badge mang nghĩa.
 */
test('danh sách phần mềm ở 390px là thẻ gọn 3 dòng, chạm thẻ mở hồ sơ', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const code = `LIC-E2E-THE-${stamp}`;
  const res = await page.request.post('/api/v1/software', {
    headers: await writeHeaders(page),
    data: {
      code,
      name: 'Office thẻ gọn E2E',
      kind: 'license',
      seatTotal: 10,
      endDate: isoInDays(-4),
    },
  });
  expect(res.status()).toBe(201);

  await page.goto('/software');
  await searchAndWaitForFilter(page, code);
  const card = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: code }) });
  await expect(card).toHaveCount(1);
  await expect(card.getByText('Hết hạn', { exact: true })).toBeVisible();
  await expect(card).toContainText('Office thẻ gọn E2E');
  await expect(card).toContainText('License phần mềm · 0/10 ghế');
  // Không còn bảng gập với dòng "Thao tác", ô mũi tên rỗng.
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Thao tác với ${code}` })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: /chế độ tối/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(card.getByText('Hết hạn', { exact: true })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.getByRole('link', { name: code }).click();
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(code) })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
