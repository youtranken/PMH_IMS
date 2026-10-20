import { expect, test, type Page } from '@playwright/test';
import {
  fillOtp,
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  NEW_PASSWORD,
  clearMailbox,
  confirmAction,
  firstLogin,
  horizontalOverflow,
  mailedApprovalCode,
  loginWithTotp,
  logout,
  mailBody,
  resetAccessList,
  resetApprovals,
  resetDevices,
  resetSecrets,
  resetUsers,
  waitForMail,
  stepUpViaApi,
} from './helpers';

/**
 * Luồng break-glass trên ĐIỆN THOẠI (390×844) — ưu tiên số 1 của chủ dự án (VLT-FLOW).
 *
 * Q-30: người duyệt đọc thư mang mã trên điện thoại (IMS chỉ trong LAN, không mở được từ ngoài),
 * đồng ý thì đọc mã cho người xin; người xin nhập mã ở khung Két trên điện thoại của họ. Trang
 * chi tiết vẫn đủ để Từ chối mà không phải cuộn. Người xin nhận thư kết quả (VLT-005), rút được
 * yêu cầu (VLT-007), và toast sau khi gửi nói đúng số giờ (VLT-006).
 */

test.beforeEach(() => {
  resetUsers();
  resetApprovals();
  resetAccessList();
  resetSecrets();
  resetDevices();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function headersOf(page: Page) {
  return { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
}

/** SA dựng máy + một ngăn két, gán Member tầng "cần duyệt" trên loại Switch. */
async function seedDevice(page: Page, stamp: string): Promise<{ deviceId: string; code: string }> {
  const headers = await headersOf(page);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const typeId = catalog.deviceTypes.find((t) => t.name === 'Switch')!.id;
  const code = `SW-E2E-BGDT-${stamp}`;
  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code, name: 'Switch lõi tầng 3', deviceTypeId: typeId },
  });
  expect(device.ok(), 'không dựng được thiết bị').toBeTruthy();
  const deviceId = ((await device.json()) as { device: { id: string } }).device.id;
  await page.request.post('/api/v1/vault/secrets', {
    headers,
    data: {
      ownerType: 'device',
      ownerId: deviceId,
      kind: 'password',
      label: `enable E2E ${stamp}`,
      value: `Bg#${stamp}`,
    },
  });
  const access = await page.request.post('/api/v1/vault/access', {
    headers,
    data: {
      memberEmail: E2E_MEMBER.email,
      scopeType: 'device_type',
      scopeRef: typeId,
      tier: 'needs_approval',
    },
  });
  expect(access.ok(), 'không gán được tầng "cần duyệt"').toBeTruthy();
  return { deviceId, code };
}

/**
 * SA dựng máy → Member xin qua API → SA đăng nhập lại. Trả id phiếu + TOTP của cả hai.
 *
 * Người xin ở ngữ cảnh trình duyệt riêng. Phiếu chờ không gắn phiên (Q-15) nên người xin đăng
 * xuất hay không cũng không đổi gì ở phía người duyệt; ngữ cảnh riêng chỉ để `page` là của SA.
 */
async function pendingRequest(page: Page, hours = 4) {
  const stamp = Date.now().toString().slice(-6);
  const saTotp = await firstLogin(page, E2E_SA);
  await stepUpViaApi(page, saTotp);
  const { deviceId, code } = await seedDevice(page, stamp);
  await logout(page);

  const memberCtx = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
  const member = await memberCtx.newPage();
  const memberTotp = await firstLogin(member, E2E_MEMBER);
  await stepUpViaApi(member, memberTotp);
  const asked = await member.request.post('/api/v1/vault/break-glass', {
    headers: await headersOf(member),
    data: {
      ownerType: 'device',
      ownerId: deviceId,
      reason: `E2E ${stamp}: switch tầng 3 mất kết nối, cần vào cấu hình VLAN`,
      hours,
      approver: E2E_SA.email,
    },
  });
  expect(asked.status()).toBe(201);
  const approvalId = ((await asked.json()) as { id: string }).id;
  return { stamp, saTotp, memberTotp, deviceId, code, approvalId, member, memberCtx };
}

/** Người xin chọn người duyệt trong hộp Xin mở két (Q-30). */
async function pickApprover(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: /Người duyệt/ }).click();
  await page.getByRole('option', { name: E2E_SA.email }).click();
}

test.describe('Duyệt break-glass bằng mã, 390px (Q-30)', () => {
  test.setTimeout(180_000);

  test('đường hạnh phúc: thư mang mã tới đúng người duyệt → người xin nhập mã trên điện thoại → nhận thư đã duyệt', async ({
    page,
  }) => {
    const { code, deviceId, approvalId, member, memberCtx } = await pendingRequest(page);

    // Thư mang mã: chỉ tới người được chọn, tiêu đề nói ai · máy nào · bao lâu nhưng KHÔNG có mã.
    const asking = await waitForMail(`· ${code} (4 giờ)`);
    expect(asking.length, 'thư mang mã phải có mã máy và số giờ trong tiêu đề').toBeGreaterThan(0);
    expect(asking[0].Subject).toMatch(/^\[IMS\] Mã duyệt mở két: /);
    expect(asking[0].To.map((to) => to.Address)).toEqual([E2E_SA.email]);
    const askingBody = await mailBody(asking[0].ID);
    const mailed = /Mã duyệt\D{0,40}?(\d{6})/.exec(askingBody)![1];
    expect(asking[0].Subject, 'tiêu đề hiện trên màn khoá — không được có mã').not.toContain(mailed);
    expect(askingBody).toContain(`/approvals/${approvalId}`);
    expect(askingBody, 'thư KHÔNG được có tên ngăn két').not.toContain('enable E2E');

    // Người xin trên điện thoại: khung chờ nói mã gửi tới ai, ô 6 số nằm trong khung nhìn.
    await member.setViewportSize({ width: 390, height: 844 });
    await clearMailbox();
    await member.goto(`/devices/${deviceId}?tab=vault`);
    await expect(member.getByText(/Mã duyệt đã gửi tới .* \(còn hiệu lực \d+ phút\)/)).toBeVisible();
    expect(await horizontalOverflow(member)).toBeLessThanOrEqual(1);
    await fillOtp(member, mailed, 'Mã duyệt do người duyệt đọc cho bạn');
    await expect(member.getByText('Đã được duyệt — bấm "Xem" ở ngăn cần mở.')).toBeVisible();

    // Người xin nhận thư kết quả, có nút mở thẳng két của hồ sơ.
    const decided = await waitForMail(`[IMS] Đã duyệt: mở két ${code}`);
    expect(decided.length, 'người xin phải nhận thư "đã duyệt"').toBeGreaterThan(0);
    expect(decided[0].To.map((to) => to.Address)).toEqual([E2E_MEMBER.email]);
    expect(await mailBody(decided[0].ID)).toContain(`/devices/${deviceId}?tab=vault`);
    await memberCtx.close();
  });

  test('người duyệt mở link trong thư: đủ để quyết trong một màn, chỉ có Từ chối, không có Duyệt', async ({
    page,
  }) => {
    const { saTotp, deviceId, code, approvalId, memberCtx } = await pendingRequest(page);
    await memberCtx.close();
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    await stepUpViaApi(page, saTotp);
    await page.goto(`/approvals/${approvalId}`);

    const subject = page.getByRole('link', { name: new RegExp(`^${code} · Switch lõi tầng 3`) });
    await expect(subject).toBeInViewport();
    await expect(subject).toHaveAttribute('href', `/devices/${deviceId}`);
    await expect(page.getByText(/switch tầng 3 mất kết nối/)).toBeInViewport();
    await expect(page.getByText(/đọc mã trong thư cho người xin/)).toBeVisible();
    const deny = page.getByRole('button', { name: 'Từ chối', exact: true });
    await expect(deny).toBeInViewport();
    const box = await deny.boundingBox();
    expect(box!.height, 'nút trong thanh đáy phải cao ≥ 48px — chạm bằng ngón cái').toBeGreaterThanOrEqual(47);
    await expect(page.getByRole('button', { name: /^Duyệt/ })).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('từ chối phải ghi lý do; người xin nhận đúng lý do trong thư', async ({ page }) => {
    const { saTotp, code, approvalId, memberCtx } = await pendingRequest(page);
    await memberCtx.close();
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    await stepUpViaApi(page, saTotp);
    await clearMailbox();
    await page.goto(`/approvals/${approvalId}`);

    await page.getByRole('button', { name: 'Từ chối', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Từ chối', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Ghi lý do từ chối');
    const still = await page.request.get(`/api/v1/vault/break-glass/${approvalId}`);
    expect(((await still.json()) as { state: string }).state, 'chưa ghi lý do thì CHƯA từ chối').toBe(
      'pending',
    );

    await dialog.getByRole('button', { name: 'Lý do chưa đủ cụ thể' }).click();
    await dialog.getByRole('button', { name: 'Từ chối', exact: true }).click();
    await expect(page.getByText(/Đã từ chối bởi/)).toBeVisible();

    const denied = await waitForMail(`[IMS] Bị từ chối: mở két ${code}`);
    expect(denied.length).toBeGreaterThan(0);
    expect(denied[0].To.map((to) => to.Address)).toEqual([E2E_MEMBER.email]);
    expect(await mailBody(denied[0].ID)).toContain('Lý do chưa đủ cụ thể');
  });
});

test.describe('Phía người xin, 390px', () => {
  test.setTimeout(150_000);

  test('gửi yêu cầu: toast nói đúng, khung Két đổi sang trạng thái chờ và rút được', async ({
    page,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    await stepUpViaApi(page, await firstLogin(page, E2E_SA));
    const { deviceId } = await seedDevice(page, stamp);
    await logout(page);

    await stepUpViaApi(page, await firstLogin(page, E2E_MEMBER));
    await page.goto(`/devices/${deviceId}?tab=vault`);
    await page.getByRole('button', { name: 'Xin mở két' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Lý do' }).fill(`E2E ${stamp}: cần đổi VLAN`);
    await form.getByRole('textbox', { name: 'Xin trong bao lâu (giờ)' }).fill('4');
    await pickApprover(page);
    await form.getByRole('button', { name: 'Gửi yêu cầu' }).click();

    // Không còn cảnh báo "vượt trần… chỉ còn  giờ" sai ở mỗi lần gửi.
    await expect(page.getByText('Đã gửi yêu cầu. Người duyệt sẽ nhận thư có mã.')).toBeVisible();
    await expect(page.getByText(/vượt mức tối đa/)).toHaveCount(0);

    await expect(page.getByText(/đang chờ mã duyệt/)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // Phiếu của chính mình trên trang chi tiết: không duyệt được, chỉ rút.
    await page.getByRole('link', { name: 'Xem yêu cầu' }).click();
    await expect(page.getByText('Cần người khác duyệt')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Duyệt/ })).toHaveCount(0);

    await page.goBack();
    await page.getByRole('button', { name: 'Rút yêu cầu' }).click();
    await confirmAction(page, 'Rút yêu cầu');
    await expect(page.getByText('Đã rút yêu cầu.')).toBeVisible();
    // Rút xong thì xin lại được ngay — một-phiếu-treo không còn chặn.
    await expect(page.getByRole('button', { name: 'Xin mở két' })).toBeVisible();
  });
});

test.describe('Hộp Từ chối từ danh sách, 390px (VLT-008, B1)', () => {
  test.setTimeout(180_000);

  test('tiêu đề ngắn, thân hộp nêu người xin · đối tượng · lý do, nút Từ chối nằm trong khung nhìn', async ({
    page,
  }) => {
    const { saTotp, code, stamp, memberCtx } = await pendingRequest(page);
    await memberCtx.close();
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    await stepUpViaApi(page, saTotp);
    await page.goto('/approvals');
    await page.getByRole('tabpanel').getByRole('button', { name: 'Từ chối', exact: true }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Từ chối yêu cầu', exact: true });
    await expect(dialog).toBeVisible();
    // Tiêu đề một dòng ở 390px — không gãy hai dòng vì email dài.
    const heading = await dialog.getByRole('heading', { name: 'Từ chối yêu cầu', exact: true }).boundingBox();
    expect(heading!.height, 'tiêu đề hộp phải nằm trên một dòng').toBeLessThan(40);
    await expect(dialog.getByText(E2E_MEMBER.email)).toBeVisible();
    await expect(dialog.getByRole('link', { name: new RegExp(`^${code}`) })).toBeVisible();
    await expect(dialog.getByText(new RegExp(`E2E ${stamp}: switch tầng 3`))).toBeVisible();

    // Hộp cao theo nội dung, nút chính trong khung nhìn — không bị thanh công cụ đáy che.
    await expect(dialog.getByRole('button', { name: 'Từ chối', exact: true })).toBeInViewport({ ratio: 1 });
    const box = await dialog.boundingBox();
    expect(box!.height, 'hộp không được chiếm gần hết màn 844px').toBeLessThan(844 * 0.9);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});

test.describe('Ngữ cảnh để quyết và để chờ, 390px (VLT-FLOW)', () => {
  test.setTimeout(180_000);

  test('người duyệt: đầu trang "Gửi … trước", khối người xin có vai và số lần xin', async ({ page }) => {
    const { saTotp, approvalId, memberCtx } = await pendingRequest(page);
    await memberCtx.close();
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    await stepUpViaApi(page, saTotp);
    await page.goto(`/approvals/${approvalId}`);

    const ago = page.getByText(/^Gửi (vừa xong|\d+ phút trước)$/);
    await expect(ago).toBeInViewport();
    // Giờ tuyệt đối vẫn đọc được khi rê chuột / trình đọc màn hình.
    await expect(ago).toHaveAttribute('title', /\d{2}\/\d{2}\/\d{4}/);

    const person = page.getByRole('region', { name: 'Người xin' });
    await expect(person.getByText('Thành viên', { exact: true })).toBeVisible();
    await expect(person.getByText(/^Lần xin (đầu tiên|thứ \d+) trong \d+ ngày qua$/)).toBeVisible();
    // Chỉ con số — khối này không dẫn tới các lần xin khác.
    await expect(person.getByRole('link')).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('người xin tự đọc phiếu mình: không nhận ngữ cảnh của người duyệt', async ({ page }) => {
    const { memberTotp, approvalId, memberCtx } = await pendingRequest(page);
    await memberCtx.close();
    await loginWithTotp(page, E2E_MEMBER.email, NEW_PASSWORD, memberTotp);
    await stepUpViaApi(page, memberTotp);
    const own = await page.request.get(`/api/v1/vault/break-glass/${approvalId}`);
    const body = (await own.json()) as { recentCount: unknown; requesterRole: unknown };
    expect(body.recentCount).toBeNull();
    expect(body.requesterRole).toBeNull();
    await page.goto(`/approvals/${approvalId}`);
    await expect(page.getByText(/^Lần xin/)).toHaveCount(0);
  });

  /**
   * Phiếu chờ không gắn phiên (Q-15): khung chờ nói cứ đóng trang. Q-30: khung nói mã đã gửi tới
   * ai, người xin nhập mã ngay trên điện thoại; được duyệt thì đếm lùi, nói quyền gắn phiên, có
   * nút Trả quyền — tất cả ở 390px, vì người trực xin và trả ngay trên điện thoại.
   */
  test('người xin: khung chờ nói mã gửi tới ai; nhập mã xong thì đếm lùi, trả quyền được', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const saCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const sa = await saCtx.newPage();
    await stepUpViaApi(sa, await firstLogin(sa, E2E_SA));
    const { deviceId } = await seedDevice(sa, stamp);
    await saCtx.close();

    await stepUpViaApi(page, await firstLogin(page, E2E_MEMBER));
    await page.goto(`/devices/${deviceId}?tab=vault`);
    await page.getByRole('button', { name: 'Xin mở két' }).click();
    const form = page.getByRole('dialog');
    await expect(form.getByText(/đăng xuất hay hết phiên/)).toBeVisible();
    await form.getByRole('textbox', { name: 'Lý do' }).fill(`E2E ${stamp}: switch tầng 3 mất kết nối`);
    await form.getByRole('textbox', { name: 'Xin trong bao lâu (giờ)' }).fill('4');
    await pickApprover(page);
    await form.getByRole('button', { name: 'Gửi yêu cầu' }).click();
    await expect(page.getByText(/Bạn có thể đóng trang/)).toBeVisible();
    await expect(page.getByText(/Giữ trang này mở/)).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    const approvalId = (
      (await (await page.request.get('/api/v1/vault/break-glass/mine')).json()) as {
        items: { id: string; subjectId: string; state: string }[];
      }
    ).items.find((r) => r.subjectId === deviceId && r.state === 'pending')!.id;
    // Thư vừa đi thì khung đổi từ "đang gửi" sang "mã đã gửi tới …" trong vài giây, không phải F5.
    const mailed = await mailedApprovalCode(approvalId);
    await expect(page.getByText(/Mã duyệt đã gửi tới/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gửi lại mã (còn 3 lần)' })).toBeInViewport();
    await fillOtp(page, mailed, 'Mã duyệt do người duyệt đọc cho bạn');

    await expect(page.getByText(/Bạn được xem tới .* \(còn 3 giờ 5\d phút\)/)).toBeVisible();
    await expect(page.getByText(/gắn với phiên đăng nhập này/)).toBeVisible();
    const release = page.getByRole('button', { name: 'Trả quyền' });
    await expect(release).toBeInViewport();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await release.click();
    await confirmAction(page, 'Trả quyền');
    await expect(page.getByText(/Đã trả quyền/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xin mở két' })).toBeVisible();
  });
});
