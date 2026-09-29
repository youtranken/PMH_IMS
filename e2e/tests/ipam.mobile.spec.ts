import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetDevices,
  resetIpam,
  resetUsers,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetIpam();
  resetDevices();
});

/**
 * UX-DR2 — danh sách dải và bảng IP là màn ĐỌC. Cảnh dùng thật: đứng ở tủ mạng, cầm điện
 * thoại, cần biết "IP này của ai" hoặc "còn chỗ trống nào".
 */
test.describe('Địa chỉ IP ở 390px', () => {
  test('danh sách dải và bảng IP đọc được, không tràn ngang', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.16.${octet}.0/29`, name: `LAN 390 E2E ${stamp}` },
    });
    const subnetId = ((await subnet.json()) as { id: string }).id;
    await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: {
        subnetId,
        address: `172.16.${octet}.1`,
        usedBy: 'Chị Lan — Phòng Kế toán tầng 3',
      },
    });

    await page.goto(`/ip-addresses/${subnetId}`);
    // Điện thoại: MỘT ô chọn dải thay cho dãy thẻ cuộn ngang, và thẻ của dải đang chọn ngay dưới.
    await expect(page.getByRole('button', { name: 'Chọn dải mạng' })).toContainText(
      `172.16.${octet}.0/29`,
    );
    await expect(
      page.getByRole('link', { name: new RegExp(`LAN 390 E2E ${stamp}`) }),
    ).toBeVisible();
    // Thanh mức sử dụng phải co được, không đẩy bảng rộng ra.
    //
    // Bám vào ĐÚNG dải vừa tạo, không phải "cái thanh đo duy nhất trên màn": danh sách này
    // hiện mọi dải đang có, nên chỉ cần trong DB dev còn một dải nào khác là bài kiểm vỡ vì
    // lý do chẳng liên quan gì tới thứ nó muốn kiểm.
    await expect(
      page.getByRole('meter', { name: `Mức sử dụng dải 172.16.${octet}.0/29` }),
    ).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await page.goto(`/ip-addresses/${subnetId}`);
    await expect(page.getByText('Chị Lan — Phòng Kế toán tầng 3')).toBeVisible();
    await expect(page.getByText(`172.16.${octet}.1`)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  /**
   * G-11 — AC nói thẳng "panel pass 390px".
   *
   * Đây là cảnh dùng thật của cả mảng IP: đứng trước tủ mạng, mở trang con switch trên điện
   * thoại, cần biết ngay nó đang giữ IP nào.
   */
  test('panel IP trên trang thiết bị đọc được ở 390px', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = (Number(stamp) % 200) + 20;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const type = catalog.deviceTypes.find((t) => t.name === 'Switch')!;
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: `SW-E2E-390-${stamp}`, name: 'Switch tầng 3', deviceTypeId: type.id },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.17.${octet}.0/29`, name: `LAN panel E2E ${stamp}` },
    });
    const subnetId = ((await subnet.json()) as { id: string }).id;
    await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: {
        subnetId,
        address: `172.17.${octet}.1`,
        deviceId,
        usedBy: 'cổng quản trị switch tầng 3',
      },
    });

    await page.goto(`/devices/${deviceId}`);
    await expect(page.getByRole('heading', { name: 'Địa chỉ IP' })).toBeVisible();
    // Hỏi trong KHU "Địa chỉ IP" — ở 390px bản đồ quan hệ ẩn đi, nhưng bản danh sách thay thế
    // của nó vẫn nằm trong DOM và vẫn mang đúng chuỗi này.
    const khuIp = page.getByRole('region', { name: 'Địa chỉ IP' });
    await expect(khuIp.getByText(`172.17.${octet}.1`)).toBeVisible();
    await expect(khuIp.getByText('cổng quản trị switch tầng 3')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

