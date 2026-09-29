import { expect, request, test } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  fillLogin,
  firstLogin,
  isoToday,
  resetUsers,
  sql,
  uniqueStamp,
} from './helpers';

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

    const today = isoToday();
    const filtered = await page.request.get(
      `/api/v1/admin/audit?actor=${encodeURIComponent(E2E_SA.email)}&from=${today}&to=${today}`,
    );
    expect(filtered.status()).toBe(200);
    const body = (await filtered.json()) as { items: { actor: string }[] };

    /*
     * VẾ KHẲNG ĐỊNH DƯƠNG, THÊM 24/09 — thiếu nó thì bài này XANH VÌ LÝ DO SAI.
     *
     * Bản cũ chỉ có vòng `for (const row of body.items) expect(...)`. Danh sách rỗng thì thân
     * vòng KHÔNG chạy lần nào và bài xanh mà không kiểm gì — đúng hình dạng "cổng khớp đúng
     * số không chuỗi" mà §18 vừa phải dọn mười sáu chỗ.
     *
     * Và nó rỗng thật được: `today` trước đây tính bằng `toISOString()`, tức giờ UTC, nên từ
     * 00:00 đến 07:00 giờ VN bộ lọc đi hỏi NGÀY HÔM QUA. Hai lỗi chồng nhau — một cái làm
     * dữ liệu biến mất, một cái làm chuyện đó không ai thấy.
     *
     * `firstLogin` ngay phía trên vừa ghi ít nhất một dòng đăng nhập của chính actor này
     * trong hôm nay, nên đòi ≥ 1 dòng là đòi một thứ chắc chắn có.
     */
    expect(
      body.items.length,
      'lọc theo actor của chính phiên vừa đăng nhập phải ra ít nhất một dòng — rỗng nghĩa là bộ lọc đang hỏi sai ngày',
    ).toBeGreaterThan(0);
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

/**
 * NFR-03 đòi nhật ký trả lời được "AI làm gì, lúc nào, TỪ ĐÂU". Vế cuối là vế duy nhất chưa
 * bao giờ được trả lời: `audit_log.ip` NULL trên 100% số dòng suốt 9 epic (rà soát 07/09, #3).
 *
 * Cột `ip` có trong `0004_audit_log.sql:8` từ ngày đầu; thứ thiếu là bảng drizzle không khai
 * nó, nên `toRow()` không map và không ai ghi. Không có gì đỏ vì cột NULL là hợp lệ với
 * Postgres, và endpoint đọc cũng không `SELECT` nó nên không ai nhìn thấy khoảng trống.
 *
 * Đây là loại lỗi chỉ E2E mới bắt được: nó không phải sai logic ở một hàm nào, mà là đứt gãy
 * giữa migration ↔ ORM ↔ HTTP. Và vì bảng chỉ-thêm nên nó KHÔNG vá ngược được — mỗi ngày
 * chạy thiếu là thêm một ngày "từ đâu" vĩnh viễn rỗng.
 */
test.describe('Nhật ký kiểm toán — "từ đâu" (NFR-03)', () => {
  /**
   * `203.0.113.0/24` là TEST-NET-3 (RFC 5737): dải dành riêng cho tài liệu, không bao giờ là
   * IP thật của một máy trong LAN. Nếu nó xuất hiện trong nhật ký thì chắc chắn nó tới từ
   * header client tự khai, không từ nơi nào khác.
   */
  const FORGED_IP = '203.0.113.99';

  test('dòng ghi ngoài transaction có IP, và IP đó KHÔNG phải thứ client tự khai', async () => {
    const stamp = uniqueStamp();
    // Email không tồn tại → nhánh `not-found` của `login()`, dùng `append()` (bản NÉM lỗi).
    // Actor là duy nhất nên tìm lại đúng một dòng, không lẫn với dòng của bài khác.
    const ghost = `e2e-ip-${stamp}@pmh.com.vn`;

    const api = await request.newContext({
      baseURL: APP_ORIGIN,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Origin: APP_ORIGIN, 'X-Forwarded-For': FORGED_IP },
    });
    try {
      const res = await api.post('/api/v1/auth/login', {
        data: { email: ghost, password: 'chac-chan-sai-#2026' },
      });
      expect(res.status()).toBe(401);
    } finally {
      await api.dispose();
    }

    const ip = sql(
      `SELECT coalesce(ip, '<NULL>') FROM audit_log WHERE actor = '${ghost}' ` +
        `ORDER BY created_at DESC LIMIT 1`,
    );

    expect(ip, 'phải có một dòng audit cho lượt đăng nhập hỏng này').not.toBe('');
    expect(ip, 'NFR-03: nhật ký phải trả lời được "từ đâu" — cột ip không được NULL').not.toBe(
      '<NULL>',
    );
    /*
     * Vế thứ hai, và là vế quan trọng hơn: nginx dùng `$proxy_add_x_forwarded_for` (NỐI THÊM),
     * nên nếu code đọc phần tử trái nhất của `X-Forwarded-For` thì nó lấy đúng thứ nghi phạm
     * tự điền. Ghi được IP mà là IP giả thì tệ hơn để trống — nó khiến người điều tra đi sai
     * hướng và tin rằng mình có bằng chứng (rà soát 07/09, #1).
     */
    expect(ip, 'IP phải đến từ req.ip (trust proxy), không phải X-Forwarded-For client khai').not.toBe(
      FORGED_IP,
    );
  });

  test('dòng ghi TRONG transaction cũng có IP, và endpoint đọc trả nó ra', async ({ page }) => {
    /*
     * MỐC THỜI GIAN LẤY TRƯỚC KHI ĐĂNG NHẬP — và đây là phần quan trọng nhất của bài.
     *
     * `audit_log` là bảng CHỈ-THÊM, không bao giờ được dọn giữa các lượt chạy (chính bài
     * "chỉ-thêm" phía trên chứng minh `TRUNCATE` bị chặn). Bản đầu của bài này đếm mọi dòng
     * `auth.login.ok` có ip của tài khoản E2E, không giới hạn thời gian — mà lượt chạy đầu
     * tiên đã để lại 133 dòng như vậy. Từ đó trở đi nó XANH VĨNH VIỄN: gỡ sạch phần điền IP
     * rồi chạy lại vẫn xanh, vì 133 dòng cũ đủ thỏa điều kiện (rà soát 08/09, #1).
     *
     * Đúng chế độ hỏng mà đợt A đã dính một lần: bài kiểm không thể đỏ thì nó không phải bài
     * kiểm, chỉ là một dòng chữ trấn an.
     */
    const before = sql(`SELECT now()`);
    await firstLogin(page, E2E_SA);

    /*
     * Đăng nhập thành công ghi `auth.login.ok` / `auth.password.ok` bằng `appendWithin` —
     * đường khác hẳn bài trên. Ngữ cảnh request (`AsyncLocalStorage`) phải sống qua cả
     * `db.transaction`, nếu không thì đúng đường ĐÔNG NHẤT của hệ thống lại là đường mất IP.
     */
    const fresh = sql(
      `SELECT count(*) FROM audit_log WHERE actor = '${E2E_SA.email}' ` +
        `AND action IN ('auth.login.ok','auth.password.ok') ` +
        `AND created_at > '${before}'::timestamptz AND ip IS NOT NULL`,
    );
    expect(
      Number(fresh),
      'dòng audit sinh ra TRONG lượt chạy này phải có ip — ngữ cảnh request phải sống qua transaction',
    ).toBeGreaterThan(0);

    // Và không dòng mới nào được thiếu ip: một dòng câm lẫn giữa các dòng có tiếng vẫn là mất vết.
    const freshNull = sql(
      `SELECT count(*) FROM audit_log WHERE actor = '${E2E_SA.email}' ` +
        `AND created_at > '${before}'::timestamptz AND ip IS NULL`,
    );
    expect(Number(freshNull), 'không dòng nào của lượt chạy này được để trống ip').toBe(0);

    // Và người điều tra phải ĐỌC được nó: ghi vào cột mà `SELECT` không lấy thì vẫn là câm.
    const response = await page.request.get(
      `/api/v1/admin/audit?actor=${encodeURIComponent(E2E_SA.email)}&pageSize=50`,
    );
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { items: { action: string; ip: string | null }[] };
    const login = body.items.find(
      (r) => r.action === 'auth.login.ok' || r.action === 'auth.password.ok',
    );
    expect(login, 'phải có dòng đăng nhập của chính tài khoản vừa dùng').toBeTruthy();
    expect(login?.ip, 'GET /admin/audit phải trả cột ip ra ngoài').toBeTruthy();
  });
});

/**
 * Màn Nhật ký (DOM-07). Thư cảnh báo bảo mật dẫn người đọc tới đây với bộ lọc người thao tác
 * đặt sẵn trên URL, nên "tải lại vẫn giữ bộ lọc" là điều kiện để nút trong thư có nghĩa.
 */
test.describe('Nhật ký kiểm toán — màn hình', () => {
  test('SA mở Nhật ký từ menu, lọc theo người thao tác, tải lại vẫn giữ lọc', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await nav.getByRole('link', { name: 'Nhật ký hệ thống', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Nhật ký hệ thống' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/admin/audit-log');

    const filtered = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/admin/audit?') &&
        new URL(res.url()).searchParams.get('actor') === E2E_SA.email,
    );
    await page.getByRole('searchbox', { name: /người thao tác/ }).fill(E2E_SA.email);
    expect((await filtered).status()).toBe(200);

    // `firstLogin` vừa ghi dòng đăng nhập của chính tài khoản này.
    const loginRow = page.getByText(/^auth\.(login|password)\.ok$/).first();
    await expect(loginRow).toBeVisible();
    expect(new URL(page.url()).searchParams.get('q')).toBe(E2E_SA.email);

    await page.reload();
    await expect(page.getByRole('searchbox', { name: /người thao tác/ })).toHaveValue(E2E_SA.email);
    await expect(page.getByText(/^auth\.(login|password)\.ok$/).first()).toBeVisible();
    await expect(page.getByText(E2E_SA.email).first()).toBeVisible();
  });

  test('ADM-071: chip "Chỉ sự kiện an ninh" chỉ còn dòng thất bại / bị chặn, và lọc chạy ở API', async ({
    page,
  }) => {
    // Một lần gõ sai mật khẩu = một dòng `auth.login.failed` có thật để lọc ra.
    await fillLogin(page, E2E_MEMBER.email, 'mat-khau-sai-E2E');
    await expect(page.getByRole('alert')).toBeVisible();
    await firstLogin(page, E2E_SA);

    await page.goto('/admin/audit-log');
    await expect(page.getByRole('heading', { level: 1, name: 'Nhật ký hệ thống' })).toBeVisible();
    const filtered = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/admin/audit?') &&
        new URL(res.url()).searchParams.get('security') === '1',
    );
    await page.getByRole('button', { name: 'Chỉ sự kiện an ninh' }).click();
    const res = await filtered;
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { items: { action: string }[] };
    // Dòng đăng nhập THÀNH CÔNG vừa ghi của SA không được lọt qua chip.
    expect(body.items.some((row) => row.action.endsWith('.ok'))).toBe(false);
    expect(body.items.some((row) => row.action === 'auth.login.failed')).toBe(true);
    await expect(page.getByRole('button', { name: 'Chỉ sự kiện an ninh' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(new URL(page.url()).searchParams.get('security')).toBe('1');

    // Đường hỏng: giá trị lạ trên tham số không được hiểu thành "tắt lọc" trong im lặng.
    const bad = await page.request.get('/api/v1/admin/audit?security=yes');
    expect(bad.status()).toBe(400);
  });

  test('đường hỏng: Thành viên không thấy mục Nhật ký, gõ thẳng URL nhận trang 403', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);

    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    // Menu đã dựng xong thì vế "không có" bên dưới mới có nghĩa.
    await expect(nav.getByRole('link', { name: 'Thiết bị', exact: true })).toBeVisible();
    await expect(nav.getByText('Nhật ký hệ thống', { exact: true })).toHaveCount(0);

    await page.goto('/admin/audit-log');
    // Trang có thật, chỉ là không dành cho vai này — nói đúng là THIẾU QUYỀN (MISC-001).
    await expect(page.getByRole('heading', { name: 'Bạn không có quyền xem trang này' })).toBeVisible();
  });
});

/**
 * ADM-065: sự kiện giống hệt lặp liền nhau (cùng người, cùng hành động, cùng đối tượng, cùng
 * phút) gộp thành một dòng ×N ở API; hộp chi tiết mở được từng lần; bỏ tick thì về từng dòng.
 */
test.describe('Nhật ký — gộp sự kiện lặp', () => {
  test('xuất danh mục 3 lần liền → một dòng ×N; mở từng lần; bỏ gộp thì thấy đủ từng dòng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    for (let i = 0; i < 3; i += 1) {
      const res = await page.request.get('/api/v1/catalog/site/export');
      expect(res.status()).toBe(200);
    }
    const grouped = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/admin/audit?') &&
        new URL(res.url()).searchParams.get('group') === '1' &&
        new URL(res.url()).searchParams.get('action') === 'catalog.exported',
    );
    await page.goto(
      `/admin/audit-log?q=${encodeURIComponent(E2E_SA.email)}&action=catalog.exported`,
    );
    expect((await grouped).status()).toBe(200);
    await expect(page.getByRole('checkbox', { name: 'Gộp sự kiện lặp' })).toBeChecked();
    await expect(page.getByText(/^\d+ lần liền nhau$/).first()).toBeVisible();

    // Ba lần trong tối đa hai phút liền → chắc chắn có một cụm ≥ 2 (ranh giới phút có thể tách 2 + 1).
    await page
      .getByRole('row')
      .filter({ hasText: /lần liền nhau/ })
      .first()
      .getByRole('button', { name: /Xem chi tiết dòng nhật ký lúc/ })
      .click();
    const hop = page.getByRole('dialog');
    await expect(hop.getByText(/lần liền nhau — cùng người/)).toBeVisible();
    const lan = hop.getByRole('button', { name: /^Xem lần lúc/ });
    expect(await lan.count()).toBeGreaterThanOrEqual(2);
    await lan.last().click();
    await expect(hop.getByText(/lần liền nhau — cùng người/)).toHaveCount(0);
    await hop.getByRole('button', { name: 'Đóng', exact: true }).click();

    // Đường còn lại: bỏ gộp → API không nhận `group`, màn có ít nhất 3 dòng xuất danh mục.
    const each = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/admin/audit?') &&
        new URL(res.url()).searchParams.get('group') === null,
    );
    // Ô tick đọc trạng thái từ URL: lượt ghi URL đi qua react-router nên DOM đổi SAU cú bấm một
    // nhịp — `uncheck()` đo ngay sau cú bấm nên đỏ chập chờn. Bấm rồi CHỜ trạng thái mới.
    const gop = page.getByRole('checkbox', { name: 'Gộp sự kiện lặp' });
    await gop.click();
    await expect(gop).not.toBeChecked();
    expect((await each).status()).toBe(200);
    await expect(page).toHaveURL(/each=1/);
    expect(
      await page.getByRole('button', { name: /Xem chi tiết dòng nhật ký lúc/ }).count(),
    ).toBeGreaterThanOrEqual(3);
  });

  test('đường hỏng: tham số gộp sai giá trị bị từ chối (400), không rơi về mặc định im lặng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const res = await page.request.get('/api/v1/admin/audit?page=1&pageSize=20&group=yes');
    expect(res.status()).toBe(400);
  });
});
