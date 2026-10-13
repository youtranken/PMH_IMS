import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetApprovals, resetIso, resetUsers, uniqueStamp, writeHeaders } from './helpers';

/**
 * Phiếu ISO ở 390px (UX-DR2): danh sách 0206 và màn Kỳ phiếu là màn ĐỌC, phải dùng được trên điện
 * thoại. Lưới tick, form phiếu và màn Xem lại chỉ cần desktop nên không kiểm ở đây.
 */
test.beforeEach(() => {
  resetUsers();
  resetApprovals();
  resetIso();
});

async function api(page: Page, method: string, url: string, data?: unknown) {
  return page.request.fetch(url, { method, headers: await writeHeaders(page), data });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('Phiếu ISO · 390px', () => {
  test('danh sách 0206: thẻ phiếu và ô ✗ chưa có phiếu đọc được, không tràn ngang', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const job = await (
      await api(page, 'POST', '/api/v1/iso/catalog/jobs', {
        no: 950,
        name: `E2E-MB-${stamp}`,
        trackedFrom: '2021-01-01',
        lines: [{ label: null, pointsNas: null, storageNas: null, pointsCloud: null, storageCloud: null }],
      })
    ).json();
    await api(page, 'PUT', '/api/v1/iso/backup/ticks', { lineId: job.lines[0].id, day: '2021-08-03', result: 'fail' });
    await api(page, 'PUT', '/api/v1/iso/backup/ticks', { lineId: job.lines[0].id, day: '2021-08-04', result: 'fail' });
    const saved = await api(page, 'POST', '/api/v1/iso/incidents', {
      reportedOn: '2021-08-03',
      kind: 'server',
      detectedAt: '2021-08-03T01:00:00.000Z',
      resolvedAt: '2021-08-03T03:00:00.000Z',
      severity: 'low',
      status: 'resolved',
      description: 'E2E máy chủ treo',
      correctiveAction: 'Khởi động lại',
      backupDetails: [],
      cells: [{ form: '0203', lineId: job.lines[0].id, day: '2021-08-03' }],
    });
    expect(saved.status()).toBe(201);

    await page.goto('/iso/incidents?year=2021');
    await expect(page.getByRole('heading', { name: 'Sự cố · 0206' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ô ✗ chưa có phiếu 0206' }).getByText(`E2E-MB-${stamp}`)).toBeVisible();
    await expect(page.getByRole('link', { name: /0206-2021-\d{3}/ }).first()).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('Kỳ phiếu: bảng tháng và chi tiết kỳ đọc được, không tràn ngang', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/iso/periods?year=2021&month=2021-09');
    await expect(page.getByRole('heading', { name: 'Kỳ phiếu & chốt kỳ' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Năm 2021' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Kỳ 09/2021' })).toBeVisible();
    await expect(page.getByRole('article', { name: '0203 · Backup' }).getByText('Đang ghi').first()).toBeVisible();
    await noHorizontalScroll(page);
  });
});
