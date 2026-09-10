import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetIpam,
  resetUsers,
  sql,
  writeHeaders,
} from './helpers';

/**
 * BỐN CỬA CÒN LẠI CỦA HAI HÀNG RÀO VỪA DỰNG — rà soát 10/09.
 *
 * ===== VÌ SAO CÓ FILE NÀY =====
 *
 * Đợt 07/09 đóng hai lỗ, và cả hai bản vá đều dừng lại ở cửa HẸP:
 *
 * 1. Finding #6 (`nat-ip-reclaim-guard.spec.ts`) đặt `assertNoLiveNatWithin` vào
 *    `transitionWithin` và `voidAddress`. Nhưng ba đường ghi khác dẫn tới đúng cùng một hậu
 *    quả — một port đang mở trỏ sang máy khác, hoặc trỏ vào một địa chỉ không còn hồ sơ nào
 *    nhắc tới — và không đường nào hỏi sổ NAT một câu:
 *
 *      · `PATCH /ipam/addresses/:id` đổi `deviceId`. Cùng kết quả với "cấp cho máy khác",
 *        chỉ khác đường vào: sửa hồ sơ thay vì chuyển trạng thái.
 *      · `PATCH /ipam/addresses/:id` đổi `address`. `nat_rule.internal_ip` giữ nguyên địa chỉ
 *        CŨ, nên sổ NAT và sổ IP nói khác nhau về cùng một cái máy.
 *      · `PATCH /ipam/subnets/:id/void` ẩn CẢ DẢI. Ẩn một IP lẻ thì bị chặn; ẩn cả trăm hồ sơ
 *        bằng một cú bấm thì không ai hỏi gì. Hàng rào dựng ở cửa hẹp, bỏ ngỏ cửa rộng.
 *
 * 2. `restore()` (code mới 09/09) mở đường bật lại một hồ sơ IP đã ẩn — nhưng trigger
 *    `ip_address_within_subnet_upd` khai `BEFORE UPDATE **OF address, subnet_id**`, mà
 *    `restore` chỉ đụng `voided_at`. Danh sách cột đó là một BỘ LỌC, nên trigger không bao giờ
 *    chạy trên đường này. Ghép với hàng rào đổi dải (chỉ đếm IP đang sống), ba cú bấm bình
 *    thường để lại một hàng nằm ngoài dải của chính nó — đúng thứ `0040_subnet_cidr_lock.sql`
 *    tuyên bố đã xoá sổ, và lần này KHÔNG cần cuộc đua nào.
 *
 * ===== MỖI CỬA ĐI KÈM MỘT VẾ ĐỐI CHỨNG =====
 *
 * Không có chúng thì một bản vá chặn-hết-cho-chắc (cấm sửa hồ sơ, cấm ẩn dải, cấm bật lại)
 * cũng làm cả file này xanh — và hàng rào biến thành cái khoá cửa chính. Ẩn cả dải là đường
 * DUY NHẤT để dọn một dải khai nhầm; bật lại là đường DUY NHẤT chữa một cú bấm nhầm.
 */

test.beforeEach(() => {
  resetUsers();
  resetIpam();
  resetDevices();
  resetCatalog();
});

interface Fixture {
  headers: Record<string, string>;
  routerId: string;
  otherDeviceId: string;
  ipId: string;
  internalIp: string;
  subnetId: string;
  octet: number;
}

async function setUp(page: Page, stamp: string): Promise<Fixture> {
  const headers = await writeHeaders(page);

  const catalog = (await (
    await page.request.get('/api/v1/catalog', { headers })
  ).json()) as { deviceTypes: { id: string; name: string }[] };
  const routerType =
    catalog.deviceTypes.find((t) => t.name === 'Router') ??
    catalog.deviceTypes.find((t) => t.name === 'Switch')!;
  const pcType =
    catalog.deviceTypes.find((t) => t.name === 'Switch') ?? catalog.deviceTypes[0];

  const router = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: `RT-E2E-CL-${stamp}`, name: 'Draytek cong chinh', deviceTypeId: routerType.id },
  });
  expect(router.status()).toBe(201);
  const routerId = ((await router.json()) as { device: { id: string } }).device.id;

  const other = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: `PC-E2E-CL-${stamp}`, name: 'Laptop ke toan', deviceTypeId: pcType.id },
  });
  expect(other.status()).toBe(201);
  const otherDeviceId = ((await other.json()) as { device: { id: string } }).device.id;

  const octet = Number(stamp) % 200;
  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { cidr: `172.16.${octet}.0/29`, name: `LAN cua con lai ${stamp}` },
  });
  expect(subnet.status()).toBe(201);
  const subnetId = ((await subnet.json()) as { id: string }).id;

  const internalIp = `172.16.${octet}.5`;
  const ip = await page.request.post('/api/v1/ipam/addresses', {
    headers,
    data: { subnetId, address: internalIp, usedBy: 'Camera tang 2' },
  });
  expect(ip.status()).toBe(201);
  const ipId = ((await ip.json()) as { id: string }).id;

  return { headers, routerId, otherDeviceId, ipId, internalIp, subnetId, octet };
}

async function addNatRule(page: Page, f: Fixture, ports: string): Promise<string> {
  const rule = await page.request.post('/api/v1/ipam/nat', {
    headers: f.headers,
    data: {
      deviceId: f.routerId,
      protocol: 'tcp',
      externalPorts: ports,
      internalIp: f.internalIp,
      internalPort: 80,
      usedBy: 'Camera tang 2',
      reason: 'Xem camera tu ngoai',
    },
  });
  expect(rule.status(), 'dựng được rule NAT thì mới có gì để canh').toBe(201);
  return ((await rule.json()) as { id: string }).id;
}

test.describe('Sửa hồ sơ IP cũng phải nhìn sổ NAT', () => {
  test('đổi MÁY trong hồ sơ khi còn rule NAT sống: bị chặn, và hồ sơ không đổi', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const f = await setUp(page, stamp);
    await addNatRule(page, f, '8090');

    const blocked = await page.request.patch(`/api/v1/ipam/addresses/${f.ipId}`, {
      headers: f.headers,
      data: { deviceId: f.otherDeviceId },
    });
    expect(
      blocked.status(),
      'gán hồ sơ sang máy khác = giao thẳng port 8090 đang mở cho máy đó',
    ).toBe(409);
    const body = (await blocked.json()) as { code?: string; message?: string };
    expect(body.code).toBe('IP_HAS_LIVE_NAT');
    expect(body.message, 'lỗi phải nêu đúng port để người trực đi gỡ được ngay').toContain('8090');

    expect(
      sql(`SELECT coalesce(device_id::text, '-') FROM ip_address WHERE id = '${f.ipId}'`),
      'bị chặn thì hồ sơ phải nguyên vẹn — chặn mà vẫn ghi thì tệ hơn không chặn',
    ).toBe('-');
  });

  test('đổi ĐỊA CHỈ trong hồ sơ khi còn rule NAT sống: bị chặn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const f = await setUp(page, stamp);
    await addNatRule(page, f, '8091');

    const blocked = await page.request.patch(`/api/v1/ipam/addresses/${f.ipId}`, {
      headers: f.headers,
      data: { address: `172.16.${f.octet}.6` },
    });
    expect(
      blocked.status(),
      'dời địa chỉ mà rule vẫn trỏ vào địa chỉ cũ = hai cuốn sổ nói khác nhau',
    ).toBe(409);
    expect(((await blocked.json()) as { code?: string }).code).toBe('IP_HAS_LIVE_NAT');
    expect(sql(`SELECT host(address) FROM ip_address WHERE id = '${f.ipId}'`)).toBe(f.internalIp);
  });

  /** VẾ ĐỐI CHỨNG: sửa thứ KHÔNG đụng tới chủ hay địa chỉ thì hàng rào phải im lặng. */
  test('sửa ghi chú của hồ sơ còn rule NAT sống: vẫn phải làm được', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const f = await setUp(page, stamp);
    await addNatRule(page, f, '8092');

    const ok = await page.request.patch(`/api/v1/ipam/addresses/${f.ipId}`, {
      headers: f.headers,
      data: { note: 'Camera tang 2 - da thay nguon' },
    });
    expect(ok.status(), 'hàng rào NAT không được chặn việc chẳng liên quan tới NAT').toBe(200);
  });
});

test.describe('Ẩn cả dải cũng phải nhìn sổ NAT', () => {
  test('ẩn dải khi bên trong còn IP có rule NAT sống: bị chặn, và không hồ sơ nào bị ẩn', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const f = await setUp(page, stamp);
    await addNatRule(page, f, '8093');

    const blocked = await page.request.patch(`/api/v1/ipam/subnets/${f.subnetId}/void`, {
      headers: f.headers,
      data: { reason: 'Doi sang dai khac' },
    });
    expect(
      blocked.status(),
      'ẩn một IP lẻ thì bị chặn, ẩn cả trăm hồ sơ bằng một cú bấm cũng phải bị chặn',
    ).toBe(409);
    const body = (await blocked.json()) as { code?: string; message?: string };
    expect(body.code).toBe('IP_HAS_LIVE_NAT');
    expect(
      body.message,
      'phải nêu ĐỊA CHỈ nào còn rule — một dải /24 có 254 ô, nói chung chung là bắt đi mò',
    ).toContain(f.internalIp);

    expect(
      sql(
        `SELECT count(*)::text FROM ip_address WHERE subnet_id = '${f.subnetId}' AND voided_at IS NOT NULL`,
      ),
      'chặn giữa chừng thì transaction phải rollback sạch, không hồ sơ nào bị ẩn',
    ).toBe('0');
    expect(
      sql(`SELECT coalesce(voided_at::text, '-') FROM subnet WHERE id = '${f.subnetId}'`),
    ).toBe('-');
  });

  /** VẾ ĐỐI CHỨNG: gỡ rule rồi thì ẩn cả dải phải chạy — đây là đường DỌN dải khai nhầm. */
  test('gỡ rule xong thì ẩn cả dải chạy bình thường', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const f = await setUp(page, stamp);
    const ruleId = await addNatRule(page, f, '8094');

    const dropped = await page.request.delete(`/api/v1/ipam/nat/${ruleId}`, {
      headers: f.headers,
      data: { reason: 'Khong dung nua' },
    });
    expect(dropped.status()).toBeLessThan(300);

    const ok = await page.request.patch(`/api/v1/ipam/subnets/${f.subnetId}/void`, {
      headers: f.headers,
      data: { reason: 'Doi sang dai khac' },
    });
    expect(ok.status(), 'hàng rào không được nhốt người dùng lại với một dải hỏng').toBeLessThan(
      300,
    );
    expect(
      sql(
        `SELECT count(*)::text FROM ip_address WHERE subnet_id = '${f.subnetId}' AND voided_at IS NULL`,
      ),
      'ẩn dải thì ẩn luôn hồ sơ bên trong',
    ).toBe('0');
  });
});

test.describe('Bật lại hồ sơ IP', () => {
  test('ẩn IP → đổi dải → bật lại: bị chặn, không được đẻ ra hàng ngoài dải', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const f = await setUp(page, stamp);

    const hidden = await page.request.delete(`/api/v1/ipam/addresses/${f.ipId}`, {
      headers: f.headers,
      data: { reason: 'Khai nham dia chi' },
    });
    expect(hidden.status(), 'ẩn hồ sơ lẻ phải làm được — đây là tiền đề của lỗ').toBeLessThan(300);

    // Dải đổi được vì hàng rào chỉ đếm IP ĐANG SỐNG, mà hồ sơ vừa ẩn thì không được đếm.
    const far = ((f.octet + 37) % 200) + 1;
    const moved = await page.request.patch(`/api/v1/ipam/subnets/${f.subnetId}`, {
      headers: f.headers,
      data: { cidr: `172.16.${far}.0/29` },
    });
    expect(moved.status(), 'đổi dải khi không còn IP sống là hợp lệ — đó là tiền đề').toBe(200);

    const blocked = await page.request.post(`/api/v1/ipam/addresses/${f.ipId}/restore`, {
      headers: f.headers,
    });
    expect(
      blocked.status(),
      'bật lại một địa chỉ ngoài dải = hàng vô hình trên màn dải nhưng vẫn hiện ở sổ NAT',
    ).toBe(409);
    const body = (await blocked.json()) as { code?: string; message?: string };
    expect(body.code).toBe('IP_OUT_OF_SUBNET');
    expect(
      body.message,
      'người bấm không thấy địa chỉ cũ ở đâu cả — câu lỗi phải nói ra dải hiện tại',
    ).toContain(`172.16.${far}.0/29`);

    expect(
      sql(`SELECT (voided_at IS NULL)::text FROM ip_address WHERE id = '${f.ipId}'`),
      'bị chặn thì hồ sơ phải nằm nguyên ở trạng thái đã ẩn',
    ).toBe('false');
  });

  /** VẾ ĐỐI CHỨNG: dải KHÔNG đổi thì bật lại phải chạy — nếu không, tính năng chết lặng. */
  test('ẩn IP rồi bật lại khi dải không đổi: chạy bình thường', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const f = await setUp(page, stamp);

    await page.request.delete(`/api/v1/ipam/addresses/${f.ipId}`, {
      headers: f.headers,
      data: { reason: 'Khai nham' },
    });
    const ok = await page.request.post(`/api/v1/ipam/addresses/${f.ipId}/restore`, {
      headers: f.headers,
    });
    expect(ok.status(), 'bật lại là đường khôi phục, không được chết theo bản vá').toBe(201);
    expect(
      sql(`SELECT coalesce(voided_at::text, '-') FROM ip_address WHERE id = '${f.ipId}'`),
    ).toBe('-');
  });

});
