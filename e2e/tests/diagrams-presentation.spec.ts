import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetDevices,
  resetDiagrams,
  resetUsers,
  sql,
  stepUpViaApi,
  uniqueStamp,
  writeHeaders,
  diagramBarAction,
} from './helpers';

/*
 * Bản trình bày (Q-23, FR-045): nhân bản bản chính thức thành bản riêng, thêm thiết bị dự kiến +
 * ảnh tự do, dải "BẢN TRÌNH BÀY", báo khi bản gốc có bản chính thức mới; bản trình bày không gửi
 * duyệt / phát hành được, và thiết bị dự kiến không lọt vào bản chính thức. Logic dồn ở
 * `api/test/diagram-presentation.spec.ts`; bài này giữ luồng thật trên stack (trình vẽ ở mức khói).
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetDiagrams();
});

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300px" height="100px" viewBox="-0.5 -0.5 300 100">' +
  '<g data-cell-id="s1"><rect x="10" y="10" width="120" height="40"/><text x="20" y="35">Tầng E2E</text></g></svg>';

function page_(extra = ''): string {
  return (
    '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="s1" value="Tầng E2E" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="120" height="40" as="geometry"/></mxCell>' +
    `${extra}</root></mxGraphModel></diagram></mxfile>`
  );
}

const PLANNED =
  '<UserObject label="AP dự kiến E2E" ims_planned="1" ims_planned_price="1" id="p9">' +
  '<mxCell style="rounded=1;dashed=1;" vertex="1" parent="1"><mxGeometry x="200" y="10" width="100" height="40" as="geometry"/></mxCell></UserObject>';

/** PNG 1×1 thật — kiểm nội dung của web đọc byte đầu, không tin đuôi tệp. */
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function createDiagram(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/v1/diagrams', { headers: await writeHeaders(page), data: { name, nodeType: 'floor' } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function save(page: Page, id: string, xml: string, basedOnVersionId: string | null = null) {
  return page.request.post(`/api/v1/diagrams/${id}/versions`, {
    headers: await writeHeaders(page),
    data: { xml, svg: SVG, basedOnVersionId },
    failOnStatusCode: false,
  });
}

/** SA vẽ + phát hành: bản chính thức phiên bản 1. */
async function official(page: Page, name: string): Promise<{ id: string; versionId: string }> {
  const id = await createDiagram(page, name);
  const saved = await save(page, id, page_());
  expect(saved.status(), await saved.text()).toBe(201);
  const versionId = ((await saved.json()) as { id: string }).id;
  const published = await page.request.post(`/api/v1/diagrams/${id}/publish`, { headers: await writeHeaders(page), data: {} });
  expect(published.status(), await published.text()).toBeLessThan(300);
  return { id, versionId };
}

function band(page: Page) {
  return page.getByRole('note', { name: 'BẢN TRÌNH BÀY — không phải sơ đồ chính thức' });
}

test.describe('Sơ đồ mạng — bản trình bày', () => {
  test('Thành viên nhân bản bản chính thức → thêm thiết bị dự kiến + ảnh → lưu; bản gốc phát hành bản mới → báo', async ({ browser, page }) => {
    test.setTimeout(240_000);
    const stamp = uniqueStamp();
    const sourceName = `E2E Tầng trình bày ${stamp}`;
    const presName = `E2E Đề xuất AP ${stamp}`;

    const saSecret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, saSecret, 'diagram');
    const source = await official(page, sourceName);

    const member = await (await browser.newContext()).newPage();
    const memberSecret = await firstLogin(member, E2E_MEMBER);
    await stepUpViaApi(member, memberSecret, 'diagram');
    await member.goto(`/diagrams/${source.id}`);
    await expect(member.getByRole('region', { name: 'Bản vẽ, chỉ xem' })).toBeVisible();
    await diagramBarAction(member, 'Tạo bản trình bày');
    const dialog = member.getByRole('dialog', { name: `Tạo bản trình bày từ "${sourceName}"` });
    await dialog.getByLabel('Tên bản trình bày').fill(presName);
    const [created] = await Promise.all([
      member.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${source.id}/presentations`) && r.request().method() === 'POST'),
      dialog.getByRole('button', { name: 'Tạo' }).click(),
    ]);
    expect(created.status(), await created.text()).toBe(201);
    const presId = ((await created.json()) as { id: string }).id;

    // Màn bản trình bày: dải + phiên bản đã chép; không có đường duyệt.
    await expect(member.getByRole('heading', { level: 1, name: presName })).toBeVisible();
    await expect(band(member)).toContainText('Dựa trên bản chính thức phiên bản 1');
    await expect(member.getByRole('button', { name: 'Gửi duyệt', exact: true })).toHaveCount(0);
    await expect(member.getByRole('button', { name: 'Phát hành', exact: true })).toHaveCount(0);
    // Bản gốc nguyên vẹn; nhân bản ghi nhật ký riêng.
    expect(sql(`SELECT official_version_id FROM diagram WHERE id = '${source.id}'`)).toBe(source.versionId);
    expect(sql(`SELECT count(*) FROM diagram_version WHERE diagram_id = '${source.id}'`)).toBe('1');
    expect(sql(`SELECT count(*) FROM audit_log WHERE action = 'diagram.presentation_created' AND object_id = '${presId}'`)).toBe('1');

    // Sửa: thiết bị dự kiến + ảnh tự do, lưu.
    await member.goto(`/diagrams/${presId}?mode=edit`);
    await expect(band(member)).toBeVisible();
    await expect(member.getByRole('button', { name: 'Lưu', exact: true })).toBeEnabled({ timeout: 60_000 });
    await diagramBarAction(member, 'Thiết bị dự kiến');
    const planned = member.getByRole('dialog', { name: 'Thêm thiết bị dự kiến' });
    await planned.getByLabel(/Tên thiết bị/).fill('AP tầng 3 E2E');
    await planned.getByLabel('Model').fill('U6-Pro');
    await planned.getByLabel('Giá dự kiến').fill('3500000');
    await planned.getByLabel('Nhà cung cấp').fill('NCC E2E');
    await planned.getByRole('button', { name: 'Chèn vào bản vẽ' }).click();
    await expect(member.getByText('Đã chèn "AP tầng 3 E2E" vào bản vẽ.')).toBeVisible();
    await member.getByLabel('Chọn ảnh để chèn (JPEG, PNG, WebP)').setInputFiles({ name: 'bao-gia.png', mimeType: 'image/png', buffer: PNG_1PX });
    await expect(member.getByText('Đã chèn ảnh vào bản vẽ.')).toBeVisible();
    const [saved] = await Promise.all([
      member.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${presId}/versions`) && r.request().method() === 'POST'),
      member.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    const xml = sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${presId}' ORDER BY seq DESC LIMIT 1`);
    expect(xml).toContain('ims_planned="1"');
    expect(xml).toContain('ims_planned_vendor="NCC E2E"');
    expect(xml).toContain('dashed=1');
    expect(xml).toMatch(/image=data:image\/png/);
    // Bản chính thức không bị đụng.
    expect(sql(`SELECT count(*) FROM diagram_version WHERE diagram_id = '${source.id}'`)).toBe('1');

    // Bản gốc phát hành bản chính thức mới → bản trình bày báo, kèm link; nội dung không tự đổi.
    const v2 = await save(page, source.id, page_('<mxCell id="s2" value="Phòng mới E2E" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="10" y="60" width="120" height="30" as="geometry"/></mxCell>'), source.versionId);
    expect(v2.status(), await v2.text()).toBe(201);
    const republished = await page.request.post(`/api/v1/diagrams/${source.id}/publish`, { headers: await writeHeaders(page), data: {} });
    expect(republished.status(), await republished.text()).toBeLessThan(300);
    await member.goto(`/diagrams/${presId}`);
    await expect(band(member)).toContainText('Bản gốc đã có phiên bản mới (2)');
    await expect(member.getByRole('link', { name: 'Mở bản gốc' })).toHaveAttribute('href', `/diagrams/${source.id}`);
    expect(sql(`SELECT count(*) FROM diagram_version WHERE diagram_id = '${presId}'`)).toBe('2');

    // Cây: mục "Bản trình bày" riêng, kèm dấu bản gốc có bản mới.
    await member.goto('/diagrams');
    const section = member.getByRole('list', { name: 'Bản trình bày' });
    await expect(section.getByRole('link', { name: presName })).toBeVisible();
    await expect(section).toContainText('Bản gốc đã có phiên bản mới (2)');
    await expect(member.getByRole('list', { name: 'Cây bản vẽ' }).getByRole('link', { name: presName })).toHaveCount(0);

    // Màn xem (màn đọc) ở 390px: dải vẫn đọc được, không tràn ngang.
    await member.setViewportSize({ width: 390, height: 844 });
    await member.goto(`/diagrams/${presId}`);
    await expect(band(member)).toBeVisible();
    expect(await horizontalOverflow(member)).toBeLessThanOrEqual(1);
  });

  test('bản trình bày không gửi duyệt / phát hành; thiết bị dự kiến vào bản chính thức bị từ chối; chưa phát hành thì không nhân bản', async ({ browser, page }) => {
    test.setTimeout(180_000);
    const stamp = uniqueStamp();
    const saSecret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, saSecret, 'diagram');
    const source = await official(page, `E2E Nguồn chặn ${stamp}`);

    // Chưa có mã sơ đồ → nhân bản (đọc nội dung bản chính thức) đòi mã.
    const member = await (await browser.newContext()).newPage();
    const memberSecret = await firstLogin(member, E2E_MEMBER);
    const locked = await member.request.post(`/api/v1/diagrams/${source.id}/presentations`, {
      headers: await writeHeaders(member),
      data: {},
      failOnStatusCode: false,
    });
    expect(locked.status()).toBe(401);
    expect(((await locked.json()) as { code: string }).code).toBe('STEPUP_REQUIRED');
    await stepUpViaApi(member, memberSecret, 'diagram');
    const created = await member.request.post(`/api/v1/diagrams/${source.id}/presentations`, { headers: await writeHeaders(member), data: {} });
    expect(created.status(), await created.text()).toBe(201);
    const pres = (await created.json()) as { id: string; name: string; kind: string };
    expect(pres).toMatchObject({ kind: 'presentation', name: `E2E Nguồn chặn ${stamp} — trình bày` });
    const withPlanned = await save(member, pres.id, page_(PLANNED));
    expect(withPlanned.status(), await withPlanned.text()).toBe(201);

    // Gửi duyệt: tự kiểm báo đỏ PLANNED_DEVICE. Phát hành / khôi phục làm chính thức: không phải đường của bản trình bày.
    const submit = await member.request.post(`/api/v1/diagrams/${pres.id}/submit`, {
      headers: await writeHeaders(member),
      data: { reason: 'Xin duyệt E2E' },
      failOnStatusCode: false,
    });
    expect(submit.status()).toBe(400);
    expect(await submit.json()).toMatchObject({ code: 'DIAGRAM_CHECK_FAILED', errors: [{ code: 'PLANNED_DEVICE', cellId: 'p9' }] });
    const publish = await page.request.post(`/api/v1/diagrams/${pres.id}/publish`, { headers: await writeHeaders(page), data: {}, failOnStatusCode: false });
    expect(publish.status()).toBe(409);
    expect(((await publish.json()) as { code: string }).code).toBe('DIAGRAM_NOT_REVIEWABLE');
    expect(sql(`SELECT count(*) FROM approval WHERE subject_id = '${pres.id}'`)).toBe('0');
    expect(sql(`SELECT official_version_id IS NULL FROM diagram WHERE id = '${pres.id}'`)).toBe('t');

    // Thiết bị dự kiến gửi thẳng vào bản chính thức → 400, không thêm phiên bản.
    const leak = await save(page, source.id, page_(PLANNED), source.versionId);
    expect(leak.status()).toBe(400);
    expect(((await leak.json()) as { code: string }).code).toBe('DIAGRAM_PLANNED_NOT_ALLOWED');
    expect(sql(`SELECT count(*) FROM diagram_version WHERE diagram_id = '${source.id}'`)).toBe('1');

    // Bản chưa phát hành không nhân bản được; trên màn cũng không có nút.
    const draftId = await createDiagram(page, `E2E Nháp chặn ${stamp}`);
    expect((await save(page, draftId, page_())).status()).toBe(201);
    const fromDraft = await member.request.post(`/api/v1/diagrams/${draftId}/presentations`, {
      headers: await writeHeaders(member),
      data: {},
      failOnStatusCode: false,
    });
    expect(fromDraft.status()).toBe(409);
    expect(((await fromDraft.json()) as { code: string }).code).toBe('DIAGRAM_NOT_OFFICIAL');
    await member.goto(`/diagrams/${draftId}`);
    await expect(member.getByRole('region', { name: 'Bản vẽ, chỉ xem' })).toBeVisible();
    await member.getByRole('button', { name: /^Thao tác với / }).click();
    await expect(member.getByRole('menuitem', { name: 'Phiên bản' })).toBeVisible();
    await expect(member.getByRole('menuitem', { name: 'Tạo bản trình bày' })).toHaveCount(0);
  });

  test('Thành viên đổi tên + lưu trữ bản trình bày của mình; bản của người khác và bản chính thức → 403', async ({ browser, page }) => {
    test.setTimeout(180_000);
    const stamp = uniqueStamp();
    const saSecret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, saSecret, 'diagram');
    const source = await official(page, `E2E Nguồn quyền ${stamp}`);
    const saCopy = await page.request.post(`/api/v1/diagrams/${source.id}/presentations`, {
      headers: await writeHeaders(page),
      data: { name: `E2E Bản SA ${stamp}` },
    });
    expect(saCopy.status(), await saCopy.text()).toBe(201);
    const saCopyId = ((await saCopy.json()) as { id: string }).id;

    const member = await (await browser.newContext()).newPage();
    const memberSecret = await firstLogin(member, E2E_MEMBER);
    await stepUpViaApi(member, memberSecret, 'diagram');
    const mine = await member.request.post(`/api/v1/diagrams/${source.id}/presentations`, {
      headers: await writeHeaders(member),
      data: { name: `E2E Bản của tôi ${stamp}` },
    });
    expect(mine.status(), await mine.text()).toBe(201);
    const mineId = ((await mine.json()) as { id: string }).id;

    // Đường hỏng trước: bản của SA, bản chính thức → 403, không đổi gì.
    for (const [path, data] of [
      [`/api/v1/diagrams/${saCopyId}`, { name: `E2E Chiếm ${stamp}` }],
      [`/api/v1/diagrams/${source.id}`, { name: `E2E Đổi gốc ${stamp}` }],
    ] as const) {
      const res = await member.request.patch(path, { headers: await writeHeaders(member), data, failOnStatusCode: false });
      expect(res.status()).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe('DIAGRAM_MANAGE_FORBIDDEN');
    }
    for (const id of [saCopyId, source.id]) {
      const res = await member.request.post(`/api/v1/diagrams/${id}/archive`, { headers: await writeHeaders(member), failOnStatusCode: false });
      expect(res.status()).toBe(403);
    }
    expect(sql(`SELECT count(*) FROM diagram WHERE id IN ('${saCopyId}', '${source.id}') AND archived_at IS NULL`)).toBe('2');
    expect(sql(`SELECT name FROM diagram WHERE id = '${saCopyId}'`)).toBe(`E2E Bản SA ${stamp}`);

    // Trên cây: bản của SA không có thao tác; bản của mình đổi tên rồi lưu trữ được.
    await member.goto('/diagrams');
    const section = member.getByRole('list', { name: 'Bản trình bày' });
    await expect(section.getByRole('link', { name: `E2E Bản SA ${stamp}` })).toBeVisible();
    await expect(member.getByRole('button', { name: `Thao tác với E2E Bản SA ${stamp}` })).toHaveCount(0);
    await member.getByRole('button', { name: `Thao tác với E2E Bản của tôi ${stamp}` }).click();
    await member.getByRole('menuitem', { name: 'Đổi tên' }).click();
    const rename = member.getByRole('dialog', { name: `Đổi tên "E2E Bản của tôi ${stamp}"` });
    await expect(rename.getByRole('combobox', { name: 'Loại nút' })).toHaveCount(0);
    await rename.getByRole('textbox', { name: /Tên bản vẽ/ }).fill(`E2E Bản đổi tên ${stamp}`);
    await Promise.all([
      member.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${mineId}`) && r.request().method() === 'PATCH' && r.status() === 200),
      rename.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    await expect(section.getByRole('link', { name: `E2E Bản đổi tên ${stamp}` })).toBeVisible();

    await member.getByRole('button', { name: `Thao tác với E2E Bản đổi tên ${stamp}` }).click();
    await member.getByRole('menuitem', { name: 'Lưu trữ' }).click();
    const confirm = member.getByRole('dialog', { name: `Lưu trữ bản vẽ "E2E Bản đổi tên ${stamp}"?` });
    await Promise.all([
      member.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${mineId}/archive`) && r.status() === 201),
      confirm.getByRole('button', { name: 'Lưu trữ' }).click(),
    ]);
    await expect(section.getByRole('link', { name: `E2E Bản đổi tên ${stamp}` })).toHaveCount(0);
    expect(sql(`SELECT count(*) FROM audit_log WHERE action = 'diagram.archived' AND object_id = '${mineId}' AND actor = '${E2E_MEMBER.email}'`)).toBe('1');
  });
});
