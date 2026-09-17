import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  COMPOSE,
  confirmAction,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  lastAudit,
  logout,
  resetDevices,
  resetSecrets,
  resetUsers,
  rowAction,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetSecrets();
  resetDevices();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function createSwitch(page: Page, code: string): Promise<string> {
  const csrf = await csrfOf(page);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const type = catalog.deviceTypes.find((t) => t.name === 'Switch')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data: { code, name: 'Switch cho két sắt', deviceTypeId: type.id, serial: `FOC-${code}` },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

/** Story 4.1 — FR-021 (cất secret mã hóa) + FR-026 (không có đường xuất hàng loạt). */
test.describe('Két sắt', () => {
  test('đường hạnh phúc: cất mật khẩu → hiện tên gọi, không hiện giá trị → xoay → thu hồi', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `SW-E2E-VAULT-${stamp}`;
    const deviceId = await createSwitch(page, code);
    const label = `admin web E2E ${stamp}`;
    const secretValue = `Sup3r#Secret#${stamp}`;

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText('Chưa cất secret nào')).toBeVisible();

    await page.getByRole('button', { name: 'Cất secret' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill(label);
    await form.getByRole('textbox', { name: 'Tên đăng nhập' }).fill('admin');
    await form.getByRole('textbox', { name: 'Giá trị', exact: true }).fill(secretValue);
    await form.getByRole('button', { name: 'Lưu' }).click();

    const row = page.getByRole('row', { name: new RegExp(label) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Mật khẩu', { exact: true })).toBeVisible();

    /**
     * Điểm kiểm quan trọng nhất của story: bảng CHỈ có metadata. Giá trị không có mặt ở đâu
     * trên trang cho tới khi bấm Xem và qua step-up (4.2) — kể cả trong DOM ẩn.
     */
    await expect(page.locator('body')).not.toContainText(secretValue);

    // Xoay: đổi giá trị, metadata giữ nguyên.
    await rowAction(page, label, 'Xoay');
    const rotate = page.getByRole('dialog');
    await rotate.getByRole('textbox', { name: 'Giá trị mới' }).fill(`${secretValue}-v2`);
    await rotate.getByRole('button', { name: 'Xoay' }).click();
    await expect(page.getByRole('row', { name: new RegExp(label) })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(secretValue);

    // Thu hồi = xóa mềm: biến khỏi danh sách.
    await rowAction(page, label, 'Thu hồi');
    await confirmAction(page);
    await expect(page.getByRole('row', { name: new RegExp(label) })).toHaveCount(0);
  });

  test('đường hỏng: trùng tên gọi trên cùng thiết bị bị chặn, không phải 500', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createSwitch(page, `SW-E2E-DUP-${stamp}`);
    const csrf = await csrfOf(page);
    const body = {
      ownerType: 'device',
      ownerId: deviceId,
      kind: 'password',
      label: `SSH root E2E ${stamp}`,
      value: 'khong-quan-trong',
    };
    const headers = { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN };

    expect((await page.request.post('/api/v1/vault/secrets', { headers, data: body })).status())
      .toBe(201);

    const dup = await page.request.post('/api/v1/vault/secrets', { headers, data: body });
    expect(dup.status()).toBe(409);
    expect(await dup.json()).toMatchObject({ code: 'SECRET_LABEL_TAKEN' });
  });

  /**
   * FR-026 — không tồn tại đường xuất toàn bộ két ở MỌI quyền.
   *
   * Kiểm bằng chính con đường kẻ tấn công sẽ thử: bỏ bộ lọc chủ thể, đổi kiểu tham số, gọi
   * các tên route quen thuộc của những màn khác trong hệ thống (export.xlsx đã có ở thiết bị,
   * phần mềm, ISP — nên đó là chỗ dễ vô thức thêm vào nhất).
   */
  test('FR-026: không có đường nào lấy được nhiều hơn một chủ thể', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const deviceId = await createSwitch(page, `SW-E2E-FR026-${Date.now().toString().slice(-6)}`);

    for (const url of [
      '/api/v1/vault/secrets',
      '/api/v1/vault/secrets?ownerType=device',
      '/api/v1/vault/secrets?ownerId=' + deviceId,
      '/api/v1/vault/secrets/export.xlsx',
      '/api/v1/vault/secrets/all',
      '/api/v1/vault/export',
    ]) {
      const response = await page.request.get(url);
      expect(response.status(), `phải bị chặn: ${url}`).not.toBe(200);
    }
  });

  /**
   * Story 6.3 ĐỔI hành vi này có chủ ý: Member giờ THẤY tab Két sắt, vì quyền của họ nằm ở ma
   * trận 6.2 chứ không suy ra được từ vai. Nhưng chưa được gán gì thì vẫn là tầng CẤM — API
   * trả 403 và không có gì lọt ra.
   *
   * Cái KHÔNG đổi, và là phần đáng giữ nhất của bài kiểm này: Member không bao giờ GHI được
   * vào két, kể cả khi đã được cấp quyền xem.
   */
  test('Member chưa được gán gì: đọc 403, và không bao giờ ghi được vào két', async ({ page }) => {
    // Tạo thiết bị bằng SA trước, rồi đăng nhập lại bằng Member trên phiên sạch.
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createSwitch(page, `SW-E2E-MEM-${stamp}`);
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    const list = await page.request.get(
      `/api/v1/vault/secrets?ownerType=device&ownerId=${deviceId}`,
    );
    expect(list.status()).toBe(403);

    const create = await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: `member E2E ${stamp}`,
        value: 'x',
      },
    });
    expect(create.status()).toBe(403);

    await page.goto(`/devices/${deviceId}`);
    await expect(page.getByRole('tab', { name: 'Tổng quan' })).toBeVisible();
    // Tab CÓ hiện (story 6.3) nhưng nội dung nói rõ là không có quyền — không phải bảng trống.
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText(/không có quyền/i)).toBeVisible();
  });

  /**
   * SỬA METADATA CỦA MỘT NGĂN — `PATCH /vault/secrets/:id`.
   *
   * Cho tới 17/09/2026 cửa này KHÔNG có một dòng kiểm nào, ở bất kỳ tầng nào: không unit,
   * không E2E, và chuỗi "Sửa thông tin" không xuất hiện trong cả thư mục `e2e/`. Nghĩa là
   * `updateMeta` có thể trả về mà không ghi gì, hoặc bỏ luôn dòng audit trong transaction, và
   * không có gì báo cho tới khi người dùng kêu.
   *
   * Bài này khẳng định ba vế: metadata đổi thật, GIÁ TRỊ không hề đổi theo (sửa nhãn không
   * được đụng tới mật khẩu), và có đúng một dòng audit mang tên người sửa.
   */
  test('sửa metadata của ngăn: đổi nhãn không đụng tới giá trị, và có vết', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createSwitch(page, `SW-E2E-EDIT-${stamp}`);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
    const value = `Gia#Tri#${stamp}`;

    const created = await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: `nhãn cũ E2E ${stamp}`,
        username: 'root',
        value,
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    const patched = await page.request.patch(`/api/v1/vault/secrets/${id}`, {
      headers,
      data: { label: `nhãn mới E2E ${stamp}`, username: 'admin' },
    });
    expect(patched.status()).toBe(200);

    const list = (await (
      await page.request.get(`/api/v1/vault/secrets?ownerType=device&ownerId=${deviceId}`)
    ).json()) as { id: string; label: string; username: string | null }[];
    const row = list.find((item) => item.id === id);
    expect(row?.label).toBe(`nhãn mới E2E ${stamp}`);
    expect(row?.username).toBe('admin');

    /* Sửa NHÃN không được đụng tới GIÁ TRỊ — hai thứ nằm hai cột, và một bản cài đặt lỡ tay
       mã lại giá trị bằng chuỗi rỗng sẽ không làm khẳng định nào ở trên đỏ. */
    const opened = await page.request.post(`/api/v1/vault/secrets/${id}/reveal`, { headers });
    expect(opened.status()).toBe(200);
    expect(((await opened.json()) as { value: string }).value).toBe(value);

    const row2 = lastAudit('vault.secret.updated', id);
    expect(row2?.actor, 'lượt sửa phải để lại vết mang tên người sửa').toBe(E2E_SA.email);
  });

  /**
   * LỖ RÒ ĐÃ BỊT 17/09/2026 — và đây là bài canh nó.
   *
   * `GET /devices/:id/panels` mở cho vai `member` (hồ sơ máy là việc hàng ngày), nhưng khu
   * "Két sắt" trong đó bày NHÃN NGĂN và TÊN ĐĂNG NHẬP. Trước bản vá, provider chỉ nhận
   * `deviceId` nên không có gì để hỏi ma trận quyền: cùng một dữ liệu mà `GET /vault/secrets`
   * trả 403 thì cửa này trả 200. Lặp `GET /devices` rồi gọi panel từng máy là lấy được bản đồ
   * "công ty giữ bí mật ở đâu" — đúng thứ `/vault/owners` khoá lại cho SA/Admin — và đường
   * này KHÔNG ghi một dòng audit nào.
   *
   * Vế SA ở đầu bài là vế đối chứng, không phải thừa: thiếu nó thì bài vẫn xanh trọn vẹn kể cả
   * khi ai đó gỡ hẳn khu Két sắt khỏi trang thiết bị.
   */
  test('khu "Két sắt" trên trang thiết bị không lọt cho Member ngoài ma trận quyền', async ({
    page,
  }) => {
    // Hai luồng đăng nhập lần đầu (SA rồi Member) trong cùng một bài.
    test.setTimeout(150_000);

    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createSwitch(page, `SW-E2E-PANEL-${stamp}`);
    const label = `admin web E2E ${stamp}`;
    const username = `root-E2E-${stamp}`;

    const created = await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label,
        username,
        value: 'mat-khau-that',
      },
    });
    expect(created.status(), 'không cất được secret thì phần còn lại của bài vô nghĩa').toBe(201);

    const panelsOf = async () =>
      (await (await page.request.get(`/api/v1/devices/${deviceId}/panels`)).json()) as {
        key: string;
      }[];

    const asSa = await panelsOf();
    expect(
      asSa.map((panel) => panel.key),
      'SA phải thấy khu Két sắt — không có vế này thì bài xanh cả khi khu đó bị gỡ hẳn',
    ).toContain('vault');

    await logout(page);
    await firstLogin(page, E2E_MEMBER);

    const asMember = await panelsOf();
    expect(
      asMember.map((panel) => panel.key),
      'Member ngoài ma trận quyền KHÔNG được nhận khu Két sắt qua cửa /panels',
    ).not.toContain('vault');
    expect(
      JSON.stringify(asMember),
      'và không mẩu metadata nào của ngăn được lọt ra: nhãn là bản đồ, tên đăng nhập là một nửa thông tin đăng nhập',
    ).not.toContain(username);
  });

  test('DB chỉ chứa rác: giá trị cất vào không tìm thấy ở dạng chữ trong bảng secret', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createSwitch(page, `SW-E2E-CIPHER-${stamp}`);
    const plaintext = `Plain#Text#${stamp}`;

    const created = await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: `cipher E2E ${stamp}`,
        value: plaintext,
      },
    });
    expect(created.status()).toBe(201);

    // Bản ghi trả về không được mang theo bất kỳ cột mã hóa nào, và tuyệt đối không có giá trị.
    const meta = (await created.json()) as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(
      [
        'createdAt',
        'createdBy',
        'id',
        'kind',
        'label',
        'note',
        'ownerId',
        'ownerType',
        'updatedAt',
        'username',
      ].sort(),
    );

    /**
     * Đọc THẲNG bảng trong Postgres — đây mới là "DB bị trộm thì chỉ là rác" của AC. Kiểm
     * qua API thì hiển nhiên không thấy plaintext (API có bao giờ trả đâu), nên chẳng chứng
     * minh được gì. Ở đây soi cả năm cột envelope dưới dạng text.
     */
    const dump = execSync(
      `${COMPOSE} exec -T postgres psql -U ims -d ims -t -A -c ` +
        `"SELECT encode(value_ct,'escape') || encode(value_iv,'escape') || encode(value_tag,'escape') ` +
        `|| encode(dek_wrapped,'escape') || coalesce(note,'') || label ` +
        `FROM secret WHERE id = '${(meta as { id: string }).id}'"`,
      { cwd: '..', encoding: 'utf8' },
    );
    expect(dump.trim()).not.toBe('');
    expect(dump).not.toContain(plaintext);
  });
});
