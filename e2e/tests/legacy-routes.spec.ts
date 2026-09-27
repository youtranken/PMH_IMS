import { expect, test } from '@playwright/test';
import { APP_ORIGIN, E2E_SA, firstLogin, resetUsers, uniqueStamp } from './helpers';

/**
 * Đường dẫn đổi sang tiếng Anh, nhưng link tiếng Việt đã gửi qua chat, đã ghim trong trình
 * duyệt, đã dán vào biên bản sự cố thì không tự sửa được. Mỗi đường cũ phải đưa tới đúng
 * đường mới — và thanh địa chỉ phải đổi luôn, không để người dùng đứng ở một URL đã chết.
 */
test.beforeEach(() => {
  resetUsers();
});

const REDIRECTS: [string, string][] = [
  ['/thiet-bi', '/devices'],
  ['/phan-mem', '/software'],
  ['/duong-truyen', '/isp-lines'],
  ['/sap-het-han', '/expiry'],
  ['/dia-chi-ip', '/ip-addresses'],
  ['/so-nat', '/nat'],
  ['/duyet-yeu-cau', '/approvals'],
  ['/quan-tri/tai-khoan', '/admin/accounts'],
  ['/quan-tri/danh-muc', '/admin/catalog'],
  ['/quan-tri/quyen-ket-sat', '/admin/vault-access'],
];

test('link tiếng Việt cũ đưa sang đúng đường mới', async ({ page }) => {
  await firstLogin(page, E2E_SA);

  for (const [from, to] of REDIRECTS) {
    await page.goto(from);
    await expect(page, `${from} phải sang ${to}`).toHaveURL(new RegExp(`${to}$`));
  }
});

test('link cũ có :id giữ nguyên id khi chuyển sang đường mới', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();

  const csrf = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data: { code: `PC-E2E-RD-${stamp}`, name: 'Máy kiểm chuyển hướng', deviceTypeId: pc.id },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { device: { id: string } }).device.id;

  // Không chỉ tới đúng URL — phải MỞ ĐÚNG hồ sơ đó, tức id được ghép lại chứ không rơi mất.
  await page.goto(`/thiet-bi/${id}`);
  await expect(page).toHaveURL(new RegExp(`/devices/${id}$`));
  await expect(page.getByRole('heading', { name: new RegExp(`PC-E2E-RD-${stamp}`) })).toBeVisible();
});

test('link cũ giữ nguyên ?tab= khi chuyển sang đường mới', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();

  const csrf = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data: { code: `PC-E2E-TAB-${stamp}`, name: 'Máy kiểm deep-link', deviceTypeId: pc.id },
  });
  const id = ((await created.json()) as { device: { id: string } }).device.id;

  /*
   * Chính đợt này thêm deep-link `?tab=vault`. Chuyển hướng mà rơi mất query thì một link đã
   * ghim sẽ mở ra tab Hồ sơ, và người bấm không hiểu vì sao nó không vào thẳng két như mọi khi.
   */
  await page.goto(`/thiet-bi/${id}?tab=vault`);
  // So chuỗi thẳng, không dựng regex: `?` trong regex là lượng từ, escape nó qua template
  // literal rất dễ hỏng âm thầm và bài kiểm thành ra khớp nhầm.
  await expect(page).toHaveURL(
    (url) => url.pathname === `/devices/${id}` && url.search === '?tab=vault',
  );
  await expect(page.getByRole('tab', { name: 'Két sắt', selected: true })).toBeVisible();
});

test('đường dẫn tiếng Việt của luồng đăng nhập cũng chuyển được', async ({ page }) => {
  // CHƯA đăng nhập: `/dang-nhap` phải ra màn đăng nhập ở đường mới, không phải trang 404.
  await page.goto('/dang-nhap');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
});
