import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  expireStepUp,
  firstLogin,
  freshTotpCode,
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
  // ≤600px mỗi hồ sơ là một thẻ gọn (mã + tên, chip số ngăn) — chạm cả thẻ là mở két.
  const row = page.getByRole('listitem').filter({ hasText: code });
  await expect(row).toBeVisible();
  await expect(row.getByText(/^Thiết bị · /)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  /*
   * Popup mở két là thứ THẬT SỰ được dùng trên điện thoại: đứng cạnh máy, mở xem có ngăn nào.
   * Nó lồng một bảng nữa vào trong hộp thoại đã hẹp sẵn — không kiểm thì nó tràn ngang một
   * mình mà cả trang phía sau vẫn đo ra "không tràn".
   */
  await row.getByRole('button', { name: code }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`admin-E2E-${stamp}`)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  const dialogOverflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(dialogOverflow).toBeLessThanOrEqual(1);
});

test('quyền két ở 390px: danh sách thành viên → thẻ quyền của một người, không tràn ngang', async ({
  page,
}) => {
  await firstLogin(page, E2E_SA);
  const headers = await writeHeaders(page);
  const scopeList = await page.request.get('/api/v1/vault/access/scopes');
  const scope = ((await scopeList.json()) as { scopeType: string; scopeRef: string; label: string }[])[0];
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
  await expect(page.getByRole('heading', { name: 'Quyền két sắt' })).toBeVisible();
  // Dòng tổng là câu ghép bốn con số — ở 390px nó phải xuống dòng chứ không đẩy trang rộng ra.
  await expect(page.getByText(/tài khoản · .* dòng quyền/)).toBeVisible();
  /*
   * Lưới vài chục cột KHÔNG có ở màn hẹp — tab "Ma trận" chỉ dành cho màn rộng. Ở điện thoại
   * là danh sách người (kèm số quyền) rồi tới thẻ quyền của một người.
   */
  await expect(page.getByRole('tab', { name: 'Ma trận' })).toHaveCount(0);
  await expect(page.getByTestId('access-grid')).toHaveCount(0);
  const member = page.getByRole('button', { name: new RegExp(`${E2E_MEMBER.email}.*1 quyền`) });
  await expect(member).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await member.click();
  await expect(page.getByRole('button', { name: '← Danh sách thành viên' })).toBeVisible();
  await expect(page.getByRole('button', { name: /: Cần duyệt$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Thêm quyền' })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  // SA/Admin không là thẻ trống: khối gập "Có toàn quyền theo vai".
  await expect(page.getByText(/^Có toàn quyền theo vai \(\d+\)$/)).toBeVisible();
});

/**
 * VLT-062 — mở xem giá trị từ popup két: bước mã và bước giá trị chạy TRONG popup, không chồng
 * hộp. Trên điện thoại ba lớp hộp chồng nhau là người dùng không biết mình đang ở đâu, và nút
 * đóng của lớp nào đóng cái gì.
 */
test('popup két ở 390px: Xem → mã → giá trị trong CÙNG một hộp, Ẩn ngay về danh sách', async ({
  page,
}) => {
  const totpSecret = await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const code = `PC-E2E-VM1H-${stamp}`;
  const label = `admin-E2E-${stamp}`;
  await createDeviceWithSecret(page, code, label);
  expireStepUp(E2E_SA.email);

  await page.goto('/vault');
  await page.getByRole('listitem').filter({ hasText: code }).getByRole('button', { name: code }).click();
  const popup = page.getByRole('dialog');
  await popup.getByRole('button', { name: 'Xem' }).click();

  const step = popup.getByRole('region', { name: 'Xác nhận danh tính' });
  await expect(step).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await step.getByLabel('Mã xác thực').fill(await freshTotpCode(totpSecret));
  await expect(popup.getByTestId('secret-value')).toHaveText('Mat-Khau#2026');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await popup.getByRole('button', { name: 'Ẩn ngay' }).click();
  await expect(page.getByTestId('secret-value')).toHaveCount(0);
  await expect(popup.getByText(label)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('popup két ở 390px: bước mã có Quay lại — về danh sách, không gửi mã', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const code = `PC-E2E-VM1B-${stamp}`;
  const label = `admin-E2E-${stamp}`;
  await createDeviceWithSecret(page, code, label);
  expireStepUp(E2E_SA.email);

  await page.goto('/vault');
  await page.getByRole('listitem').filter({ hasText: code }).getByRole('button', { name: code }).click();
  const popup = page.getByRole('dialog');
  await popup.getByRole('button', { name: 'Xem' }).click();
  await popup.getByRole('button', { name: '‹ Quay lại', exact: true }).click();
  await expect(popup.getByText(label)).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Xem' })).toBeVisible();
  await expect(page.getByTestId('secret-value')).toHaveCount(0);
});
