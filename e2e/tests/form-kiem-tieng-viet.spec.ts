import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  devicesPageButton,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetUsers,
  uniqueStamp,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetCatalog();
});

async function writeHeaders(page: Page): Promise<Record<string, string>> {
  const csrf = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
  return { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN };
}

/**
 * Kiểm form bằng tiếng Việt (DEV-025, NET-023, SW-024) và danh mục vô hiệu (ADM-015, DEV-027).
 *
 * Mỗi mảng một form tiêu biểu: bấm Lưu khi trống → câu tiếng Việt DƯỚI ô (không có bong bóng
 * "Please fill out this field." của trình duyệt: form `noValidate`), và mục danh mục đã vô
 * hiệu không có trong ô chọn — API cũng từ chối nếu ai đó gửi thẳng.
 */
test.describe('Form: kiểm tiếng Việt dưới từng ô', () => {
  test('form dải mạng: bấm Lưu khi trống → câu tiếng Việt dưới ô, tiêu điểm ô đầu', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/ip-addresses');
    await page.getByRole('button', { name: 'Khai dải mới' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('button', { name: 'Lưu' }).click();

    await expect(form, 'Lưu hỏng thì hộp phải ở lại').toBeVisible();
    await expect(form.getByText('Còn 2 ô cần sửa trước khi lưu.')).toBeVisible();
    const cidr = form.getByRole('textbox', { name: 'Dải', exact: true });
    await expect(cidr).toHaveAccessibleDescription(/^Bắt buộc — chưa nhập ô này\./);
    await expect(cidr).toBeFocused();

    // Sửa được ô nào thì lỗi của ô đó tắt ngay, không đợi bấm Lưu lần nữa.
    await cidr.fill('10.250.0.0/24');
    await expect(cidr).not.toHaveAttribute('aria-invalid', 'true');
    await expect(form.getByText(/ô cần sửa trước khi lưu/)).toHaveCount(0);

    // VLAN gõ chữ: báo ngay dưới ô, không gửi đi.
    await form.getByRole('textbox', { name: 'VLAN' }).fill('mười');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form.getByRole('textbox', { name: 'VLAN' })).toHaveAccessibleDescription(
      /VLAN phải là số nguyên từ 1 đến 4094\./,
    );
  });

  test('form phần mềm: Số ghế "10 ghế" bị báo, không lặng lẽ thành "không giới hạn"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/software');
    await page.getByRole('button', { name: 'Thêm hồ sơ' }).click();
    const form = page.getByRole('dialog', { name: 'Thêm hồ sơ' });
    await form.getByRole('textbox', { name: 'Mã hồ sơ', exact: true }).fill(`SW-E2E-GHE-${uniqueStamp()}`);
    await form.getByRole('textbox', { name: 'Tên hồ sơ', exact: true }).fill('License E2E số ghế');
    await form.getByRole('textbox', { name: 'Số ghế' }).fill('10 ghế');

    const posted = page.waitForRequest((r) => r.url().endsWith('/api/v1/software') && r.method() === 'POST', {
      timeout: 2_000,
    });
    await form.getByTestId('dialog-footer').getByRole('button', { name: 'Lưu' }).click();
    await expect(form.getByRole('textbox', { name: 'Số ghế' })).toHaveAccessibleDescription(
      /Số ghế phải là số nguyên từ 1 trở lên/,
    );
    await expect(posted, 'không được gửi gì lên khi Số ghế sai').rejects.toThrow();
    await expect(form).toBeVisible();
  });
});

test.describe('Q-14 · mục danh mục đã vô hiệu không chọn mới được', () => {
  test('form thiết bị không mời loại/site đã vô hiệu; API từ chối lựa chọn mới', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const headers = await writeHeaders(page);
    const stamp = uniqueStamp();

    const post = async (entity: string, data: Record<string, unknown>) => {
      const res = await page.request.post(`/api/v1/catalog/${entity}`, { headers, data });
      expect(res.status(), `Dàn cảnh: tạo ${entity}`).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    const siteOff = await post('site', { code: `E2E-OFF-${stamp}`, name: 'Site E2E ngừng' });
    const typeOn = await post('device_type', { name: `E2E loại dùng ${stamp}` });
    const typeOff = await post('device_type', { name: `E2E loại ngừng ${stamp}` });
    for (const [entity, id] of [
      ['site', siteOff],
      ['device_type', typeOff],
    ]) {
      const res = await page.request.patch(`/api/v1/catalog/${entity}/${id}/active`, {
        headers,
        data: { active: false },
      });
      expect(res.status(), `Dàn cảnh: vô hiệu ${entity}`).toBeLessThan(300);
    }

    await page.goto('/devices');
    await devicesPageButton(page, 'Thêm thiết bị').click();
    const form = page.getByRole('dialog', { name: 'Thêm thiết bị' });

    await form.getByRole('button', { name: 'Loại', exact: true }).click();
    await expect(page.getByRole('option', { name: `E2E loại dùng ${stamp}` })).toBeVisible();
    await expect(
      page.getByRole('option', { name: new RegExp(`E2E loại ngừng ${stamp}`) }),
      'loại đã vô hiệu không được mời chọn cho hồ sơ mới',
    ).toHaveCount(0);
    await page.keyboard.press('Escape');

    await form.getByRole('button', { name: 'Site', exact: true }).click();
    await expect(
      page.getByRole('option', { name: new RegExp(`E2E-OFF-${stamp}`) }),
      'site đã vô hiệu không được mời chọn',
    ).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Gửi thẳng API (lách giao diện) → 400 với mã và câu tiếng Việt.
    const res = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: `TB-E2E-Q14-${stamp}`, name: 'Máy lách UI', deviceTypeId: typeOff },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('CATALOG_REF_INACTIVE');
    expect(body.message).toContain('đã ngừng dùng');

    // Mục còn dùng thì vẫn tạo được — hàng rào không chặn nhầm.
    const ok = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: `TB-E2E-Q14-OK-${stamp}`, name: 'Máy hợp lệ', deviceTypeId: typeOn },
    });
    expect(ok.status()).toBe(201);
  });
});
