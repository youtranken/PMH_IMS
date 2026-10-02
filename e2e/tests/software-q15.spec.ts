import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  isoInDays,
  resetDevices,
  resetSoftware,
  resetUsers,
  sql,
  searchAndWaitForFilter,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Q-15 · phần mềm: hợp đồng + chi phí của từng lượt gia hạn vào sổ gia hạn (SW-049), và hộp gán
 * license chọn nhanh cả lô máy theo phòng ban / người sử dụng (SW-053). Mọi hàng tạo ra mang
 * chữ E2E để `reset-e2e.mjs` dọn được.
 */

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetDevices();
});

async function createSoftware(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/v1/software', {
    headers: await writeHeaders(page),
    data,
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function renewWithTerms(page: Page, code: string) {
  const dialog = page.getByRole('dialog', { name: `Gia hạn ${code}` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '+1 năm', exact: true }).click();
  return dialog;
}

test.describe('SW-049 · Gia hạn ghi hợp đồng + chi phí vào sổ gia hạn', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('ghi số hợp đồng + chi phí, sổ gia hạn trong tab Lịch sử hiện hai cột đó', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-GHHD-${stamp}`;
    const contract = `HD-E2E-${stamp}`;
    const id = await createSoftware(page, {
      code,
      name: 'License gia hạn có hợp đồng',
      kind: 'license',
      seatTotal: 5,
      endDate: isoInDays(60),
    });

    await page.goto(`/software/${id}`);
    await page.getByRole('button', { name: 'Gia hạn', exact: true }).first().click();
    const dialog = await renewWithTerms(page, code);
    await dialog.getByRole('textbox', { name: 'Số hợp đồng', exact: true }).fill(contract);
    await dialog.getByRole('textbox', { name: 'Chi phí kỳ mới', exact: true }).fill('12,5tr');
    const renewed = page.waitForResponse((r) => r.url().endsWith('/renew'));
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
    expect((await renewed).status()).toBeLessThan(300);
    await expect(page.getByText(new RegExp(`^Đã gia hạn ${code} tới`))).toBeVisible();

    // Sổ là nguồn sự thật cho quyết toán — kiểm cả dữ liệu, không chỉ chữ trên màn.
    expect(
      sql(`SELECT contract || '|' || cost FROM renewal_history WHERE object_id = '${id}'`),
    ).toBe(`${contract}|12500000`);

    await page.getByRole('tab', { name: /^Lịch sử/ }).click();
    await page.getByRole('button', { name: 'Hạn', exact: true }).click();
    const ledger = page.getByRole('region', { name: 'Sổ gia hạn' });
    await expect(ledger.getByRole('cell', { name: contract })).toBeVisible();
    await expect(ledger.getByRole('cell', { name: /12\.500\.000\s₫/ })).toBeVisible();
  });

  test('chi phí gõ sai → báo ngay dưới ô, không gia hạn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-GHSAI-${stamp}`;
    const id = await createSoftware(page, {
      code,
      name: 'License gia hạn sai chi phí',
      kind: 'license',
      seatTotal: 5,
      endDate: isoInDays(60),
    });

    await page.goto(`/software/${id}`);
    await page.getByRole('button', { name: 'Gia hạn', exact: true }).first().click();
    const dialog = await renewWithTerms(page, code);
    const cost = dialog.getByRole('textbox', { name: 'Chi phí kỳ mới', exact: true });
    await cost.fill('mười triệu');
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
    await expect(cost).toHaveAccessibleDescription(/Chi phí chưa đọc được/);
    await expect(dialog).toBeVisible();
    expect(sql(`SELECT count(*) FROM renewal_history WHERE object_id = '${id}'`)).toBe('0');
  });

  test('390px: sổ gia hạn đọc được trên điện thoại', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-GH390-${stamp}`;
    const contract = `HD-E2E-390-${stamp}`;
    const id = await createSoftware(page, {
      code,
      name: 'License sổ gia hạn 390',
      kind: 'license',
      seatTotal: 5,
      endDate: isoInDays(60),
    });
    const res = await page.request.post(`/api/v1/software/${id}/renew`, {
      headers: await writeHeaders(page),
      data: { endDate: isoInDays(425), contract, cost: 3_000_000 },
    });
    expect(res.status()).toBe(201);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/software/${id}?tab=history`);
    await page.getByRole('button', { name: 'Hạn', exact: true }).click();
    const ledger = page.getByRole('region', { name: 'Sổ gia hạn' });
    await expect(ledger.getByText(new RegExp(`${contract} · 3\\.000\\.000\\s₫`))).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'không cuộn ngang ở 390px').toBeLessThanOrEqual(0);
  });
});

async function pcTypeId(page: Page): Promise<string> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  return catalog.deviceTypes.find((type) => type.name === 'PC')!.id;
}

async function createDevice(
  page: Page,
  code: string,
  extra: { department?: string; assignedTo?: string; status?: string } = {},
): Promise<string> {
  const res = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { code, name: 'Máy trạm E2E', deviceTypeId: await pcTypeId(page), ...extra },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { device: { id: string } }).device.id;
}

test.describe('SW-053 · Gán license chọn nhanh theo phòng ban / người sử dụng', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('chọn một phòng ban → thêm sẵn máy đang dùng của phòng, bỏ máy đã có license; vượt ghế thì hỏi lý do', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const dept = `Phòng E2E ${stamp}`;
    const code = `LIC-E2E-CHONPB-${stamp}`;
    const id = await createSoftware(page, {
      code,
      name: 'License chọn theo phòng',
      kind: 'license',
      seatTotal: 2,
      endDate: isoInDays(200),
    });
    const held = await createDevice(page, `PC-E2E-PB-A-${stamp}`, { department: dept, status: 'in_use' });
    const b = `PC-E2E-PB-B-${stamp}`;
    const c = `PC-E2E-PB-C-${stamp}`;
    await createDevice(page, b, { department: dept, status: 'in_use' });
    await createDevice(page, c, { department: dept, status: 'in_use' });
    // Máy dự phòng của phòng và máy phòng khác có tên gần giống: không được kéo theo.
    await createDevice(page, `PC-E2E-PB-D-${stamp}`, { department: dept, status: 'spare' });
    await createDevice(page, `PC-E2E-PB-E-${stamp}`, {
      department: `${dept} tổng hợp`,
      status: 'in_use',
    });
    const seat = await page.request.post(`/api/v1/software/${id}/assignments`, {
      headers: await writeHeaders(page),
      data: { deviceId: held },
    });
    expect(seat.status()).toBe(201);

    await page.goto(`/software/${id}?tab=devices`);
    await page.getByRole('button', { name: 'Gán vào máy' }).first().click();
    const dialog = page.getByRole('dialog', { name: `Gán license vào máy — ${code}` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: 'Phòng ban', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Tên phòng ban' }).fill(dept);
    await dialog.getByRole('button', { name: 'Thêm các máy' }).click();

    await expect(dialog.getByRole('status').filter({ hasText: 'Đã thêm 2 máy' })).toContainText(
      '1 máy đã có license này, bỏ qua.',
    );
    const chips = dialog.getByRole('list', { name: 'Máy sẽ gán' });
    await expect(chips.getByRole('listitem')).toHaveCount(2);
    await expect(chips).toContainText(b);
    await expect(chips).toContainText(c);

    // 1 ghế đã dùng + 2 máy mới > 2 ghế → hỏi lý do ngay, như gán tay.
    const reason = dialog.getByRole('textbox', { name: 'Lý do vượt số ghế', exact: true });
    await expect(reason).toBeVisible();
    // Bỏ một máy → hết vượt ghế, gán bình thường.
    await dialog.getByRole('button', { name: `Bỏ ${c} khỏi lô` }).click();
    await expect(reason).toHaveCount(0);
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gán vào máy' }).click();
    await expect(page.getByText('Đã gán license vào 1 máy.')).toBeVisible();
    expect(
      sql(
        `SELECT count(*) FROM license_assignment WHERE software_id = '${id}' AND released_at IS NULL`,
      ),
    ).toBe('2');
  });

  test('người sử dụng không có máy đang dùng nào → nói rõ, không thêm máy nào', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-CHONNG-${stamp}`;
    const id = await createSoftware(page, {
      code,
      name: 'License chọn theo người',
      kind: 'license',
      seatTotal: 5,
      endDate: isoInDays(200),
    });

    await page.goto(`/software/${id}?tab=devices`);
    await page.getByRole('button', { name: 'Gán vào máy' }).first().click();
    const dialog = page.getByRole('dialog', { name: `Gán license vào máy — ${code}` });
    await dialog.getByRole('radio', { name: 'Người sử dụng', exact: true }).click();
    const who = `Người E2E ${stamp}`;
    await dialog.getByRole('combobox', { name: 'Tên người sử dụng' }).fill(who);
    await dialog.getByRole('button', { name: 'Thêm các máy' }).click();
    await expect(dialog.getByRole('status')).toHaveText(`Không có máy đang dùng nào của ${who}.`);
    await expect(dialog.getByRole('list', { name: 'Máy sẽ gán' })).toHaveCount(0);
  });
});

test.describe('SW-043 · Tên miền dùng chứng chỉ SSL, theo từng kỳ gia hạn (Q-22)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('hồ sơ SSL hiện website, tìm được từ danh sách; gia hạn chụp danh sách của kỳ mới vào sổ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SSL-E2E-WEB-${stamp}`;
    const shop = `shop-e2e-${stamp}.pmh.vn`;
    const mail = `mail-e2e-${stamp}.pmh.vn`;
    const portal = `portal-e2e-${stamp}.pmh.vn`;
    const id = await createSoftware(page, {
      code,
      name: 'Chứng chỉ E2E',
      kind: 'ssl',
      endDate: isoInDays(40),
      websites: [`https://${shop}/`, mail],
    });

    // Ô tìm của màn Tên miền & SSL ra hồ sơ theo BẤT KỲ tên miền nào trong hồ sơ (Q-22).
    await page.goto('/domains');
    await searchAndWaitForFilter(page, `mail-e2e-${stamp}`);
    await expect(page.getByRole('link', { name: code })).toBeVisible();

    await page.goto(`/domains/${id}`);
    const sites = page.getByRole('region', { name: 'Tên miền', exact: true });
    await expect(sites.getByText(shop, { exact: true })).toBeVisible();
    await expect(sites.getByText(mail, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Gia hạn', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: `Gia hạn ${code}` });
    const box = dialog.getByRole('textbox', { name: 'Tên miền của kỳ mới', exact: true });
    await expect(box).toHaveValue(`${shop}\n${mail}`);
    // Năm nay bỏ mail, thêm portal.
    await box.fill(`${shop}\n${portal}`);
    await dialog.getByRole('button', { name: '+1 năm', exact: true }).click();
    const renewed = page.waitForResponse((r) => r.url().endsWith('/renew'));
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
    expect((await renewed).status()).toBeLessThan(300);

    expect(
      sql(`SELECT array_to_string(websites, ',') FROM renewal_history WHERE object_id = '${id}'`),
    ).toBe(`${shop},${portal}`);
    expect(sql(`SELECT array_to_string(websites, ',') FROM software WHERE id = '${id}'`)).toBe(
      `${shop},${portal}`,
    );

    await page.getByRole('tab', { name: /^Lịch sử/ }).click();
    await page.getByRole('button', { name: 'Hạn', exact: true }).click();
    const ledger = page.getByRole('region', { name: 'Sổ gia hạn' });
    await expect(ledger.getByRole('cell', { name: `${shop}, ${portal}` })).toBeVisible();
  });

  test('dán hai website chung một dòng → báo lỗi, không gia hạn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SSL-E2E-WEBSAI-${stamp}`;
    const id = await createSoftware(page, {
      code,
      name: 'Chứng chỉ E2E sai',
      kind: 'ssl',
      endDate: isoInDays(40),
    });

    await page.goto(`/domains/${id}`);
    await expect(page.getByText('Chưa ghi tên miền nào.')).toBeVisible();
    await page.getByRole('button', { name: 'Gia hạn', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: `Gia hạn ${code}` });
    await dialog
      .getByRole('textbox', { name: 'Tên miền của kỳ mới', exact: true })
      .fill('a-e2e.pmh.vn b-e2e.pmh.vn');
    await dialog.getByRole('button', { name: '+1 năm', exact: true }).click();
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
    await expect(dialog.getByRole('alert')).toContainText('có khoảng trắng');
    expect(sql(`SELECT count(*) FROM renewal_history WHERE object_id = '${id}'`)).toBe('0');
  });
});
