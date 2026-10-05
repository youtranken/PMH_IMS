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
  switchTheme,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/*
 * Màn /diagrams "bản đồ không gian", bỏ nháp từ một bản chọn, "Xóa hẳn" và ảnh lưu một lần
 * (Q-23). Luật xoá và ảnh đã có bài DB thật (`api/test/diagram-prune.spec.ts`, `diagram-images.spec.ts`); ở đây chỉ đi đúng
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

/** Ô / băng / đầu khu mang đúng tên này trên bản đồ (tên nằm trong một phần tử riêng). */
function mapItem(page: Page, name: string) {
  return page.getByRole('region', { name: 'Bản đồ bản vẽ' }).getByRole('button').filter({ has: page.getByText(name, { exact: true }) }).first();
}

function panel(page: Page) {
  return page.getByRole('complementary', { name: 'Bản vẽ đang chọn' });
}

/** Màu tính ra của một token trên `<html>` theo theme đang bật — so với màu thật của phần tử. */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

test.describe('Sơ đồ mạng — bản đồ không gian (Q-23)', () => {
  test('gốc là băng, con là khu, cháu là ô; chữ trạng thái; đi sâu bằng "▸ n Bản vẽ con" + đường dẫn quay lại; panel chuyển bản vẽ cùng khu', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const root = await createDiagram(page, `E2E Gốc ${stamp}`);
    const floor = await createDiagram(page, `E2E Tầng 2 ${stamp}`, root);
    const server = await createDiagram(page, `E2E Phòng server ${stamp}`, floor);
    await createDiagram(page, `E2E Kế toán ${stamp}`, floor);
    await createDiagram(page, `E2E Tủ R1 ${stamp}`, server);
    await stepUpViaApi(page, secret, 'diagram');
    const v1 = await save(page, server, 'Phòng E2E');
    await publish(page, server, v1.id);
    await save(page, server, 'Phòng E2E nháp');

    await page.goto('/diagrams');
    const map = page.getByRole('region', { name: 'Bản đồ bản vẽ' });
    await expect(mapItem(page, `E2E Gốc ${stamp}`)).toContainText('4 Bản vẽ bên trong');
    const tiles = map.getByRole('list', { name: `Bản vẽ trong "E2E Tầng 2 ${stamp}"` });
    const serverTile = mapItem(page, `E2E Phòng server ${stamp}`);
    await expect(serverTile).toContainText('Chính thức · có bản nháp');
    await expect(serverTile).toContainText('v1 · 1 Bản nháp');
    await expect(mapItem(page, `E2E Kế toán ${stamp}`)).toContainText('Chưa vẽ');
    await expect(tiles.getByRole('button', { name: `Thêm bản vẽ con vào "E2E Tầng 2 ${stamp}"` })).toBeVisible();

    // Chọn ô → panel: dải chuyển bản vẽ cùng khu, Sửa tiếp nháp.
    await serverTile.click();
    await expect(page).toHaveURL(new RegExp(`node=${server}`));
    const siblings = panel(page).getByRole('tablist', { name: `Bản vẽ trong "E2E Tầng 2 ${stamp}"` });
    await expect(siblings.getByRole('tab', { name: new RegExp(`^E2E Phòng server ${stamp} 2$`) })).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page).getByRole('button', { name: 'Sửa tiếp nháp #2' })).toBeVisible();
    await siblings.getByRole('tab', { name: `E2E Kế toán ${stamp}` }).click();
    await expect(panel(page).getByRole('heading', { level: 2, name: `E2E Kế toán ${stamp}` })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`node=`));

    // Đi sâu: ô "Phòng server" có con → bản đồ lấy nó làm gốc; đường dẫn quay về.
    await page.getByRole('button', { name: `Xem 1 bản vẽ con của "E2E Phòng server ${stamp}"` }).click();
    await expect(page).toHaveURL(new RegExp(`root=${server}`));
    await expect(mapItem(page, `E2E Tủ R1 ${stamp}`)).toBeVisible();
    await expect(mapItem(page, `E2E Kế toán ${stamp}`)).toHaveCount(0);
    const crumbs = page.getByRole('navigation', { name: 'Vị trí trên bản đồ' });
    await crumbs.getByRole('link', { name: 'Tất cả bản vẽ' }).click();
    await expect(mapItem(page, `E2E Kế toán ${stamp}`)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`root=${server}`));

    // Mở từ panel vào màn bản vẽ.
    await page.goto(`/diagrams?node=${server}`);
    await panel(page).getByRole('button', { name: 'Mở bản chính thức' }).click();
    await expect(page).toHaveURL(new RegExp(`/diagrams/${server}$`));
  });

  test('"Cần làm": chip đếm, bấm thì nút không khớp mờ đi (?todo=); kiểu Danh sách là cây thụt lề', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const root = await createDiagram(page, `E2E Gốc lọc ${stamp}`);
    const drafty = await createDiagram(page, `E2E Có nháp ${stamp}`, root);
    await createDiagram(page, `E2E Trống ${stamp}`, root);
    await stepUpViaApi(page, secret, 'diagram');
    await save(page, drafty, 'Nháp E2E');

    await page.goto('/diagrams');
    const strip = page.getByRole('region', { name: 'Cần làm' });
    const chip = strip.getByRole('button', { name: /Bản nháp chưa phát hành$/ });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/todo=drafts/);
    await expect(page.getByText(/^Đang lọc: \d+ bản vẽ khớp\./)).toBeVisible();
    await expect(mapItem(page, `E2E Trống ${stamp}`)).toHaveAttribute('data-dim', 'true');
    await expect(mapItem(page, `E2E Có nháp ${stamp}`)).not.toHaveAttribute('data-dim', 'true');

    await page.getByRole('radio', { name: 'Danh sách' }).click();
    await expect(page).toHaveURL(/view=list/);
    const list = page.getByRole('list', { name: 'Cây bản vẽ' });
    await list.getByRole('button', { name: `E2E Có nháp ${stamp}`, exact: true }).click();
    await expect(panel(page).getByRole('heading', { level: 2, name: `E2E Có nháp ${stamp}` })).toBeVisible();
  });

  test('sáng / tối: viền ô theo token của theme đang bật, chữ trạng thái vẫn có (không chỉ màu)', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const root = await createDiagram(page, `E2E Theme gốc ${stamp}`);
    const floor = await createDiagram(page, `E2E Theme tầng ${stamp}`, root);
    const room = await createDiagram(page, `E2E Theme phòng ${stamp}`, floor);
    await stepUpViaApi(page, secret, 'diagram');
    await save(page, room, 'Nháp theme E2E');

    await page.goto('/diagrams');
    const tile = page.getByRole('listitem').filter({ has: page.getByText(`E2E Theme phòng ${stamp}`, { exact: true }) }).last();
    for (const theme of ['light', 'dark'] as const) {
      await switchTheme(page, theme);
      await expect(tile).toContainText('Bản nháp');
      const border = await tile.evaluate((el) => getComputedStyle(el).borderTopColor);
      expect(border).toBe(await tokenColor(page, '--warn'));
      const bg = await tile.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--surface)';
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      }));
    }
    await switchTheme(page, 'light');
  });

  test('390px: chip cuộn ngang, khu xếp dọc, ô 2 cột; bấm ô mở panel thành hộp; không tràn ngang, không nút Sửa', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const root = await createDiagram(page, `E2E Điện thoại gốc ${stamp}`);
    const floorA = await createDiagram(page, `E2E ĐT tầng A ${stamp}`, root);
    await createDiagram(page, `E2E ĐT tầng B ${stamp}`, root);
    await createDiagram(page, `E2E ĐT phòng 1 ${stamp}`, floorA);
    await createDiagram(page, `E2E ĐT phòng 2 ${stamp}`, floorA);

    await page.goto('/diagrams');
    const [a, b] = [mapItem(page, `E2E ĐT tầng A ${stamp}`), mapItem(page, `E2E ĐT tầng B ${stamp}`)];
    await expect(a).toBeVisible();
    const [boxA, boxB] = [await a.boundingBox(), await b.boundingBox()];
    expect(boxB!.y).toBeGreaterThan(boxA!.y + boxA!.height - 1);
    const [r1, r2] = [await mapItem(page, `E2E ĐT phòng 1 ${stamp}`).boundingBox(), await mapItem(page, `E2E ĐT phòng 2 ${stamp}`).boundingBox()];
    expect(Math.abs(r1!.y - r2!.y)).toBeLessThan(2);
    expect(r2!.x).toBeGreaterThan(r1!.x);
    await expect(panel(page)).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await mapItem(page, `E2E ĐT phòng 1 ${stamp}`).click();
    const sheet = page.getByRole('dialog', { name: 'Bản vẽ đang chọn' });
    await expect(sheet.getByRole('heading', { level: 2, name: `E2E ĐT phòng 1 ${stamp}` })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^Sửa/ })).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('Sơ đồ mạng — Bỏ nháp từ một bản chọn, Xóa hẳn (Q-23)', () => {
  test('chính thức #1, nháp #2–#4: tick #3 → #4 theo; xoá #3–#4, giữ #2; lịch sử + nhật ký ghi dải', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const name = `E2E Bỏ nháp ${uniqueStamp()}`;
    const id = await createDiagram(page, name);
    await stepUpViaApi(page, secret, 'diagram');
    const v1 = await save(page, id, 'Bản 1 E2E');
    await publish(page, id, v1.id);
    await save(page, id, 'Bản 2 E2E');
    await save(page, id, 'Bản 3 E2E');
    await save(page, id, 'Bản 4 E2E');

    await page.goto(`/diagrams?node=${id}`);
    const drafts = panel(page).getByRole('region', { name: 'Nháp chưa phát hành · 3' });
    await drafts.getByRole('checkbox', { name: 'Chọn nháp #3' }).check();
    await expect(drafts.getByRole('checkbox', { name: 'Chọn nháp #4' })).toBeChecked();
    await expect(drafts.getByRole('checkbox', { name: 'Chọn nháp #2' })).not.toBeChecked();
    await expect(drafts.getByText('Đã chọn #3–#4')).toBeVisible();
    await drafts.getByRole('button', { name: 'Xóa 2 bản nháp' }).click();
    const confirm = page.getByRole('dialog', { name: `Bỏ 2 bản nháp của "${name}"?` });
    await expect(confirm).toContainText('Xóa vĩnh viễn 2 lần lưu #3–#4, giữ bản chính thức v1, cùng các lần lưu trước #3.');
    await confirm.getByRole('button', { name: 'Bỏ bản nháp' }).click();
    await expect(page.getByText(`Đã bỏ 2 bản nháp (#3–#4) của "${name}".`)).toBeVisible();
    await expect(panel(page).getByRole('region', { name: 'Nháp chưa phát hành · 1' })).toBeVisible();
    expect(seqsOf(id)).toBe('1,2');
    expect(sql(`SELECT changes->>'ranges' || '|' || (changes->>'fromSeq') FROM diagram_history WHERE diagram_id = '${id}' AND action = 'versions.discarded'`)).toBe('#3–#4|3');
    expect(sql(`SELECT count(*) FROM audit_log WHERE action = 'diagram.drafts_discarded' AND object_id = '${id}'`)).toBe('1');
    // Gọi thẳng API với số không nằm sau bản chính thức → 400, không xoá gì.
    const bad = await page.request.post(`/api/v1/diagrams/${id}/drafts/discard`, { headers: await writeHeaders(page), data: { fromSeq: 1 }, failOnStatusCode: false });
    expect(bad.status()).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe('DIAGRAM_DRAFT_FROM_INVALID');
    expect(seqsOf(id)).toBe('1,2');
  });

  test('hết ân hạn: panel không tự hỏi mã; "Nhập mã để xem lịch sử" hỏi mã rồi hiện khu nháp', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const name = `E2E Khoá lịch sử ${uniqueStamp()}`;
    const id = await createDiagram(page, name);
    await stepUpViaApi(page, secret, 'diagram');
    await save(page, id, 'Bản 1 E2E');
    expireStepUp(E2E_SA.email);

    await page.goto(`/diagrams?node=${id}`);
    const unlock = panel(page).getByRole('button', { name: 'Nhập mã để xem lịch sử' });
    await expect(unlock).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Nhập mã 6 số để mở sơ đồ' })).toHaveCount(0);
    await unlock.click();
    await fillOtp(page.getByRole('dialog', { name: 'Nhập mã 6 số để mở sơ đồ' }), await freshTotpCode(secret));
    await expect(panel(page).getByRole('region', { name: 'Nháp chưa phát hành · 1' })).toBeVisible();
  });

  test('Bỏ nháp bị chặn khi có yêu cầu phát hành chờ duyệt trỏ vào bản nháp; không xoá gì', async ({ browser, page }) => {
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
    const drafts = panel(page).getByRole('region', { name: 'Nháp chưa phát hành · 1' });
    await drafts.getByRole('checkbox', { name: 'Chọn nháp #2' }).check();
    await drafts.getByRole('button', { name: 'Xóa 1 bản nháp' }).click();
    await expect(page.getByText(/người gửi rút yêu cầu trước rồi mới bỏ bản nháp/)).toBeVisible();
    await expect(page.getByRole('dialog', { name: /^Bỏ \d+ bản nháp/ })).toHaveCount(0);
    // Gọi thẳng API cũng bị chặn (409), không phiên bản nào mất.
    const direct = await page.request.post(`/api/v1/diagrams/${id}/drafts/discard`, { headers: await writeHeaders(page), failOnStatusCode: false });
    expect(direct.status()).toBe(409);
    expect(((await direct.json()) as { code: string }).code).toBe('DIAGRAM_DISCARD_PENDING');
    expect(seqsOf(id)).toBe('1,2');
    await member.context().close();
  });

  test('Xóa hẳn bản chưa phát hành: hỏi mã, gõ lại tên, ô biến mất, còn bia mộ + nhật ký', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const root = await createDiagram(page, `E2E Gốc xóa ${stamp}`);
    const name = `E2E Xóa hẳn ${stamp}`;
    const id = await createDiagram(page, name, root);
    await stepUpViaApi(page, secret, 'diagram');
    await save(page, id, 'Bản dở E2E');
    // Hết ân hạn: Xóa hẳn phải hỏi mã sơ đồ tại chỗ.
    expireStepUp(E2E_SA.email);

    await page.goto(`/diagrams?node=${id}`);
    await rowAction(page, name, 'Xóa hẳn');
    const confirm = page.getByRole('dialog', { name: `Xóa hẳn "${name}"?` });
    const go = confirm.getByRole('button', { name: 'Xóa hẳn' });
    await expect(go).toBeDisabled();
    await confirm.getByLabel('Gõ lại tên bản vẽ để xác nhận').fill(name);
    await go.click();
    const stepUp = page.getByRole('dialog', { name: 'Nhập mã 6 số để mở sơ đồ' });
    await fillOtp(stepUp, await freshTotpCode(secret));
    await expect(page.getByText(`Đã xóa hẳn "${name}".`)).toBeVisible();
    await expect(mapItem(page, name)).toHaveCount(0);
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

test.describe('Sơ đồ mạng — Xóa vĩnh viễn bản đã lưu trữ (Q-23 05/10)', () => {
  async function archive(page: Page, id: string) {
    const res = await page.request.post(`/api/v1/diagrams/${id}/archive`, { headers: await writeHeaders(page) });
    expect(res.status(), await res.text()).toBeLessThan(300);
  }

  test('bản TỪNG PHÁT HÀNH đã lưu trữ: SA bấm Xóa vĩnh viễn, gõ lại tên, hỏi mã tại chỗ; hàng biến mất, còn bia mộ + lịch sử + nhật ký', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const name = `E2E Vĩnh viễn ${uniqueStamp()}`;
    const id = await createDiagram(page, name);
    await stepUpViaApi(page, secret, 'diagram');
    const v1 = await save(page, id, 'Bản 1 E2E');
    await publish(page, id, v1.id);
    await save(page, id, 'Bản 2 E2E');
    await archive(page, id);
    expireStepUp(E2E_SA.email);

    await page.goto('/diagrams?archived=1');
    const section = page.getByRole('region', { name: /Bản vẽ đã lưu trữ/ });
    await section.getByRole('button', { name: `Xóa vĩnh viễn "${name}"` }).click();
    const confirm = page.getByRole('dialog', { name: `Xóa vĩnh viễn "${name}"?` });
    await expect(confirm).toContainText('kể cả bản chính thức');
    const go = confirm.getByRole('button', { name: 'Xóa vĩnh viễn' });
    await expect(go).toBeDisabled();
    await confirm.getByLabel('Gõ lại tên bản vẽ để xác nhận').fill(name);
    await go.click();
    await fillOtp(page.getByRole('dialog', { name: 'Nhập mã 6 số để mở sơ đồ' }), await freshTotpCode(secret));
    await expect(page.getByText(`Đã xóa vĩnh viễn "${name}".`)).toBeVisible();
    await expect(section.getByText(name, { exact: true })).toHaveCount(0);
    expect(sql(`SELECT count(*) FROM diagram_version WHERE diagram_id = '${id}'`)).toBe('0');
    expect(sql(`SELECT deleted_by FROM diagram WHERE id = '${id}' AND official_version_id IS NULL`)).toBe(E2E_SA.email);
    expect(sql(`SELECT count(*) FROM diagram_history WHERE diagram_id = '${id}' AND action IN ('version.published', 'erased')`)).toBe('2');
    expect(sql(`SELECT count(*) FROM audit_log WHERE action = 'diagram.erased' AND object_id = '${id}'`)).toBe('1');
    expect((await page.request.get(`/api/v1/diagrams/${id}`, { failOnStatusCode: false })).status()).toBe(404);
  });

  test('đường hỏng: Thành viên không thấy nút và API trả 403; bản chưa lưu trữ → 409; còn bản vẽ con đã lưu trữ → 409 nêu tên con; không xoá gì', async ({ browser, page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const parentName = `E2E Cha VV ${stamp}`;
    const parent = await createDiagram(page, parentName);
    const childName = `E2E Con VV ${stamp}`;
    const child = await createDiagram(page, childName, parent);
    await stepUpViaApi(page, secret, 'diagram');
    const v1 = await save(page, parent, 'Bản cha E2E');
    await publish(page, parent, v1.id);

    const live = await page.request.post(`/api/v1/diagrams/${parent}/erase`, { headers: await writeHeaders(page), data: { name: parentName }, failOnStatusCode: false });
    expect(live.status()).toBe(409);
    expect(((await live.json()) as { code: string }).code).toBe('DIAGRAM_NOT_ARCHIVED');

    await archive(page, child);
    await archive(page, parent);
    const blocked = await page.request.post(`/api/v1/diagrams/${parent}/erase`, { headers: await writeHeaders(page), data: { name: parentName }, failOnStatusCode: false });
    expect(blocked.status()).toBe(409);
    expect(((await blocked.json()) as { message: string }).message).toContain(childName);
    expect(seqsOf(parent)).toBe('1');

    const member = await (await browser.newContext()).newPage();
    const memberSecret = await firstLogin(member, E2E_MEMBER);
    await stepUpViaApi(member, memberSecret, 'diagram');
    await member.goto('/diagrams?archived=1');
    const section = member.getByRole('region', { name: /Bản vẽ đã lưu trữ/ });
    await expect(section.getByText(parentName, { exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: /Xóa vĩnh viễn/ })).toHaveCount(0);
    const forbidden = await member.request.post(`/api/v1/diagrams/${child}/erase`, { headers: await writeHeaders(member), data: { name: childName }, failOnStatusCode: false });
    expect(forbidden.status()).toBe(403);
    expect(sql(`SELECT count(*) FROM diagram WHERE id IN ('${parent}', '${child}') AND deleted_at IS NULL`)).toBe('2');
    await member.context().close();
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
