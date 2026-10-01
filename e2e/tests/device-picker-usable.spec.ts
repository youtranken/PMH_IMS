import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetUsers,
  writeHeaders,
} from './helpers';

/**
 * Ô CHỌN THIẾT BỊ KHÔNG ĐƯỢC BÀY RA THỨ KHÔNG CHỌN ĐƯỢC.
 *
 * Đợt trước đã chặn GHI vào máy đã thanh lý ở bảy cửa (`assertUsable` + ba cửa nội bộ). Nhưng
 * sáu ô CHỌN vẫn liệt kê chúng — API `GET /devices?search=` không có cách nào lọc.
 *
 * Hậu quả không phải "xấu": người trực gõ tên máy, thấy nó trong danh sách, chọn, bấm Lưu,
 * rồi ăn một lỗi đỏ ở bước cuối. Hàng rào đúng nhưng đặt sai chỗ — nó chặn ở phút thứ ba
 * thay vì ở phút đầu. Và với người không biết máy đó đã thanh lý (đa số), thông báo lỗi là
 * lần đầu họ nghe tin đó.
 *
 * Nay `GET /devices?usable=true` bỏ máy `retired`. Không có cờ (⌘K, Kho thanh lý) thì máy đã
 * thanh lý vẫn phải ra. Màn DANH SÁCH ẩn chúng bằng bộ lọc trạng thái mặc định `status=live`
 * (Q-20), không bằng cờ này.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetCatalog();
});

async function typeIdFor(page: Page, name: string): Promise<string> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  return (catalog.deviceTypes.find((t) => t.name === name) ?? catalog.deviceTypes[0]).id;
}

async function search(page: Page, term: string, usable: boolean) {
  const q = `limit=20${usable ? '&usable=true' : ''}&search=${encodeURIComponent(term)}`;
  const res = await page.request.get(`/api/v1/devices?${q}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { items: { code: string }[] }).items.map((i) => i.code);
}

test.describe('Ô chọn thiết bị bỏ máy đã thanh lý', () => {
  test('usable=true bỏ máy retired; không có cờ thì vẫn liệt kê đủ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const typeId = await typeIdFor(page, 'PC');

    const codes = { live: `PC-E2E-UP-SONG-${stamp}`, dead: `PC-E2E-UP-CHET-${stamp}` };
    for (const code of Object.values(codes)) {
      const res = await page.request.post('/api/v1/devices', {
        headers: await writeHeaders(page),
        data: { code, name: `May ${code}`, deviceTypeId: typeId },
      });
      expect(res.status()).toBe(201);
    }
    const dead = await page.request.get(`/api/v1/devices?search=${codes.dead}`);
    const deadId = ((await dead.json()) as { items: { id: string }[] }).items[0].id;
    const retired = await page.request.patch(`/api/v1/devices/${deadId}/status`, {
      headers: await writeHeaders(page),
      data: { status: 'retired', cleanup: true },
    });
    expect(retired.status()).toBeLessThan(300);

    const forPicker = await search(page, `PC-E2E-UP-`, true);
    expect(forPicker, 'ô chọn chỉ được thấy máy còn dùng được').toContain(codes.live);
    expect(forPicker, 'máy đã thanh lý không được nằm trong ô chọn').not.toContain(codes.dead);

    /*
     * Vế đối chứng, và là vế quan trọng hơn: không truyền cờ (⌘K tìm theo đúng lượt gọi này)
     * thì vẫn phải thấy cả hai. Thiếu vế này thì một bản vá thô bạo (lọc `retired` ở tầng service, mọi nơi)
     * sẽ xanh ở trên mà làm biến mất cả Kho thanh lý.
     */
    const forList = await search(page, `PC-E2E-UP-`, false);
    expect(forList).toContain(codes.live);
    expect(forList, '⌘K vẫn phải tìm ra máy đã thanh lý').toContain(codes.dead);
  });

  test('lọc đích danh status=retired vẫn xem được — Kho thanh lý sống nhờ nó', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const res = await page.request.get('/api/v1/devices?limit=5&status=retired');
    expect(res.status(), 'cờ usable không được chồng lên bộ lọc status').toBe(200);
  });
});
