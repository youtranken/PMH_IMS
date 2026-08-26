import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetDevices, resetUsers } from './helpers';

test.beforeEach(() => {
  resetUsers();
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
    data: {
      code,
      name: 'Switch lõi phòng máy',
      deviceTypeId: type.id,
      assignedTo: 'phòng IT',
      warrantyEnd: '2027-12-31',
      serial: `FOC-${code}`,
    },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

/** Story 2.5 — một trang mở ra thấy mọi thứ về thiết bị. */
test.describe('Trang chi tiết thiết bị', () => {
  test('gom đủ hồ sơ · bảo hành · port map · giấy tờ · lịch sử trong một trang', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `SW-E2E-ALL-${stamp}`;
    const deviceId = await createSwitch(page, code);
    const csrf = await csrfOf(page);

    await page.request.post(`/api/v1/devices/${deviceId}/ports`, {
      headers: { 'X-CSRF-Token': csrf, Origin: 'https://ims.pmh.com.vn' },
      data: { portLabel: 'Gi1/0/1', connectedLabel: 'uplink nhà mạng' },
    });

    await page.goto(`/devices/${deviceId}`);

    // Dải tóm tắt: trạng thái + tình trạng bảo hành hiện ngay, không phải bấm vào đâu.
    await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
    await expect(page.getByText('Đang dùng').first()).toBeVisible();
    await expect(page.getByText(/Còn \d+ ngày/).first()).toBeVisible();

    // Đủ 4 tab (switch có port map).
    for (const name of ['Hồ sơ', 'Port map', 'Giấy tờ', 'Lịch sử']) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }

    await expect(page.getByText(`FOC-${code}`)).toBeVisible();

    await page.getByRole('tab', { name: 'Port map' }).click();
    await expect(page.getByRole('row', { name: /Gi1\/0\/1/ })).toBeVisible();

    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    const pdf = join(tmpdir(), `giay-to-${stamp}.pdf`);
    writeFileSync(pdf, '%PDF-1.4\ntrailer<<>>\n');
    await page.getByLabel('Chọn file để đính kèm').setInputFiles(pdf);
    await page.getByRole('button', { name: 'Tải lên' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`giay-to-${stamp}`) })).toBeVisible();

    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    await expect(page.getByText('Tạo hồ sơ')).toBeVisible();
    await expect(page.getByText('Thêm cổng port map')).toBeVisible();
  });

  test('khu mở rộng chưa có module nào đăng ký → API trả rỗng, trang không hiện khối trống', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createSwitch(page, `SW-E2E-EXT-${stamp}`);

    const panels = await page.evaluate(async (id: string) => {
      const res = await fetch(`/api/v1/devices/${id}/panels`, { credentials: 'include' });
      return (await res.json()) as unknown[];
    }, deviceId);
    // Đợt 1: ipam/vault/software chưa tồn tại nên danh sách rỗng — ĐÚNG như thiết kế.
    expect(panels).toEqual([]);

    await page.goto(`/devices/${deviceId}`);
    await expect(page.getByRole('heading', { name: /SW-E2E-EXT/ })).toBeVisible();
    // Không được có tiêu đề khu mở rộng treo lơ lửng, cũng không có lời hứa "sẽ có sau".
    for (const ghost of ['Địa chỉ IP', 'Két sắt', 'License', 'Phiếu']) {
      await expect(page.getByRole('heading', { name: ghost })).toHaveCount(0);
    }
  });

  test('mở thiết bị không tồn tại → trang 404 tử tế, không phải khối lỗi đỏ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/devices/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Về trang chủ' })).toBeVisible();
  });
});
