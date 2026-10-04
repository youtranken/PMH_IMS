import { crc32 } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  expireStepUp,
  firstLogin,
  freshTotpCode,
  fillOtp,
  horizontalOverflow,
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
 * Màn cây bản vẽ hai cột, "Bỏ bản nháp", "Xóa hẳn" và ảnh lưu một lần (Q-23). Luật xoá và ảnh đã
 * có bài DB thật (`api/test/diagram-prune.spec.ts`, `diagram-images.spec.ts`); ở đây chỉ đi đúng
 * đường người dùng bấm, cộng một bài đọc thẳng DB để chắc ảnh không bị chép mỗi lần lưu.
 */

test.beforeEach(() => {
  resetUsers();
  resetDiagrams();
});

/** PNG 1×1 thật, cộng một khối chữ `tEXt` để đủ lớn mà IMS tách ra lưu riêng (≥ 512 byte). */
function photo(seed: string): Buffer {
  const base = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const type = Buffer.from('tEXt', 'latin1');
  const text = Buffer.from(`Comment\0E2E ${seed} ${'x'.repeat(900)}`, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(text.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, text])));
  const iend = base.length - 12;
  return Buffer.concat([base.subarray(0, iend), length, type, text, crc, base.subarray(iend)]);
}

function xmlOf(label: string, imageB64?: string): string {
  const image = imageB64
    ? `<mxCell id="img" value="" style="shape=image;aspect=fixed;image=data:image/png,${imageB64};" vertex="1" parent="1"><mxGeometry x="200" y="10" width="60" height="60" as="geometry"/></mxCell>`
    : '';
  return (
    '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    `<mxCell id="s1" value="${label}" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="120" height="40" as="geometry"/></mxCell>` +
    image +
    '</root></mxGraphModel></diagram></mxfile>'
  );
}

function svgOf(label: string, imageB64?: string): string {
  const image = imageB64 ? `<g data-cell-id="img"><image href="data:image/png;base64,${imageB64}" x="200" y="10" width="60" height="60"/></g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300px" height="80px" viewBox="-0.5 -0.5 300 80"><g data-cell-id="s1"><rect x="10" y="10" width="120" height="40"/><text x="20" y="35">${label}</text></g>${image}</svg>`;
}

async function createDiagram(page: Page, name: string, parentId?: string): Promise<string> {
  const res = await page.request.post('/api/v1/diagrams', {
    headers: await writeHeaders(page),
    data: { name, nodeType: parentId ? 'floor' : 'company', ...(parentId ? { parentId } : {}) },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function save(page: Page, id: string, label: string, imageB64?: string): Promise<{ id: string; seq: number }> {
  const res = await page.request.post(`/api/v1/diagrams/${id}/versions`, {
    headers: await writeHeaders(page),
    data: { xml: xmlOf(label, imageB64), svg: svgOf(label, imageB64), basedOnVersionId: null },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; seq: number };
}

async function publish(page: Page, id: string, versionId: string) {
  const res = await page.request.post(`/api/v1/diagrams/${id}/publish`, { headers: await writeHeaders(page), data: { versionId } });
  expect(res.status(), await res.text()).toBe(201);
}

function seqsOf(id: string): string {
  return sql(`SELECT string_agg(seq::text, ',' ORDER BY seq) FROM diagram_version WHERE diagram_id = '${id}'`);
}

test.describe('Sơ đồ mạng — màn cây hai cột', () => {
  test('cây bên trái chọn nút (chuột + bàn phím, nhớ ở ?node=); bên phải đường dẫn + thẻ "Bản vẽ này" + thẻ con', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const root = await createDiagram(page, `E2E Gốc ${stamp}`);
    const floor = await createDiagram(page, `E2E Tầng 2 ${stamp}`, root);
    await createDiagram(page, `E2E Phòng server ${stamp}`, floor);
    await stepUpViaApi(page, secret, 'diagram');
    await save(page, floor, 'Tầng 2 E2E');

    await page.goto(`/diagrams?node=${floor}`);
    const tree = page.getByRole('tree', { name: 'Cây bản vẽ' });
    const floorItem = tree.getByRole('treeitem', { name: `E2E Tầng 2 ${stamp}` });
    await expect(floorItem).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('navigation', { name: 'Vị trí trên cây bản vẽ' })).toContainText(`E2E Gốc ${stamp}`);
    const cards = page.getByRole('list', { name: `Bản vẽ trong "E2E Tầng 2 ${stamp}"` }).getByRole('listitem');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText('Bản vẽ này');
    await expect(cards.first()).toContainText('Bản nháp');
    await expect(cards.first()).toContainText('v1 ·');
    await expect(cards.nth(1)).toContainText(`E2E Phòng server ${stamp}`);
    await expect(cards.nth(1)).toContainText('Chưa vẽ');

    // Bàn phím: ← lên cha (nút đang thu thì ← đi lên), Enter chọn — thẻ và đường dẫn đổi theo.
    await floorItem.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(tree.getByRole('treeitem', { name: `E2E Gốc ${stamp}` })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(new RegExp(`node=${root}`));
    await expect(page.getByRole('list', { name: `Bản vẽ trong "E2E Gốc ${stamp}"` })).toContainText(`E2E Tầng 2 ${stamp}`);

    // Mở từ thẻ vào màn bản vẽ.
    await page.getByRole('button', { name: `Mở E2E Tầng 2 ${stamp}` }).click();
    await expect(page).toHaveURL(new RegExp(`/diagrams/${floor}$`));
  });

  test('390px: cây thành ô chọn phía trên, thẻ một cột, không tràn ngang, không nút Sửa', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const root = await createDiagram(page, `E2E Điện thoại gốc ${stamp}`);
    await createDiagram(page, `E2E Điện thoại con ${stamp}`, root);

    await page.goto(`/diagrams?node=${root}`);
    await expect(page.getByRole('button', { name: 'Chọn bản vẽ' })).toBeVisible();
    await expect(page.getByRole('tree')).toHaveCount(0);
    const cards = page.getByRole('list', { name: `Bản vẽ trong "E2E Điện thoại gốc ${stamp}"` }).getByRole('listitem');
    await expect(cards).toHaveCount(2);
    const [first, second] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
    expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
    await expect(page.getByRole('button', { name: /^Sửa E2E/ })).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('Sơ đồ mạng — Bỏ bản nháp, Xóa hẳn (Q-23)', () => {
  test('Bỏ bản nháp: hộp xác nhận nói số lần lưu, xoá các lần lưu sau bản chính thức, lịch sử ghi một dòng', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const name = `E2E Bỏ nháp ${uniqueStamp()}`;
    const id = await createDiagram(page, name);
    await stepUpViaApi(page, secret, 'diagram');
    const v1 = await save(page, id, 'Bản 1 E2E');
    await publish(page, id, v1.id);
    await save(page, id, 'Bản 2 E2E');
    await save(page, id, 'Bản 3 E2E');

    await page.goto(`/diagrams?node=${id}`);
    await rowAction(page, name, 'Bỏ bản nháp');
    const confirm = page.getByRole('dialog', { name: `Bỏ 2 bản nháp của "${name}"?` });
    await expect(confirm).toContainText('Xóa vĩnh viễn 2 lần lưu #2–#3, giữ bản chính thức v1.');
    await confirm.getByRole('button', { name: 'Bỏ bản nháp' }).click();
    await expect(page.getByText(`Đã bỏ 2 bản nháp (#2–#3) của "${name}".`)).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: name }).getByText('Chính thức v1')).toBeVisible();
    expect(seqsOf(id)).toBe('1');
    expect(sql(`SELECT changes->>'ranges' FROM diagram_history WHERE diagram_id = '${id}' AND action = 'versions.discarded'`)).toBe('#2–#3');
    expect(sql(`SELECT count(*) FROM audit_log WHERE action = 'diagram.drafts_discarded' AND object_id = '${id}'`)).toBe('1');
  });

  test('Bỏ bản nháp bị chặn khi có yêu cầu phát hành chờ duyệt trỏ vào bản nháp; không xoá gì', async ({ browser, page }) => {
    const saSecret = await firstLogin(page, E2E_SA);
    const name = `E2E Nháp chờ duyệt ${uniqueStamp()}`;
    const id = await createDiagram(page, name);
    await stepUpViaApi(page, saSecret, 'diagram');
    const v1 = await save(page, id, 'Bản 1 E2E');
    await publish(page, id, v1.id);

    const member = await (await browser.newContext()).newPage();
    const memberSecret = await firstLogin(member, E2E_MEMBER);
    await stepUpViaApi(member, memberSecret, 'diagram');
    await save(member, id, 'Bản Thành viên E2E');
    const submitted = await member.request.post(`/api/v1/diagrams/${id}/submit`, { headers: await writeHeaders(member), data: { reason: 'Gửi duyệt E2E' } });
    expect(submitted.status(), await submitted.text()).toBe(201);

    await page.goto(`/diagrams?node=${id}`);
    await rowAction(page, name, 'Bỏ bản nháp');
    await expect(page.getByText(/người gửi rút yêu cầu trước rồi mới bỏ bản nháp/)).toBeVisible();
    await expect(page.getByRole('dialog', { name: /^Bỏ \d+ bản nháp/ })).toHaveCount(0);
    // Gọi thẳng API cũng bị chặn (409), không phiên bản nào mất.
    const direct = await page.request.post(`/api/v1/diagrams/${id}/drafts/discard`, { headers: await writeHeaders(page), failOnStatusCode: false });
    expect(direct.status()).toBe(409);
    expect(((await direct.json()) as { code: string }).code).toBe('DIAGRAM_DISCARD_PENDING');
    expect(seqsOf(id)).toBe('1,2');
  });

  test('Xóa hẳn bản chưa phát hành: hỏi mã, gõ lại tên, thẻ biến mất, còn bia mộ + nhật ký', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const root = await createDiagram(page, `E2E Gốc xóa ${stamp}`);
    const name = `E2E Xóa hẳn ${stamp}`;
    const id = await createDiagram(page, name, root);
    await stepUpViaApi(page, secret, 'diagram');
    await save(page, id, 'Bản dở E2E');
    // Hết ân hạn: Xóa hẳn phải hỏi mã sơ đồ tại chỗ.
    expireStepUp(E2E_SA.email);

    await page.goto(`/diagrams?node=${root}`);
    await rowAction(page, name, 'Xóa hẳn');
    const confirm = page.getByRole('dialog', { name: `Xóa hẳn "${name}"?` });
    const go = confirm.getByRole('button', { name: 'Xóa hẳn' });
    await expect(go).toBeDisabled();
    await confirm.getByLabel('Gõ lại tên bản vẽ để xác nhận').fill(name);
    await go.click();
    const stepUp = page.getByRole('dialog', { name: 'Xác nhận danh tính' });
    await fillOtp(stepUp, await freshTotpCode(secret));
    await expect(page.getByText(`Đã xóa hẳn "${name}".`)).toBeVisible();
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
    expect(sql(`SELECT deleted_by FROM diagram WHERE id = '${id}'`)).toBe(E2E_SA.email);
    expect(sql(`SELECT count(*) FROM diagram_version WHERE diagram_id = '${id}'`)).toBe('0');
    expect(sql(`SELECT count(*) FROM audit_log WHERE action = 'diagram.deleted' AND object_id = '${id}'`)).toBe('1');
    expect((await page.request.get(`/api/v1/diagrams/${id}`, { failOnStatusCode: false })).status()).toBe(404);
  });

  test('bản đã phát hành: menu không có "Xóa hẳn", gọi thẳng API → 409, không xoá gì', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const name = `E2E Đã phát hành ${uniqueStamp()}`;
    const id = await createDiagram(page, name);
    await stepUpViaApi(page, secret, 'diagram');
    const v1 = await save(page, id, 'Bản 1 E2E');
    await publish(page, id, v1.id);

    await page.goto(`/diagrams?node=${id}`);
    expect(await rowActionNames(page, name)).not.toContain('Xóa hẳn');
    const direct = await page.request.post(`/api/v1/diagrams/${id}/purge`, { headers: await writeHeaders(page), data: { name }, failOnStatusCode: false });
    expect(direct.status()).toBe(409);
    expect(((await direct.json()) as { code: string }).code).toBe('DIAGRAM_PUBLISHED');
    expect(seqsOf(id)).toBe('1');
  });
});

test.describe('Sơ đồ mạng — ảnh lưu một lần (Q-23)', () => {
  test('lưu hai lần cùng ảnh: một hàng ảnh, hai phiên bản trỏ tới; mở lại vẫn thấy ảnh', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const name = `E2E Ảnh ${stamp}`;
    const b64 = photo(stamp).toString('base64');
    const id = await createDiagram(page, name);
    await stepUpViaApi(page, secret, 'diagram');
    await save(page, id, 'Có ảnh E2E', b64);
    await save(page, id, 'Có ảnh E2E lần 2', b64);

    expect(sql(`SELECT count(*) FROM diagram_image WHERE data = decode('${b64}', 'base64')`)).toBe('1');
    expect(sql(`SELECT count(*) FROM diagram_version_image l JOIN diagram_version v ON v.id = l.version_id WHERE v.diagram_id = '${id}'`)).toBe('2');
    expect(sql(`SELECT count(*) FROM diagram_version WHERE diagram_id = '${id}' AND (xml LIKE '%data:image%' OR svg LIKE '%data:image%')`)).toBe('0');

    // Trình vẽ nhận lại đúng ảnh nhúng; trình xem hiện ảnh.
    const edit = await page.request.get(`/api/v1/diagrams/${id}/content?mode=edit`);
    expect(((await edit.json()) as { version: { xml: string } }).version.xml).toContain(`image=data:image/png,${b64};`);
    await page.goto(`/diagrams/${id}`);
    const viewer = page.getByRole('region', { name: 'Bản vẽ, chỉ xem' });
    await expect(viewer.getByText('Có ảnh E2E lần 2')).toBeVisible();
    await expect(viewer.locator('image').first()).toHaveAttribute('href', `data:image/png;base64,${b64}`);
  });
});
