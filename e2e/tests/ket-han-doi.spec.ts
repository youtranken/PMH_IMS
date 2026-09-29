import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  logout,
  resetSecrets,
  resetServiceAccounts,
  resetUsers,
  sql,
  uniqueStamp,
  writeHeaders,
} from './helpers';

/**
 * Q-15 — hạn đổi mật khẩu trong két (180 ngày, `dashboard.secret_stale_days`): cột "Đổi lần
 * cuối" + đếm ngược ở danh sách ngăn và danh sách tài khoản dịch vụ; quá hạn thì "Quá N ngày —
 * cần đổi"; Đổi giá trị là đếm lại từ đầu; hộp Đổi giá trị nhắc IMS không nối tới thiết bị.
 */

test.beforeEach(() => {
  resetUsers();
  resetServiceAccounts();
  resetSecrets();
});

async function accountWithSecret(page: Page, stamp: string) {
  const headers = await writeHeaders(page);
  const code = `VPN-E2E-HAN-${stamp}`;
  const created = await page.request.post('/api/v1/service-accounts', {
    headers,
    data: { code, kind: 'vpn', name: 'VPN hạn đổi', login: `vpn-han-${stamp}` },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;
  const label = `mat khau vpn E2E ${stamp}`;
  const secret = await page.request.post('/api/v1/vault/secrets', {
    headers,
    data: { ownerType: 'service_account', ownerId: id, kind: 'password', label, value: 'Vpn#Han2026' },
  });
  expect(secret.status()).toBe(201);
  const secretId = ((await secret.json()) as { id: string }).id;
  return { id, code, label, secretId };
}

function backdate(secretId: string, days: number) {
  sql(
    `UPDATE secret SET value_changed_at = now() - interval '${days} days' WHERE id = '${secretId}'`,
  );
}

test.describe('Két — hạn đổi mật khẩu (Q-15)', () => {
  test('đường hạnh phúc: quá hạn hiện "Quá N ngày — cần đổi"; Đổi giá trị xong đếm lại 180 ngày', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const kit = await accountWithSecret(page, stamp);
    backdate(kit.secretId, 200);

    // Danh sách tài khoản dịch vụ: cột riêng, quá hạn 20 ngày.
    await page.goto('/service-accounts');
    await expect(page.getByRole('columnheader', { name: 'Đổi lần cuối' })).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(kit.code) });
    await expect(row.getByText('Quá 20 ngày — cần đổi')).toBeVisible();

    // Danh sách ngăn trong két của hồ sơ: cùng câu.
    await page.goto(`/service-accounts/${kit.id}?tab=vault`);
    const secretRow = page.getByRole('row', { name: new RegExp(kit.label) });
    await expect(secretRow.getByText('Quá 20 ngày — cần đổi')).toBeVisible();

    // Đổi giá trị: hộp nhắc IMS không nối tới hệ thống thật, không bắt tick.
    await secretRow.getByRole('button', { name: `Thao tác với ${kit.label}` }).click();
    await page.getByRole('menuitem', { name: 'Đổi giá trị' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/IMS không đổi gì trên thiết bị thật/)).toBeVisible();
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await dialog.getByLabel(/Giá trị mới/).fill('Vpn#Moi2026!x');
    await dialog.getByRole('button', { name: 'Đổi giá trị' }).click();
    await expect(page.getByText('Đã đổi giá trị.')).toBeVisible();
    await expect(secretRow.getByText('còn 180 ngày')).toBeVisible();
  });

  test('đường hỏng: Member không thấy cột hạn két, API bản đồ hạn chặn Member', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const kit = await accountWithSecret(page, stamp);
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    await page.goto('/service-accounts');
    await expect(page.getByRole('link', { name: kit.code })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Đổi lần cuối' })).toHaveCount(0);
    const blocked = await page.request.get('/api/v1/vault/owners/due?ownerType=service_account');
    expect(blocked.status()).toBe(403);
    const bad = await page.request.get('/api/v1/vault/owners/due?ownerType=khong-co');
    expect([400, 403]).toContain(bad.status());
  });
});
