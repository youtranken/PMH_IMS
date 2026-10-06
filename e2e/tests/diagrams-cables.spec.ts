import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  catalogTab,
  firstLogin,
  horizontalOverflow,
  resetCatalog,
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
 * Sơ đồ mạng — dây gắn sơ đồ cổng (Q-23 "vẽ là khai, có hỏi", AD-18). Logic so XML hai lần
 * autosave, luật dây và hydrate dồn ở bài đơn vị (`cable-diff.test.ts`, `diagram-checks.spec.ts`,
 * `diagram-hydrate.spec.ts`) và `api/test/diagrams.spec.ts`; bài này giữ mức khói trên stack thật.
 * Không vẽ nét bằng chuột trong iframe draw.io: bản vẽ có sẵn một nét chưa khai (dựng qua API),
 * hộp "Khai" mở từ nút "Dây chưa khai" — cùng hộp, cùng đường ghi với nét vừa vẽ.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetDiagrams();
  resetCatalog();
});

async function catalog(page: Page) {
  const res = await page.request.get('/api/v1/catalog?includeInactive=true');
  return (await res.json()) as { deviceTypes: { id: string; name: string }[]; cableTypes: { id: string; name: string; colorSlot: number }[] };
}

async function createDevice(page: Page, code: string): Promise<string> {
  const typeId = (await catalog(page)).deviceTypes.find((t) => t.name === 'Switch')!.id;
  const created = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { code, name: `Máy ${code}`, deviceTypeId: typeId },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

async function createDiagram(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/v1/diagrams', { headers: await writeHeaders(page), data: { name, nodeType: 'room' } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Khai dây qua đúng endpoint mà hộp "Khai" gọi. */
async function link(page: Page, from: string, portLabel: string, to: string, connectedPort: string, cableTypeId = '') {
  const res = await page.request.post(`/api/v1/devices/${from}/ports/link`, {
    headers: await writeHeaders(page),
    data: { portLabel, connectedDeviceId: to, connectedPort, cableTypeId },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

type Dev = { cell: string; id: string; code: string };

/** Bản vẽ: các máy + các nét (`linkId` vắng = nét chưa khai), XML + SVG như trình vẽ xuất. */
async function saveDrawing(page: Page, diagramId: string, devices: Dev[], edges: { cell: string; from: string; to: string; linkId?: string }[]) {
  const cells = devices
    .map(
      (d, i) =>
        `<UserObject label="${d.code}" ims_device_id="${d.id}" ims_device_code="${d.code}" id="${d.cell}"><mxCell style="rounded=1;" vertex="1" parent="1"><mxGeometry x="${20 + i * 200}" y="20" width="120" height="50" as="geometry"/></mxCell></UserObject>`,
    )
    .join('');
  const lines = edges
    .map((e) =>
      e.linkId
        ? `<UserObject label="" ims_link_id="${e.linkId}" id="${e.cell}"><mxCell style="endArrow=none;" edge="1" parent="1" source="${e.from}" target="${e.to}"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject>`
        : `<mxCell id="${e.cell}" value="" style="endArrow=none;" edge="1" parent="1" source="${e.from}" target="${e.to}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    )
    .join('');
  const xml = `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}${lines}</root></mxGraphModel></diagram></mxfile>`;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="700px" height="100px" viewBox="-0.5 -0.5 700 100"><g data-cell-id="0"><g data-cell-id="1">' +
    devices.map((d, i) => `<g data-cell-id="${d.cell}"><rect x="${20 + i * 200}" y="20" width="120" height="50"/><text x="${30 + i * 200}" y="50">${d.code}</text></g>`).join('') +
    edges.map((e) => `<g data-cell-id="${e.cell}"><path d="M 140 45 L 220 45" fill="none" stroke="#000000"/></g>`).join('') +
    '</g></g></svg>';
  const res = await page.request.post(`/api/v1/diagrams/${diagramId}/versions`, { headers: await writeHeaders(page), data: { xml, svg, basedOnVersionId: null } });
  expect(res.status(), await res.text()).toBe(201);
}

/** Màu nét đang hiện (computed) và màu của token ô màu giấy (giấy luôn sáng ở cả hai theme — V-05). */
async function strokeVsToken(page: Page, cellId: string, token: string): Promise<[string, string]> {
  return page.evaluate(
    ([id, name]) => {
      const path = document.querySelector(`[data-cell-id="${id}"] path`) as SVGPathElement;
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      document.body.appendChild(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      return [getComputedStyle(path).stroke, want];
    },
    [cellId, token],
  );
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
}

test.describe('Sơ đồ mạng — dây gắn sơ đồ cổng', () => {
  test('Danh mục: loại dây seed Cat6/Fiber/DAC; thêm loại mới chọn ô màu (không có ô nhập hex)', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    await page.goto('/admin/catalog');
    await page.getByRole('tab', { name: catalogTab('Loại dây') }).click();
    for (const name of ['Cat6', 'Fiber', 'DAC']) await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Thêm loại dây' }).click();
    const form = page.getByRole('dialog', { name: /Thêm loại dây/ });
    await form.getByRole('textbox', { name: /^Tên/ }).fill(`E2E Cáp đồng trục ${stamp}`);
    await expect(form.getByRole('radio')).toHaveCount(8);
    await form.getByRole('radio', { name: 'Ô màu 5' }).check();
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(form).toHaveCount(0);
    expect(sql(`SELECT color_slot FROM cable_type WHERE name = 'E2E Cáp đồng trục ${stamp}'`)).toBe('5');
  });

  test('Khai từ nét chưa khai: hộp chỉ gợi ý cổng trống, "Khai" ghi sơ đồ cổng; trang thiết bị thấy kết nối mới', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const sw = { cell: 'a', id: await createDevice(page, `SW-E2E-DAY${stamp}`), code: `SW-E2E-DAY${stamp}` };
    const srv = { cell: 'b', id: await createDevice(page, `SRV-E2E-DAY${stamp}`), code: `SRV-E2E-DAY${stamp}` };
    const id = await createDiagram(page, `E2E Dây khai ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');
    await saveDrawing(page, id, [sw, srv], [{ cell: 'e1', from: 'a', to: 'b' }]);

    await page.goto(`/diagrams/${id}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    await diagramBarAction(page, 'Dây chưa khai');
    await page.getByRole('button', { name: `${sw.code} ↔ ${srv.code}` }).click();
    const box = page.getByRole('dialog', { name: 'Khai kết nối này vào sơ đồ cổng?' });
    await expect(box).toBeVisible();
    await box.getByRole('combobox', { name: `Cổng của ${sw.code}` }).fill('Gi1/0/24');
    await box.getByRole('combobox', { name: `Cổng của ${srv.code}` }).fill('eth0');
    await box.getByRole('button', { name: 'Loại dây' }).click();
    await page.getByRole('option', { name: 'Fiber' }).click();
    const [declared] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/devices/${sw.id}/ports/link`) && r.request().method() === 'POST'),
      box.getByRole('button', { name: 'Khai', exact: true }).click(),
    ]);
    expect(declared.status(), await declared.text()).toBe(201);
    await expect(box).toHaveCount(0);
    await expect(page.getByText(/Đã khai .* vào sơ đồ cổng\./)).toBeVisible();

    // Lưu bản vẽ: nét mang ims_link_id; lưu KHÔNG ghi thêm gì vào sơ đồ cổng (AD-18).
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${id}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    expect(sql(`SELECT count(*) FROM device_port WHERE device_id = '${sw.id}' OR connected_device_id = '${sw.id}'`)).toBe('1');
    expect(sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${id}' ORDER BY seq DESC LIMIT 1`)).toContain('ims_link_id=');

    // Trang thiết bị của đầu kia thấy kết nối mới.
    await page.goto(`/devices/${srv.id}`);
    await page.getByRole('tab', { name: 'Sơ đồ cổng' }).click();
    await expect(page.getByRole('link', { name: sw.code, exact: true })).toBeVisible();
  });

  test('đường hỏng: khai vào cổng đã có cáp (dựng sẵn bằng API) → lỗi đỏ TRONG hộp, sơ đồ cổng không đổi; "Chỉ vẽ" giữ nét', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const sw = { cell: 'a', id: await createDevice(page, `SW-E2E-CHIEM${stamp}`), code: `SW-E2E-CHIEM${stamp}` };
    const srv = { cell: 'b', id: await createDevice(page, `SRV-E2E-CHIEM${stamp}`), code: `SRV-E2E-CHIEM${stamp}` };
    const other = await createDevice(page, `AP-E2E-CHIEM${stamp}`);
    await link(page, sw.id, 'Gi1/0/24', other, 'eth0');
    const before = sql(`SELECT count(*) FROM device_port WHERE device_id IN ('${sw.id}', '${srv.id}')`);
    const id = await createDiagram(page, `E2E Dây chiếm ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');
    await saveDrawing(page, id, [sw, srv], [{ cell: 'e1', from: 'a', to: 'b' }]);

    await page.goto(`/diagrams/${id}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    await diagramBarAction(page, 'Dây chưa khai');
    await page.getByRole('button', { name: `${sw.code} ↔ ${srv.code}` }).click();
    const box = page.getByRole('dialog', { name: 'Khai kết nối này vào sơ đồ cổng?' });
    // Cổng đã có cáp báo NGAY tại ô (không hoa/thường), Khai không gửi gì.
    await box.getByRole('combobox', { name: `Cổng của ${sw.code}` }).fill('gi1/0/24');
    await expect(box.getByRole('alert')).toContainText(`Cổng gi1/0/24 của ${sw.code} đã nối AP-E2E-CHIEM${stamp}`);
    let posted = false;
    page.on('request', (r) => {
      if (r.url().endsWith(`/api/v1/devices/${sw.id}/ports/link`)) posted = true;
    });
    await box.getByRole('button', { name: 'Khai', exact: true }).click();
    await expect(box.getByRole('alert')).toBeVisible();
    expect(posted).toBe(false);
    // Server vẫn là trọng tài: gọi thẳng endpoint với cổng đó → 409, câu tiếng Việt.
    const direct = await page.request.post(`/api/v1/devices/${sw.id}/ports/link`, {
      headers: await writeHeaders(page),
      data: { portLabel: 'gi1/0/24', connectedDeviceId: srv.id, connectedPort: '', cableTypeId: '' },
      failOnStatusCode: false,
    });
    expect(direct.status()).toBe(409);
    expect(await direct.text()).toContain('đã có cáp');
    expect(sql(`SELECT count(*) FROM device_port WHERE device_id IN ('${sw.id}', '${srv.id}')`)).toBe(before);
    await box.getByRole('button', { name: 'Chỉ vẽ' }).click();
    await expect(box).toHaveCount(0);
  });

  test('chiều ngược: gỡ kết nối ở trang thiết bị → nét đỏ; nét chưa khai vàng; tô sáng; màu dây theo token cả sáng lẫn tối', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const fiber = (await catalog(page)).cableTypes.find((c) => c.name === 'Fiber')!.id;
    const sw = { cell: 'a', id: await createDevice(page, `SW-E2E-NGUOC${stamp}`), code: `SW-E2E-NGUOC${stamp}` };
    const srv = { cell: 'b', id: await createDevice(page, `SRV-E2E-NGUOC${stamp}`), code: `SRV-E2E-NGUOC${stamp}` };
    const ap = { cell: 'c', id: await createDevice(page, `AP-E2E-NGUOC${stamp}`), code: `AP-E2E-NGUOC${stamp}` };
    const kept = await link(page, sw.id, 'Gi1/0/1', srv.id, 'eth0', fiber);
    const gone = await link(page, sw.id, 'Gi1/0/2', ap.id, 'eth0');
    const id = await createDiagram(page, `E2E Dây ngược ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');
    await saveDrawing(page, id, [sw, srv, ap], [
      { cell: 'e1', from: 'a', to: 'b', linkId: kept },
      { cell: 'e2', from: 'a', to: 'c', linkId: gone },
      { cell: 'e3', from: 'b', to: 'c' },
    ]);
    // Gỡ ở trang thiết bị (endpoint gỡ của devices).
    const unlinked = await page.request.post(`/api/v1/devices/${sw.id}/ports/${gone}/unlink`, { headers: await writeHeaders(page) });
    expect(unlinked.status(), await unlinked.text()).toBe(201);

    await page.goto(`/diagrams/${id}`);
    const viewer = page.getByRole('region', { name: 'Bản vẽ, chỉ xem' });
    const red = viewer.getByRole('button', { name: 'Kết nối đã bị gỡ khỏi sơ đồ cổng.' });
    await expect(red).toHaveAttribute('data-ims-paint', 'danger');
    await expect(viewer.getByRole('button', { name: 'Chưa khai vào sơ đồ cổng.' })).toHaveAttribute('data-ims-paint', 'warn');
    await expect(viewer.getByRole('button', { name: 'Gi1/0/1 ↔ eth0' })).toHaveAttribute('data-ims-paint', 'cable-2');
    await expect(page.getByRole('list', { name: 'Chú giải màu dây' })).toContainText('Fiber');

    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      const [fiberStroke, fiberToken] = await strokeVsToken(page, 'e1', '--paper-cable-2');
      expect(fiberStroke).toBe(fiberToken);
      const [warnStroke, warnToken] = await strokeVsToken(page, 'e3', '--paper-cable-warn');
      expect(warnStroke).toBe(warnToken);
      const [redStroke, redToken] = await strokeVsToken(page, 'e2', '--paper-cable-danger');
      expect(redStroke).toBe(redToken);
    }

    // Tô sáng: bấm SRV → dây của nó + máy đầu kia sáng, phần còn lại mờ (cả hai theme).
    await viewer.getByRole('button', { name: srv.code, exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByText(`Đang tô sáng dây của ${srv.code}.`)).toBeVisible();
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      const dimmed = await page.evaluate(() => Array.from(document.querySelectorAll('[data-ims-dim]')).map((el) => el.getAttribute('data-cell-id')).sort());
      expect(dimmed).toEqual(['e2']);
    }
  });

  test('kết nối mới giữa hai máy đã có trên bản vẽ → "Có 1 kết nối mới chưa vẽ" → "Vẽ vào" → lưu có dây gắn link', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const sw = { cell: 'a', id: await createDevice(page, `SW-E2E-MOI${stamp}`), code: `SW-E2E-MOI${stamp}` };
    const srv = { cell: 'b', id: await createDevice(page, `SRV-E2E-MOI${stamp}`), code: `SRV-E2E-MOI${stamp}` };
    const id = await createDiagram(page, `E2E Dây mới ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');
    await saveDrawing(page, id, [sw, srv], []);
    const fresh = await link(page, sw.id, 'Gi1/0/5', srv.id, 'eth1');

    await page.goto(`/diagrams/${id}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByText('Có 1 kết nối mới chưa vẽ')).toBeVisible();
    await page.getByRole('button', { name: 'Vẽ vào' }).click();
    await expect(page.getByText('Đã vẽ 1 dây vào bản vẽ.')).toBeVisible();
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${id}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    expect(((await saved.json()) as { summary: string }).summary).toBe('Thêm 1 dây');
    const xml = sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${id}' ORDER BY seq DESC LIMIT 1`);
    expect(xml).toContain(`ims_link_id="${fresh}"`);
    // Dây không có mũi tên ở đầu nào (V-04): trình vẽ bỏ cả hai đầu khi tô màu dây của kho.
    expect(xml).toMatch(/endArrow=none;startArrow=none;/);
    expect(xml).not.toMatch(/(end|start)Arrow=classic/);
    // Nhãn cổng ở HAI ĐẦU dây (Q-23 06/10): XML lưu chỉ có cờ, ô nhãn đầu không lưu; ảnh xem có
    // hai nhãn riêng ("Gi1/0/5" sát SW, "eth1" sát SRV), không còn "Gi1/0/5 ↔ eth1" giữa dây.
    expect(xml).toContain('ims_port_labels="ends"');
    expect(xml).not.toContain('imsPortEnd');
    const svg = sql(`SELECT svg FROM diagram_version WHERE diagram_id = '${id}' ORDER BY seq DESC LIMIT 1`);
    expect(svg).toMatch(/>Gi1\/0\/5</);
    expect(svg).toMatch(/>eth1</);
    expect(svg).not.toContain('Gi1/0/5 ↔ eth1');
    const reopened = await page.request.get(`/api/v1/diagrams/${id}/content?mode=edit`);
    const wet = ((await reopened.json()) as { version: { xml: string } }).version.xml;
    expect(wet).toMatch(/-ims-ps" value="Gi1\/0\/5"/);
    expect(wet).toMatch(/-ims-pt" value="eth1"/);
  });

  test('390px: chế độ xem — chú giải màu dây và thẻ dây không tràn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const sw = { cell: 'a', id: await createDevice(page, `SW-E2E-DT${stamp}`), code: `SW-E2E-DT${stamp}` };
    const srv = { cell: 'b', id: await createDevice(page, `SRV-E2E-DT${stamp}`), code: `SRV-E2E-DT${stamp}` };
    const linkId = await link(page, sw.id, 'Gi1/0/9', srv.id, 'eth0');
    const id = await createDiagram(page, `E2E Dây điện thoại ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');
    await saveDrawing(page, id, [sw, srv], [{ cell: 'e1', from: 'a', to: 'b', linkId }]);

    await page.goto(`/diagrams/${id}`);
    // Ở 390px chú giải thu sau nút, mặc định đóng — mở sẵn thì nó che bản vẽ và nút thu phóng (V-02).
    const legendToggle = page.getByRole('button', { name: 'Chú giải dây' });
    await expect(legendToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('list', { name: 'Chú giải màu dây' })).toHaveCount(0);
    await legendToggle.click();
    await expect(page.getByRole('list', { name: 'Chú giải màu dây' })).toBeVisible();
    // Nét ngang có hộp bao cao 0 (Playwright coi là "không hiện" dù nét vẫn vẽ): mở thẻ bằng bàn phím.
    const cable = page.getByRole('region', { name: 'Bản vẽ, chỉ xem' }).getByRole('button', { name: 'Gi1/0/9 ↔ eth0' });
    await cable.focus();
    await cable.press('Enter');
    const card = page.getByRole('dialog', { name: /^Dây / });
    await expect(card).toContainText(`${sw.code} Gi1/0/9`);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('máy thứ ba nối vào máy đã có dây: không cần khai số cổng; gõ trùng cổng báo tại ô, "Dùng cổng 2" rồi Khai; lời báo chỉ sơ đồ cổng', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const sw = { cell: 'a', id: await createDevice(page, `SW-E2E-BA${stamp}`), code: `SW-E2E-BA${stamp}` };
    const pcB = { cell: 'b', id: await createDevice(page, `PC-E2E-BB${stamp}`), code: `PC-E2E-BB${stamp}` };
    const pcC = { cell: 'c', id: await createDevice(page, `PC-E2E-BC${stamp}`), code: `PC-E2E-BC${stamp}` };
    const first = await link(page, sw.id, '1', pcB.id, '1');
    const id = await createDiagram(page, `E2E Máy thứ ba ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');
    await saveDrawing(page, id, [sw, pcB, pcC], [
      { cell: 'e1', from: 'a', to: 'b', linkId: first },
      { cell: 'e2', from: 'c', to: 'a' },
    ]);

    await page.goto(`/diagrams/${id}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    await diagramBarAction(page, 'Dây chưa khai');
    await page.getByRole('button', { name: `${pcC.code} ↔ ${sw.code}` }).click();
    const box = page.getByRole('dialog', { name: 'Khai kết nối này vào sơ đồ cổng?' });
    await expect(box.getByText(`${pcC.code} chưa khai cổng nào — gõ tên cổng mới`)).toBeVisible();
    await expect(box.getByText(`Cổng đang dùng của ${sw.code}: 1 → ${pcB.code}`)).toBeVisible();
    await box.getByRole('combobox', { name: `Cổng của ${pcC.code}` }).fill('1');
    await box.getByRole('combobox', { name: `Cổng của ${sw.code}` }).fill('1');
    await expect(box.getByRole('alert')).toContainText(`Cổng 1 của ${sw.code} đã nối ${pcB.code}`);
    await box.getByRole('button', { name: `Dùng cổng 2 cho ${sw.code}` }).click();
    await expect(box.getByRole('combobox', { name: `Cổng của ${sw.code}` })).toHaveValue('2');
    const [declared] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/devices/${pcC.id}/ports/link`) && r.request().method() === 'POST'),
      box.getByRole('button', { name: 'Khai', exact: true }).click(),
    ]);
    expect(declared.status(), await declared.text()).toBe(201);
    await expect(box).toHaveCount(0);
    expect(sql(`SELECT count(*) FROM device_port WHERE connected_device_id = '${sw.id}' AND connected_port = '2'`)).toBe('1');
    // Lời báo chỉ chỗ kết nối nằm; mở trong tab mới.
    const [tab] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('button', { name: `Xem ở sơ đồ cổng của ${pcC.code}` }).click()]);
    await tab.waitForLoadState();
    expect(tab.url()).toContain(`/devices/${pcC.id}?tab=ports`);
    await expect(tab.getByRole('link', { name: sw.code, exact: true })).toBeVisible();
    await tab.close();
  });
});

test.describe('Đi dây — bẻ dây bằng điểm uốn, không vẽ thêm nét (Q-23 05/10)', () => {
  test('bản vẽ kiểu "PMH Tower": dây đã khai bị kéo một đầu ra chỗ trống + nét tự do nối thêm → MỘT lỗi nêu đúng hai máy; "Tự đi lại dây" nối lại, lưu, phát hành được', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const sw = { id: await createDevice(page, `SW-E2E-DI${stamp}`), code: `SW-E2E-DI${stamp}` };
    const srv = { id: await createDevice(page, `SRV-E2E-DI${stamp}`), code: `SRV-E2E-DI${stamp}` };
    const linkId = await link(page, sw.id, 'Gi1/0/2', srv.id, 'Gi1/0/2');
    const id = await createDiagram(page, `E2E Đi dây ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');
    const xml =
      '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      `<UserObject label="${sw.code}" ims_device_id="${sw.id}" ims_device_code="${sw.code}" id="a"><mxCell style="rounded=1;" vertex="1" parent="1"><mxGeometry x="230" y="110" width="160" height="50" as="geometry"/></mxCell></UserObject>` +
      `<UserObject label="${srv.code}" ims_device_id="${srv.id}" ims_device_code="${srv.code}" id="b"><mxCell style="rounded=1;" vertex="1" parent="1"><mxGeometry x="240" y="370" width="160" height="50" as="geometry"/></mxCell></UserObject>` +
      // Dây đã khai: đầu đích bị kéo ra chỗ trống (90,560) như bản vẽ thật của chủ dự án.
      `<UserObject label="" ims_link_id="${linkId}" id="e1"><mxCell style="edgeStyle=orthogonalEdgeStyle;rounded=0;endArrow=none;exitX=0;exitY=0.5;" edge="1" parent="1" source="a"><mxGeometry relative="1" as="geometry"><mxPoint x="90" y="560" as="targetPoint"/></mxGeometry></mxCell></UserObject>` +
      // Hai nét tự do người vẽ thêm cho "vuông góc": một nét chạm máy — không phải lỗi.
      '<mxCell id="f1" value="" style="endArrow=none;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="90" y="560" as="sourcePoint"/><mxPoint x="320" y="560" as="targetPoint"/></mxGeometry></mxCell>' +
      '<mxCell id="f2" value="" style="endArrow=none;" edge="1" parent="1" target="b"><mxGeometry relative="1" as="geometry"><mxPoint x="320" y="560" as="sourcePoint"/></mxGeometry></mxCell>' +
      '</root></mxGraphModel></diagram></mxfile>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500px" height="600px" viewBox="0 0 500 600"><g data-cell-id="a"><rect x="230" y="110" width="160" height="50"/></g></svg>';
    const seeded = await page.request.post(`/api/v1/diagrams/${id}/versions`, { headers: await writeHeaders(page), data: { xml, svg, basedOnVersionId: null } });
    expect(seeded.status(), await seeded.text()).toBe(201);
    const v1 = ((await seeded.json()) as { id: string }).id;

    const blocked = await page.request.post(`/api/v1/diagrams/${id}/publish`, { headers: await writeHeaders(page), data: { versionId: v1 }, failOnStatusCode: false });
    expect(blocked.status()).toBe(400);
    const body = (await blocked.json()) as { code: string; errors: { cellId: string; message: string }[] };
    expect(body.code).toBe('DIAGRAM_CHECK_FAILED');
    expect(body.errors.map((e) => e.cellId)).toEqual(['e1']);
    expect(body.errors[0].message).toContain(`${sw.code} Gi1/0/2 ↔ ${srv.code} Gi1/0/2`);
    expect(body.errors[0].message).toContain(`kéo đầu dây về đúng máy ${srv.code}`);

    await page.goto(`/diagrams/${id}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toBeDisabled();
    await diagramBarAction(page, 'Tự đi lại dây');
    await expect(page.getByText('Đã đi lại 1 dây, nối lại 1 đầu dây về đúng máy. Bấm Lưu để giữ.')).toBeVisible();
    await page.screenshot({ path: process.env.IMS_SHOT_DIR ? `${process.env.IMS_SHOT_DIR}/day-tu-di-lai.png` : test.info().outputPath('day-tu-di-lai.png') });
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${id}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    const v2 = (await saved.json()) as { id: string; unchanged?: boolean };
    expect(v2.unchanged).toBeUndefined();
    const stored = sql(`SELECT xml FROM diagram_version WHERE id = '${v2.id}'`);
    // XML lưu do draw.io xuất có xuống dòng giữa thẻ.
    expect(stored).toMatch(/id="e1">\s*<mxCell[^>]*source="a"[^>]*target="b"/);
    expect(stored).not.toContain('exitX=0');
    // Dây người vẽ đụng tới ("Tự đi lại dây") chuyển sang nhãn cổng hai đầu (Q-23 06/10).
    expect(stored).toMatch(/ims_port_labels="ends"[^>]*id="e1"/);
    const ok = await page.request.post(`/api/v1/diagrams/${id}/publish`, { headers: await writeHeaders(page), data: { versionId: v2.id } });
    expect(ok.status(), await ok.text()).toBe(201);

    // Bấm Lưu lần nữa khi không đổi gì: nút đã tắt, không có phiên bản "Không đổi gì".
    await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toBeDisabled();
    expect(sql(`SELECT count(*) FROM diagram_version WHERE diagram_id = '${id}'`)).toBe('2');
  });
});
