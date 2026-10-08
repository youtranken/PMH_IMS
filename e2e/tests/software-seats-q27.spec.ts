import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  resetDevices,
  resetSoftware,
  resetUsers,
  rowAction,
  searchAndWaitForFilter,
  uniqueStamp,
} from './helpers';

/**
 * Q-27 — ghế riêng và đợt mua của license, đi bằng giao diện thật.
 *
 * Đường hạnh phúc: khai license 3 ghế, tick "mỗi ghế có hợp đồng, giấy tờ và ghi chú riêng",
 * điền hợp đồng từng ghế, "Lưu rồi gán vào máy" → hộp Gán mở sẵn, máy vào Ghế 1 → tab Máy đang
 * dùng ghi "Ghế 1", hai ghế còn trống kể ra. "Mua thêm đợt mới" điền sẵn theo đợt trước và gợi ý
 * mã kế tiếp.
 *
 * Đường hỏng: một ghế thì không tick được; bớt ghế đang có máy bị API chặn.
 */

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetDevices();
});

async function headers(page: Page) {
  const csrf = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
  return { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN };
}

async function createDevice(page: Page, code: string): Promise<string> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: await headers(page),
    data: { code, name: `Máy ${code}`, deviceTypeId: pc.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

test.describe('Ghế riêng và đợt mua (Q-27)', () => {
  test('khai 3 ghế riêng → Lưu rồi gán vào máy → máy vào Ghế 1, còn 2 ghế trống', async ({ page }) => {
    test.setTimeout(120_000);
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-GHE-${stamp}`;
    const deviceCode = `PC-E2E-GHE-${stamp}`;
    await createDevice(page, deviceCode);

    await page.goto('/software');
    await page.getByRole('button', { name: 'Thêm phần mềm' }).first().click();
    const form = page.getByRole('dialog', { name: 'Thêm phần mềm' });
    await form.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }).fill('Windows Server 2025 E2E');
    await form.getByRole('textbox', { name: 'Mã hồ sơ', exact: true }).fill(code);
    await form.getByRole('radio', { name: 'Vĩnh viễn' }).check();

    const tick = form.getByRole('checkbox', { name: /^Mỗi ghế có hợp đồng, giấy tờ và ghi chú riêng/ });
    await form.getByRole('textbox', { name: 'Số ghế', exact: true }).fill('1');
    await expect(tick, 'một ghế thì "riêng" với "chung" là một — ô tick phải khoá').toBeDisabled();
    await form.getByRole('textbox', { name: 'Số ghế', exact: true }).fill('3');
    await tick.check();
    await expect(form.getByRole('textbox', { name: 'Số hợp đồng / PO', exact: true }), 'tick rồi thì không còn hợp đồng chung').toHaveCount(0);
    await form.getByRole('textbox', { name: 'Số hợp đồng ghế 1' }).fill(`PO-${stamp}-A`);
    await form.getByRole('textbox', { name: 'Số hợp đồng ghế 2' }).fill(`PO-${stamp}-B`);
    await form.getByRole('textbox', { name: 'Ghi chú ghế 1' }).fill('key dán thân máy');
    await form.getByRole('button', { name: 'Lưu rồi gán vào máy' }).click();

    // Sang hồ sơ vừa tạo, hộp Gán mở sẵn ở tab Máy đang dùng.
    const assign = page.getByRole('dialog', { name: `Gán license vào máy — ${code}` });
    await expect(assign).toBeVisible();
    await assign.getByRole('combobox').fill(deviceCode);
    await page.getByRole('option', { name: new RegExp(deviceCode) }).click();
    const plan = assign.getByRole('group', { name: 'Máy vào ghế nào' });
    await expect(plan.getByRole('button', { name: `Ghế cho máy ${deviceCode}` })).toContainText(`Ghế 1 · PO-${stamp}-A`);
    await assign.getByTestId('dialog-footer').getByRole('button', { name: 'Gán vào máy' }).click();
    await expect(assign).toHaveCount(0);

    const seatRow = page.getByRole('row', { name: new RegExp(deviceCode) });
    await expect(seatRow).toContainText('Ghế 1');
    const free = page.getByRole('region', { name: 'Ghế còn trống' });
    await expect(free.getByRole('row', { name: /Ghế 2/ })).toContainText(`PO-${stamp}-B`);
    await expect(free.getByRole('row', { name: /Ghế 3/ })).toBeVisible();
    await expect(page.getByText('Riêng từng ghế (3)')).toBeVisible();
  });

  test('đường hỏng: bớt ghế đang có máy (vẫn bật ghế riêng) bị chặn, hồ sơ không đổi', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const h = await headers(page);
    const created = await page.request.post('/api/v1/software', {
      headers: h,
      data: { code: `LIC-E2E-BOT-${stamp}`, name: 'X', kind: 'license', licenseModel: 'perpetual', seatTotal: 3, perSeat: true },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const detail = await (await page.request.get(`/api/v1/software/${id}`)).json();
    const seat3 = detail.seats.find((seat: { seatNo: number }) => seat.seatNo === 3).id;
    const deviceId = await createDevice(page, `PC-E2E-BOT-${stamp}`);
    expect(
      (await page.request.post(`/api/v1/software/${id}/assignments`, { headers: h, data: { deviceId, seatId: seat3 } })).status(),
    ).toBe(201);

    const cut = await page.request.patch(`/api/v1/software/${id}`, { headers: h, data: { seatTotal: 2 } });
    expect(cut.status()).toBe(409);
    expect((await cut.json()).code).toBe('SOFTWARE_SEATS_IN_USE');
    expect((await (await page.request.get(`/api/v1/software/${id}`)).json()).seatTotal).toBe(3);
  });

  test('Mua thêm đợt mới: điền sẵn theo đợt trước, gợi ý mã kế tiếp, hai đợt nối nhau ở trang hồ sơ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const first = `LIC-E2E-DOT-${stamp}-01`;
    const name = `Office E2E ${stamp}`;
    const created = await page.request.post('/api/v1/software', {
      headers: await headers(page),
      data: { code: first, name, kind: 'license', licenseModel: 'perpetual', seatTotal: 2 },
    });
    expect(created.status()).toBe(201);

    await page.goto('/software');
    await searchAndWaitForFilter(page, first);
    await rowAction(page, first, 'Mua thêm đợt mới…');
    const form = page.getByRole('dialog', { name: `Mua thêm đợt mới — ${name}` });
    await expect(form.getByRole('textbox', { name: 'Tên hồ sơ', exact: true })).toHaveValue(name);
    await expect(form.getByRole('radio', { name: 'Vĩnh viễn' })).toBeChecked();
    await form.getByRole('button', { name: `Dùng mã LIC-E2E-DOT-${stamp}-02` }).click();
    await form.getByRole('textbox', { name: 'Số ghế', exact: true }).fill('3');
    await form.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(form).toHaveCount(0);

    await page.goto('/software');
    await searchAndWaitForFilter(page, `LIC-E2E-DOT-${stamp}-02`);
    await page.getByRole('link', { name: `LIC-E2E-DOT-${stamp}-02` }).click();
    const batches = page.getByRole('region', { name: 'Mua theo đợt' });
    await expect(batches.getByRole('link', { name: first })).toBeVisible();
  });
});
