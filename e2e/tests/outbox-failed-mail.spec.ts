import { expect, test } from '@playwright/test';
import { E2E_MEMBER, E2E_SA, firstLogin, resetUsers, sql, uniqueStamp, writeHeaders } from './helpers';

test.beforeEach(() => {
  resetUsers();
});

/**
 * Thư gửi lỗi (Q-25): thư hết lượt gửi tự động trước nay nằm im trong outbox. SA thấy số trên menu,
 * thấy thư (lỗi đã che địa chỉ người nhận) và "Gửi lại" được — mỗi lần gửi lại là một dòng nhật ký.
 *
 * Hàng thử dựng thẳng bằng SQL (không có đường nào khác làm SMTP hỏng đúng lúc): topic lạ có chữ
 * e2e để relay/consumer không gửi thư thật, `fail_count` trên trần để relay không đụng tới trước
 * lúc bấm; cuối bài xoá đúng hàng đó.
 */
test.describe('Thư gửi lỗi', () => {
  test('SA: badge trên menu → màn Thư gửi lỗi → lỗi che địa chỉ → Gửi lại → thư rời danh sách, có nhật ký', async ({ page }) => {
    const stamp = uniqueStamp();
    const topic = `e2e.failed-mail.${stamp}`.toLowerCase();
    const id = sql(
      `INSERT INTO outbox (topic, payload, fail_count, last_error, last_failed_at) VALUES ('${topic}', '{}'::jsonb, 99, 'E2E 550 <e2e.nguoinhan${stamp}@pmh.com.vn> unknown', now()) RETURNING id`,
    ).split('\n')[0];
    try {
      await firstLogin(page, E2E_SA);
      const group = page.getByRole('button', { name: 'Hệ thống', exact: true });
      if ((await group.getAttribute('aria-expanded')) === 'false') {
        await expect(group.locator('.nav-badge')).toBeVisible();
        await group.click();
      }
      const item = page.getByRole('link', { name: 'Thư gửi lỗi' });
      await expect(item.locator('.nav-badge')).toBeVisible();
      await item.click();
      await expect(page.getByRole('heading', { level: 1, name: 'Thư gửi lỗi' })).toBeVisible();

      const row = page.getByRole('row').filter({ hasText: topic });
      await expect(row).toContainText('99');
      await expect(row).toContainText('<e***@pmh.com.vn>');
      await expect(page.getByText(`e2e.nguoinhan${stamp}`)).toHaveCount(0);

      await row.getByRole('button', { name: `Gửi lại ${topic}` }).click();
      await expect(page.getByText('Đã đưa thư vào hàng gửi lại.')).toBeVisible();
      await expect(page.getByRole('row').filter({ hasText: topic })).toHaveCount(0);
      expect(sql(`SELECT count(*) FROM audit_log WHERE action = 'outbox.requeued' AND object_id = '${id}' AND actor = '${E2E_SA.email}'`)).toBe('1');

      // Thư đã gửi xong thì không gửi lại được nữa — gửi lại là gửi đúp một thư đã tới nơi.
      sql(`UPDATE outbox SET processed_at = now() WHERE id = '${id}'`);
      const again = await page.request.post(`/api/v1/admin/outbox/failed/${id}/requeue`, { headers: await writeHeaders(page) });
      expect(again.status()).toBe(404);
    } finally {
      sql(`DELETE FROM outbox WHERE id = '${id}'`);
    }
  });

  test('đường hỏng: Thành viên không thấy mục, API trả 403 cả đọc lẫn gửi lại', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    await expect(page.getByRole('link', { name: 'Thư gửi lỗi' })).toHaveCount(0);
    expect((await page.request.get('/api/v1/admin/outbox/failed')).status()).toBe(403);
    const post = await page.request.post('/api/v1/admin/outbox/failed/00000000-0000-4000-8000-000000000000/requeue', { headers: await writeHeaders(page) });
    expect(post.status()).toBe(403);
    await page.goto('/admin/failed-mail');
    await expect(page.getByRole('heading', { level: 1, name: 'Thư gửi lỗi' })).toHaveCount(0);
  });
});
