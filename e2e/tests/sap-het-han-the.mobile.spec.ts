import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  isoInDays,
  resetDevices,
  resetSoftware,
  resetUsers,
  uniqueStamp,
  writeHeaders,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetDevices();
});

/**
 * EX-013 — 390px: mỗi mục là thẻ 2 dòng (mục + badge ngày · "loại · ngày hết hạn" + nút Gia
 * hạn nhỏ), và ba ô số nằm MỘT hàng ngang thay vì rơi thành 2 + 1. Sáng lẫn tối.
 */
test('Sắp hết hạn ở 390px: thẻ 2 dòng, ba ô số một hàng, sáng và tối', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const code = `SSL-E2E-THE-${stamp}`;
  const end = isoInDays(10);
  const res = await page.request.post('/api/v1/software', {
    headers: await writeHeaders(page),
    data: { code, name: 'Chứng chỉ thẻ E2E', kind: 'ssl', endDate: end },
  });
  expect(res.status()).toBe(201);

  await page.goto('/expiry');
  await expect(page.getByRole('heading', { name: 'Sắp hết hạn' })).toBeVisible();

  const card = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: new RegExp(code) }) });
  await expect(card).toHaveCount(1);
  await expect(card.getByText('Còn 10 ngày')).toBeVisible();
  const [y, m, d] = end.split('-');
  await expect(card).toContainText(`Chứng chỉ SSL · ${d}/${m}/${y}`);
  await expect(card.getByRole('button', { name: 'Gia hạn' })).toBeVisible();
  // Không còn thẻ bảng gập "Mục / Loại / Hết hạn / Tình trạng / Thao tác".
  await expect(page.getByRole('table')).toHaveCount(0);

  const tiles = [
    page.getByRole('button', { name: /Đã quá hạn/ }),
    page.getByRole('button', { name: /Gấp/ }),
    page.getByRole('button', { name: /Sắp tới/ }),
  ];
  const tops = await Promise.all(tiles.map(async (tile) => (await tile.boundingBox())!.y));
  expect(new Set(tops.map(Math.round)).size, 'ba ô số phải nằm cùng một hàng').toBe(1);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: /chế độ tối/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(card.getByText('Còn 10 ngày')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  // Gia hạn ngay trên thẻ vẫn mở đúng hộp của mục đó.
  await card.getByRole('button', { name: 'Gia hạn' }).click();
  await expect(page.getByRole('dialog', { name: new RegExp(`Gia hạn — ${code}`) })).toBeVisible();
});
