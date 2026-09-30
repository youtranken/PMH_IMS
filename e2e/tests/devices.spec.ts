import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  confirmAction,
  E2E_SA,
  devicesPageButton,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetSoftware,
  resetUsers,
  rowAction,
  rowActionNames,
  searchAndWaitForFilter,
  writeHeaders,
  uniqueStamp,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  // Bài "phần mềm đang cài" tạo cả license lẫn thiết bị — không dọn thì hồ sơ E2E của lần
  // chạy trước ở lại và đụng ràng buộc trùng mã.
  resetSoftware();
  resetDevices();
  resetCatalog();
});

/** Dựng một site + tủ để gắn thiết bị vào. Trả về mã đã tạo. */
async function seedLocation(page: Page, stamp: string) {
  const siteCode = `E2E-${stamp}`;
  const cabinetCode = `R-${stamp}`;
  await page.goto('/admin/catalog');
  await page.getByRole('button', { name: 'Thêm site' }).click();
  const siteForm = page.getByRole('dialog');
  await siteForm.getByLabel('Mã').fill(siteCode);
  await siteForm.getByLabel('Tên').fill('Site thiết bị');
  await siteForm.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('row', { name: new RegExp(siteCode) })).toBeVisible();

  await page.getByRole('tab', { name: 'Tủ mạng' }).click();
  await page.getByRole('button', { name: 'Thêm tủ mạng' }).click();
  const cabinetForm = page.getByRole('dialog');
  await cabinetForm.getByLabel('Mã').fill(cabinetCode);
  await cabinetForm.getByRole('button', { name: 'Thuộc site' }).click();
  await page.getByRole('option', { name: new RegExp(siteCode) }).click();
  await cabinetForm.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('row', { name: new RegExp(cabinetCode) })).toBeVisible();

  return { siteCode, cabinetCode };
}

/** Điền form thiết bị đang mở. */
async function fillDevice(
  page: Page,
  values: { code: string; name: string; type: string; serial?: string; siteCode?: string },
) {
  const form = page.getByRole('dialog');
  await form.getByLabel('Mã thiết bị').fill(values.code);
  await form.getByLabel('Tên thiết bị').fill(values.name);
  await form.getByRole('button', { name: 'Loại' }).click();
  await page.getByRole('option', { name: values.type, exact: true }).click();
  if (values.serial) await form.getByLabel('Serial').fill(values.serial);
  if (values.siteCode) {
    await form.getByRole('button', { name: 'Site' }).click();
    await page.getByRole('option', { name: new RegExp(values.siteCode) }).click();
  }
  await form.getByRole('button', { name: 'Lưu' }).click();
}

test.describe('Kho thiết bị', () => {
  test('đường hạnh phúc: tạo thiết bị → lọc thấy → sửa → lịch sử ghi lại thay đổi', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const { siteCode } = await seedLocation(page, stamp);
    const code = `SW-E2E-${stamp}`;

    await page.getByRole('link', { name: 'Thiết bị' }).click();
    await devicesPageButton(page, 'Thêm thiết bị').click();
    await fillDevice(page, {
      code,
      name: 'Switch tầng 3 kiểm thử',
      type: 'Switch',
      serial: `FOC-${stamp}`,
      siteCode,
    });

    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Đang dùng')).toBeVisible();

    // Lọc theo loại: thiết bị vừa tạo vẫn còn, thiết bị loại khác biến mất.
    // Ô lọc có aria-label nên TÊN TRỢ NĂNG là "Loại", không phải chữ đang hiện trong ô.
    const typeFilter = page.getByRole('button', { name: 'Loại', exact: true });
    await typeFilter.click();
    await page.getByRole('option', { name: 'PC', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(code) })).toHaveCount(0);
    await typeFilter.click();
    await page.getByRole('option', { name: 'Mọi loại' }).click();
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();

    // Mở chi tiết, sửa hạn bảo hành, lịch sử phải ghi lại đúng cái vừa đổi.
    await page.getByRole('link', { name: code }).click();
    await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();

    await page.getByRole('button', { name: 'Sửa hồ sơ' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Người sử dụng').fill('anh Nam');
    await form.getByRole('button', { name: 'Lưu' }).click();

    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    await expect(page.getByText('Tạo hồ sơ')).toBeVisible();
    await expect(page.getByText(/người sử dụng: \(trống\) → anh Nam/)).toBeVisible();
  });

  test('serial trùng chỉ CẢNH BÁO, vẫn lưu được', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const serial = `DUP-${stamp}`;

    await page.getByRole('link', { name: 'Thiết bị' }).click();
    await devicesPageButton(page, 'Thêm thiết bị').click();
    await fillDevice(page, { code: `PC-E2E-A-${stamp}`, name: 'Máy A', type: 'PC', serial });
    await expect(page.getByRole('row', { name: new RegExp(`PC-E2E-A-${stamp}`) })).toBeVisible();

    await devicesPageButton(page, 'Thêm thiết bị').click();
    await fillDevice(page, { code: `PC-E2E-B-${stamp}`, name: 'Máy B', type: 'PC', serial });

    await expect(page.getByText(/đang trùng với PC-E2E-A-/)).toBeVisible();
    // Cảnh báo chứ không phải chặn: bản ghi thứ hai vẫn phải nằm trong bảng.
    await expect(page.getByRole('row', { name: new RegExp(`PC-E2E-B-${stamp}`) })).toBeVisible();
  });

  test('đường hỏng: trùng mã thiết bị bị chặn, nói rõ lý do', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-DUP-${stamp}`;

    await page.getByRole('link', { name: 'Thiết bị' }).click();
    await devicesPageButton(page, 'Thêm thiết bị').click();
    await fillDevice(page, { code, name: 'Máy đầu tiên', type: 'PC' });
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();

    await devicesPageButton(page, 'Thêm thiết bị').click();
    // Gõ chữ thường: mã là citext nên "pc-dup-…" vẫn là trùng.
    await fillDevice(page, { code: code.toLowerCase(), name: 'Máy thứ hai', type: 'PC' });

    await expect(page.getByText(/Đã có thiết bị mang mã này/)).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('thanh lý khóa hồ sơ, mở lại thì sửa được — không có đường xóa', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `UPS-E2E-${stamp}`;

    await page.getByRole('link', { name: 'Thiết bị' }).click();
    await devicesPageButton(page, 'Thêm thiết bị').click();
    await fillDevice(page, { code, name: 'UPS phòng máy', type: 'UPS' });
    await page.getByRole('link', { name: code }).click();

    // Q-18: Thanh lý nằm trong menu ⋮ ở đầu trang hồ sơ.
    await rowAction(page, code, 'Thanh lý');
    await confirmAction(page);
    await expect(page.getByText('Thiết bị đã thanh lý — bấm "Đưa lại vào dùng" nếu cần sửa hồ sơ.')).toBeVisible();
    // Băng thanh lý nói AI và KHI NÀO, lấy từ lịch sử.
    await expect(page.getByText(/Thanh lý lúc .* bởi /)).toBeVisible();
    // Hồ sơ khoá: không bày nút Sửa xám ở chỗ nút chính — nút chính là "Đưa lại vào dùng".
    await expect(page.getByRole('button', { name: 'Sửa hồ sơ' })).toHaveCount(0);
    // Sổ tài sản không có nút xóa, ở đâu cũng vậy.
    await expect(page.getByRole('button', { name: 'Xóa' })).toHaveCount(0);

    // Mở lại hỏi trạng thái đích, mặc định "Đang dùng" (Q-15); chọn khác vẫn được.
    await page.getByRole('button', { name: 'Đưa lại vào dùng' }).click();
    await expect(page.getByRole('button', { name: 'Trạng thái mới' })).toHaveText(/Đang dùng/);
    await confirmAction(page, 'Đưa lại vào dùng');
    await expect(page.getByRole('button', { name: 'Sửa hồ sơ' })).toBeEnabled();
    await expect(page.getByText('Đang dùng').first()).toBeVisible();
  });

  test('ngày hết bảo hành trước ngày bắt đầu bị từ chối (hàng rào ở SERVER)', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    // DatePicker trên UI không cho chọn khoảng ngày ngược, nên kiểm thẳng ở API:
    // chốt chặn thật phải nằm ở server, không phải ở widget.
    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const nas = catalog.deviceTypes.find((type) => type.name === 'NAS')!;

    const bad = await page.request.post('/api/v1/devices', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: {
        code: `NAS-E2E-BAD-${stamp}`,
        name: 'Khoảng bảo hành ngược',
        deviceTypeId: nas.id,
        warrantyStart: '2027-01-01',
        warrantyEnd: '2026-01-01',
      },
    });
    expect(bad.status()).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'WARRANTY_RANGE_INVALID' });

    /*
     * Tủ thuộc site KHÁC với site đã chọn cũng phải bị chặn (bẫy hay gặp khi import).
     *
     * ===== BÀI NÀY TỰ DỰNG DỮ LIỆU, KHÔNG XIN SEED =====
     *
     * Bọc phần kiểm trong `if (cabinet && otherSite)` rồi đọc tủ/site từ danh mục có sẵn là
     * "assertion có thể không bao giờ chạy": seed KHÔNG có tủ nào, nên phần kiểm ranh giới
     * quan trọng nhất sẽ không chạy lần nào mà bài vẫn xanh.
     *
     * Bài kiểm đi mượn dữ liệu của người khác là bài kiểm sẽ im lặng bỏ đi vào một ngày nào
     * đó. Nên nó tự khai hai site và một tủ, nên tình huống "tủ lệch site" luôn tồn tại.
     */
    const site = async (suffix: string) => {
      const res = await page.request.post('/api/v1/catalog/site', {
        headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
        data: { code: `S-E2E-MIX${suffix}-${stamp}`, name: `Site lech ${suffix} ${stamp}` },
      });
      expect(res.status(), 'phải khai được site cho bài này').toBeLessThan(300);
      return ((await res.json()) as { id: string }).id;
    };
    const siteA = await site('A');
    const siteB = await site('B');

    const cab = await page.request.post('/api/v1/catalog/cabinet', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { code: `TU-E2E-MIX-${stamp}`, name: `Tu lech ${stamp}`, siteId: siteA },
    });
    expect(cab.status(), 'phải khai được tủ trong site A').toBeLessThan(300);
    const cabinetId = ((await cab.json()) as { id: string }).id;

    // Tủ nằm ở site A, nhưng thiết bị khai site B → phải bị chặn.
    const mismatched = await page.request.post('/api/v1/devices', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: {
        code: `NAS-E2E-MIX-${stamp}`,
        name: 'Tủ lệch site',
        deviceTypeId: nas.id,
        siteId: siteB,
        cabinetId,
      },
    });
    expect(mismatched.status()).toBe(400);
    expect(await mismatched.json()).toMatchObject({ code: 'CATALOG_REF_INVALID' });

    // BE-08: tủ còn máy thì không dời sang site khác — máy sẽ kẹt ở site cũ.
    const inside = await page.request.post('/api/v1/devices', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: {
        code: `NAS-E2E-TU-${stamp}`,
        name: 'Máy trong tủ',
        deviceTypeId: nas.id,
        siteId: siteA,
        cabinetId,
      },
    });
    expect(inside.status()).toBe(201);
    const move = await page.request.patch(`/api/v1/catalog/cabinet/${cabinetId}`, {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { siteId: siteB },
    });
    expect(move.status()).toBe(409);
    expect(await move.json()).toMatchObject({ code: 'CABINET_HAS_DEVICES' });
  });

  /**
   * Sửa NGAY TRÊN DANH SÁCH (gói 3).
   *
   * Đổi người giữ máy là việc lặt vặt hằng ngày; trước đó phải vào trang chi tiết rồi quay
   * ra — ba lần chuyển trang cho một ô. Hộp mở ra phải là ĐÚNG hộp "Thêm thiết bị" (AD-15),
   * nên bài kiểm bám vào một ô chỉ hộp đó mới có (Serial) để chắc không phải bản chép ra.
   */
  test('sửa thiết bị ngay trên danh sách, dùng đúng hộp Thêm thiết bị', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-ROWEDIT-${stamp}`;
    const headers = await writeHeaders(page);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
    expect(
      (
        await page.request.post('/api/v1/devices', {
          headers,
          data: { code, name: 'Máy sửa tại chỗ', deviceTypeId: pc.id, assignedTo: 'chị Lan' },
        })
      ).status(),
    ).toBe(201);

    await page.goto('/devices');
    await searchAndWaitForFilter(page, code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await expect(row.getByText('chị Lan')).toBeVisible();

    await row.getByRole('button', { name: `Sửa máy ${code}` }).click();
    const form = page.getByRole('dialog');
    // Điền sẵn hồ sơ đang có, không phải một form trắng.
    await expect(form.getByLabel('Mã thiết bị')).toHaveValue(code);
    // Ô chỉ có ở hộp đầy đủ — bản chép ra rút gọn sẽ trượt ngay ở đây.
    await expect(form.getByLabel('Serial')).toBeVisible();

    await form.getByLabel('Người sử dụng').fill('anh Tuấn');
    await form.getByRole('button', { name: 'Lưu' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('row', { name: new RegExp(code) }).getByText('anh Tuấn')).toBeVisible();
  });

  /**
   * Cột Thao tác theo Q-18: "Sửa" đứng ngoài, mọi việc khác trong ⋮. Thanh lý không làm tại
   * danh sách — hộp thanh lý phải kể thứ máy đang giữ, nên nó sang trang chi tiết mở sẵn hộp.
   */
  test('menu ⋮ trên dòng thiết bị: đổi trạng thái tại chỗ, thanh lý mở ở trang chi tiết', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-ROWMENU-${stamp}`;
    const headers = await writeHeaders(page);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
    const created = await page.request.post('/api/v1/devices', {
      headers,
      data: { code, name: 'Máy menu dòng', deviceTypeId: pc.id },
    });
    expect(created.status()).toBe(201);

    await page.goto('/devices');
    await searchAndWaitForFilter(page, code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row.getByRole('button', { name: `Sửa máy ${code}` })).toBeVisible();
    expect(await rowActionNames(page, code)).toEqual(['Đổi trạng thái', 'Nhân bản', 'Thanh lý']);

    await rowAction(page, code, 'Đổi trạng thái');
    await page.getByRole('button', { name: 'Trạng thái mới' }).click();
    await page.getByRole('option', { name: 'Hỏng' }).click();
    await confirmAction(page, 'Đổi trạng thái');
    await expect(row.getByText('Hỏng')).toBeVisible();

    // Đường hỏng: bấm Thanh lý ở danh sách KHÔNG thanh lý ngay — sang trang chi tiết, hộp mở
    // sẵn; hủy thì máy vẫn nguyên trạng thái cũ.
    await rowAction(page, code, 'Thanh lý');
    const retire = page.getByRole('dialog', { name: `Thanh lý — ${code}` });
    await expect(retire).toBeVisible();
    await expect(page).toHaveURL(/\/devices\/[^/?]+/);
    await retire.getByRole('button', { name: 'Hủy' }).click();
    await expect(retire).toHaveCount(0);
    await expect(page).not.toHaveURL(/action=retire/);
    await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
  });

  /**
   * Bung dòng thiết bị: máy này đang cài license nào (gói 2).
   *
   * Không có nó thì câu hỏi ấy chỉ trả lời được ở TRANG CHI TIẾT từng máy — nhìn danh sách 20
   * dòng thì phải bấm vào 20 lần.
   */
  test('bung dòng thiết bị thấy phần mềm đang cài; máy chưa cài thì không có mũi tên', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const headers = await writeHeaders(page);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;

    const makeDevice = async (code: string) => {
      const res = await page.request.post('/api/v1/devices', {
        headers,
        data: { code, name: `Máy ${code}`, deviceTypeId: pc.id },
      });
      expect(res.status()).toBe(201);
      return ((await res.json()) as { device: { id: string } }).device.id;
    };

    const withCode = `PC-E2E-INST-${stamp}`;
    const bareCode = `PC-E2E-BARE-${stamp}`;
    const withId = await makeDevice(withCode);
    await makeDevice(bareCode);

    const licenseCode = `LIC-E2E-INST-${stamp}`;
    const license = await page.request.post('/api/v1/software', {
      headers,
      data: {
        code: licenseCode,
        name: 'Office cho máy trạm',
        kind: 'license',
        seatTotal: 5,
        endDate: '2028-12-31',
      },
    });
    expect(license.status()).toBe(201);
    const licenseId = ((await license.json()) as { id: string }).id;
    expect(
      (
        await page.request.post(`/api/v1/software/${licenseId}/assignments`, {
          headers,
          data: { deviceId: withId, cost: 2_400_000, contract: `HD-INST-${stamp}` },
        })
      ).status(),
    ).toBe(201);

    await page.goto('/devices');
    await searchAndWaitForFilter(page, `E2E-INST-${stamp}`);
    const row = page.getByRole('row', { name: new RegExp(withCode) });
    await expect(row).toBeVisible();

    // Chưa bung thì mã license CHƯA có mặt trên màn.
    await expect(page.getByRole('link', { name: licenseCode })).toHaveCount(0);
    // Mẫu bung dòng chuẩn (Q-18, giống /software): mũi tên trơn, số license nằm trong TÊN nút
    // và trong đầu khu bung.
    await row.getByRole('button', { name: `Mở rộng ${withCode} — 1 license` }).click();
    await expect(page.getByText('License đang cài', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: licenseCode })).toBeVisible();
    await expect(page.getByText('2.400.000 ₫')).toBeVisible();
    await expect(page.getByText(`HD-INST-${stamp}`)).toBeVisible();

    // Máy chưa cài gì thì KHÔNG được mọc mũi tên bấm ra rỗng.
    await searchAndWaitForFilter(page, bareCode);
    const bareRow = page.getByRole('row', { name: new RegExp(bareCode) });
    await expect(bareRow).toBeVisible();
    await expect(bareRow.getByRole('button', { name: /^Mở rộng/ })).toHaveCount(0);
  });

  /**
   * Sắp xếp PHẢI chạy ở server, không phải ở trang đang xem.
   *
   * Bài kiểm dựng 3 máy rồi lọc còn đúng 3 dòng, bấm tiêu đề cột và đọc lại thứ tự. Quan
   * trọng hơn: kiểm luôn cột KHÔNG được phép sắp (Loại, Vị trí) không có nút bấm — sắp theo
   * chúng đòi join sang module danh mục, vi phạm AD-2.
   */
  test('sắp xếp theo cột chạy ở server, cột không sắp được thì không có nút (thiết bị)', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const typeId = catalog.deviceTypes[0]!.id;
    const headers = { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN };
    for (const [suffix, name] of [
      ['A', 'Zulu máy cuối bảng'],
      ['B', 'Alpha máy đầu bảng'],
      ['C', 'Mike máy giữa bảng'],
    ]) {
      await page.request.post('/api/v1/devices', {
        headers,
        data: { code: `SORT-E2E-${stamp}-${suffix}`, name, deviceTypeId: typeId },
      });
    }

    await page.goto('/devices');
    await searchAndWaitForFilter(page, `SORT-E2E-${stamp}`);
    await expect(page.getByRole('row')).toHaveCount(4); // 1 dòng tiêu đề + 3 máy

    const firstDataRow = () => page.getByRole('row').nth(1);
    await expect(firstDataRow()).toContainText(`SORT-E2E-${stamp}-A`); // mặc định: theo mã tăng

    // Phải bám vào ĐẦU BẢNG: ngoài kia thanh lọc cũng có nút tên "Loại".
    const head = page.locator('thead');
    await head.getByRole('button', { name: 'Tên thiết bị' }).click();
    await expect(firstDataRow()).toContainText('Alpha máy đầu bảng');

    await head.getByRole('button', { name: 'Tên thiết bị' }).click();
    await expect(firstDataRow()).toContainText('Zulu máy cuối bảng');

    // Cột dựa vào danh mục: hiện chữ, nhưng KHÔNG phải nút bấm được.
    await expect(head.getByRole('button', { name: 'Loại' })).toHaveCount(0);
    await expect(head.getByRole('button', { name: 'Vị trí' })).toHaveCount(0);
  });
});
