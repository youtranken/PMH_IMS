import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  isoInDays,
  resetDevices,
  resetSoftware,
  resetUsers,
  writeHeaders,
  uniqueStamp,
  switchTheme,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  // Bảo hành thiết bị cũng là một nguồn hạn — máy sót lại từ spec khác sẽ chen vào bảng.
  resetDevices();
});

/**
 * G-10: "Sắp hết hạn" là màn ĐỌC trung tâm và UX-DR2 xếp nó vào nhóm phải dùng được ở
 * 390px.
 *
 * Kiểm cả SÁNG lẫn TỐI vì đây là màn có màu trạng thái — theo luật của dự án, màn nào dùng
 * màu để nói nghĩa thì phải nhìn được ở cả hai chế độ.
 */
test('màn Sắp hết hạn đọc được ở 390px, sáng và tối', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const headers = await writeHeaders(page);
  const soon = isoInDays(10);

  const created = await page.request.post('/api/v1/software', {
    headers,
    data: { code: `SSL-E2E-M-${stamp}`, name: 'Chứng chỉ web E2E', kind: 'ssl', endDate: soon },
  });
  expect(created.status()).toBe(201);

  await page.goto('/expiry');
  await switchTheme(page, 'light');
  await expect(page.getByRole('heading', { name: 'Sắp hết hạn' })).toBeVisible();
  await expect(page.getByText('Chứng chỉ web E2E')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await switchTheme(page, 'dark');
  await expect(page.getByText('Chứng chỉ web E2E')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
