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
 * Màn ĐỌC của đợt UX vừa + nhẹ ở 390px: tab "Đã gia hạn" của Sắp hết hạn và Kho thanh lý có
 * menu ⋯ — không được đẩy trang trôi ngang.
 */

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
});

test('390px: tab Đã gia hạn và Kho thanh lý đọc được, không trôi ngang', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const headers = await writeHeaders(page);
  const code = `SSL-E2E-M390-${uniqueStamp()}`;
  const created = await page.request.post('/api/v1/software', {
    headers,
    data: { code, name: 'SSL xem trên điện thoại', kind: 'ssl', endDate: isoInDays(15) },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;
  const renewed = await page.request.post(`/api/v1/software/${id}/renew`, {
    headers,
    data: { endDate: isoInDays(400) },
  });
  expect(renewed.status()).toBeLessThan(300);

  await page.goto('/expiry');
  await page.getByRole('tab', { name: 'Đã gia hạn' }).click();
  await expect(page.getByRole('link', { name: new RegExp(code) })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  const retired = await page.request.patch(`/api/v1/software/${id}`, {
    headers,
    data: { status: 'retired' },
  });
  expect(retired.status()).toBe(200);
  await page.goto('/disposal?kind=software');
  await expect(page.getByRole('link', { name: code })).toBeVisible();
  await expect(page.getByRole('button', { name: `Thao tác với ${code}` })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
