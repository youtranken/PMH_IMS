import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_MEMBER, E2E_SA, firstLogin, resetCatalog, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetCatalog();
});

/**
 * Story 2.1 — danh mục site / tủ / loại thiết bị / nhà cung cấp.
 * Chạy trên stack docker thật, không mock API (DoD).
 */
test.describe('Danh mục', () => {
  test('đường hạnh phúc: thêm site → thêm tủ trong site đó → vô hiệu → bật lại', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.getByRole('link', { name: 'Danh mục' }).click();
    await expect(page.getByRole('heading', { name: 'Danh mục' })).toBeVisible();

    // Mã sinh theo thời gian: dữ liệu danh mục KHÔNG bị reset giữa các lần chạy
    // (resetUsers chỉ đụng tới tài khoản), mã cố định sẽ đụng bản ghi của lần chạy trước.
    const stamp = Date.now().toString().slice(-6);
    const siteCode = `E2E-${stamp}`;
    const cabinetCode = `R-${stamp}`;
    await page.getByRole('button', { name: 'Thêm site' }).click();
    // Bám vào hộp thoại: ngoài màn còn ô tìm kiếm có nhãn chứa chữ "mã"/"tên".
    const siteForm = page.getByRole('dialog');
    await siteForm.getByLabel('Mã').fill(siteCode);
    await siteForm.getByLabel('Tên').fill('Site kiểm thử');
    await siteForm.getByRole('button', { name: 'Lưu' }).click();

    const siteRow = page.getByRole('row', { name: new RegExp(siteCode) });
    await expect(siteRow).toBeVisible();
    await expect(siteRow.getByText('Đang dùng')).toBeVisible();

    // Tủ mạng phải chọn được site vừa tạo (ô chọn lấy từ cùng một nguồn danh mục).
    await page.getByRole('tab', { name: 'Tủ mạng' }).click();
    await page.getByRole('button', { name: 'Thêm tủ mạng' }).click();
    const cabinetForm = page.getByRole('dialog');
    await cabinetForm.getByLabel('Mã').fill(cabinetCode);
    await cabinetForm.getByRole('button', { name: 'Thuộc site' }).click();
    await page.getByRole('option', { name: new RegExp(siteCode) }).click();
    await cabinetForm.getByLabel('Số U').fill('42');
    await cabinetForm.getByRole('button', { name: 'Lưu' }).click();

    const cabinetRow = page.getByRole('row', { name: new RegExp(cabinetCode) });
    await expect(cabinetRow).toBeVisible();
    // exact: mã sinh theo timestamp có thể CHỨA chuỗi "42", không exact thì bắt trúng 3 ô.
    await expect(cabinetRow.getByRole('cell', { name: '42', exact: true })).toBeVisible();

    // Vô hiệu rồi bật lại — mục vẫn còn, chỉ đổi trạng thái.
    await cabinetRow.getByRole('button', { name: 'Vô hiệu' }).click();
    await page.getByRole('button', { name: 'Đồng ý' }).click();
    await expect(cabinetRow.getByText('Đã vô hiệu')).toBeVisible();

    await cabinetRow.getByRole('button', { name: 'Bật lại' }).click();
    await page.getByRole('button', { name: 'Đồng ý' }).click();
    await expect(cabinetRow.getByText('Đang dùng')).toBeVisible();

    // Dọn sạch sau khi chạy — đồng thời kiểm luôn đường XÓA THÀNH CÔNG (mục chưa ai dùng).
    await cabinetRow.getByRole('button', { name: 'Xóa' }).click();
    await page.getByRole('button', { name: 'Đồng ý' }).click();
    await expect(cabinetRow).toHaveCount(0);

    await page.getByRole('tab', { name: 'Site' }).click();
    const createdSite = page.getByRole('row', { name: new RegExp(siteCode) });
    await createdSite.getByRole('button', { name: 'Xóa' }).click();
    await page.getByRole('button', { name: 'Đồng ý' }).click();
    await expect(createdSite).toHaveCount(0);
  });

  test('đường hỏng: xóa site đang có tủ bên trong bị chặn, kèm gợi ý vô hiệu hóa', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.getByRole('link', { name: 'Danh mục' }).click();

    const stamp = Date.now().toString().slice(-5);
    const siteCode = `E2E-FK-${stamp}`;
    const cabinetCode = `R-FK-${stamp}`;
    await page.getByRole('button', { name: 'Thêm site' }).click();
    const siteForm = page.getByRole('dialog');
    await siteForm.getByLabel('Mã').fill(siteCode);
    await siteForm.getByLabel('Tên').fill('Site có tủ');
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

    await page.getByRole('tab', { name: 'Site' }).click();
    await page
      .getByRole('row', { name: new RegExp(siteCode) })
      .getByRole('button', { name: 'Xóa' })
      .click();
    await page.getByRole('button', { name: 'Đồng ý' }).click();

    await expect(page.getByText(/không xóa được/i)).toBeVisible();
    // Vẫn còn nguyên trong bảng — chặn thật, không phải chỉ báo lỗi rồi vẫn xóa.
    await expect(page.getByRole('row', { name: new RegExp(siteCode) })).toBeVisible();
  });

  test('tải file mẫu rồi nhập lại chính nó: đối chiếu ra "không đổi", không tạo bản sao', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.getByRole('link', { name: 'Danh mục' }).click();

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Tải file mẫu' }).click(),
    ]).then(([event]) => event);
    expect(download.suggestedFilename()).toBe('mau-danh-muc.xlsx');

    const saved = join(tmpdir(), `ims-catalog-${Date.now()}.xlsx`);
    await download.saveAs(saved);
    expect(readFileSync(saved).subarray(0, 2).toString()).toBe('PK');

    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();
    await page.getByLabel('Chọn file .xlsx').setInputFiles(saved);
    await page.getByRole('button', { name: 'Đối chiếu' }).click();

    // Xuất ra rồi nhập lại chính nó phải KHÔNG đổi gì: không thêm, không sửa, không lỗi.
    // (Không khẳng định con số "không đổi" cụ thể — danh mục thật của hệ thống lớn dần.)
    await expect(page.getByText(/Thêm mới: 0/)).toBeVisible();
    await expect(page.getByText(/Cập nhật: 0/)).toBeVisible();
    await expect(page.getByText(/Lỗi: 0/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xác nhận ghi' })).toBeDisabled();
  });

  test('import file sai mẫu bị từ chối trước khi ghi', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.getByRole('link', { name: 'Danh mục' }).click();
    await page.getByRole('button', { name: 'Nhập từ Excel' }).click();

    const bogus = join(tmpdir(), `ims-bogus-${Date.now()}.xlsx`);
    writeFileSync(bogus, 'đây không phải file excel');
    await page.getByLabel('Chọn file .xlsx').setInputFiles(bogus);
    await page.getByRole('button', { name: 'Đối chiếu' }).click();

    await expect(page.getByText(/Chỉ nhận file \.xlsx/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xác nhận ghi' })).toBeDisabled();
  });

  test('Member xem được danh mục nhưng không có nút sửa', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    await page.getByRole('link', { name: 'Danh mục' }).click();

    await expect(page.getByRole('tab', { name: 'Loại thiết bị' })).toBeVisible();
    await page.getByRole('tab', { name: 'Loại thiết bị' }).click();
    await expect(page.getByRole('row', { name: /Switch/ })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Thêm loại thiết bị' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nhập từ Excel' })).toHaveCount(0);
    await expect(page.getByText('Bạn chỉ có quyền xem danh mục.')).toBeVisible();
  });

  test('Member gọi thẳng API ghi vẫn bị chặn (không chỉ ẩn nút)', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const response = await page.request.post('/api/v1/catalog/site', {
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://localhost' },
      data: { code: 'HACK', name: 'Không được phép' },
    });
    expect(response.status()).toBe(403);
  });
});
