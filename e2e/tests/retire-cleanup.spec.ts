import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetIpam,
  resetSoftware,
  resetUsers,
  sql,
  writeHeaders,
} from './helpers';

/**
 * Thanh lý máy là một CHỐT, không phải một phép gán.
 *
 * Trước 08/09 `setStatus` chỉ lật một chữ trong cột `status`. Máy đã ra khỏi công ty, đã ký
 * biên bản, nhưng IP của nó vẫn `assigned` và vẫn trỏ về chính nó, rule NAT vào IP đó vẫn
 * sống, ghế license vẫn bị chiếm.
 *
 * Hậu quả nặng nhất KHÔNG nằm ở IPAM: thanh lý 10 máy cũ thì máy mới đầu tiên đã đụng trần
 * seat, và cửa đó BẮT người trực khai một `overSeatReason` — tức bắt họ viết ra một lý do
 * vượt seat sai sự thật pháp lý với nhà cung cấp, chỉ để đi tiếp được việc hằng ngày. Hàng
 * rào chống vượt seat của AC 3.2 tự biến thành cái máy sinh ra lời khai sai.
 *
 * Luật đã chốt: mặc định CHẶN kèm danh sách đích danh; tick "Dọn hết thứ liên quan" thì dọn
 * trong CÙNG transaction. Và thanh lý MÁY chỉ gỡ máy khỏi license — hồ sơ phần mềm giữ nguyên.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetIpam();
  resetSoftware();
  resetCatalog();
});

interface Kit {
  headers: Record<string, string>;
  deviceId: string;
  routerId: string;
  softwareId: string;
  ip: string;
  ipId: string;
}

/** Một máy đang giữ đủ ba thứ: IP, rule NAT trỏ vào IP đó, và một ghế license. */
async function deviceHoldingEverything(page: Page, stamp: string): Promise<Kit> {
  const headers = await writeHeaders(page);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pcType = catalog.deviceTypes.find((t) => t.name === 'PC')!.id;
  const rtType = catalog.deviceTypes.find((t) => t.name === 'Router')?.id ?? pcType;

  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: `PC-E2E-RC-${stamp}`, name: 'May sap thanh ly', deviceTypeId: pcType },
  });
  expect(device.status()).toBe(201);
  const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

  // Router RIÊNG mang rule NAT — đúng kịch bản camera: rule không nằm trên máy bị thanh lý.
  const router = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: `RT-E2E-RC-${stamp}`, name: 'Draytek', deviceTypeId: rtType },
  });
  const routerId = ((await router.json()) as { device: { id: string } }).device.id;

  const octet = Number(stamp) % 180;
  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { cidr: `172.21.${octet}.0/29`, name: `LAN E2E dondep ${stamp}` },
  });
  expect(subnet.status()).toBe(201);
  const subnetId = ((await subnet.json()) as { id: string }).id;

  const ip = `172.21.${octet}.5`;
  const created = await page.request.post('/api/v1/ipam/addresses', {
    headers,
    data: { subnetId, address: ip, deviceId },
  });
  expect(created.status()).toBe(201);
  const ipId = ((await created.json()) as { id: string }).id;

  const nat = await page.request.post('/api/v1/ipam/nat', {
    headers,
    data: {
      deviceId: routerId,
      protocol: 'tcp',
      externalPorts: '8090',
      internalIp: ip,
      internalPort: 80,
      usedBy: 'May sap thanh ly',
      reason: 'Truy cap tu xa',
    },
  });
  expect(nat.status()).toBe(201);

  const sw = await page.request.post('/api/v1/software', {
    headers,
    data: {
      code: `SW-E2E-RC-${stamp}`,
      name: 'Office 2021',
      kind: 'license',
      seatTotal: 1,
      startDate: '2025-01-01',
      endDate: '2027-12-31',
    },
  });
  expect(sw.status()).toBe(201);
  const softwareId = ((await sw.json()) as { id: string }).id;

  const assigned = await page.request.post(`/api/v1/software/${softwareId}/assignments`, {
    headers,
    data: { deviceId },
  });
  expect(assigned.status()).toBe(201);

  return { headers, deviceId, routerId, softwareId, ip, ipId };
}

function retire(page: Page, kit: Kit, cleanup: boolean) {
  return page.request.patch(`/api/v1/devices/${kit.deviceId}/status`, {
    headers: kit.headers,
    data: { status: 'retired', cleanup },
  });
}

test.describe('Thanh lý máy còn đang giữ đồ', () => {
  test('không tick dọn → BỊ CHẶN, và lỗi phải gọi đích danh từng thứ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const kit = await deviceHoldingEverything(page, stamp);

    const blocked = await retire(page, kit, false);
    expect(blocked.status()).toBe(409);
    const body = (await blocked.json()) as { code?: string; message?: string };
    expect(body.code).toBe('DEVICE_HAS_HOLDINGS');

    /*
     * "Còn vướng vài thứ" là câu vô dụng: người trực phải mò ba màn hình khác nhau, và trong
     * lúc mò thì công việc dừng — nên họ sẽ đi tìm đường lách. Lỗi phải nói ĐỦ BA thứ.
     */
    expect(body.message, 'phải nêu địa chỉ IP cụ thể').toContain(kit.ip);
    expect(body.message, 'phải nêu rule NAT cụ thể').toContain('8090');
    expect(body.message, 'phải nêu tên license, không phải uuid').toContain('Office 2021');

    // Bị chặn thì KHÔNG được đổi gì — chặn nửa vời tệ hơn không chặn.
    expect(sql(`SELECT status FROM device WHERE id = '${kit.deviceId}'`)).toBe('in_use');
    expect(sql(`SELECT status FROM ip_address WHERE id = '${kit.ipId}'`)).toBe('assigned');
  });

  test('tick dọn → thanh lý xong, IP thu hồi, rule NAT gỡ, ghế license được trả', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const kit = await deviceHoldingEverything(page, stamp);

    const done = await retire(page, kit, true);
    expect(done.status(), 'tick dọn thì phải chạy trọn').toBeLessThan(300);

    expect(sql(`SELECT status FROM device WHERE id = '${kit.deviceId}'`)).toBe('retired');
    expect(
      sql(`SELECT status FROM ip_address WHERE id = '${kit.ipId}'`),
      'IP phải về pool',
    ).toBe('reclaimed');
    expect(
      sql(`SELECT coalesce(device_id::text,'<null>') FROM ip_address WHERE id = '${kit.ipId}'`),
      'thu hồi phải xóa cả chủ cũ khỏi hàng, không chỉ đổi trạng thái',
    ).toBe('<null>');
    expect(
      Number(sql(`SELECT count(*) FROM nat_rule WHERE internal_ip = '${kit.ip}' AND voided_at IS NULL`)),
      'rule NAT trỏ vào IP đó phải được gỡ, kể cả khi nó nằm trên router KHÁC',
    ).toBe(0);
    expect(
      Number(
        sql(
          `SELECT count(*) FROM license_assignment WHERE device_id = '${kit.deviceId}' AND released_at IS NULL`,
        ),
      ),
      'ghế license phải được trả',
    ).toBe(0);
  });

  /**
   * ĐÂY LÀ RANH GIỚI QUAN TRỌNG NHẤT CỦA CẢ TÍNH NĂNG.
   *
   * Dọn tự động GỠ MÁY KHỎI LICENSE, tuyệt đối không đụng tới hồ sơ phần mềm: công ty vẫn sở
   * hữu cái license đó và sẽ gán cho máy mới ngày mai. Một bản sửa vượt ranh giới này sẽ xoá
   * tài sản của công ty vì một cú bấm thanh lý máy.
   */
  test('hồ sơ PHẦN MỀM không bị thanh lý theo, và ghế trả về dùng lại được ngay', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const kit = await deviceHoldingEverything(page, stamp);

    expect((await retire(page, kit, true)).status()).toBeLessThan(300);

    // Hồ sơ phần mềm còn nguyên, còn `active`, còn đủ seat.
    expect(sql(`SELECT status FROM software WHERE id = '${kit.softwareId}'`)).toBe('active');
    expect(sql(`SELECT seat_total FROM software WHERE id = '${kit.softwareId}'`)).toBe('1');

    /*
     * License chỉ có 1 ghế và ghế đó vừa được trả. Gán cho máy MỚI phải chạy được và KHÔNG
     * đòi `overSeatReason` — đó chính là cái lỗi pháp lý mà cả tính năng này sinh ra để chặn.
     */
    const replacement = await page.request.post('/api/v1/devices', {
      headers: kit.headers,
      data: {
        code: `PC-E2E-RCN-${stamp}`,
        name: 'May thay the',
        deviceTypeId: sql(
          `SELECT device_type_id FROM device WHERE id = '${kit.deviceId}'`,
        ),
      },
    });
    expect(replacement.status()).toBe(201);
    const newDeviceId = ((await replacement.json()) as { device: { id: string } }).device.id;

    const assigned = await page.request.post(
      `/api/v1/software/${kit.softwareId}/assignments`,
      { headers: kit.headers, data: { deviceId: newDeviceId } },
    );
    expect(
      assigned.status(),
      'ghế đã trả phải dùng lại được ngay, không phải khai lý do vượt seat',
    ).toBe(201);
  });

  /** Máy không giữ gì thì thanh lý thẳng, không hỏi han — hàng rào không được làm phiền. */
  test('máy trống thì thanh lý thẳng, không cần tick gì', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const created = await page.request.post('/api/v1/devices', {
      headers: await writeHeaders(page),
      data: {
        code: `PC-E2E-RCE-${stamp}`,
        name: 'May trong',
        deviceTypeId: catalog.deviceTypes.find((t) => t.name === 'PC')!.id,
      },
    });
    const deviceId = ((await created.json()) as { device: { id: string } }).device.id;

    const res = await page.request.patch(`/api/v1/devices/${deviceId}/status`, {
      headers: await writeHeaders(page),
      data: { status: 'retired' },
    });
    expect(res.status()).toBeLessThan(300);
    expect(sql(`SELECT status FROM device WHERE id = '${deviceId}'`)).toBe('retired');
  });
});

/**
 * LUỒNG NGƯỜI DÙNG THẬT — bấm Thanh lý trên giao diện, tick ô, và xem việc xảy ra.
 *
 * ===== VÌ SAO BÀI NÀY PHẢI TỒN TẠI RIÊNG =====
 *
 * Mọi bài phía trên gọi thẳng `PATCH /devices/:id/status` với `{cleanup: true|false}`. Chúng
 * chứng minh SERVER làm đúng, nhưng KHÔNG chạm một dòng nào của phần web: ô tick trong
 * `ConfirmDialog`, kiểu trả `{ok, checked}` của `askConfirm`, và chỗ đọc `answer.checked` ở
 * `device-detail.tsx`. Trước bài này, cả ba CHƯA TỪNG chạy một lần.
 *
 * Đây đúng chế độ hỏng đã dính ở đợt A: siết API xong, tưởng đã xong, trong khi đường người
 * dùng thật chưa ai đi qua (xem `vault-write-stepup-ui.spec.ts`, cùng lý do).
 */
test.describe('Thanh lý trên giao diện — ô tick "Dọn hết thứ liên quan"', () => {
  test('không tick: lỗi hiện ra trên màn, và máy KHÔNG bị thanh lý', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const kit = await deviceHoldingEverything(page, stamp);

    await page.goto(`/devices/${kit.deviceId}`);
    await page.getByRole('button', { name: 'Thanh lý' }).click();

    const dialog = page.getByRole('dialog');
    // Ô tick phải CÓ MẶT và mặc định KHÔNG tick — dọn hàng loạt không được là mặc định êm ái.
    const box = dialog.getByRole('checkbox', { name: /Dọn hết thứ liên quan/ });
    await expect(box, 'hộp thanh lý phải có ô tick dọn').toBeVisible();
    await expect(box, 'mặc định phải là KHÔNG dọn').not.toBeChecked();

    await dialog.getByRole('button', { name: 'Thanh lý' }).click();

    /*
     * Người dùng phải ĐỌC ĐƯỢC vì sao bị chặn, ngay trên màn, kèm tên thứ đang vướng.
     *
     * Bám vào KHUNG THÔNG BÁO (`role="status"`), không quét cả trang. Bản trước dùng
     * `page.getByText(new RegExp(kit.ip))` và nó khớp HAI chỗ: dòng IP trong khu mở rộng của
     * chính trang thiết bị, và câu lỗi trong toast. Playwright ở chế độ strict thì hai kết quả
     * là đỏ — nhưng đỏ vì bài kiểm hỏi mơ hồ, KHÔNG phải vì sản phẩm sai (máy vẫn `in_use`,
     * toast vẫn hiện đúng). Lượt E2E đầy đủ 09/09 bắt được; trước đó nó xanh chỉ vì khu mở
     * rộng tải chậm hơn toast một nhịp — tức là bài này vốn đã là một bài may rủi.
     *
     * Dấu chấm trong IP cũng phải escape: `new RegExp('172.21.126.5')` cho dấu chấm khớp MỌI
     * ký tự — cùng lớp lỗi mà cổng lint e2e vừa bắt ở ba chỗ khác.
     */
    const toast = page.getByRole('status');
    await expect(
      toast.getByText(new RegExp(kit.ip.replace(/\./g, '\\.'))),
      'lỗi phải hiện trên giao diện, không chỉ nằm trong response',
    ).toBeVisible();

    expect(sql(`SELECT status FROM device WHERE id = '${kit.deviceId}'`)).toBe('in_use');
  });

  test('tick rồi bấm: máy thanh lý xong và mọi thứ nó giữ được trả lại', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const kit = await deviceHoldingEverything(page, stamp);

    await page.goto(`/devices/${kit.deviceId}`);
    await page.getByRole('button', { name: 'Thanh lý' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: /Dọn hết thứ liên quan/ }).check();
    await dialog.getByRole('button', { name: 'Thanh lý' }).click();

    /*
     * Nút đổi thành "Đưa lại vào dùng" là dấu hiệu lượt thanh lý ĐÃ xong và màn đã làm mới — bám vào
     * nó thay vì `waitForTimeout`, và nó cũng khẳng định luôn giao diện phản ánh trạng thái mới.
     */
    await expect(page.getByRole('button', { name: 'Đưa lại vào dùng' })).toBeVisible();

    expect(sql(`SELECT status FROM device WHERE id = '${kit.deviceId}'`)).toBe('retired');
    expect(
      sql(`SELECT status FROM ip_address WHERE id = '${kit.ipId}'`),
      'tick trên giao diện phải dẫn tới ĐÚNG hành vi mà API đã chứng minh',
    ).toBe('reclaimed');
    expect(
      Number(
        sql(
          `SELECT count(*) FROM license_assignment WHERE device_id = '${kit.deviceId}' AND released_at IS NULL`,
        ),
      ),
    ).toBe(0);
  });
});
