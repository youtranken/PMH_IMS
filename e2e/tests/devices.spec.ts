import { expect, test, type Page } from '@playwright/test';
import {
  confirmAction,
  E2E_SA,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetSoftware,
  resetUsers,
  writeHeaders,
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
    const stamp = Date.now().toString().slice(-6);
    const { siteCode } = await seedLocation(page, stamp);
    const code = `SW-E2E-${stamp}`;

    await page.getByRole('link', { name: 'Thiết bị' }).click();
    await page.getByRole('button', { name: 'Thêm thiết bị' }).click();
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
    await page.getByRole('option', { name: 'Tất cả loại' }).click();
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
    const stamp = Date.now().toString().slice(-6);
    const serial = `DUP-${stamp}`;

    await page.getByRole('link', { name: 'Thiết bị' }).click();
    await page.getByRole('button', { name: 'Thêm thiết bị' }).click();
    await fillDevice(page, { code: `PC-E2E-A-${stamp}`, name: 'Máy A', type: 'PC', serial });
    await expect(page.getByRole('row', { name: new RegExp(`PC-E2E-A-${stamp}`) })).toBeVisible();

    await page.getByRole('button', { name: 'Thêm thiết bị' }).click();
    await fillDevice(page, { code: `PC-E2E-B-${stamp}`, name: 'Máy B', type: 'PC', serial });

    await expect(page.getByText(/đang trùng với PC-E2E-A-/)).toBeVisible();
    // Cảnh báo chứ không phải chặn: bản ghi thứ hai vẫn phải nằm trong bảng.
    await expect(page.getByRole('row', { name: new RegExp(`PC-E2E-B-${stamp}`) })).toBeVisible();
  });

  test('đường hỏng: trùng mã thiết bị bị chặn, nói rõ lý do', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `PC-E2E-DUP-${stamp}`;

    await page.getByRole('link', { name: 'Thiết bị' }).click();
    await page.getByRole('button', { name: 'Thêm thiết bị' }).click();
    await fillDevice(page, { code, name: 'Máy đầu tiên', type: 'PC' });
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();

    await page.getByRole('button', { name: 'Thêm thiết bị' }).click();
    // Gõ chữ thường: mã là citext nên "pc-dup-…" vẫn là trùng.
    await fillDevice(page, { code: code.toLowerCase(), name: 'Máy thứ hai', type: 'PC' });

    await expect(page.getByText(/Đã có thiết bị mang mã này/)).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('thanh lý khóa hồ sơ, mở lại thì sửa được — không có đường xóa', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `UPS-E2E-${stamp}`;

    await page.getByRole('link', { name: 'Thiết bị' }).click();
    await page.getByRole('button', { name: 'Thêm thiết bị' }).click();
    await fillDevice(page, { code, name: 'UPS phòng máy', type: 'UPS' });
    await page.getByRole('link', { name: code }).click();

    await page.getByRole('button', { name: 'Thanh lý' }).click();
    await confirmAction(page);
    await expect(page.getByText('Thiết bị đã thanh lý — mở lại mới sửa được hồ sơ.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sửa hồ sơ' })).toBeDisabled();
    // Sổ tài sản không có nút xóa, ở đâu cũng vậy.
    await expect(page.getByRole('button', { name: 'Xóa' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Đưa lại vào dùng' }).click();
    await expect(page.getByRole('button', { name: 'Sửa hồ sơ' })).toBeEnabled();
  });

  test('ngày hết bảo hành trước ngày bắt đầu bị từ chối (hàng rào ở SERVER)', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

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
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
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

    // Tủ thuộc site KHÁC với site đã chọn cũng phải bị chặn (bẫy hay gặp khi import).
    const lists = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog?includeInactive=true', { credentials: 'include' });
      return (await res.json()) as {
        sites: { id: string; code: string }[];
        cabinets: { id: string; siteId: string }[];
      };
    });
    const cabinet = lists.cabinets[0];
    const otherSite = lists.sites.find((site) => site.id !== cabinet?.siteId);
    if (cabinet && otherSite) {
      const mismatched = await page.request.post('/api/v1/devices', {
        headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
        data: {
          code: `NAS-E2E-MIX-${stamp}`,
          name: 'Tủ lệch site',
          deviceTypeId: nas.id,
          siteId: otherSite.id,
          cabinetId: cabinet.id,
        },
      });
      expect(mismatched.status()).toBe(400);
      expect(await mismatched.json()).toMatchObject({ code: 'CATALOG_REF_INVALID' });
    }
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
    const stamp = Date.now().toString().slice(-6);
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
    await page.getByRole('searchbox', { name: /Tìm theo mã/ }).fill(code);
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
   * Bung dòng thiết bị: máy này đang cài license nào (gói 2).
   *
   * Trước đó câu hỏi ấy chỉ trả lời được ở TRANG CHI TIẾT từng máy — nhìn danh sách 20 dòng
   * thì phải bấm vào 20 lần.
   */
  test('bung dòng thiết bị thấy phần mềm đang cài; máy chưa cài thì không có mũi tên', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
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
    await page.getByRole('searchbox', { name: /Tìm theo mã/ }).fill(`E2E-INST-${stamp}`);
    const row = page.getByRole('row', { name: new RegExp(withCode) });
    await expect(row).toBeVisible();

    // Chưa bung thì mã license CHƯA có mặt trên màn.
    await expect(page.getByRole('link', { name: licenseCode })).toHaveCount(0);
    await row.getByRole('button', { name: 'Mở rộng dòng' }).click();
    await expect(page.getByRole('link', { name: licenseCode })).toBeVisible();
    await expect(page.getByText('2.400.000 ₫')).toBeVisible();
    await expect(page.getByText(`HD-INST-${stamp}`)).toBeVisible();

    // Máy chưa cài gì thì KHÔNG được mọc mũi tên bấm ra rỗng.
    await page.getByRole('searchbox', { name: /Tìm theo mã/ }).fill(bareCode);
    const bareRow = page.getByRole('row', { name: new RegExp(bareCode) });
    await expect(bareRow).toBeVisible();
    await expect(bareRow.getByRole('button', { name: 'Mở rộng dòng' })).toHaveCount(0);
  });

  /**
   * Sắp xếp PHẢI chạy ở server, không phải ở trang đang xem.
   *
   * Bài kiểm dựng 3 máy rồi lọc còn đúng 3 dòng, bấm tiêu đề cột và đọc lại thứ tự. Quan
   * trọng hơn: kiểm luôn cột KHÔNG được phép sắp (Loại, Vị trí) không có nút bấm — sắp theo
   * chúng đòi join sang module danh mục, vi phạm AD-2.
   */
  test('sắp xếp theo cột chạy ở server, cột không sắp được thì không có nút', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const typeId = catalog.deviceTypes[0]!.id;
    const headers = { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' };
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
    await page.getByRole('searchbox', { name: 'Tìm theo mã, tên, serial hoặc model' }).fill(`SORT-E2E-${stamp}`);
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
