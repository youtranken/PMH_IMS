import { expect, test } from '@playwright/test';
import { E2E_SA, firstLogin, resetUsers, sql } from './helpers';

test.beforeEach(() => resetUsers());

/**
 * NFR-01 — tab bỏ mở không được tự giữ phiên sống bằng vòng hỏi định kỳ.
 *
 * Đòn: SA mở app trên máy dùng chung rồi đi. Shell hỏi số phiếu chờ duyệt mỗi phút, panel két
 * hỏi `verdict` mỗi 15 giây khi có phiếu treo. Nếu các lượt hỏi đó gia hạn idle thì người ngồi
 * vào máy sau 30 phút vẫn có nguyên quyền SA.
 */

function sessionAgeMinutes(email: string): number {
  return Number(
    sql(
      `SELECT floor(extract(epoch FROM now() - last_seen_at) / 60) FROM sessions ` +
        `WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE email = '${email}') ` +
        `ORDER BY created_at DESC LIMIT 1`,
    ),
  );
}

function ageSession(email: string, minutes: number): void {
  sql(
    `UPDATE sessions SET last_seen_at = now() - interval '${minutes} minutes' ` +
      `WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE email = '${email}')`,
  );
}

test.describe('Phiên idle và vòng hỏi định kỳ', () => {
  test('hỏi số phiếu chờ / verdict không gia hạn phiên; thao tác thật thì có', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    ageSession(E2E_SA.email, 20);

    const count = await page.request.get('/api/v1/vault/break-glass/pending/count');
    expect(count.status()).toBe(200);
    const verdict = await page.request.get(
      '/api/v1/vault/secrets/verdict?ownerType=device&ownerId=00000000-0000-0000-0000-000000000000',
    );
    // Chủ thể không tồn tại vẫn phải qua guard phiên trước; mã nghiệp vụ không quan trọng ở đây.
    expect(verdict.status()).not.toBe(401);
    expect(sessionAgeMinutes(E2E_SA.email)).toBeGreaterThanOrEqual(19);

    // Đối chứng: một lượt đọc người dùng bấm mới gọi thì gia hạn như cũ.
    const pending = await page.request.get('/api/v1/vault/break-glass/pending');
    expect(pending.status()).toBe(200);
    expect(sessionAgeMinutes(E2E_SA.email)).toBeLessThan(2);
  });

  test('dựng lại đòn: tab chỉ còn vòng hỏi thì quá 30 phút vẫn bị đăng xuất', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    ageSession(E2E_SA.email, 29);

    // Phút cuối: vòng hỏi vẫn chạy, nhưng không kéo dài phiên.
    for (let i = 0; i < 3; i += 1) {
      const res = await page.request.get('/api/v1/vault/break-glass/pending/count');
      expect(res.status()).toBe(200);
    }
    expect(sessionAgeMinutes(E2E_SA.email)).toBeGreaterThanOrEqual(28);

    ageSession(E2E_SA.email, 31);
    const expired = await page.request.get('/api/v1/vault/break-glass/pending/count');
    expect(expired.status()).toBe(401);
    expect(await expired.json()).toMatchObject({ code: 'SESSION_EXPIRED' });

    await page.reload();
    await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
  });
});
