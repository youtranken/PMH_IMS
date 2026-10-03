import { expect, test, type Page } from '@playwright/test';
import {
  diagramBarAction,
  E2E_SA,
  countAudit,
  expireStepUp,
  fillOtp,
  firstLogin,
  freshTotpCode,
  horizontalOverflow,
  resetCatalog,
  resetDevices,
  resetDiagrams,
  resetUsers,
  rowAction,
  stepUpViaApi,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/*
 * Sơ đồ mạng trên điện thoại + tìm / lớp / chỉ đường / trình chiếu (Q-23, AD-17, AD-18, FR-047,
 * FR-049). Logic thuần nằm ở bài đơn vị (`diagram-path.spec.ts`, `diagram-navigation.test.ts`,
 * `diagram-viewer.test.tsx`, `diagram-tree.test.ts`) và `api/test/diagram-navigation.spec.ts`;
 * bài này chạy trên stack thật, KHÔNG nạp draw.io (mọi thứ ở đây là trình xem SVG).
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetDiagrams();
  resetCatalog();
});

async function createDevice(page: Page, code: string): Promise<string> {
  const catalog = (await (await page.request.get('/api/v1/catalog?includeInactive=true')).json()) as { deviceTypes: { id: string; name: string }[] };
  const typeId = catalog.deviceTypes.find((t) => t.name === 'Switch')!.id;
  const created = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { code, name: `Máy ${code}`, deviceTypeId: typeId },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

async function createDiagram(page: Page, name: string, parentId?: string): Promise<string> {
  const res = await page.request.post('/api/v1/diagrams', {
    headers: await writeHeaders(page),
    data: parentId ? { name, nodeType: 'floor', parentId } : { name, nodeType: 'site' },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function link(page: Page, from: string, port: string, to: string, peerPort: string): Promise<string> {
  const res = await page.request.post(`/api/v1/devices/${from}/ports/link`, {
    headers: await writeHeaders(page),
    data: { portLabel: port, connectedDeviceId: to, connectedPort: peerPort },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

type Dev = { cell: string; id: string; code: string };

/**
 * Lưu + phát hành một bản vẽ: các máy, các nét đã khai, và (tuỳ chọn) một lớp "Camera" có một
 * hình tự do — XML + SVG như trình vẽ xuất (`data-cell-id` trên mọi ô).
 */
async function drawAndPublish(page: Page, id: string, devices: Dev[], edges: { cell: string; from: Dev; to: Dev; linkId: string }[], camera?: string) {
  const cells = devices
    .map(
      (d, i) =>
        `<UserObject label="${d.code}" ims_device_id="${d.id}" ims_device_code="${d.code}" id="${d.cell}"><mxCell style="rounded=1;" vertex="1" parent="1"><mxGeometry x="${20 + i * 200}" y="20" width="120" height="50" as="geometry"/></mxCell></UserObject>`,
    )
    .join('');
  const lines = edges
    .map(
      (e) =>
        `<UserObject label="" ims_link_id="${e.linkId}" id="${e.cell}"><mxCell style="endArrow=none;" edge="1" parent="1" source="${e.from.cell}" target="${e.to.cell}"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject>`,
    )
    .join('');
  const cameraLayer = camera
    ? `<mxCell id="L-cam" value="Camera E2E" parent="0"/><mxCell id="cam1" value="${camera}" style="ellipse;" vertex="1" parent="L-cam"><mxGeometry x="20" y="120" width="80" height="40" as="geometry"/></mxCell>`
    : '';
  const xml = `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}${lines}${cameraLayer}</root></mxGraphModel></diagram></mxfile>`;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="900px" height="200px" viewBox="-0.5 -0.5 900 200"><g data-cell-id="0"><g data-cell-id="1">' +
    devices.map((d, i) => `<g data-cell-id="${d.cell}"><rect x="${20 + i * 200}" y="20" width="120" height="50"/><text x="${30 + i * 200}" y="50">${d.code}</text></g>`).join('') +
    edges.map((e) => `<g data-cell-id="${e.cell}"><path d="M 140 45 L 220 45" fill="none" stroke="#000000"/><text x="150" y="40">Gi1 ↔ eth0</text></g>`).join('') +
    '</g>' +
    (camera ? `<g data-cell-id="L-cam"><g data-cell-id="cam1"><ellipse cx="60" cy="140" rx="40" ry="20"/><text x="30" y="145">${camera}</text></g></g>` : '') +
    '</g></svg>';
  const saved = await page.request.post(`/api/v1/diagrams/${id}/versions`, { headers: await writeHeaders(page), data: { xml, svg, basedOnVersionId: null } });
  expect(saved.status(), await saved.text()).toBe(201);
  const published = await page.request.post(`/api/v1/diagrams/${id}/publish`, { headers: await writeHeaders(page), data: {} });
  expect(published.status(), await published.text()).toBeLessThan(300);
}

/** Tầng (PC — SW, có lớp Camera) nằm dưới Lõi (CORE — ISP); dây thật PC—SW—CORE—ISP; LAP không dây nào. */
async function network(page: Page, secret: string) {
  const stamp = uniqueStamp();
  const dev = async (cell: string, code: string): Promise<Dev> => ({ cell, id: await createDevice(page, code), code });
  const pc = await dev('a', `PC-E2E-NAV${stamp}`);
  const sw = await dev('b', `SW-E2E-NAV${stamp}`);
  const core = await dev('c', `CORE-E2E-NAV${stamp}`);
  const isp = await dev('d', `ISP-E2E-NAV${stamp}`);
  const lap = await dev('e', `LAP-E2E-NAV${stamp}`);
  const pcSw = await link(page, pc.id, 'eth0', sw.id, 'Gi1/0/1');
  await link(page, sw.id, 'Te1/0/1', core.id, 'Te1/0/48');
  const coreIsp = await link(page, core.id, 'Gi0/0', isp.id, 'wan0');
  await stepUpViaApi(page, secret, 'diagram');
  const coreName = `E2E Lõi ${stamp}`;
  const floorName = `E2E Tầng NAV ${stamp}`;
  const coreId = await createDiagram(page, coreName);
  const floorId = await createDiagram(page, floorName, coreId);
  await drawAndPublish(page, coreId, [core, isp], [{ cell: 'e2', from: core, to: isp, linkId: coreIsp }]);
  await drawAndPublish(page, floorId, [pc, sw, lap], [{ cell: 'e1', from: pc, to: sw, linkId: pcSw }], `Cam E2E sảnh ${stamp}`);
  return { stamp, pc, sw, core, isp, lap, coreId, coreName, floorId, floorName };
}

function viewer(page: Page) {
  return page.getByRole('region', { name: 'Bản vẽ, chỉ xem' });
}

async function search(page: Page, q: string) {
  await page.getByRole('button', { name: 'Tìm', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Mã, tên hoặc IP' }).fill(q);
  await page.getByRole('button', { name: 'Tìm và bay tới' }).click();
}

test.describe('Sơ đồ mạng — điện thoại, tìm, lớp, chỉ đường, trình chiếu', () => {
  test('390px: trình xem chạy không draw.io; đường dẫn sửa thành chế độ xem + lời nhắn; bấm máy ra thẻ; tìm bay tới', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const secret = await firstLogin(page, E2E_SA);
    const net = await network(page, secret);

    await page.goto(`/diagrams/${net.floorId}?mode=edit`);
    await expect(viewer(page).getByText(net.pc.code)).toBeVisible();
    await expect(page.getByText('Sửa sơ đồ chỉ làm trên máy tính')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Sửa' })).toHaveCount(0);
    for (const name of ['Gửi duyệt', 'Phát hành', 'Phiên bản', 'Tạo bản trình bày']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // Bấm thiết bị → thẻ (bottom sheet) đọc từ kho.
    await viewer(page).getByRole('button', { name: net.sw.code }).click();
    const card = page.getByRole('dialog', { name: net.sw.code });
    await expect(card).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);

    // Tìm theo mã → bay tới + tô sáng máy và dây của nó.
    await search(page, net.pc.code.toLowerCase());
    await expect(page.getByText(`Đang tô sáng dây của ${net.pc.code}.`)).toBeVisible();
    await expect(page.getByRole('status', { name: 'Mức thu phóng' })).toHaveText(/^(1\d\d|[2-9]\d\d)%$/);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('tìm: máy ở bản vẽ khác → mở bản vẽ đó và bay tới; không khớp gì → báo không tìm thấy', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const net = await network(page, secret);
    await page.goto(`/diagrams/${net.floorId}`);
    await expect(viewer(page).getByText(net.pc.code)).toBeVisible();

    await search(page, net.core.code);
    const elsewhere = page.getByRole('link', { name: `${net.core.code} — ${net.coreName}` });
    await expect(elsewhere).toBeVisible();
    await elsewhere.click();
    await expect(page).toHaveURL(new RegExp(`/diagrams/${net.coreId}\\?focus=${net.core.id}`));
    await expect(page.getByRole('heading', { level: 1, name: net.coreName })).toBeVisible();
    await expect(page.getByText(`Đang tô sáng dây của ${net.core.code}.`)).toBeVisible();

    await search(page, `KHONG-CO-E2E-${net.stamp}`);
    await expect(page.getByText(`Không tìm thấy "KHONG-CO-E2E-${net.stamp}" trên bản vẽ này hay trong kho.`)).toBeVisible();
  });

  test('lớp: tắt lớp draw.io "Camera E2E" ẩn hình của lớp đó, bật lại thì hiện; watermark không phải một lớp', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const net = await network(page, secret);
    await page.goto(`/diagrams/${net.floorId}`);
    const cam = viewer(page).getByText(`Cam E2E sảnh ${net.stamp}`);
    await expect(cam).toBeVisible();

    await viewer(page).getByRole('button', { name: 'Lớp' }).click();
    const panel = page.getByRole('dialog', { name: 'Bật/tắt lớp' });
    await expect(panel.getByRole('checkbox', { name: 'Lớp nền' })).toBeChecked();
    // Watermark "tên · email · giờ" không bao giờ là một lớp: không ô tick nào mang email người xem.
    await expect(panel.getByRole('checkbox', { name: /@/ })).toHaveCount(0);
    await panel.getByRole('checkbox', { name: 'Camera E2E' }).uncheck();
    await expect(cam).toBeHidden();
    await expect(viewer(page).getByText(net.pc.code)).toBeVisible();
    await panel.getByRole('checkbox', { name: 'Camera E2E' }).check();
    await expect(cam).toBeVisible();
  });

  test('chỉ đường PC → ISP: tô đoạn trên bản vẽ, mũi tên nhảy sang bản vẽ Lõi; không có đường → báo rõ', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const net = await network(page, secret);
    await page.goto(`/diagrams/${net.floorId}`);
    await expect(viewer(page).getByText(net.pc.code)).toBeVisible();

    const ask = async (from: string, to: string) => {
      await diagramBarAction(page, 'Chỉ đường');
      const dialog = page.getByRole('dialog', { name: 'Chỉ đường giữa hai máy' });
      for (const [label, code] of [
        ['Từ máy', from],
        ['Tới máy', to],
      ]) {
        const box = dialog.getByRole('combobox', { name: label });
        await box.fill(code);
        await page.getByRole('option', { name: new RegExp(code) }).click();
      }
      await dialog.getByRole('button', { name: 'Tìm đường' }).click();
      return dialog;
    };

    await ask(net.pc.code, net.isp.code);
    await expect(page.getByText(`Đường ${net.pc.code} → ${net.isp.code}: 3 dây.`)).toBeVisible();
    const jump = page.getByRole('link', { name: `→ ${net.core.code} (${net.coreName})` });
    await expect(jump).toBeVisible();
    await expect(jump).toHaveAttribute('href', `/diagrams/${net.coreId}?focus=${net.core.id}`);
    // Máy không nằm trên đường (LAP) mờ đi, máy trên đường thì không.
    await expect(viewer(page).getByRole('button', { name: net.lap.code })).toHaveAttribute('data-ims-dim', '');
    await expect(viewer(page).getByRole('button', { name: net.pc.code })).not.toHaveAttribute('data-ims-dim', '');
    await page.getByRole('button', { name: 'Bỏ chỉ đường' }).click();

    const dialog = await ask(net.pc.code, net.lap.code);
    await expect(dialog.getByRole('alert')).toHaveText(`Không có đường nối giữa ${net.pc.code} và ${net.lap.code} trong sơ đồ cổng`);
  });

  test('trình chiếu từ cây: tổng → chi tiết, ← → / Esc; hết ân hạn giữa chừng hỏi mã tại chỗ; mỗi trang một dòng diagram.viewed', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const net = await network(page, secret);
    const viewedFloor = countAudit('diagram.viewed', net.floorId);

    await page.goto('/diagrams');
    await rowAction(page, net.coreName, 'Trình chiếu');
    const show = page.getByRole('region', { name: 'Trình chiếu sơ đồ' });
    await expect(show.getByRole('heading', { level: 1, name: net.coreName })).toBeVisible();
    // Khung chiếu đè lên cả thanh trên của shell: bấm thử vào tên trang không bị phần tử khác chặn.
    await show.getByRole('heading', { level: 1, name: net.coreName }).click({ trial: true, timeout: 5_000 });
    await expect(show.getByRole('status', { name: 'Trang đang chiếu' })).toHaveText('Trang 1/2');
    await expect(show.getByText(net.core.code)).toBeVisible();

    expireStepUp(E2E_SA.email);
    await page.keyboard.press('ArrowRight');
    const unlock = page.getByRole('dialog', { name: 'Xác nhận danh tính' });
    await expect(unlock).toBeVisible();
    // Hộp modal ẩn phần còn lại khỏi cây trợ năng, nên "không thoát" kiểm bằng đường dẫn.
    await expect(page).toHaveURL(new RegExp(`/diagrams/${net.coreId}/present$`));
    await fillOtp(unlock, await freshTotpCode(secret));
    await expect(show.getByRole('heading', { level: 1, name: net.floorName })).toBeVisible();
    await expect(show.getByText(net.pc.code)).toBeVisible();
    await expect(show.getByRole('status', { name: 'Trang đang chiếu' })).toHaveText('Trang 2/2');
    expect(countAudit('diagram.viewed', net.floorId)).toBe(viewedFloor + 1);

    await page.keyboard.press('ArrowLeft');
    await expect(show.getByRole('status', { name: 'Trang đang chiếu' })).toHaveText('Trang 1/2');
    await page.getByRole('button', { name: 'Tiếp →' }).click();
    await expect(show.getByRole('status', { name: 'Trang đang chiếu' })).toHaveText('Trang 2/2');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/diagrams$/);
  });

  test('trạng thái sống chỉ là thiết kế: không có route nhận trạng thái', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const res = await page.request.post('/api/v1/device-status', {
      headers: await writeHeaders(page),
      data: { source: 'e2e', items: [{ deviceCode: 'SW-E2E-LIVE', state: 'down' }] },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(404);
  });
});
