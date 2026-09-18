import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  resetSoftware,
  resetUsers,
  rowAction,
  timVaChoLoc,
  writeHeaders,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
});

async function fillSoftware(
  page: Page,
  values: { code: string; name: string; kind: string; end?: string; seats?: string },
) {
  const form = page.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Mã hồ sơ' }).fill(values.code);
  await form.getByRole('textbox', { name: 'Tên hồ sơ' }).fill(values.name);
  await form.getByRole('button', { name: 'Loại', exact: true }).click();
  await page.getByRole('option', { name: values.kind, exact: true }).click();
  if (values.seats) {
    await form.getByRole('textbox', { name: 'Số seat' }).fill(values.seats);
  }
  if (values.end) {
    await form.getByRole('button', { name: 'Hết hạn' }).click();
    await page.getByRole('button', { name: 'Chọn ngày' }).first().click();
  }
  await form.getByRole('button', { name: 'Lưu' }).click();
}

/** Đặt hạn qua API cho gọn — DatePicker là widget lịch, không phải thứ story này đi kiểm. */
async function createViaApi(
  page: Page,
  data: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const csrf = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
  const response = await page.request.post('/api/v1/software', {
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data,
  });
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

test.describe('Hồ sơ phần mềm', () => {
  test('đường hạnh phúc: tạo license → lọc thấy → gia hạn → lịch sử ghi lại', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `LIC-E2E-${stamp}`;

    const created = await createViaApi(page, {
      code,
      name: 'Office 365 kiểm thử',
      kind: 'license',
      seatTotal: 10,
      startDate: '2025-01-01',
      endDate: '2026-12-31',
    });
    expect(created.status).toBe(201);

    await page.goto('/software');
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await expect(row.getByText('0/10')).toBeVisible();

    // Lọc theo loại: license còn, SSL thì mất.
    const kindFilter = page.getByRole('button', { name: 'Loại', exact: true });
    await kindFilter.click();
    await page.getByRole('option', { name: 'Chứng chỉ SSL', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(code) })).toHaveCount(0);
    await kindFilter.click();
    await page.getByRole('option', { name: 'Tất cả loại' }).click();
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();

    // Gia hạn qua API rồi kiểm lịch sử trên UI (widget lịch không phải thứ story này kiểm).
    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const id = (created.body.id ?? '') as string;
    const renewed = await page.request.post(`/api/v1/software/${id}/renew`, {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { endDate: '2027-12-31' },
    });
    expect(renewed.status()).toBe(201);

    await page.goto(`/software/${id}`);
    await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    // Bám vào KHU lịch sử: chữ "Gia hạn" còn nằm trên cái nút ở đầu trang, tìm toàn trang
    // là trúng hai chỗ và Playwright từ chối ở chế độ strict.
    const history = page.getByLabel('Lịch sử');
    await expect(history.getByText('Gia hạn')).toBeVisible();
    await expect(history.getByText(/ngày hết hạn: 2026-12-31 → 2027-12-31/)).toBeVisible();
  });

  test('license/SSL/tên miền KHÔNG có hạn thì bị từ chối, nói rõ vì sao cần', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

    for (const kind of ['license', 'ssl', 'domain']) {
      const result = await createViaApi(page, {
        code: `NOEND-E2E-${kind}-${stamp}`,
        name: 'Thiếu hạn',
        kind,
      });
      expect(result.status).toBe(400);
      expect(String(result.body.message)).toContain('nhắc gia hạn');
    }

    // Hợp đồng bảo trì thì được phép vô thời hạn.
    const ok = await createViaApi(page, {
      code: `MAINT-E2E-${stamp}`,
      name: 'Bảo trì vô thời hạn',
      kind: 'maintenance',
    });
    expect(ok.status).toBe(201);
  });

  test('seat chỉ dành cho license; gia hạn lùi về quá khứ bị chặn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

    const wrongSeat = await createViaApi(page, {
      code: `SSL-E2E-${stamp}`,
      name: 'SSL có seat',
      kind: 'ssl',
      endDate: '2027-01-01',
      seatTotal: 5,
    });
    expect(wrongSeat.status).toBe(400);
    expect(String(wrongSeat.body.message)).toContain('để trống');

    const lic = await createViaApi(page, {
      code: `LIC-E2E-BACK-${stamp}`,
      name: 'License gia hạn lùi',
      kind: 'license',
      endDate: '2027-01-01',
    });
    expect(lic.status).toBe(201);

    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const back = await page.request.post(`/api/v1/software/${String(lic.body.id)}/renew`, {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { endDate: '2026-01-01' },
    });
    expect(back.status()).toBe(400);
    expect(await back.json()).toMatchObject({ code: 'RENEW_NOT_FORWARD' });
  });

  /**
   * Epic 3 để chỗ này là một khối chữ "key nằm ở Két sắt (Epic 4)". Story 4.1 mở két thật,
   * nên bài kiểm đổi theo: hồ sơ phần mềm VẪN không chứa key — key sống ở tab Két sắt.
   */
  test('key không nằm trong hồ sơ phần mềm mà ở tab Két sắt', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const created = await createViaApi(page, {
      code: `LIC-E2E-VAULT-${stamp}`,
      name: 'License có key ở két',
      kind: 'license',
      endDate: '2027-06-30',
    });

    await page.goto(`/software/${String(created.body.id)}`);
    await expect(page.getByRole('tab', { name: 'Két sắt' })).toBeVisible();
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText('Chưa cất secret nào')).toBeVisible();
  });

  /**
   * Sắp xếp PHẢI chạy ở server, không phải ở trang đang xem.
   *
   * Bài kiểm dựng 3 hồ sơ rồi lọc còn đúng 3 dòng, bấm tiêu đề cột và đọc lại thứ tự. Quan
   * trọng hơn: kiểm luôn cột KHÔNG được phép sắp (Nhà cung cấp) không có nút bấm — sắp theo
   * nó đòi join sang module danh mục, vi phạm AD-2.
   */
  test('sắp xếp theo cột chạy ở server, cột không sắp được thì không có nút', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

    for (const [suffix, name] of [
      ['A', 'Zulu hồ sơ cuối bảng'],
      ['B', 'Alpha hồ sơ đầu bảng'],
      ['C', 'Mike hồ sơ giữa bảng'],
    ]) {
      await createViaApi(page, {
        code: `SORT-E2E-${stamp}-${suffix}`,
        name,
        kind: 'maintenance',
      });
    }

    await page.goto('/software');
    await page
      .getByRole('searchbox', { name: 'Tìm theo mã, tên hoặc ghi chú' })
      .fill(`SORT-E2E-${stamp}`);
    await expect(page.getByRole('row')).toHaveCount(4); // 1 dòng tiêu đề + 3 hồ sơ

    const firstDataRow = () => page.getByRole('row').nth(1);
    await expect(firstDataRow()).toContainText(`SORT-E2E-${stamp}-A`); // mặc định: theo mã tăng

    // Phải bám vào ĐẦU BẢNG: ngoài kia thanh lọc cũng có nút tên "Tên hồ sơ".
    const head = page.locator('thead');
    await head.getByRole('button', { name: 'Tên hồ sơ' }).click();
    await expect(firstDataRow()).toContainText('Alpha hồ sơ đầu bảng');

    await head.getByRole('button', { name: 'Tên hồ sơ' }).click();
    await expect(firstDataRow()).toContainText('Zulu hồ sơ cuối bảng');

    // Cột dựa vào danh mục: hiện chữ, nhưng KHÔNG phải nút bấm được.
    await expect(head.getByRole('button', { name: 'Nhà cung cấp' })).toHaveCount(0);
  });

  test('tạo hồ sơ bằng form trên UI', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `MAINT-E2E-UI-${stamp}`;

    await page.goto('/software');
    await page.getByRole('button', { name: 'Thêm hồ sơ' }).click();
    await fillSoftware(page, { code, name: 'Hợp đồng bảo trì UPS', kind: 'Hợp đồng bảo trì' });

    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
    // Loại không có seat thì cột seat là gạch, không phải 0/0.
    await expect(
      page.getByRole('row', { name: new RegExp(code) }).getByText('—').first(),
    ).toBeVisible();
  });

  /**
   * License MUA ĐỨT: chỉ cần ngày bắt đầu.
   *
   * Trước đây luật bắt MỌI license phải có ngày hết hạn, nên license mua đứt không khai vào
   * hệ thống được — người dùng buộc phải bịa một ngày, rồi tới ngày đó cỗ máy nhắc hạn đi
   * giục gia hạn một thứ không cần gia hạn. Nhắc sai vài lần là người ta bỏ qua mọi lời nhắc.
   */
  test('license vĩnh viễn: không cần ngày hết hạn, và không bị nhắc gia hạn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const headers = await writeHeaders(page);
    const code = `LIC-E2E-PERP-${stamp}`;

    const created = await page.request.post('/api/v1/software', {
      headers,
      data: {
        code,
        name: 'AutoCad mua đứt E2E',
        kind: 'license',
        licenseModel: 'perpetual',
        startDate: '2026-01-01',
        seatTotal: 3,
      },
    });
    expect(created.status(), 'vĩnh viễn không cần ngày hết hạn').toBe(201);

    // Vừa vĩnh viễn vừa có hạn là hai lời khẳng định ngược nhau — phải bị chặn.
    const contradiction = await page.request.post('/api/v1/software', {
      headers,
      data: {
        code: `LIC-E2E-PERP2-${stamp}`,
        name: 'Mâu thuẫn E2E',
        kind: 'license',
        licenseModel: 'perpetual',
        endDate: '2027-01-01',
      },
    });
    expect(contradiction.status()).toBe(400);
    expect(((await contradiction.json()) as { message: string }).message).toContain('vĩnh viễn');

    // Chỉ license mới có bản mua đứt: SSL luôn có kỳ hạn của nhà cung cấp.
    const wrongKind = await page.request.post('/api/v1/software', {
      headers,
      data: {
        code: `SSL-E2E-PERP-${stamp}`,
        name: 'SSL vĩnh viễn E2E',
        kind: 'ssl',
        licenseModel: 'perpetual',
      },
    });
    expect(wrongKind.status()).toBe(400);

    // Trên danh sách: cột hạn nói "Vĩnh viễn", không phải badge ngày.
    await page.goto('/software');
    await timVaChoLoc(page, code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toContainText('Vĩnh viễn');

    // Và KHÔNG xuất hiện trong màn Sắp hết hạn dù cửa sổ nhìn tới 365 ngày.
    const expiry = await page.request.get('/api/v1/expiry?withinDays=365');
    const body = (await expiry.json()) as { items: { label: string }[] };
    expect(body.items.some((entry) => entry.label.includes(code))).toBe(false);
  });

  /**
   * Sửa NGAY TRÊN DANH SÁCH, cùng nếp với màn Thiết bị.
   *
   * Đổi tên hồ sơ hay đổi trạng thái là việc lặt vặt hằng ngày; bắt vào trang chi tiết rồi
   * quay ra là ba lần chuyển trang cho một ô. Nút mở ĐÚNG hộp "Thêm hồ sơ" đã điền sẵn.
   */
  test('sửa hồ sơ ngay từ cột Thao tác của danh sách', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `LIC-E2E-SUA-${stamp}`;

    expect(
      (
        await createViaApi(page, {
          code,
          name: 'Tên cũ cần sửa',
          kind: 'license',
          seatTotal: 3,
          endDate: '2028-12-31',
        })
      ).status,
    ).toBe(201);

    await page.goto('/software');
    await page.getByRole('searchbox', { name: /Tìm/ }).fill(code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();

    await rowAction(page, code, 'Sửa');
    const form = page.getByRole('dialog');
    // Hộp phải mở ra với dữ liệu ĐANG CÓ — hộp trắng là mất hết những ô người ta không sửa.
    await expect(form.getByRole('textbox', { name: 'Mã hồ sơ' })).toHaveValue(code);
    await form.getByRole('textbox', { name: 'Tên hồ sơ' }).fill('Tên mới sau khi sửa');
    await form.getByRole('button', { name: 'Lưu' }).click();

    await expect(page.getByText('Đã lưu hồ sơ.')).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(code) })).toContainText(
      'Tên mới sau khi sửa',
    );
  });
});
