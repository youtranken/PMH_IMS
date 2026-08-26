import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  logout,
  resetAccessList,
  resetDevices,
  resetSecrets,
  resetSoftware,
  resetUsers,
} from './helpers';

/**
 * Đợt 3 UI, phần két sắt:
 *  - `/vault` là CỬA VÀO (tìm hồ sơ → mở thẳng tab Két sắt), KHÔNG phải danh sách secret —
 *    FR-026 cấm mọi đường lấy secret qua nhiều chủ thể.
 *  - Ma trận quyền có chiều nhìn thứ hai: theo NHÓM ĐỐI TƯỢNG, để trả lời được "nhóm này ai
 *    đang xem được".
 */
test.beforeEach(() => {
  resetUsers();
  resetAccessList();
  resetDevices();
  resetSoftware();
  resetSecrets();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function createDevice(page: Page, code: string): Promise<string> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
    data: { code, name: `Máy ${code}`, deviceTypeId: pc.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

/** Cất một secret vào một chủ thể, để trang tổng có cái mà liệt kê. */
async function stash(
  page: Page,
  ownerType: 'device' | 'software',
  ownerId: string,
  label: string,
): Promise<void> {
  const created = await page.request.post('/api/v1/vault/secrets', {
    headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
    data: { ownerType, ownerId, kind: 'password', label, value: 'Mat-Khau#2026' },
  });
  expect(created.status()).toBe(201);
}

test.describe('Trang tổng Két sắt', () => {
  test('mục Két sắt vào được, liệt kê hồ sơ đang giữ két và mở xem ngay trong popup', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `PC-E2E-VH-${stamp}`;
    const deviceId = await createDevice(page, code);
    await stash(page, 'device', deviceId, `admin-${stamp}`);

    // Trước đây mục này hiện MỜ (planned) nên bấm không đi đâu — người dùng tưởng chưa làm.
    // `exact` vì sidebar còn một mục "Quyền két sắt" — khớp lỏng là trúng cả hai.
    await page.getByRole('link', { name: 'Két sắt', exact: true }).click();
    await expect(page).toHaveURL(/\/vault$/);
    await expect(page.getByRole('heading', { name: 'Két sắt' })).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Thiết bị')).toBeVisible();

    // Bấm là mở POPUP tại chỗ — không chuyển trang, nên không phải bấm quay lại.
    await row.getByRole('button', { name: `Mở két của ${code}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`admin-${stamp}`)).toBeVisible();
    await expect(page).toHaveURL(/\/vault$/);

    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
  });

  test('lọc theo loại chọn được nhiều cùng lúc, và tìm theo mã', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceCode = `PC-E2E-VF-${stamp}`;
    const deviceId = await createDevice(page, deviceCode);
    await stash(page, 'device', deviceId, `pw-${stamp}`);

    const swCode = `LIC-E2E-VF-${stamp}`;
    const sw = await page.request.post('/api/v1/software', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
      data: { code: swCode, name: 'License có key', kind: 'license', endDate: '2028-12-31' },
    });
    expect(sw.status()).toBe(201);
    await stash(page, 'software', ((await sw.json()) as { id: string }).id, `key-${stamp}`);

    await page.goto('/vault');
    const deviceRow = page.getByRole('row', { name: new RegExp(deviceCode) });
    const swRow = page.getByRole('row', { name: new RegExp(swCode) });
    await expect(deviceRow).toBeVisible();
    await expect(swRow).toBeVisible();

    // Bật lọc "Thiết bị": phần mềm biến mất.
    await page.getByRole('button', { name: 'Thiết bị', exact: true }).click();
    await expect(deviceRow).toBeVisible();
    await expect(swRow).toHaveCount(0);

    // Bật thêm "Phần mềm" — hai nút độc lập, chọn cả hai thì thấy cả hai.
    await page.getByRole('button', { name: 'Phần mềm', exact: true }).click();
    await expect(deviceRow).toBeVisible();
    await expect(swRow).toBeVisible();

    await page.getByRole('searchbox', { name: /Tìm/ }).fill(swCode);
    await expect(swRow).toBeVisible();
    await expect(deviceRow).toHaveCount(0);
  });

  /**
   * Rủi ro lớn nhất của việc dựng trang tổng: rất dễ tiện tay cho nó trả luôn tên từng ngăn,
   * và thế là bản đồ bí mật của công ty ra đời mà không bài kiểm nghiệp vụ nào đỏ.
   */
  test('trang tổng chỉ nói CHỦ THỂ, không nói trong két có gì', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createDevice(page, `PC-E2E-VS-${stamp}`);
    const label = `ten-ngan-bi-mat-${stamp}`;
    await stash(page, 'device', deviceId, label);

    const owners = await page.request.get('/api/v1/vault/owners');
    expect(owners.status()).toBe(200);
    const body = await owners.text();
    // Tên ngăn KHÔNG được có mặt trong payload của trang tổng.
    expect(body).not.toContain(label);
    expect(body).not.toContain('Mat-Khau#2026');

    await page.goto('/vault');
    await expect(page.getByRole('heading', { name: 'Két sắt' })).toBeVisible();
    await expect(page.getByText(label)).toHaveCount(0);

    // Và các đường liệt kê secret vẫn bị chặn y như trước.
    for (const url of ['/api/v1/vault/secrets', '/api/v1/vault/secrets/all']) {
      expect((await page.request.get(url)).status(), url).not.toBe(200);
    }
  });

  test('Member không vào được trang tổng — bản đồ két không mở cho mọi người', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.request.get('/api/v1/auth/me');
    // Đường API phải chặn theo VAI, không chỉ giấu mục menu đi.
    const asSa = await page.request.get('/api/v1/vault/owners');
    expect(asSa.status()).toBe(200);

    await logout(page);
    await firstLogin(page, E2E_MEMBER);
    expect((await page.request.get('/api/v1/vault/owners')).status()).toBe(403);
  });
});

test.describe('Ma trận quyền — chiều nhìn theo nhóm đối tượng', () => {
  test('gán một nhóm cho nhiều người, rồi xem lại được ai đang có quyền trên nhóm đó', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/vault-access');

    // Chiều mặc định là theo NGƯỜI; câu "nhóm này ai xem được" phải đổi chiều mới trả lời được.
    await page.getByRole('button', { name: 'Theo nhóm đối tượng' }).click();

    const scopes = await page.request.get('/api/v1/vault/access/scopes');
    const list = (await scopes.json()) as { label: string }[];
    expect(list.length).toBeGreaterThan(0);
    const label = list[0].label;

    const card = page.locator('section', { hasText: label }).first();
    await expect(card.getByText(/Chưa ai được gán nhóm này/)).toBeVisible();

    await card.getByRole('button', { name: 'Gán cho người…' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('checkbox').first().check();
    await form.getByRole('button', { name: 'Tầng quyền' }).click();
    await page.getByRole('option', { name: 'Xem thẳng', exact: true }).click();
    await form.getByRole('button', { name: 'Lưu' }).click();

    await expect(page.getByText('Đã gán quyền cho 1 người.')).toBeVisible();

    // Thẻ của chính nhóm đó phải hiện tên người vừa gán, ở đúng cột tầng quyền.
    const after = page.locator('section', { hasText: label }).first();
    await expect(after.getByText(E2E_MEMBER.email)).toBeVisible();
    await expect(after.getByText('Xem thẳng 1')).toBeVisible();
  });

  test('dòng tổng nói rõ còn bao nhiêu nhóm chưa gán cho ai', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/vault-access');
    // Chỗ hổng của ma trận là những nhóm chưa ai được gán — rà từng thẻ thì không thấy ra.
    await expect(page.getByText(/nhóm chưa gán cho ai/)).toBeVisible();
  });

  test('gỡ quyền ngay trên thẻ nhóm, không phải quay về chiều theo người', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    const scopeList = await page.request.get('/api/v1/vault/access/scopes');
    const first = ((await scopeList.json()) as {
      scopeType: string;
      scopeRef: string;
      label: string;
    }[])[0];

    const granted = await page.request.post('/api/v1/vault/access', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: first.scopeType,
        scopeRef: first.scopeRef,
        tier: 'needs_approval',
        note: '',
      },
    });
    expect(granted.status()).toBe(201);

    await page.goto('/admin/vault-access');
    await page.getByRole('button', { name: 'Theo nhóm đối tượng' }).click();
    await page
      .getByRole('button', { name: `Gỡ quyền của ${E2E_MEMBER.email} trên ${first.label}` })
      .click();
    await page.getByRole('button', { name: 'Gỡ', exact: true }).last().click();

    await expect(page.getByText('Đã gỡ quyền.')).toBeVisible();
    const card = page.locator('section', { hasText: first.label }).first();
    await expect(card.getByText(/Chưa ai được gán nhóm này/)).toBeVisible();
  });
});
