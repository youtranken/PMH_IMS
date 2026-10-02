import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  resetDevices,
  resetDiagrams,
  resetUsers,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/*
 * Bản thử nhúng draw.io (Q-23). draw.io là service riêng (`drawio` trong compose); stack nào không
 * dựng nó thì bài đường-hạnh-phúc TỰ BỎ QUA và nói rõ vì sao, thay vì đỏ vì một thứ không thuộc
 * bản build đang kiểm. Bài quyền thì không cần draw.io nên luôn chạy.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetDiagrams();
});

async function drawioUp(page: Page): Promise<boolean> {
  const res = await page.request.get('/drawio/', { failOnStatusCode: false });
  return res.status() === 200;
}

async function createSwitch(page: Page, code: string): Promise<string> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const type = catalog.deviceTypes.find((t) => t.name === 'Switch')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { code, name: 'Switch sơ đồ E2E', deviceTypeId: type.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

test.describe('Sơ đồ mạng (bản thử draw.io)', () => {
  test('SA chèn máy từ kho vào bản vẽ, lưu, mở lại, và bấm hình ở chế độ xem ra thẻ thiết bị', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    test.skip(!(await drawioUp(page)), 'Service drawio không chạy trên stack này (xem RUNBOOK, mục draw.io).');

    const stamp = uniqueStamp();
    const code = `SW-E2E-${stamp}`;
    const deviceId = await createSwitch(page, code);

    await page.goto(`/diagrams-spike?ten=E2E-${stamp}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Sơ đồ mạng (bản thử)' })).toBeVisible();
    const editor = page.frameLocator('iframe[title="Khung vẽ draw.io"]');
    // Khung báo `load` thì nút Lưu mới bật — đó là dấu giao thức nhúng đã bắt tay xong.
    await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toBeEnabled({ timeout: 60_000 });

    await page.getByRole('combobox', { name: 'Chọn thiết bị' }).fill(code);
    await page.getByRole('option', { name: new RegExp(code) }).click();
    await page.getByRole('button', { name: 'Chèn vào bản vẽ' }).click();
    await expect(page.getByText(`Đã chèn ${code} vào bản vẽ.`)).toBeVisible();
    await expect(editor.getByText(code).first()).toBeVisible();

    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/v1/diagram-spike/E2E-${stamp}`) && r.request().method() === 'PUT'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status()).toBe(200);
    expect(((await saved.json()) as { xml: string }).xml).toContain(`ims_device_id="${deviceId}"`);

    // Mở lại: bản đã lưu nạp vào khung sửa.
    await page.reload();
    await expect(page.frameLocator('iframe[title="Khung vẽ draw.io"]').getByText(code).first()).toBeVisible({
      timeout: 60_000,
    });

    // Chế độ xem: máy còn khớp kho; bấm hình trong bản vẽ → thẻ có link về hồ sơ.
    await page.getByRole('tab', { name: 'Chế độ xem' }).click();
    await expect(page.getByText('Khớp kho')).toBeVisible();
    await page.frameLocator('iframe[title="Bản vẽ, chỉ xem"]').getByText(code).first().click({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: 'Mở hồ sơ thiết bị' })).toHaveAttribute('href', `/devices/${deviceId}`);
  });

  test('đường hỏng: Thành viên không vào được màn lẫn API; XML không phải draw.io bị từ chối', async ({ page, browser }) => {
    await firstLogin(page, E2E_SA);
    const bad = await page.request.put('/api/v1/diagram-spike/E2E-sai', {
      headers: await writeHeaders(page),
      data: { xml: '<html><script>alert(1)</script></html>' },
    });
    expect(bad.status()).toBe(400);

    const member = await browser.newPage();
    await firstLogin(member, E2E_MEMBER);
    await member.goto('/diagrams-spike');
    await expect(member.getByRole('heading', { name: 'Bạn không có quyền xem trang này' })).toBeVisible();
    const read = await member.request.get('/api/v1/diagram-spike/chinh', { failOnStatusCode: false });
    expect(read.status()).toBe(403);
    const write = await member.request.put('/api/v1/diagram-spike/E2E-member', {
      headers: await writeHeaders(member),
      data: { xml: '<mxfile></mxfile>' },
      failOnStatusCode: false,
    });
    expect(write.status()).toBe(403);
    await member.close();
  });
});
