import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetSoftware,
  resetUsers,
  searchAndWaitForFilter,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Q-22 — "Phần mềm" tách thành bốn màn trên menu Tài sản: Phần mềm (license) · Tên miền & SSL
 * · Hợp đồng bảo trì · Dịch vụ có hạn khác. Cùng một bảng `software` với cột `kind`; mỗi màn chỉ
 * thấy loại của nó, form chỉ cho chọn loại của nó, và link cũ `/software…` vẫn tới đúng màn.
 */

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
});

async function createViaApi(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/v1/software', { headers: await writeHeaders(page), data });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Ô ngày là lịch bật lên; gõ thẳng dd/mm/yyyy vào ô "Gõ ngày" của nó rồi Enter. */
async function typeDate(page: Page, dialog: ReturnType<Page['getByRole']>, label: string, ddmmyyyy: string) {
  await dialog.getByRole('button', { name: label, exact: true }).click();
  const typed = page.getByRole('textbox', { name: 'Gõ ngày (dd/mm/yyyy)' });
  await typed.fill(ddmmyyyy);
  await typed.press('Enter');
}

test.describe('Q-22 · Tên miền & SSL', () => {
  test('tạo chứng chỉ SSL phủ hai tên miền từ form → danh sách hiện tên đầu "+1", tìm theo tên miền thứ hai → hồ sơ ở /domains', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SSL-E2E-Q22-${stamp}`;
    const shop = `shop-e2e-${stamp}.pmh.vn`;
    const mail = `mail-e2e-${stamp}.pmh.vn`;

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await nav.getByRole('link', { name: 'Tên miền & SSL', exact: true }).click();
    await expect(page).toHaveURL(/\/domains$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Tên miền & SSL' })).toBeVisible();

    await page.getByRole('button', { name: 'Thêm tên miền / SSL' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Thêm tên miền / SSL' });
    const kinds = dialog.getByRole('radiogroup', { name: 'Loại' });
    expect(
      await kinds.getByRole('radio').evaluateAll((els) =>
        els.map((el) => (el.closest('label')?.textContent ?? '').trim()),
      ),
      'Màn Tên miền & SSL chỉ cho chọn hai loại của nó',
    ).toEqual(['Tên miền', 'Chứng chỉ SSL']);
    await kinds.getByRole('radio', { name: 'Chứng chỉ SSL' }).check();
    // Không còn ô của license.
    await expect(dialog.getByRole('textbox', { name: 'Số ghế' })).toHaveCount(0);

    await dialog.getByRole('textbox', { name: 'Mã hồ sơ', exact: true }).fill(code);
    await dialog.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }).fill('Chứng chỉ wildcard E2E');
    await dialog.getByRole('textbox', { name: 'Tên miền' }).fill(`${shop}\n${mail}`);
    await typeDate(page, dialog, 'Hết hạn', '31/12/2030');
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText('Đã lưu hồ sơ.')).toBeVisible();

    // Tìm theo tên miền THỨ HAI vẫn ra hồ sơ (Q-22: tìm theo bất kỳ tên miền nào).
    await searchAndWaitForFilter(page, `mail-e2e-${stamp}`);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await expect(row.getByText(shop, { exact: true })).toBeVisible();
    await expect(row.getByTitle(`${shop}, ${mail}`)).toBeVisible();
    await expect(row.getByText('+1', { exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Ghế' })).toHaveCount(0);

    await row.getByRole('link', { name: code }).click();
    await expect(page).toHaveURL(/\/domains\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(code) })).toBeVisible();
    const crumbs = page.getByRole('navigation', { name: 'breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Tên miền & SSL', exact: true })).toHaveAttribute('href', '/domains');
    const names = page.getByRole('region', { name: 'Tên miền', exact: true });
    await expect(names.getByText(shop, { exact: true })).toBeVisible();
    await expect(names.getByText(mail, { exact: true })).toBeVisible();
    // Menu sáng đúng mục của màn, không phải "Phần mềm".
    await expect(page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Tên miền & SSL', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('đường hỏng: không nhập tên miền nào thì không lưu, báo ngay dưới ô "Tên miền"', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    await page.goto('/domains');
    await page.getByRole('button', { name: 'Thêm tên miền / SSL' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Thêm tên miền / SSL' });
    await dialog.getByRole('textbox', { name: 'Mã hồ sơ', exact: true }).fill(`DOM-E2E-Q22-RONG-${stamp}`);
    await dialog.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }).fill('Tên miền thiếu');
    await typeDate(page, dialog, 'Hết hạn', '31/12/2030');

    let posted = false;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/v1/software')) posted = true;
    });
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Tên miền' })).toHaveAccessibleDescription(
      /Nhập ít nhất một tên miền\./,
    );
    await expect(dialog).toBeVisible();
    expect(posted, 'thiếu tên miền thì không được gửi gì lên').toBe(false);
  });

  test('link cũ: /software?kind=ssl và /software/<id> của một SSL tới đúng màn Tên miền & SSL', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SSL-E2E-Q22-CU-${stamp}`;
    const id = await createViaApi(page, {
      code,
      name: 'Chứng chỉ link cũ',
      kind: 'ssl',
      endDate: '2030-06-30',
      websites: [`cu-e2e-${stamp}.pmh.vn`],
    });

    await page.goto(`/software?kind=ssl&q=${encodeURIComponent(code)}`);
    await expect(page).toHaveURL(/\/domains\?kind=ssl&q=/);
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();

    // Link `/software/<id>` trong thư mở két / kho thanh lý: giữ `?tab=`.
    await page.goto(`/software/${id}?tab=attachments`);
    await expect(page).toHaveURL(new RegExp(`/domains/${id}\\?tab=attachments$`));
    await expect(page.getByRole('tab', { name: /Giấy tờ/, selected: true })).toBeVisible();

    // Màn Phần mềm không còn chứa SSL.
    await page.goto(`/software?q=${encodeURIComponent(code)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Phần mềm' })).toBeVisible();
    await expect(page.getByText('Không có hồ sơ nào khớp bộ lọc.')).toBeVisible();
  });
});

test.describe('Q-22 · Hợp đồng bảo trì', () => {
  test('tạo hợp đồng từ form (không có ô Loại) → danh sách → trang chi tiết ở /maintenance', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `MNT-E2E-Q22-${stamp}`;

    await page.goto('/maintenance');
    await expect(page.getByRole('heading', { level: 1, name: 'Hợp đồng bảo trì' })).toBeVisible();
    await page.getByRole('button', { name: 'Thêm hợp đồng bảo trì' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Thêm hợp đồng bảo trì' });
    await expect(dialog.getByRole('radiogroup', { name: 'Loại' })).toHaveCount(0);
    await expect(dialog.getByRole('textbox', { name: 'Tên miền' })).toHaveCount(0);
    await dialog.getByRole('textbox', { name: 'Mã hồ sơ', exact: true }).fill(code);
    await dialog.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }).fill('Bảo trì máy chủ E2E');
    await typeDate(page, dialog, 'Hết hạn', '30/06/2031');
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText('Đã lưu hồ sơ.')).toBeVisible();

    await searchAndWaitForFilter(page, code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: code }).click();
    await expect(page).toHaveURL(/\/maintenance\/[0-9a-f-]{36}$/);
    const crumbs = page.getByRole('navigation', { name: 'breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Hợp đồng bảo trì', exact: true })).toHaveAttribute(
      'href',
      '/maintenance',
    );
    const saved = await page.request.get(`/api/v1/software?search=${encodeURIComponent(code)}&kind=maintenance`);
    expect(((await saved.json()) as { total: number }).total).toBe(1);
  });

  test('đường hỏng: license không lạc sang màn Hợp đồng bảo trì; bỏ trống Mã thì báo tại ô', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-Q22-LAC-${stamp}`;
    await createViaApi(page, { code, name: 'License không thuộc màn này', kind: 'license', endDate: '2030-01-31' });

    await page.goto(`/maintenance?q=${encodeURIComponent(code)}`);
    await expect(page.getByText('Không có hồ sơ nào khớp bộ lọc.')).toBeVisible();

    await page.getByRole('button', { name: 'Thêm hợp đồng bảo trì' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Thêm hợp đồng bảo trì' });
    await dialog.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }).fill('Thiếu mã');
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Mã hồ sơ', exact: true })).toHaveAccessibleDescription(
      'Bắt buộc — chưa nhập ô này.',
    );
    await expect(dialog).toBeVisible();
  });
});

test.describe('Q-22 · Dịch vụ có hạn khác', () => {
  test('tạo dịch vụ từ form → danh sách → trang chi tiết ở /services', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SVC-E2E-Q22-${stamp}`;

    await page.goto('/services');
    await expect(page.getByRole('heading', { level: 1, name: 'Dịch vụ có hạn khác' })).toBeVisible();
    await page.getByRole('button', { name: 'Thêm dịch vụ' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Thêm dịch vụ' });
    await expect(dialog.getByRole('radiogroup', { name: 'Loại' })).toHaveCount(0);
    await dialog.getByRole('textbox', { name: 'Mã hồ sơ', exact: true }).fill(code);
    await dialog.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }).fill('Thuê bao lưu trữ đám mây E2E');
    await typeDate(page, dialog, 'Hết hạn', '15/03/2031');
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText('Đã lưu hồ sơ.')).toBeVisible();

    await searchAndWaitForFilter(page, code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await row.getByRole('link', { name: code }).click();
    await expect(page).toHaveURL(/\/services\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(code) })).toBeVisible();
    const saved = await page.request.get(`/api/v1/software?search=${encodeURIComponent(code)}`);
    const items = ((await saved.json()) as { items: { kind: string }[] }).items;
    expect(items.map((item) => item.kind)).toEqual(['other']);
  });

  test('đường hỏng: trùng mã với hồ sơ ở màn khác → báo lỗi trong hộp, không tạo bản thứ hai', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SVC-E2E-Q22-TRUNG-${stamp}`;
    await createViaApi(page, { code, name: 'License mang mã này trước', kind: 'license', endDate: '2030-01-31' });

    await page.goto('/services');
    await page.getByRole('button', { name: 'Thêm dịch vụ' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Thêm dịch vụ' });
    await dialog.getByRole('textbox', { name: 'Mã hồ sơ', exact: true }).fill(code);
    await dialog.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }).fill('Dịch vụ trùng mã');
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Đã có hồ sơ mang mã này' })).toBeVisible();
    const res = await page.request.get(`/api/v1/software?search=${encodeURIComponent(code)}`);
    expect(((await res.json()) as { total: number }).total).toBe(1);
  });
});
