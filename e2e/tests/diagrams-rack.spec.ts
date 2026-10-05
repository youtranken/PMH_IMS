import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  catalogItem,
  diagramBarAction,
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
} from './helpers';

/*
 * Ảnh thật, vị trí U và mặt tủ (Q-23 "chồng U trong cùng tủ thì chặn"): khai U trên
 * form thiết bị, chồng U bị từ chối bằng câu tiếng Việt nêu tên máy đang chiếm; "Dựng lại mặt tủ"
 * xếp máy đúng U ở mặt trước + mặt sau với ảnh thật; công tắc Biểu tượng / Ảnh thật trên màn sửa
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
    const view = page.getByRole('dialog', { name: `Tủ ${rack.siteCode} · ${rack.cabinetCode} (12U)` });
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
    await expect(page.getByText(`${rack.siteCode} · ${rack.cabinetCode} · U9`).first()).toBeVisible();

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

  test('"Dựng lại mặt tủ": khung mặt trước + mặt sau xếp máy đúng U, ảnh thật mặt trước; công tắc Biểu tượng / Ảnh thật', async ({ page }) => {
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

    // Khung tủ dựng từ kho: máy 2U ở U5–U6 của tủ 12U (U1 ở đáy) — có ở cả hai mặt.
    const frame = (await (await page.request.get(`/api/v1/diagrams/cabinet-frame/${rack.cabinetId}`)).json()) as {
      layout: { frames: { key: string }[]; devices: { frame: string; code: string; y: number; height: number; attrs: Record<string, string> }[] };
    };
    expect(frame.layout.frames.map((f) => f.key)).toEqual(['rack', 'rack-back']);
    const placed = frame.layout.devices.filter((d) => d.code === withPhoto);
    expect(placed.map((d) => d.frame)).toEqual(['rack', 'rack-back']);
    expect(placed[0].y).toBeCloseTo(21 + (12 - 6) * 14.8, 1);
    expect(placed[0].height).toBeCloseTo(2 * 14.8, 1);
    expect(placed[0].attrs).toEqual({ ims_photo: 'front' });
    expect(placed[1].attrs).toEqual({});

    const created = await page.request.post('/api/v1/diagrams', {
      headers: await writeHeaders(page),
      data: { name: `E2E Tủ ${rack.cabinetCode}`, nodeType: 'cabinet', siteId: rack.siteId, cabinetId: rack.cabinetId },
    });
    expect(created.status(), await created.text()).toBe(201);
    const diagramId = ((await created.json()) as { id: string }).id;
    await stepUpViaApi(page, secret, 'diagram');

    await page.goto(`/diagrams/${diagramId}?mode=edit`);
    await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toBeEnabled({ timeout: 60_000 });
    await diagramBarAction(page, 'Dựng lại mặt tủ');
    const confirm = page.getByRole('dialog', { name: 'Dựng lại mặt tủ từ kho?' });
    await confirm.getByRole('button', { name: 'Dựng lại' }).click();
    await expect(page.getByText('Đã dựng lại mặt tủ thành nháp #1.')).toBeVisible();
    const xml = sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${diagramId}' ORDER BY seq DESC LIMIT 1`);
    expect(xml).toContain(`Tủ ${rack.cabinetCode} · Mặt trước`);
    expect(xml).toContain(`Tủ ${rack.cabinetCode} · Mặt sau`);
    expect(xml).toContain('ims_photo="front"');
    // XML lưu "khô": ảnh chỉ nhúng lúc mở sửa (AD-18).
    expect(xml).not.toContain('data:image');

    // Công tắc: mặt sau không có ảnh → tắt kèm lý do; đổi ô mặt trước về Biểu tượng rồi lưu.
    await expect(page.getByRole('button', { name: 'Lưu', exact: true })).toBeEnabled({ timeout: 60_000 });
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

  test('390px: trang thiết bị đọc được vị trí U và ảnh thật, không tràn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await firstLogin(page, E2E_SA);
    const rack = await seedRack(page);
    const deviceId = await createDevice(page, rack, `SW-E2E-UM${rack.stamp}`, { rackUStart: 3, rackUSize: 2 });
    await page.goto(`/devices/${deviceId}`);
    await expect(page.getByText(`${rack.siteCode} · ${rack.cabinetCode} · U3–U4`).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hình dùng trên sơ đồ', exact: true })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    await expect(page.getByRole('heading', { name: 'Hình dùng trên sơ đồ — chọn từ giấy tờ' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
