import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  confirmAction,
  E2E_SA,
  firstLogin,
  resetDevices,
  resetSoftware,
  resetUsers,
  rowAction,
  timVaChoLoc,
  rowActionNames,
  uniqueStamp,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetDevices();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function createDevice(page: Page, code: string): Promise<string> {
  const csrf = await csrfOf(page);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data: { code, name: `Máy ${code}`, deviceTypeId: pc.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

async function createLicense(page: Page, code: string, seats: number | null): Promise<string> {
  const csrf = await csrfOf(page);
  const created = await page.request.post('/api/v1/software', {
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data: {
      code,
      name: `License ${code}`,
      kind: 'license',
      seatTotal: seats,
      endDate: '2028-12-31',
    },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

async function assign(
  page: Page,
  softwareId: string,
  deviceId: string,
  overSeatReason?: string,
  terms: Record<string, unknown> = {},
) {
  const csrf = await csrfOf(page);
  return page.request.post(`/api/v1/software/${softwareId}/assignments`, {
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data: { deviceId, overSeatReason: overSeatReason ?? '', ...terms },
  });
}

/**
 * Tìm một license trên danh sách và CHỜ BẢNG LỌC XONG rồi mới trả dòng về.
 *
 * ===== VÌ SAO PHẢI CHỜ (17/09/2026, đỏ thật một lượt ngày 18/09) =====
 *
 * Ô tìm có debounce 250ms từ khi trạng thái danh sách chuyển lên thanh địa chỉ. Dòng cần tìm
 * hiện ra ngay TỪ TRƯỚC khi lọc — nó vốn đã nằm trong bảng — nên `toBeVisible()` xanh sớm,
 * rồi thao tác tiếp theo rơi vào đúng khoảnh khắc trước lượt vẽ lại: bung được dòng, nhưng
 * 250ms sau bảng vẽ lại và khu vừa bung đóng sập.
 *
 * Hai dòng = đúng một cái header + đúng một kết quả. Đó mới là "đã lọc xong".
 *
 * ===== VÌ SAO TÁCH RA KHỎI `expandLicense` =====
 *
 * Bản trước chôn phép chờ này bên trong `expandLicense`, nên bài nào cần khẳng định một điều
 * gì đó TRƯỚC khi bung (ví dụ "chưa bung thì mã máy chưa có mặt") không dùng lại được và đã
 * chép tay phần `goto + fill + toBeVisible` — thiếu đúng dòng chờ. Lượt E2E đầy đủ 18/09 đỏ
 * ở đúng chỗ đó. Tách ra thì cả hai đường đều đi qua một phép chờ duy nhất.
 */
async function timLicense(page: Page, licenseCode: string) {
  await page.goto('/software');
  await page.getByRole('searchbox', { name: /Tìm/ }).fill(licenseCode);
  const row = page.getByRole('row', { name: new RegExp(licenseCode) });
  await expect(row).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(2);
  return row;
}

/** Bung dòng license đang hiện trên danh sách và trả về khu vừa mở. */
async function expandLicense(page: Page, licenseCode: string) {
  const row = await timLicense(page, licenseCode);
  await row.getByRole('button').first().click();
  return row;
}

test.describe('Gán license theo seat', () => {
  test('đường hạnh phúc: gán → seat tăng → gỡ → bản ghi vẫn còn trong lịch sử', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const licenseId = await createLicense(page, `LIC-E2E-SEAT-${stamp}`, 2);
    const deviceId = await createDevice(page, `PC-E2E-L1-${stamp}`);

    expect((await assign(page, licenseId, deviceId)).status()).toBe(201);

    await page.goto(`/software/${licenseId}`);
    await expect(page.getByText('1/2').first()).toBeVisible();

    await page.getByRole('tab', { name: 'Máy đang dùng' }).click();
    const row = page.getByRole('row', { name: new RegExp(`PC-E2E-L1-${stamp}`) });
    await expect(row).toBeVisible();
    await expect(page.getByRole('button', { name: /^Đang dùng 1$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    /* "Gỡ" nay nằm trong menu ba chấm, không còn đứng cạnh "Sửa" (rà UI/UX #21). */
    await row.getByRole('button', { name: /^Thao tác với / }).click();
    await page.getByRole('menuitem', { name: 'Gỡ' }).click();
    await confirmAction(page);
    await expect(page.getByText('Chưa gán license này vào máy nào.')).toBeVisible();

    // Gỡ KHÔNG xóa dòng: chọn "Đã gỡ" là thấy lại, kèm mốc thời gian.
    await page.getByRole('button', { name: /^Đã gỡ \d+$/ }).click();
    const released = page.getByRole('row', { name: new RegExp(`PC-E2E-L1-${stamp}`) });
    await expect(released).toBeVisible();
    await expect(released.getByText(/Đã gỡ/)).toBeVisible();
  });

  test('vượt seat: chặn lần đầu, cho ghi đè khi có lý do', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const licenseId = await createLicense(page, `LIC-E2E-OVER-${stamp}`, 1);
    const first = await createDevice(page, `PC-E2E-O1-${stamp}`);
    const second = await createDevice(page, `PC-E2E-O2-${stamp}`);

    expect((await assign(page, licenseId, first)).status()).toBe(201);

    // Máy thứ hai vượt seat → 400 kèm lời nhắc phải ghi lý do.
    const blocked = await assign(page, licenseId, second);
    expect(blocked.status()).toBe(400);
    expect(await blocked.json()).toMatchObject({ code: 'SEAT_LIMIT_REACHED' });

    // Có lý do thì vẫn gán được, và kết quả kèm cảnh báo.
    const forced = await assign(page, licenseId, second, 'Sếp duyệt mua thêm seat tuần sau');
    expect(forced.status()).toBe(201);
    expect(String((await forced.json()).warnings)).toContain('vượt seat');

    await page.goto(`/software/${licenseId}`);
    await page.getByRole('tab', { name: 'Máy đang dùng' }).click();
    await expect(page.getByText('Sếp duyệt mua thêm seat tuần sau')).toBeVisible();
  });

  test('cùng license gán trùng một máy bị chặn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const licenseId = await createLicense(page, `LIC-E2E-DUP-${stamp}`, 5);
    const deviceId = await createDevice(page, `PC-E2E-D1-${stamp}`);

    expect((await assign(page, licenseId, deviceId)).status()).toBe(201);
    const again = await assign(page, licenseId, deviceId);
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'ALREADY_ASSIGNED' });
  });

  /** BE-09: sửa hồ sơ không được bỏ rơi ghế đang gán; hồ sơ đã thanh lý không nhận ghế mới. */
  test('sửa hồ sơ bỏ rơi ghế bị chặn; thanh lý tự gỡ ghế; hồ sơ đã thanh lý không nhận ghế', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const licenseId = await createLicense(page, `LIC-E2E-GUARD-${stamp}`, 5);
    const first = await createDevice(page, `PC-E2E-G1-${stamp}`);
    const second = await createDevice(page, `PC-E2E-G2-${stamp}`);
    expect((await assign(page, licenseId, first)).status()).toBe(201);
    expect((await assign(page, licenseId, second)).status()).toBe(201);

    const patch = async (id: string, data: Record<string, unknown>) =>
      page.request.patch(`/api/v1/software/${id}`, {
        headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
        data,
      });
    const shrink = await patch(licenseId, { seatTotal: 1 });
    expect(shrink.status()).toBe(409);
    expect(await shrink.json()).toMatchObject({ code: 'SOFTWARE_SEATS_IN_USE' });

    // Thanh lý khi còn ghế: hệ thống tự gỡ cả hai ghế (QUYET-DINH Q-03), không chặn.
    expect((await patch(licenseId, { status: 'retired' })).status()).toBe(200);
    const seatsLeft = await page.request.get(`/api/v1/software/${licenseId}/assignments`);
    expect(seatsLeft.status()).toBe(200);
    expect(await seatsLeft.json(), 'mọi ghế phải được gỡ khi thanh lý').toHaveLength(0);

    const retiredId = await createLicense(page, `LIC-E2E-RETIRED-${stamp}`, 5);
    expect((await patch(retiredId, { status: 'retired' })).status()).toBe(200);
    const blocked = await assign(page, retiredId, first);
    expect(blocked.status()).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: 'SOFTWARE_RETIRED' });

    // BE-13: gia hạn gọi thẳng API không được hồi sinh hồ sơ đã thanh lý.
    const renewed = await page.request.post(`/api/v1/software/${retiredId}/renew`, {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: { endDate: '2030-12-31' },
    });
    expect(renewed.status()).toBe(409);
    expect(await renewed.json()).toMatchObject({ code: 'SOFTWARE_RETIRED' });
  });

  test('gỡ rồi gán lại cùng máy là hợp lệ (máy cài lại)', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const licenseId = await createLicense(page, `LIC-E2E-RE-${stamp}`, 5);
    const deviceId = await createDevice(page, `PC-E2E-R1-${stamp}`);
    const csrf = await csrfOf(page);

    const created = await assign(page, licenseId, deviceId);
    const assignmentId = ((await created.json()) as { assignment: { id: string } }).assignment.id;

    const released = await page.request.delete(
      `/api/v1/software/${licenseId}/assignments/${assignmentId}`,
      { headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN } },
    );
    expect(released.status()).toBe(200);

    expect((await assign(page, licenseId, deviceId)).status()).toBe(201);
  });

  test('loại không phải license thì không gán được, và không có tab Máy đang dùng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const csrf = await csrfOf(page);
    const ssl = await page.request.post('/api/v1/software', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { code: `SSL-E2E-NA-${stamp}`, name: 'SSL', kind: 'ssl', endDate: '2027-01-01' },
    });
    const sslId = ((await ssl.json()) as { id: string }).id;
    const deviceId = await createDevice(page, `PC-E2E-NA-${stamp}`);

    const result = await assign(page, sslId, deviceId);
    expect(result.status()).toBe(400);
    expect(await result.json()).toMatchObject({ code: 'NOT_A_LICENSE' });

    await page.goto(`/software/${sslId}`);
    await expect(page.getByRole('tab', { name: 'Máy đang dùng' })).toHaveCount(0);
  });

  test('trang thiết bị hiện khu "License đang cài" — đúng cơ chế khu mở rộng 2.5', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const licenseId = await createLicense(page, `LIC-E2E-PANEL-${stamp}`, 5);
    const deviceId = await createDevice(page, `PC-E2E-P1-${stamp}`);

    // Chưa gán: khu mở rộng phải RỖNG, không có khối trống treo lơ lửng.
    await page.goto(`/devices/${deviceId}`);
    await expect(page.getByRole('heading', { name: 'License đang cài' })).toHaveCount(0);

    expect((await assign(page, licenseId, deviceId)).status()).toBe(201);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'License đang cài' })).toBeVisible();
    await expect(page.getByRole('link', { name: `LIC-E2E-PANEL-${stamp}` })).toBeVisible();
  });

  /**
   * AC 3.2: "màn license hiển thị danh sách máy đang dùng key" — trên DANH SÁCH, không bắt
   * bấm vào từng license. Đây là nếp bung dòng của code nền QLTS (AD-12) mà bản dựng đầu
   * đánh rơi: hạ tầng `renderExpanded` đã port sang nhưng không màn nào nối dây.
   */
  test('bung dòng license trên danh sách là thấy máy đang dùng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const licenseId = await createLicense(page, `LIC-E2E-EXP-${stamp}`, 3);
    const deviceCode = `PC-E2E-EXP-${stamp}`;
    const deviceId = await createDevice(page, deviceCode);
    expect((await assign(page, licenseId, deviceId)).status()).toBe(201);

    // `timLicense` chờ bảng LỌC XONG rồi mới trả dòng — xem chú thích của nó. Chép tay ba
    // dòng `goto + fill + toBeVisible` ở đây là thiếu đúng phép chờ ấy, và lượt E2E đầy đủ
    // ngày 18/09 đã đỏ ở đúng chỗ này.
    const row = await timLicense(page, `LIC-E2E-EXP-${stamp}`);

    // Chưa bung thì mã máy CHƯA có mặt trên màn.
    await expect(page.getByRole('link', { name: deviceCode })).toHaveCount(0);

    await row.getByRole('button').first().click();
    await expect(page.getByRole('link', { name: deviceCode })).toBeVisible();

    // Gán thêm máy NGAY TẠI ĐÂY — không bắt vào trang chi tiết mới gán được.
    await expect(page.getByRole('button', { name: 'Gán vào máy' })).toBeVisible();
  });

  /**
   * Kỳ hạn + chi phí RIÊNG của từng ghế (0027).
   *
   * Một license 10 ghế hầu như không mua một lần: Kế toán mua 3 ghế hợp đồng này giá này,
   * Xưởng mua 2 ghế hợp đồng khác giá khác kỳ khác. Trước đó mọi con số ấy chỉ có MỘT ô ở
   * tầng hồ sơ, nên "ghế này thuộc hợp đồng nào" không trả lời được.
   */
  test('mỗi ghế mang chi phí, hợp đồng và kỳ hạn riêng — khu bung dòng hiện đủ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const licenseId = await createLicense(page, `LIC-E2E-TERM-${stamp}`, 5);
    const ktCode = `PC-E2E-KT-${stamp}`;
    const xuongCode = `PC-E2E-XU-${stamp}`;

    expect(
      (
        await assign(page, licenseId, await createDevice(page, ktCode), '', {
          cost: 3_500_000,
          contract: `HD-KT-${stamp}`,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await assign(page, licenseId, await createDevice(page, xuongCode), '', {
          cost: 1_200_000,
          contract: `HD-XU-${stamp}`,
        })
      ).status(),
    ).toBe(201);

    await expandLicense(page, `LIC-E2E-TERM-${stamp}`);

    // Hai ghế, hai hợp đồng, hai mức giá — cùng một license.
    await expect(page.getByText('3.500.000 ₫')).toBeVisible();
    await expect(page.getByText('1.200.000 ₫')).toBeVisible();
    await expect(page.getByText(`HD-KT-${stamp}`)).toBeVisible();
    await expect(page.getByText(`HD-XU-${stamp}`)).toBeVisible();
    await expect(page.getByText('01/01/2026')).toBeVisible();
    // Ghế không khai kỳ hạn riêng thì đi theo hồ sơ — và phải NÓI RA như vậy, không hiện
    // con số của hồ sơ như thể người dùng đã khai riêng cho ghế đó.
    await expect(page.getByText('Theo hồ sơ')).toBeVisible();
    await expect(page.getByText(`Đã gán 2/5 ghế`)).toBeVisible();
  });

  /** Sửa ghế NGAY TẠI khu bung dòng, bằng đúng hộp đã dùng để gán (AD-15). */
  test('sửa chi phí và hợp đồng của một ghế ngay trong khu bung dòng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const licenseId = await createLicense(page, `LIC-E2E-EDIT-${stamp}`, 3);
    const deviceCode = `PC-E2E-ED-${stamp}`;
    const deviceId = await createDevice(page, deviceCode);
    expect((await assign(page, licenseId, deviceId, '', { cost: 1_000_000 })).status()).toBe(201);

    const row = await expandLicense(page, `LIC-E2E-EDIT-${stamp}`);
    /*
     * Danh sách có thể nạp lại ngay sau cú bung (số ghế vừa đổi), và lượt nạp lại gập khu bung
     * dòng — menu vừa mở biến mất theo. Lặp tới khi mở được hộp Sửa.
     */
    await expect(async () => {
      if (!(await page.getByText('1.000.000 ₫').isVisible())) {
        await row.getByRole('button').first().click();
      }
      await expect(page.getByText('1.000.000 ₫')).toBeVisible({ timeout: 2_000 });
      await page.getByRole('button', { name: `Thao tác với ${deviceCode}` }).click();
      await page.getByRole('menuitem', { name: 'Sửa' }).click({ timeout: 2_000 });
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    const form = page.getByRole('dialog');
    // Máy KHÔNG sửa được ở đây: đổi máy phải là gỡ rồi gán lại, nếu không thì lịch sử
    // "key này từng nhập máy nào" mất một chặng.
    await expect(form.getByLabel('Tìm máy trong kho…')).toHaveCount(0);
    await form.getByLabel('Chi phí').fill('4200000');
    await form.getByLabel('Hợp đồng').fill(`HD-SUA-${stamp}`);
    await form.getByRole('button', { name: 'Lưu' }).click();

    // Toast phải GỌI TÊN ghế vừa đổi — "Đã lưu" trên màn nhiều ghế thì không biết ghế nào.
    await expect(page.getByText(`Đã lưu ghế của máy ${deviceCode}`)).toBeVisible();
    await expect(page.getByText('4.200.000 ₫')).toBeVisible();
    await expect(page.getByText(`HD-SUA-${stamp}`)).toBeVisible();

    // Đổi chi phí là chuyện đem đi đối chiếu quyết toán — phải để lại vết, kèm ghế nào.
    await page.goto(`/software/${licenseId}`);
    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    await expect(page.getByText('Sửa ghế license')).toBeVisible();
    await expect(page.getByText(new RegExp(`ghế ${deviceCode}`))).toBeVisible();
    await expect(page.getByText(/1\.000\.000 ₫ → 4\.200\.000 ₫/)).toBeVisible();
  });

  test('đường hỏng: kỳ hạn ghế ngược, và ghế của license vĩnh viễn không có ngày kết thúc', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const csrf = await csrfOf(page);
    const headers = { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN };

    const licenseId = await createLicense(page, `LIC-E2E-BAD-${stamp}`, 3);
    const deviceId = await createDevice(page, `PC-E2E-BAD-${stamp}`);

    const reversed = await assign(page, licenseId, deviceId, '', {
      startDate: '2026-12-01',
      endDate: '2026-01-01',
    });
    expect(reversed.status()).toBe(400);
    expect(await reversed.json()).toMatchObject({ code: 'INVALID_ASSIGNMENT_TERMS' });

    // Chi phí âm không phải chi phí — chặn ở server, không chỉ ở ô nhập.
    const negative = await assign(page, licenseId, deviceId, '', { cost: -1 });
    expect(negative.status()).toBe(400);

    // License MUA ĐỨT: chỗ ngồi của nó cũng vĩnh viễn. Cho lọt thì cỗ máy nhắc hạn sẽ đi
    // giục gia hạn một thứ không cần gia hạn.
    const perpetual = await page.request.post('/api/v1/software', {
      headers,
      data: {
        code: `LIC-E2E-PERP-${stamp}`,
        name: 'License mua đứt',
        kind: 'license',
        licenseModel: 'perpetual',
        seatTotal: 2,
        startDate: '2026-01-01',
      },
    });
    expect(perpetual.status()).toBe(201);
    const perpetualId = ((await perpetual.json()) as { id: string }).id;

    const withEnd = await assign(page, perpetualId, deviceId, '', { endDate: '2027-01-01' });
    expect(withEnd.status()).toBe(400);
    expect(String((await withEnd.json()).message)).toContain('vĩnh viễn');

    // Không có ngày kết thúc thì gán được bình thường.
    expect((await assign(page, perpetualId, deviceId, '', { cost: 9_900_000 })).status()).toBe(201);
    await expandLicense(page, `LIC-E2E-PERP-${stamp}`);
    await expect(page.getByText('9.900.000 ₫')).toBeVisible();
    await expect(page.getByText('Vĩnh viễn').first()).toBeVisible();
  });

  /**
   * License chưa gán máy nào VẪN bung được (SW-013): khu bung rỗng là chỗ gần nhất đặt nút
   * "Gán vào máy". Nút bung nói rõ dòng nào cho trình đọc màn hình (SW-014).
   */
  test('license chưa gán máy nào vẫn bung được, khu bung có nút gán', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-NOEXP-${stamp}`;
    await createLicense(page, code, 5);

    await page.goto('/software');
    await page.getByRole('searchbox', { name: /Tìm/ }).fill(code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    const caret = row.getByRole('button', { name: `Mở rộng ${code} — xem máy đang dùng` });
    await expect(caret).toHaveCount(1);
    await caret.click();
    await expect(page.getByText('Chưa gán license này vào máy nào.')).toBeVisible();
    await expect(page.getByText('Đã gán 0/5 ghế')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Gán vào máy', exact: true }),
      'Khu bung rỗng phải có nút gán ngay tại chỗ',
    ).toBeVisible();
  });

  /**
   * Gán NGAY TỪ DANH SÁCH — không phải bung dòng, không phải vào trang chi tiết.
   *
   * License chưa gán máy nào thì không có mũi tên để bung (bài ngay trên), mà nút gán lại nằm
   * trong khu bung: đúng lúc cần gán lần đầu thì chẳng có đường nào tới. Cột Thao tác trám
   * đúng lỗ đó, và mở lại `AssignDialog` cũ chứ không dựng hộp thứ hai (AD-15).
   */
  test('gán license vào máy ngay từ cột Thao tác của danh sách', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-ROW-${stamp}`;
    await createLicense(page, code, 5);
    const deviceCode = `PC-E2E-ROW-${stamp}`;
    await createDevice(page, deviceCode);

    await page.goto('/software');
    await page.getByRole('searchbox', { name: /Tìm/ }).fill(code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await expect(row.getByText('0/5')).toBeVisible();

    await rowAction(page, code, 'Gán vào máy');
    const form = page.getByRole('dialog');
    await form.getByPlaceholder('Tìm máy trong kho…').fill(deviceCode);
    await page.getByRole('option', { name: new RegExp(deviceCode) }).click();
    await form.getByRole('button', { name: 'Gán vào máy' }).click();

    await expect(page.getByText('Đã gán license vào 1 máy.')).toBeVisible();
    // Cột Seat của chính dòng đó phải nhích lên ngay, không phải tải lại trang mới thấy.
    await expect(row.getByText('1/5')).toBeVisible();
  });

  /** SSL, tên miền không có ghế — nút gán không được bày ra để bấm vào rồi báo lỗi. */
  test('hồ sơ không phải license thì cột Thao tác không có nút gán', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SSL-E2E-ROW-${stamp}`;
    const csrf = await csrfOf(page);
    const created = await page.request.post('/api/v1/software', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      // SSL bắt buộc có hạn (`requiresEndDate`) — thiếu là 400 chứ không phải lỗi của màn.
      data: { code, name: 'Chứng chỉ không có ghế', kind: 'ssl', endDate: '2028-12-31' },
    });
    expect(created.status()).toBe(201);

    await page.goto('/software');
    await timVaChoLoc(page, code);
    // Cột Thao tác là menu ba chấm từ 28/08/2026: mục chỉ có trong DOM khi menu đang mở.
    const names = await rowActionNames(page, code);
    expect(names).toContain('Sửa');
    expect(names).not.toContain('Gán vào máy');
  });

  /*
   * SW-053: mua 10 ghế cho cả phòng thì gán một lượt — chọn nhiều máy thành chip, điều khoản ghế
   * dùng chung cho cả lô. Đường hỏng: chưa chọn máy nào thì báo dưới ô, không gửi.
   */
  test('gán một lượt cho nhiều máy từ cột Thao tác', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-LO-${stamp}`;
    await createLicense(page, code, 5);
    const first = `PC-E2E-LO1-${stamp}`;
    const second = `PC-E2E-LO2-${stamp}`;
    await createDevice(page, first);
    await createDevice(page, second);

    await page.goto('/software');
    await page.getByRole('searchbox', { name: /Tìm/ }).fill(code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();

    await rowAction(page, code, 'Gán vào máy');
    const form = page.getByRole('dialog');
    await form.getByRole('button', { name: 'Gán vào máy' }).click();
    await expect(form.getByText('Chọn máy để gán.')).toBeVisible();

    for (const deviceCode of [first, second]) {
      await form.getByPlaceholder('Tìm máy trong kho…').fill(deviceCode);
      await page.getByRole('option', { name: new RegExp(deviceCode) }).click();
    }
    await expect(form.getByRole('list', { name: 'Máy sẽ gán' }).getByRole('listitem')).toHaveCount(2);
    await form.getByRole('button', { name: 'Gán 2 máy' }).click();

    await expect(page.getByText('Đã gán license vào 2 máy.')).toBeVisible();
    await expect(row.getByText('2/5')).toBeVisible();
  });
});

