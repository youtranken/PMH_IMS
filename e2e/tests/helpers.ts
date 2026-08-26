import { execSync } from 'node:child_process';
import { expect, request, type Page } from '@playwright/test';
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
  dropAccountsCreatedByE2e();
}

/**
 * Xóa tài khoản do test "SA tạo tài khoản mới" đẻ ra (`e2e-tao-moi-…`).
 *
 * `reset-e2e-user.mjs` chỉ đưa HAI tài khoản cố định về trạng thái ban đầu; tài khoản tạo
 * trong lúc chạy thì ở lại. Sau vài chục lần chạy, danh sách tài khoản tràn sang trang 2 và
 * bài kiểm "tạo xong phải thấy trong danh sách" đỏ — không phải vì sản phẩm sai mà vì rác
 * của những lần chạy trước. Cùng quy ước với `resetDevices`/`resetSoftware`: chỉ đụng tiền tố
 * E2E, không bao giờ chạm tài khoản thật của PMH.
 */
function dropAccountsCreatedByE2e(): void {
  const match = "email LIKE 'e2e-tao-moi-%'";
  const sql = [
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE ${match})`,
    `DELETE FROM known_device WHERE user_id IN (SELECT id FROM users WHERE ${match})`,
    `DELETE FROM users WHERE ${match}`,
  ].join('; ');
  execSync(`${COMPOSE} exec -T postgres psql -U ims -d ims -c "${sql}"`, {
    cwd: '..',
    stdio: 'pipe',
  });
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
/**
 * Xóa hồ sơ phần mềm do E2E tạo. Quy ước giống thiết bị: mã luôn chứa chuỗi "E2E" nên câu
 * xóa không bao giờ chạm dữ liệu thật.
 */
export function resetSoftware(): void {
  const match = "code ILIKE '%E2E%'";
  const sql = [
    // Bản ghi gán license trỏ tới software — xóa trước, không thì FK chặn.
    `DELETE FROM license_assignment WHERE software_id IN (SELECT id FROM software WHERE ${match})`,
    // Secret gắn vào hồ sơ phần mềm — cùng lý do như ở `resetDevices`.
    `DELETE FROM secret WHERE owner_type = 'software' AND owner_id IN (SELECT id FROM software WHERE ${match})`,
    `ALTER TABLE software_history DISABLE TRIGGER software_history_no_delete`,
    `DELETE FROM software_history WHERE software_id IN (SELECT id FROM software WHERE ${match})`,
    `ALTER TABLE software_history ENABLE TRIGGER software_history_no_delete`,
    `DELETE FROM software WHERE ${match}`,
  ].join('; ');
  execSync(`${COMPOSE} exec -T postgres psql -U ims -d ims -c "${sql}"`, {
    cwd: '..',
    stdio: 'pipe',
  });
}

/**
 * Xóa secret do E2E cất. Quy ước: mọi nhãn secret trong test đều chứa "E2E".
 *
 * Bảng `secret` không có FK sang device/software (tham chiếu lỏng, AD-4) nên xóa thiết bị
 * KHÔNG kéo theo secret — không có câu này thì nhãn của lần chạy trước ở lại và ràng buộc
 * "một chủ thể một nhãn" bắt trúng bản ghi mồ côi.
 */
export function resetSecrets(): void {
  execSync(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -c "DELETE FROM secret WHERE label ILIKE '%E2E%'"`,
    { cwd: '..', stdio: 'pipe' },
  );
}

/**
 * Đẩy mốc step-up của mọi phiên lùi 1 giờ — giả lập "hết grace 10 phút" mà không phải chờ.
 *
 * Cách khác là hạ `secret.stepup_grace_minutes` xuống 0, nhưng SystemConfigService cache 30
 * giây nên test sẽ phải ngồi chờ cache hết hạn, và grace 0 thì gõ mã xong cũng vẫn hết hạn
 * ngay — không kiểm được luồng "gõ mã rồi xem tiếp".
 */
export function expireStepUp(): void {
  execSync(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -c "UPDATE sessions SET stepped_up_at = now() - interval '1 hour' WHERE revoked_at IS NULL"`,
    { cwd: '..', stdio: 'pipe' },
  );
}

/** Đếm số dòng audit của một hành động trên một secret — dùng để kiểm "mỗi lần mở = một dòng". */
export function countAudit(action: string, objectId: string): number {
  const out = execSync(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -t -A -c ` +
      `"SELECT count(*) FROM audit_log WHERE action = '${action}' AND object_id = '${objectId}'"`,
    { cwd: '..', encoding: 'utf8' },
  );
  return Number(out.trim());
}

/**
 * Xóa dải và hồ sơ IP do E2E tạo. Quy ước: mọi TÊN dải trong test đều chứa "E2E".
 *
 * `ip_history` là append-only (AD-13) nên phải tắt trigger để xóa — đúng lý do script reset
 * chỉ chạy ở môi trường test, không bao giờ có mặt trong image production.
 */
export function resetIpam(): void {
  const match = "name ILIKE '%E2E%'";
  const sql = [
    `ALTER TABLE ip_history DISABLE TRIGGER ip_history_no_delete`,
    `DELETE FROM ip_history WHERE ip_address_id IN (SELECT id FROM ip_address WHERE subnet_id IN (SELECT id FROM subnet WHERE ${match}))`,
    `ALTER TABLE ip_history ENABLE TRIGGER ip_history_no_delete`,
    // Rule NAT trỏ tới hồ sơ IP — xóa trước, không thì FK chặn.
    `DELETE FROM nat_rule WHERE ip_address_id IN (SELECT id FROM ip_address WHERE subnet_id IN (SELECT id FROM subnet WHERE ${match}))`,
    `DELETE FROM nat_rule WHERE device_id IN (SELECT id FROM device WHERE code ILIKE '%E2E%')`,
    `DELETE FROM ip_address WHERE subnet_id IN (SELECT id FROM subnet WHERE ${match})`,
    `DELETE FROM subnet WHERE ${match}`,
  ].join('; ');
  execSync(`${COMPOSE} exec -T postgres psql -U ims -d ims -c "${sql}"`, {
    cwd: '..',
    stdio: 'pipe',
  });
}

/** Xóa mọi lời gán quyền két sắt của tài khoản E2E — ma trận phải sạch giữa các lần chạy. */
export function resetAccessList(): void {
  execSync(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -c "DELETE FROM access_list WHERE member_email ILIKE '%e2e%'"`,
    { cwd: '..', stdio: 'pipe' },
  );
}

/**
 * Xóa yêu cầu duyệt do E2E tạo (người xin là tài khoản e2e).
 *
 * `approval_history` là append-only (AD-13) nên phải tắt trigger — lý do script này chỉ có
 * mặt ở môi trường test.
 */
export function resetApprovals(): void {
  const match = "requester ILIKE '%e2e%'";
  const sql = [
    `ALTER TABLE approval_history DISABLE TRIGGER approval_history_no_delete`,
    `DELETE FROM approval_history WHERE approval_id IN (SELECT id FROM approval WHERE ${match})`,
    `ALTER TABLE approval_history ENABLE TRIGGER approval_history_no_delete`,
    `DELETE FROM approval WHERE ${match}`,
  ].join('; ');
  execSync(`${COMPOSE} exec -T postgres psql -U ims -d ims -c "${sql}"`, {
    cwd: '..',
    stdio: 'pipe',
  });
}

/** Xóa luật gửi báo cáo do E2E tạo. Quy ước: mọi tên luật trong test đều chứa "E2E". */
export function resetDigestRules(): void {
  execSync(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -c "DELETE FROM expiry_rule WHERE name ILIKE '%E2E%'"`,
    { cwd: '..', stdio: 'pipe' },
  );
}

/** Xóa đường truyền ISP do E2E tạo (mã luôn chứa "E2E"). */
export function resetIsp(): void {
  const match = "code ILIKE '%E2E%'";
  const sql = [
    `DELETE FROM file WHERE owner_type = 'isp' AND owner_id IN (SELECT id FROM isp_line WHERE ${match})`,
    `ALTER TABLE isp_line_history DISABLE TRIGGER isp_line_history_no_delete`,
    `DELETE FROM isp_line_history WHERE isp_line_id IN (SELECT id FROM isp_line WHERE ${match})`,
    `ALTER TABLE isp_line_history ENABLE TRIGGER isp_line_history_no_delete`,
    `DELETE FROM isp_line WHERE ${match}`,
  ].join('; ');
  execSync(`${COMPOSE} exec -T postgres psql -U ims -d ims -c "${sql}"`, {
    cwd: '..',
    stdio: 'pipe',
  });
}

export function resetDevices(): void {
  // Quy ước: MỌI mã thiết bị do E2E tạo đều chứa chuỗi "E2E" — nhờ vậy câu xóa dưới đây
  // không bao giờ chạm vào dữ liệu thật (SW-CORE-01, SRV-APP-01…) trong stack dev.
  const match = "code ILIKE '%E2E%'";
  const sql = [
    `DELETE FROM file WHERE owner_type = 'device' AND owner_id IN (SELECT id FROM device WHERE ${match})`,
    /*
     * Secret gắn vào thiết bị test cũng phải dọn theo.
     *
     * Bỏ dòng này thì mỗi lần chạy để lại một ngăn két không còn chủ, và chúng tích lại
     * hàng chục dòng — trang tổng Két sắt hiện đúng chỗ đó thành "hồ sơ đã bị xóa, còn
     * secret treo lại". Đúng ra là công của trang tổng: nó phát hiện được rác mà trước
     * đây không ai nhìn thấy; nhưng rác này là do bộ test đẻ ra nên dọn ở đây.
     */
    `DELETE FROM secret WHERE owner_type = 'device' AND owner_id IN (SELECT id FROM device WHERE ${match})`,
    // License gán vào thiết bị test cũng phải dọn, không thì FK chặn xóa thiết bị.
    `DELETE FROM license_assignment WHERE device_id IN (SELECT id FROM device WHERE ${match})`,
    // Đường ISP trỏ tới thiết bị biên — gỡ liên kết trước khi xóa thiết bị.
    `UPDATE isp_line SET device_id = NULL WHERE device_id IN (SELECT id FROM device WHERE ${match})`,
    // Rule NAT và hồ sơ IP trỏ tới thiết bị (FK RESTRICT) — dọn trước khi xóa thiết bị.
    `DELETE FROM nat_rule WHERE device_id IN (SELECT id FROM device WHERE ${match})`,
    `ALTER TABLE ip_history DISABLE TRIGGER ip_history_no_delete`,
    `DELETE FROM ip_history WHERE ip_address_id IN (SELECT id FROM ip_address WHERE device_id IN (SELECT id FROM device WHERE ${match}))`,
    `ALTER TABLE ip_history ENABLE TRIGGER ip_history_no_delete`,
    `DELETE FROM ip_address WHERE device_id IN (SELECT id FROM device WHERE ${match})`,
    // Port map trỏ tới thiết bị ở CẢ HAI cột — xóa hết dòng có dính thiết bị test.
    `DELETE FROM device_port WHERE device_id IN (SELECT id FROM device WHERE ${match}) OR connected_device_id IN (SELECT id FROM device WHERE ${match})`,
    // `device_history` là append-only (AD-13) nên phải tắt trigger để dọn — đây là lý do
    // việc này chỉ chạy ở môi trường test, không bao giờ có trong image production.
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
    // Ba danh mục của 0028. Khớp '%E2E%' ở GIỮA chuỗi chứ không chỉ tiền tố: tên do người
    // dùng đặt (vd "Cong E2E 1234") nên không có quy ước mã đứng đầu như site/NCC.
    "DELETE FROM service_port WHERE name ILIKE '%E2E%'",
    "DELETE FROM department WHERE name ILIKE '%E2E%'",
    "DELETE FROM isp_provider WHERE name ILIKE '%E2E%'",
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
  await page.goto('/login');
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

/**
 * Mailpit — hộp thư của môi trường dev/test. SMTP thật chỉ bật ở prod.
 *
 * Ba hàm dưới đây TỪNG nằm riêng trong `expiry-digest.spec.ts`. Epic 6 cũng gửi thư (báo
 * người duyệt khi có yêu cầu treo, nhắc yêu cầu quá hạn) nên chúng chuyển ra đây thay vì bị
 * chép sang file thứ hai — AD-15 cấm bản sao.
 */
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

export interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export async function clearMailbox(): Promise<void> {
  const api = await request.newContext();
  await api.delete(`${MAILPIT}/api/v1/messages`).catch(() => undefined);
  await api.dispose();
}

/**
 * Chờ thư có tiêu đề khớp — KHÔNG lấy bừa thư đầu hộp: luồng đăng nhập lần đầu cũng gửi
 * email "thiết bị mới", nên thư đầu tiên trong hộp thường không phải thư mình đang chờ.
 */
export async function waitForMail(subjectPart: string, attempts = 40): Promise<MailSummary[]> {
  const api = await request.newContext();
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const res = await api.get(`${MAILPIT}/api/v1/messages`);
      if (res.ok()) {
        const body = (await res.json()) as { messages: MailSummary[] };
        const matched = body.messages.filter((mail) => mail.Subject.includes(subjectPart));
        if (matched.length > 0) return matched;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return [];
  } finally {
    await api.dispose();
  }
}

export async function mailBody(id: string): Promise<string> {
  const api = await request.newContext();
  const res = await api.get(`${MAILPIT}/api/v1/message/${id}`);
  const body = (await res.json()) as { Text?: string; HTML?: string };
  await api.dispose();
  return `${body.Text ?? ''}
${body.HTML ?? ''}`;
}

/**
 * Đổi một khóa `system_config` (AD-11).
 *
 * CẨN THẬN: `SystemConfigService` cache 30 giây. Test nào đổi ngưỡng rồi kiểm hệ quả NGAY
 * sẽ đọc phải giá trị cũ và xanh/đỏ vì lý do chẳng liên quan — phải chờ qua cache
 * (`CONFIG_CACHE_MS`) hoặc chọn cách kiểm không phụ thuộc thời điểm.
 */
export const CONFIG_CACHE_MS = 31_000;

export function setConfig(key: string, value: string): void {
  execSync(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -c ` +
      `"UPDATE system_config SET value = '${value}' WHERE key = '${key}'"`,
    { cwd: '..', stdio: 'pipe' },
  );
}

export function getConfig(key: string): string {
  return execSync(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -t -A -c ` +
      `"SELECT value FROM system_config WHERE key = '${key}'"`,
    { cwd: '..', encoding: 'utf8' },
  ).trim();
}

/** Chạy một câu SQL bất kỳ và trả về chữ — dùng để dựng trạng thái mà UI không dựng được. */
export function sql(query: string): string {
  return execSync(
    `${COMPOSE} exec -T postgres psql -U ims -d ims -t -A -c "${query}"`,
    { cwd: '..', encoding: 'utf8' },
  ).trim();
}

/** Token CSRF của phiên đang mở — mọi lệnh ghi qua API đều phải kèm. */
export async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

/** Header đủ để gọi API ghi từ trong test (CSRF + Origin hợp lệ). */
export async function writeHeaders(page: Page): Promise<Record<string, string>> {
  return { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
}

/**
 * Tuỳ chọn cho test cần MỘT TRÌNH DUYỆT THỨ HAI (`browser.newContext()`).
 *
 * `newContext()` KHÔNG thừa kế mục `use` trong `playwright.config.ts`. Thiếu
 * `ignoreHTTPSErrors` là mọi request chết vì cert dev tự ký, và thiếu `baseURL` là
 * `goto('/')` không biết đi đâu — cả hai đều đỏ theo kiểu chẳng liên quan gì tới bài test.
 */
export const SECOND_BROWSER = {
  baseURL: process.env.IMS_BASE_URL ?? 'https://ims.pmh.com.vn',
  ignoreHTTPSErrors: true,
  locale: 'vi-VN',
  timezoneId: 'Asia/Ho_Chi_Minh',
} as const;

/**
 * Số pixel trang bị tràn ngang. 0 (hoặc 1 do làm tròn) = không tràn.
 *
 * TỪNG có NĂM bản chép của hàm này, mỗi file `*.mobile.spec.ts` một bản — và chúng ĐÃ TRÔI:
 * bốn bản trả về số pixel, riêng bản trong `shared-kit.mobile.spec.ts` trả về boolean với
 * ngưỡng `+1` nằm bên trong. Cùng một cái tên, hai ý nghĩa khác nhau, không có gì báo.
 * Đúng lý do AD-15 cấm bản sao: bản sao không sai lúc chép, nó sai dần về sau.
 */
/**
 * Bấm nút XÁC NHẬN trong hộp hỏi lại (`ConfirmDialog`).
 *
 * Không bám vào chữ trên nút: nhãn giờ là ĐỘNG TỪ của hành động ("Khoá", "Xoá", "Gỡ"…) chứ
 * không còn là "Đồng ý" chung chung — đó là chủ đích, vì hộp hỏi "Khoá tài khoản A?" mà nút
 * ghi "Đồng ý" thì người dùng phải đọc lại câu hỏi mới biết mình sắp làm gì. Bám vào vị trí
 * (nút cuối trong chân hộp, sau nút Hủy — thứ tự nhất quán toàn app) để đổi câu chữ không
 * làm đỏ 16 bài kiểm.
 *
 * Truyền `label` khi bài kiểm CỐ TÌNH muốn chốt đúng chữ trên nút.
 */
export async function confirmAction(page: Page, label?: string): Promise<void> {
  const footer = page.locator('.sheet-footer').last();
  if (label) {
    await footer.getByRole('button', { name: label }).click();
    return;
  }
  await footer.getByRole('button').last().click();
}

/**
 * Đăng xuất qua giao diện, dùng được ở CẢ desktop lẫn 390px.
 *
 * Nút "Đăng xuất" nằm ở chân sidebar — mà ở màn hẹp sidebar là drawer đang đóng. Bản chép
 * trong từng spec chỉ bấm thẳng nút nên treo 60 giây ở 390px; gom về đây theo AD-15.
 */
export async function logout(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('header.topbar')).toBeVisible();
  const openNav = page.getByRole('button', { name: 'Mở menu' });
  if (await openNav.count()) await openNav.click();
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
}

/**
 * Mở drawer điều hướng ở viewport hẹp (≤900px).
 *
 * Ở 390px sidebar KHÔNG nằm sẵn trong DOM (nó ăn 60% bề ngang điện thoại), nên muốn bấm một
 * mục nav thì phải mở drawer trước. Để ở đây thay vì chép vào từng `*.mobile.spec.ts` — AD-15.
 */
export async function openNavDrawer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Mở menu' }).click();
}

export function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
