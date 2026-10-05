import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  expireStepUp,
  firstLogin,
  resetDiagrams,
  resetUsers,
  sql,
  stepUpViaApi,
  switchTheme,
  uniqueStamp,
  writeHeaders,
  diagramBarAction,
} from './helpers';

/*
 * Xuất PNG/PDF (FR-044), so sánh hai phiên bản và thanh trượt thời gian (Q-23). Logic thuần
 * (ghép chân trang, so ô, chọn bản chính thức theo ngày) có bài bảng dữ liệu ở api/web; hàm
 * service có bài DB ở `api/test/diagram-export.spec.ts`. Bài này kiểm luồng thật: file tải về
 * thật, hỏi mã khi hết ân hạn, màu so sánh ở cả hai theme, ngày trên thanh trượt theo giờ VN.
 * Không lái trình vẽ draw.io: nội dung lưu bằng API, mọi thao tác ở chế độ Xem.
 */

test.beforeEach(() => {
  resetUsers();
  resetDiagrams();
});

function svgOf(cells: { id: string; x: number; label: string }[]): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="520px" height="200px" viewBox="-0.5 -0.5 520 200">' +
    cells.map((c) => `<g data-cell-id="${c.id}"><rect x="${c.x}" y="10" width="100" height="40"/><text x="${c.x + 8}" y="35">${c.label}</text></g>`).join('') +
    '</svg>'
  );
}

function xmlOf(cells: { id: string; x: number; label: string }[]): string {
  return (
    '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    cells.map((c) => `<mxCell id="${c.id}" value="${c.label}" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="${c.x}" y="10" width="100" height="40" as="geometry"/></mxCell>`).join('') +
    '</root></mxGraphModel></diagram></mxfile>'
  );
}

const V1 = [
  { id: 's1', x: 10, label: 'Core E2E' },
  { id: 's2', x: 140, label: 'Bỏ E2E' },
];
const V2 = [
  { id: 's1', x: 60, label: 'Core E2E' },
  { id: 's3', x: 300, label: 'Mới E2E' },
];

async function createDiagram(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/v1/diagrams', { headers: await writeHeaders(page), data: { name, nodeType: 'floor' } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function save(page: Page, id: string, cells: typeof V1, basedOnVersionId: string | null = null): Promise<{ id: string; seq: number }> {
  const res = await page.request.post(`/api/v1/diagrams/${id}/versions`, {
    headers: await writeHeaders(page),
    data: { xml: xmlOf(cells), svg: svgOf(cells), basedOnVersionId },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; seq: number };
}

async function publish(page: Page, id: string, versionId: string): Promise<void> {
  const res = await page.request.post(`/api/v1/diagrams/${id}/publish`, { headers: await writeHeaders(page), data: { versionId } });
  expect(res.status(), await res.text()).toBeLessThan(300);
}

function exportedCount(id: string): number {
  return Number(sql(`SELECT count(*) FROM audit_log WHERE object_id = '${id}' AND action = 'diagram.exported'`));
}

function footerOf(headers: Record<string, string>): string {
  return decodeURIComponent(headers['x-diagram-export-footer'] ?? '');
}

/** "dd/mm/yyyy" theo giờ Việt Nam của một mốc. */
function vnDate(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(at);
  return parts;
}

async function exportVia(page: Page, format: 'PNG' | 'PDF') {
  await diagramBarAction(page, 'Xuất');
  const [download, response] = await Promise.all([
    page.waitForEvent('download'),
    page.waitForResponse((r) => r.url().includes('/exports') && r.request().method() === 'POST' && r.status() === 200),
    page.getByRole('button', { name: `Xuất ${format}` }).click(),
  ]);
  return { download, response };
}

test.describe('Sơ đồ mạng — xuất PNG/PDF', () => {
  test('Thành viên xuất PNG bản nháp và PDF bản chính thức: file thật, chân trang server ghép, mỗi lượt một dòng nhật ký', async ({ browser, page }) => {
    test.setTimeout(180_000);
    const stamp = uniqueStamp();
    const name = `E2E Xuất ${stamp}`;
    const saSecret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, saSecret, 'diagram');
    const id = await createDiagram(page, name);
    const v1 = await save(page, id, V1);

    const member = await (await browser.newContext({ acceptDownloads: true })).newPage();
    const memberSecret = await firstLogin(member, E2E_MEMBER);
    await stepUpViaApi(member, memberSecret, 'diagram');
    await member.goto(`/diagrams/${id}`);
    await expect(member.getByRole('region', { name: 'Bản vẽ, chỉ xem' })).toBeVisible();

    // Bản nháp → PNG có dải "BẢN NHÁP"; chân trang nêu tên bản vẽ, phiên bản, người xuất.
    const png = await exportVia(member, 'PNG');
    expect(png.response.headers()['content-type']).toBe('image/png');
    expect(png.response.headers()['x-diagram-export-status']).toBe('draft');
    const pngFooter = footerOf(png.response.headers());
    expect(pngFooter).toContain(name);
    expect(pngFooter).toContain('Phiên bản #1 · Bản nháp — chưa duyệt');
    expect(pngFooter).toContain(`<${E2E_MEMBER.email}>`);
    expect(png.download.suggestedFilename()).toBe(`${name} - v1.png`);
    const pngBytes = readFileSync((await png.download.path())!);
    expect(pngBytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(pngBytes.length).toBeGreaterThan(5_000);
    expect(exportedCount(id)).toBe(1);

    // SA phát hành → Thành viên xuất PDF: trạng thái chính thức, có người duyệt.
    await publish(page, id, v1.id);
    await member.reload();
    await expect(member.getByRole('region', { name: 'Bản vẽ, chỉ xem' })).toBeVisible();
    const pdf = await exportVia(member, 'PDF');
    expect(pdf.response.headers()['content-type']).toBe('application/pdf');
    expect(pdf.response.headers()['x-diagram-export-status']).toBe('official');
    expect(footerOf(pdf.response.headers())).toMatch(/Phiên bản #1 · Chính thức · Duyệt \d\d\/\d\d\/\d{4} \d\d:\d\d bởi /);
    const pdfBytes = readFileSync((await pdf.download.path())!);
    expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdfBytes.length).toBeGreaterThan(5_000);
    expect(exportedCount(id)).toBe(2);
    expect(sql(`SELECT detail->>'format' FROM audit_log WHERE object_id = '${id}' AND action = 'diagram.exported' ORDER BY created_at`).split('\n')).toEqual(['png', 'pdf']);
  });

  test('chưa nhập mã sơ đồ: API xuất → 401 phạm vi sơ đồ; hết ân hạn trên màn → hỏi mã, huỷ thì không có file, không có dòng nhật ký', async ({ page }) => {
    const stamp = uniqueStamp();
    const secret = await firstLogin(page, E2E_SA);
    // Chỉ cây (không cần mã): tạo nút; nội dung lưu sau khi có mã.
    await stepUpViaApi(page, secret, 'diagram');
    const id = await createDiagram(page, `E2E Xuất khoá ${stamp}`);
    const v1 = await save(page, id, V1);
    expireStepUp(E2E_SA.email);

    const direct = await page.request.post(`/api/v1/diagrams/${id}/versions/${v1.id}/exports`, {
      headers: await writeHeaders(page),
      data: { format: 'png' },
      failOnStatusCode: false,
    });
    expect(direct.status()).toBe(401);
    expect(await direct.json()).toMatchObject({ code: 'STEPUP_REQUIRED', scope: 'diagram' });

    // Mở màn (nhập mã để xem), rồi để ân hạn hết giữa chừng và bấm xuất.
    await page.goto(`/diagrams/${id}`);
    const unlock = page.getByRole('dialog', { name: 'Xác nhận danh tính' });
    await expect(unlock).toBeVisible();
    await stepUpViaApi(page, secret, 'diagram');
    await unlock.getByRole('button', { name: 'Hủy' }).click();
    await page.getByRole('button', { name: 'Nhập mã để mở' }).click();
    await expect(page.getByRole('region', { name: 'Bản vẽ, chỉ xem' })).toBeVisible();
    expireStepUp(E2E_SA.email);
    await diagramBarAction(page, 'Xuất');
    await page.getByRole('button', { name: 'Xuất PNG' }).click();
    const ask = page.getByRole('dialog', { name: 'Xác nhận danh tính' });
    await expect(ask).toContainText(`Nhập mã 6 số để xuất bản vẽ "E2E Xuất khoá ${stamp}".`);
    await ask.getByRole('button', { name: 'Hủy' }).click();
    await expect(ask).toHaveCount(0);
    expect(exportedCount(id)).toBe(0);
  });

  test('bản trình bày và bản cũ: dải trên file xuất nêu bản chính thức đã chép / bản hiện hành', async ({ page }) => {
    const stamp = uniqueStamp();
    const secret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, secret, 'diagram');
    const id = await createDiagram(page, `E2E Xuất dải ${stamp}`);
    const v1 = await save(page, id, V1);
    await publish(page, id, v1.id);
    const created = await page.request.post(`/api/v1/diagrams/${id}/presentations`, { headers: await writeHeaders(page), data: {} });
    expect(created.status(), await created.text()).toBe(201);
    const presId = ((await created.json()) as { id: string }).id;
    const presVersion = sql(`SELECT id FROM diagram_version WHERE diagram_id = '${presId}'`);
    const v2 = await save(page, id, V2, v1.id);
    await publish(page, id, v2.id);

    const bandOf = async (diagramId: string, versionId: string) => {
      const res = await page.request.post(`/api/v1/diagrams/${diagramId}/versions/${versionId}/exports`, {
        headers: await writeHeaders(page),
        data: { format: 'png' },
      });
      expect(res.status(), await res.text()).toBe(200);
      return decodeURIComponent(res.headers()['x-diagram-export-band'] ?? '');
    };
    expect(await bandOf(presId, presVersion)).toBe('BẢN TRÌNH BÀY — không phải sơ đồ chính thức\nDựa trên bản chính thức phiên bản 1');
    expect(await bandOf(id, v1.id)).toBe('BẢN CŨ — không còn hiệu lực\nBản chính thức hiện hành là phiên bản #2');
    expect(await bandOf(id, v2.id)).toBe('');
  });
});

test.describe('Sơ đồ mạng — so sánh phiên bản', () => {
  test('chọn hai phiên bản → tô thêm/đổi, khung đứt ô bỏ, chú giải + bộ đếm; màu khác nhau ở sáng và tối; ghi diagram.viewed', async ({ page }) => {
    const stamp = uniqueStamp();
    const secret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, secret, 'diagram');
    const id = await createDiagram(page, `E2E So sánh ${stamp}`);
    const v1 = await save(page, id, V1);
    const v2 = await save(page, id, V2, v1.id);

    await switchTheme(page, 'light');
    await page.goto(`/diagrams/${id}`);
    await expect(page.getByRole('region', { name: 'Bản vẽ, chỉ xem' })).toBeVisible();
    await diagramBarAction(page, 'Phiên bản');
    const box = page.getByRole('dialog', { name: 'Phiên bản và lịch sử' });
    await box.getByRole('checkbox', { name: 'Chọn phiên bản #2 để so sánh' }).check();
    await box.getByRole('checkbox', { name: 'Chọn phiên bản #1 để so sánh' }).check();
    await box.getByRole('button', { name: 'So sánh (2/2)' }).click();

    const viewer = page.getByRole('region', { name: 'Bản vẽ, so sánh hai phiên bản' });
    await expect(viewer).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`version=${v2.id}&compare=${v1.id}`));
    await expect(page.getByText('So sánh phiên bản #1 → #2')).toBeVisible();
    const legend = viewer.getByRole('group', { name: 'Chú giải so sánh' });
    await expect(legend).toContainText('Thêm 1');
    await expect(legend).toContainText('Bỏ 1');
    await expect(legend).toContainText('Đổi 1');
    await expect(viewer.getByRole('img', { name: 'Đã bỏ: Bỏ E2E' })).toBeVisible();

    /*
     * Ô của ảnh SVG không có tên trợ năng (hình tự do): đọc dấu + màu thật qua `data-cell-id` của
     * draw.io trong trình xem — đây là hợp đồng của trình xem (AD-17), không phải lớp CSS.
     */
    const cellState = (cellId: string) =>
      viewer.evaluate((root, wanted) => {
        const el = Array.from(root.querySelectorAll('[data-cell-id]')).find((e) => e.getAttribute('data-cell-id') === wanted);
        return el ? { mark: el.getAttribute('data-ims-diff'), filter: getComputedStyle(el).filter } : null;
      }, cellId);
    await expect.poll(async () => (await cellState('s3'))?.mark).toBe('added');
    expect((await cellState('s1'))?.mark).toBe('changed');
    expect((await cellState('s1'))?.filter).toBeTruthy();
    const filters = async () => ({ added: (await cellState('s3'))!.filter, changed: (await cellState('s1'))!.filter });
    const light = await filters();
    expect(light.added).toContain('drop-shadow');
    expect(light.added).not.toBe(light.changed);
    await switchTheme(page, 'dark');
    const dark = await filters();
    expect(dark.added).toContain('drop-shadow');
    expect(dark.added).not.toBe(light.added);

    expect(Number(sql(`SELECT count(*) FROM audit_log WHERE object_id = '${id}' AND action = 'diagram.viewed' AND detail->>'mode' = 'compare'`))).toBe(1);
    await page.getByRole('button', { name: 'Thoát so sánh' }).click();
    await expect(page.getByRole('region', { name: 'Bản vẽ, chỉ xem' })).toBeVisible();
    await switchTheme(page, 'light');
  });

  test('390px: trình xem so sánh đọc được, chú giải hiện, không cuộn ngang', async ({ page }) => {
    const stamp = uniqueStamp();
    const secret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, secret, 'diagram');
    const id = await createDiagram(page, `E2E So sánh hẹp ${stamp}`);
    const v1 = await save(page, id, V1);
    const v2 = await save(page, id, V2, v1.id);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/diagrams/${id}?version=${v2.id}&compare=${v1.id}`);
    const viewer = page.getByRole('region', { name: 'Bản vẽ, so sánh hai phiên bản' });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole('group', { name: 'Chú giải so sánh' })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });

  test('phiên bản của bản vẽ khác → không so được (404)', async ({ page }) => {
    const stamp = uniqueStamp();
    const secret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, secret, 'diagram');
    const a = await createDiagram(page, `E2E So sánh A ${stamp}`);
    const b = await createDiagram(page, `E2E So sánh B ${stamp}`);
    const va = await save(page, a, V1);
    const vb = await save(page, b, V2);
    const res = await page.request.get(`/api/v1/diagrams/${a}/compare?from=${va.id}&to=${vb.id}`, { failOnStatusCode: false });
    expect(res.status()).toBe(404);
  });
});

test.describe('Sơ đồ mạng — thanh trượt thời gian', () => {
  test('kéo về ngày cũ → bản chính thức hiệu lực ngày đó; trước bản đầu tiên → "chưa có"', async ({ page }) => {
    const stamp = uniqueStamp();
    const secret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, secret, 'diagram');
    const id = await createDiagram(page, `E2E Dòng thời gian ${stamp}`);
    const v1 = await save(page, id, V1);
    await publish(page, id, v1.id);
    /*
     * Lần phát hành đầu lùi 10 ngày. `diagram_history` chỉ-thêm: trigger chặn mọi UPDATE (AD-13),
     * kể cả với superuser — chỉ bài kiểm mới được tắt trigger trong đúng phiên lệnh này để giả mốc.
     */
    sql(
      `SET session_replication_role = replica; UPDATE diagram_history SET created_at = created_at - interval '10 days' WHERE diagram_id = '${id}' AND action = 'version.published'`,
    );
    const v2 = await save(page, id, V2, v1.id);
    await publish(page, id, v2.id);

    await page.goto(`/diagrams/${id}`);
    await expect(page.getByRole('region', { name: 'Bản vẽ, chỉ xem' })).toBeVisible();
    await diagramBarAction(page, 'Dòng thời gian');
    const slider = page.getByRole('slider', { name: 'Chọn ngày' });
    // Thang bắt đầu HÔM TRƯỚC lần phát hành đầu: nấc 1 = ngày phát hành đầu → bản #1.
    await slider.fill('1');
    const day = vnDate(new Date(Date.now() - 10 * 86_400_000));
    await expect(page).toHaveURL(new RegExp(`version=${v1.id}`));
    await expect(page.getByText(`Bản chính thức hiệu lực ngày ${day} — phiên bản 1`).first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Bản vẽ, chỉ xem' })).toContainText('Bỏ E2E');
    expect(Number(sql(`SELECT count(*) FROM audit_log WHERE object_id = '${id}' AND action = 'diagram.viewed' AND detail->>'versionId' = '${v1.id}'`))).toBeGreaterThan(0);

    await page.getByRole('slider', { name: 'Chọn ngày' }).fill('0');
    await expect(page.getByText('Chưa có bản chính thức vào ngày này').first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Bản vẽ, chỉ xem' })).toHaveCount(0);
  });
});
