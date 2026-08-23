import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetDevices, resetIpam, resetUsers } from './helpers';

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

interface Fixture {
  headers: Record<string, string>;
  routerId: string;
  routerCode: string;
  subnetId: string;
  internalIp: string;
}

async function setUp(page: Page, stamp: string): Promise<Fixture> {
  const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://localhost' };
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const type = catalog.deviceTypes.find((t) => t.name === 'Router')
    ?? catalog.deviceTypes.find((t) => t.name === 'Switch')!;

  const routerCode = `RT-E2E-NAT-${stamp}`;
  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: routerCode, name: 'Draytek cổng chính', deviceTypeId: type.id },
  });
  expect(device.status()).toBe(201);
  const routerId = ((await device.json()) as { device: { id: string } }).device.id;

  const octet = Number(stamp) % 200;
  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { cidr: `172.16.${octet}.0/29`, name: `LAN NAT E2E ${stamp}` },
  });
  const subnetId = ((await subnet.json()) as { id: string }).id;
  const internalIp = `172.16.${octet}.5`;
  await page.request.post('/api/v1/ipam/addresses', {
    headers,
    data: { subnetId, address: internalIp, usedBy: 'Máy chấm công' },
  });

  return { headers, routerId, routerCode, subnetId, internalIp };
}

/** Story 5.3 — FR-017: sổ NAT trả lời "port nào mở, vì sao, cho ai". */
test.describe('Sổ NAT', () => {
  test('đường hạnh phúc: thêm rule → hiện đủ port/lý do/người dùng → nối được sang hồ sơ IP', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { routerCode, internalIp } = await setUp(page, stamp);

    await page.goto('/so-nat');
    await page.getByRole('button', { name: 'Thêm rule' }).click();
    const form = page.getByRole('dialog');
    await form.getByPlaceholder('Gõ mã hoặc tên router…').fill(routerCode);
    await page.getByRole('option', { name: new RegExp(routerCode) }).click();
    await form.getByRole('textbox', { name: 'Port ngoài' }).fill('8080');
    await form.getByRole('textbox', { name: 'IP trong' }).fill(internalIp);
    await form.getByRole('textbox', { name: 'Port trong' }).fill('80');
    await form.getByRole('textbox', { name: 'Mở cho ai' }).fill('Phòng Nhân sự');
    await form.getByRole('textbox', { name: 'Lý do mở' }).fill('máy chấm công truy cập từ ngoài');
    await form.getByRole('button', { name: 'Lưu' }).click();

    // Ba câu của auditor phải nằm NGAY TRÊN BẢNG, không giấu trong trang chi tiết.
    const row = page.getByRole('row', { name: new RegExp(routerCode) });
    await expect(row.getByText('TCP 8080')).toBeVisible();
    await expect(row.getByText(`${internalIp}:80`)).toBeVisible();
    await expect(row.getByText('Phòng Nhân sự')).toBeVisible();
    await expect(row.getByText('máy chấm công truy cập từ ngoài')).toBeVisible();
    // Nối mềm sang hồ sơ IP: biết luôn port này dẫn tới máy của ai.
    // `exact` vì chữ "máy chấm công" còn nằm trong ô Lý do ngay bên cạnh.
    await expect(row.getByText('Máy chấm công', { exact: true })).toBeVisible();
  });

  /**
   * Ràng buộc đắt nhất và đáng giá nhất của bảng: sổ NAT phải có ĐÚNG MỘT câu trả lời cho
   * mỗi port. EXCLUDE ở tầng DB bắt được cả chồng MỘT PHẦN — thứ mà UNIQUE hai cột không thấy.
   */
  test('đường hỏng: hai rule chồng port ngoài trên cùng router bị chặn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { headers, routerId, internalIp } = await setUp(page, stamp);
    const base = {
      deviceId: routerId,
      protocol: 'tcp',
      internalIp,
      internalPort: 80,
      usedBy: 'Phòng Nhân sự',
      reason: 'máy chấm công',
    };

    expect(
      (
        await page.request.post('/api/v1/ipam/nat', {
          headers,
          data: { ...base, externalPorts: '8000-8010' },
        })
      ).status(),
    ).toBe(201);

    // Chồng MỘT PHẦN: 8005 nằm trong cả hai dải.
    const overlap = await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: { ...base, externalPorts: '8005-8020', usedBy: 'Phòng Kho' },
    });
    expect(overlap.status()).toBe(409);
    expect(await overlap.json()).toMatchObject({ code: 'NAT_PORT_OVERLAP' });

    // Khác GIAO THỨC thì cho phép — Draytek khai riêng TCP và UDP cùng port là chuyện bình thường.
    const udp = await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: { ...base, protocol: 'udp', externalPorts: '8000-8010' },
    });
    expect(udp.status()).toBe(201);
  });

  test('đường hỏng: thiếu lý do hoặc thiếu người dùng thì không lưu được', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { headers, routerId, internalIp } = await setUp(page, stamp);
    const base = {
      deviceId: routerId,
      protocol: 'tcp',
      externalPorts: '9090',
      internalIp,
      internalPort: 80,
      usedBy: 'Phòng Nhân sự',
      reason: 'máy chấm công',
    };

    for (const over of [{ reason: '   ' }, { usedBy: '   ' }]) {
      const res = await page.request.post('/api/v1/ipam/nat', {
        headers,
        data: { ...base, ...over },
      });
      expect(res.status()).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'NAT_INVALID' });
    }
  });

  test('đường hỏng: port ngoài gõ sai được chỉ đúng chỗ sai', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { headers, routerId, internalIp } = await setUp(page, stamp);
    const base = {
      deviceId: routerId,
      protocol: 'tcp',
      internalIp,
      internalPort: 80,
      usedBy: 'Phòng Nhân sự',
      reason: 'máy chấm công',
    };

    const reversed = await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: { ...base, externalPorts: '8010-8000' },
    });
    expect(reversed.status()).toBe(400);
    // Viết ngược đầu phải được nói RIÊNG, không gộp vào "sai định dạng".
    expect(((await reversed.json()) as { message: string }).message).toContain('ngược');

    const bad = await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: { ...base, externalPorts: '80,443' },
    });
    expect(bad.status()).toBe(400);
    expect(((await bad.json()) as { message: string }).message).toContain('8000-8010');
  });

  /** AC 5.3: trang thiết bị hiển thị rule của chính nó (qua sổ khu mở rộng của story 2.5). */
  test('trang router hiện sổ NAT của chính nó, devices không phải biết NAT là gì', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { headers, routerId, internalIp } = await setUp(page, stamp);
    await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: {
        deviceId: routerId,
        protocol: 'tcp',
        externalPorts: '8443',
        internalIp,
        internalPort: 443,
        usedBy: 'Phòng Kế toán',
        reason: 'phần mềm thuế truy cập từ ngoài',
      },
    });

    await page.goto(`/thiet-bi/${routerId}`);
    await expect(page.getByRole('heading', { name: 'Sổ NAT' })).toBeVisible();
    await expect(page.getByText('TCP 8443')).toBeVisible();
    await expect(page.getByText(/phần mềm thuế truy cập từ ngoài/)).toBeVisible();
  });

  /**
   * AC 5.3 đòi export xlsx. Cố ý CÓ ở đây trong khi két sắt tuyệt đối không có (FR-026):
   * sổ NAT là thứ phải đem đi trình auditor, mật khẩu thì không.
   */
  test('xuất Excel sổ NAT tải về được', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { headers, routerId, internalIp } = await setUp(page, stamp);
    await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: {
        deviceId: routerId,
        protocol: 'tcp',
        externalPorts: '8080',
        internalIp,
        internalPort: 80,
        usedBy: 'Phòng Nhân sự',
        reason: 'máy chấm công',
      },
    });

    const res = await page.request.get('/api/v1/ipam/nat/export.xlsx');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('spreadsheetml');
    expect((await res.body()).length).toBeGreaterThan(1000);
  });
});

/** Story 5.4 — panel IP trên trang thiết bị. */
test.describe('Panel IP trên trang thiết bị', () => {
  test('thiết bị có IP thì trang chi tiết hiện địa chỉ và bấm sang được dải', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { headers, routerId, subnetId, internalIp } = await setUp(page, stamp);
    const octet = Number(stamp) % 200;

    // Gán một IP cho chính con router.
    await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: {
        subnetId,
        address: `172.16.${octet}.1`,
        deviceId: routerId,
        usedBy: 'cổng mặc định',
      },
    });

    await page.goto(`/thiet-bi/${routerId}`);
    await expect(page.getByRole('heading', { name: 'Địa chỉ IP' })).toBeVisible();
    await expect(page.getByText(`172.16.${octet}.1`)).toBeVisible();
    await expect(page.getByText('cổng mặc định')).toBeVisible();
    // IP của máy khác KHÔNG được lọt vào panel của con router này.
    await expect(page.getByText(internalIp)).toHaveCount(0);
  });

  test('thiết bị chưa có IP thì KHÔNG hiện khu trống lơ lửng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { routerId } = await setUp(page, stamp);

    await page.goto(`/thiet-bi/${routerId}`);
    await expect(page.getByRole('tab', { name: 'Hồ sơ' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Địa chỉ IP' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sổ NAT' })).toHaveCount(0);
  });
});
