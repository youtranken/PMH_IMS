import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetDevices, resetIpam, resetUsers } from './helpers';

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
  const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
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

/** Story 5.2 — FR-019: vòng đời IP, lịch sử append-only giữ vĩnh viễn. */
test.describe('Vòng đời IP', () => {
  /**
   * Kịch bản của chính AC: máy in kế toán chết → nghi chết → thu hồi → cấp lại cho máy khác,
   * và sáu tháng sau vẫn tra được "IP này từng là máy in kế toán".
   */
  test('đường hạnh phúc: nghi chết → thu hồi → cấp lại cho máy khác, lịch sử cũ vẫn còn', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { subnetId, address } = await setUp(page, stamp);

    await page.goto(`/ip-addresses/${subnetId}`);
    const row = page.getByRole('row', { name: new RegExp(address.replace(/\./g, '\\.')) });
    await expect(row.getByText('Đang cấp')).toBeVisible();

    // Đang cấp: chỉ hai đường đi tiếp, KHÔNG có "Cấp lại".
    await expect(row.getByRole('button', { name: 'Nghi chết' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Thu hồi' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Cấp lại' })).toHaveCount(0);

    await row.getByRole('button', { name: 'Nghi chết' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
    await expect(
      page.getByRole('row', { name: new RegExp(address.replace(/\./g, '\\.')) }).getByText('Nghi chết'),
    ).toBeVisible();

    // Nghi chết vẫn CHIẾM chỗ — chưa xác nhận chết thì chưa cấp cho người khác được.
    await expect(page.getByText('17% · 1/6 · còn 5')).toBeVisible();

    await page
      .getByRole('row', { name: new RegExp(address.replace(/\./g, '\\.')) })
      .getByRole('button', { name: 'Thu hồi' })
      .click();
    const reclaim = page.getByRole('dialog');
    await reclaim.getByRole('textbox', { name: 'Lý do' }).fill('máy đã thanh lý');
    await reclaim.getByRole('button', { name: 'Xác nhận' }).click();

    // Thu hồi TRẢ CHỖ về pool: mức sử dụng phải giảm, không phải chỉ tăng mãi.
    await expect(page.getByText('0% · 0/6 · còn 6')).toBeVisible();
    const afterReclaim = page.getByRole('row', {
      name: new RegExp(address.replace(/\./g, '\\.')),
    });
    await expect(afterReclaim.getByText('Đã thu hồi')).toBeVisible();
    // Chủ cũ đã biến khỏi hồ sơ — chỉ lịch sử còn giữ.
    await expect(afterReclaim.getByText('Máy in kế toán')).toHaveCount(0);

    await afterReclaim.getByRole('button', { name: 'Cấp lại' }).click();
    const reassign = page.getByRole('dialog');
    await reassign.getByRole('combobox', { name: 'Người / bộ phận dùng' }).fill('Anh Hùng — Kho');
    await reassign.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.getByText('Anh Hùng — Kho')).toBeVisible();
    await expect(page.getByText('17% · 1/6 · còn 5')).toBeVisible();

    // AC: lịch sử giữ VĨNH VIỄN — mở ra vẫn đọc được IP này từng là máy in kế toán.
    await page
      .getByRole('row', { name: new RegExp(address.replace(/\./g, '\\.')) })
      .getByRole('button', { name: 'Lịch sử' })
      .click();
    const history = page.getByRole('dialog');
    await expect(history.getByText('trước đó: Máy in kế toán')).toBeVisible();
    await expect(history.getByText('lý do: máy đã thanh lý')).toBeVisible();
    await expect(history.getByText('Đang cấp → Nghi chết')).toBeVisible();
    await expect(history.getByText('Đã thu hồi → Đang cấp')).toBeVisible();
  });

  /**
   * AC 5.2: "chuyển trạng thái sai luồng bị từ chối". Kiểm ở API vì đó mới là nơi phán —
   * UI chỉ ẩn nút, mà ẩn nút không phải là một hàng rào.
   */
  test('đường hỏng: bước chuyển sai luồng bị từ chối kèm lời chỉ đường', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { ipId, headers } = await setUp(page, stamp);

    // Đang cấp → Trống: không có đường đó (trả chỗ về pool là "thu hồi").
    const wrong = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers,
      data: { to: 'free' },
    });
    expect(wrong.status()).toBe(400);
    const body = (await wrong.json()) as { code: string; message: string };
    expect(body.code).toBe('IP_TRANSITION_INVALID');
    // Lỗi phải CHỈ ĐƯỜNG, không chỉ nói "không hợp lệ".
    expect(body.message).toContain('Thu hồi');
    expect(body.message).toContain('Đánh dấu nghi chết');

    // Đứng yên cũng không phải một bước chuyển.
    const same = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers,
      data: { to: 'assigned' },
    });
    expect(same.status()).toBe(400);
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
      data: { status: 'reclaimed' },
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
      data: { to: 'reclaimed', reason: 'thử append-only' },
    });

    const { execSync } = await import('node:child_process');
    const { COMPOSE } = await import('./helpers');
    for (const sql of [
      `UPDATE ip_history SET actor = 'ke-gian' WHERE ip_address_id = '${ipId}'`,
      `DELETE FROM ip_history WHERE ip_address_id = '${ipId}'`,
    ]) {
      let blocked = false;
      try {
        execSync(`${COMPOSE} exec -T postgres psql -U ims -d ims -v ON_ERROR_STOP=1 -c "${sql}"`, {
          cwd: '..',
          stdio: 'pipe',
        });
      } catch {
        blocked = true;
      }
      expect(blocked, `phải bị chặn: ${sql}`).toBe(true);
    }
  });
});
