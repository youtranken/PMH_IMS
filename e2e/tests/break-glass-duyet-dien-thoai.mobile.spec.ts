import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  NEW_PASSWORD,
  clearMailbox,
  confirmAction,
  expireStepUp,
  firstLogin,
  freshTotpCode,
  horizontalOverflow,
  loginWithTotp,
  logout,
  mailBody,
  resetAccessList,
  resetApprovals,
  resetDevices,
  resetSecrets,
  resetUsers,
  waitForMail,
} from './helpers';

/**
 * Luồng break-glass trên ĐIỆN THOẠI (390×844) — ưu tiên số 1 của chủ dự án (VLT-FLOW).
 *
 * Người duyệt mở link trong thư, thấy ngay máy nào, lý do, thời hạn, và quyết bằng thanh dính
 * đáy mà không phải cuộn. Duyệt đòi step-up: quá 10 phút sau đăng nhập thì hộp mã 6 số phải
 * hiện ngay tại chỗ (VLT-002). Người xin nhận thư kết quả (VLT-005), rút được yêu cầu
 * (VLT-007), và toast sau khi gửi nói đúng số giờ (VLT-006).
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
 * Bốn lượt đổi người là cái giá của "xin ở phiên này, duyệt ở phiên khác".
 */
async function pendingRequest(page: Page, hours = 4) {
  const stamp = Date.now().toString().slice(-6);
  const saTotp = await firstLogin(page, E2E_SA);
  const { deviceId, code } = await seedDevice(page, stamp);
  await logout(page);

  const memberTotp = await firstLogin(page, E2E_MEMBER);
  const asked = await page.request.post('/api/v1/vault/break-glass', {
    headers: await headersOf(page),
    data: {
      ownerType: 'device',
      ownerId: deviceId,
      reason: `E2E ${stamp}: switch tầng 3 mất kết nối, cần vào cấu hình VLAN`,
      hours,
    },
  });
  expect(asked.status()).toBe(201);
  const approvalId = ((await asked.json()) as { id: string }).id;
  await logout(page);
  return { stamp, saTotp, memberTotp, deviceId, code, approvalId };
}

test.describe('Duyệt break-glass từ trang chi tiết, 390px', () => {
  test.setTimeout(180_000);

  test('đường hạnh phúc: mở link thư → thấy đủ không cần cuộn → chạm hai lần → người xin nhận thư', async ({
    page,
  }) => {
    const { saTotp, deviceId, code, approvalId } = await pendingRequest(page);

    // Thư xin duyệt nói máy nào, bao nhiêu giờ, và trỏ thẳng trang chi tiết.
    const asking = await waitForMail(`xin mở két ${code} (4 giờ)`);
    expect(asking.length, 'thư xin duyệt phải có mã máy và số giờ trong tiêu đề').toBeGreaterThan(0);
    expect(asking[0].Subject).toMatch(/^\[IMS\] Duyệt: /);
    const askingBody = await mailBody(asking[0].ID);
    expect(askingBody).toContain(`/approvals/${approvalId}`);
    expect(askingBody).toContain('Xem và duyệt');
    expect(askingBody, 'thư KHÔNG được có tên ngăn két').not.toContain('enable E2E');

    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    await clearMailbox();
    await page.goto(`/approvals/${approvalId}`);

    // Đủ để quyết, trong một màn 844px, không cuộn.
    const subject = page.getByRole('link', { name: new RegExp(`^${code} · Switch lõi tầng 3`) });
    await expect(subject).toBeInViewport();
    await expect(subject).toHaveAttribute('href', `/devices/${deviceId}`);
    await expect(page.getByText(/switch tầng 3 mất kết nối/)).toBeInViewport();
    const approve = page.getByRole('button', { name: 'Duyệt 4 giờ' });
    await expect(approve).toBeInViewport();
    const box = await approve.boundingBox();
    expect(box!.height, 'nút chính phải cao ≥ 48px — chạm bằng ngón cái').toBeGreaterThanOrEqual(47);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // Chạm lần đầu chỉ hỏi lại, chưa cấp gì.
    await approve.click();
    await page.getByRole('button', { name: 'Chạm lần nữa để cấp 4 giờ' }).click();
    await expect(page.getByText(/Đã cấp cho .* tới/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Duyệt/ })).toHaveCount(0);

    // Người xin nhận thư kết quả, có nút mở thẳng két của hồ sơ.
    const decided = await waitForMail(`[IMS] Đã duyệt: mở két ${code}`);
    expect(decided.length, 'người xin phải nhận thư "đã duyệt"').toBeGreaterThan(0);
    expect(decided[0].To.map((to) => to.Address)).toEqual([E2E_MEMBER.email]);
    expect(await mailBody(decided[0].ID)).toContain(`/devices/${deviceId}?tab=vault`);
  });

  test('đã quá 10 phút sau đăng nhập: duyệt vẫn đi tiếp được qua hộp mã 6 số (VLT-002)', async ({
    page,
  }) => {
    const { saTotp, approvalId } = await pendingRequest(page);
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    expireStepUp(E2E_SA.email);

    await page.goto(`/approvals/${approvalId}`);
    await page.getByRole('button', { name: 'Duyệt 4 giờ' }).click();
    await page.getByRole('button', { name: 'Chạm lần nữa để cấp 4 giờ' }).click();

    // Không phải một dòng lỗi "nhập mã" mà không có ô nào: hộp mã hiện ngay tại chỗ.
    await expect(page.getByRole('heading', { name: 'Xác nhận danh tính' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await page.getByLabel('Mã xác thực').fill(await freshTotpCode(saTotp));

    await expect(page.getByText(/Đã cấp cho .* tới/)).toBeVisible();
  });

  test('từ chối phải ghi lý do; người xin nhận đúng lý do trong thư', async ({ page }) => {
    const { saTotp, code, approvalId } = await pendingRequest(page);
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
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
    await firstLogin(page, E2E_SA);
    const { deviceId } = await seedDevice(page, stamp);
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    await page.goto(`/devices/${deviceId}?tab=vault`);
    await page.getByRole('button', { name: 'Xin quyền xem' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Lý do' }).fill(`E2E ${stamp}: cần đổi VLAN`);
    await form.getByRole('textbox', { name: 'Xin trong bao lâu (giờ)' }).fill('4');
    await form.getByRole('button', { name: 'Gửi yêu cầu' }).click();

    // Không còn cảnh báo "vượt trần… chỉ còn  giờ" sai ở mỗi lần gửi.
    await expect(page.getByText('Đã gửi yêu cầu. Quản trị sẽ nhận được email.')).toBeVisible();
    await expect(page.getByText(/vượt trần/)).toHaveCount(0);

    await expect(page.getByText(/đang chờ Quản trị quyết/)).toBeVisible();
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
    await expect(page.getByRole('button', { name: 'Xin quyền xem' })).toBeVisible();
  });
});

test.describe('Hộp Duyệt từ danh sách, 390px (VLT-008, B1)', () => {
  test.setTimeout(180_000);

  test('tiêu đề ngắn, thân hộp nêu người xin · đối tượng · lý do, nút Duyệt nằm trong khung nhìn', async ({
    page,
  }) => {
    const { saTotp, code, stamp } = await pendingRequest(page);
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    await page.goto('/approvals');
    await page.getByRole('tabpanel').getByRole('button', { name: 'Duyệt', exact: true }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Duyệt yêu cầu', exact: true });
    await expect(dialog).toBeVisible();
    // Tiêu đề một dòng ở 390px — không còn "Duyệt yêu cầu của <email dài>" gãy hai dòng.
    const heading = await dialog.getByRole('heading', { name: 'Duyệt yêu cầu', exact: true }).boundingBox();
    expect(heading!.height, 'tiêu đề hộp Duyệt phải nằm trên một dòng').toBeLessThan(40);
    await expect(dialog.getByText(E2E_MEMBER.email)).toBeVisible();
    await expect(dialog.getByRole('link', { name: new RegExp(`^${code}`) })).toBeVisible();
    await expect(dialog.getByText(new RegExp(`E2E ${stamp}: switch tầng 3`))).toBeVisible();

    // Hộp cao theo nội dung, nút chính trong khung nhìn — không bị thanh công cụ đáy che.
    const approve = dialog.getByRole('button', { name: /^Duyệt \d+ giờ$/ });
    await expect(approve).toBeInViewport({ ratio: 1 });
    const box = await dialog.boundingBox();
    expect(box!.height, 'hộp ba ô không được chiếm gần hết màn 844px').toBeLessThan(844 * 0.9);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('số giờ gõ chữ → lỗi tiếng Việt dưới ô, phiếu vẫn chờ (không bong bóng tiếng Anh)', async ({
    page,
  }) => {
    const { saTotp, approvalId } = await pendingRequest(page);
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    await page.goto('/approvals');
    await page.getByRole('tabpanel').getByRole('button', { name: 'Duyệt', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Duyệt yêu cầu', exact: true });
    await dialog.getByLabel('Cấp trong bao lâu (giờ)').fill('hai');
    await dialog.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await expect(dialog.getByText('Số giờ phải là một số nguyên lớn hơn 0. Ví dụ: 4')).toBeVisible();
    await expect(dialog.getByLabel('Cấp trong bao lâu (giờ)')).toBeFocused();
    const still = await page.request.get(`/api/v1/vault/break-glass/${approvalId}`);
    expect(((await still.json()) as { state: string }).state).toBe('pending');
  });
});

test.describe('Ngữ cảnh để quyết và để chờ, 390px (VLT-FLOW)', () => {
  test.setTimeout(180_000);

  test('người duyệt: đầu trang "Gửi … trước", khối người xin có vai và số lần xin', async ({ page }) => {
    const { saTotp, approvalId } = await pendingRequest(page);
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
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
    const { memberTotp, approvalId } = await pendingRequest(page);
    await loginWithTotp(page, E2E_MEMBER.email, NEW_PASSWORD, memberTotp);
    const own = await page.request.get(`/api/v1/vault/break-glass/${approvalId}`);
    const body = (await own.json()) as { recentCount: unknown; requesterRole: unknown };
    expect(body.recentCount).toBeNull();
    expect(body.requesterRole).toBeNull();
    await page.goto(`/approvals/${approvalId}`);
    await expect(page.getByText(/^Lần xin/)).toHaveCount(0);
  });

  /**
   * Người xin GIỮ phiên suốt lúc chờ: quyền chỉ dùng được trong phiên đã xin (Q-15). Người duyệt
   * ở ngữ cảnh riêng. Được duyệt thì khung két đếm lùi, nói quyền hết khi đăng xuất, và có nút
   * Trả quyền — tất cả ở 390px, vì người trực xin và trả ngay trên điện thoại.
   */
  test('người xin: khung chờ nói đã báo bao nhiêu người duyệt; được duyệt thì đếm lùi, trả quyền được', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const saCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const sa = await saCtx.newPage();
    await firstLogin(sa, E2E_SA);
    const { deviceId } = await seedDevice(sa, stamp);

    await firstLogin(page, E2E_MEMBER);
    await page.goto(`/devices/${deviceId}?tab=vault`);
    await page.getByRole('button', { name: 'Xin quyền xem' }).click();
    const form = page.getByRole('dialog');
    await expect(form.getByText(/đăng xuất hay hết phiên/)).toBeVisible();
    await form.getByRole('textbox', { name: 'Lý do' }).fill(`E2E ${stamp}: switch tầng 3 mất kết nối`);
    await form.getByRole('textbox', { name: 'Xin trong bao lâu (giờ)' }).fill('4');
    await form.getByRole('button', { name: 'Gửi yêu cầu' }).click();
    await expect(page.getByText(/^Đã báo \d+ người duyệt qua email\.$/)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // SA vừa đăng nhập bằng mã 2 lớp = vừa step-up, duyệt qua API được ngay.
    const pending = (await (await sa.request.get('/api/v1/vault/break-glass/pending')).json()) as {
      id: string;
      subjectId: string;
    }[];
    const approvalId = pending.find((r) => r.subjectId === deviceId)!.id;
    const approved = await sa.request.post(`/api/v1/vault/break-glass/${approvalId}/approve`, {
      headers: await headersOf(sa),
      data: { hours: 4 },
    });
    expect(approved.status()).toBe(201);
    await saCtx.close();

    await page.reload();
    await expect(page.getByText(/Bạn được xem tới .* \(còn 3 giờ 5\d phút\)/)).toBeVisible();
    await expect(page.getByText(/đăng xuất hay hết phiên/)).toBeVisible();
    const release = page.getByRole('button', { name: 'Trả quyền' });
    await expect(release).toBeInViewport();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await release.click();
    await confirmAction(page, 'Trả quyền');
    await expect(page.getByText(/Đã trả quyền/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xin quyền xem' })).toBeVisible();
  });
});
