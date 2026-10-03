import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  clearMailbox,
  firstLogin,
  resetDevices,
  resetDiagrams,
  resetUsers,
  sql,
  stepUpViaApi,
  uniqueStamp,
  waitForMail,
  writeHeaders,
  diagramBarAction,
  diagramBarSpread,
  horizontalOverflow,
} from './helpers';

/*
 * Gửi duyệt, phát hành, tự kiểm và bình luận ghim (Q-23, AD-6, AD-18). Logic (tự kiểm, bốn mắt,
 * một transaction khi duyệt) có bài DB ở `api/test/diagram-review.spec.ts`; bài này kiểm luồng
 * thật qua giao diện + thư Mailpit. Không lái trình vẽ draw.io: nội dung lưu bằng API, mọi thao
 * tác duyệt/ghim ở chế độ Xem (trình xem SVG của IMS).
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetDiagrams();
});

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="420px" height="200px" viewBox="-0.5 -0.5 420 200">' +
  '<g data-cell-id="s1"><rect x="10" y="10" width="120" height="40"/><text x="20" y="35">Tầng 3 E2E</text></g>' +
  '<g data-cell-id="d1"><rect x="200" y="10" width="100" height="40"/><text x="210" y="35">Máy E2E</text></g></svg>';

function page_(body: string): string {
  return (
    '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="s1" value="Tầng 3 E2E" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="120" height="40" as="geometry"/></mxCell>' +
    `${body}</root></mxGraphModel></diagram></mxfile>`
  );
}

function deviceCell(deviceId: string, code: string, opts: { parent?: string; x?: number } = {}): string {
  return (
    `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="d1">` +
    `<mxCell style="rounded=0;" vertex="1" parent="${opts.parent ?? '1'}"><mxGeometry x="${opts.x ?? 20}" y="20" width="100" height="40" as="geometry"/></mxCell></UserObject>`
  );
}

function cabinetFrame(cabinetId: string): string {
  return (
    `<UserObject label="Tủ E2E" ims_cabinet_id="${cabinetId}" id="f1">` +
    '<mxCell style="container=1;" vertex="1" parent="1"><mxGeometry x="180" y="0" width="240" height="200" as="geometry"/></mxCell></UserObject>'
  );
}

async function createDiagram(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/v1/diagrams', { headers: await writeHeaders(page), data: { name, nodeType: 'floor' } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function save(page: Page, id: string, xml: string, basedOnVersionId: string | null = null): Promise<{ id: string; seq: number }> {
  const res = await page.request.post(`/api/v1/diagrams/${id}/versions`, {
    headers: await writeHeaders(page),
    data: { xml, svg: SVG, basedOnVersionId },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; seq: number };
}

async function createSwitch(page: Page, code: string, cabinetId?: string, siteId?: string): Promise<string> {
  const catalog = (await (await page.request.get('/api/v1/catalog')).json()) as { deviceTypes: { id: string; name: string }[] };
  const type = catalog.deviceTypes.find((t) => t.name === 'Switch')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { code, name: 'Switch duyệt E2E', deviceTypeId: type.id, ...(siteId ? { siteId } : {}), ...(cabinetId ? { cabinetId } : {}) },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

/** Site + tủ E2E (mã chứa E2E để vùng `catalog` của lượt dọn thấy). */
async function createCabinet(page: Page, stamp: string): Promise<{ siteId: string; cabinetId: string }> {
  const headers = await writeHeaders(page);
  const site = await page.request.post('/api/v1/catalog/site', { headers, data: { code: `S-E2E-RV-${stamp}`, name: `Site duyệt ${stamp}` } });
  expect(site.status(), await site.text()).toBeLessThan(300);
  const siteId = ((await site.json()) as { id: string }).id;
  const cab = await page.request.post('/api/v1/catalog/cabinet', { headers, data: { code: `TU-E2E-RV-${stamp}`, siteId } });
  expect(cab.status(), await cab.text()).toBeLessThan(300);
  return { siteId, cabinetId: ((await cab.json()) as { id: string }).id };
}

async function pendingApprovalOf(page: Page, id: string): Promise<string> {
  const node = (await (await page.request.get(`/api/v1/diagrams/${id}`)).json()) as { pendingApprovalId: string | null };
  expect(node.pendingApprovalId).toBeTruthy();
  return node.pendingApprovalId!;
}

function viewer(page: Page) {
  return page.getByRole('region', { name: 'Bản vẽ, chỉ xem' });
}

async function treeRow(page: Page, name: string) {
  await page.goto('/diagrams');
  return page.getByRole('listitem').filter({ has: page.getByRole('link', { name }) });
}

test.describe('Sơ đồ mạng — gửi duyệt, trả về kèm ghim, duyệt', () => {
  test('Thành viên gửi (vàng cho qua) → SA ghim + trả về → sửa, gửi lại → SA duyệt thành chính thức; thư hai chiều', async ({ browser, page }) => {
    test.setTimeout(240_000);
    await clearMailbox();
    const stamp = uniqueStamp();
    const name = `E2E Duyệt tầng ${stamp}`;

    // SA dựng tủ + máy chưa gắn tủ (kho), Thành viên vẽ máy đó vào khung tủ → cảnh báo vàng.
    const saSecret = await firstLogin(page, E2E_SA);
    const { cabinetId } = await createCabinet(page, stamp);
    const deviceId = await createSwitch(page, `SW-E2E-RV${stamp}`);

    const member = await (await browser.newContext()).newPage();
    const memberSecret = await firstLogin(member, E2E_MEMBER);
    await stepUpViaApi(member, memberSecret, 'diagram');
    const id = await createDiagram(member, name);
    const v1 = await save(member, id, page_(cabinetFrame(cabinetId) + deviceCell(deviceId, `SW-E2E-RV${stamp}`, { parent: 'f1' })));

    await member.goto(`/diagrams/${id}`);
    await expect(viewer(member)).toBeVisible();
    await member.getByRole('button', { name: 'Gửi duyệt', exact: true }).click();
    const submit = member.getByRole('dialog', { name: `Gửi bản vẽ "${name}" cho Admin duyệt` });
    await submit.getByLabel(/Lý do/).fill('Vẽ xong tầng 3 E2E');
    await submit.getByRole('button', { name: 'Gửi duyệt', exact: true }).click();
    await expect(member.getByText('Đã gửi duyệt kèm 1 cảnh báo vàng cho người duyệt xem.')).toBeVisible();
    // Người gửi không tự duyệt: chỉ có nút Rút; gọi thẳng API duyệt → 403.
    await expect(member.getByRole('button', { name: 'Duyệt…', exact: true })).toHaveCount(0);
    await member.getByRole('button', { name: /^Thao tác với / }).click();
    await expect(member.getByRole('menuitem', { name: 'Rút yêu cầu' })).toBeVisible();
    await expect(member.getByRole('menuitem', { name: 'Duyệt…' })).toHaveCount(0);
    await member.keyboard.press('Escape');
    const approvalId = await pendingApprovalOf(member, id);
    const forbidden = await member.request.post(`/api/v1/diagrams/${id}/review/${approvalId}/approve`, {
      headers: await writeHeaders(member),
      data: {},
      failOnStatusCode: false,
    });
    expect(forbidden.status()).toBe(403);
    await expect((await treeRow(member, name)).getByText('Chờ duyệt')).toBeVisible();
    expect(await waitForMail(`Duyệt bản vẽ: `)).not.toHaveLength(0);

    // SA mở trang duyệt: tóm tắt + cảnh báo vàng, ghim lên hình rồi trả về.
    await stepUpViaApi(page, saSecret, 'diagram');
    await page.goto(`/diagrams/${id}`);
    await expect(viewer(page)).toBeVisible();
    await page.getByRole('button', { name: 'Duyệt…', exact: true }).click();
    let decide = page.getByRole('dialog', { name: `Duyệt phiên bản #${v1.seq}` });
    await expect(decide).toContainText('Thay đổi (chưa có bản chính thức)');
    await expect(decide).toContainText('nằm trong khung');
    await expect(decide.getByRole('button', { name: 'Xem so sánh với bản chính thức' })).toBeDisabled();
    await decide.getByRole('button', { name: 'Ghim bình luận' }).click();
    await viewer(page).getByText('Tầng 3 E2E').click();
    const pin = page.getByRole('dialog', { name: 'Ghim bình luận lên ô s1' });
    await pin.getByLabel(/Bình luận/).fill('Sai tên phòng E2E');
    await pin.getByRole('button', { name: 'Ghim' }).click();
    await expect(page.getByText('Đã ghim bình luận.')).toBeVisible();
    await page.getByRole('button', { name: 'Duyệt…', exact: true }).click();
    decide = page.getByRole('dialog', { name: `Duyệt phiên bản #${v1.seq}` });
    await expect(decide).toContainText('Đã ghim 1 bình luận cho lượt duyệt này.');
    await decide.getByRole('button', { name: 'Trả về' }).click();
    await expect(page.getByText('Đã trả về. Người gửi nhận email kèm ghi chú.')).toBeVisible();
    expect(await waitForMail(`Trả về: bản vẽ "${name}"`)).not.toHaveLength(0);

    // Người gửi thấy ghim trên trình xem (cả 390px), trả lời, đánh dấu đã xử lý, sửa rồi gửi lại.
    await member.goto(`/diagrams/${id}`);
    await expect(viewer(member)).toBeVisible();
    const marker = member.getByRole('button', { name: /Ghim 1: Sai tên phòng E2E/ });
    await expect(marker).toBeVisible();
    await member.setViewportSize({ width: 390, height: 800 });
    await expect(marker).toBeVisible();
    await member.setViewportSize({ width: 1280, height: 800 });
    await marker.click();
    const thread = member.getByRole('dialog', { name: 'Ghim trên ô s1' });
    await thread.getByRole('button', { name: 'Trả lời' }).click();
    const reply = member.getByRole('dialog', { name: 'Trả lời ghim' });
    await reply.getByLabel(/Bình luận/).fill('Đã đổi tên phòng E2E');
    await reply.getByRole('button', { name: 'Trả lời' }).click();
    await member.getByRole('dialog', { name: 'Ghim trên ô s1' }).getByRole('button', { name: 'Đã xử lý' }).click();
    await expect(member.getByRole('dialog', { name: 'Ghim trên ô s1' })).toContainText('Đã đổi tên phòng E2E');
    await member.keyboard.press('Escape');

    const v2 = await save(member, id, page_(cabinetFrame(cabinetId) + deviceCell(deviceId, `SW-E2E-RV${stamp}`, { parent: 'f1', x: 40 })), v1.id);
    const resubmit = await member.request.post(`/api/v1/diagrams/${id}/submit`, {
      headers: await writeHeaders(member),
      data: { reason: 'Đã sửa theo ghim E2E' },
    });
    expect(resubmit.status(), await resubmit.text()).toBe(201);

    // SA duyệt → bản chính thức v2; cây ghi "Chính thức v2"; thư báo người gửi.
    await page.reload();
    await expect(viewer(page)).toBeVisible();
    await page.getByRole('button', { name: 'Duyệt…', exact: true }).click();
    await page.getByRole('dialog', { name: `Duyệt phiên bản #${v2.seq}` }).getByRole('button', { name: 'Duyệt', exact: true }).click();
    await expect(page.getByText(`Đã duyệt — phiên bản #${v2.seq} là bản chính thức.`)).toBeVisible();
    await expect((await treeRow(page, name)).getByText(`Chính thức v${v2.seq}`)).toBeVisible();
    expect(await waitForMail(`Đã duyệt: bản vẽ "${name}"`)).not.toHaveLength(0);
    await member.context().close();
  });

  test('đường hỏng: máy đã thanh lý trên bản vẽ → gửi duyệt bị chặn (đỏ), không có yêu cầu nào', async ({ page }) => {
    test.setTimeout(150_000);
    const stamp = uniqueStamp();
    const code = `SW-E2E-RVX${stamp}`;
    const saSecret = await firstLogin(page, E2E_SA);
    const deviceId = await createSwitch(page, code);
    await stepUpViaApi(page, saSecret, 'diagram');
    const id = await createDiagram(page, `E2E Đỏ ${stamp}`);
    await save(page, id, page_(deviceCell(deviceId, code, { x: 200 })));
    sql(`UPDATE device SET status = 'retired' WHERE code = '${code}'`);

    await page.goto(`/diagrams/${id}`);
    await expect(viewer(page)).toBeVisible();
    // Admin/SA: Phát hành đứng ngoài thanh, Gửi duyệt nằm trong menu ⋮.
    await diagramBarAction(page, 'Gửi duyệt');
    const submit = page.getByRole('dialog', { name: /cho Admin duyệt/ });
    await submit.getByLabel(/Lý do/).fill('Thử gửi E2E');
    await submit.getByRole('button', { name: 'Gửi duyệt', exact: true }).click();
    const found = page.getByRole('dialog', { name: 'Tự kiểm còn lỗi đỏ' });
    await expect(found).toContainText(`Thiết bị ${code} đã thanh lý`);
    await expect(found.getByRole('button', { name: 'Xem trên bản vẽ' })).toBeVisible();
    // Phát hành cũng chạy cùng bộ tự kiểm → cũng bị chặn.
    const publish = await page.request.post(`/api/v1/diagrams/${id}/publish`, { headers: await writeHeaders(page), data: {}, failOnStatusCode: false });
    expect(publish.status()).toBe(400);
    expect(((await publish.json()) as { code: string }).code).toBe('DIAGRAM_CHECK_FAILED');
    const node = (await (await page.request.get(`/api/v1/diagrams/${id}`)).json()) as { status: string; pendingApprovalId: string | null };
    expect(node).toMatchObject({ status: 'draft', pendingApprovalId: null });
  });
});

test.describe('Sơ đồ mạng — Admin/SA tự phát hành, lùi bản chính thức', () => {
  test('lưu vẫn là nháp; Phát hành → chính thức; khôi phục bản chính thức cũ một cú bấm; tự gửi rồi tự duyệt → 403', async ({ browser, page }) => {
    test.setTimeout(180_000);
    const stamp = uniqueStamp();
    const name = `E2E Phát hành ${stamp}`;
    const secret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, secret, 'diagram');
    const id = await createDiagram(page, name);
    const v1 = await save(page, id, page_(''));
    await expect((await treeRow(page, name)).getByText('Bản nháp')).toBeVisible();

    // Thanh mảnh MỘT dòng ở 1280px cho SA (Q-23), cả Xem lẫn Sửa; 390px (chỉ xem) xuống dòng, không tràn ngang.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/diagrams/${id}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeVisible();
    expect(await diagramBarSpread(page)).toBeLessThan(12);
    await page.goto(`/diagrams/${id}`);
    await expect(viewer(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Phát hành', exact: true })).toBeVisible();
    expect(await diagramBarSpread(page)).toBeLessThan(12);
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.getByRole('button', { name: 'Phát hành', exact: true })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: 'Phát hành', exact: true }).click();
    await page.getByRole('dialog', { name: `Phát hành phiên bản #${v1.seq} thành bản chính thức?` }).getByRole('button', { name: 'Phát hành', exact: true }).click();
    await expect(page.getByText(`Phiên bản #${v1.seq} đã là bản chính thức.`)).toBeVisible();

    const v2 = await save(page, id, page_('<mxCell id="s2" value="Phòng mới E2E" vertex="1" parent="1"><mxGeometry x="300" y="100" width="80" height="40" as="geometry"/></mxCell>'), v1.id);
    const published = await page.request.post(`/api/v1/diagrams/${id}/publish`, { headers: await writeHeaders(page), data: { versionId: v2.id } });
    expect(published.status(), await published.text()).toBe(201);
    await expect((await treeRow(page, name)).getByText(`Chính thức v${v2.seq}`)).toBeVisible();

    // Lùi về bản chính thức cũ: tạo phiên bản MỚI (v3) chép v1 rồi phát hành, không xoá gì.
    await page.goto(`/diagrams/${id}`);
    await diagramBarAction(page, 'Phiên bản');
    const versions = page.getByRole('dialog', { name: 'Phiên bản và lịch sử' });
    await expect(versions.getByText('Từng chính thức')).toBeVisible();
    await versions.getByRole('button', { name: `Khôi phục phiên bản #${v1.seq} làm bản chính thức` }).click();
    await page.getByRole('dialog', { name: `Khôi phục phiên bản #${v1.seq} làm bản chính thức?` }).getByRole('button', { name: 'Khôi phục làm chính thức' }).click();
    await expect(page.getByText(`Phiên bản #${v2.seq + 1} (chép từ bản cũ) đã là bản chính thức.`)).toBeVisible();
    const versionCount = Number(sql(`SELECT count(*) FROM diagram_version WHERE diagram_id = '${id}'`));
    expect(versionCount).toBe(3);

    // Admin/SA gửi duyệt bản của mình thì không tự duyệt được (đi đường Phát hành).
    await save(page, id, page_('<mxCell id="s3" value="Thêm E2E" vertex="1" parent="1"><mxGeometry x="300" y="150" width="80" height="40" as="geometry"/></mxCell>'));
    const own = await page.request.post(`/api/v1/diagrams/${id}/submit`, { headers: await writeHeaders(page), data: { reason: 'Tự gửi E2E' } });
    expect(own.status(), await own.text()).toBe(201);
    const approvalId = await pendingApprovalOf(page, id);
    const self = await page.request.post(`/api/v1/diagrams/${id}/review/${approvalId}/approve`, {
      headers: await writeHeaders(page),
      data: {},
      failOnStatusCode: false,
    });
    expect(self.status()).toBe(403);
    expect(((await self.json()) as { code: string }).code).toBe('CANNOT_APPROVE_OWN_REQUEST');

    // Thành viên không phát hành được.
    const member = await (await browser.newContext()).newPage();
    const memberSecret = await firstLogin(member, E2E_MEMBER);
    await stepUpViaApi(member, memberSecret, 'diagram');
    const memberPublish = await member.request.post(`/api/v1/diagrams/${id}/publish`, {
      headers: await writeHeaders(member),
      data: {},
      failOnStatusCode: false,
    });
    expect(memberPublish.status()).toBe(403);
    await member.goto(`/diagrams/${id}`);
    await expect(viewer(member)).toBeVisible();
    await expect(member.getByRole('button', { name: 'Phát hành', exact: true })).toHaveCount(0);
    await member.context().close();
  });
});
