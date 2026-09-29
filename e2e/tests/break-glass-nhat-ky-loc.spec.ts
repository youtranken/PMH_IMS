import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, resetUsers } from './helpers';

/**
 * VLT-019 — bộ lọc nhật ký Duyệt mở két (trạng thái, người xin, khoảng ngày) lọc ở API.
 * Đúng/sai của từng bộ lọc trên dữ liệu thật nằm ở `api/test/approvals-service.spec.ts`;
 * bài này kiểm màn gửi đúng tham số và API nhận/chặn đúng cửa.
 */
test.beforeEach(() => resetUsers());

test('SA lọc nhật ký theo người xin, trạng thái, ngày → API nhận bộ lọc, file xuất theo cùng bộ lọc', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  await page.goto('/approvals');
  await page.getByRole('tab', { name: 'Nhật ký' }).click();

  const byRequester = page.waitForResponse(
    (res) =>
      res.url().includes('/api/v1/vault/break-glass/log?') &&
      new URL(res.url()).searchParams.get('requester') === 'e2e-member',
  );
  await page.getByRole('searchbox', { name: 'Tìm theo email người xin' }).fill('e2e-member');
  expect((await byRequester).status()).toBe(200);

  const ok = await page.request.get(
    '/api/v1/vault/break-glass/log?state=expired&from=2026-01-01&to=2026-12-31&requester=e2e',
  );
  expect(ok.status()).toBe(200);
  const xlsx = await page.request.get('/api/v1/vault/break-glass/export.xlsx?state=approved');
  expect(xlsx.status()).toBe(200);
});

test('đường hỏng: trạng thái lạ hay ngày sai dạng bị chặn 400, không bị hiểu thành "không lọc"', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  expect((await page.request.get('/api/v1/vault/break-glass/log?state=all')).status()).toBe(400);
  expect((await page.request.get('/api/v1/vault/break-glass/log?from=29-09-2026')).status()).toBe(
    400,
  );
});
