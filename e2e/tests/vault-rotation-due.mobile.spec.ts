import { expect, test } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  horizontalOverflow,
  resetSecrets,
  resetServiceAccounts,
  resetUsers,
  sql,
  uniqueStamp,
  writeHeaders,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetServiceAccounts();
  resetSecrets();
});

/**
 * Q-15 ở 390px: danh sách tài khoản dịch vụ là màn ĐỌC — thẻ gọn phải mang ngày đổi + đếm
 * ngược, và quá hạn thì "Quá N ngày — cần đổi", không tràn ngang.
 */
test('thẻ tài khoản dịch vụ ở 390px mang hạn đổi mật khẩu trong két', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = uniqueStamp();
  const headers = await writeHeaders(page);
  const code = `VPN-E2E-HAN390-${stamp}`;
  const created = await page.request.post('/api/v1/service-accounts', {
    headers,
    data: { code, kind: 'vpn', name: 'VPN hạn đổi 390', login: `vpn-390-${stamp}` },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;
  const secret = await page.request.post('/api/v1/vault/secrets', {
    headers,
    data: {
      ownerType: 'service_account',
      ownerId: id,
      kind: 'password',
      label: `mat khau E2E ${stamp}`,
      value: 'Vpn#Han2026',
    },
  });
  const secretId = ((await secret.json()) as { id: string }).id;
  sql(`UPDATE secret SET value_changed_at = now() - interval '185 days' WHERE id = '${secretId}'`);

  await page.goto('/service-accounts');
  const card = page.getByRole('listitem').filter({ hasText: code });
  await expect(card.getByText('Quá 5 ngày — cần đổi')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
