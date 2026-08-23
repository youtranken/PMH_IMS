import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetSoftware, resetUsers } from './helpers';

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
    headers: { 'X-CSRF-Token': csrf, Origin: 'https://localhost' },
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

    await page.goto('/phan-mem');
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
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://localhost' },
      data: { endDate: '2027-12-31' },
    });
    expect(renewed.status()).toBe(201);

    await page.goto(`/phan-mem/${id}`);
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
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://localhost' },
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

    await page.goto(`/phan-mem/${String(created.body.id)}`);
    await expect(page.getByRole('tab', { name: 'Két sắt' })).toBeVisible();
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText('Chưa cất secret nào')).toBeVisible();
  });

  test('tạo hồ sơ bằng form trên UI', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `MAINT-E2E-UI-${stamp}`;

    await page.goto('/phan-mem');
    await page.getByRole('button', { name: 'Thêm hồ sơ' }).click();
    await fillSoftware(page, { code, name: 'Hợp đồng bảo trì UPS', kind: 'Hợp đồng bảo trì' });

    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
    // Loại không có seat thì cột seat là gạch, không phải 0/0.
    await expect(
      page.getByRole('row', { name: new RegExp(code) }).getByText('—').first(),
    ).toBeVisible();
  });
});
