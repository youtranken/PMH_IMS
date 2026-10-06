import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  catalogItem,
  catalogTab,
  expireStepUp,
  fillOtp,
  firstLogin,
  freshTotpCode,
  horizontalOverflow,
  resetCatalog,
  resetDevices,
  resetDiagrams,
  resetSecrets,
  resetUsers,
  rowAction,
  searchAndWaitForFilter,
  sql,
  stepUpViaApi,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/*
 * Sơ đồ mạng — hộp "Thiết bị kho" (Q-23, AD-18): nút trên thanh mảnh mở hộp tìm gọn (không cột
 * cố định), chèn máy kho bằng cầu nối; XML lưu "khô", hình/nhãn hydrate từ kho khi mở; chế độ xem
 * bấm máy ra thẻ thông tin, "Mở két" đi đúng luồng két (mã phạm vi KÉT). Logic khô/ướt và lô thông
 * tin máy dồn ở `api/test/diagrams.spec.ts`; bài này giữ mức khói trên stack thật.
 */

test.beforeEach(() => {
  resetUsers();
  resetSecrets();
  resetDevices();
  resetDiagrams();
  resetCatalog();
});

async function deviceTypeId(page: Page, name: string): Promise<string> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  return catalog.deviceTypes.find((t) => t.name === name)!.id;
}

async function createDevice(page: Page, code: string, extra: Record<string, unknown> = {}): Promise<string> {
  const created = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { code, name: `Switch kho ${code}`, deviceTypeId: await deviceTypeId(page, 'Switch'), model: 'C9300-E2E', serial: `FOC-${code}`, ...extra },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

async function createDiagram(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/v1/diagrams', { headers: await writeHeaders(page), data: { name, nodeType: 'room' } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Bản vẽ có MỘT ô thiết bị (XML + SVG như trình vẽ xuất) — dựng nhanh qua API cho các bài xem. */
async function saveWithDevice(page: Page, diagramId: string, deviceId: string, code: string) {
  const xml =
    '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="dev1"><mxCell style="rounded=1;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="50" as="geometry"/></mxCell></UserObject>` +
    '</root></mxGraphModel></diagram></mxfile>';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="200px" height="100px" viewBox="-0.5 -0.5 200 100">' +
    `<g data-cell-id="0"><g data-cell-id="1"><g data-cell-id="dev1"><rect x="20" y="20" width="120" height="50"/><text x="30" y="50">${code}</text></g></g></g></svg>`;
  const res = await page.request.post(`/api/v1/diagrams/${diagramId}/versions`, {
    headers: await writeHeaders(page),
    data: { xml, svg, basedOnVersionId: null },
  });
  expect(res.status(), await res.text()).toBe(201);
}

function stockBox(page: Page) {
  return page.getByRole('dialog', { name: 'Chèn thiết bị có trong kho' });
}

test.describe('Sơ đồ mạng — Thiết bị kho', () => {
  test('nút "Thiết bị kho" mở hộp tìm gọn (trình vẽ vẫn rộng như cũ); tìm + bàn phím chèn một máy E2E; lưu KHÔ; xem → bấm máy ra thẻ đúng', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SW-E2E-KHO${stamp}`;
    const deviceId = await createDevice(page, code);
    const id = await createDiagram(page, `E2E Thiết bị kho ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');

    await page.goto(`/diagrams/${id}?mode=edit`);
    const stock = page.getByRole('button', { name: 'Thiết bị kho', exact: true });
    await expect(stock).toBeEnabled({ timeout: 60_000 });
    const frame = page.locator('iframe[title="Khung vẽ draw.io"]');
    const before = (await frame.boundingBox())!;

    await stock.click();
    await expect(stockBox(page)).toBeVisible();
    // Hộp nổi, không cột chen vào: khung vẽ giữ nguyên chỗ và bề ngang.
    const during = (await frame.boundingBox())!;
    expect([during.x, during.width]).toEqual([before.x, before.width]);

    // Bàn phím: gõ tìm (ô tìm có tiêu điểm sẵn), ↓ xuống danh sách, Space chọn, Enter chèn.
    await page.keyboard.type(code);
    const pick = stockBox(page).getByRole('checkbox', { name: `Chọn ${code} để chèn` });
    // Ô tìm có debounce: chờ danh sách chỉ còn máy vừa gõ, không thì ↓ rơi vào dòng đầu của danh sách chưa lọc.
    await expect(stockBox(page).getByRole('listitem')).toHaveCount(1);
    await expect(pick).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(pick).toBeFocused();
    await page.keyboard.press('Space');
    await expect(pick).toBeChecked();
    await page.keyboard.press('Enter');
    await expect(page.getByText(`Đã chèn ${code} vào bản vẽ.`)).toBeVisible();
    await expect(stockBox(page)).toHaveCount(0);

    // Mở lại hộp: máy vừa chèn là "đã có", không chèn lần hai.
    await stock.click();
    await stockBox(page).getByRole('searchbox', { name: 'Tìm thiết bị' }).fill(code);
    await expect(stockBox(page).getByRole('checkbox', { name: `Chọn ${code} để chèn` })).toBeDisabled();
    await expect(stockBox(page).getByText('Đã có trên bản vẽ')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(stockBox(page)).toHaveCount(0);

    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${id}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    expect(((await saved.json()) as { summary: string }).summary).toBe('Thêm 1 thiết bị');

    // Kho giữ XML KHÔ (AD-18): ô mang hợp đồng ims_*, nhãn là mã máy, KHÔNG có hình theo loại.
    const xml = sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${id}' ORDER BY seq DESC LIMIT 1`);
    expect(xml).toContain(`ims_device_id="${deviceId}"`);
    expect(xml).toContain(`label="${code}"`);
    expect(xml).not.toContain('mxgraph.networks.switch');

    // Mở sửa lại → hydrate: hình theo loại + nhãn từ kho trở lại trong XML nạp trình vẽ.
    const reopened = await page.request.get(`/api/v1/diagrams/${id}/content?mode=edit`);
    expect(((await reopened.json()) as { version: { xml: string } }).version.xml).toContain('shape=mxgraph.networks.switch;');

    // Xem: bấm máy → thẻ thông tin đúng hồ sơ kho.
    await page.getByRole('tab', { name: 'Xem' }).click();
    const viewer = page.getByRole('region', { name: 'Bản vẽ, chỉ xem' });
    await viewer.getByRole('button', { name: code, exact: true }).click();
    const card = page.getByRole('dialog', { name: code });
    await expect(card).toBeVisible();
    await expect(card.getByText(`Switch kho ${code}`)).toBeVisible();
    await expect(card.getByText('C9300-E2E')).toBeVisible();
    await expect(card.getByText(`FOC-${code}`)).toBeVisible();
    await expect(card.getByRole('link', { name: 'Mở hồ sơ' })).toHaveAttribute('href', `/devices/${deviceId}`);
  });

  test('kéo máy từ "Thiết bị kho" thả vào trình vẽ: draw.io đặt ô đúng chỗ thả; trình duyệt không giao cú thả thì IMS chèn thay (Q-23 06/10)', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const first = `SW-E2E-KEO${stamp}`;
    const second = `SW-E2E-KEP${stamp}`;
    const firstId = await createDevice(page, first);
    const secondId = await createDevice(page, second);
    const id = await createDiagram(page, `E2E Kéo thả ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');

    await page.goto(`/diagrams/${id}?mode=edit`);
    const stock = page.getByRole('button', { name: 'Thiết bị kho', exact: true });
    await expect(stock).toBeEnabled({ timeout: 60_000 });
    await stock.click();
    const search = stockBox(page).getByRole('searchbox', { name: 'Tìm thiết bị' });
    const rowOf = async (code: string) => {
      // Cú thả trước đưa tiêu điểm vào khung trình vẽ → hộp nổi tự đóng (blur): mở lại.
      if (!(await stockBox(page).isVisible())) await stock.click();
      await search.fill(code);
      await expect(stockBox(page).getByRole('listitem')).toHaveCount(1);
      const row = stockBox(page).getByRole('listitem').filter({ hasText: code });
      // Chuột vào dòng → IMS đọc trước ô của máy; xong thì dòng kéo được (con trỏ "nắm").
      await row.hover();
      await expect(row).toHaveAttribute('draggable', 'true');
      return row;
    };

    // 1) Đường draw.io nhận cú thả: dữ liệu kéo đúng như dòng gắn lúc bắt đầu kéo, thả vào khung.
    //    Playwright không giao kéo-thả chuột cho khung khác nguồn, nên cú thả trong khung được dựng
    //    bằng sự kiện drop của chính trình duyệt mang đúng dữ liệu đó.
    const row = await rowOf(first);
    const payload = await row.evaluate((li) => {
      const dt = new DataTransfer();
      li.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const text = dt.getData('text/plain');
      li.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return text;
    });
    expect(payload.startsWith('<mxGraphModel>')).toBe(true);
    expect(payload).toContain(`ims_device_id="${firstId}"`);
    const drawio = page.frames().find((f) => f.url().includes('/drawio/'))!;
    await drawio.evaluate((xml) => {
      const target = document.querySelector('.geDiagramContainer') as HTMLElement;
      const box = target.getBoundingClientRect();
      const dt = new DataTransfer();
      dt.setData('text/plain', xml);
      const at = { clientX: box.left + 420, clientY: box.top + 260, bubbles: true, cancelable: true, dataTransfer: dt };
      target.dispatchEvent(new DragEvent('dragenter', at));
      target.dispatchEvent(new DragEvent('dragover', at));
      target.dispatchEvent(new DragEvent('drop', at));
    }, payload);
    await expect(page.getByText(`Đã chèn ${first} vào bản vẽ.`)).toBeVisible();
    await page.screenshot({ path: process.env.IMS_SHOT_DIR ? `${process.env.IMS_SHOT_DIR}/keo-tha-dung-cho.png` : test.info().outputPath('keo-tha-dung-cho.png') });

    // 2) Kéo chuột thật vào khung (Playwright: khung không nhận) → IMS chèn thay theo lưới, báo rõ.
    const secondRow = await rowOf(second);
    // Kéo như tay người: nhấn trên dòng, đi qua thanh trên của IMS rồi xuống giữa khung vẽ.
    const from = (await secondRow.boundingBox())!;
    const canvas = (await page.locator('iframe[title="Khung vẽ draw.io"]').boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, 20, { steps: 8 });
    await page.mouse.move(canvas.x + 300, canvas.y + 400, { steps: 15 });
    await page.mouse.up();
    await expect(page.getByText(new RegExp(`Đã chèn ${second} cạnh các hình đang có`))).toBeVisible();

    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${id}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    const xml = sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${id}' ORDER BY seq DESC LIMIT 1`);
    expect(xml).toContain(`ims_device_id="${firstId}"`);
    expect(xml).toContain(`ims_device_id="${secondId}"`);
    // Mỗi máy đúng MỘT ô: không chèn hai lần khi draw.io đã nhận cú thả.
    expect(xml.split(`ims_device_id="${firstId}"`)).toHaveLength(2);
    expect(xml.split(`ims_device_id="${secondId}"`)).toHaveLength(2);
  });

  test('bản vẽ dở: đóng tab giữa lúc vẽ, mở lại → "Có bản đang vẽ dở" → Khôi phục thành chưa lưu, Lưu mới ghi; khoá mã chỉ có ở tab Sửa (Q-23 06/10)', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SW-E2E-DO${stamp}`;
    const deviceId = await createDevice(page, code);
    const id = await createDiagram(page, `E2E Vẽ dở ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');
    await saveWithDevice(page, id, deviceId, code);

    // Khoá mã bản dở chỉ đi kèm nội dung tab Sửa (sau mã sơ đồ), tab Xem không có.
    const view = (await (await page.request.get(`/api/v1/diagrams/${id}/content`)).json()) as { draftKey?: string };
    expect(view.draftKey).toBeUndefined();
    const edit = (await (await page.request.get(`/api/v1/diagrams/${id}/content?mode=edit`)).json()) as { draftKey?: string };
    expect(Buffer.from(edit.draftKey ?? '', 'base64')).toHaveLength(32);

    await page.goto(`/diagrams/${id}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    // Một nét người vẽ: dán một hình chữ vào khung (draw.io nhận như thao tác vẽ, gửi autosave).
    const drawio = page.frames().find((f) => f.url().includes('/drawio/'))!;
    await drawio.evaluate(() => {
      const target = document.querySelector('.geDiagramContainer') as HTMLElement;
      const box = target.getBoundingClientRect();
      const dt = new DataTransfer();
      dt.setData('text/plain', '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="t" value="Ghi chú E2E vẽ dở" style="text;html=0;" vertex="1" parent="1"><mxGeometry width="160" height="30" as="geometry"/></mxCell></root></mxGraphModel>');
      const at = { clientX: box.left + 300, clientY: box.top + 300, bubbles: true, cancelable: true, dataTransfer: dt };
      target.dispatchEvent(new DragEvent('dragover', at));
      target.dispatchEvent(new DragEvent('drop', at));
    });
    await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toBeEnabled();
    // Trên đĩa chỉ có bản mã: đợi bản cất xuất hiện rồi soi IndexedDB.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              const open = indexedDB.open('ims-drafts', 1);
              open.onupgradeneeded = () => open.result.createObjectStore('drafts', { keyPath: 'id' });
              open.onsuccess = () => {
                const req = open.result.transaction('drafts', 'readonly').objectStore('drafts').getAll();
                req.onsuccess = () => resolve(JSON.stringify(req.result.map((r: { data: ArrayBuffer }) => new TextDecoder().decode(r.data))));
              };
            }),
        ),
      )
      .toMatch(/^\[".+"\]$/);
    const raw = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const open = indexedDB.open('ims-drafts', 1);
          open.onsuccess = () => {
            const req = open.result.transaction('drafts', 'readonly').objectStore('drafts').getAll();
            req.onsuccess = () => resolve(req.result.map((r: { data: ArrayBuffer }) => new TextDecoder('latin1').decode(r.data)).join(''));
          };
        }),
    );
    expect(raw).not.toContain('Ghi chú E2E vẽ dở');
    expect(raw).not.toContain(code);

    // "Đóng tab" rồi mở lại trong tab mới cùng phiên.
    const again = await page.context().newPage();
    await page.close({ runBeforeUnload: false });
    await again.goto(`/diagrams/${id}?mode=edit`);
    const banner = again.getByText(/Có bản đang vẽ dở lúc .+ chưa lưu\./);
    await expect(banner).toBeVisible({ timeout: 60_000 });
    await again.screenshot({ path: process.env.IMS_SHOT_DIR ? `${process.env.IMS_SHOT_DIR}/ban-ve-do.png` : test.info().outputPath('ban-ve-do.png') });
    // Chưa khôi phục thì không có gì để lưu — server không bị ghi ngầm.
    await expect(again.getByRole('button', { name: 'Lưu', exact: true })).toBeDisabled();
    expect(sql(`SELECT count(*) FROM diagram_version WHERE diagram_id = '${id}'`)).toBe('1');
    await again.getByRole('button', { name: 'Khôi phục' }).click();
    await expect(again.getByText('Đã nạp bản đang vẽ dở — chưa lưu, bấm Lưu để giữ.')).toBeVisible();
    const [saved] = await Promise.all([
      again.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${id}/versions`) && r.request().method() === 'POST'),
      again.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    expect(sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${id}' ORDER BY seq DESC LIMIT 1`)).toContain('Ghi chú E2E vẽ dở');
    // Lưu xong thì bản dở bị bỏ: mở lại không mời khôi phục nữa.
    await again.reload();
    await expect(again.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(again.getByText(/Có bản đang vẽ dở/)).toHaveCount(0);
  });

  test('chèn 3 máy một lượt: xếp lưới không đè nhãn; lưu lần đầu xong thẻ "Bản vẽ đang trống" không hiện lại; hồ sơ máy liệt kê bản vẽ (E-01, E-02, T-01)', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const codes = ['A', 'B', 'C'].map((k) => `SW-E2E-LUOI${k}${stamp}`);
    const ids = [];
    for (const code of codes) ids.push(await createDevice(page, code));
    const id = await createDiagram(page, `E2E Lưới chèn ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');

    await page.goto(`/diagrams/${id}?mode=edit`);
    const stock = page.getByRole('button', { name: 'Thiết bị kho', exact: true });
    await expect(stock).toBeEnabled({ timeout: 60_000 });
    const startCard = page.getByRole('heading', { name: 'Bản vẽ đang trống — bắt đầu như sau' });
    await expect(startCard).toBeVisible();

    await stock.click();
    await stockBox(page).getByRole('searchbox', { name: 'Tìm thiết bị' }).fill(`LUOI`);
    for (const code of codes) await stockBox(page).getByRole('checkbox', { name: `Chọn ${code} để chèn` }).check();
    await stockBox(page).getByRole('button', { name: 'Chèn 3 thiết bị' }).click();
    await expect(page.getByText(/^Đã chèn .* vào bản vẽ\.$/)).toBeVisible();

    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${id}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    await expect(page.getByText(/^Đã lưu phiên bản #1/)).toBeVisible();
    await expect(startCard).toHaveCount(0);

    const xml = sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${id}' ORDER BY seq DESC LIMIT 1`);
    const at = ids.map((deviceId) => {
      const cell = new RegExp(`ims_device_id="${deviceId}"[\\s\\S]*?<mxGeometry[^>]*?x="(-?[\\d.]+)"[^>]*?y="(-?[\\d.]+)"`).exec(xml);
      expect(cell, `ô của ${deviceId}`).not.toBeNull();
      return [Number(cell![1]), Number(cell![2])];
    });
    // Nhãn 3 dòng rộng ~180px nằm dưới hình: hai máy phải cách nhau đủ một nhãn ngang hoặc một hàng dọc.
    for (let i = 0; i < at.length; i += 1)
      for (let j = i + 1; j < at.length; j += 1) expect(Math.abs(at[i][0] - at[j][0]) >= 180 || Math.abs(at[i][1] - at[j][1]) >= 140).toBe(true);

    // Hồ sơ thiết bị nói máy có trên bản vẽ nào (T-01) — tên + trạng thái, link mở bản vẽ bay tới máy.
    await page.goto(`/devices/${ids[0]}`);
    const onDiagrams = page.getByRole('region', { name: 'Có trên sơ đồ (1)' });
    await expect(onDiagrams).toBeVisible();
    await expect(onDiagrams).toContainText('Bản nháp');
    await expect(onDiagrams.getByRole('link', { name: `E2E Lưới chèn ${stamp}` })).toHaveAttribute('href', `/diagrams/${id}?focus=${ids[0]}`);
  });

  test('đổi hình của loại ở Danh mục → lần mở sau bản vẽ hiện hình mới (XML khô, không sửa bản vẽ)', async ({ page }) => {
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const typeRes = await page.request.post('/api/v1/catalog/device_type', {
      headers: await writeHeaders(page),
      data: { name: `E2E Loại sơ đồ ${stamp}`, diagramShape: 'mxgraph.networks.switch' },
    });
    expect(typeRes.status(), await typeRes.text()).toBe(201);
    const typeId = ((await typeRes.json()) as { id: string }).id;
    const code = `SW-E2E-HINH${stamp}`;
    const deviceId = await createDevice(page, code, { deviceTypeId: typeId });
    const id = await createDiagram(page, `E2E Đổi hình ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');
    await saveWithDevice(page, id, deviceId, code);

    const first = await page.request.get(`/api/v1/diagrams/${id}/content?mode=edit`);
    expect(((await first.json()) as { version: { xml: string } }).version.xml).toContain('shape=mxgraph.networks.switch;');
    const changed = await page.request.patch(`/api/v1/catalog/device_type/${typeId}`, {
      headers: await writeHeaders(page),
      data: { diagramShape: 'mxgraph.cisco.switches.workgroup_switch' },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const second = await page.request.get(`/api/v1/diagrams/${id}/content?mode=edit`);
    expect(((await second.json()) as { version: { xml: string } }).version.xml).toContain('shape=mxgraph.cisco.switches.workgroup_switch;');
  });

  test('Mở két từ thẻ: VẪN hỏi mã phạm vi KÉT dù đang trong ân hạn sơ đồ; nhập mã thì xem được', async ({ page }) => {
    test.setTimeout(150_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SW-E2E-KET${stamp}`;
    const deviceId = await createDevice(page, code);
    const label = `admin web E2E ${stamp}`;
    // Cất bí mật cũng đòi mã phạm vi két; cất xong đẩy mọi mốc lùi để bài kiểm đúng ý: chỉ có ân hạn SƠ ĐỒ.
    await stepUpViaApi(page, secret, 'vault');
    const stored = await page.request.post('/api/v1/vault/secrets', {
      headers: await writeHeaders(page),
      data: { ownerType: 'device', ownerId: deviceId, kind: 'password', label, value: `Web#Pass#${stamp}` },
    });
    expect(stored.status(), await stored.text()).toBe(201);
    expireStepUp(E2E_SA.email);
    const id = await createDiagram(page, `E2E Mở két ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');
    await saveWithDevice(page, id, deviceId, code);

    await page.goto(`/diagrams/${id}`);
    await page.getByRole('region', { name: 'Bản vẽ, chỉ xem' }).getByRole('button', { name: code, exact: true }).click();
    await page.getByRole('dialog', { name: code }).getByRole('button', { name: 'Mở két' }).click();
    const vault = page.getByRole('dialog', { name: `Két của ${code}` });
    await expect(vault).toBeVisible();
    await vault.getByRole('row', { name: new RegExp(label) }).getByRole('button', { name: 'Xem' }).click();
    // Ân hạn sơ đồ không mở két (AD-17): Xem vẫn hỏi mã phạm vi KÉT, bằng hộp nhỏ chồng lên hộp két (Q-24).
    const step = page.getByRole('dialog', { name: 'Nhập mã 6 số để xem' });
    await expect(step).toBeVisible();
    await expect(step.getByText(label, { exact: true })).toBeVisible();
    await fillOtp(step, await freshTotpCode(secret));
    await expect(page.getByRole('dialog', { name: label, exact: true }).getByTestId('secret-value')).toHaveText(`Web#Pass#${stamp}`);
  });

  test('huy hiệu sẵn sàng (Q-23 06/10 chiều): máy trong tủ chưa khai U hiện "Thiếu U", lọc "Chỉ máy cần xử lý" vẫn thấy nó; khai U xong mở lại hộp thì hết', async ({ page }) => {
    test.setTimeout(150_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const siteId = await catalogItem(page, 'site', { code: `E2E-SS${stamp}`, name: `Site sẵn sàng E2E ${stamp}` });
    const cabinetId = await catalogItem(page, 'cabinet', { siteId, code: `E2E-SSTU${stamp}`, uHeight: 12 });
    const missing = `SW-E2E-SSA${stamp}`;
    const missingId = await createDevice(page, missing, { siteId, cabinetId });
    const placed = `SW-E2E-SSB${stamp}`;
    await createDevice(page, placed, { siteId, cabinetId, rackUStart: 3, rackUSize: 1 });
    const id = await createDiagram(page, `E2E Sẵn sàng ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');

    await page.goto(`/diagrams/${id}?mode=edit`);
    const stock = page.getByRole('button', { name: 'Thiết bị kho', exact: true });
    await expect(stock).toBeEnabled({ timeout: 60_000 });
    await stock.click();
    await stockBox(page).getByRole('searchbox', { name: 'Tìm thiết bị' }).fill(`SSA${stamp}`);
    await expect(stockBox(page).getByRole('listitem')).toHaveCount(1);
    const row = stockBox(page).getByRole('listitem').filter({ hasText: missing });
    await expect(row.getByText('Thiếu U', { exact: true })).toBeVisible();
    await expect(row.getByRole('link', { name: `Mở hồ sơ ${missing}` })).toHaveAttribute('href', `/devices/${missingId}`);
    // Chỉ báo, không chặn chèn.
    await expect(row.getByRole('checkbox', { name: `Chọn ${missing} để chèn` })).toBeEnabled();
    await stockBox(page).getByRole('searchbox', { name: 'Tìm thiết bị' }).fill(`SSB${stamp}`);
    await expect(stockBox(page).getByRole('listitem')).toHaveCount(1);
    await expect(stockBox(page).getByRole('listitem').filter({ hasText: placed }).getByText('Thiếu U', { exact: true })).toHaveCount(0);
    await stockBox(page).getByRole('searchbox', { name: 'Tìm thiết bị' }).fill(`E2E-SS`);
    await stockBox(page).getByRole('checkbox', { name: 'Chỉ máy cần xử lý' }).check();
    await expect(stockBox(page).getByRole('listitem').filter({ hasText: missing })).toBeVisible();
    await page.keyboard.press('Escape');

    const declared = await page.request.patch(`/api/v1/devices/${missingId}`, { headers: await writeHeaders(page), data: { rackUStart: 5, rackUSize: 1 } });
    expect(declared.status(), await declared.text()).toBe(200);
    await stock.click();
    await stockBox(page).getByRole('searchbox', { name: 'Tìm thiết bị' }).fill(`SSA${stamp}`);
    await expect(stockBox(page).getByRole('listitem')).toHaveCount(1);
    await expect(stockBox(page).getByRole('listitem').getByText('Thiếu U', { exact: true })).toHaveCount(0);
  });

  test('đường hỏng: máy đã thanh lý không hiện trong hộp Thiết bị kho; ô trỏ máy không còn trong kho → dấu đỏ, thẻ báo "Không tìm thấy trong kho"', async ({ page }) => {
    test.setTimeout(150_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const dead = `SW-E2E-TL${stamp}`;
    const deadId = await createDevice(page, dead);
    const retired = await page.request.patch(`/api/v1/devices/${deadId}/status`, {
      headers: await writeHeaders(page),
      data: { status: 'retired', cleanup: true },
    });
    expect(retired.status()).toBeLessThan(300);
    const id = await createDiagram(page, `E2E Hỏng kho ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');

    await page.goto(`/diagrams/${id}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Thiết bị kho', exact: true }).click();
    await stockBox(page).getByRole('searchbox', { name: 'Tìm thiết bị' }).fill(dead);
    // Máy đã thanh lý không có mặt trong hộp (Q-23): tìm đúng mã cũng chỉ ra câu "không khớp".
    await expect(stockBox(page).getByText('Không có thiết bị nào khớp. Máy đã thanh lý không hiện ở đây.')).toBeVisible();
    await expect(stockBox(page).getByRole('checkbox', { name: `Chọn ${dead} để chèn` })).toHaveCount(0);
    await expect(stockBox(page).getByRole('button', { name: 'Chèn', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');

    // Ô trỏ một id không có trong kho (máy đã bị xoá / XML sửa tay): không lỗi trang.
    const gone = `SW-E2E-MAT${stamp}`;
    await saveWithDevice(page, id, '7b0c1c1e-0000-4000-8000-0000000000e2', gone);
    await page.goto(`/diagrams/${id}`);
    const cell = page.getByRole('region', { name: 'Bản vẽ, chỉ xem' }).getByRole('button', { name: `${gone} — Không tìm thấy trong kho` });
    await expect(cell).toHaveAttribute('data-ims-mark', 'danger');
    await cell.click();
    const card = page.getByRole('dialog', { name: `Thiết bị ${gone}` });
    await expect(card.getByRole('alert')).toHaveText('Không tìm thấy trong kho');
  });

  test('đường hỏng: biểu tượng SVG có script bị từ chối (dựng lại đúng đòn); chỉ SA tải biểu tượng — Thành viên 403', async ({ page, browser }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const typeName = `E2E Loại biểu tượng ${stamp}`;
    const typeRes = await page.request.post('/api/v1/catalog/device_type', { headers: await writeHeaders(page), data: { name: typeName } });
    expect(typeRes.status(), await typeRes.text()).toBe(201);
    const typeId = ((await typeRes.json()) as { id: string }).id;

    const evil = '<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(\'/api/v1/auth/me\')"><script>alert(document.cookie)</script><rect width="4" height="4"/></svg>';
    const rejected = await page.request.post(`/api/v1/catalog/device-types/${typeId}/diagram-icon`, {
      headers: await writeHeaders(page),
      data: { svg: evil },
      failOnStatusCode: false,
    });
    expect(rejected.status()).toBe(400);
    expect(((await rejected.json()) as { code: string }).code).toBe('DIAGRAM_ICON_INVALID');
    expect(sql(`SELECT count(*) FROM device_type_icon WHERE device_type_id = '${typeId}'`)).toBe('0');

    // Giao diện: SA chọn tệp có script → lý do hiện ngay dưới ô.
    await page.goto('/admin/catalog');
    await page.getByRole('tab', { name: catalogTab('Loại thiết bị') }).click();
    await searchAndWaitForFilter(page, typeName);
    await rowAction(page, new RegExp(typeName), 'Sửa');
    const form = page.getByRole('dialog', { name: new RegExp(typeName) });
    await form.getByLabel('Chọn tệp SVG biểu tượng').setInputFiles({ name: 'icon-e2e.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(evil) });
    await expect(form.getByText(/không nhận/)).toBeVisible();

    const other = await (await browser.newContext()).newPage();
    await firstLogin(other, E2E_MEMBER);
    const forbidden = await other.request.post(`/api/v1/catalog/device-types/${typeId}/diagram-icon`, {
      headers: await writeHeaders(other),
      data: { svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>' },
      failOnStatusCode: false,
    });
    expect(forbidden.status()).toBe(403);
    await other.context().close();
  });

  test('390px: chế độ xem bấm máy ra thẻ thông tin, không tràn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SW-E2E-DT${stamp}`;
    const deviceId = await createDevice(page, code);
    const id = await createDiagram(page, `E2E Thẻ điện thoại ${stamp}`);
    await stepUpViaApi(page, secret, 'diagram');
    await saveWithDevice(page, id, deviceId, code);

    await page.goto(`/diagrams/${id}`);
    await page.getByRole('region', { name: 'Bản vẽ, chỉ xem' }).getByRole('button', { name: code, exact: true }).click();
    const card = page.getByRole('dialog', { name: code });
    await expect(card).toBeVisible();
    await expect(card.getByText('C9300-E2E')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Mở két' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
