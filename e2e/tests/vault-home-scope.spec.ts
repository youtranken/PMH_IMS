import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  logout,
  resetAccessList,
  resetDevices,
  resetIsp,
  resetSecrets,
  resetSoftware,
  resetUsers,
  sql,
  uniqueStamp,
} from './helpers';

/**
 * Đợt 3 UI, phần két sắt:
 *  - `/vault` là CỬA VÀO (tìm hồ sơ → mở thẳng tab Két sắt), KHÔNG phải danh sách secret —
 *    FR-026 cấm mọi đường lấy secret qua nhiều chủ thể.
 *  - Ma trận quyền có chiều nhìn thứ hai: theo NHÓM ĐỐI TƯỢNG, để trả lời được "nhóm này ai
 *    đang xem được".
 */
test.beforeEach(() => {
  resetUsers();
  resetAccessList();
  resetDevices();
  resetSoftware();
  resetIsp();
  resetSecrets();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function createDevice(page: Page, code: string): Promise<string> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
    data: { code, name: `Máy ${code}`, deviceTypeId: pc.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

/** Cất một secret vào một chủ thể, để trang tổng có cái mà liệt kê. */
async function stash(
  page: Page,
  /* `isp` là loại thứ TƯ, thêm ở 0036 — `file.owner_type` nhận đường truyền từ lâu nên hợp
     đồng PDF đính vào được mà mật khẩu PPPoE thì không, và người ta chép nó vào ô Ghi chú. */
  ownerType: 'device' | 'software' | 'isp',
  ownerId: string,
  label: string,
): Promise<void> {
  const created = await page.request.post('/api/v1/vault/secrets', {
    headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
    data: { ownerType, ownerId, kind: 'password', label, value: 'Mat-Khau#2026' },
  });
  expect(created.status()).toBe(201);
}

test.describe('Trang tổng Két sắt', () => {
  test('mục Két sắt vào được, liệt kê hồ sơ đang giữ két và mở xem ngay trong popup', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `PC-E2E-VH-${stamp}`;
    const deviceId = await createDevice(page, code);
    await stash(page, 'device', deviceId, `admin-${stamp}`);

    // Trước đây mục này hiện MỜ (planned) nên bấm không đi đâu — người dùng tưởng chưa làm.
    // `exact` vì sidebar còn một mục "Quyền két sắt" — khớp lỏng là trúng cả hai.
    await page.getByRole('link', { name: 'Két sắt', exact: true }).click();
    await expect(page).toHaveURL(/\/vault$/);
    await expect(page.getByRole('heading', { name: 'Két sắt' })).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Thiết bị')).toBeVisible();

    // Bấm là mở POPUP tại chỗ — không chuyển trang, nên không phải bấm quay lại.
    await row.getByRole('button', { name: `Mở két của ${code}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`admin-${stamp}`)).toBeVisible();
    await expect(page).toHaveURL(/\/vault$/);

    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible();
  });

  test('lọc theo loại chọn được nhiều cùng lúc, và tìm theo mã', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceCode = `PC-E2E-VF-${stamp}`;
    const deviceId = await createDevice(page, deviceCode);
    await stash(page, 'device', deviceId, `pw-${stamp}`);

    const swCode = `LIC-E2E-VF-${stamp}`;
    const sw = await page.request.post('/api/v1/software', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: { code: swCode, name: 'License có key', kind: 'license', endDate: '2028-12-31' },
    });
    expect(sw.status()).toBe(201);
    await stash(page, 'software', ((await sw.json()) as { id: string }).id, `key-${stamp}`);

    await page.goto('/vault');
    const deviceRow = page.getByRole('row', { name: new RegExp(deviceCode) });
    const swRow = page.getByRole('row', { name: new RegExp(swCode) });
    await expect(deviceRow).toBeVisible();
    await expect(swRow).toBeVisible();

    // Bật lọc "Thiết bị": phần mềm biến mất.
    await page.getByRole('button', { name: /^Thiết bị \d+$/ }).click();
    await expect(deviceRow).toBeVisible();
    await expect(swRow).toHaveCount(0);

    // Bật thêm "Phần mềm" — hai nút độc lập, chọn cả hai thì thấy cả hai.
    await page.getByRole('button', { name: /^Phần mềm \d+$/ }).click();
    await expect(deviceRow).toBeVisible();
    await expect(swRow).toBeVisible();

    await page.getByRole('searchbox', { name: /Tìm/ }).fill(swCode);
    await expect(swRow).toBeVisible();
    await expect(deviceRow).toHaveCount(0);
  });

  /**
   * LOẠI THỨ TƯ: đường truyền. Ba hỏng cùng một gốc (rà UI/UX 12/09, mục #2).
   *
   * `SECRET_OWNER_TYPES` bên API có bốn loại, và `isp-detail.tsx` render hẳn
   * `<VaultPanel ownerType="isp">` — nhưng trang tổng khai một union RIÊNG chỉ có ba. Không
   * có gì đỏ, vì cả ba chỗ dùng nó đều kết bằng một nhánh vét:
   *
   *   (a) cột "Loại" tra `OWNER_LABEL['isp']` → `undefined` → ô TRỐNG;
   *   (b) dãy nút lọc gõ tay ba loại, mà lọc là "giữ dòng nào thuộc loại ĐÃ CHỌN" → bật bất kỳ
   *       nút nào là mọi dòng đường truyền biến mất, không một lời;
   *   (c) "Mở hồ sơ đầy đủ" chạy chuỗi `if` kết bằng `return PATHS.softwareItem(...)` → mở
   *       trang PHẦN MỀM với id của đường truyền.
   *
   * Ba vế dưới đây soi đúng ba cái đó. Bài này CHỈ có nghĩa khi màn thật sự có dòng đường
   * truyền, nên vế đầu chốt luôn điều ấy.
   */
  test('đường truyền cũng là chủ két: hiện đúng loại, lọc được, và link mở đúng hồ sơ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    const ispCode = `ISP-E2E-VK-${stamp}`;
    const line = await page.request.post('/api/v1/isp-lines', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        code: ispCode,
        provider: 'FPT Telecom',
        bandwidth: '200 Mbps',
        contractNo: `HD-${stamp}`,
        startDate: '2026-06-30',
      },
    });
    expect(line.status()).toBe(201);
    const ispId = String(((await line.json()) as { id: string }).id);
    /* Nhãn phải mang chữ E2E: nếu hồ sơ gốc đã bị xoá trước thì ngăn két thành mồ côi,
       và `secrets: DELETE ... label ILIKE '%E2E%'` là đường dọn CUỐI với tới nó. */
    await stash(page, 'isp', ispId, `pppoe E2E ${stamp}`);

    const deviceCode = `PC-E2E-VK-${stamp}`;
    const deviceId = await createDevice(page, deviceCode);
    await stash(page, 'device', deviceId, `pw-${stamp}`);

    await page.goto('/vault');
    const ispRow = page.getByRole('row', { name: new RegExp(ispCode) });
    const deviceRow = page.getByRole('row', { name: new RegExp(deviceCode) });
    await expect(ispRow).toBeVisible();

    // (a) Cột "Loại" phải có chữ — ô trống là dấu hiệu `Record` thiếu khóa.
    await expect(
      ispRow.getByText('Đường truyền'),
      'cột Loại của một dòng đường truyền không được để trống',
    ).toBeVisible();

    // (b) Lọc "Thiết bị" thì đường truyền đi; lọc thêm "Đường truyền" thì nó phải QUAY LẠI.
    await page.getByRole('button', { name: /^Thiết bị \d+$/ }).click();
    await expect(deviceRow).toBeVisible();
    await expect(ispRow).toHaveCount(0);
    await page.getByRole('button', { name: /^Đường truyền \d+$/ }).click();
    await expect(
      ispRow,
      'ĐÂY LÀ LỖI ĐÃ VÁ: trước 12/09 không có nút này, nên bật lọc là đường truyền mất hẳn',
    ).toBeVisible();

    // (c) "Mở hồ sơ đầy đủ" phải dẫn về hồ sơ ĐƯỜNG TRUYỀN, không phải phần mềm.
    await ispRow.getByRole('button', { name: `Mở két của ${ispCode}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('link', { name: 'Mở hồ sơ đầy đủ' }),
      'nhánh vét cũ đưa id đường truyền sang trang phần mềm — một trang trắng không lỗi nào báo',
    ).toHaveAttribute('href', `/isp-lines/${ispId}`);
  });

  /**
   * Rủi ro lớn nhất của việc dựng trang tổng: rất dễ tiện tay cho nó trả luôn tên từng ngăn,
   * và thế là bản đồ bí mật của công ty ra đời mà không bài kiểm nghiệp vụ nào đỏ.
   */
  test('trang tổng chỉ nói CHỦ THỂ, không nói trong két có gì', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createDevice(page, `PC-E2E-VS-${stamp}`);
    const label = `ten-ngan-bi-mat-${stamp}`;
    await stash(page, 'device', deviceId, label);

    const owners = await page.request.get('/api/v1/vault/owners');
    expect(owners.status()).toBe(200);
    const body = await owners.text();
    // Tên ngăn KHÔNG được có mặt trong payload của trang tổng.
    expect(body).not.toContain(label);
    expect(body).not.toContain('Mat-Khau#2026');

    await page.goto('/vault');
    await expect(page.getByRole('heading', { name: 'Két sắt' })).toBeVisible();
    await expect(page.getByText(label)).toHaveCount(0);

    // Và các đường liệt kê secret vẫn bị chặn y như trước.
    for (const url of ['/api/v1/vault/secrets', '/api/v1/vault/secrets/all']) {
      expect((await page.request.get(url)).status(), url).not.toBe(200);
    }
  });

  test('Member không vào được trang tổng — bản đồ két không mở cho mọi người', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.request.get('/api/v1/auth/me');
    // Đường API phải chặn theo VAI, không chỉ giấu mục menu đi.
    const asSa = await page.request.get('/api/v1/vault/owners');
    expect(asSa.status()).toBe(200);

    await logout(page);
    await firstLogin(page, E2E_MEMBER);
    expect((await page.request.get('/api/v1/vault/owners')).status()).toBe(403);
  });
});

test.describe('Trang tổng Két sắt — sửa từ code review', () => {
  test('Member không thấy mục Két sắt trên menu, và gõ thẳng URL cũng chỉ ra 404', async ({
    page,
  }) => {
    await firstLogin(page, E2E_MEMBER);
    /*
     * `GET /vault/owners` chặn theo vai, nên nếu vẫn bày mục menu ra thì Member bấm vào và
     * nhận một màn lỗi "thử lại" — bày một cánh cửa khóa còn tệ hơn không bày.
     * (Két sắt của TỪNG hồ sơ thì Member vẫn thấy — đó là tab, quyền nằm ở ma trận 6.2.)
     */
    await expect(page.getByRole('link', { name: 'Két sắt', exact: true })).toHaveCount(0);

    await page.goto('/vault');
    await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
  });
});

test.describe('Ma trận quyền — chiều nhìn theo nhóm đối tượng', () => {
  /**
   * Gán hàng loạt: người GÁN HỎNG phải được nói ra, kể cả khi có người khác gán được.
   *
   * Bản trước chỉ hiện lỗi khi KHÔNG ai gán được — có một người lọt là hộp đóng, toast báo
   * "đã gán cho N người", và mọi lỗi biến mất. SA tin là cả nhóm đã có quyền.
   *
   * Dựng cảnh hỏng bằng cách xoá một tài khoản SAU khi hộp đã mở: API từ chối email lạ, còn
   * người kia vẫn gán được — đúng tình huống "thành công một phần".
   */
  test('gán hàng loạt hỏng một phần: vẫn báo rõ ai không gán được', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
    const doomed = `e2e-tao-moi-${stamp}@pmh.com.vn`;

    const created = await page.request.post('/api/v1/accounts', {
      headers,
      data: { email: doomed, fullName: `E2E Sắp bị xoá ${stamp}`, role: 'member', totpLoginRequired: true },
    });
    expect(created.status()).toBe(201);

    const scopeList = await page.request.get('/api/v1/vault/access/scopes');
    const first = ((await scopeList.json()) as { label: string }[])[0];

    /*
     * Lưới (28/08/2026): không còn hai chiều nhìn để bấm qua lại. Gán hàng loạt mở từ chính
     * TIÊU ĐỀ CỘT của nhóm đó — nhãn trợ năng là câu đầy đủ, còn chữ hiện ra đã cắt tiền tố.
     */
    await page.goto('/admin/vault-access');
    await page
      .getByRole('button', { name: `Gán "${first.label}" cho nhiều người` })
      .click();

    const form = page.getByRole('dialog');
    /* Tick CẢ HAI theo ĐÍCH DANH, không dùng `.first()`: danh sách sắp theo họ tên nên tài
       khoản vừa tạo có thể đứng đầu, và tick "cái đầu tiên" hoá ra tick trúng chính nó. */
    await form.locator('li', { hasText: E2E_MEMBER.email }).getByRole('checkbox').check();
    await form.locator('li', { hasText: doomed }).getByRole('checkbox').check();

    // Xoá tài khoản kia SAU khi hộp đã dựng xong danh sách.
    sql(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = '${doomed}'); ` +
        `DELETE FROM known_device WHERE user_id IN (SELECT id FROM users WHERE email = '${doomed}'); ` +
        `DELETE FROM users WHERE email = '${doomed}'`,
    );

    await form.getByRole('button', { name: 'Lưu' }).click();

    // Người gán được thì vẫn báo, NHƯNG người hỏng cũng phải hiện ra kèm email.
    await expect(page.getByText('Đã gán quyền cho 1 người.')).toBeVisible();
    /* `.first()`: từ khi ma trận thành LƯỚI, email đó xuất hiện HAI chỗ — trong toast báo hỏng
       và trong hàng của chính tài khoản đó (danh sách người đã nằm trong cache). Bài này chỉ
       cần biết lời báo có nêu đích danh ai không gán được. */
    await expect(page.getByText(new RegExp(doomed)).first()).toBeVisible();
  });

  test('gán một nhóm cho nhiều người, rồi xem lại được ai đang có quyền trên nhóm đó', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/vault-access');

    const scopes = await page.request.get('/api/v1/vault/access/scopes');
    const list = (await scopes.json()) as { label: string }[];
    expect(list.length).toBeGreaterThan(0);
    const label = list[0].label;

    /*
     * Lưới trả lời CẢ HAI câu cùng lúc: đọc theo hàng ra "người này xem được gì", đọc theo
     * cột ra "nhóm này ai xem được". Không còn phải bấm đổi chiều nhìn — đó là lý do bản cũ
     * bị dựng lại.
     */
    await expect(page.getByRole('button', { name: new RegExp(`${escapeRe(label)}: Không có quyền`) }).first()).toBeVisible();

    await page.getByRole('button', { name: `Gán "${label}" cho nhiều người` }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('checkbox').first().check();
    await form.getByRole('button', { name: 'Tầng quyền' }).click();
    await page.getByRole('option', { name: 'Xem thẳng', exact: true }).click();
    await form.getByRole('button', { name: 'Lưu' }).click();

    await expect(page.getByText('Đã gán quyền cho 1 người.')).toBeVisible();

    // Ô của đúng cột đó đổi màu ngay — không phải đi tìm trong một thẻ khác.
    await expect(
      page.getByRole('button', { name: new RegExp(`${escapeRe(label)}: Xem thẳng`) }).first(),
    ).toBeVisible();
  });

  test('dòng tổng nói rõ còn bao nhiêu nhóm chưa gán cho ai', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/admin/vault-access');
    // Chỗ hổng của ma trận là những nhóm chưa ai được gán — rà từng thẻ thì không thấy ra.
    await expect(page.getByText(/nhóm chưa gán cho ai/)).toBeVisible();
  });

  test('gỡ quyền ngay trên thẻ nhóm, không phải quay về chiều theo người', async ({ page }) => {
    await firstLogin(page, E2E_SA);

    const scopeList = await page.request.get('/api/v1/vault/access/scopes');
    const first = ((await scopeList.json()) as {
      scopeType: string;
      scopeRef: string;
      label: string;
    }[])[0];

    const granted = await page.request.post('/api/v1/vault/access', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: first.scopeType,
        scopeRef: first.scopeRef,
        tier: 'needs_approval',
        note: '',
      },
    });
    expect(granted.status()).toBe(201);

    /*
     * Gỡ NGAY TRÊN Ô của lưới: bấm ô → hộp nhỏ đọc rõ ai-nhóm-nào → nút Gỡ → hỏi lại.
     *
     * Cố ý KHÔNG cho bấm-để-đổi-vòng ngay trên ô: đây là quyền xem mật khẩu, một cú bấm nhầm
     * khi đang cuộn ngang là mở quyền cho người không nên có.
     */
    await page.goto('/admin/vault-access');
    await page
      .getByRole('button', { name: new RegExp(`${escapeRe(first.label)}: Cần duyệt`) })
      .first()
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Gỡ' }).click();
    await page.getByRole('button', { name: 'Gỡ', exact: true }).last().click();

    await expect(page.getByText('Đã gỡ quyền.')).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(`${escapeRe(first.label)}: Không có quyền`) }).first(),
    ).toBeVisible();
  });
});

/** Nhãn nhóm có thể chứa `(`, `.`, `+`… — chèn thẳng vào RegExp là hỏng ở đúng nhãn khó nhất. */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
