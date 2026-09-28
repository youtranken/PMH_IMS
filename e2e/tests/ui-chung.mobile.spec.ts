import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetDevices,
  resetUsers,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Tài sản giao diện dùng chung ở 390px: thanh tab, hộp thoại (bottom sheet), chân hộp nhập
 * Excel, ô tick của hộp xác nhận. Mỗi thứ sửa MỘT chỗ trong `web/src/ui` / `web/src/css`, và
 * mọi màn dùng chung được lợi — nên bài kiểm bám vào một màn đại diện cho mỗi thứ.
 */

const VIEWPORT_WIDTH = 390;
const VIEWPORT_HEIGHT = 844;

test.beforeEach(() => {
  resetUsers();
  resetDevices();
});

async function createDevice(page: Page, code: string): Promise<string> {
  const headers = await writeHeaders(page);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
  const created = await page.request.post('/api/v1/devices', {
    headers,
    data: { code, name: 'Máy thử giao diện', deviceTypeId: pc.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

/** Hộp bao của phần tử nằm TRỌN trong bề ngang màn hình. */
async function expectInsideViewport(locator: Locator, what: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${what}: không có hộp bao`).not.toBeNull();
  expect(box!.x, `${what}: tràn mép trái`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${what}: tràn mép phải`).toBeLessThanOrEqual(VIEWPORT_WIDTH + 1);
}

test.describe('Thanh tab — tab đang chọn luôn nằm trong khung', () => {
  test('mở ?tab=history: tab "Lịch sử" sáng VÀ nhìn thấy, trang không bị kéo xuống', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const id = await createDevice(page, `PC-E2E-TAB-${uniqueStamp()}`);

    await page.goto(`/devices/${id}?tab=history`);
    const tab = page.getByRole('tab', { name: 'Lịch sử' });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expectInsideViewport(tab, 'tab Lịch sử');
    // Cuộn khung tab chứ không `scrollIntoView` cả trang.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('?tab= rác: rơi về tab đầu, tab đầu nằm trong khung', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const id = await createDevice(page, `PC-E2E-TAB-${uniqueStamp()}`);

    await page.goto(`/devices/${id}?tab=khong-co-tab-nay`);
    const tab = page.getByRole('tab', { name: 'Tổng quan' });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expectInsideViewport(tab, 'tab Tổng quan');
  });
});

test.describe('Hộp thoại trên điện thoại', () => {
  test('hộp nhập Excel: câu gợi ý hàng riêng, "Xác nhận ghi" không tràn và nằm dưới cùng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/catalog');
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Xác nhận ghi' });
    const check = dialog.getByRole('button', { name: 'Đối chiếu' });
    const hint = dialog.getByText('Bấm "Đối chiếu" trước để xem file sẽ ghi những gì.');

    await expect(hint).toBeVisible();
    await expectInsideViewport(confirm, 'nút Xác nhận ghi');
    await expectInsideViewport(hint, 'câu gợi ý');

    const [hintBox, checkBox, confirmBox] = await Promise.all([
      hint.boundingBox(),
      check.boundingBox(),
      confirm.boundingBox(),
    ]);
    // Câu gợi ý không bị bóp thành cột một chữ: rộng gần hết hộp và nằm TRÊN các nút.
    expect(hintBox!.width).toBeGreaterThan(VIEWPORT_WIDTH * 0.6);
    expect(hintBox!.y + hintBox!.height).toBeLessThanOrEqual(checkBox!.y + 1);
    // Nút chính dưới cùng, cao đủ ngón cái.
    expect(confirmBox!.y).toBeGreaterThan(checkBox!.y);
    expect(confirmBox!.height).toBeGreaterThanOrEqual(47);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('hộp ngắn là bottom sheet cao theo nội dung, không ép gần hết màn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const id = await createDevice(page, `PC-E2E-SHEET-${uniqueStamp()}`);
    await page.goto(`/devices/${id}`);
    await page.getByRole('button', { name: 'Thanh lý', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    // Bám đáy màn, không phủ kín từ mép trên.
    expect(box.y + box.height).toBeGreaterThanOrEqual(VIEWPORT_HEIGHT - 1);
    expect(box.height).toBeLessThan(VIEWPORT_HEIGHT * 0.9);
    const primary = dialog.getByRole('button', { name: 'Thanh lý' });
    await expectInsideViewport(primary, 'nút Thanh lý');
    expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(47);
  });

  test('ô tick "Dọn hết": câu hệ quả hiện ĐỦ trong hộp, không bị cắt', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const id = await createDevice(page, `PC-E2E-TICK-${uniqueStamp()}`);
    await page.goto(`/devices/${id}`);
    await page.getByRole('button', { name: 'Thanh lý', exact: true }).click();

    const dialog = page.getByRole('dialog');
    const hint = dialog.getByText(/Thu hồi IP, gỡ rule NAT và trả ghế license/);
    await expect(hint).toBeVisible();
    const [hintBox, dialogBox] = await Promise.all([hint.boundingBox(), dialog.boundingBox()]);
    expect(hintBox!.x + hintBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);
    // Không bị cắt: phần tử không rộng hơn phần nhìn thấy của nó.
    const clipped = await hint.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, 'câu hệ quả bị cắt ngang').toBe(false);
    // Câu hệ quả là MÔ TẢ của ô tick — trình đọc màn hình đọc nó kèm ô tick.
    await expect(
      dialog.getByRole('checkbox', { name: /Dọn hết thứ liên quan/ }),
    ).toHaveAccessibleDescription(/Thu hồi IP/);
  });
});
