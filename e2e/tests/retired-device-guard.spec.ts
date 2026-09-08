import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetIpam,
  resetIsp,
  resetSoftware,
  resetUsers,
  writeHeaders,
} from './helpers';

/**
 * Rà soát 07/09, mục "miền nghiệp vụ": thiết bị `retired` có **8 điểm ghi đang hở**.
 *
 * Máy đã thanh lý — đã ra khỏi công ty, đã ký biên bản — vẫn nhận được license, vẫn được cấp
 * IP, vẫn dựng được rule NAT trỏ vào nó, vẫn cắm được đường truyền. Không cửa nào hỏi một câu.
 *
 * Nguyên nhân gốc mà rà soát chỉ đúng: `devices.api.exists()` chỉ trả lời "có hàng này trong
 * bảng không". Module khác muốn hỏi "máy này còn dùng được không" thì KHÔNG CÓ CỬA NÀO — và
 * AD-2 cấm chúng tự query bảng `device`. Nên bốn nơi đều hỏi câu duy nhất hỏi được, rồi đi
 * tiếp. Hàng rào không thiếu vì ai đó lười; nó thiếu vì cái api không cho hỏi.
 *
 * Bài này canh cả bốn cửa cùng lúc: sửa một cửa mà quên ba cửa kia là đúng mẫu N1 đã lặp ba
 * lần trong repo này.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetIpam();
  resetSoftware();
  resetIsp();
  resetCatalog();
});

async function typeIdFor(page: Page, name: string): Promise<string> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const found = catalog.deviceTypes.find((t) => t.name === name) ?? catalog.deviceTypes[0];
  return found.id;
}

async function makeDevice(page: Page, code: string, typeName: string): Promise<string> {
  const res = await page.request.post('/api/v1/devices', {
    headers: await writeHeaders(page),
    data: { code, name: `May ${code}`, deviceTypeId: await typeIdFor(page, typeName) },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { device: { id: string } }).device.id;
}

async function retire(page: Page, deviceId: string): Promise<void> {
  const res = await page.request.patch(`/api/v1/devices/${deviceId}/status`, {
    headers: await writeHeaders(page),
    data: { status: 'retired' },
  });
  expect(res.status(), 'thanh lý máy phải chạy được — đó là việc bình thường').toBeLessThan(300);
}

/** Mọi cửa phải trả CÙNG mã lỗi: người dùng gặp một khái niệm, không phải bốn. */
const CODE = 'DEVICE_RETIRED';

test.describe('Máy đã thanh lý không nhận thêm gì nữa', () => {
  test('không cấp được IP cho máy đã thanh lý', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const deviceId = await makeDevice(page, `PC-E2E-RT-${stamp}`, 'PC');

    const octet = Number(stamp) % 200;
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers: await writeHeaders(page),
      data: { cidr: `172.17.${octet}.0/29`, name: `LAN E2E retired ${stamp}` },
    });
    expect(subnet.status()).toBe(201);
    const subnetId = ((await subnet.json()) as { id: string }).id;

    await retire(page, deviceId);

    const res = await page.request.post('/api/v1/ipam/addresses', {
      headers: await writeHeaders(page),
      data: { subnetId, address: `172.17.${octet}.5`, deviceId },
    });
    expect(res.status(), 'cấp IP cho máy đã ra khỏi công ty là ghi sai sổ').toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe(CODE);
  });

  test('không gán được license cho máy đã thanh lý', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const deviceId = await makeDevice(page, `PC-E2E-RTL-${stamp}`, 'PC');

    const sw = await page.request.post('/api/v1/software', {
      headers: await writeHeaders(page),
      data: {
        code: `SW-E2E-RT-${stamp}`,
        name: 'Office',
        kind: 'license',
        seatTotal: 10,
        startDate: '2025-01-01',
        endDate: '2027-12-31',
      },
    });
    expect(sw.status()).toBe(201);
    const softwareId = ((await sw.json()) as { id: string }).id;

    await retire(page, deviceId);

    const res = await page.request.post(`/api/v1/software/${softwareId}/assignments`, {
      headers: await writeHeaders(page),
      data: { deviceId },
    });
    expect(res.status(), 'máy đã thanh lý không được ăn thêm một ghế license nào').toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe(CODE);
  });

  test('không dựng được rule NAT trên router đã thanh lý', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const routerId = await makeDevice(page, `RT-E2E-RT-${stamp}`, 'Router');

    await retire(page, routerId);

    const res = await page.request.post('/api/v1/ipam/nat', {
      headers: await writeHeaders(page),
      data: {
        deviceId: routerId,
        protocol: 'tcp',
        externalPorts: '9090',
        internalIp: '172.18.0.9',
        internalPort: 80,
        usedBy: 'May nao do',
        reason: 'Thu tren router da thanh ly',
      },
    });
    expect(res.status(), 'mở port trên một router đã tháo là mở port vào hư không').toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe(CODE);
  });

  test('không cắm được đường truyền vào máy đã thanh lý', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const deviceId = await makeDevice(page, `RT-E2E-RTI-${stamp}`, 'Router');

    await retire(page, deviceId);

    const res = await page.request.post('/api/v1/isp-lines', {
      headers: await writeHeaders(page),
      data: { code: `ISP-E2E-RT-${stamp}`, provider: 'Viettel', deviceId },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe(CODE);
  });

  /**
   * Vế đối chứng, và là vế giữ cho hàng rào không nuốt việc đúng: máy `broken` (hỏng, đang
   * chờ sửa) VẪN nhận được. Nó còn trong công ty, còn hồ sơ, còn giữ license và IP của nó —
   * chỉ `retired` mới là "đã ra khỏi sổ".
   *
   * Không có bài này thì một bản sửa cẩu thả chặn theo `status !== 'in_use'` cũng xanh, và
   * cả phòng IT hết cấp được IP cho máy đang sửa.
   */
  test('máy HỎNG thì vẫn cấp IP được — chỉ "đã thanh lý" mới bị chặn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const deviceId = await makeDevice(page, `PC-E2E-BRK-${stamp}`, 'PC');

    const octet = (Number(stamp) % 200) + 20;
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers: await writeHeaders(page),
      data: { cidr: `172.19.${octet}.0/29`, name: `LAN E2E broken ${stamp}` },
    });
    const subnetId = ((await subnet.json()) as { id: string }).id;

    const changed = await page.request.patch(`/api/v1/devices/${deviceId}/status`, {
      headers: await writeHeaders(page),
      data: { status: 'broken' },
    });
    expect(changed.status()).toBeLessThan(300);

    const res = await page.request.post('/api/v1/ipam/addresses', {
      headers: await writeHeaders(page),
      data: { subnetId, address: `172.19.${octet}.5`, deviceId },
    });
    expect(res.status(), 'máy đang chờ sửa vẫn là máy của công ty').toBe(201);
  });

  /** Thiết bị không tồn tại vẫn phải là lỗi RIÊNG — hai chuyện khác nhau, hai câu khác nhau. */
  test('thiết bị ma vẫn báo "không tồn tại", không lẫn với "đã thanh lý"', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers: await writeHeaders(page),
      data: { cidr: `172.20.${Number(stamp) % 200}.0/29`, name: `LAN E2E ma ${stamp}` },
    });
    const subnetId = ((await subnet.json()) as { id: string }).id;

    const res = await page.request.post('/api/v1/ipam/addresses', {
      headers: await writeHeaders(page),
      data: {
        subnetId,
        address: `172.20.${Number(stamp) % 200}.5`,
        deviceId: '00000000-0000-0000-0000-000000000000',
      },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('DEVICE_NOT_FOUND');
  });
});
