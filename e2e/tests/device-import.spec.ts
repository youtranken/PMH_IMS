import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { E2E_SA, firstLogin, resetCatalog, resetDevices, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetCatalog();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

/** Tải file từ một nút và lưu ra đĩa; trả về đường dẫn. */
async function downloadTo(page: Page, buttonName: string, fileName: string): Promise<string> {
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: buttonName }).click(),
  ]).then(([event]) => event);
  const path = join(tmpdir(), fileName);
  await download.saveAs(path);
  return path;
}

test.describe('Import / export thiết bị', () => {
  test('đường hạnh phúc: tải mẫu → đối chiếu → xác nhận → thiết bị vào kho', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const csrf = await csrfOf(page);

    // Danh mục phải có trước — đúng thứ tự hệ thống bắt buộc.
    const site = await page.request.post('/api/v1/catalog/site', {
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
      data: { code: `E2E-${stamp}`, name: 'Site import' },
    });
    expect(site.status()).toBe(201);

    await page.goto('/devices');
    const template = await downloadTo(page, 'Tải file mẫu', `mau-tb-${stamp}.xlsx`);
    expect(readFileSync(template).subarray(0, 2).toString()).toBe('PK');

    // Nhập lại chính file mẫu vừa tải: KHÔNG được đẻ ra thiết bị nào và không lỗi —
    // đúng dù kho đang rỗng (mẫu toàn dòng VÍ DỤ) hay đã có dữ liệu (mẫu đổ ra dữ liệu thật).
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(template);
    await page.getByRole('button', { name: 'Đối chiếu' }).click();
    await expect(page.getByText(/Thêm mới: 0/)).toBeVisible();
    await expect(page.getByText(/Lỗi: 0/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xác nhận ghi' })).toBeDisabled();
    await page.getByRole('button', { name: 'Hủy' }).click();

    // Giờ nhập file thật: tự dựng bằng chính bộ cột của mẫu.
    const real = await buildDeviceFile(join(tmpdir(), `tb-that-${stamp}.xlsx`), [
      [`SW-E2E-IMP1-${stamp}`, 'Switch tầng 1', 'Switch', `E2E-${stamp}`, '15/03/2025'],
      [`SW-E2E-IMP2-${stamp}`, 'Switch tầng 2', 'Switch', `E2E-${stamp}`, ''],
    ]);

    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(real);
    await page.getByRole('button', { name: 'Đối chiếu' }).click();
    await expect(page.getByText(/Thêm mới: 2/)).toBeVisible();
    await expect(page.getByText(/Lỗi: 0/)).toBeVisible();
    await page.getByRole('button', { name: 'Xác nhận ghi' }).click();

    await expect(page.getByRole('link', { name: `SW-E2E-IMP1-${stamp}` })).toBeVisible();
    await expect(page.getByRole('link', { name: `SW-E2E-IMP2-${stamp}` })).toBeVisible();

    // Nhập lại chính file đó = KHÔNG ĐỔI GÌ, không tạo bản sao (AC 2.6).
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(real);
    await page.getByRole('button', { name: 'Đối chiếu' }).click();
    await expect(page.getByText(/Thêm mới: 0/)).toBeVisible();
    await expect(page.getByText(/Không đổi: 2/)).toBeVisible();
  });

  test('đường hỏng: danh mục chưa có → báo rõ dòng nào, KHÔNG ghi gì cả', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

    const bad = await buildDeviceFile(join(tmpdir(), `tb-loi-${stamp}.xlsx`), [
      [`SW-E2E-OK-${stamp}`, 'Dòng hợp lệ', 'Switch', '', ''],
      [`SW-E2E-ERR-${stamp}`, 'Loại không tồn tại', 'Swich', '', ''],
    ]);

    await page.goto('/devices');
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(bad);
    await page.getByRole('button', { name: 'Đối chiếu' }).click();

    await expect(page.getByText(/Lỗi: 1/)).toBeVisible();
    await expect(page.getByText(/Không có loại thiết bị "Swich"/)).toBeVisible();
    // Còn lỗi thì không cho ghi — kể cả dòng hợp lệ cũng không được vào (một transaction).
    await expect(page.getByRole('button', { name: 'Xác nhận ghi' })).toBeDisabled();

    await page.getByRole('button', { name: 'Hủy' }).click();
    await expect(page.getByRole('link', { name: `SW-E2E-OK-${stamp}` })).toHaveCount(0);
  });

  test('import cả file là MỘT transaction — lỗi giữa chừng thì không dòng nào ở lại', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const csrf = await csrfOf(page);

    // Gửi thẳng lên /commit một file còn lỗi: server phải từ chối cả file.
    const bad = await buildDeviceFile(join(tmpdir(), `tb-tx-${stamp}.xlsx`), [
      [`SW-E2E-TX1-${stamp}`, 'Dòng hợp lệ', 'Switch', '', ''],
      [`SW-E2E-TX2-${stamp}`, 'Ngày sai', 'Switch', '', 'hôm kia'],
    ]);

    const response = await page.request.post('/api/v1/devices/import/commit', {
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
      multipart: {
        file: { name: 'tb.xlsx', mimeType: 'application/octet-stream', buffer: readFileSync(bad) },
      },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'DEVICE_IMPORT_HAS_ERRORS' });

    const list = await page.evaluate(async (search: string) => {
      const res = await fetch(`/api/v1/devices?search=${search}`, { credentials: 'include' });
      return (await res.json()) as { total: number };
    }, `SW-E2E-TX1-${stamp}`);
    expect(list.total).toBe(0);
  });

  test('export tôn trọng bộ lọc đang xem, và nhập lại được ngay (vòng khép kín)', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const csrf = await csrfOf(page);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const sw = catalog.deviceTypes.find((type) => type.name === 'Switch')!;
    const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;

    for (const [code, name, typeId] of [
      [`SW-E2E-EXP-${stamp}`, 'Switch để xuất', sw.id],
      [`PC-E2E-EXP-${stamp}`, 'PC để xuất', pc.id],
    ]) {
      const created = await page.request.post('/api/v1/devices', {
        headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
        data: { code, name, deviceTypeId: typeId },
      });
      expect(created.status()).toBe(201);
    }

    await page.goto('/devices');
    await page.getByRole('button', { name: 'Loại', exact: true }).click();
    await page.getByRole('option', { name: 'Switch', exact: true }).click();
    await expect(page.getByRole('link', { name: `PC-E2E-EXP-${stamp}` })).toHaveCount(0);

    const exported = await downloadTo(page, 'Xuất Excel', `xuat-${stamp}.xlsx`);

    // File xuất ra nhập lại được ngay và không đổi gì — vòng xuất-sửa-nhập khép kín.
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(exported);
    await page.getByRole('button', { name: 'Đối chiếu' }).click();
    await expect(page.getByText(/Lỗi: 0/)).toBeVisible();
    await expect(page.getByText(/Thêm mới: 0/)).toBeVisible();
    // Chỉ có dòng của bộ lọc (Switch), KHÔNG có PC → tổng số dòng đối chiếu là 1.
    await expect(page.getByText(/Không đổi: 1/)).toBeVisible();
  });
});

/**
 * Dựng một file .xlsx tối thiểu đúng bộ cột của mẫu.
 * Cột: Mã · Tên · Loại · Site · Ngày mua — đủ phủ các nhánh đang test.
 */
async function buildDeviceFile(path: string, rows: string[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Thiết bị');
  sheet.addRow(['Mã thiết bị *', 'Tên thiết bị *', 'Loại *', 'Site', 'Ngày mua']);
  for (const row of rows) sheet.addRow(row);
  await wb.xlsx.writeFile(path);
  return path;
}
