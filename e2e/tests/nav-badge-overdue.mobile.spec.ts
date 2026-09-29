import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  isoInDays,
  openNavDrawer,
  resetSoftware,
  resetUsers,
  sql,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * SHELL-009 — mục "Sắp hết hạn" trên menu mang số mục ĐÃ quá hạn, ở 390px (drawer) và cả
 * hai chế độ màu. Và con số ấy được hỏi định kỳ ở MỌI màn, nên lượt hỏi không được gia hạn
 * idle của phiên (NFR-01): tab bỏ quên ở máy dùng chung vẫn phải hết phiên sau 30 phút.
 */

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
});

async function overdueCount(page: Page): Promise<number> {
  const res = await page.request.get('/api/v1/expiry/overdue/count');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { count: number }).count;
}

function idleSeconds(email: string): number {
  return Number(
    sql(
      `SELECT EXTRACT(EPOCH FROM now() - last_seen_at)::int FROM sessions ` +
        `WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE email = '${email}') ` +
        `ORDER BY last_seen_at DESC LIMIT 1`,
    ),
  );
}

test('có mục quá hạn → badge số trên mục Sắp hết hạn, đọc được trong drawer, sáng và tối', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const created = await page.request.post('/api/v1/software', {
    headers: await writeHeaders(page),
    data: {
      code: `SSL-E2E-QH-${stamp}`,
      name: 'Chứng chỉ quá hạn E2E',
      kind: 'ssl',
      endDate: isoInDays(-3),
    },
  });
  expect(created.status()).toBe(201);
  const count = await overdueCount(page);
  expect(count).toBeGreaterThan(0);

  await page.goto('/');
  await openNavDrawer(page);
  const link = page
    .getByRole('navigation', { name: 'Điều hướng chính' })
    .getByRole('link', { name: 'Sắp hết hạn' });
  // Tên link giữ nguyên; số đi qua mô tả trợ năng.
  await expect(link).toHaveAccessibleDescription(`${count} mục đã quá hạn`);
  await expect(link.getByText(String(count), { exact: true })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /chế độ tối/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openNavDrawer(page);
  await expect(link.getByText(String(count), { exact: true })).toBeVisible();
});

test('hỏi số quá hạn KHÔNG gia hạn idle của phiên; một lượt đọc thường thì có (đối chứng)', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  // Rời app: vòng hỏi nền của chính trang (menu, `me`) không được chen vào phép đo.
  await page.goto('about:blank');
  const push = () =>
    sql(
      `UPDATE sessions SET last_seen_at = now() - interval '10 minutes' WHERE revoked_at IS NULL ` +
        `AND user_id = (SELECT id FROM users WHERE email = '${E2E_SA.email}')`,
    );

  push();
  await overdueCount(page);
  expect(idleSeconds(E2E_SA.email), 'lượt hỏi badge đã làm phiên trẻ lại').toBeGreaterThan(9 * 60);

  // Đối chứng: một lượt đọc bình thường vẫn gia hạn — bài trên không xanh vì touch hỏng hẳn.
  push();
  expect((await page.request.get('/api/v1/expiry/thresholds')).status()).toBe(200);
  await expect.poll(() => idleSeconds(E2E_SA.email)).toBeLessThan(60);
});
