import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  isoInDays,
  resetDevices,
  resetUsers,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Nền trạng thái của dòng bảng (dùng chung, `css/table.css`) phải THẮNG sọc dòng chẵn — ở cả
 * chế độ sáng lẫn tối. Hai dòng quá hạn liền nhau thì một dòng rơi vào vị trí chẵn: nếu sọc
 * thắng, dòng đó mất nền đỏ và người dùng tưởng hai nhóm khác nhau.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
});

async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const button = page.getByRole('button', {
    name: theme === 'dark' ? 'Chuyển sang chế độ tối' : 'Chuyển sang chế độ sáng',
  });
  if ((await button.count()) > 0) await button.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

/** Nền của ô đầu trong dòng chứa `code`. */
async function rowBackground(page: Page, code: string): Promise<string> {
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: new RegExp(code) }) });
  await expect(row).toHaveCount(1);
  return row
    .getByRole('cell')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
}

test('hai dòng quá hạn liền nhau cùng giữ nền đỏ, ở cả sáng lẫn tối', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const headers = await writeHeaders(page);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
  const codes = [`PC-E2E-ZEBRA-A-${stamp}`, `PC-E2E-ZEBRA-B-${stamp}`];
  for (const [i, code] of codes.entries()) {
    const res = await page.request.post('/api/v1/devices', {
      headers,
      data: { code, name: 'Máy quá hạn', deviceTypeId: pc.id, warrantyEnd: isoInDays(-5 - i) },
    });
    expect(res.status()).toBe(201);
  }

  await page.goto('/expiry');
  await expect(page.getByRole('heading', { name: 'Sắp hết hạn' })).toBeVisible();

  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    const [a, b] = await Promise.all(codes.map((code) => rowBackground(page, code)));
    expect(a, `[${theme}] dòng quá hạn phải có nền riêng`).not.toBe('rgba(0, 0, 0, 0)');
    expect(b, `[${theme}] hai dòng quá hạn phải cùng một nền, không bị sọc dòng đè`).toBe(a);
  }
});
