import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetAccessList,
  resetDevices,
  resetSecrets,
  resetUsers,
  writeHeaders,
  uniqueStamp,
} from './helpers';

/**
 * UX-DR2 cho hai màn ĐỌC ra đời ở đợt UI/UX 4 mà chưa màn nào có bài kiểm 390px:
 *
 *  - `/vault` — trang tổng "hồ sơ nào đang giữ két", cửa vào để mở xem ngay trong popup.
 *  - `/admin/vault-access` — ma trận "ai xem được gì", hai chiều nhìn.
 *
 * Cả hai đều là bảng NHIỀU CỘT (mã · tên · loại · số ngăn / người · nhóm · tầng quyền) nên
 * đúng là chỗ dễ tràn ngang nhất, và cả hai đều là thứ người ta tra khi đang cầm điện thoại.
 */
test.beforeEach(() => {
  resetUsers();
  resetAccessList();
  resetDevices();
  resetSecrets();
});

async function createDeviceWithSecret(page: Page, code: string, label: string): Promise<void> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
  const headers = await writeHeaders(page);
  const created = await page.request.post('/api/v1/devices', {
    headers,
    data: { code, name: `Máy ${code}`, deviceTypeId: pc.id },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { device: { id: string } }).device.id;
  const stashed = await page.request.post('/api/v1/vault/secrets', {
    headers,
    data: { ownerType: 'device', ownerId: id, kind: 'password', label, value: 'Mat-Khau#2026' },
  });
  expect(stashed.status()).toBe(201);
}

test('trang tổng Két sắt đọc được ở 390px, popup mở xem cũng vậy', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const code = `PC-E2E-VM390-${stamp}`;
  await createDeviceWithSecret(page, code, `admin-E2E-${stamp}`);

  await page.goto('/vault');
  await expect(page.getByRole('heading', { name: 'Két sắt' })).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(code) });
  await expect(row).toBeVisible();
  await expect(row.getByText('Thiết bị')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  /*
   * Popup mở két là thứ THẬT SỰ được dùng trên điện thoại: đứng cạnh máy, mở xem có ngăn nào.
   * Nó lồng một bảng nữa vào trong hộp thoại đã hẹp sẵn — không kiểm thì nó tràn ngang một
   * mình mà cả trang phía sau vẫn đo ra "không tràn".
   */
  await row.getByRole('button', { name: `Mở két của ${code}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`admin-E2E-${stamp}`)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  const dialogOverflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(dialogOverflow).toBeLessThanOrEqual(1);
});

test('lưới ma trận quyền đọc được ở 390px, cuộn ngang trong khung của nó', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const headers = await writeHeaders(page);
  const scopeList = await page.request.get('/api/v1/vault/access/scopes');
  const scope = ((await scopeList.json()) as { scopeType: string; scopeRef: string }[])[0];
  const granted = await page.request.post('/api/v1/vault/access', {
    headers,
    data: {
      memberEmail: E2E_MEMBER.email,
      scopeType: scope.scopeType,
      scopeRef: scope.scopeRef,
      tier: 'needs_approval',
    },
  });
  expect(granted.status()).toBe(201);

  await page.goto('/admin/vault-access');
  await expect(page.getByRole('heading', { name: 'Quyền xem két sắt' })).toBeVisible();
  // Dòng tổng là câu ghép bốn con số — ở 390px nó phải xuống dòng chứ không đẩy trang rộng ra.
  await expect(page.getByText(/tài khoản · .* dòng quyền/)).toBeVisible();
  await expect(page.getByText(E2E_MEMBER.email)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  /*
   * Lưới (28/08/2026) cuộn ngang TRONG khung của nó, không đẩy cả trang — đó chính là điều
   * bài này khóa lại. Vài chục cột ở 390px mà trang cuộn ngang thì cột tên người trôi mất và
   * lưới hết đọc được.
   */
  const grid = page.getByTestId('access-grid');
  await expect(grid).toBeVisible();
  const gridScrolls = await grid.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(gridScrolls).toBe(true);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  /*
   * OLD-FE-01 — lưới cuộn được thì phải NÓI RA là còn cột khuất: thanh cuộn ngang chỉ hiện khi
   * rê chuột, nên không có dòng này thì mép phải màn hình trông như cột cuối cùng.
   */
  const region = page.getByRole('region', { name: 'Quyền xem két sắt' });
  await expect(region).toBeVisible();
  await expect(page.getByText(/kéo ngang/)).toBeVisible();
  await expect(region).toHaveAccessibleDescription(/kéo ngang/);
});
