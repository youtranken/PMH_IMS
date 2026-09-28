import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  APP_ORIGIN,
  confirmAction,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  resetCatalog,
  resetUsers,
  rowAction,
  rowActionNames,
  uniqueStamp,
} from './helpers';

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
    const stamp = uniqueStamp();
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
    await rowAction(page, new RegExp(cabinetCode), 'Vô hiệu hóa');
    await confirmAction(page);
    await expect(cabinetRow.getByText('Đã vô hiệu hóa')).toBeVisible();

    await rowAction(page, new RegExp(cabinetCode), 'Bật lại');
    await confirmAction(page);
    await expect(cabinetRow.getByText('Đang dùng')).toBeVisible();

    // Dọn sạch sau khi chạy — đồng thời kiểm luôn đường XÓA THÀNH CÔNG (mục chưa ai dùng).
    await rowAction(page, new RegExp(cabinetCode), 'Xóa');
    await confirmAction(page);
    await expect(cabinetRow).toHaveCount(0);

    await page.getByRole('tab', { name: 'Site' }).click();
    const createdSite = page.getByRole('row', { name: new RegExp(siteCode) });
    await rowAction(page, siteCode, 'Xóa');
    await confirmAction(page);
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
    await rowAction(page, siteCode, 'Xóa');
    await confirmAction(page);

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
    // Chọn file là tự đối chiếu. Đúng đuôi .xlsx mà nội dung hỏng thì câu báo nói "không
    // đọc được", không phải "chỉ nhận .xlsx" — người dùng đã gửi đúng .xlsx rồi.
    await page.getByLabel('Chọn file .xlsx').setInputFiles(bogus);

    await expect(page.getByText(/Không đọc được file/)).toBeVisible();
    await expect(page.getByText(/Chỉ nhận file \.xlsx/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Xác nhận ghi' })).toBeDisabled();
  });

  // Q-12: member TẠO và SỬA được mọi danh mục; vô hiệu hoá, xoá, nhập Excel vẫn chỉ SA/Admin.
  test('Member thêm và sửa được site trên màn, không có Vô hiệu hóa / Xóa / Nhập Excel', async ({
    page,
  }) => {
    await firstLogin(page, E2E_MEMBER);
    await page.getByRole('link', { name: 'Danh mục' }).click();
    await expect(page.getByRole('heading', { name: 'Danh mục' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nhập từ Excel' })).toHaveCount(0);

    const siteCode = `E2E-MEM-${uniqueStamp()}`;
    await page.getByRole('button', { name: 'Thêm site' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Mã').fill(siteCode);
    await form.getByLabel('Tên').fill('Site member tạo');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('row', { name: new RegExp(siteCode) })).toBeVisible();

    // "Lịch sử" chỉ đọc nên Member cũng có; việc lấy đi (Vô hiệu hóa, Xóa) thì không.
    expect(await rowActionNames(page, siteCode)).toEqual(['Sửa', 'Lịch sử']);
    await rowAction(page, siteCode, 'Sửa');
    await page.getByRole('dialog').getByLabel('Tên').fill('Site member đã sửa');
    await page.getByRole('dialog').getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('row', { name: new RegExp(siteCode) })).toContainText(
      'Site member đã sửa',
    );
  });

  test('Member gọi thẳng API: tạo/sửa được, vô hiệu hóa / xóa / nhập Excel bị chặn', async ({
    page,
  }) => {
    await firstLogin(page, E2E_MEMBER);
    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const headers = { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN };
    const created = await page.request.post('/api/v1/catalog/site', {
      headers,
      data: { code: `E2E-MEM-API-${uniqueStamp()}`, name: 'Member tạo qua API' },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    const updated = await page.request.patch(`/api/v1/catalog/site/${id}`, {
      headers,
      data: { name: 'Member sửa qua API' },
    });
    expect(updated.status()).toBe(200);

    const deactivated = await page.request.patch(`/api/v1/catalog/site/${id}/active`, {
      headers,
      data: { active: false },
    });
    expect(deactivated.status()).toBe(403);
    const deleted = await page.request.delete(`/api/v1/catalog/site/${id}`, { headers });
    expect(deleted.status()).toBe(403);
    const imported = await page.request.post('/api/v1/catalog/import/preview', { headers });
    expect(imported.status()).toBe(403);
  });

  /**
   * Sắp xếp PHẢI chạy ở server, không phải ở trang đang xem (cùng lý do với màn Thiết bị).
   *
   * Dựng 3 tủ mạng trong một site rồi lọc còn đúng 3 dòng, bấm tiêu đề cột "Mô tả" và đọc
   * lại thứ tự. Quan trọng hơn: kiểm cột "Thuộc site" — giá trị lấy qua JOIN sang bảng site
   * (AD-2) — KHÔNG có nút bấm, vì whitelist sắp xếp của tủ mạng không cho phép sắp theo nó.
   */
  test('sắp xếp theo cột chạy ở server, cột lấy qua join thì không có nút', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const siteCode = `E2E-SORT-${stamp}`;
    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const headers = { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN };

    const siteRes = await page.request.post('/api/v1/catalog/site', {
      headers,
      data: { code: siteCode, name: 'Site sắp xếp' },
    });
    const site = (await siteRes.json()) as { id: string };

    for (const [suffix, description] of [
      ['A', 'Zulu tủ cuối bảng'],
      ['B', 'Alpha tủ đầu bảng'],
      ['C', 'Mike tủ giữa bảng'],
    ]) {
      await page.request.post('/api/v1/catalog/cabinet', {
        headers,
        data: { code: `SORT-E2E-${stamp}-${suffix}`, siteId: site.id, description },
      });
    }

    await page.goto('/admin/catalog');
    await page.getByRole('tab', { name: 'Tủ mạng' }).click();
    await page
      .getByRole('searchbox', { name: 'Tìm theo mã tủ, site hoặc mô tả' })
      .fill(`SORT-E2E-${stamp}`);
    await expect(page.getByRole('row')).toHaveCount(4); // 1 dòng tiêu đề + 3 tủ

    const firstDataRow = () => page.getByRole('row').nth(1);
    await expect(firstDataRow()).toContainText(`SORT-E2E-${stamp}-A`); // mặc định: theo mã tăng

    const head = page.locator('thead');
    await head.getByRole('button', { name: 'Mô tả' }).click();
    await expect(firstDataRow()).toContainText('Alpha tủ đầu bảng');

    await head.getByRole('button', { name: 'Mô tả' }).click();
    await expect(firstDataRow()).toContainText('Zulu tủ cuối bảng');

    // Cột dựa vào JOIN sang bảng site: hiện chữ, nhưng KHÔNG phải nút bấm được.
    await expect(head.getByRole('button', { name: 'Thuộc site' })).toHaveCount(0);
  });

  /**
   * Ba danh mục của migration 0028: Bộ phận, Nhà mạng, Dịch vụ/Port.
   *
   * Chúng ra đời vì cùng một lý do — ba ô đang gõ tay tự do, gõ mỗi nơi một kiểu ("P. Kế
   * toán" / "Phòng Kế toán" / "KT"), nên lọc ra thiếu và báo cáo cộng nhầm.
   */
  test('ba danh mục mới thêm được, và bảng lịch sử chấp nhận chúng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    await page.goto('/admin/catalog');

    // ── Bộ phận ───────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'Bộ phận' }).click();
    await page.getByRole('button', { name: 'Thêm bộ phận' }).click();
    let form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Tên', exact: true }).fill(`P. E2E ${stamp}`);
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`P. E2E ${stamp}`) })).toBeVisible();

    // ── Nhà mạng ──────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'Nhà mạng' }).click();
    await page.getByRole('button', { name: 'Thêm nhà mạng' }).click();
    form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Tên', exact: true }).fill(`Mang E2E ${stamp}`);
    await form.getByRole('textbox', { name: 'Hotline' }).fill('1900 1234');
    await form.getByRole('button', { name: 'Lưu' }).click();
    const ispRow = page.getByRole('row', { name: new RegExp(`Mang E2E ${stamp}`) });
    await expect(ispRow).toBeVisible();
    // Hotline bấm gọi được: đứt cáp lúc 2 giờ sáng thì người ta cầm điện thoại, không cầm chuột.
    await expect(ispRow.getByRole('link', { name: '1900 1234' })).toHaveAttribute(
      'href',
      'tel:19001234',
    );

    // ── Dịch vụ / Port ────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'Dịch vụ / Port' }).click();
    // Bộ khởi đầu của migration phải có sẵn — ô chọn rỗng ngày đầu là người dùng lại gõ tay.
    await expect(page.getByRole('row', { name: /HTTPS/ })).toBeVisible();

    await page.getByRole('button', { name: 'Thêm dịch vụ' }).click();
    form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Tên', exact: true }).fill(`Camera E2E ${stamp}`);
    await form.getByRole('textbox', { name: 'Port', exact: true }).fill('50000');
    await form.getByRole('textbox', { name: 'Đến port' }).fill('52000');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(
      page.getByRole('row', { name: new RegExp(`Camera E2E ${stamp}`) }).getByText('50000-52000'),
    ).toBeVisible();

    // Ba danh mục này KHÔNG có đường nhập Excel — file mẫu không hề có sheet cho chúng, nên
    // bày nút ra là hứa một đường đi không tồn tại.
    await expect(page.getByRole('button', { name: 'Nhập từ Excel' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tải file mẫu' })).toHaveCount(0);
    // Còn tab gốc thì vẫn phải có.
    await page.getByRole('tab', { name: 'Site' }).click();
    await expect(page.getByRole('button', { name: 'Nhập từ Excel' })).toBeVisible();
  });

  /** Dải port viết ngược bị chặn — và chặn ở SERVER, không chỉ ở ô nhập. */
  test('đường hỏng: dải port viết ngược bị từ chối', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });

    const res = await page.request.post('/api/v1/catalog/service_port', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { name: `Nguoc E2E ${stamp}`, protocol: 'tcp', portFrom: 52000, portTo: 50000 },
    });
    expect(res.status()).toBe(400);
    expect(String((await res.json()).message)).toContain('ngược');
  });
});
