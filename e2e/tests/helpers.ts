import { execSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';
import { NobleCryptoPlugin, ScureBase32Plugin, TOTP } from 'otplib';

export const E2E_SA = { email: 'e2e-sa@pmh.com.vn', password: 'E2e@Test#2026' };
export const E2E_MEMBER = { email: 'e2e-member@pmh.com.vn', password: 'E2e@Test#2026' };
export const NEW_PASSWORD = 'Ims#Manh2026!ok';

/**
 * Đưa tài khoản E2E về trạng thái vừa-được-tạo. Gọi ở beforeEach vì test đăng nhập
 * làm THAY ĐỔI trạng thái thật (đổi mật khẩu, cài TOTP, khóa tài khoản) — không reset
 * thì test sau ăn theo test trước và đỏ ngẫu nhiên.
 */
export function resetUsers(): void {
  // Script reset KHÔNG nằm trong image production; override e2e mount nó vào container.
  execSync(`${COMPOSE} exec -T api node scripts/reset-e2e-user.mjs`, {
    cwd: '..',
    stdio: 'pipe',
    env: { ...process.env, ALLOW_E2E_RESET: '1' },
  });
}

export const COMPOSE =
  'docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml';

const totp = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
  period: 30,
  digits: 6,
});

/** Test đóng vai app Authenticator: sinh mã 6 số từ secret hiện trên màn enroll. */
export async function totpCode(secret: string): Promise<string> {
  return totp.generate({ secret });
}

const usedCodes = new Set<string>();

/**
 * Mã CHƯA từng dùng trong lần chạy test này.
 *
 * Chống replay (NFR-01) từ chối mã đã dùng — nên hai lần đăng nhập cách nhau vài giây
 * sẽ nhận cùng một mã và lần thứ hai bị chặn ĐÚNG THEO THIẾT KẾ. Test phải chờ sang
 * chu kỳ 30 giây kế tiếp thay vì coi đó là lỗi.
 */
export async function freshTotpCode(secret: string): Promise<string> {
  let code = await totpCode(secret);
  while (usedCodes.has(code)) {
    const msToNextWindow = 30_000 - (Date.now() % 30_000) + 1_000;
    await new Promise((resolve) => setTimeout(resolve, msToNextWindow));
    code = await totpCode(secret);
  }
  usedCodes.add(code);
  return code;
}

export async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/dang-nhap');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
}

/**
 * Đi hết luồng lần đầu: mật khẩu tạm → cài 2 lớp → đổi mật khẩu → vào app.
 * Trả về secret TOTP để test sau còn đăng nhập lại được.
 */
export async function firstLogin(
  page: Page,
  user: { email: string; password: string },
  newPassword = NEW_PASSWORD,
): Promise<string> {
  await fillLogin(page, user.email, user.password);

  await expect(page.getByRole('heading', { name: 'Cài xác thực 2 lớp' })).toBeVisible();
  const secret = (await page.locator('code.mono').innerText()).trim();
  expect(secret.length).toBeGreaterThan(15);

  await page.getByLabel('Nhập mã 6 số đầu tiên để xác nhận').fill(await freshTotpCode(secret));
  await page.getByRole('button', { name: 'Xác nhận' }).click();

  await expect(page.getByRole('heading', { name: 'Đổi mật khẩu' })).toBeVisible();
  await page.getByLabel('Mật khẩu hiện tại').fill(user.password);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill(newPassword);
  await page.getByLabel('Nhập lại mật khẩu mới').fill(newPassword);
  await page.getByRole('button', { name: 'Lưu' }).click();

  await expect(page.getByRole('heading', { name: /Xin chào/ })).toBeVisible();
  return secret;
}

/** Đăng nhập lại khi đã cài TOTP và đã đổi mật khẩu. */
export async function loginWithTotp(
  page: Page,
  email: string,
  password: string,
  secret: string,
): Promise<void> {
  await fillLogin(page, email, password);
  await expect(page.getByRole('heading', { name: 'Xác thực 2 lớp' })).toBeVisible();
  await page.getByLabel('Mã xác thực').fill(await freshTotpCode(secret));
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByRole('heading', { name: /Xin chào/ })).toBeVisible();
}
