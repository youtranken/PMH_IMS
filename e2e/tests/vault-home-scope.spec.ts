import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  resetAccessList,
  resetDevices,
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

test.describe('Cửa vào két sắt', () => {
  test('mục Két sắt trên menu vào được, và dẫn thẳng tới tab Két sắt của một hồ sơ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `PC-E2E-VH-${stamp}`;
    await createDevice(page, code);

    // Trước đây mục này hiện MỜ (planned) nên bấm không đi đâu — người dùng tưởng chưa làm.
    // `exact` vì sidebar còn một mục "Quyền két sắt" — khớp lỏng là trúng cả hai.
    await page.getByRole('link', { name: 'Két sắt', exact: true }).click();
    await expect(page).toHaveURL(/\/vault$/);
    await expect(page.getByRole('heading', { name: 'Két sắt' })).toBeVisible();

    await page.getByLabel('Tìm thiết bị hoặc phần mềm').fill(code);
    await page.getByRole('link', { name: new RegExp(code) }).click();

    // Mở ĐÚNG tab Két sắt của chính hồ sơ đó, không phải tab Hồ sơ rồi tự đi tìm.
    await expect(page).toHaveURL(new RegExp('/devices/.*tab=vault'));
    await expect(page.getByRole('tab', { name: 'Két sắt', selected: true })).toBeVisible();
  });

  /**
   * FR-026 phải còn nguyên hiệu lực SAU khi thêm trang này — đó là rủi ro lớn nhất của việc
   * dựng một "trang két sắt": rất dễ tiện tay thêm một endpoint liệt kê.
   */
  test('trang cửa vào KHÔNG gọi đường nào lấy secret của nhiều chủ thể', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    const vaultCalls: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/v1/vault')) vaultCalls.push(url.pathname + url.search);
    });

    await page.goto('/vault');
    await expect(page.getByRole('heading', { name: 'Két sắt' })).toBeVisible();
    await page.getByLabel('Tìm thiết bị hoặc phần mềm').fill('PC');
    await expect(page.getByText('Luật của két')).toBeVisible();

    // Trang này chỉ tra CHỦ THỂ (thiết bị / phần mềm) — không đụng tới module két.
    expect(vaultCalls, `không được gọi: ${vaultCalls.join(', ')}`).toHaveLength(0);

    // Và các đường liệt kê vẫn bị chặn y như trước.
    for (const url of ['/api/v1/vault/secrets', '/api/v1/vault/secrets/all']) {
      expect((await page.request.get(url)).status(), url).not.toBe(200);
    }
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
