import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetIpam,
  resetUsers,
  sql,
} from './helpers';

/**
 * Finding #6 của rà soát 07/09 — cửa duy nhất trong cả đợt C mở một cổng ra ngoài vào MÁY SAI.
 *
 * ===== KỊCH BẢN THẬT =====
 *
 * Rule `TCP 8080 → 172.16.10.5`, lý do "camera tầng 2". Camera chết. IT thu hồi `.5` — không
 * một lời cảnh báo. Tuần sau `.5` được cấp cho laptop kế toán. **Port 8080 vẫn mở, và giờ nó
 * trỏ vào laptop kế toán.** Không ai làm gì sai theo từng bước; cái sai nằm ở chỗ hai cuốn sổ
 * không nói chuyện với nhau (`ip-address.service.ts` ↔ `nat-rule`: 0 dòng nối).
 *
 * FK `ip_address_id` là `ON DELETE SET NULL`, nên nghe thì tưởng có hàng rào. Không có: thu
 * hồi và ẩn đều là XÓA MỀM, nên FK không bao giờ bắn.
 *
 * ===== VÌ SAO BÀI NÀY LÀ E2E =====
 *
 * Thứ cần chứng minh là một câu truy vấn chạy ĐÚNG TRONG transaction đổi trạng thái. `CLAUDE.md`
 * cấm mock drizzle và tầng integration chạm DB thật thì chưa có (`api/test/` rỗng), nên đây là
 * tầng duy nhất chứng minh được — cùng lý do đã ghi ở `m2-concurrency.spec.ts`.
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
  ipId: string;
  internalIp: string;
}

async function setUp(page: Page, stamp: string): Promise<Fixture> {
  const csrf = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
  const headers = { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN };

  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const type =
    catalog.deviceTypes.find((t) => t.name === 'Router') ??
    catalog.deviceTypes.find((t) => t.name === 'Switch')!;

  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: `RT-E2E-RG-${stamp}`, name: 'Draytek cổng chính', deviceTypeId: type.id },
  });
  expect(device.status()).toBe(201);
  const routerId = ((await device.json()) as { device: { id: string } }).device.id;

  const octet = Number(stamp) % 200;
  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { cidr: `172.16.${octet}.0/29`, name: `LAN thu hoi E2E ${stamp}` },
  });
  expect(subnet.status()).toBe(201);
  const subnetId = ((await subnet.json()) as { id: string }).id;

  const internalIp = `172.16.${octet}.5`;
  // `usedBy` khác rỗng → `create()` đặt status 'assigned' (ip-address.service.ts:278).
  const ip = await page.request.post('/api/v1/ipam/addresses', {
    headers,
    data: { subnetId, address: internalIp, usedBy: 'Camera tang 2' },
  });
  expect(ip.status()).toBe(201);
  const ipId = ((await ip.json()) as { id: string }).id;

  return { headers, routerId, ipId, internalIp };
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

test.describe('Thu hồi IP phải nhìn sổ NAT', () => {
  test('IP còn rule NAT đang mở thì KHÔNG thu hồi được, và lỗi phải nói rõ port nào', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const f = await setUp(page, stamp);
    await addNatRule(page, f, '8080');

    const blocked = await page.request.post(`/api/v1/ipam/addresses/${f.ipId}/transition`, {
      headers: f.headers,
      data: { to: 'free', reason: 'Camera hong' },
    });

    expect(
      blocked.status(),
      'thu hồi một IP còn port-forward trỏ vào là mở cổng cho máy kế tiếp — phải bị chặn',
    ).toBe(409);
    const body = (await blocked.json()) as { code?: string; message?: string };
    expect(body.code).toBe('IP_HAS_LIVE_NAT');
    /*
     * Thông điệp phải CHỈ ĐƯỢC RULE NÀO. "Còn rule NAT" chung chung thì người trực phải đi mò
     * cả sổ — và trong lúc mò thì việc dừng lại, nên họ sẽ tìm đường lách thay vì đi dọn.
     */
    expect(body.message, 'lỗi phải nêu đúng port đang mở để người trực đi gỡ được ngay').toContain(
      '8080',
    );

    // Trạng thái KHÔNG được đổi — chặn mà vẫn ghi thì tệ hơn không chặn.
    const after = sql(`SELECT status FROM ip_address WHERE id = '${f.ipId}'`);
    expect(after, 'bị chặn thì trạng thái phải nguyên vẹn').toBe('assigned');
  });

  test('gỡ rule NAT xong thì thu hồi chạy bình thường — hàng rào không được chặn việc đúng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const f = await setUp(page, stamp);
    const ruleId = await addNatRule(page, f, '8081');

    const voided = await page.request.delete(`/api/v1/ipam/nat/${ruleId}`, {
      headers: f.headers,
      data: { reason: 'Camera hong, khong dung nua' },
    });
    expect(voided.status()).toBeLessThan(300);

    const ok = await page.request.post(`/api/v1/ipam/addresses/${f.ipId}/transition`, {
      headers: f.headers,
      data: { to: 'free', reason: 'Camera hong' },
    });
    expect(ok.status(), "gỡ rule rồi thì thu hồi phải chạy").toBe(201);
    expect(sql(`SELECT status FROM ip_address WHERE id = '${f.ipId}'`)).toBe('free');
  });

  /**
   * DỮ LIỆU CŨ — vế mà hàng rào thu hồi một mình KHÔNG với tới được.
   *
   * Chặn ở lượt thu hồi giữ cho trạng thái xấu không sinh ra NỮA, nhưng những IP đã bị thu hồi
   * TRƯỚC khi có hàng rào thì vẫn đang nằm đó, kèm rule NAT còn sống. Khoảnh khắc gây hại là
   * lượt CẤP LẠI — đó mới là lúc port cũ bắt đầu trỏ vào máy mới.
   *
   * Bài này dựng đúng trạng thái đó bằng SQL (không đi qua API, vì API nay đã chặn) rồi chứng
   * minh cửa thứ hai bắt được.
   */
  test('IP đã thu hồi từ trước mà còn rule NAT sống thì KHÔNG cấp lại được', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const f = await setUp(page, stamp);
    await addNatRule(page, f, '8082');

    // Đẩy thẳng về 'free' bằng SQL = giả lập dữ liệu có từ trước hàng rào.
    sql(
      `UPDATE ip_address SET status = 'free', device_id = NULL, used_by = NULL ` +
        `WHERE id = '${f.ipId}'`,
    );

    const blocked = await page.request.post(`/api/v1/ipam/addresses/${f.ipId}/transition`, {
      headers: f.headers,
      data: { to: 'assigned', usedBy: 'Laptop ke toan' },
    });
    expect(
      blocked.status(),
      'cấp lại một IP còn port-forward cũ = giao thẳng port đó cho máy mới',
    ).toBe(409);
    expect(((await blocked.json()) as { code?: string }).code).toBe('IP_HAS_LIVE_NAT');
  });

  /**
   * Rule NAT trỏ tới một địa chỉ CHƯA có hồ sơ IPAM là hợp lệ (`linkIp` trả null, "không có
   * cũng lưu được"). Nhưng trỏ vào một địa chỉ mà IPAM nói là TRỐNG (đã thu hồi) thì đó là dấu hiệu
   * hoặc sổ sai hoặc port mở nhầm chỗ — phải nói, dù không chặn.
   *
   * Không chặn ở chiều này là có chủ ý: người ta hay khai rule TRƯỚC khi dựng xong máy, và
   * chặn sẽ biến hàng rào thành thứ bị tìm cách lách.
   */
  test('khai rule NAT trỏ vào IP đã thu hồi thì vẫn lưu được nhưng phải CẢNH BÁO', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const f = await setUp(page, stamp);

    sql(
      `UPDATE ip_address SET status = 'free', device_id = NULL, used_by = NULL ` +
        `WHERE id = '${f.ipId}'`,
    );

    const rule = await page.request.post('/api/v1/ipam/nat', {
      headers: f.headers,
      data: {
        deviceId: f.routerId,
        protocol: 'tcp',
        externalPorts: '8083',
        internalIp: f.internalIp,
        internalPort: 80,
        usedBy: 'May moi',
        reason: 'Dung truoc khi dung xong may',
      },
    });
    expect(rule.status(), 'chiều này CẢNH BÁO chứ không chặn').toBe(201);
    const body = (await rule.json()) as { warnings?: string[] };
    expect(body.warnings ?? [], 'phải có cảnh báo IP đang không có chủ').not.toHaveLength(0);
    expect(
      (body.warnings ?? []).join(' '),
      'cảnh báo phải nói rõ trạng thái, không chỉ "có gì đó lạ"',
    ).toMatch(/thu hồi|chưa cấp|không có chủ/i);
  });
});
