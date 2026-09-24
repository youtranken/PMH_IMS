import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  isoInDays,
  resetIpam,
  resetSoftware,
  resetUsers,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetIpam();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

/**
 * UX-DR2 — bảng điều khiển là màn ĐỌC, và là màn đầu tiên sếp mở.
 *
 * Cảnh dùng thật đúng như epic mô tả: ba phút trước giờ họp, và rất có thể là trên điện thoại
 * trong thang máy. Mọi khối phải tự xếp dọc, chữ đọc được, không tràn ngang.
 */
test.describe('Bảng điều khiển ở 390px', () => {
  test('mọi khối xếp dọc, đọc được, không tràn ngang', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
    const octet = (Number(stamp) % 200) + 30;

    await page.request.post('/api/v1/software', {
      headers,
      data: {
        code: `LIC-E2E-M390-${stamp}`,
        name: 'License có tên rất dài để thử tràn ngang trên điện thoại',
        kind: 'license',
        endDate: isoInDays(5),
      },
    });

    /*
     * Một dải ĐẦY, để khối "Dải mạng sắp đầy" thật sự có `UsageBar` mà đo tràn ngang.
     * Khối rỗng thì bài này xanh mà chẳng kiểm được gì — thanh tiến trình mới là thứ dễ tràn.
     */
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.16.${octet}.0/30`, name: `LAN 390 E2E ${stamp}` },
    });
    const subnetId = ((await subnet.json()) as { id: string }).id;
    for (const last of [1, 2]) {
      await page.request.post('/api/v1/ipam/addresses', {
        headers,
        data: { subnetId, address: `172.16.${octet}.${last}`, usedBy: `Máy ${last}` },
      });
    }

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sắp hết hạn (30 ngày)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sự cố tuần qua' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Break-glass tuần qua' })).toBeVisible();
    // Ba khối thêm 28/08/2026 — màn ĐỌC nên phải chạy ở 390px như mọi khối khác (UX-DR2).
    await expect(page.getByRole('heading', { name: 'Dải mạng sắp đầy' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Két lâu chưa đổi' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vừa vào kho thanh lý' })).toBeVisible();
    await expect(page.getByText('100% · đã cấp 2/2 · còn 0')).toBeVisible();
    await expect(
      page.getByText('License có tên rất dài để thử tràn ngang trên điện thoại'),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
