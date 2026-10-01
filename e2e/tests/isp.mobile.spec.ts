import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  ispProviderId,
  resetIsp,
  resetUsers,
  writeHeaders,
  uniqueStamp,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetIsp();
});

/**
 * AC 3.3 không nói câu 390px, nhưng đây là màn người ta mở lúc 2 giờ sáng khi mạng chết —
 * cầm điện thoại, cần số hotline nhà mạng và bấm gọi được ngay. Nếu có một màn phải dùng
 * được trên điện thoại thì chính là màn này.
 */
test('danh sách đường truyền đọc được ở 390px và hotline bấm gọi được', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const code = `ISP-E2E-M-${stamp}`;

  const created = await page.request.post('/api/v1/isp-lines', {
    headers: await writeHeaders(page),
    data: { code, providerId: await ispProviderId(page, 'Viettel E2E'), hotline: '1800 8119' },
  });
  expect(created.status()).toBe(201);

  await page.goto('/isp-lines');
  await expect(page.getByRole('heading', { name: 'Đường truyền' })).toBeVisible();
  await expect(page.getByRole('link', { name: code })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  // Hotline phải là link `tel:` — trên điện thoại là chạm một cái để gọi, không phải chép tay.
  // Gửi "1800 8119", lưu "18008119" (Q-18: số điện thoại lưu không dấu cách).
  const hotline = page.getByRole('link', { name: '1800 8119' });
  await expect(hotline).toBeVisible();
  await expect(hotline).toHaveAttribute('href', 'tel:18008119');
});

/*
 * Ở 390px mỗi đường là một THẺ gọn (mã · trạng thái, nhà mạng · băng thông, nút gọi) chứ không
 * phải bảng gập dọc bảy dòng toàn nhãn cột — cùng mẫu với danh sách thiết bị và phần mềm.
 */
test('390px: mỗi đường truyền là một thẻ gọn, không còn bảng', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const code = `ISP-E2E-THE-${stamp}`;

  const created = await page.request.post('/api/v1/isp-lines', {
    headers: await writeHeaders(page),
    data: {
      code,
      providerId: await ispProviderId(page, 'Viettel E2E'),
      bandwidth: '300 Mbps',
      hotline: '1800 8119',
    },
  });
  expect(created.status()).toBe(201);

  await page.goto('/isp-lines');
  const card = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: code }) });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Đang dùng');
  await expect(card).toContainText('Viettel E2E · 300 Mbps');
  await expect(card.getByRole('link', { name: '1800 8119' })).toHaveAttribute('href', 'tel:18008119');
  await expect(page.getByRole('main').getByRole('columnheader')).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
