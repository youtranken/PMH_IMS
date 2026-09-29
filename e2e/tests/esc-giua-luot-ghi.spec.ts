import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetIpam,
  resetUsers,
  sql,
  writeHeaders,
} from './helpers';

/**
 * ESC GIỮA LÚC ĐANG GHI KHÔNG ĐƯỢC ĐÓNG HỘP.
 *
 * ===== VÌ SAO ĐÂY LÀ LỖI, KHÔNG PHẢI CHUYỆN THẨM MỸ =====
 *
 * `Dialog` dùng chung đóng bằng Esc / bấm nền, và 12 hộp GHI của repo không truyền
 * `dismissible`. Nghĩa là bấm Esc lúc đang chờ server: hộp biến mất, nhưng lượt `fetch` vẫn
 * chạy tới cùng và vẫn ghi. Người dùng vừa đọc được đúng một tín hiệu — "hộp đóng rồi" — và
 * tín hiệu đó nói SAI về thứ vừa xảy ra với dữ liệu của họ.
 *
 * Nặng nhất là form NAT: nó POST TỪNG chip port một, nối tiếp. Esc ở giữa chuỗi đó không hủy
 * gì cả — vòng lặp chạy nốt và mở hết số port còn lại RA INTERNET, trong khi màn hình đã sạch
 * trơn và không còn chỗ nào nói cho người dùng biết chuyện đó.
 *
 * ===== CÁCH ĐO =====
 *
 * `page.route` giữ câu trả lời lại vài giây để dựng đúng khoảnh khắc "đang ghi" — không có nó
 * thì lượt ghi xong trước cả khi kịp bấm phím, và bài kiểm xanh mà không hỏi được gì. Đây là
 * cách đã dùng ở `loi-api-khong-hoa-thanh-rong.spec.ts`.
 */

test.beforeEach(() => {
  resetUsers();
  resetIpam();
  resetDevices();
  resetCatalog();
});

test.describe('Hộp thoại đang ghi thì không đóng bằng Esc', () => {
  test('Esc giữa lúc lưu dải: hộp Ở LẠI, và lượt ghi vẫn về đích', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const cidr = `172.20.${Number(stamp) % 200}.0/29`;
    const name = `LAN Esc E2E ${stamp}`;

    /*
     * Giữ câu trả lời 3 giây. Playwright chờ `route.fulfill`/`continue` nên đây là cách duy
     * nhất dựng lại khoảnh khắc "đang ghi" mà không dùng `sleep` ở phía test.
     */
    // `!` vì TS không theo được phép gán bên trong executor của Promise (nó thu hẹp về
    // `never` rồi báo "không gọi được"). Phép gán chạy đồng bộ, nên khẳng định này là thật.
    let released!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      released = resolve;
    });
    await page.route('**/api/v1/ipam/subnets', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await inFlight;
      return route.continue();
    });

    await page.goto('/ip-addresses');
    await page.getByRole('button', { name: 'Khai dải mới' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Dải' }).fill(cidr);
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill(name);
    await form.getByRole('button', { name: 'Lưu' }).click();

    // Nút đã chuyển sang trạng thái chờ → chắc chắn đang ở giữa lượt ghi.
    await expect(form.getByRole('button', { name: 'Đang tải…' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(
      form,
      'Esc giữa lúc ghi phải KHÔNG đóng hộp — đóng là nói dối về thứ vừa xảy ra',
    ).toBeVisible();

    // Bấm nền cũng vậy: cùng một lời nói dối, cửa khác.
    await page.mouse.click(5, 5);
    await expect(form).toBeVisible();

    released();
    await expect(form).toBeHidden();
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  });

  /**
   * VẾ ĐỐI CHỨNG, và là vế dễ hỏng nhất: `dismissible={!busy}` mà viết nhầm thành
   * `dismissible={false}` sẽ xanh ở bài trên và KHÓA CỨNG người dùng trong một hộp không đóng
   * được. Bài này là thứ duy nhất bắt được chuyện đó.
   */
  test('không ghi gì thì Esc vẫn đóng hộp như thường', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/ip-addresses');
    await page.getByRole('button', { name: 'Khai dải mới' }).click();

    const form = page.getByRole('dialog');
    await expect(form).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(form).toBeHidden();
  });

  /**
   * FORM NAT — CHỖ NẶNG NHẤT CỦA CẢ LỖI NÀY.
   *
   * Nó POST TỪNG chip port một, nối tiếp (luật chống chồng port phía API xét dòng đang có
   * trong DB, nên bắn song song thì hai chip chồng nhau cùng lọt). Esc ở giữa chuỗi đó không
   * hủy gì cả: vòng lặp chạy nốt và mở hết số port còn lại RA INTERNET, trong khi màn hình đã
   * sạch trơn và không còn chỗ nào nói cho người dùng biết.
   *
   * Đo bằng SỐ RULE TRONG DB, không bằng toast: thứ cần chứng minh là hậu quả ngoài đời.
   */
  test('form NAT nhiều port: Esc giữa chuỗi không đóng được hộp, và đủ port vào sổ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { routerCode, internalIp } = await setUpNat(page, stamp);

    // Giữ lượt POST đầu tiên lại — đúng khoảnh khắc "đã ghi một chip, còn hai chip nữa".
    let released!: () => void;
    const held = new Promise<void>((resolve) => {
      released = resolve;
    });
    let seen = 0;
    await page.route('**/api/v1/ipam/nat', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      seen += 1;
      if (seen === 1) await held;
      return route.continue();
    });

    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm luật NAT' }).click();
    const form = page.getByRole('dialog');
    await form.getByPlaceholder('Chọn hoặc gõ để lọc…').fill(routerCode);
    await page.getByRole('option', { name: new RegExp(routerCode) }).click();

    // Ba chip port = ba lượt POST nối tiếp.
    const ports = form.getByRole('textbox', { name: 'Cổng ngoài' });
    for (const port of ['18081', '18082', '18083']) {
      await ports.fill(port);
      await ports.press('Enter');
    }
    await form.getByRole('textbox', { name: 'IP trong' }).fill(internalIp);
    await form.getByRole('textbox', { name: 'Cổng trong' }).fill('80');
    await form.getByRole('combobox', { name: 'Mở cho ai' }).fill('Phòng Nhân sự');
    await form.getByRole('textbox', { name: 'Lý do mở' }).fill('kiem tra Esc giua luot ghi');

    const before = Number(sql('SELECT count(*) FROM nat_rule WHERE external_from BETWEEN 18081 AND 18083'));
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form.getByRole('button', { name: 'Đang tải…' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(
      form,
      'Esc giữa chuỗi POST phải KHÔNG đóng hộp — đóng là giấu mất việc còn hai port nữa sắp mở ra Internet',
    ).toBeVisible();

    released();
    await expect(form).toBeHidden();

    /*
     * Cả ba port đều vào sổ. Đây mới là câu chốt: chuỗi ghi KHÔNG hề dừng lại vì Esc, nên nếu
     * hộp đóng được thì người dùng đã tin là mình hủy trong khi ba port đã mở.
     */
    const after = Number(sql('SELECT count(*) FROM nat_rule WHERE external_from BETWEEN 18081 AND 18083'));
    expect(after - before).toBe(3);
  });
});

/** Router + dải + một IP trong — đủ để form NAT lưu được. Cùng khuôn với `nat.spec.ts`. */
async function setUpNat(
  page: Page,
  stamp: string,
): Promise<{ routerCode: string; internalIp: string }> {
  const headers = await writeHeaders(page);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const type =
    catalog.deviceTypes.find((t) => t.name === 'Firewall') ?? catalog.deviceTypes[0];

  const routerCode = `RT-E2E-ESC-${stamp}`;
  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: routerCode, name: 'Draytek thử Esc', deviceTypeId: type.id },
  });
  expect(device.status()).toBe(201);

  const octet = Number(stamp) % 200;
  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { cidr: `172.19.${octet}.0/29`, name: `LAN Esc NAT E2E ${stamp}` },
  });
  const subnetId = ((await subnet.json()) as { id: string }).id;
  const internalIp = `172.19.${octet}.5`;
  await page.request.post('/api/v1/ipam/addresses', {
    headers,
    data: { subnetId, address: internalIp, usedBy: 'Máy chấm công' },
  });

  return { routerCode, internalIp };
}
