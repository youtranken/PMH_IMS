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
    await expect(page.getByRole('heading', { name: 'Hạn cần xử lý' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sự cố tuần qua' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Yêu cầu mở két tuần qua' })).toBeVisible();
    // Ba khối này cũng thuộc màn ĐỌC nên phải chạy ở 390px như mọi khối khác (UX-DR2).
    await expect(page.getByRole('heading', { name: /^Dải mạng ≥ \d+%$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Két lâu chưa đổi' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vừa vào kho thanh lý' })).toBeVisible();
    /* DASH-010: ở 390px mỗi khối chỉ bày 3 mục đầu + "Xem thêm N" bung tại chỗ. Dữ liệu bài
       khác để lại có thể đẩy mục của bài này xuống dưới mốc 3 — bung ra rồi mới tìm. */
    const subnets = page.locator('section').filter({ hasText: /Dải mạng ≥ \d+%/ });
    const moreSubnets = subnets.getByRole('button', { name: /^Xem thêm \d+$/ });
    if (await moreSubnets.count()) await moreSubnets.click();
    await expect(page.getByText('100% · đã cấp 2/2 · còn 0')).toBeVisible();
    /* DASH-002: ở 390px khối hạn thành thẻ gọn, không phải bảng cuộn ngang — và nút Gia hạn
       vẫn còn trên thẻ. */
    const expiring = page.locator('section').filter({ hasText: 'Hạn cần xử lý' });
    const moreExpiring = expiring.getByRole('button', { name: /^Xem thêm \d+$/ });
    if (await moreExpiring.count()) await moreExpiring.click();
    await expect(
      page.getByText('License có tên rất dài để thử tràn ngang trên điện thoại'),
    ).toBeVisible();
    await expect(expiring.getByRole('columnheader')).toHaveCount(0);
    const card = expiring
      .getByRole('listitem')
      .filter({ hasText: 'License có tên rất dài để thử tràn ngang trên điện thoại' });
    await expect(card.getByRole('button', { name: 'Gia hạn', exact: true })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
