import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetCatalog, resetDevices, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetCatalog();
});

/** Dựng một site + tủ để gắn thiết bị vào. Trả về mã đã tạo. */
async function seedLocation(page: Page, stamp: string) {
  const siteCode = `E2E-${stamp}`;
  const cabinetCode = `R-${stamp}`;
  await page.goto('/quan-tri/danh-muc');
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
    await fillDevice(page, { code: `PC-A-${stamp}`, name: 'Máy A', type: 'PC', serial });
    await expect(page.getByRole('row', { name: new RegExp(`PC-A-${stamp}`) })).toBeVisible();

    await page.getByRole('button', { name: 'Thêm thiết bị' }).click();
    await fillDevice(page, { code: `PC-B-${stamp}`, name: 'Máy B', type: 'PC', serial });

    await expect(page.getByText(/đang trùng với PC-A-/)).toBeVisible();
    // Cảnh báo chứ không phải chặn: bản ghi thứ hai vẫn phải nằm trong bảng.
    await expect(page.getByRole('row', { name: new RegExp(`PC-B-${stamp}`) })).toBeVisible();
  });

  test('đường hỏng: trùng mã thiết bị bị chặn, nói rõ lý do', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `PC-DUP-${stamp}`;

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
    await page.getByRole('button', { name: 'Đồng ý' }).click();
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
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://localhost' },
      data: {
        code: `NAS-BAD-${stamp}`,
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
        headers: { 'X-CSRF-Token': csrf, Origin: 'https://localhost' },
        data: {
          code: `NAS-MIX-${stamp}`,
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
});
