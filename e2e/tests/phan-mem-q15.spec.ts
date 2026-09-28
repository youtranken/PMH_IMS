import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  isoInDays,
  resetDevices,
  resetSoftware,
  resetUsers,
  sql,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Q-15 · phần mềm: hợp đồng + chi phí của từng lượt gia hạn vào sổ gia hạn (SW-049), và hộp gán
 * license chọn nhanh cả lô máy theo phòng ban / người sử dụng (SW-053). Mọi hàng tạo ra mang
 * chữ E2E để `reset-e2e.mjs` dọn được.
 */

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetDevices();
});

async function createSoftware(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/v1/software', {
    headers: await writeHeaders(page),
    data,
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function renewWithTerms(page: Page, code: string) {
  const dialog = page.getByRole('dialog', { name: `Gia hạn ${code}` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '+1 năm', exact: true }).click();
  return dialog;
}

test.describe('SW-049 · Gia hạn ghi hợp đồng + chi phí vào sổ gia hạn', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('ghi số hợp đồng + chi phí, sổ gia hạn trong tab Lịch sử hiện hai cột đó', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-GHHD-${stamp}`;
    const contract = `HD-E2E-${stamp}`;
    const id = await createSoftware(page, {
      code,
      name: 'License gia hạn có hợp đồng',
      kind: 'license',
      seatTotal: 5,
      endDate: isoInDays(60),
    });

    await page.goto(`/software/${id}`);
    await page.getByRole('button', { name: 'Gia hạn', exact: true }).first().click();
    const dialog = await renewWithTerms(page, code);
    await dialog.getByRole('textbox', { name: 'Số hợp đồng', exact: true }).fill(contract);
    await dialog.getByRole('textbox', { name: 'Chi phí kỳ mới', exact: true }).fill('12,5tr');
    const renewed = page.waitForResponse((r) => r.url().endsWith('/renew'));
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
    expect((await renewed).status()).toBeLessThan(300);
    await expect(page.getByText(new RegExp(`^Đã gia hạn ${code} tới`))).toBeVisible();

    // Sổ là nguồn sự thật cho quyết toán — kiểm cả dữ liệu, không chỉ chữ trên màn.
    expect(
      sql(`SELECT contract || '|' || cost FROM renewal_history WHERE object_id = '${id}'`),
    ).toBe(`${contract}|12500000`);

    await page.getByRole('tab', { name: /^Lịch sử/ }).click();
    await page.getByRole('button', { name: 'Hạn', exact: true }).click();
    const ledger = page.getByRole('region', { name: 'Sổ gia hạn' });
    await expect(ledger.getByRole('cell', { name: contract })).toBeVisible();
    await expect(ledger.getByRole('cell', { name: /12\.500\.000\s₫/ })).toBeVisible();
  });

  test('chi phí gõ sai → báo ngay dưới ô, không gia hạn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-GHSAI-${stamp}`;
    const id = await createSoftware(page, {
      code,
      name: 'License gia hạn sai chi phí',
      kind: 'license',
      seatTotal: 5,
      endDate: isoInDays(60),
    });

    await page.goto(`/software/${id}`);
    await page.getByRole('button', { name: 'Gia hạn', exact: true }).first().click();
    const dialog = await renewWithTerms(page, code);
    const cost = dialog.getByRole('textbox', { name: 'Chi phí kỳ mới', exact: true });
    await cost.fill('mười triệu');
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
    await expect(cost).toHaveAccessibleDescription(/Chi phí chưa đọc được/);
    await expect(dialog).toBeVisible();
    expect(sql(`SELECT count(*) FROM renewal_history WHERE object_id = '${id}'`)).toBe('0');
  });

  test('390px: sổ gia hạn đọc được trên điện thoại', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `LIC-E2E-GH390-${stamp}`;
    const contract = `HD-E2E-390-${stamp}`;
    const id = await createSoftware(page, {
      code,
      name: 'License sổ gia hạn 390',
      kind: 'license',
      seatTotal: 5,
      endDate: isoInDays(60),
    });
    const res = await page.request.post(`/api/v1/software/${id}/renew`, {
      headers: await writeHeaders(page),
      data: { endDate: isoInDays(425), contract, cost: 3_000_000 },
    });
    expect(res.status()).toBe(201);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/software/${id}?tab=history`);
    await page.getByRole('button', { name: 'Hạn', exact: true }).click();
    const ledger = page.getByRole('region', { name: 'Sổ gia hạn' });
    await expect(ledger.getByText(new RegExp(`${contract} · 3\\.000\\.000\\s₫`))).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'không cuộn ngang ở 390px').toBeLessThanOrEqual(0);
  });
});
