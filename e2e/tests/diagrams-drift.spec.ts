import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  clearMailbox,
  createTestSubnet,
  firstLogin,
  horizontalOverflow,
  resetCatalog,
  resetDevices,
  resetDiagrams,
  resetIpam,
  resetUsers,
  sql,
  stepUpViaApi,
  uniqueStamp,
  waitForMail,
  writeHeaders,
  diagramBarAction,
} from './helpers';

/*
 * Cảnh báo lệch kho (Q-23 "không ép sửa", AD-18). Luật lệch là hàm thuần có bài bảng dữ liệu
 * (`diagram-drift.spec.ts`), bộ đệm + lượt quét hằng ngày + khử thư đúp có bài DB
 * (`api/test/diagram-drift.spec.ts`); bài này đi đường thật: đổi kho SAU khi phát hành → dấu trên
 * ô, "Có N thay đổi chưa vẽ", hộp "Kiểm tra khớp dữ liệu" bay tới ô, cây "Lệch kho (N)", và lượt
 * quét của worker gửi đúng một thư qua Mailpit. Bản vẽ lưu bằng API (không lái draw.io).
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetDiagrams();
  resetIpam();
  resetCatalog();
});

async function createDevice(page: Page, code: string): Promise<string> {
  const catalog = (await (await page.request.get('/api/v1/catalog')).json()) as { deviceTypes: { id: string; name: string }[] };
  const created = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { code, name: `Máy ${code}`, deviceTypeId: catalog.deviceTypes.find((t) => t.name === 'Switch')!.id },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

type Dev = { cell: string; id: string; code: string };

/** Bản vẽ có người phụ trách = SA E2E; lưu các máy rồi phát hành (SA tự vẽ thì Phát hành, Q-23). */
async function publishedDrawing(page: Page, name: string, devices: Dev[]): Promise<string> {
  const headers = await writeHeaders(page);
  const created = await page.request.post('/api/v1/diagrams', { headers, data: { name, nodeType: 'room', ownerEmail: E2E_SA.email } });
  expect(created.status(), await created.text()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;
  const cells = devices
    .map(
      (d, i) =>
        `<UserObject label="${d.code}" ims_device_id="${d.id}" ims_device_code="${d.code}" id="${d.cell}"><mxCell style="rounded=1;" vertex="1" parent="1"><mxGeometry x="${20 + i * 200}" y="20" width="120" height="50" as="geometry"/></mxCell></UserObject>`,
    )
    .join('');
  const xml = `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="500px" height="100px" viewBox="-0.5 -0.5 500 100"><g data-cell-id="0"><g data-cell-id="1">' +
    devices.map((d, i) => `<g data-cell-id="${d.cell}"><rect x="${20 + i * 200}" y="20" width="120" height="50"/><text x="${30 + i * 200}" y="50">${d.code}</text></g>`).join('') +
    '</g></g></svg>';
  const saved = await page.request.post(`/api/v1/diagrams/${id}/versions`, { headers, data: { xml, svg, basedOnVersionId: null } });
  expect(saved.status(), await saved.text()).toBe(201);
  const published = await page.request.post(`/api/v1/diagrams/${id}/publish`, { headers, data: {} });
  expect(published.status(), await published.text()).toBe(201);
  return id;
}

async function retire(page: Page, deviceId: string): Promise<void> {
  const res = await page.request.patch(`/api/v1/devices/${deviceId}/status`, { headers: await writeHeaders(page), data: { status: 'retired' } });
  expect(res.status(), await res.text()).toBeLessThan(300);
}

function viewer(page: Page) {
  return page.getByRole('region', { name: 'Bản vẽ, chỉ xem' });
}

/** Ô / băng của bản vẽ trên bản đồ /diagrams (`?node=` chọn nó): mang tên + CHỮ trạng thái. */
async function treeRow(page: Page, name: string) {
  const id = sql(`SELECT id FROM diagram WHERE name = '${name}' AND deleted_at IS NULL`);
  await page.goto(`/diagrams?node=${id}`);
  return page
    .getByRole('region', { name: 'Bản đồ bản vẽ' })
    .getByRole('button')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
}

test.describe('Sơ đồ mạng — cảnh báo lệch kho', () => {
  test('thanh lý một máy SAU khi phát hành → dấu trên ô, "Có 1 thay đổi chưa vẽ", cây "Lệch kho (1)"; không sửa gì', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, secret, 'diagram');
    const stamp = uniqueStamp();
    const sw: Dev = { cell: 'a', id: await createDevice(page, `SW-E2E-LK${stamp}`), code: `SW-E2E-LK${stamp}` };
    const srv: Dev = { cell: 'b', id: await createDevice(page, `SRV-E2E-LK${stamp}`), code: `SRV-E2E-LK${stamp}` };
    const name = `E2E Lệch thanh lý ${stamp}`;
    const id = await publishedDrawing(page, name, [sw, srv]);
    const versionsBefore = sql(`SELECT count(*) FROM diagram_version WHERE diagram_id = '${id}'`);

    await retire(page, srv.id);
    await page.goto(`/diagrams/${id}`);
    await expect(viewer(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Có 1 thay đổi chưa vẽ' })).toBeVisible();
    await expect(viewer(page).getByRole('button', { name: new RegExp(`${srv.code}.*đã thanh lý`) })).toBeVisible();

    await expect((await treeRow(page, name)).getByText('Lệch kho (1)')).toBeVisible();
    // Không ép sửa: mở bản vẽ, hiện dấu không tạo phiên bản nào.
    expect(sql(`SELECT count(*) FROM diagram_version WHERE diagram_id = '${id}'`)).toBe(versionsBefore);
  });

  test('đổi IP → dấu nói "IP cũ → IP mới"; "Kiểm tra khớp dữ liệu" liệt kê và bay tới ô', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, secret, 'diagram');
    const stamp = uniqueStamp();
    const headers = await writeHeaders(page);
    const sw: Dev = { cell: 'a', id: await createDevice(page, `SW-E2E-IPD${stamp}`), code: `SW-E2E-IPD${stamp}` };
    const { id: subnetId, octet } = await createTestSubnet(page, headers, `LAN lệch E2E ${stamp}`, Number(stamp));
    const ip = await page.request.post('/api/v1/ipam/addresses', { headers, data: { subnetId, address: `172.16.${octet}.2`, deviceId: sw.id } });
    expect(ip.status(), await ip.text()).toBe(201);
    const ipId = ((await ip.json()) as { id: string }).id;
    const id = await publishedDrawing(page, `E2E Lệch IP ${stamp}`, [sw]);

    const changed = await page.request.post(`/api/v1/ipam/addresses/${ipId}/change`, {
      headers,
      data: { subnetId, address: `172.16.${octet}.3`, reason: 'Đổi IP E2E' },
    });
    expect(changed.status(), await changed.text()).toBeLessThan(300);

    await page.goto(`/diagrams/${id}`);
    await expect(viewer(page)).toBeVisible();
    const said = `IP 172.16.${octet}.2 → 172.16.${octet}.3`;
    const cell = viewer(page).getByRole('button', { name: new RegExp(said.replace(/\./g, '\\.')) });
    await expect(cell).toBeVisible();

    await diagramBarAction(page, 'Kiểm tra khớp');
    const dialog = page.getByRole('dialog', { name: 'Kiểm tra khớp dữ liệu' });
    const item = dialog.getByRole('listitem').filter({ hasText: said });
    await expect(item).toContainText(`Thiết bị ${sw.code}: ${said}`);
    await item.getByRole('button', { name: 'Xem trên bản vẽ' }).click();
    await expect(dialog).toBeHidden();
    await expect(cell).toHaveAttribute('data-ims-selected', '');
  });

  test('đường hỏng của "không ép": bản vẽ khớp thì không có lời báo; sửa bản vẽ + phát hành lại thì hết "Lệch kho"', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, secret, 'diagram');
    const stamp = uniqueStamp();
    const sw: Dev = { cell: 'a', id: await createDevice(page, `SW-E2E-KH${stamp}`), code: `SW-E2E-KH${stamp}` };
    const old: Dev = { cell: 'b', id: await createDevice(page, `SRV-E2E-KH${stamp}`), code: `SRV-E2E-KH${stamp}` };
    const name = `E2E Khớp ${stamp}`;
    const id = await publishedDrawing(page, name, [sw]);

    await page.goto(`/diagrams/${id}`);
    await expect(viewer(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /thay đổi chưa vẽ/ })).toHaveCount(0);
    await diagramBarAction(page, 'Kiểm tra khớp');
    await expect(page.getByRole('dialog', { name: 'Kiểm tra khớp dữ liệu' })).toContainText('Bản vẽ khớp với dữ liệu kho.');

    // Bản vẽ thứ hai có máy bị thanh lý → lệch; vẽ lại không có máy đó + phát hành → hết dấu trên cây.
    const second = await publishedDrawing(page, `${name} B`, [sw, old]);
    await retire(page, old.id);
    await page.goto(`/diagrams/${second}`);
    await expect(page.getByRole('button', { name: 'Có 1 thay đổi chưa vẽ' })).toBeVisible();
    await expect((await treeRow(page, `${name} B`)).getByText('Lệch kho (1)')).toBeVisible();
    const headers = await writeHeaders(page);
    const fixed = await page.request.post(`/api/v1/diagrams/${second}/versions`, {
      headers,
      data: {
        xml: `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><UserObject label="${sw.code}" ims_device_id="${sw.id}" ims_device_code="${sw.code}" id="a"><mxCell vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="50" as="geometry"/></mxCell></UserObject></root></mxGraphModel></diagram></mxfile>`,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200px" height="100px"><g data-cell-id="a"><rect x="20" y="20" width="120" height="50"/></g></svg>',
        basedOnVersionId: null,
      },
    });
    expect(fixed.status(), await fixed.text()).toBe(201);
    expect((await page.request.post(`/api/v1/diagrams/${second}/publish`, { headers, data: {} })).status()).toBe(201);
    await expect((await treeRow(page, `${name} B`)).getByText(/Lệch kho/)).toHaveCount(0);
  });

  test('390px: lời báo lệch kho và hộp "Kiểm tra khớp dữ liệu" không tràn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const secret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, secret, 'diagram');
    const stamp = uniqueStamp();
    const sw: Dev = { cell: 'a', id: await createDevice(page, `SW-E2E-LKM${stamp}`), code: `SW-E2E-LKM${stamp}` };
    const id = await publishedDrawing(page, `E2E Lệch điện thoại ${stamp}`, [sw]);
    await retire(page, sw.id);
    await page.goto(`/diagrams/${id}`);
    await page.getByRole('button', { name: 'Có 1 thay đổi chưa vẽ' }).click();
    await expect(page.getByRole('dialog', { name: 'Kiểm tra khớp dữ liệu' })).toContainText(sw.code);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('lượt quét hằng ngày: số lệch tăng → MỘT thư tới người phụ trách; quét lại không tăng thì không gửi nữa @slow', async ({ page }) => {
    test.setTimeout(480_000);
    await clearMailbox();
    const secret = await firstLogin(page, E2E_SA);
    await stepUpViaApi(page, secret, 'diagram');
    const stamp = uniqueStamp();
    const sw: Dev = { cell: 'a', id: await createDevice(page, `SW-E2E-SWP${stamp}`), code: `SW-E2E-SWP${stamp}` };
    const name = `E2E Quét lệch ${stamp}`;
    const id = await publishedDrawing(page, name, [sw]);
    const subject = `[IMS] Bản vẽ "${name}" lệch kho: 1 mục`;
    const swept = () => sql(`SELECT count(*) FROM diagram_drift WHERE diagram_id = '${id}' AND swept_at IS NOT NULL`);
    const hour = sql(`SELECT value #>> '{}' FROM system_config WHERE key = 'diagram.drift_sweep_hour'`);
    // Giờ quét 0 = lượt quét của worker (mỗi phút một nhịp) chạy ngay hôm nay, giờ nào cũng được.
    sql(`UPDATE system_config SET value = '0' WHERE key = 'diagram.drift_sweep_hour'`);
    try {
      // Lượt đầu chốt mốc 0 lệch TRƯỚC khi đổi kho — thứ tự cố định, không đua với nhịp của worker.
      await expect.poll(swept, { timeout: 180_000, intervals: [2_000] }).toBe('1');
      expect(await waitForMail(subject, 2)).toHaveLength(0);

      await retire(page, sw.id);
      sql(`UPDATE diagram_drift SET swept_at = NULL WHERE diagram_id = '${id}'`);
      const mails = await waitForMail(subject, 360);
      expect(mails).toHaveLength(1);
      expect(mails[0].To.map((to) => to.Address)).toEqual([E2E_SA.email]);

      // Quét lại (xoá mốc "đã quét hôm nay"): số không tăng → không thư thứ hai.
      sql(`UPDATE diagram_drift SET swept_at = NULL WHERE diagram_id = '${id}'`);
      await expect.poll(swept, { timeout: 180_000, intervals: [2_000] }).toBe('1');
      expect(await waitForMail(subject, 4)).toHaveLength(1);
    } finally {
      sql(`UPDATE system_config SET value = '${hour || '7'}' WHERE key = 'diagram.drift_sweep_hour'`);
    }
  });
});
