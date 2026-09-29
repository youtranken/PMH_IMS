import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetIpam,
  resetSoftware,
  resetUsers,
  writeHeaders,
  uniqueStamp,
} from './helpers';

/**
 * A-03: XOÁ một ô ngày không giống BỎ TRỐNG nó khi gửi lên.
 *
 * `prepare()` của cả ba service ghép bản sửa với hồ sơ đang có bằng `??`:
 *
 *     endDate: (values.endDate ?? current?.endDate ?? null)
 *
 * `dateOnly("")` trả `null` — nghĩa là "người dùng đã xoá ô này". Nhưng `??` coi `null` y
 * hệt `undefined` ("người dùng không đụng tới ô này"), nên luật đi soi trên ngày **CŨ**.
 * Hai hậu quả ngược chiều nhau:
 *
 *  1. **Lọt cái phải chặn.** `{"endDate":""}` trên một chứng chỉ SSL: `requiresEndDate` soi
 *     ngày cũ nên không nổ, rồi câu ghi vẫn ghi `end_date = NULL`. Hồ sơ mất hạn — đúng thứ
 *     `software-rules.ts` sinh ra để cấm — và vì `findExpiringBetween` lọc `end_date IS NOT
 *     NULL`, nó biến khỏi MỌI lời nhắc gia hạn, vĩnh viễn, không một dòng lỗi. Không lưới DB.
 *  2. **Chặn cái phải cho qua.** Xoá một ô rồi sửa ô khác: luật so với giá trị vừa bị xoá và
 *     từ chối. Người dùng bị nhốt lại bởi một giá trị không còn tồn tại.
 *
 * Đường nhập Excel làm ĐÚNG với cùng bài toán từ trước (`device-import.ts` dùng `field in
 * values`). Lại là hình dạng của A-01: cửa Excel được canh, cửa HTTP bỏ ngỏ.
 *
 * Bài đi thẳng HTTP chứ không qua form: ô ngày trên màn hình là widget lịch, còn thứ đang
 * kiểm là phép GHÉP ở tầng service — cửa mà import, script và mọi tích hợp sau này đều đi qua.
 */

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  // Khối "Sổ NAT" ở cuối file dựng router + dải + IP.
  resetIpam();
  resetDevices();
  resetCatalog();
});

async function createSoftware(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/v1/software', {
    headers: await writeHeaders(page),
    data,
  });
  expect(res.status(), await res.text()).toBe(201);
  return String(((await res.json()) as { id: string }).id);
}

async function endDateOf(page: Page, id: string): Promise<string | null> {
  const res = await page.request.get(`/api/v1/software/${id}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { endDate: string | null }).endDate;
}

test.describe('Xoá ô ngày — luật phải soi giá trị MỚI, không phải giá trị cũ', () => {
  test('chứng chỉ SSL không xoá được ngày hết hạn, và hạn cũ còn nguyên sau lượt bị từ chối', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const id = await createSoftware(page, {
      code: `SSL-E2E-${stamp}`,
      name: `Chung chi E2E ${stamp}`,
      kind: 'ssl',
      endDate: '2027-01-31',
    });

    const cleared = await page.request.patch(`/api/v1/software/${id}`, {
      headers: await writeHeaders(page),
      data: { endDate: '' },
    });
    expect(cleared.status()).toBe(400);
    const body = (await cleared.json()) as { code: string; message: string };
    expect(body.code).toBe('SOFTWARE_INVALID');
    expect(body.message).toContain('ngày hết hạn');

    // Vế thứ hai: lượt bị từ chối không được để lại nửa bản ghi. Nếu câu ghi vẫn chạy thì
    // hồ sơ đã mất hạn rồi, và mọi lời nhắc gia hạn im lặng bỏ qua nó.
    expect(await endDateOf(page, id)).toBe('2027-01-31');
  });

  test('hợp đồng bảo trì vẫn xoá được ngày hết hạn — luật mới không chặn nhầm đường đúng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const id = await createSoftware(page, {
      code: `MTN-E2E-${stamp}`,
      name: `Bao tri E2E ${stamp}`,
      kind: 'maintenance',
      endDate: '2027-01-31',
    });

    const cleared = await page.request.patch(`/api/v1/software/${id}`, {
      headers: await writeHeaders(page),
      data: { endDate: '' },
    });
    expect(cleared.status(), await cleared.text()).toBe(200);
    expect(await endDateOf(page, id)).toBeNull();
  });
});

/**
 * ===== SỔ NAT — CÙNG PHÉP GHÉP, CÙNG LỖ =====
 *
 * Quét `?? current?.` thì BỎ LỌT `nat-rule.service.ts`, nơi biến cũ tên là `before` chứ không
 * phải `current`, và `merged` vừa dùng để KIỂM vừa dùng để GHI. Một mẫu grep hẹp cho ra cảm
 * giác đã soi hết, nên sổ NAT có bài riêng.
 *
 * Hai vế dưới đây là hai chiều khác nhau của cùng một phép ghép hỏng.
 */
test.describe('Sổ NAT — phép ghép cũ còn sót', () => {
  test('xoá ghi chú thì ghi chú phải MẤT, không âm thầm giữ lại bản cũ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = await writeHeaders(page);
    const f = await natFixture(page, headers);

    const rule = await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: {
        deviceId: f.routerId,
        protocol: 'tcp',
        externalPorts: '18080',
        internalIp: f.internalIp,
        internalPort: 80,
        usedBy: 'E2E camera',
        reason: 'Xem camera tu ngoai',
        note: 'Ghi chu cu — phai bien mat',
      },
    });
    expect(rule.status(), await rule.text()).toBe(201);
    const id = ((await rule.json()) as { id: string }).id;

    // Người dùng xoá sạch ô ghi chú. `null` và "không gửi khoá" là HAI Ý ĐỊNH khác nhau.
    const res = await page.request.patch(`/api/v1/ipam/nat/${id}`, {
      headers,
      data: { note: null },
    });
    expect(res.status(), await res.text()).toBeLessThan(300);

    const after = (await (
      await page.request.get(`/api/v1/ipam/nat/${id}`, { headers })
    ).json()) as { note: string | null };
    expect(after.note, 'xoá ô ghi chú thì nó phải mất, không quay về bản cũ').toBeNull();
  });

  /*
   * Vế thứ hai — KHÔNG tầng reviewer nào nêu, tìm ra khi đọc `NatBodyDto`.
   *
   * DTO cố ý cho chuỗi RỖNG đi qua (chú thích ở `ipam.controller.ts:102-115`: màn Sổ NAT khởi
   * tạo ô router bằng `useState('')`). Ở `POST` thì `requireDeviceId()` bắt nó và trả 400 nói
   * rõ người dùng quên gì. Ở `PATCH` thì KHÔNG ai bắt: `'' ?? before.deviceId` giữ nguyên
   * chuỗi rỗng — vì `''` không nullish — rồi câu `UPDATE ... SET device_id = ''` đi thẳng
   * xuống Postgres và nổ `22P02` thành 500.
   *
   * Đây đúng hình dạng mà chính DTO ấy vừa dựng hàng rào để tránh, chỉ khác động từ.
   */
  test('PATCH với ô router để trống phải là 400 nói rõ thiếu gì, không phải 500', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const headers = await writeHeaders(page);
    const f = await natFixture(page, headers);

    const rule = await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: {
        deviceId: f.routerId,
        protocol: 'tcp',
        externalPorts: '18081',
        internalIp: f.internalIp,
        internalPort: 81,
        usedBy: 'E2E camera',
        reason: 'Xem camera tu ngoai',
      },
    });
    expect(rule.status(), await rule.text()).toBe(201);
    const id = ((await rule.json()) as { id: string }).id;

    const res = await page.request.patch(`/api/v1/ipam/nat/${id}`, {
      headers,
      data: { deviceId: '' },
    });
    expect(res.status(), 'người dùng phải đọc được mình thiếu gì, không phải "lỗi hệ thống"').toBe(
      400,
    );

    // Và rule vẫn nguyên router cũ: một lượt bị từ chối không được để lại dấu vết.
    const after = (await (
      await page.request.get(`/api/v1/ipam/nat/${id}`, { headers })
    ).json()) as { deviceId: string };
    expect(after.deviceId).toBe(f.routerId);
  });
});

async function natFixture(
  page: Page,
  headers: Record<string, string>,
): Promise<{ routerId: string; internalIp: string }> {
  const catalog = (await (await page.request.get('/api/v1/catalog', { headers })).json()) as {
    deviceTypes: { id: string; name: string }[];
  };
  const routerType =
    catalog.deviceTypes.find((t) => t.name === 'Router') ?? catalog.deviceTypes[0];

  const stamp = uniqueStamp();
  const router = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: `RT-E2E-A03-${stamp}`, name: 'Draytek E2E A03', deviceTypeId: routerType.id },
  });
  expect(router.status(), await router.text()).toBe(201);
  const routerId = ((await router.json()) as { device: { id: string } }).device.id;

  // Tên dải PHẢI mang chữ E2E — `reset-e2e.mjs` dọn theo `subnet.name ILIKE '%E2E%'`.
  const octet = Number(stamp) % 200;
  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { cidr: `172.20.${octet}.0/29`, name: `LAN E2E A03 ${stamp}` },
  });
  expect(subnet.status(), await subnet.text()).toBe(201);
  const subnetId = ((await subnet.json()) as { id: string }).id;

  const internalIp = `172.20.${octet}.5`;
  const ip = await page.request.post('/api/v1/ipam/addresses', {
    headers,
    data: { subnetId, address: internalIp, usedBy: 'E2E camera' },
  });
  expect(ip.status(), await ip.text()).toBe(201);

  return { routerId, internalIp };
}
