import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  resetDevices,
  resetIpam,
  resetUsers,
  rowAction,
  rowActionNames,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetIpam();
  resetDevices();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function setUp(
  page: Page,
  stamp: string,
): Promise<{ subnetId: string; ipId: string; address: string; headers: Record<string, string> }> {
  const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
  const octet = Number(stamp) % 200;
  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { cidr: `172.16.${octet}.0/29`, name: `LAN vòng đời E2E ${stamp}` },
  });
  const subnetId = ((await subnet.json()) as { id: string }).id;
  const address = `172.16.${octet}.1`;
  const ip = await page.request.post('/api/v1/ipam/addresses', {
    headers,
    data: { subnetId, address, usedBy: 'Máy in kế toán' },
  });
  expect(ip.status()).toBe(201);
  return { subnetId, ipId: ((await ip.json()) as { id: string }).id, address, headers };
}

/** Story 5.2 — FR-019, Q-02: vòng đời IP hai trạng thái, lịch sử append-only giữ vĩnh viễn. */
test.describe('Vòng đời IP', () => {
  /**
   * Kịch bản của chính AC: máy in kế toán chết → thu hồi → cấp cho máy khác, và sáu tháng
   * sau vẫn tra được "IP này từng là máy in kế toán".
   */
  test('đường hạnh phúc: thu hồi về Trống → cấp cho máy khác, lịch sử cũ vẫn còn', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { subnetId, address } = await setUp(page, stamp);

    await page.goto(`/ip-addresses/${subnetId}`);
    const row = page.getByRole('row', { name: new RegExp(address.replace(/\./g, '\\.')) });
    await expect(row.getByText('Đang dùng')).toBeVisible();

    // Chỉ còn hai trạng thái (Q-02): đang cấp thì đường đi tiếp duy nhất là Thu hồi.
    // Cột thao tác là menu ba chấm — mục chỉ có trong DOM khi menu đang mở.
    const whenAssigned = await rowActionNames(page, address);
    expect(whenAssigned).toContain('Thu hồi');
    expect(whenAssigned).not.toContain('Nghi chết');
    expect(whenAssigned).not.toContain('Cấp IP');

    await rowAction(page, address, 'Thu hồi');
    const reclaim = page.getByRole('dialog');
    await reclaim.getByRole('textbox', { name: 'Lý do' }).fill('máy đã thanh lý');
    await reclaim.getByRole('button', { name: 'Xác nhận' }).click();

    // Thu hồi TRẢ CHỖ về pool: mức sử dụng phải giảm, và hàng về đúng trạng thái Trống.
    await expect(page.getByText('0% · 0/6 · còn 6')).toBeVisible();
    await expect(row.getByText('Trống', { exact: true })).toBeVisible();
    await expect(row.getByText('Đã thu hồi')).toHaveCount(0);
    // Chủ cũ đã biến khỏi hồ sơ — chỉ lịch sử còn giữ.
    await expect(row.getByText('Máy in kế toán')).toHaveCount(0);

    const whenFree = await rowActionNames(page, address);
    expect(whenFree).not.toContain('Thu hồi');

    // Hồ sơ Trống cấp lại bằng CÙNG nút/hộp "Cấp IP" như một ô trống (NET-002).
    await row.getByRole('button', { name: 'Cấp IP', exact: true }).click();
    const assign = page.getByRole('dialog');
    await assign.getByRole('combobox', { name: 'Người / bộ phận dùng' }).fill('Anh Hùng — Kho');
    await assign.getByRole('button', { name: 'Cấp IP', exact: true }).click();
    await expect(row.getByText('Anh Hùng — Kho')).toBeVisible();
    await expect(page.getByText('17% · 1/6 · còn 5')).toBeVisible();

    // AC: lịch sử giữ VĨNH VIỄN — mở ra vẫn đọc được IP này từng là máy in kế toán.
    await rowAction(page, address, 'Lịch sử');
    const history = page.getByRole('dialog');
    await expect(history.getByText('trước đó: Máy in kế toán')).toBeVisible();
    await expect(history.getByText('lý do: máy đã thanh lý')).toBeVisible();
    await expect(history.getByText('Đang dùng → Trống')).toBeVisible();
    await expect(history.getByText('Trống → Đang dùng')).toBeVisible();
  });

  /**
   * AC 5.2: "chuyển trạng thái sai luồng bị từ chối". Kiểm ở API vì đó mới là nơi phán —
   * UI chỉ ẩn nút, mà ẩn nút không phải là một hàng rào.
   */
  test('đường hỏng: bước chuyển sai luồng bị từ chối kèm lời chỉ đường', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { ipId, headers } = await setUp(page, stamp);

    // Đứng yên không phải một bước chuyển — lỗi phải CHỈ ĐƯỜNG, không chỉ nói "không hợp lệ".
    const same = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers,
      data: { to: 'assigned' },
    });
    expect(same.status()).toBe(400);
    const body = (await same.json()) as { code: string; message: string };
    expect(body.code).toBe('IP_TRANSITION_INVALID');
    expect(body.message).toContain('Thu hồi');

    // Hai trạng thái đã bỏ (Q-02) không còn là đích hợp lệ.
    for (const to of ['suspect_dead', 'reclaimed']) {
      const gone = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
        headers,
        data: { to },
      });
      expect(gone.status(), `đích "${to}" phải bị từ chối`).toBe(400);
    }
  });

  /**
   * AC 5.2: "không UPDATE status tự do". Nếu còn một đường sửa thẳng thì cái máy trạng thái
   * chỉ còn là gợi ý, và sáu tháng sau sẽ có dữ liệu đi vào bằng cửa đó.
   */
  test('đường hỏng: sửa thẳng status qua form bị chặn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { ipId, headers } = await setUp(page, stamp);

    const res = await page.request.patch(`/api/v1/ipam/addresses/${ipId}`, {
      headers,
      data: { status: 'free' },
    });
    expect([400, 403]).toContain(res.status());
  });

  /** AD-13: `ip_history` là append-only — chặn ở tầng DB, không phải bằng lời hứa. */
  test('lịch sử IP không sửa và không xóa được, kể cả bằng SQL', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { ipId, headers } = await setUp(page, stamp);
    await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers,
      data: { to: 'free', reason: 'thử append-only' },
    });

    const { execSync } = await import('node:child_process');
    const { COMPOSE } = await import('./helpers');
    for (const sql of [
      `UPDATE ip_history SET actor = 'ke-gian' WHERE ip_address_id = '${ipId}'`,
      `DELETE FROM ip_history WHERE ip_address_id = '${ipId}'`,
    ]) {
      // Soi `stderr` chứ không chỉ "có ném hay không": `catch` rỗng nuốt cả docker chưa chạy,
      // sai tên container, gõ sai tên bảng — và bài kiểm hàng rào AD-13 sẽ xanh trong khi
      // không có hàng rào nào được chạm tới. Cùng lý do với `audit-log.spec.ts` (rà soát 07/09).
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
      ).toMatch(/chỉ-thêm|append_only|no_truncate|no_delete|no_update|permission denied/i);
    }
  });
});
