import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  confirmAction,
  E2E_SA,
  firstLogin,
  resetDevices,
  resetUsers,
  rowAction,
  uniqueStamp,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetDevices();
});

async function createDevice(page: Page, code: string, typeName: string): Promise<string> {
  const csrf = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const type = catalog.deviceTypes.find((t) => t.name === typeName)!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data: { code, name: `${typeName} ${code}`, deviceTypeId: type.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

test.describe('Port map', () => {
  test('AD-14: khai một dòng ở switch, trang server tự hiện chiều ngược', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const switchCode = `SW-E2E-${stamp}`;
    const serverCode = `SRV-E2E-${stamp}`;
    const switchId = await createDevice(page, switchCode, 'Switch');
    const serverId = await createDevice(page, serverCode, 'Server');

    await page.goto(`/devices/${switchId}`);
    await page.getByRole('tab', { name: 'Sơ đồ cổng' }).click();
    await expect(page.getByText('Chưa khai báo cổng nào.')).toBeVisible();

    await page.getByRole('button', { name: 'Thêm cổng' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Cổng', exact: true }).fill('Gi1/0/12');
    // Bám theo TÊN: form có hai combobox (thiết bị đầu kia, và ô "ai dùng" gợi ý phòng ban).
    await form.getByRole('combobox', { name: 'Thiết bị đầu kia' }).fill(serverCode);
    await page.getByRole('option', { name: new RegExp(serverCode) }).click();
    await form.getByRole('textbox', { name: 'Cổng đầu kia' }).fill('eth0');
    await form.getByRole('combobox', { name: 'Người sử dụng' }).fill('phòng Kế toán');
    await form.getByRole('button', { name: 'Lưu' }).click();

    const row = page.getByRole('row', { name: /Gi1\/0\/12/ });
    await expect(row).toBeVisible();
    await expect(row.getByRole('link', { name: serverCode })).toBeVisible();

    // Trang thiết bị ĐẦU KIA: dòng hiện ở bảng chiều ngược, KHÔNG có bản ghi đối xứng.
    await page.goto(`/devices/${serverId}`);
    await page.getByRole('tab', { name: 'Sơ đồ cổng' }).click();
    await expect(page.getByText('Chưa khai báo cổng nào.')).toBeVisible();

    const reverse = page.getByRole('row', { name: new RegExp(switchCode) });
    await expect(reverse).toBeVisible();
    await expect(reverse.getByText('Gi1/0/12')).toBeVisible();

    // Chiều ngược chỉ để ĐỌC — sửa ở nơi giữ bản ghi.
    // Bám nút BA CHẤM chứ không bám chữ "Xóa": mục xóa nằm trong menu, nên
    // `getByRole('button', { name: 'Xóa' })` trả 0 kể cả khi menu có mục đó — một khẳng
    // định luôn xanh không kiểm được gì.
    await expect(reverse.getByRole('button', { name: /^Thao tác với/ })).toHaveCount(0);

    // API nói thẳng: server có 0 cổng của mình, 1 cổng đang cắm vào.
    const map = await page.evaluate(async (id: string) => {
      const res = await fetch(`/api/v1/devices/${id}/ports`, { credentials: 'include' });
      return (await res.json()) as { ports: unknown[]; incoming: unknown[] };
    }, serverId);
    expect(map.ports).toHaveLength(0);
    expect(map.incoming).toHaveLength(1);
  });

  test('trùng tên cổng trên cùng thiết bị bị chặn, nói rõ cổng nào', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const switchId = await createDevice(page, `SW-E2E-DUP-${stamp}`, 'Switch');

    await page.goto(`/devices/${switchId}`);
    await page.getByRole('tab', { name: 'Sơ đồ cổng' }).click();

    for (let i = 0; i < 2; i += 1) {
      await page.getByRole('button', { name: 'Thêm cổng' }).click();
      const form = page.getByRole('dialog');
      await form.getByRole('textbox', { name: 'Cổng', exact: true }).fill('24');
      // Đầu kia là MỘT trong hai: chọn chế độ mô tả tự do trước rồi mới có ô để gõ.
      await form.getByText('Mô tả tự do', { exact: true }).click();
      await form.getByRole('textbox', { name: 'Mô tả đầu kia' }).fill(`lần ${i + 1}`);
      await form.getByRole('button', { name: 'Lưu' }).click();
      if (i === 0) await expect(page.getByRole('row', { name: /24/ })).toBeVisible();
    }

    await expect(page.getByText(/đã có dòng cho cổng "24"/)).toBeVisible();
  });

  test('Q-20: một cổng một sợi cáp, kiểm cả chiều ngược, không phân biệt hoa/thường', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const switchCode = `SW-E2E-1C-${stamp}`;
    const serverCode = `SRV-E2E-1C-${stamp}`;
    const otherCode = `SW-E2E-1C2-${stamp}`;
    const switchId = await createDevice(page, switchCode, 'Switch');
    const serverId = await createDevice(page, serverCode, 'Server');
    await createDevice(page, otherCode, 'Switch');

    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    // Switch Gi1/0/12 → server eth0.
    const first = await page.request.post(`/api/v1/devices/${switchId}/ports`, {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { portLabel: 'Gi1/0/12', connectedDeviceId: serverId, connectedPort: 'eth0' },
    });
    expect(first.status()).toBe(201);

    // Trên server, khai cổng ETH0 (viết hoa) nối sang switch khác → bị chặn, nói rõ ai giữ cổng.
    await page.goto(`/devices/${serverId}`);
    await page.getByRole('tab', { name: 'Sơ đồ cổng' }).click();
    await page.getByRole('button', { name: 'Thêm cổng' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Cổng', exact: true }).fill('ETH0');
    await form.getByRole('combobox', { name: 'Thiết bị đầu kia' }).fill(otherCode);
    await page.getByRole('option', { name: new RegExp(otherCode) }).click();
    await form.getByRole('textbox', { name: 'Cổng đầu kia' }).fill('1');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form.getByRole('alert')).toContainText(
      `Cổng "ETH0" của thiết bị này đã có cáp nối từ ${switchCode} cổng "Gi1/0/12"`,
    );

    // Dòng ngược của CÙNG sợi cáp thì được (chọn lại đầu kia là switch, cổng gi1/0/12).
    await form.getByRole('combobox', { name: 'Thiết bị đầu kia' }).fill(switchCode);
    await page.getByRole('option', { name: new RegExp(switchCode) }).click();
    await form.getByRole('textbox', { name: 'Cổng đầu kia' }).fill('gi1/0/12');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('row', { name: /ETH0/ })).toBeVisible();
  });

  test('không cắm được thiết bị vào chính nó', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const switchId = await createDevice(page, `SW-E2E-SELF-${stamp}`, 'Switch');

    const csrf = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return ((await res.json()) as { csrfToken: string }).csrfToken;
    });
    const response = await page.request.post(`/api/v1/devices/${switchId}/ports`, {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { portLabel: '1', connectedDeviceId: switchId },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'PORT_SELF_LINK' });
  });

  test('loại thiết bị không có port map thì không hiện tab', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const printerId = await createDevice(page, `PC-E2E-NOPORT-${stamp}`, 'Printer');

    await page.goto(`/devices/${printerId}`);
    await expect(page.getByRole('tab', { name: 'Tổng quan' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sơ đồ cổng' })).toHaveCount(0);
  });

  test('xóa dòng port map để lại vết trong lịch sử thiết bị', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const switchId = await createDevice(page, `SW-E2E-HIST-${stamp}`, 'Switch');

    await page.goto(`/devices/${switchId}`);
    await page.getByRole('tab', { name: 'Sơ đồ cổng' }).click();
    await page.getByRole('button', { name: 'Thêm cổng' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Cổng', exact: true }).fill('WAN1');
    await form.getByText('Mô tả tự do', { exact: true }).click();
    await form.getByRole('textbox', { name: 'Mô tả đầu kia' }).fill('uplink nhà mạng');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('row', { name: /WAN1/ })).toBeVisible();

    await rowAction(page, 'WAN1', 'Xóa');
    await confirmAction(page);
    await expect(page.getByText('Chưa khai báo cổng nào.')).toBeVisible();

    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    // Câu tự nhiên, tên cổng nằm ngay trong câu — không phải "cổng: (trống) → WAN1".
    await expect(page.getByText('Thêm cổng WAN1', { exact: true })).toBeVisible();
    await expect(page.getByText('Xóa cổng WAN1', { exact: true })).toBeVisible();
  });
});
