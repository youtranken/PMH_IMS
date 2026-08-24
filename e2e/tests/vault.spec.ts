import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import {
  COMPOSE,
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  resetDevices,
  resetSecrets,
  resetUsers,
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
    headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
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

    await page.goto(`/thiet-bi/${deviceId}`);
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
    await row.getByRole('button', { name: 'Xoay' }).click();
    const rotate = page.getByRole('dialog');
    await rotate.getByRole('textbox', { name: 'Giá trị mới' }).fill(`${secretValue}-v2`);
    await rotate.getByRole('button', { name: 'Xoay' }).click();
    await expect(page.getByRole('row', { name: new RegExp(label) })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(secretValue);

    // Thu hồi = xóa mềm: biến khỏi danh sách.
    await page
      .getByRole('row', { name: new RegExp(label) })
      .getByRole('button', { name: 'Thu hồi' })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Đồng ý' }).click();
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
    const headers = { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' };

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
    await page.getByRole('button', { name: 'Đăng xuất' }).click();

    await firstLogin(page, E2E_MEMBER);
    const list = await page.request.get(
      `/api/v1/vault/secrets?ownerType=device&ownerId=${deviceId}`,
    );
    expect(list.status()).toBe(403);

    const create = await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: `member E2E ${stamp}`,
        value: 'x',
      },
    });
    expect(create.status()).toBe(403);

    await page.goto(`/thiet-bi/${deviceId}`);
    await expect(page.getByRole('tab', { name: 'Hồ sơ' })).toBeVisible();
    // Tab CÓ hiện (story 6.3) nhưng nội dung nói rõ là không có quyền — không phải bảng trống.
    await page.getByRole('tab', { name: 'Két sắt' }).click();
    await expect(page.getByText(/không có quyền/i)).toBeVisible();
  });

  test('DB chỉ chứa rác: giá trị cất vào không tìm thấy ở dạng chữ trong bảng secret', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createSwitch(page, `SW-E2E-CIPHER-${stamp}`);
    const plaintext = `Plain#Text#${stamp}`;

    const created = await page.request.post('/api/v1/vault/secrets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
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
