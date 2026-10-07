import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  catalogItem,
  clickDrawioCanvas,
  diagramBarAction,
  fillOtp,
  firstLogin,
  freshTotpCode,
  horizontalOverflow,
  resetCatalog,
  resetDevices,
  resetDiagrams,
  resetUsers,
  sql,
  stepUpViaApi,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/*
 * Ảnh thật, vị trí U và mặt tủ (Q-23 "chồng U trong cùng tủ thì chặn"): khai U trên
 * form thiết bị, chồng U bị từ chối bằng câu tiếng Việt nêu tên máy đang chiếm; "Dựng lại mặt tủ"
 * xếp máy đúng U ở mặt trước (tủ chỉ vẽ mặt trước) với ảnh thật; công tắc Biểu tượng / Ảnh thật trên màn sửa
 * (mặt không có ảnh tắt kèm lý do); trang thiết bị đọc được vị trí U ở 390px. Luật U, ảnh, bố cục
 * khung và trần dung lượng dồn ở `api/test/device-rack-u.spec.ts` + `api/test/diagrams-rack.spec.ts`;
 * bài này giữ mức khói trên stack thật.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetDiagrams();
  resetCatalog();
});

/** Ảnh PNG 1×1 hợp lệ — `files` kiểm theo nội dung. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

interface Rack {
  stamp: string;
  siteId: string;
  siteCode: string;
  cabinetId: string;
  cabinetCode: string;
  typeId: string;
}

async function seedRack(page: Page): Promise<Rack> {
  const stamp = uniqueStamp();
  const siteCode = `E2E-MT${stamp}`;
  const cabinetCode = `E2E-RU${stamp}`;
  const siteId = await catalogItem(page, 'site', { code: siteCode, name: `Site mặt tủ E2E ${stamp}` });
  const cabinetId = await catalogItem(page, 'cabinet', { siteId, code: cabinetCode, uHeight: 12 });
  const catalog = (await (await page.request.get('/api/v1/catalog')).json()) as { deviceTypes: { id: string; name: string }[] };
  return { stamp, siteId, siteCode, cabinetId, cabinetCode, typeId: catalog.deviceTypes.find((t) => t.name === 'Switch')!.id };
}

async function createDevice(page: Page, rack: Rack, code: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { code, name: `Switch ${code}`, deviceTypeId: rack.typeId, siteId: rack.siteId, cabinetId: rack.cabinetId, ...extra },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { device: { id: string } }).device.id;
}

test.describe('Sơ đồ mạng — vị trí U, mặt tủ và ảnh thật', () => {
  test('form thiết bị: khai U; chồng U với máy khác cùng tủ bị chặn kèm tên máy đang chiếm; U hiện ở vị trí', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const rack = await seedRack(page);
    const holder = `SW-E2E-UA${rack.stamp}`;
    await createDevice(page, rack, holder, { rackUStart: 5, rackUSize: 2 });
    const mover = await createDevice(page, rack, `SW-E2E-UB${rack.stamp}`);

    await page.goto(`/devices/${mover}`);
    await page.getByRole('button', { name: 'Sửa hồ sơ' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'U bắt đầu' }).fill('6');
    await form.getByRole('textbox', { name: 'Số U' }).fill('1');
    // Chồng U báo NGAY tại ô (trước khi lưu), không gửi gì; câu dưới ô nói máy nằm ở đâu.
    await expect(form.getByRole('alert')).toContainText(`Chỗ U6 đang có ${holder}`);
    await form.getByRole('textbox', { name: 'Số U' }).fill('2');
    await expect(form.getByRole('alert')).toContainText(`Chỗ U6–U7 đang có ${holder}`);
    await form.getByRole('textbox', { name: 'Số U' }).fill('1');

    // "Xem tủ": mặt đứng 12U, máy 2U chiếm U5 và U6; bấm U9 trống thì điền "U bắt đầu".
    await form.getByRole('button', { name: 'Xem tủ' }).click();
    const view = page.getByRole('dialog', { name: `Tủ mạng ${rack.siteCode} · ${rack.cabinetCode} (12U)` });
    const units = view.getByRole('list', { name: `Các U của tủ ${rack.siteCode} · ${rack.cabinetCode}` });
    await expect(units.getByRole('listitem')).toHaveCount(12);
    await expect(units.getByRole('listitem').nth(6)).toContainText(`U6${holder}`);
    await expect(units.getByRole('listitem').nth(7)).toContainText(`U5${holder}`);
    await units.getByRole('button', { name: 'Đặt máy ở U9' }).click();
    await expect(view).toHaveCount(0);
    await expect(form.getByRole('textbox', { name: 'U bắt đầu' })).toHaveValue('9');
    await expect(form.getByText('Thiết bị nằm ở U9.')).toBeVisible();

    // Server vẫn là trọng tài: chiếm chỗ qua API ngay trước khi lưu → lỗi server gắn vào ô U.
    const sneak = await createDevice(page, rack, `SW-E2E-UE${rack.stamp}`, { rackUStart: 9, rackUSize: 1 });
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText(`U9 trong tủ đang có SW-E2E-UE${rack.stamp}`);
    const freed = await page.request.patch(`/api/v1/devices/${sneak}`, {
      headers: await writeHeaders(page),
      data: { rackUStart: null, rackUSize: null, cabinetId: null },
    });
    expect(freed.status(), await freed.text()).toBe(200);
    await form.getByRole('textbox', { name: 'U bắt đầu' }).fill('9');
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(form).toBeHidden();
    await expect(page.getByText(`${rack.siteCode}\u00A0· ${rack.cabinetCode}\u00A0· U9`).first()).toBeVisible();

    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    await expect(page.getByText(/U bắt đầu: \(trống\) → 9/)).toBeVisible();
  });

  test('đường hỏng qua API: U vượt chiều cao tủ / U mà không có tủ → 400 tiếng Việt', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const rack = await seedRack(page);
    const over = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: { code: `SW-E2E-UC${rack.stamp}`, name: 'Vượt tủ', deviceTypeId: rack.typeId, siteId: rack.siteId, cabinetId: rack.cabinetId, rackUStart: 11, rackUSize: 3 },
    });
    expect(over.status()).toBe(400);
    expect(((await over.json()) as { message: string }).message).toContain(`U11–U13 vượt tủ ${rack.cabinetCode} (12U)`);
    const noCabinet = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: { code: `SW-E2E-UD${rack.stamp}`, name: 'Không tủ', deviceTypeId: rack.typeId, siteId: rack.siteId, rackUStart: 1, rackUSize: 1 },
    });
    expect(noCabinet.status()).toBe(400);
    expect(((await noCabinet.json()) as { message: string }).message).toContain('chọn tủ');
  });

  test('"Dựng lại mặt tủ": chỉ khung mặt trước, máy đúng U, ảnh thật mặt trước; dựng lại khi kho chưa đổi không thêm nháp; công tắc Biểu tượng / Ảnh thật', async ({ page }) => {
    test.setTimeout(240_000);
    const secret = await firstLogin(page, E2E_SA);
    const rack = await seedRack(page);
    const withPhoto = `SW-E2E-UP${rack.stamp}`;
    const deviceId = await createDevice(page, rack, withPhoto, { model: `E2E-C9300-${rack.stamp}`, rackUStart: 5, rackUSize: 2 });
    await createDevice(page, rack, `SW-E2E-UN${rack.stamp}`, { rackUStart: 1, rackUSize: 1 });

    // Ảnh mặt trước của riêng máy: chọn từ giấy tờ đính kèm của chính máy.
    const upload = await page.request.post('/api/v1/files', {
      headers: await writeHeaders(page),
      multipart: { ownerType: 'device', ownerId: deviceId, file: { name: `mat-truoc-${rack.stamp}.png`, mimeType: 'image/png', buffer: PNG } },
    });
    expect(upload.status(), await upload.text()).toBe(201);
    const fileId = ((await upload.json()) as { id: string }).id;
    const chosen = await page.request.patch(`/api/v1/devices/${deviceId}/photos`, { headers: await writeHeaders(page), data: { front: fileId } });
    expect(chosen.status(), await chosen.text()).toBe(200);

    // Khung tủ dựng từ kho: máy 2U ở U5–U6 của tủ 12U (U1 ở đáy) — chỉ mặt trước, một ô mỗi máy.
    const frame = (await (await page.request.get(`/api/v1/diagrams/cabinet-frame/${rack.cabinetId}`)).json()) as {
      layout: { frames: { key: string }[]; devices: { frame: string; code: string; y: number; height: number; attrs: Record<string, string> }[] };
    };
    expect(frame.layout.frames.map((f) => f.key)).toEqual(['rack']);
    const placed = frame.layout.devices.filter((d) => d.code === withPhoto);
    expect(placed.map((d) => d.frame)).toEqual(['rack']);
    expect(placed[0].y).toBeCloseTo(21 + (12 - 6) * 14.8, 1);
    expect(placed[0].height).toBeCloseTo(2 * 14.8, 1);
    expect(placed[0].attrs).toEqual({ ims_photo: 'front' });

    const created = await page.request.post('/api/v1/diagrams', {
      headers: await writeHeaders(page),
      data: { name: `E2E Tủ ${rack.cabinetCode}`, nodeType: 'cabinet', siteId: rack.siteId, cabinetId: rack.cabinetId },
    });
    expect(created.status(), await created.text()).toBe(201);
    const diagramId = ((await created.json()) as { id: string }).id;
    await stepUpViaApi(page, secret, 'diagram');

    await page.goto(`/diagrams/${diagramId}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    await diagramBarAction(page, 'Dựng lại mặt tủ');
    const confirm = page.getByRole('dialog', { name: 'Dựng lại mặt tủ từ kho?' });
    await confirm.getByRole('button', { name: 'Dựng lại' }).click();
    await expect(page.getByText('Đã dựng lại mặt tủ thành nháp #1.')).toBeVisible();
    const xml = sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${diagramId}' ORDER BY seq DESC LIMIT 1`);
    expect(xml).toContain(`label="Tủ ${rack.cabinetCode}"`);
    expect(xml).not.toContain('Mặt sau');
    expect(xml).toContain('ims_photo="front"');
    // XML lưu "khô": ảnh chỉ nhúng lúc mở sửa (AD-18).
    expect(xml).not.toContain('data:image');
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    if (process.env.IMS_SHOT_DIR) await page.screenshot({ path: `${process.env.IMS_SHOT_DIR}/tu-chi-mat-truoc.png` });

    // Dựng lại lần nữa khi kho chưa đổi gì: không thêm nháp, số phiên bản giữ nguyên (Q-23).
    await diagramBarAction(page, 'Dựng lại mặt tủ');
    await page.getByRole('dialog', { name: 'Dựng lại mặt tủ từ kho?' }).getByRole('button', { name: 'Dựng lại' }).click();
    await expect(page.getByText('Mặt tủ dựng từ kho trùng bản mới nhất — không tạo phiên bản mới.')).toBeVisible();
    expect(sql(`SELECT count(*) FROM diagram_version WHERE diagram_id = '${diagramId}'`)).toBe('1');

    // Công tắc: mặt sau không có ảnh → tắt kèm lý do; đổi ô mặt trước về Biểu tượng rồi lưu.
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    await diagramBarAction(page, 'Ảnh thật…');
    const box = page.getByRole('dialog', { name: 'Biểu tượng / Ảnh thật' });
    const first = box.getByRole('radiogroup', { name: `Hình của ${withPhoto}` }).first();
    await expect(first.getByRole('radio', { name: /Ảnh mặt trước/ })).toBeChecked();
    await expect(first.getByRole('radio', { name: /Ảnh mặt sau/ })).toBeDisabled();
    await expect(first).toContainText('Máy chưa có ảnh mặt sau');
    await first.getByRole('radio', { name: /Biểu tượng/ }).check();
    await box.getByRole('button', { name: 'Đóng', exact: true }).click();

    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${diagramId}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    const after = sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${diagramId}' ORDER BY seq DESC LIMIT 1`);
    expect(after).not.toContain('ims_photo="front"');
    expect(after).not.toContain('data:image');
  });

  test('"Dựng từ kho" (Q-23 06/10 chiều): bản vẽ con cấp tủ chọn tủ là mặc định dựng từ kho, hỏi mã sơ đồ, ra nháp #1 có máy đúng U', async ({ page }) => {
    test.setTimeout(180_000);
    const secret = await firstLogin(page, E2E_SA);
    const rack = await seedRack(page);
    const deviceId = await createDevice(page, rack, `SW-E2E-DK${rack.stamp}`, { rackUStart: 5, rackUSize: 2 });
    const parentName = `E2E Phòng dựng từ kho ${rack.stamp}`;
    const parent = await page.request.post('/api/v1/diagrams', {
      headers: await writeHeaders(page),
      data: { name: parentName, nodeType: 'room', siteId: rack.siteId },
    });
    expect(parent.status(), await parent.text()).toBe(201);
    const parentId = ((await parent.json()) as { id: string }).id;

    await page.goto(`/diagrams?node=${parentId}`);
    await page.getByRole('complementary', { name: 'Bản vẽ đang chọn' }).getByRole('button', { name: `Thao tác với ${parentName}` }).click();
    await page.getByRole('menuitem', { name: 'Thêm bản vẽ con' }).click();
    const dialog = page.getByRole('dialog', { name: `Thêm bản vẽ con vào "${parentName}"` });
    // Cấp thường: mặc định trang trắng, không có "Dựng từ kho".
    await expect(dialog.getByRole('radio', { name: 'Trang trắng' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Dựng từ kho' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Loại bản vẽ' }).click();
    await page.getByRole('option', { name: 'Tủ mạng' }).click();
    await dialog.getByRole('button', { name: /^Tủ/ }).click();
    await page.getByRole('option', { name: rack.cabinetCode }).click();
    await expect(dialog.getByRole('radio', { name: 'Dựng từ kho' })).toBeChecked();
    const name = `E2E Tủ dựng từ kho ${rack.stamp}`;
    await dialog.getByLabel('Tên bản vẽ').fill(name);
    await dialog.getByRole('button', { name: 'Lưu', exact: true }).click();
    // Ghi NỘI DUNG bản vẽ nên hỏi mã sơ đồ (mã đăng nhập không mở phạm vi sơ đồ).
    await fillOtp(page.getByRole('dialog', { name: 'Nhập mã 6 số để mở sơ đồ' }), await freshTotpCode(secret));
    await expect(page.getByText(`Đã tạo bản vẽ "${name}" — mặt tủ dựng từ kho, đang là bản nháp #1.`)).toBeVisible();

    const diagramId = sql(`SELECT id FROM diagram WHERE name = '${name}'`);
    expect(sql(`SELECT seq || ' ' || (svg IS NULL) FROM diagram_version WHERE diagram_id = '${diagramId}'`)).toBe('1 true');
    const xml = sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${diagramId}'`);
    expect(xml).toContain(`label="Tủ ${rack.cabinetCode}"`);
    // Máy 2U ở U5–U6 của tủ 12U (U1 ở đáy): cao 2U, đáy ở U5 — cùng số đo của khung "Dựng lại mặt tủ".
    expect(xml).toMatch(new RegExp(`ims_device_id="${deviceId}"[^]*?<mxGeometry x="[^"]+" y="109\\.8" width="[^"]+" height="29\\.6"`));
    await page.goto(`/diagrams/${diagramId}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
  });

  test('390px: trang thiết bị đọc được vị trí U và ảnh thật, không tràn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await firstLogin(page, E2E_SA);
    const rack = await seedRack(page);
    const deviceId = await createDevice(page, rack, `SW-E2E-UM${rack.stamp}`, { rackUStart: 3, rackUSize: 2 });
    await page.goto(`/devices/${deviceId}`);
    await expect(page.getByText(`${rack.siteCode}\u00A0· ${rack.cabinetCode}\u00A0· U3–U4`).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hình dùng trên sơ đồ', exact: true })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    // Ảnh chỉ quản lý ở "Hình dùng trên sơ đồ" (Q-26 07/10): tab Giấy tờ không còn khu chọn ảnh từ giấy tờ.
    await expect(page.getByRole('heading', { name: 'Hình dùng trên sơ đồ — chọn từ giấy tờ' })).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('Sơ đồ mạng — mặt tủ không đè U, dây không đứt khi dựng tủ (Q-23 05/10)', () => {
  test('máy 1U ở U30 đã có dây trên bản vẽ: "Chèn tủ mạng" dời chính ô đó vào khung (cao 1U, nhãn bên phải), "Dựng lại mặt tủ" giữ id + dây đã khai', async ({ page }) => {
    test.setTimeout(240_000);
    const secret = await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const siteId = await catalogItem(page, 'site', { code: `E2E-T${stamp}`, name: `Site tủ E2E ${stamp}` });
    const cabinetCode = `E2E-T42${stamp}`;
    const cabinetId = await catalogItem(page, 'cabinet', { siteId, code: cabinetCode, uHeight: 42 });
    const typeId = ((await (await page.request.get('/api/v1/catalog')).json()) as { deviceTypes: { id: string; name: string }[] }).deviceTypes.find((t) => t.name === 'Switch')!.id;
    const make = async (code: string, extra: Record<string, unknown>) => {
      const res = await page.request.post('/api/v1/devices', { headers: await writeHeaders(page), data: { code, name: code, deviceTypeId: typeId, siteId, cabinetId, ...extra } });
      expect(res.status(), await res.text()).toBe(201);
      return ((await res.json()) as { device: { id: string } }).device.id;
    };
    const ups = { id: await make(`UPS-E2E-30${stamp}`, { rackUStart: 30, rackUSize: 1 }), code: `UPS-E2E-30${stamp}` };
    const fw = { id: await make(`FW-E2E-37${stamp}`, { rackUStart: 37, rackUSize: 1 }), code: `FW-E2E-37${stamp}` };
    const linked = await page.request.post(`/api/v1/devices/${fw.id}/ports/link`, {
      headers: await writeHeaders(page),
      data: { portLabel: 'Gi1/0/1', connectedDeviceId: ups.id, connectedPort: 'Gi1/0/1', cableTypeId: '' },
    });
    expect(linked.status(), await linked.text()).toBe(201);
    const linkId = ((await linked.json()) as { id: string }).id;
    const created = await page.request.post('/api/v1/diagrams', { headers: await writeHeaders(page), data: { name: `E2E Tủ 42U ${stamp}`, nodeType: 'cabinet', siteId, cabinetId } });
    expect(created.status(), await created.text()).toBe(201);
    const diagramId = ((await created.json()) as { id: string }).id;
    await stepUpViaApi(page, secret, 'diagram');
    // Bản vẽ như của chủ dự án: hai máy đứng tự do (ô ảnh cao 60–120) nối một dây đã khai.
    const xml =
      '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      `<UserObject label="${fw.code}" ims_device_id="${fw.id}" ims_device_code="${fw.code}" id="cell-fw"><mxCell style="align=center;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="300" height="120" as="geometry"/></mxCell></UserObject>` +
      `<UserObject label="${ups.code}" ims_device_id="${ups.id}" ims_device_code="${ups.code}" id="cell-ups"><mxCell style="align=center;" vertex="1" parent="1"><mxGeometry x="400" y="300" width="45" height="60" as="geometry"/></mxCell></UserObject>` +
      `<UserObject label="" ims_link_id="${linkId}" id="cap"><mxCell style="edgeStyle=orthogonalEdgeStyle;endArrow=none;" edge="1" parent="1" source="cell-fw" target="cell-ups"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject>` +
      '</root></mxGraphModel></diagram></mxfile>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500px" height="400px" viewBox="0 0 500 400"><g data-cell-id="cell-fw"><rect x="40" y="40" width="300" height="120"/></g></svg>';
    const seeded = await page.request.post(`/api/v1/diagrams/${diagramId}/versions`, { headers: await writeHeaders(page), data: { xml, svg, basedOnVersionId: null } });
    expect(seeded.status(), await seeded.text()).toBe(201);

    await page.goto(`/diagrams/${diagramId}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    await diagramBarAction(page, 'Chèn tủ mạng');
    const box = page.getByRole('dialog', { name: 'Chèn khung tủ có sẵn máy' });
    await box.getByRole('button', { name: 'Tủ mạng', exact: true }).click();
    await page.getByRole('option', { name: `E2E-T${stamp} · ${cabinetCode}` }).click();
    await box.getByRole('button', { name: 'Chèn tủ mạng' }).click();
    await expect(page.getByText(`Đã chèn khung tủ ${cabinetCode} (2 thiết bị) — 2 máy đã có trên bản vẽ được dời vào khung, dây giữ nguyên.`)).toBeVisible();
    if (process.env.IMS_SHOT_DIR) await page.screenshot({ path: `${process.env.IMS_SHOT_DIR}/tu-chen-giu-day.png` });
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${diagramId}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    const v2 = ((await saved.json()) as { id: string }).id;
    const stored = sql(`SELECT xml FROM diagram_version WHERE id = '${v2}'`);
    // Ô cũ được dời (không có ô thứ hai cho mặt trước), cao đúng 1U, dây vẫn nối hai ô cũ.
    // XML lưu do draw.io xuất có xuống dòng giữa thẻ, thuộc tính xếp theo tên.
    expect(stored).toMatch(/id="cell-ups">\s*<mxCell[^>]*>\s*<mxGeometry height="14.8"/);
    expect(stored).toMatch(/id="cap">\s*<mxCell[^>]*source="cell-fw"[^>]*target="cell-ups"/);
    const view = (await (await page.request.get(`/api/v1/diagrams/${diagramId}/content?mode=view&versionId=${v2}`)).json()) as {
      cableEdges: { cellId: string; state: string }[];
    };
    expect(view.cableEdges.find((e) => e.cellId === 'cap')?.state).toBe('linked');

    // Dựng lại mặt tủ từ kho: id ô máy và dây giữ nguyên, dây không thành "không khớp".
    await diagramBarAction(page, 'Dựng lại mặt tủ');
    await page.getByRole('dialog', { name: 'Dựng lại mặt tủ từ kho?' }).getByRole('button', { name: 'Dựng lại' }).click();
    await expect(page.getByText(/^Đã dựng lại mặt tủ thành nháp #3\./)).toBeVisible();
    const rebuilt = sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${diagramId}' ORDER BY seq DESC LIMIT 1`);
    expect(rebuilt).toContain('id="cell-ups"');
    expect(rebuilt).toContain(`ims_link_id="${linkId}"`);
    const latest = (await (await page.request.get(`/api/v1/diagrams/${diagramId}/content?mode=view`)).json()) as { cableEdges: { cellId: string; state: string }[] };
    expect(latest.cableEdges.map((e) => e.state)).toEqual(['linked']);
    // Bản dựng lại chưa có ảnh xem: Lưu bật ngay dù chưa sửa gì — lưu là cách tạo ảnh xem.
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    const [preview] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${diagramId}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(preview.status(), await preview.text()).toBe(201);
    await page.goto(`/diagrams/${diagramId}`);
    await expect(page.getByRole('region', { name: 'Bản vẽ, chỉ xem' })).toBeVisible();
    if (process.env.IMS_SHOT_DIR) await page.screenshot({ path: `${process.env.IMS_SHOT_DIR}/tu-dung-lai-xem.png` });
    await expect(page.getByText('Kết nối không khớp hai máy ở hai đầu dây')).toHaveCount(0);
  });
});

test.describe('Sơ đồ mạng — "Chuyển máy sang tủ này" ghi kho có hỏi trước (Q-23 06/10)', () => {
  const RACK_STYLE =
    'shape=mxgraph.rackGeneral.rackCabinet3;rackUnitSize=14.8;container=1;collapsible=0;childLayout=rack;allowGaps=1;marginLeft=33;marginRight=9;marginTop=21;marginBottom=22;numDisp=descend;';

  test('máy tủ A nằm trong khung tủ B: lời báo mời chuyển → hộp nêu tủ cũ/mới, U, Số U; chồng U bị chặn (web + API); Chuyển ghi kho rồi đặt lại ô theo U mới', async ({ page }) => {
    test.setTimeout(240_000);
    const secret = await firstLogin(page, E2E_SA);
    const rack = await seedRack(page);
    const cabinetB = `E2E-RB${rack.stamp}`;
    const cabinetBId = await catalogItem(page, 'cabinet', { siteId: rack.siteId, code: cabinetB, uHeight: 12 });
    const mover = `SW-E2E-CV${rack.stamp}`;
    const moverId = await createDevice(page, rack, mover, { rackUStart: 3, rackUSize: 1 });
    const holder = `SW-E2E-CG${rack.stamp}`;
    await createDevice(page, { ...rack, cabinetId: cabinetBId }, holder, { rackUStart: 5, rackUSize: 1 });

    const created = await page.request.post('/api/v1/diagrams', { headers: await writeHeaders(page), data: { name: `E2E Chuyển tủ ${rack.stamp}`, nodeType: 'room' } });
    expect(created.status(), await created.text()).toBe(201);
    const diagramId = ((await created.json()) as { id: string }).id;
    await stepUpViaApi(page, secret, 'diagram');
    // Máy của tủ A thả ở U5 trong khung của tủ B (tủ 12U: đỉnh ô ở 21 + (12 − 5) × 14.8).
    const xml =
      '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      `<UserObject label="Tủ ${cabinetB}" ims_cabinet_id="${cabinetBId}" id="frame-b"><mxCell style="${RACK_STYLE}" vertex="1" parent="1"><mxGeometry x="40" y="40" width="204" height="220.6" as="geometry"/></mxCell></UserObject>` +
      `<UserObject label="${mover}" ims_device_id="${moverId}" ims_device_code="${mover}" id="cell-mover"><mxCell style="align=center;" vertex="1" parent="frame-b"><mxGeometry x="33" y="124.6" width="162" height="14.8" as="geometry"/></mxCell></UserObject>` +
      '</root></mxGraphModel></diagram></mxfile>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300px" height="300px" viewBox="0 0 300 300"><g data-cell-id="frame-b"><rect x="40" y="40" width="204" height="220"/></g></svg>';
    const seeded = await page.request.post(`/api/v1/diagrams/${diagramId}/versions`, { headers: await writeHeaders(page), data: { xml, svg, basedOnVersionId: null } });
    expect(seeded.status(), await seeded.text()).toBe(201);

    await page.goto(`/diagrams/${diagramId}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByText(`Máy ${mover} trong kho thuộc tủ ${rack.cabinetCode}, không phải tủ của khung "Tủ ${cabinetB}"`)).toBeVisible();
    await page.getByRole('button', { name: 'Chuyển máy sang tủ này' }).click();
    const dialog = page.getByRole('dialog', { name: 'Chuyển máy sang tủ này?' });
    // U5 nơi thả đã có máy khác → đề xuất U trống gần nhất (U4).
    await expect(dialog.getByText(`Chuyển ${mover} từ ${rack.cabinetCode} sang ${cabinetB}, U bắt đầu = 4, Số U = 1.`)).toBeVisible();
    if (process.env.IMS_SHOT_DIR) await page.screenshot({ path: `${process.env.IMS_SHOT_DIR}/chuyen-may-sang-tu.png` });
    expect(sql(`SELECT cabinet_id FROM device WHERE id = '${moverId}'`)).toBe(rack.cabinetId);

    // Chồng U: web chặn tại ô; API của devices cũng từ chối (server là trọng tài).
    const u = dialog.getByRole('textbox', { name: 'U bắt đầu' });
    await u.fill('5');
    await expect(dialog.getByRole('alert')).toContainText(`Chỗ U5 đang có ${holder}`);
    await expect(dialog.getByRole('button', { name: 'Chuyển máy' })).toBeDisabled();
    const overlap = await page.request.patch(`/api/v1/devices/${moverId}`, {
      headers: await writeHeaders(page),
      data: { siteId: rack.siteId, cabinetId: cabinetBId, rackUStart: 5, rackUSize: 1 },
      failOnStatusCode: false,
    });
    expect(overlap.status()).toBeGreaterThanOrEqual(400);
    expect(((await overlap.json()) as { code: string }).code).toBe('DEVICE_RACK_U_TAKEN');
    expect(sql(`SELECT cabinet_id FROM device WHERE id = '${moverId}'`)).toBe(rack.cabinetId);

    await u.fill('7');
    await expect(dialog.getByText(`Chuyển ${mover} từ ${rack.cabinetCode} sang ${cabinetB}, U bắt đầu = 7, Số U = 1.`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Chuyển máy' }).click();
    await expect(page.getByText(`Đã chuyển ${mover} sang tủ ${cabinetB} ở U7 trong kho.`)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(sql(`SELECT cabinet_id || ' ' || rack_u_start || ' ' || rack_u_size FROM device WHERE id = '${moverId}'`)).toBe(`${cabinetBId} 7 1`);
    // Ghi qua API sửa thiết bị: lịch sử thiết bị + nhật ký như sửa ở trang thiết bị.
    expect(Number(sql(`SELECT count(*) FROM audit_log WHERE action = 'device.updated' AND object_id = '${moverId}'`))).toBeGreaterThanOrEqual(1);

    // Ô được đặt lại theo U mới (U7 của tủ 12U: đỉnh ô ở 21 + 5 × 14.8 = 95) — lưu để giữ.
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${diagramId}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    const stored = sql(`SELECT xml FROM diagram_version WHERE id = '${((await saved.json()) as { id: string }).id}'`);
    expect(stored).toMatch(/id="cell-mover">\s*<mxCell[^>]*>\s*<mxGeometry[^>]*y="95"/);
  });
});

test.describe('Sơ đồ mạng — máy trong khung tủ chỉ theo U kho (Q-23 06/10 C, D)', () => {
  const RACK_STYLE =
    'shape=mxgraph.rackGeneral.rackCabinet3;rackUnitSize=14.8;container=1;collapsible=0;childLayout=rack;allowGaps=1;marginLeft=33;marginRight=9;marginTop=21;marginBottom=22;numDisp=descend;verticalLabelPosition=bottom;verticalAlign=top;';

  /** Mặt máy 1U đã cắt đúng tỉ lệ 19" (1086×100) — vẽ bằng canvas, không giữ tệp nhị phân trong repo. */
  async function rackPhoto(page: Page): Promise<Buffer> {
    const data = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1086;
      canvas.height = 100;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'dimgray';
      ctx.fillRect(0, 0, 1086, 100);
      ctx.fillStyle = 'black';
      for (let x = 60; x < 1020; x += 40) ctx.fillRect(x, 30, 24, 40);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    return Buffer.from(data, 'base64');
  }

  test('ảnh 3–5 của chủ dự án: mở bản vẽ → máy tủ khác 4U được đặt 1U, ảnh lấp ô U, nhãn một dòng (Lưu vẫn tắt); Hủy chuyển → ra ngoài khung; máy chưa khai U kéo vào khung → hỏi U, Hủy → cột "Chưa khai U"', async ({ page }) => {
    test.setTimeout(300_000);
    const secret = await firstLogin(page, E2E_SA);
    const rack = await seedRack(page);
    const cabinetB = `E2E-RB${rack.stamp}`;
    const cabinetBId = await catalogItem(page, 'cabinet', { siteId: rack.siteId, code: cabinetB, uHeight: 12 });
    const inB = { ...rack, cabinetId: cabinetBId };
    const mover = `SW-E2E-KT${rack.stamp}`;
    const moverId = await createDevice(page, rack, mover, { rackUStart: 3, rackUSize: 1 });
    const own = `SW-E2E-KA${rack.stamp}`;
    const ownId = await createDevice(page, inB, own, { rackUStart: 8, rackUSize: 1 });
    const next = `SW-E2E-KB${rack.stamp}`;
    const nextId = await createDevice(page, inB, next, { rackUStart: 9, rackUSize: 1 });
    const loose = `SW-E2E-KU${rack.stamp}`;
    const looseId = await createDevice(page, inB, loose);
    const up = await page.request.post('/api/v1/files', {
      headers: await writeHeaders(page),
      multipart: { ownerType: 'device', ownerId: ownId, file: { name: `mat-1u-${rack.stamp}.png`, mimeType: 'image/png', buffer: await rackPhoto(page) } },
    });
    expect(up.status(), await up.text()).toBe(201);
    const photoId = ((await up.json()) as { id: string }).id;
    expect((await page.request.patch(`/api/v1/devices/${ownId}/photos`, { headers: await writeHeaders(page), data: { front: photoId } })).status()).toBe(200);

    const created = await page.request.post('/api/v1/diagrams', { headers: await writeHeaders(page), data: { name: `E2E Tủ theo U ${rack.stamp}`, nodeType: 'room' } });
    expect(created.status(), await created.text()).toBe(201);
    const diagramId = ((await created.json()) as { id: string }).id;
    await stepUpViaApi(page, secret, 'diagram');
    // Như bản vẽ "PMH Tower": các ô trong khung còn cỡ trang tự do (4U), máy tủ A nằm trong khung tủ B;
    // máy chưa khai U đứng ngoài khung.
    const cell = (id: string, deviceId: string, code: string, parent: string, geo: string, extra = '') =>
      `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}"${extra} id="${id}"><mxCell style="align=center;" vertex="1" parent="${parent}">${geo}</mxCell></UserObject>`;
    const xml =
      '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      `<UserObject label="Tủ ${cabinetB}" ims_cabinet_id="${cabinetBId}" id="frame-b"><mxCell style="${RACK_STYLE}" vertex="1" parent="1"><mxGeometry x="300" y="40" width="204" height="220.6" as="geometry"/></mxCell></UserObject>` +
      cell('cell-own', ownId, own, 'frame-b', '<mxGeometry x="33" y="35.8" width="162" height="59.2" as="geometry"/>', ' ims_photo="front"') +
      cell('cell-next', nextId, next, 'frame-b', '<mxGeometry x="33" y="21" width="162" height="59.2" as="geometry"/>') +
      cell('cell-mover', moverId, mover, 'frame-b', '<mxGeometry x="33" y="109.8" width="162" height="59.2" as="geometry"/>') +
      cell('cell-loose', looseId, loose, '1', '<mxGeometry x="40" y="120" width="60" height="60" as="geometry"/>') +
      '</root></mxGraphModel></diagram></mxfile>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600px" height="300px" viewBox="0 0 600 300"><g data-cell-id="frame-b"><rect x="300" y="40" width="204" height="220"/></g></svg>';
    const seeded = await page.request.post(`/api/v1/diagrams/${diagramId}/versions`, { headers: await writeHeaders(page), data: { xml, svg, basedOnVersionId: null } });
    expect(seeded.status(), await seeded.text()).toBe(201);

    await page.goto(`/diagrams/${diagramId}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Thiết bị kho', exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByText(`Máy ${mover} trong kho thuộc tủ ${rack.cabinetCode}, không phải tủ của khung "Tủ ${cabinetB}"`)).toBeVisible();
    const drawio = page.frameLocator('iframe[title="Khung vẽ draw.io"]');
    // Nhãn một dòng "mã · IP" (máy chưa có IP → chỉ mã) bên phải — không còn nhãn ba dòng chồng nhau.
    await expect(drawio.getByText(own, { exact: true })).toBeVisible();
    await expect(drawio.getByText(next, { exact: true })).toBeVisible();
    // IMS đặt lại hình nhưng không coi là người vẽ đã sửa: Lưu vẫn tắt.
    await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toBeDisabled();
    const ownLabel = (await drawio.getByText(own, { exact: true }).boundingBox())!;
    const nextLabel = (await drawio.getByText(next, { exact: true }).boundingBox())!;
    // U8 và U9 sát nhau: hai nhãn một dòng không chồng lên nhau.
    expect(ownLabel.y - nextLabel.y).toBeGreaterThanOrEqual(nextLabel.height - 2);
    const frameShot = page.locator('iframe[title="Khung vẽ draw.io"]');
    if (process.env.IMS_SHOT_DIR) {
      await frameShot.screenshot({ path: `${process.env.IMS_SHOT_DIR}/3.png` });
      await page.screenshot({ path: `${process.env.IMS_SHOT_DIR}/4.png`, clip: { x: Math.max(0, ownLabel.x - 260), y: Math.max(0, ownLabel.y - 80), width: 520, height: 200 } });
    }

    // Hủy "Chuyển máy sang tủ này" → máy tủ A ra NGOÀI khung, không ghi kho.
    await page.getByRole('button', { name: 'Chuyển máy sang tủ này' }).click();
    const dialog = page.getByRole('dialog', { name: 'Chuyển máy sang tủ này?' });
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toBeEnabled();
    expect(sql(`SELECT cabinet_id FROM device WHERE id = '${moverId}'`)).toBe(rack.cabinetId);

    // Máy chưa khai U kéo (chuột thật trong trình vẽ) vào khung tủ của nó → hỏi khai U.
    const looseLabel = (await drawio.getByText(loose, { exact: true }).first().boundingBox())!;
    const frameLabel = (await drawio.getByText(`Tủ ${cabinetB}`, { exact: true }).boundingBox())!;
    await page.mouse.move(looseLabel.x + looseLabel.width / 2, looseLabel.y - 25);
    await page.mouse.down();
    await page.mouse.move(frameLabel.x + frameLabel.width / 2, frameLabel.y - 40, { steps: 20 });
    await page.mouse.up();
    const declare = page.getByRole('dialog', { name: 'Khai U cho máy này?' });
    await expect(declare).toBeVisible();
    await expect(declare.getByText(new RegExp(`Khai ${loose} ở tủ ${cabinetB}, U bắt đầu = \\d+, Số U = 1\\.`))).toBeVisible();
    await declare.getByRole('button', { name: 'Hủy, để ở cột Chưa khai U' }).click();
    await expect(declare).toHaveCount(0);
    expect(sql(`SELECT coalesce(rack_u_start::text, '') FROM device WHERE id = '${looseId}'`)).toBe('');
    await expect(drawio.getByText(`Tủ ${cabinetB} · Chưa khai U`)).toBeVisible();
    if (process.env.IMS_SHOT_DIR) {
      // Thu cả trang vào khung nhìn (Ctrl+Shift+H của draw.io) để thấy máy ra ngoài khung và cột mới.
      await clickDrawioCanvas(page, 20, 20);
      await page.keyboard.press('Control+Shift+H');
      await frameShot.screenshot({ path: `${process.env.IMS_SHOT_DIR}/5.png` });
    }

    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${diagramId}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    const stored = sql(`SELECT xml FROM diagram_version WHERE id = '${((await saved.json()) as { id: string }).id}'`);
    // Máy tủ A ở ngoài khung; máy của tủ cao đúng 1U ở U kho (U8 của tủ 12U: đỉnh ô ở 21 + 4 × 14.8 = 80.2).
    expect(stored).toMatch(/id="cell-mover">\s*<mxCell[^>]*parent="1"/);
    expect(stored).toMatch(/id="cell-own">\s*<mxCell[^>]*>\s*<mxGeometry height="14.8"[^>]*y="80.2"/);
    expect(stored).toMatch(/id="cell-next">\s*<mxCell[^>]*>\s*<mxGeometry height="14.8"[^>]*y="65.4"/);
    // Máy chưa khai U nằm trong cột "Chưa khai U" (khung mang ims_cabinet_id của tủ B).
    const column = new RegExp(`<UserObject[^>]*ims_cabinet_id="${cabinetBId}"[^>]*>\\s*<mxCell[^>]*stackLayout`).exec(stored)?.[0] ?? '';
    const columnId = /\sid="([^"]+)"/.exec(column)?.[1];
    expect(columnId, stored).toBeTruthy();
    expect(stored).toMatch(new RegExp(`id="cell-loose">\\s*<mxCell[^>]*parent="${columnId}"`));
  });
});
