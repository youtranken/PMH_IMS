import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import {
  APP_ORIGIN,
  E2E_SA,
  devicesPageButton,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetUsers,
  sql,
  uniqueStamp,
} from './helpers';

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
    const stamp = uniqueStamp();
    const csrf = await csrfOf(page);

    // Danh mục phải có trước — đúng thứ tự hệ thống bắt buộc.
    const site = await page.request.post('/api/v1/catalog/site', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { code: `E2E-${stamp}`, name: 'Site import' },
    });
    expect(site.status()).toBe(201);

    await page.goto('/devices');
    // File mẫu nằm TRONG hộp nhập, ngay dưới ô chọn file — không còn đứng ở đầu trang.
    await devicesPageButton(page, 'Nhập từ Excel').click();
    await expect(page.getByRole('button', { name: 'Tải file mẫu' })).toHaveCount(1);
    const template = await downloadTo(page, 'Tải file mẫu', `mau-tb-${stamp}.xlsx`);
    expect(readFileSync(template).subarray(0, 2).toString()).toBe('PK');

    // Nhập lại chính file mẫu vừa tải: KHÔNG được đẻ ra thiết bị nào và không lỗi —
    // đúng dù kho đang rỗng (mẫu toàn dòng VÍ DỤ) hay đã có dữ liệu (mẫu đổ ra dữ liệu thật).
    // Chọn file là TỰ đối chiếu, không cần bấm "Đối chiếu".
    await page.getByLabel('Chọn file .xlsx').setInputFiles(template);
    await expect(page.getByText(/Thêm mới: 0/)).toBeVisible();
    await expect(page.getByText(/Lỗi: 0/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xác nhận ghi' })).toBeDisabled();
    await page.getByRole('button', { name: 'Hủy' }).click();

    // Giờ nhập file thật: tự dựng bằng chính bộ cột của mẫu.
    const real = await buildDeviceFile(join(tmpdir(), `tb-that-${stamp}.xlsx`), [
      [`SW-E2E-IMP1-${stamp}`, 'Switch tầng 1', 'Switch', `E2E-${stamp}`, '15/03/2025'],
      [`SW-E2E-IMP2-${stamp}`, 'Switch tầng 2', 'Switch', `E2E-${stamp}`, ''],
    ]);

    await devicesPageButton(page, 'Nhập từ Excel').click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(real);
    await expect(page.getByText(/Thêm mới: 2/)).toBeVisible();
    await expect(page.getByText(/Lỗi: 0/)).toBeVisible();
    await page.getByRole('button', { name: 'Xác nhận ghi' }).click();

    await expect(page.getByRole('link', { name: `SW-E2E-IMP1-${stamp}` })).toBeVisible();
    await expect(page.getByRole('link', { name: `SW-E2E-IMP2-${stamp}` })).toBeVisible();

    // Nhập lại chính file đó = KHÔNG ĐỔI GÌ, không tạo bản sao (AC 2.6).
    await devicesPageButton(page, 'Nhập từ Excel').click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(real);
    await expect(page.getByText(/Thêm mới: 0/)).toBeVisible();
    await expect(page.getByText(/Không đổi: 2/)).toBeVisible();
  });

  test('đường hỏng: danh mục chưa có → báo rõ dòng nào, KHÔNG ghi gì cả', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    const bad = await buildDeviceFile(join(tmpdir(), `tb-loi-${stamp}.xlsx`), [
      [`SW-E2E-OK-${stamp}`, 'Dòng hợp lệ', 'Switch', '', ''],
      [`SW-E2E-ERR-${stamp}`, 'Loại không tồn tại', 'Swich', '', ''],
    ]);

    await page.goto('/devices');
    await devicesPageButton(page, 'Nhập từ Excel').click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(bad);

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
    const stamp = uniqueStamp();
    const csrf = await csrfOf(page);

    // Gửi thẳng lên /commit một file còn lỗi: server phải từ chối cả file.
    const bad = await buildDeviceFile(join(tmpdir(), `tb-tx-${stamp}.xlsx`), [
      [`SW-E2E-TX1-${stamp}`, 'Dòng hợp lệ', 'Switch', '', ''],
      [`SW-E2E-TX2-${stamp}`, 'Ngày sai', 'Switch', '', 'hôm kia'],
    ]);

    const response = await page.request.post('/api/v1/devices/import/commit', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
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
    const stamp = uniqueStamp();
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
        headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
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
    await devicesPageButton(page, 'Nhập từ Excel').click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(exported);
    await page.getByRole('button', { name: 'Đối chiếu' }).click();
    await expect(page.getByText(/Lỗi: 0/)).toBeVisible();
    await expect(page.getByText(/Thêm mới: 0/)).toBeVisible();
    // Chỉ có dòng của bộ lọc (Switch), KHÔNG có PC → tổng số dòng đối chiếu là 1.
    await expect(page.getByText(/Không đổi: 1/)).toBeVisible();
  });

  /**
   * Q-14 (DEV-027) ở cửa Excel: file không được là cửa sau để chọn MỚI một site đã ngừng dùng.
   * Máy VỐN nằm ở site đó thì nhập lại nguyên dòng vẫn qua — chặn cả nó là khoá chết hồ sơ cũ.
   */
  test('site đã ngừng dùng: dòng mới báo lỗi theo dòng, máy cũ ở site đó vẫn nhập lại được', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
    const siteCode = `E2E-OFF-${stamp}`;
    const site = await page.request.post('/api/v1/catalog/site', {
      headers,
      data: { code: siteCode, name: 'Site sắp ngừng dùng' },
    });
    expect(site.status()).toBe(201);
    const siteId = ((await site.json()) as { id: string }).id;

    // Máy cũ dựng khi site còn dùng, rồi mới ngừng dùng site — đúng như đời thực.
    const oldCode = `SW-E2E-OFFOLD-${stamp}`;
    const seed = await buildDeviceFile(join(tmpdir(), `tb-off-seed-${stamp}.xlsx`), [
      [oldCode, 'Switch cũ', 'Switch', siteCode, ''],
    ]);
    await page.goto('/devices');
    await devicesPageButton(page, 'Nhập từ Excel').click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(seed);
    await page.getByRole('button', { name: 'Đối chiếu' }).click();
    await expect(page.getByText(/Thêm mới: 1/)).toBeVisible();
    await page.getByRole('button', { name: 'Xác nhận ghi' }).click();
    await expect(page.getByRole('link', { name: oldCode })).toBeVisible();

    const off = await page.request.patch(`/api/v1/catalog/site/${siteId}/active`, {
      headers,
      data: { active: false },
    });
    expect(off.ok()).toBeTruthy();

    const newCode = `SW-E2E-OFFNEW-${stamp}`;
    const bad = await buildDeviceFile(join(tmpdir(), `tb-off-${stamp}.xlsx`), [
      [newCode, 'Switch mới', 'Switch', siteCode, ''],
    ]);
    await devicesPageButton(page, 'Nhập từ Excel').click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(bad);
    await expect(page.getByText(/Lỗi: 1/)).toBeVisible();
    await expect(page.getByText(`Site "${siteCode}" đã ngừng dùng`, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xác nhận ghi' })).toBeDisabled();
    await page.getByRole('button', { name: 'Hủy' }).click();
    expect(sql(`SELECT count(*) FROM device WHERE code = '${newCode}'`)).toBe('0');

    // Máy cũ: đổi tên, giữ nguyên site đã ngừng dùng → vẫn là một dòng cập nhật hợp lệ.
    const again = await buildDeviceFile(join(tmpdir(), `tb-off-again-${stamp}.xlsx`), [
      [oldCode, 'Switch cũ — đổi tên', 'Switch', siteCode, ''],
    ]);
    await devicesPageButton(page, 'Nhập từ Excel').click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(again);
    await page.getByRole('button', { name: 'Đối chiếu' }).click();
    await expect(page.getByText(/Lỗi: 0/)).toBeVisible();
    await expect(page.getByText(/Cập nhật: 1/)).toBeVisible();
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

/**
 * Finding #10 — import đối chiếu NGOÀI transaction rồi ghi vô điều kiện bên trong.
 *
 * Hai lỗi cộng dồn, và cả hai đều IM LẶNG:
 *
 * 1. `updateWithin` không kiểm số dòng trúng. Hồ sơ bị xóa xen giữa lúc đối chiếu và lúc ghi
 *    thì `UPDATE ... WHERE id = <đã chết>` khớp 0 dòng, Postgres không báo lỗi, `updated += 1`
 *    và audit ghi một sự kiện CHƯA TỪNG XẢY RA. Bản catalog còn ép kiểu `as unknown as` nên
 *    trả `undefined` đội lốt bản ghi.
 * 2. `before` lấy từ ảnh chụp lúc đối chiếu, tra trượt thì rơi về `before ?? {}`.
 *    `{...undefined}` không ném, nên `diffDevice` lặng lẽ so với object RỖNG và
 *    `device_history` ghi "mọi trường đổi từ trống" — một dòng lịch sử BỊA trong bảng
 *    chỉ-thêm mà FR-007 dựng ra để trả lời "ai đổi gì".
 *
 * ===== BÀI NÀY CHỨNG MINH ĐƯỢC GÌ, VÀ KHÔNG CHỨNG MINH ĐƯỢC GÌ =====
 *
 * Nói thẳng: bài này XANH CẢ TRƯỚC LẪN SAU bản sửa. Nó là hàng rào hồi quy, KHÔNG phải bằng
 * chứng. Đừng đọc nó như bằng chứng.
 *
 * Lý do, cho cả hai vế:
 *  - Vế 1 (UPDATE khớp 0 dòng): cửa sổ đua nằm TRỌN trong một lời gọi `/import/commit` — plan
 *    được dựng lại ngay bên trong lời gọi đó — nên không có cách nào chen một lượt xóa vào
 *    giữa từ bên ngoài. Và `updateWithin` chỉ tới được nhánh 0-dòng qua đúng đường đua này:
 *    mọi lối vào khác (`update`, `setStatus`) đều có `requireRow` chặn trước.
 *  - Vế 2 (`before ?? {}`): `row.label` chính là mã máy, tức CÙNG khóa đã dựng ra `existingId`.
 *    Tra trượt là không xảy ra ở đường bình thường; `?? {}` là một nhánh phòng thủ chưa ai
 *    chạm tới. Nó nguy hiểm vì im lặng khi cách đánh khóa đổi, không vì hôm nay nó sai.
 *
 * Nên giá trị thật của bài này là: khóa lại hình dạng ĐÚNG của `changes` (diff thật, `before`
 * là giá trị cũ thật), để nếu ai đó đổi cách dựng khóa hoặc quay lại dùng ảnh chụp thì nó đỏ.
 * Chứng minh trực tiếp hai vế trên cần tầng integration chạm DB thật. Lúc viết bài này tầng
 * đó chưa tồn tại (`api/test/` rỗng, nợ số một ở `docs/CODE-REVIEW-2026-09-07.md` mục 9); nó
 * đã được dựng ngày 08/09 và nay có hơn hai chục bài, nên hai vế trên LÀM ĐƯỢC ở đó — đây là
 * việc còn nợ, không còn là việc bất khả.
 */
test.describe('Import cập nhật — lịch sử phải là THẬT (finding #10)', () => {
  test('sửa MỘT ô qua import thì lịch sử chỉ ghi đúng ô đó, không phải "mọi trường từ trống"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const csrf = await csrfOf(page);
    const code = `SW-E2E-DIFF-${stamp}`;

    // Vòng 1: tạo mới qua import.
    const first = await buildDeviceFile(join(tmpdir(), `tb-diff1-${stamp}.xlsx`), [
      [code, 'Ten ban dau', 'Switch', '', ''],
    ]);
    const created = await page.request.post('/api/v1/devices/import/commit', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      multipart: {
        file: { name: 'tb.xlsx', mimeType: 'application/octet-stream', buffer: readFileSync(first) },
      },
    });
    expect(created.status()).toBe(201);

    // Vòng 2: CÙNG mã, chỉ đổi TÊN. Mọi trường khác giữ nguyên.
    const second = await buildDeviceFile(join(tmpdir(), `tb-diff2-${stamp}.xlsx`), [
      [code, 'Ten da sua', 'Switch', '', ''],
    ]);
    const updated = await page.request.post('/api/v1/devices/import/commit', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      multipart: {
        file: { name: 'tb.xlsx', mimeType: 'application/octet-stream', buffer: readFileSync(second) },
      },
    });
    expect(updated.status()).toBe(201);
    expect((await updated.json()) as { updated: number }).toMatchObject({ updated: 1 });

    const changes = sql(
      `SELECT changes::text FROM device_history h ` +
        `JOIN device d ON d.id = h.device_id ` +
        `WHERE d.code = '${code}' AND h.action = 'imported-update' ` +
        `ORDER BY h.created_at DESC LIMIT 1`,
    );

    expect(changes, 'phải có dòng lịch sử cho lượt cập nhật').not.toBe('');
    const parsed = JSON.parse(changes) as Record<string, { before: unknown; after: unknown }>;

    // Đúng MỘT trường đổi, và `before` phải là giá trị THẬT chứ không phải null.
    expect(Object.keys(parsed), 'chỉ tên đổi thì lịch sử chỉ được ghi tên').toEqual(['name']);
    expect(
      parsed.name.before,
      'before phải là tên cũ THẬT — null nghĩa là đang so với một object rỗng',
    ).toBe('Ten ban dau');
    expect(parsed.name.after).toBe('Ten da sua');

    /*
     * Hàng rào hồi quy cho đúng chế độ hỏng: nếu `before` lại rơi về `{}` thì `code` và
     * `deviceTypeId` cũng lọt vào diff với `before: null`, dù chúng không đổi gì.
     */
    expect(parsed.code, 'mã không đổi thì không được có mặt trong lịch sử').toBeUndefined();
  });
});
