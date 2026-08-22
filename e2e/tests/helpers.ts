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
  relaxLoginRateLimit();
}

/**
 * Nới trần đăng nhập theo IP cho MÔI TRƯỜNG TEST.
 *
 * Cả bộ E2E đăng nhập vài chục lần trong ít phút từ cùng một IP, đụng trần
 * `login.rate_limit_per_ip` (mặc định 20/phút) và một loạt test đỏ vì 429 chứ không phải
 * vì sản phẩm sai. Nới ở đây thay vì hạ trần thật: bản thân cơ chế chặn dò mật khẩu đã có
 * test riêng ở `login-rate.guard.spec.ts` (kể cả việc ngưỡng phải ĐỌC TỪ system_config).
 */
function relaxLoginRateLimit(): void {
  execSync(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -c "UPDATE system_config SET value = '500' WHERE key = 'login.rate_limit_per_ip'"`,
    { cwd: '..', stdio: 'pipe' },
  );
}

export const COMPOSE =
  'docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml';

/**
 * Xóa dữ liệu danh mục do E2E tạo ra (mã bắt đầu bằng `E2E-`).
 *
 * Vì sao cần: `resetUsers` chỉ đụng tới tài khoản. Danh mục thì Ở LẠI giữa các lần chạy,
 * nên site/tủ của lần trước dồn lại làm bảng tràn sang trang 2 và locator theo dòng
 * bắt trúng bản ghi cũ. Chỉ xóa đúng tiền tố E2E — dữ liệu thật của PMH không đụng tới.
 */
/**
 * Xóa thiết bị do E2E tạo (mã chứa `-E2E-` hoặc bắt đầu bằng `PC-A-`/`PC-B-`/`PC-DUP-`/`NAS-`).
 * `device_history` là append-only nên phải xóa lịch sử bằng superuser TRƯỚC — đây là lý do
 * script này chỉ chạy ở môi trường test, không bao giờ có mặt trong image production.
 */
export function resetDevices(): void {
  const match = "(code ILIKE '%-E2E-%' OR code ILIKE 'PC-A-%' OR code ILIKE 'PC-B-%' OR code ILIKE 'PC-DUP-%' OR code ILIKE 'NAS-%' OR code ILIKE 'SW-E2E-%')";
  const sql = [
    `ALTER TABLE device_history DISABLE TRIGGER device_history_no_delete`,
    `DELETE FROM device_history WHERE device_id IN (SELECT id FROM device WHERE ${match})`,
    `ALTER TABLE device_history ENABLE TRIGGER device_history_no_delete`,
    `DELETE FROM device WHERE ${match}`,
  ].join('; ');
  execSync(`${COMPOSE} exec -T postgres psql -U ims -d ims -c "${sql}"`, {
    cwd: '..',
    stdio: 'pipe',
  });
}

export function resetCatalog(): void {
  const sql = [
    "DELETE FROM cabinet WHERE site_id IN (SELECT id FROM site WHERE code LIKE 'E2E-%')",
    "DELETE FROM site WHERE code LIKE 'E2E-%'",
    "DELETE FROM vendor WHERE name LIKE 'E2E-%'",
    "DELETE FROM device_type WHERE name LIKE 'E2E-%'",
  ].join('; ');
  execSync(`${COMPOSE} exec -T postgres psql -U ims -d ims -c "${sql}"`, {
    cwd: '..',
    stdio: 'pipe',
  });
}

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
