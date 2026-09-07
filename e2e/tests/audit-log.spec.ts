import { expect, test } from '@playwright/test';
import { E2E_MEMBER, E2E_SA, firstLogin, resetUsers } from './helpers';

test.beforeEach(() => resetUsers());

/**
 * Nhật ký kiểm toán (Story 6.2, FR-43, NFR-03).
 *
 * VÌ SAO BÀI NÀY TỒN TẠI: `GET /admin/audit` chạy raw SQL và đã sống 9 epic với một câu
 * `LEFT JOIN users u ON u.sub = a.actor` — bảng `users` KHÔNG có cột `sub` (mảnh sót của bản
 * QLTS mà AD-12 dặn phải grep bỏ). Endpoint ném 42703 mọi lần gọi. Không có gì đỏ vì:
 *   - raw SQL nên `npm run build` và TypeScript không thấy;
 *   - màn web còn `planned: true` trong sidebar nên chưa ai bấm vào;
 *   - và không có một dòng test nào chạm endpoint này.
 * Nó chỉ lộ ra đúng lúc Story 6.2 dựng màn — tức là lúc tốn kém nhất.
 *
 * Bài kiểm chạm DB THẬT, nên nó bắt được cả lớp lỗi "SQL tham chiếu cột không tồn tại" mà
 * không lớp nào ở trên bắt được.
 */
test.describe('Nhật ký kiểm toán — API', () => {
  test('SA đọc được nhật ký, và mỗi dòng có đủ trường (đường hạnh phúc)', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    const response = await page.request.get('/api/v1/admin/audit?page=1&pageSize=20');
    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      items: {
        id: string;
        actor: string;
        actorName: string | null;
        action: string;
        createdAt: string;
      }[];
      total: number;
      page: number;
      pageSize: number;
    };

    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
    // Chính lần đăng nhập ở trên đã đẻ ra ít nhất một dòng.
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.length).toBeGreaterThan(0);

    const row = body.items[0];
    expect(row.id).toBeTruthy();
    expect(row.action).toBeTruthy();
    expect(row.createdAt).toBeTruthy();

    // `actor` là EMAIL — đây là điều kiện để join sang `users` chạy đúng.
    expect(row.actor).toContain('@');

    // Join phải THẬT SỰ khớp: dòng của tài khoản E2E phải có tên người, không phải null.
    const mine = body.items.find((r) => r.actor === E2E_SA.email);
    expect(mine, 'nhật ký phải có dòng của chính tài khoản vừa đăng nhập').toBeTruthy();
    expect(mine?.actorName, 'LEFT JOIN users phải khớp theo email, không phải cột `sub`').toBeTruthy();
  });

  test('lọc theo actor và theo khoảng ngày chạy được, không ném 500', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    const today = new Date().toISOString().slice(0, 10);
    const filtered = await page.request.get(
      `/api/v1/admin/audit?actor=${encodeURIComponent(E2E_SA.email)}&from=${today}&to=${today}`,
    );
    expect(filtered.status()).toBe(200);
    const body = (await filtered.json()) as { items: { actor: string }[] };
    for (const row of body.items) expect(row.actor).toContain(E2E_SA.email);

    const actions = await page.request.get('/api/v1/admin/audit/actions');
    expect(actions.status()).toBe(200);
    expect(Array.isArray(await actions.json())).toBe(true);

    // Khoảng ngày ngược phải là 400 (lỗi người dùng), không phải 500.
    const badRange = await page.request.get('/api/v1/admin/audit?from=2026-08-10&to=2026-08-01');
    expect(badRange.status()).toBe(400);
  });

  test('đường hỏng: member không đọc được nhật ký kiểm toán', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);
    const forbidden = await page.request.get('/api/v1/admin/audit');
    expect(forbidden.status()).toBe(403);
  });

  /**
   * `audit_log` phải CHỈ-THÊM ở tầng DB (NFR-03) — kể cả khi kết nối bằng superuser.
   *
   * Trước 28/08 không có bài nào kiểm điều này cho `audit_log`; chỉ `ip_history` được kiểm.
   * Và hàng rào thật sự có một lỗ: trigger `FOR EACH ROW` KHÔNG chạy khi TRUNCATE, còn câu
   * `REVOKE ... FROM current_user` là no-op vì app nối bằng chính owner/superuser. Nghĩa là
   * `TRUNCATE audit_log` xóa sạch được nhật ký an ninh. Migration 0039 bịt bằng trigger cấp
   * câu lệnh; bài này là thứ giữ cho nó không bị gỡ ra.
   */
  test('audit_log là chỉ-thêm: UPDATE, DELETE và TRUNCATE đều bị DB từ chối', async () => {
    const { execSync } = await import('node:child_process');
    const { COMPOSE } = await import('./helpers');

    /*
     * KHÔNG dùng `catch { blocked = true }` trần.
     *
     * Bản trước làm thế, và `catch` rỗng nuốt MỌI nguyên nhân: docker chưa chạy, sai tên
     * container, máy không có `psql`, gõ sai tên bảng, mất mạng — tất cả đều thành "đã bị
     * chặn". Bài này là thứ DUY NHẤT giữ migration 0039 khỏi bị gỡ ra, và nó xanh cả khi
     * Postgres không tồn tại (rà soát 07/09). Nên phải soi `stderr` để biết nó bị chặn ĐÚNG
     * bởi hàng rào của mình, chứ không phải bởi một sự cố nào khác.
     */
    const guardSignals = /chỉ-thêm|append_only|no_truncate|no_delete|no_update|permission denied/i;

    for (const sql of [
      "UPDATE audit_log SET actor = 'ke-gian' WHERE true",
      'DELETE FROM audit_log WHERE true',
      'TRUNCATE audit_log',
    ]) {
      let stderr: string | null = null;
      try {
        execSync(`${COMPOSE} exec -T postgres psql -U ims -d ims -v ON_ERROR_STOP=1 -c "${sql}"`, {
          cwd: '..',
          stdio: 'pipe',
        });
      } catch (error) {
        const err = error as { stderr?: Buffer | string; stdout?: Buffer | string };
        stderr = `${err.stderr?.toString() ?? ''}${err.stdout?.toString() ?? ''}`;
      }

      expect(stderr, `phải bị chặn: ${sql}`).not.toBeNull();
      expect(
        stderr,
        `phải bị chặn bởi HÀNG RÀO append-only, không phải bởi sự cố hạ tầng. ` +
          `Câu: ${sql}\nstderr:\n${stderr}`,
      ).toMatch(guardSignals);
    }
  });
});
