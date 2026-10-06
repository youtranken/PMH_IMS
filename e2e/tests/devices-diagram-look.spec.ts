import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, devicesPageButton, diagramBarAction, firstLogin, resetCatalog, resetDevices, resetDiagrams, resetUsers, sql, stepUpViaApi, uniqueStamp, writeHeaders } from './helpers';

/*
 * "Hình dùng trên sơ đồ" (Q-23 05/10): mỗi máy đổi được ảnh của riêng nó. Thứ tự tra một nơi
 * (ảnh riêng → ảnh model → biểu tượng loại) dùng cho ô chèn từ "Thiết bị kho" và bản đồ quan hệ.
 * Bài này: máy A có ảnh riêng (tải ở trang thiết bị), máy B cùng model chỉ có ảnh model (SA đặt).
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetDiagrams();
  resetCatalog();
});

/** PNG 1×1 hợp lệ (đỏ) và một PNG 1×1 khác (xanh) — `files` kiểm theo nội dung. */
const PNG_OWN = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const PNG_MODEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** PNG 400×100 (tỉ lệ 1U nằm ngang) — ô ảnh trên bản vẽ phải mang đúng tỉ lệ 1:4 này. */
const PNG_WIDE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAZAAAABkCAYAAACoy2Z3AAABh0lEQVR4nO3VsRGAMBDAsLD5bw4z4EsRDmkCd75m5l4A8JKBAJAYCACJgQCQGAgAiYEAkBgIAImBAJAYCACJgQCQGAgAiYEAkBgIAImBAJAYCACJgQCQGAgAiYEAkBgIAImBAJAYCACJgQCQGAgAiYEAkBgIAImBAJAYCACJgQCQGAgAiYEAkGwfyMysk83hfQBfYSAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACTbBwLAPxgIAImBAJAYCACJgQCQGAgAiYEAkBgIAImBAJAYCACJgQCQGAgAiYEAkBgIAImBAJAYCACJgQCQGAgAiYEAkBgIAImBAJAYCACJgQCQGAgAiYEAkBgIAImBAJAYCACJgQCQGAgAyQO/8HIQnZC86gAAAABJRU5ErkJggg==',
  'base64',
);

/** Mọi lượt tải ảnh thiết bị mở hộp cắt (Q-23 06/10) — bài này nhận khung cắt đề xuất. */
async function acceptCrop(page: Page) {
  const crop = page.getByRole('dialog', { name: 'Cắt ảnh thiết bị' });
  await crop.getByRole('button', { name: 'Dùng ảnh đã cắt' }).click();
  await expect(crop).toBeHidden();
}

/** Cỡ (rộng, cao) trong XML đã lưu của ô máy `deviceId`. */
function savedSize(diagramId: string, deviceId: string): { width: number; height: number } {
  const xml = sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${diagramId}' ORDER BY seq DESC LIMIT 1`);
  // XML lưu khô xếp thuộc tính theo bảng chữ cái (height trước width): đọc từng thuộc tính riêng.
  const geo = new RegExp(`ims_device_id="${deviceId}"[\\s\\S]*?(<mxGeometry[^>]*>)`).exec(xml)?.[1] ?? '';
  const attr = (name: string) => Number(new RegExp(`\\s${name}="([\\d.]+)"`).exec(geo)?.[1]);
  expect(geo, xml.slice(Math.max(0, xml.indexOf(deviceId) - 300), xml.indexOf(deviceId) + 900)).not.toBe('');
  return { width: attr('width'), height: attr('height') };
}

async function device(page: Page, code: string, typeId: string, model: string): Promise<string> {
  const res = await page.request.post('/api/v1/devices', { headers: await writeHeaders(page), data: { code, name: `Máy ${code}`, deviceTypeId: typeId, model } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { device: { id: string } }).device.id;
}

test('máy có ảnh riêng: tải ở trang thiết bị → bản đồ quan hệ + ô chèn dùng ảnh riêng; máy cùng model vẫn ảnh model; bỏ ảnh riêng thì về ảnh model', async ({ page }) => {
  test.setTimeout(180_000);
  const secret = await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const typeId = ((await (await page.request.get('/api/v1/catalog')).json()) as { deviceTypes: { id: string; name: string }[] }).deviceTypes.find((t) => t.name === 'Switch')!.id;
  const model = `E2E-MDL-${stamp}`;
  const a = await device(page, `SW-E2E-HA${stamp}`, typeId, model);
  const b = await device(page, `SW-E2E-HB${stamp}`, typeId, model);
  // Một sợi dây để bản đồ quan hệ có nút (bản đồ trống thì không vẽ hạch).
  const linked = await page.request.post(`/api/v1/devices/${a}/ports/link`, { headers: await writeHeaders(page), data: { portLabel: '1', connectedDeviceId: b, connectedPort: '1', cableTypeId: '' } });
  expect(linked.status(), await linked.text()).toBe(201);

  // SA đặt ảnh model (dùng cho mọi máy cùng loại + model) qua API.
  const modelRow = await page.request.post(`/api/v1/devices/${a}/model`, { headers: await writeHeaders(page) });
  expect(modelRow.status(), await modelRow.text()).toBe(201);
  const modelId = ((await modelRow.json()) as { id: string }).id;
  const up = await page.request.post('/api/v1/files', {
    headers: await writeHeaders(page),
    multipart: { ownerType: 'device_model', ownerId: modelId, file: { name: `model-${stamp}.png`, mimeType: 'image/png', buffer: PNG_MODEL } },
  });
  expect(up.status(), await up.text()).toBe(201);
  const modelFile = ((await up.json()) as { id: string }).id;
  expect((await page.request.patch(`/api/v1/devices/${a}/model-photos`, { headers: await writeHeaders(page), data: { front: modelFile } })).status()).toBe(200);

  // Trang máy A: khu "Hình dùng trên sơ đồ" nói đang dùng ảnh model; tải ảnh riêng mặt trước.
  await page.goto(`/devices/${a}`);
  await expect(page.getByRole('heading', { name: 'Hình dùng trên sơ đồ', exact: true })).toBeVisible();
  const front = page.getByRole('group', { name: 'Mặt trước' });
  await expect(front.getByText(`Ảnh chung của model ${model}`)).toBeVisible();
  await front.getByLabel('Tải ảnh lên — Mặt trước').setInputFiles({ name: `rieng-${stamp}.png`, mimeType: 'image/png', buffer: PNG_OWN });
  await acceptCrop(page);
  await expect(front.getByText('Ảnh riêng của máy này')).toBeVisible();
  const ownFile = sql(`SELECT photo_front_file_id FROM device WHERE id = '${a}'`);
  expect(ownFile).not.toBe('');
  expect(ownFile).not.toBe(modelFile);

  // Bản đồ quan hệ dùng đúng ảnh đó (cùng endpoint ảnh đã thu nhỏ).
  const hubImg = page.getByTestId('rmap-hub').getByRole('img');
  await expect(hubImg).toHaveAttribute('src', `/api/v1/devices/${a}/photo/front?v=${ownFile}`);
  await expect(page.getByTestId('rmap-hub')).not.toContainText('Ảnh chung của model');
  expect(await hubImg.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // Trang máy B (cùng model): vẫn ảnh model.
  await page.goto(`/devices/${b}`);
  await expect(page.getByRole('group', { name: 'Mặt trước' }).getByText(`Ảnh chung của model ${model}`)).toBeVisible();
  await expect(page.getByTestId('rmap-hub').getByRole('img')).toHaveAttribute('src', `/api/v1/devices/${b}/photo/front?v=${modelFile}`);

  // Ô chèn từ "Thiết bị kho" (cùng nguồn tra): A mang ảnh riêng, B mang ảnh model.
  const info = (await (await page.request.get(`/api/v1/diagrams/device-info?ids=${a},${b}`)).json()) as { id: string; cell: { attrs: Record<string, string>; style: string } }[];
  expect(info.find((i) => i.id === a)!.cell.attrs).toEqual({ ims_photo: 'front', ims_photo_file_id: ownFile });
  expect(info.find((i) => i.id === b)!.cell.attrs).toEqual({ ims_photo: 'front', ims_photo_file_id: modelFile });
  expect(info.find((i) => i.id === a)!.cell.style).toContain('shape=image;image=data:image/');

  // Chèn A qua UI vào bản vẽ rồi lưu: ô mang ims_photo="front" (XML lưu khô — không nhúng ảnh).
  const created = await page.request.post('/api/v1/diagrams', { headers: await writeHeaders(page), data: { name: `E2E Ảnh riêng ${stamp}`, nodeType: 'room' } });
  const diagramId = ((await created.json()) as { id: string }).id;
  await stepUpViaApi(page, secret, 'diagram');
  await page.goto(`/diagrams/${diagramId}?mode=edit`);
  const stock = page.getByRole('button', { name: 'Thiết bị kho', exact: true });
  await expect(stock).toBeEnabled({ timeout: 60_000 });
  await stock.click();
  const box = page.getByRole('dialog', { name: 'Chèn thiết bị có trong kho' });
  await box.getByRole('searchbox', { name: 'Tìm thiết bị' }).fill(`SW-E2E-HA${stamp}`);
  await box.getByRole('checkbox', { name: `Chọn SW-E2E-HA${stamp} để chèn` }).check();
  await box.getByRole('button', { name: /^Chèn/ }).click();
  await expect(page.getByText(`Đã chèn SW-E2E-HA${stamp} vào bản vẽ.`)).toBeVisible();
  const [saved] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${diagramId}/versions`) && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Lưu', exact: true }).click(),
  ]);
  expect(saved.status(), await saved.text()).toBe(201);
  const xml = sql(`SELECT xml FROM diagram_version WHERE diagram_id = '${diagramId}' ORDER BY seq DESC LIMIT 1`);
  expect(xml).toContain('ims_photo="front"');
  expect(xml).not.toContain('data:image/png');

  // Bỏ ảnh riêng ở A → về ảnh model.
  await page.goto(`/devices/${a}`);
  await page.getByRole('group', { name: 'Mặt trước' }).getByRole('button', { name: 'Bỏ ảnh riêng — Mặt trước' }).click();
  await expect(page.getByRole('group', { name: 'Mặt trước' }).getByText(`Ảnh chung của model ${model}`)).toBeVisible();
  await expect(page.getByTestId('rmap-hub').getByRole('img')).toHaveAttribute('src', `/api/v1/devices/${a}/photo/front?v=${modelFile}`);
  // Ảnh model có thể trông y hệt ảnh riêng vừa bỏ: hạch nói rõ đây là ảnh chung của model.
  await expect(page.getByTestId('rmap-hub')).toContainText(`Ảnh chung của model ${model}`);
});

test('form Thêm thiết bị: chọn ảnh mặt trước → máy mới mang ảnh riêng (trang thiết bị + bản đồ quan hệ); Thay ảnh; Bỏ ảnh riêng → về biểu tượng, bản đồ hết ảnh', async ({ page }) => {
  test.setTimeout(120_000);
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const code = `SW-E2E-PF${stamp}`;
  const typeId = ((await (await page.request.get('/api/v1/catalog')).json()) as { deviceTypes: { id: string; name: string }[] }).deviceTypes.find((t) => t.name === 'Switch')!.id;

  await page.goto('/devices');
  await devicesPageButton(page, 'Thêm thiết bị').click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Mã thiết bị').fill(code);
  await form.getByLabel('Tên thiết bị').fill('Switch E2E có ảnh');
  await form.getByRole('button', { name: 'Loại' }).click();
  await page.getByRole('option', { name: 'Switch', exact: true }).click();
  const draft = form.getByRole('group', { name: 'Mặt trước' });
  await expect(draft.getByText('Biểu tượng loại Switch').or(draft.getByText(/Chưa chọn ảnh/))).toBeVisible();
  await draft.getByLabel('Tải ảnh lên — Mặt trước').setInputFiles({ name: `form-${stamp}.png`, mimeType: 'image/png', buffer: PNG_OWN });
  await acceptCrop(page);
  await expect(draft.getByText('Ảnh riêng — tải lên khi lưu máy')).toBeVisible();
  await expect(draft.getByRole('img', { name: 'Ảnh Mặt trước đã chọn' })).toBeVisible();
  await form.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByText(`Đã đặt ảnh cho máy ${code}.`)).toBeVisible();

  const id = sql(`SELECT id FROM device WHERE code = '${code}'`);
  const own = sql(`SELECT photo_front_file_id FROM device WHERE id = '${id}'`);
  expect(own).not.toBe('');
  // Một sợi dây để bản đồ quan hệ có hạch.
  const other = await device(page, `SW-E2E-PG${stamp}`, typeId, `E2E-MDL-PG${stamp}`);
  const linked = await page.request.post(`/api/v1/devices/${id}/ports/link`, { headers: await writeHeaders(page), data: { portLabel: '1', connectedDeviceId: other, connectedPort: '1', cableTypeId: '' } });
  expect(linked.status(), await linked.text()).toBe(201);

  await page.goto(`/devices/${id}`);
  const front = page.getByRole('group', { name: 'Mặt trước' });
  await expect(front.getByText('Ảnh riêng của máy này')).toBeVisible();
  await expect(front.getByRole('img', { name: 'Ảnh Mặt trước của máy' })).toHaveAttribute('src', `/api/v1/devices/${id}/photo/front?v=${own}`);
  const hubImg = page.getByTestId('rmap-hub').getByRole('img');
  await expect(hubImg).toHaveAttribute('src', `/api/v1/devices/${id}/photo/front?v=${own}`);

  // Thay ảnh: ô và bản đồ cùng đổi sang tệp mới, không cần tải lại trang.
  await front.getByLabel('Thay ảnh — Mặt trước').setInputFiles({ name: `thay-${stamp}.png`, mimeType: 'image/png', buffer: PNG_MODEL });
  await acceptCrop(page);
  await expect.poll(() => sql(`SELECT photo_front_file_id FROM device WHERE id = '${id}'`)).not.toBe(own);
  const replaced = sql(`SELECT photo_front_file_id FROM device WHERE id = '${id}'`);
  await expect(hubImg).toHaveAttribute('src', `/api/v1/devices/${id}/photo/front?v=${replaced}`);
  expect(await hubImg.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // Bỏ ảnh riêng, máy không có ảnh model → về biểu tượng; bản đồ quan hệ HẾT ảnh ngay (không tải lại trang).
  await front.getByRole('button', { name: 'Bỏ ảnh riêng — Mặt trước' }).click();
  await expect(front.getByText('Biểu tượng loại Switch')).toBeVisible();
  await expect(page.getByTestId('rmap-hub').getByRole('img')).toHaveCount(0);
  expect(sql(`SELECT coalesce(photo_front_file_id::text, '') FROM device WHERE id = '${id}'`)).toBe('');
  // Ảnh cũ không còn được phục vụ cho mặt này (server không rơi về giấy tờ còn nằm đó).
  expect((await page.request.get(`/api/v1/devices/${id}/photo/front?v=${replaced}`)).status()).toBe(404);
});

test('ảnh ngang 1U: ô chèn từ "Thiết bị kho" mang tỉ lệ ảnh (không ô vuông trống trên dưới); đổi về Biểu tượng rồi lại Ảnh thì ô ôm lại theo hình', async ({ page }) => {
  test.setTimeout(240_000);
  const secret = await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const typeId = ((await (await page.request.get('/api/v1/catalog')).json()) as { deviceTypes: { id: string; name: string }[] }).deviceTypes.find((t) => t.name === 'Switch')!.id;
  const code = `SW-E2E-HW${stamp}`;
  const id = await device(page, code, typeId, `E2E-MDL-HW${stamp}`);
  const up = await page.request.post('/api/v1/files', {
    headers: await writeHeaders(page),
    multipart: { ownerType: 'device', ownerId: id, file: { name: `ngang-${stamp}.png`, mimeType: 'image/png', buffer: PNG_WIDE } },
  });
  expect(up.status(), await up.text()).toBe(201);
  const fileId = ((await up.json()) as { id: string }).id;
  expect((await page.request.patch(`/api/v1/devices/${id}/photos`, { headers: await writeHeaders(page), data: { front: fileId } })).status()).toBe(200);
  const look = ((await (await page.request.get(`/api/v1/diagrams/device-looks?ids=${id}`)).json()) as { items: { iconAspect: number; front: { aspect: number } }[] }).items[0];
  expect(look.front.aspect).toBeCloseTo(0.25, 3);

  const created = await page.request.post('/api/v1/diagrams', { headers: await writeHeaders(page), data: { name: `E2E Ảnh ngang ${stamp}`, nodeType: 'room' } });
  const diagramId = ((await created.json()) as { id: string }).id;
  await stepUpViaApi(page, secret, 'diagram');
  await page.goto(`/diagrams/${diagramId}?mode=edit`);
  const stock = page.getByRole('button', { name: 'Thiết bị kho', exact: true });
  await expect(stock).toBeEnabled({ timeout: 60_000 });
  await stock.click();
  const box = page.getByRole('dialog', { name: 'Chèn thiết bị có trong kho' });
  await box.getByRole('searchbox', { name: 'Tìm thiết bị' }).fill(code);
  await box.getByRole('checkbox', { name: `Chọn ${code} để chèn` }).check();
  await box.getByRole('button', { name: /^Chèn/ }).click();
  await expect(page.getByText(`Đã chèn ${code} vào bản vẽ.`)).toBeVisible();

  const save = async () => {
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/v1/diagrams/${diagramId}/versions`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Lưu', exact: true }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
  };
  await save();
  const inserted = savedSize(diagramId, id);
  // Rộng như biểu tượng hôm nay, cao = rộng × 100/400.
  expect(inserted.width).toBe(60);
  expect(inserted.height).toBe(15);

  // Công tắc Biểu tượng / Ảnh thật: về biểu tượng → cao theo tỉ lệ biểu tượng; lại ảnh → ôm ảnh.
  const pick = async (choice: RegExp) => {
    await diagramBarAction(page, 'Ảnh thật…');
    const dialog = page.getByRole('dialog', { name: 'Biểu tượng / Ảnh thật' });
    await dialog.getByRole('radiogroup', { name: `Hình của ${code}` }).getByRole('radio', { name: choice }).check();
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  };
  await pick(/Biểu tượng/);
  await save();
  expect(savedSize(diagramId, id)).toEqual({ width: 60, height: Math.round(60 * look.iconAspect) });
  await pick(/Ảnh mặt trước/);
  await save();
  const back = savedSize(diagramId, id);
  expect(back.height / back.width).toBeCloseTo(0.25, 2);
});
