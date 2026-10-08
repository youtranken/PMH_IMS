import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  catalogItem,
  createTestSubnet,
  firstLogin,
  horizontalOverflow,
  resetCatalog,
  resetDevices,
  resetDiagrams,
  resetIpam,
  resetSecrets,
  resetUsers,
  sql,
  stepUpViaApi,
  uniqueStamp,
  writeHeaders,
  diagramBarAction,
} from './helpers';

/*
 * Sơ đồ mạng — bản vẽ con, khung VLAN, khung tủ (FR-039, AD-18): khung gắn bản vẽ con bấm xuống,
 * thanh đường dẫn bấm lên (trong ân hạn không hỏi lại mã); khung VLAN ra thẻ dải; "Chèn tủ mạng" dựng
 * khung tủ chứa máy của tủ ("Gắn khung" đã bỏ — Q-26 08/10 — khung gắn từ trước vẫn bấm được ở
 * chế độ Xem). Luật kiểm lúc lưu + bố cục
 * khung tủ dồn ở `api/test/diagram-frames.spec.ts` và `diagram-frames.spec.ts`; bài này giữ mức
 * khói trên stack thật.
 */

test.beforeEach(() => {
  resetUsers();
  resetSecrets();
  resetDevices();
  resetIpam();
  resetDiagrams();
  resetCatalog();
});

async function createDiagram(page: Page, name: string, parentId?: string): Promise<string> {
  const res = await page.request.post('/api/v1/diagrams', {
    headers: await writeHeaders(page),
    data: { name, nodeType: parentId ? 'floor' : 'company', ...(parentId ? { parentId } : {}) },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const page1 = (body: string) =>
  `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;

function frameCell(id: string, label: string, attrs: Record<string, string>, x: number): string {
  const extra = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  return `<UserObject label="${label}"${extra} id="${id}"><mxCell style="rounded=0;container=1;" vertex="1" parent="1"><mxGeometry x="${x}" y="20" width="160" height="100" as="geometry"/></mxCell></UserObject>`;
}

function svgOf(cells: { id: string; label: string; x: number }[]): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="600px" height="160px" viewBox="-0.5 -0.5 600 160"><g data-cell-id="0"><g data-cell-id="1">' +
    cells.map((c) => `<g data-cell-id="${c.id}"><rect x="${c.x}" y="20" width="160" height="100"/><text x="${c.x + 10}" y="60">${c.label}</text></g>`).join('') +
    '</g></g></svg>'
  );
}

async function saveVersion(page: Page, diagramId: string, body: string, cells: { id: string; label: string; x: number }[]) {
  return page.request.post(`/api/v1/diagrams/${diagramId}/versions`, {
    headers: await writeHeaders(page),
    data: { xml: page1(body), svg: svgOf(cells), basedOnVersionId: null },
  });
}

function viewer(page: Page) {
  return page.getByRole('region', { name: 'Bản vẽ, chỉ xem' });
}

test.describe('Sơ đồ mạng — bản vẽ con, khung VLAN, khung tủ', () => {
  test('bấm khung bản vẽ con xuống Tower, đường dẫn bấm lên Tổng (không hỏi lại mã); khung VLAN ra thẻ dải', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const rootName = `E2E Tổng ${stamp}`;
    const towerName = `E2E Tower ${stamp}`;
    const root = await createDiagram(page, rootName);
    const tower = await createDiagram(page, towerName, root);
    const subnet = await createTestSubnet(page, await writeHeaders(page), `E2E VLAN khung ${stamp}`, Number(stamp.slice(-3)) || 31);
    await stepUpViaApi(page, secret, 'diagram');
    const saved = await saveVersion(
      page,
      root,
      frameCell('f-tower', 'Tower', { ims_child_diagram_id: tower }, 20) + frameCell('f-vlan', 'VLAN 10', { ims_subnet_id: subnet.id }, 220),
      [
        { id: 'f-tower', label: 'Tower', x: 20 },
        { id: 'f-vlan', label: 'VLAN 10', x: 220 },
      ],
    );
    expect(saved.status(), await saved.text()).toBe(201);

    await page.goto(`/diagrams/${root}`);
    await viewer(page).getByRole('button', { name: `Mở bản vẽ con "${towerName}"` }).click();
    await expect(page).toHaveURL(new RegExp(`/diagrams/${tower}$`));
    await expect(page.getByRole('heading', { level: 1, name: towerName })).toBeVisible();
    // Trong ân hạn mã sơ đồ: không bật hộp hỏi mã khi xuống bản vẽ con.
    await expect(page.getByRole('dialog', { name: 'Nhập mã 6 số để mở sơ đồ' })).toHaveCount(0);

    const crumbs = page.getByRole('navigation', { name: 'Đường dẫn bản vẽ' });
    await crumbs.getByRole('link', { name: rootName }).click();
    await expect(page).toHaveURL(new RegExp(`/diagrams/${root}$`));
    await expect(page.getByRole('heading', { level: 1, name: rootName })).toBeVisible();

    await viewer(page).getByRole('button', { name: 'Khung VLAN VLAN 10' }).click();
    const card = page.getByRole('dialog', { name: `Dải 172.16.${subnet.octet}.0/29` });
    await expect(card).toBeVisible();
    await expect(card.getByText('0 đã cấp / 6 còn trống (tổng 6)')).toBeVisible();
    await expect(card.getByText(`172.16.${subnet.octet}.1, 172.16.${subnet.octet}.2`, { exact: false })).toBeVisible();
  });

  test('đường hỏng: gắn bản vẽ khác nhánh → 400 kèm lý do; bản vẽ con lưu trữ sau đó → khung dấu vàng, bấm chỉ báo', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const root = await createDiagram(page, `E2E Gốc hỏng ${stamp}`);
    const room = await createDiagram(page, `E2E Phòng cũ ${stamp}`, root);
    const other = await createDiagram(page, `E2E Nhánh khác ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');

    const wrong = await saveVersion(page, root, frameCell('f1', 'Sai', { ims_child_diagram_id: other }, 20), [{ id: 'f1', label: 'Sai', x: 20 }]);
    expect(wrong.status()).toBe(400);
    expect(((await wrong.json()) as { code: string; message: string }).message).toContain('không nằm dưới bản vẽ này');

    const ok = await saveVersion(page, root, frameCell('f1', 'Phòng cũ', { ims_child_diagram_id: room }, 20), [{ id: 'f1', label: 'Phòng cũ', x: 20 }]);
    expect(ok.status(), await ok.text()).toBe(201);
    const archived = await page.request.post(`/api/v1/diagrams/${room}/archive`, { headers: await writeHeaders(page) });
    expect(archived.status(), await archived.text()).toBe(201);

    await page.goto(`/diagrams/${root}`);
    const frame = viewer(page).getByRole('button', { name: `E2E Phòng cũ ${stamp} (đã lưu trữ)` });
    await frame.click();
    await expect(page.getByText(`Bản vẽ con "E2E Phòng cũ ${stamp}" đã lưu trữ`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/diagrams/${root}$`));
  });

  test('màn sửa: "Chèn tủ mạng" dựng khung tủ chứa máy của tủ; lưu giữ khung + máy', async ({ page }) => {
    test.setTimeout(240_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const siteCode = `E2E-KH${stamp}`;
    const siteId = await catalogItem(page, 'site', { code: siteCode, name: `Site khung E2E ${stamp}` });
    const cabinetId = await catalogItem(page, 'cabinet', { siteId, code: `E2E-R${stamp}`, uHeight: 12 });
    const catalog = (await (await page.request.get('/api/v1/catalog')).json()) as { deviceTypes: { id: string; name: string }[] };
    const typeId = catalog.deviceTypes.find((t) => t.name === 'Switch')!.id;
    const code = `SW-E2E-TU${stamp}`;
    const device = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: { code, name: `Switch tủ ${code}`, deviceTypeId: typeId, siteId, cabinetId },
    });
    expect(device.status(), await device.text()).toBe(201);
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    const root = await createDiagram(page, `E2E Sửa khung ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');
    const seeded = await saveVersion(
      page,
      root,
      `<mxCell id="s-floor" value="E2E Tầng" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="160" height="100" as="geometry"/></mxCell>`,
      [{ id: 's-floor', label: 'E2E Tầng', x: 20 }],
    );
    expect(seeded.status(), await seeded.text()).toBe(201);

    await page.goto(`/diagrams/${root}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    await diagramBarAction(page, 'Chèn tủ mạng');
    const box = page.getByRole('dialog', { name: 'Chèn khung tủ có sẵn máy' });
    await box.getByRole('button', { name: 'Tủ mạng', exact: true }).click();
    await page.getByRole('option', { name: `${siteCode} · E2E-R${stamp}` }).click();
    await box.getByRole('button', { name: 'Chèn tủ mạng' }).click();
    await expect(page.getByText(`Đã chèn khung tủ E2E-R${stamp} (1 thiết bị).`)).toBeVisible();

    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${root}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    const xml = sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${root}' ORDER BY seq DESC LIMIT 1`);
    expect(xml).toContain(`ims_cabinet_id="${cabinetId}"`);
    expect(xml).toContain(`ims_device_id="${deviceId}"`);
    expect(xml).toContain('mxgraph.rackGeneral.rackCabinet3');
  });

  test('390px: đường dẫn đọc được, bấm khung xuống bản vẽ con, không tràn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const root = await createDiagram(page, `E2E Tổng ĐT ${stamp}`);
    const child = await createDiagram(page, `E2E Con ĐT ${stamp}`, root);
    await stepUpViaApi(page, secret, 'diagram');
    const saved = await saveVersion(page, root, frameCell('f1', 'Con', { ims_child_diagram_id: child }, 20), [{ id: 'f1', label: 'Con', x: 20 }]);
    expect(saved.status(), await saved.text()).toBe(201);

    await page.goto(`/diagrams/${root}`);
    await viewer(page).getByRole('button', { name: `Mở bản vẽ con "E2E Con ĐT ${stamp}"` }).click();
    await expect(page).toHaveURL(new RegExp(`/diagrams/${child}$`));
    await expect(page.getByRole('navigation', { name: 'Đường dẫn bản vẽ' }).getByRole('link', { name: `E2E Tổng ĐT ${stamp}` })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
