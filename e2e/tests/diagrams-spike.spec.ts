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
 * Màn sơ đồ (bản thử) trên cầu nối `ui/drawio-frame` — draw.io là tệp tĩnh trong image `web`
 * (AD-17), nên stack nào cũng có trình vẽ; bài không tự bỏ qua nữa.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetDiagrams();
});

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

/** Ghi mọi request của trang (kể cả của iframe draw.io) để khẳng định không gì ra ngoài host IMS. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

function outsideHost(urls: string[], baseURL: string): string[] {
  const origin = new URL(baseURL).origin;
  return urls.filter((url) => !url.startsWith(`${origin}/`) && !url.startsWith('data:') && !url.startsWith('blob:'));
}

test.describe('Sơ đồ mạng (bản thử draw.io)', () => {
  test('SA chèn máy từ kho vào bản vẽ, lưu, mở lại, và bấm hình ở chế độ xem ra thẻ thiết bị', async ({ page, baseURL }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const requests = recordRequests(page);

    const stamp = uniqueStamp();
    const code = `SW-E2E-${stamp}`;
    const deviceId = await createSwitch(page, code);

    await page.goto(`/diagrams-spike?ten=E2E-${stamp}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Sơ đồ mạng (bản thử)' })).toBeVisible();
    const editor = page.frameLocator('iframe[title="Khung vẽ draw.io"]');
    // Khung báo `load` thì nút Lưu mới bật — đó là dấu giao thức nhúng đã bắt tay xong.
    await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toBeEnabled({ timeout: 60_000 });
    // Watermark người xem phủ lên khung (AD-17).
    await expect(page.getByText(new RegExp(`${E2E_SA.email} · \\d{2}:\\d{2}`)).first()).toBeAttached();

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
    await page.getByRole('tab', { name: 'Xem' }).click();
    await page.getByRole('button', { name: /Thiết bị trên bản vẽ \(1\)/ }).click();
    await expect(page.getByRole('dialog').getByText('Khớp kho')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.frameLocator('iframe[title="Bản vẽ, chỉ xem"]').getByText(code).first().click({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: 'Mở hồ sơ thiết bị' })).toHaveAttribute('href', `/devices/${deviceId}`);

    // Trình vẽ chạy offline: không request nào của màn (cả trong iframe) ra ngoài host IMS.
    expect(outsideHost(requests, baseURL!)).toEqual([]);
  });

  test('bố cục (desktop): sidebar tự thu, trình vẽ chiếm phần còn lại, thanh trên có tab Sửa/Xem; rời màn thì sidebar mở lại', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await firstLogin(page, E2E_SA);
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    const wide = (await nav.boundingBox())!.width;

    await page.goto(`/diagrams-spike?ten=E2E-bo-cuc-${uniqueStamp()}`);
    await expect(page.getByRole('tab', { name: 'Sửa' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Xem' })).toBeVisible();
    await expect(nav).toHaveAttribute('data-compact', 'true');
    const slim = (await nav.boundingBox())!.width;
    expect(slim).toBeLessThan(wide / 2);

    // Không cột panel bên cạnh: khung vẽ rộng bằng toàn bộ phần bên phải sidebar.
    const frame = page.locator('iframe[title="Khung vẽ draw.io"]');
    await expect(frame).toBeVisible();
    const box = (await frame.boundingBox())!;
    expect(box.x).toBeLessThanOrEqual(slim + 2);
    expect(box.x + box.width).toBeGreaterThanOrEqual(1440 - 2);

    await nav.getByRole('link', { name: 'Thiết bị', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Thiết bị' })).toBeVisible();
    await expect(nav).not.toHaveAttribute('data-compact', 'true');
    expect((await nav.boundingBox())!.width).toBeGreaterThan(wide - 2);
  });

  test('đường hỏng: nhãn <img onerror> gửi thẳng qua API bị từ chối; XML không phải draw.io bị từ chối', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const evil =
      '<mxfile><diagram id="p1" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="x" value="&lt;img src=x onerror=alert(document.cookie)&gt;" style="html=1;" vertex="1" parent="1"/>' +
      '</root></mxGraphModel></diagram></mxfile>';
    const rejected = await page.request.put('/api/v1/diagram-spike/E2E-doc', {
      headers: await writeHeaders(page),
      data: { xml: evil },
      failOnStatusCode: false,
    });
    expect(rejected.status()).toBe(400);
    expect(((await rejected.json()) as { message: string }).message).toMatch(/Nhãn.*<img>/);
    const after = await page.request.get('/api/v1/diagram-spike/E2E-doc');
    expect(((await after.json()) as { xml: string | null }).xml).toBeNull();

    const bad = await page.request.put('/api/v1/diagram-spike/E2E-sai', {
      headers: await writeHeaders(page),
      data: { xml: '<html><script>alert(1)</script></html>' },
      failOnStatusCode: false,
    });
    expect(bad.status()).toBe(400);
  });

  test('draw.io tự host: chỉ tệp tĩnh, servlet không tồn tại, header khoá hộp cát', async ({ page }) => {
    const ok = await page.request.get('/drawio/');
    expect(ok.status()).toBe(200);
    const csp = ok.headers()['content-security-policy'] ?? '';
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toMatch(/allow-same-origin|allow-downloads|allow-modals|allow-popups/);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    for (const path of ['/drawio/proxy?url=http://169.254.169.254/', '/drawio/export', '/drawio/log', '/drawio/service-worker.js', '/drawio/open.html']) {
      const res = await page.request.get(path, { failOnStatusCode: false });
      expect([path, res.status()]).toEqual([path, 404]);
    }
    const post = await page.request.post('/drawio/js/app.min.js', { failOnStatusCode: false });
    expect(post.status()).toBe(403);

    const spa = await page.request.get('/');
    const spaCsp = spa.headers()['content-security-policy'] ?? '';
    expect(spaCsp).toContain("frame-src 'self'");
    expect(spaCsp).toContain("frame-ancestors 'none'");
  });

  test('Thành viên cũng vẽ (Q-23): vào được màn và đọc được bản vẽ', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    await page.goto('/diagrams-spike?ten=E2E-member');
    await expect(page.getByRole('heading', { level: 1, name: 'Sơ đồ mạng (bản thử)' })).toBeVisible();
    const read = await page.request.get('/api/v1/diagram-spike/E2E-member');
    expect(read.status()).toBe(200);
    const settings = await page.request.get('/api/v1/diagrams/editor-settings');
    expect(((await settings.json()) as { initTimeoutSeconds: number }).initTimeoutSeconds).toBeGreaterThan(0);
  });
});
