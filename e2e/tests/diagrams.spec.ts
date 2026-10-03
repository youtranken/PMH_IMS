import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  expireStepUp,
  fillOtp,
  firstLogin,
  freshTotpCode,
  resetDevices,
  resetDiagrams,
  resetUsers,
  rowAction,
  rowActionNames,
  sql,
  stepUpViaApi,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/*
 * Sơ đồ mạng (Q-23, AD-17, AD-18): cây bản vẽ không cần mã; nội dung bản vẽ đòi mã phạm vi sơ
 * đồ; mỗi lần lưu là một phiên bản có tóm tắt; khôi phục tạo phiên bản mới. Trình vẽ draw.io là
 * tệp tĩnh trong image `web` nên stack nào cũng có — bài lái iframe giữ ở mức khói, logic dồn về
 * `api/test/diagrams.spec.ts`.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetDiagrams();
});

const XML_EMPTY =
  '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="s1" value="Tầng 3 E2E" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="120" height="40" as="geometry"/></mxCell>' +
  '</root></mxGraphModel></diagram></mxfile>';
const SVG_SIMPLE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200px" height="80px" viewBox="-0.5 -0.5 200 80"><g data-cell-id="s1"><rect x="10" y="10" width="120" height="40"/><text x="20" y="35">Tầng 3 E2E</text></g></svg>';

async function createDiagram(page: Page, name: string, parentId?: string): Promise<string> {
  const res = await page.request.post('/api/v1/diagrams', {
    headers: await writeHeaders(page),
    data: { name, nodeType: parentId ? 'floor' : 'company', ...(parentId ? { parentId } : {}) },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function saveViaApi(page: Page, id: string, xml = XML_EMPTY, svg = SVG_SIMPLE) {
  return page.request.post(`/api/v1/diagrams/${id}/versions`, {
    headers: await writeHeaders(page),
    data: { xml, svg, basedOnVersionId: null },
    failOnStatusCode: false,
  });
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

function stepUpDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Xác nhận danh tính' });
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

/** Chèn một máy kho qua hộp "Thiết bị kho" trên thanh trên trình vẽ (Q-23). */
async function insertDevice(page: Page, code: string) {
  await page.getByRole('button', { name: 'Thiết bị kho' }).click();
  const box = page.getByRole('dialog', { name: 'Chèn thiết bị có trong kho' });
  await box.getByRole('searchbox', { name: 'Tìm thiết bị' }).fill(code);
  await box.getByRole('checkbox', { name: `Chọn ${code} để chèn` }).check();
  await box.getByRole('button', { name: 'Chèn 1 thiết bị' }).click();
  await expect(page.getByText(`Đã chèn ${code} vào bản vẽ.`)).toBeVisible();
  await expect(box).toHaveCount(0);
}

/**
 * Trình vẽ đã nhận lệnh nạp: nút "Thiết bị kho" bật. KHÔNG chờ nút Lưu — chờ nó là gắn bài vào
 * cách màn quyết định bật Lưu, không phải vào việc trình vẽ đã sẵn sàng.
 */
async function waitEditorReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Thiết bị kho' })).toBeEnabled({ timeout: 60_000 });
}

async function saveInEditor(page: Page, id: string): Promise<{ seq: number; summary: string }> {
  const [saved] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${id}/versions`) && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Lưu', exact: true }).click(),
  ]);
  expect(saved.status(), await saved.text()).toBe(201);
  return (await saved.json()) as { seq: number; summary: string };
}

test.describe('Sơ đồ mạng — cây bản vẽ, phiên bản, mã phạm vi sơ đồ', () => {
  test('SA tạo bản vẽ trên cây, mở (hỏi mã sơ đồ), vẽ + lưu hai phiên bản, xem tóm tắt, khôi phục', async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const requests = recordRequests(page);
    const stamp = uniqueStamp();
    const codeA = `SW-E2E-A${stamp}`;
    const codeB = `SW-E2E-B${stamp}`;
    await createSwitch(page, codeA);
    await createSwitch(page, codeB);
    const name = `E2E Tổng công ty ${stamp}`;

    // Cây: xem không cần mã; tạo gốc bằng giao diện.
    await page.goto('/diagrams');
    await expect(page.getByRole('heading', { level: 1, name: 'Sơ đồ mạng' })).toBeVisible();
    await page.getByRole('button', { name: 'Thêm bản vẽ' }).click();
    const form = page.getByRole('dialog', { name: 'Thêm bản vẽ' });
    await form.getByLabel('Tên bản vẽ').fill(name);
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText(`Đã tạo bản vẽ "${name}".`)).toBeVisible();
    const link = page.getByRole('link', { name });
    await expect(link).toBeVisible();
    await expect(page.getByText('Chưa vẽ').first()).toBeVisible();

    // Mở: nội dung hỏi mã PHẠM VI SƠ ĐỒ (mã đăng nhập không mở phạm vi nào — AD-17).
    await link.click();
    await expect(stepUpDialog(page)).toBeVisible();
    await expect(stepUpDialog(page).getByText('Mã này chỉ mở phần xem sơ đồ, không mở két.')).toBeVisible();
    await fillOtp(stepUpDialog(page), await freshTotpCode(secret));
    await expect(page.getByText('Bản vẽ chưa có nội dung')).toBeVisible();
    const id = new URL(page.url()).pathname.split('/').pop()!;

    // Sửa: vẽ (chèn máy kho qua cầu nối) rồi lưu → phiên bản #1 có tóm tắt.
    await page.getByRole('tab', { name: 'Sửa' }).click();
    await waitEditorReady(page);
    await expect(page.getByText(new RegExp(`${E2E_SA.email} · \\d{2}:\\d{2}`)).first()).toBeAttached();
    await insertDevice(page, codeA);
    const v1 = await saveInEditor(page, id);
    expect(v1).toMatchObject({ seq: 1, summary: 'Thêm 1 thiết bị' });
    await insertDevice(page, codeB);
    const v2 = await saveInEditor(page, id);
    expect(v2).toMatchObject({ seq: 2, summary: 'Thêm 1 thiết bị' });

    // Phiên bản: tóm tắt một dòng, khôi phục #1 tạo phiên bản #3.
    await page.getByRole('button', { name: 'Phiên bản' }).click();
    const versions = page.getByRole('dialog', { name: 'Phiên bản và lịch sử' });
    await expect(versions.getByText('Phiên bản #2')).toBeVisible();
    await expect(versions.getByText('Thêm 1 thiết bị').first()).toBeVisible();
    await versions.getByRole('button', { name: 'Khôi phục phiên bản #1' }).click();
    await page.getByRole('dialog', { name: 'Khôi phục phiên bản #1?' }).getByRole('button', { name: 'Khôi phục' }).click();
    await expect(page.getByText('Đã khôi phục thành phiên bản #3.')).toBeVisible();
    await expect(versions.getByText('khôi phục từ #1')).toBeVisible();
    await expect(versions.getByText(/^Khôi phục từ phiên bản #1 · Bỏ 1 thiết bị$/)).toBeVisible();
    await page.keyboard.press('Escape');

    // Xem: SVG đã làm sạch trong trình xem IMS (không nạp draw.io).
    await page.getByRole('tab', { name: 'Xem' }).click();
    const viewer = page.getByRole('region', { name: 'Bản vẽ, chỉ xem' });
    await expect(viewer.locator('svg').first()).toBeAttached();
    await expect(page.locator('iframe')).toHaveCount(0);

    // Mỗi lần tải nội dung một dòng nhật ký (NFR-03).
    expect(Number(sql(`SELECT count(*) FROM audit_log WHERE action = 'diagram.viewed' AND object_id = '${id}'`))).toBeGreaterThanOrEqual(3);
    // Cây hiện trạng thái bản nháp.
    await page.goto('/diagrams');
    await expect(page.getByRole('listitem').filter({ hasText: name }).getByText('Bản nháp')).toBeVisible();

    expect(outsideHost(requests, baseURL!)).toEqual([]);
  });

  test('vừa nhập mã cho KÉT, mở bản vẽ vẫn hỏi mã sơ đồ; trong ân hạn sơ đồ mở bản khác không hỏi lại; đóng hộp thì khoá', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const first = await createDiagram(page, `E2E Mã két ${uniqueStamp()}`);
    const second = await createDiagram(page, `E2E Bản thứ hai ${uniqueStamp()}`);
    await stepUpViaApi(page, secret, 'vault');

    await page.goto(`/diagrams/${first}`);
    await expect(stepUpDialog(page)).toBeVisible();
    // Đóng hộp = không mở; màn nói rõ cần mã và cho mở lại.
    await stepUpDialog(page).getByRole('button', { name: 'Hủy' }).click();
    await expect(page.getByText('Nội dung bản vẽ cần mã 2 lớp')).toBeVisible();
    await page.getByRole('button', { name: 'Nhập mã để mở' }).click();
    await fillOtp(stepUpDialog(page), await freshTotpCode(secret));
    await expect(page.getByText('Bản vẽ chưa có nội dung')).toBeVisible();

    await page.goto(`/diagrams/${second}`);
    await expect(page.getByText('Bản vẽ chưa có nội dung')).toBeVisible();
    await expect(stepUpDialog(page)).toHaveCount(0);
  });

  test('Thành viên vẽ được (tạo bản vẽ, lưu, đặt tên bản của mình); đổi tên / lưu trữ / khôi phục → 403, menu không bày', async ({ page }) => {
    const secret = await firstLogin(page, E2E_MEMBER);
    const name = `E2E Thành viên ${uniqueStamp()}`;
    const id = await createDiagram(page, name);
    // Sửa bản vẽ có sẵn cũng đòi mã sơ đồ (Q-23) — Thành viên cũng vậy.
    await stepUpViaApi(page, secret, 'diagram');
    const saved = await saveViaApi(page, id);
    expect(saved.status(), await saved.text()).toBe(201);
    const version = (await saved.json()) as { id: string };

    const headers = await writeHeaders(page);
    const rename = await page.request.patch(`/api/v1/diagrams/${id}`, { headers, data: { name: 'E2E đổi' }, failOnStatusCode: false });
    expect(rename.status()).toBe(403);
    const archive = await page.request.post(`/api/v1/diagrams/${id}/archive`, { headers, failOnStatusCode: false });
    expect(archive.status()).toBe(403);
    const restore = await page.request.post(`/api/v1/diagrams/${id}/versions/${version.id}/restore`, { headers, failOnStatusCode: false });
    expect(restore.status()).toBe(403);
    const label = await page.request.post(`/api/v1/diagrams/${id}/versions/${version.id}/label`, {
      headers,
      data: { label: 'Bản đầu E2E' },
    });
    expect(label.status()).toBe(201);

    await page.goto('/diagrams');
    expect(await rowActionNames(page, name)).toEqual(['Thêm bản vẽ con']);

    // Thành viên tạo được bản vẽ con qua giao diện.
    await rowAction(page, name, 'Thêm bản vẽ con');
    const form = page.getByRole('dialog', { name: `Thêm bản vẽ con vào "${name}"` });
    await form.getByLabel('Tên bản vẽ').fill(`E2E Tầng con ${uniqueStamp()}`);
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText(/Đã tạo bản vẽ "E2E Tầng con/)).toBeVisible();

    // Danh sách phiên bản lọc "chỉ có tên".
    await page.goto(`/diagrams/${id}`);
    await page.getByRole('button', { name: 'Phiên bản' }).click();
    const versions = page.getByRole('dialog', { name: 'Phiên bản và lịch sử' });
    await versions.getByLabel('Chỉ phiên bản có tên').check();
    await expect(versions.getByText('Bản đầu E2E')).toBeVisible();
    await expect(versions.getByRole('button', { name: 'Khôi phục phiên bản #1' })).toHaveCount(0);
  });

  test('đường hỏng: XML độc / quá trần bị từ chối, không phiên bản nào được ghi; không mã thì API nội dung 401', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const id = await createDiagram(page, `E2E Đường hỏng ${uniqueStamp()}`);

    const blocked = await page.request.get(`/api/v1/diagrams/${id}/content`, { failOnStatusCode: false });
    expect(blocked.status()).toBe(401);
    expect(await blocked.json()).toMatchObject({ code: 'STEPUP_REQUIRED', scope: 'diagram' });
    // Lưu (sửa bản vẽ có sẵn) cũng đòi mã sơ đồ: phiên bị chiếm không ghi đè được bản vẽ.
    const unsaved = await saveViaApi(page, id);
    expect(unsaved.status()).toBe(401);
    expect(await unsaved.json()).toMatchObject({ code: 'STEPUP_REQUIRED', scope: 'diagram' });

    await stepUpViaApi(page, secret, 'diagram');
    const evil = XML_EMPTY.replace('value="Tầng 3 E2E"', 'value="&lt;img src=x onerror=alert(document.cookie)&gt;" ');
    const rejected = await saveViaApi(page, id, evil);
    expect(rejected.status()).toBe(400);
    expect(((await rejected.json()) as { message: string }).message).toMatch(/Nhãn.*<img>/);

    const huge = XML_EMPTY.replace('Tầng 3 E2E', 'x'.repeat(2049 * 1024));
    const tooBig = await saveViaApi(page, id, huge);
    expect(tooBig.status()).toBe(400);
    expect(((await tooBig.json()) as { message: string }).message).toMatch(/vượt trần/);

    const evilSvg = await saveViaApi(page, id, XML_EMPTY, '<html><script>alert(1)</script></html>');
    expect(evilSvg.status()).toBe(400);

    const list = await page.request.get(`/api/v1/diagrams/${id}/versions`);
    expect(await list.json()).toEqual([]);
  });

  test('ân hạn sơ đồ hết giữa lúc vẽ: bấm Lưu → hỏi mã tại chỗ → nhập xong lưu được, không mất nét đang vẽ', async ({ page }) => {
    test.setTimeout(150_000);
    const secret = await firstLogin(page, E2E_SA);
    const code = `SW-E2E-HH${uniqueStamp()}`;
    await createSwitch(page, code);
    const id = await createDiagram(page, `E2E Hết ân hạn ${uniqueStamp()}`);
    await stepUpViaApi(page, secret, 'diagram');
    await page.goto(`/diagrams/${id}?mode=edit`);
    await waitEditorReady(page);
    await insertDevice(page, code);

    expireStepUp(E2E_SA.email);
    const [first] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${id}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(first.status()).toBe(401);
    await expect(stepUpDialog(page)).toBeVisible();
    await expect(stepUpDialog(page).getByText('Mã này chỉ mở phần xem sơ đồ, không mở két.')).toBeVisible();
    const [retried] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${id}/versions`) && r.request().method() === 'POST'),
      fillOtp(stepUpDialog(page), await freshTotpCode(secret)),
    ]);
    expect(retried.status(), await retried.text()).toBe(201);
    expect(retried.request().postData()).toBe(first.request().postData());
    expect(((await retried.json()) as { summary: string }).summary).toBe('Thêm 1 thiết bị');
    await expect(page.getByText('Đã lưu phiên bản #1: Thêm 1 thiết bị')).toBeVisible();
  });

  test('hai người cùng mở sửa: người sau thấy "Đang có … mở sửa"', async ({ browser, page }) => {
    test.setTimeout(150_000);
    const saSecret = await firstLogin(page, E2E_SA);
    const id = await createDiagram(page, `E2E Có mặt ${uniqueStamp()}`);
    await stepUpViaApi(page, saSecret, 'diagram');
    await page.goto(`/diagrams/${id}?mode=edit`);
    await waitEditorReady(page);

    const other = await (await browser.newContext()).newPage();
    const memberSecret = await firstLogin(other, E2E_MEMBER);
    await stepUpViaApi(other, memberSecret, 'diagram');
    await other.goto(`/diagrams/${id}?mode=edit`);
    await expect(other.getByText('Đang có E2E Super Admin mở sửa bản vẽ này.', { exact: false })).toBeVisible();
    await other.context().close();
  });

  test('bố cục (desktop): sidebar tự thu, trình vẽ chiếm phần còn lại, thanh trên có tab Xem/Sửa; rời màn thì sidebar mở lại', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const secret = await firstLogin(page, E2E_SA);
    const id = await createDiagram(page, `E2E Bố cục ${uniqueStamp()}`);
    await stepUpViaApi(page, secret, 'diagram');
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    const wide = (await nav.boundingBox())!.width;

    await page.goto(`/diagrams/${id}?mode=edit`);
    await expect(page.getByRole('tab', { name: 'Sửa' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Xem' })).toBeVisible();
    await expect(nav).toHaveAttribute('data-compact', 'true');
    const slim = (await nav.boundingBox())!.width;
    expect(slim).toBeLessThan(wide / 2);

    const frame = page.locator('iframe[title="Khung vẽ draw.io"]');
    await expect(frame).toBeVisible();
    const box = (await frame.boundingBox())!;
    // Bề ngang thật của khung nhìn (trừ thanh cuộn) — không giả định cỡ cửa sổ của project.
    const viewWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.x).toBeLessThanOrEqual(slim + 2);
    expect(box.x + box.width).toBeGreaterThanOrEqual(viewWidth - 2);

    await nav.getByRole('link', { name: 'Thiết bị', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Thiết bị' })).toBeVisible();
    await expect(nav).not.toHaveAttribute('data-compact', 'true');
    expect((await nav.boundingBox())!.width).toBeGreaterThan(wide - 2);
  });

  test('390px: cây đọc được, trình xem hiện bản vẽ; màn sửa báo "chỉ làm trên máy tính" kèm lối sang xem', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const secret = await firstLogin(page, E2E_SA);
    const name = `E2E Điện thoại ${uniqueStamp()}`;
    const id = await createDiagram(page, name);
    await stepUpViaApi(page, secret, 'diagram');
    expect((await saveViaApi(page, id)).status()).toBe(201);

    await page.goto('/diagrams');
    await expect(page.getByRole('link', { name })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);

    await page.goto(`/diagrams/${id}`);
    const viewer = page.getByRole('region', { name: 'Bản vẽ, chỉ xem' });
    await expect(viewer.getByText('Tầng 3 E2E')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Phóng to' })).toBeVisible();

    await page.getByRole('tab', { name: 'Sửa' }).click();
    await expect(page.getByText('Sửa sơ đồ chỉ làm trên máy tính')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await page.getByRole('button', { name: 'Sang chế độ xem' }).click();
    await expect(viewer.getByText('Tầng 3 E2E')).toBeVisible();
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
});
