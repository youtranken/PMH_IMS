import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetCatalog, resetDevices, resetDiagrams, resetUsers, sql, stepUpViaApi, uniqueStamp, writeHeaders } from './helpers';

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
  await front.getByLabel('Tải ảnh riêng — Mặt trước').setInputFiles({ name: `rieng-${stamp}.png`, mimeType: 'image/png', buffer: PNG_OWN });
  await expect(front.getByText('Ảnh riêng của máy này')).toBeVisible();
  const ownFile = sql(`SELECT photo_front_file_id FROM device WHERE id = '${a}'`);
  expect(ownFile).not.toBe('');
  expect(ownFile).not.toBe(modelFile);

  // Bản đồ quan hệ dùng đúng ảnh đó (cùng endpoint ảnh đã thu nhỏ).
  const hubImg = page.getByTestId('rmap-hub').getByRole('img');
  await expect(hubImg).toHaveAttribute('src', `/api/v1/devices/${a}/photo/front?v=${ownFile}`);
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
});
