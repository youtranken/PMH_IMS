import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  isoInDays,
  resetSoftware,
  resetUsers,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * EX-008 — gia hạn ở màn Sắp hết hạn thì toast chỉ đường sang tab "Đã gia hạn"; tab đó lọc
 * được theo khoảng ngày (API lọc) và nói người gia hạn bằng họ tên.
 */
test.use({ viewport: { width: 1280, height: 800 } });

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
});

test('gia hạn → toast "Xem trong Đã gia hạn" mở đúng tab, dòng vừa gia hạn có họ tên người làm', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  const code = `SSL-E2E-DAGH-${uniqueStamp()}`;
  const created = await page.request.post('/api/v1/software', {
    headers: await writeHeaders(page),
    data: { code, name: 'SSL đã gia hạn', kind: 'ssl', endDate: isoInDays(3) },
  });
  expect(created.status()).toBe(201);

  await page.goto('/expiry');
  const row = page.getByRole('row', { name: new RegExp(code) });
  await row.getByRole('button', { name: 'Gia hạn' }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(code) });
  await dialog.getByRole('button', { name: '+1 năm', exact: true }).click();
  const renewed = page.waitForResponse((r) => r.url().includes('/renew'));
  await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
  expect((await renewed).status()).toBeLessThan(300);

  await page.getByRole('button', { name: 'Xem trong Đã gia hạn' }).click();
  await expect(page.getByRole('tab', { name: 'Đã gia hạn' })).toHaveAttribute('aria-selected', 'true');
  const renewedRow = page.getByRole('row', { name: new RegExp(code) });
  await expect(renewedRow).toBeVisible();
  await expect(renewedRow.getByText('E2E Super Admin')).toBeVisible();
});

test('khoảng ngày lọc ở API; ngày sai dạng hay "đến" trước "từ" bị chặn 400', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const old = await page.request.get('/api/v1/expiry/renewals?from=2000-01-01&to=2000-01-02');
  expect(old.status()).toBe(200);
  expect(await old.json()).toEqual([]);
  expect((await page.request.get('/api/v1/expiry/renewals?from=01-01-2000')).status()).toBe(400);
  expect(
    (await page.request.get('/api/v1/expiry/renewals?from=2026-09-10&to=2026-09-01')).status(),
  ).toBe(400);
});
