import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  resetDevices,
  resetIpam,
  resetUsers,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetIpam();
  resetDevices();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function createSubnet(page: Page, cidr: string, name: string): Promise<string> {
  const created = await page.request.post('/api/v1/ipam/subnets', {
    headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' },
    data: { cidr, name },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

/** Story 5.1 — FR-018/FR-019/FR-020: dải mạng, hồ sơ IP, mức sử dụng. */
test.describe('Dải mạng và hồ sơ IP', () => {
  test('đường hạnh phúc: khai dải → thấy ô trống → cấp IP → mức sử dụng đổi theo', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    // /29 cho 6 địa chỉ cấp được — đủ để kiểm mà bảng không dài 254 dòng.
    const cidr = `172.16.${Number(stamp) % 200}.0/29`;

    await page.goto('/dia-chi-ip');
    await page.getByRole('button', { name: 'Khai dải mới' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Dải' }).fill(cidr);
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill(`LAN thử E2E ${stamp}`);
    await form.getByRole('button', { name: 'Lưu' }).click();

    const row = page.getByRole('row', { name: new RegExp(`LAN thử E2E ${stamp}`) });
    await expect(row).toBeVisible();
    // /29 = 8 địa chỉ, trừ địa chỉ mạng và quảng bá còn 6.
    await expect(row.getByText('0% · 0/6 · còn 6')).toBeVisible();

    await row.getByRole('link').click();
    await expect(page.getByRole('heading', { name: new RegExp(cidr) })).toBeVisible();

    // Ô trống hiện sẵn trong bảng, không giấu sau nút "thêm".
    await expect(page.getByRole('button', { name: 'Cấp IP này' })).toHaveCount(6);

    await page.getByRole('button', { name: 'Cấp IP này' }).first().click();
    const ipForm = page.getByRole('dialog');
    await ipForm.getByRole('textbox', { name: 'Người / bộ phận dùng' }).fill('Chị Lan — Kế toán');
    await ipForm.getByRole('button', { name: 'Lưu' }).click();

    await expect(page.getByText('Chị Lan — Kế toán')).toBeVisible();
    await expect(page.getByText('17% · 1/6 · còn 5')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cấp IP này' })).toHaveCount(5);
  });

  /**
   * AC 5.1: "IP trùng trong cùng subnet bị CHẶN tuyệt đối (unique constraint tầng DB)".
   * Gọi thẳng API và bắn hai request để chắc chắn hàng rào nằm ở DB chứ không phải ở một
   * câu `if` trong service — câu `if` thì hai request vào cùng lúc là lọt cả hai.
   */
  test('đường hỏng: cấp trùng IP trong cùng dải bị chặn ở tầng DB', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN trùng E2E ${stamp}`);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };
    const body = { subnetId, address: `172.16.${octet}.1`, usedBy: 'máy A' };

    const [first, second] = await Promise.all([
      page.request.post('/api/v1/ipam/addresses', { headers, data: body }),
      page.request.post('/api/v1/ipam/addresses', {
        headers,
        data: { ...body, usedBy: 'máy B' },
      }),
    ]);

    const statuses = [first.status(), second.status()].sort();
    expect(statuses).toEqual([201, 409]);
    const failed = first.status() === 409 ? first : second;
    expect(await failed.json()).toMatchObject({ code: 'IP_TAKEN' });
  });

  test('đường hỏng: IP ngoài dải, địa chỉ mạng và địa chỉ quảng bá đều bị từ chối', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN biên E2E ${stamp}`);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    for (const address of [
      `172.16.${octet}.9`, // ngoài dải /29
      '10.0.0.1', // khác hẳn dải
      `172.16.${octet}.0`, // địa chỉ mạng — trong dải nhưng KHÔNG cấp được
      `172.16.${octet}.7`, // địa chỉ quảng bá
    ]) {
      const res = await page.request.post('/api/v1/ipam/addresses', {
        headers,
        data: { subnetId, address, usedBy: 'thử' },
      });
      expect(res.status(), `phải bị từ chối: ${address}`).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'IP_OUT_OF_SUBNET' });
    }
  });

  test('đường hỏng: dải gõ sai được giải thích tử tế, không phải lỗi 500', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    for (const [cidr, code] of [
      ['172.16.10.0', 'SUBNET_INVALID'],
      ['172.16.10.0/33', 'SUBNET_INVALID'],
      ['10.0.0.0/7', 'SUBNET_INVALID'],
      ['fe80::/64', 'SUBNET_INVALID'],
    ]) {
      const res = await page.request.post('/api/v1/ipam/subnets', {
        headers,
        data: { cidr, name: 'sai E2E' },
      });
      expect(res.status(), `phải bị từ chối: ${cidr}`).toBe(400);
      expect(await res.json()).toMatchObject({ code });
    }

    // Dải rộng quá mức nói rõ nghi ngờ gõ nhầm, không chỉ "không hợp lệ".
    const wide = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: '10.0.0.0/7', name: 'rộng E2E' },
    });
    expect(((await wide.json()) as { message: string }).message).toContain('gõ nhầm');
  });

  test('gõ IP bất kỳ kèm /24 thì tự quy về địa chỉ mạng, không đẻ ra hai dải cho một dải', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    const first = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.16.${octet}.37/24`, name: `LAN quy chuẩn E2E ${stamp}` },
    });
    expect(first.status()).toBe(201);
    expect((await first.json()) as { cidr: string }).toMatchObject({
      cidr: `172.16.${octet}.0/24`,
    });

    // Người thứ hai gõ đúng địa chỉ mạng → phải bị coi là TRÙNG, không tạo dải thứ hai.
    const second = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.16.${octet}.0/24`, name: `LAN trùng E2E ${stamp}` },
    });
    expect(second.status()).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'SUBNET_TAKEN' });
  });

  /**
   * Quyết định 2026-08-23: KHÔNG xóa hẳn. Ẩn phải kèm lý do, và bản ghi vẫn còn trong DB
   * cùng vết ai ẩn — đó mới là thứ trả lời được "sao dải này biến mất" sáu tháng sau.
   */
  test('ẩn dải phải có lý do; dải còn IP bên trong thì không ẩn được', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN ẩn E2E ${stamp}`);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    const noReason = await page.request.delete(`/api/v1/ipam/subnets/${subnetId}`, {
      headers,
      data: { reason: '' },
    });
    expect(noReason.status()).toBe(400);

    await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId, address: `172.16.${octet}.1`, usedBy: 'máy A' },
    });
    const hasIps = await page.request.delete(`/api/v1/ipam/subnets/${subnetId}`, {
      headers,
      data: { reason: 'khai nhầm dải' },
    });
    expect(hasIps.status()).toBe(409);
    expect(await hasIps.json()).toMatchObject({ code: 'SUBNET_HAS_ADDRESSES' });
  });

  test('Member cấp được IP nhưng không khai được dải', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN quyền E2E ${stamp}`);
    await page.getByRole('button', { name: 'Đăng xuất' }).click();

    await firstLogin(page, E2E_MEMBER);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };

    // Người cắm máy chính là người biết IP nào vừa cấp — bắt chờ Admin duyệt thì cuốn sổ
    // sẽ quay về file Excel trên máy ai đó.
    const assigned = await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId, address: `172.16.${octet}.2`, usedBy: 'máy Member' },
    });
    expect(assigned.status()).toBe(201);

    // Nhưng khai dải thì không: dải sai kéo theo mọi IP bên trong sai.
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: '192.168.99.0/24', name: 'Member khai E2E' },
    });
    expect(subnet.status()).toBe(403);
  });
});
