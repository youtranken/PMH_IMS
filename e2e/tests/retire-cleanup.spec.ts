import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  ispProviderId,
  resetCatalog,
  resetDevices,
  resetIpam,
  resetIsp,
  resetSoftware,
  resetUsers,
  sql,
  writeHeaders,
} from './helpers';

/**
 * Thanh lý máy là một CHỐT, không phải một phép gán.
 *
 * Nếu `setStatus` chỉ lật một chữ trong cột `status` thì máy đã ra khỏi công ty, đã ký biên
 * bản, nhưng IP của nó vẫn `assigned` và vẫn trỏ về chính nó, rule NAT vào IP đó vẫn sống,
 * ghế license vẫn bị chiếm.
 *
 * Hậu quả nặng nhất KHÔNG nằm ở IPAM: thanh lý 10 máy cũ thì máy mới đầu tiên đã đụng trần
 * seat, và cửa đó BẮT người trực khai một `overSeatReason` — tức bắt họ viết ra một lý do
 * vượt seat sai sự thật pháp lý với nhà cung cấp, chỉ để đi tiếp được việc hằng ngày. Hàng
 * rào chống vượt seat của AC 3.2 tự biến thành cái máy sinh ra lời khai sai.
 *
 * Luật đã chốt: mặc định CHẶN kèm danh sách đích danh; chọn "Gỡ hết rồi thanh lý" thì dọn
 * trong CÙNG transaction. Và thanh lý MÁY chỉ gỡ máy khỏi license — hồ sơ phần mềm giữ nguyên.
 */

test.beforeEach(() => {
  resetUsers();
  resetDevices();
  resetIpam();
  resetSoftware();
  resetCatalog();
  resetIsp();
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
    ).toBe('free');
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
 * LUỒNG NGƯỜI DÙNG THẬT — bấm Thanh lý trên giao diện, chọn cách thanh lý, và xem việc xảy ra.
 *
 * Mọi bài phía trên gọi thẳng `PATCH /devices/:id/status`. Chúng chứng minh SERVER làm đúng,
 * nhưng không chạm một dòng nào của phần web: hộp Thanh lý, lựa chọn "Gỡ hết rồi thanh lý",
 * ô gõ lại mã máy, và chỗ đọc 409 `DEVICE_HAS_HOLDINGS` để mở lại hộp kèm danh sách.
 */
test.describe('Thanh lý trên giao diện — hộp nói rõ sẽ gỡ gì (DEV-050)', () => {
  test('"Chỉ thanh lý" khi máy còn giữ đồ: hộp ở lại, kèm đúng danh sách vướng; máy KHÔNG bị thanh lý', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const kit = await deviceHoldingEverything(page, stamp);
    const ipText = new RegExp(kit.ip.replace(/\./g, '\\.'));

    await page.goto(`/devices/${kit.deviceId}`);
    await page.getByRole('button', { name: 'Thanh lý', exact: true }).click();

    const dialog = page.getByRole('dialog');
    // Hộp nói TRƯỚC khi bấm: IP này sẽ bị gỡ — đọc từ dữ liệu thật của máy.
    await expect(dialog.getByText(ipText).first()).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Giữ nguyên' })).toBeVisible();
    // Mặc định là "Chỉ thanh lý": gỡ hàng loạt không được là mặc định êm ái.
    await expect(dialog.getByRole('radio', { name: /Chỉ thanh lý/ })).toBeChecked();

    await dialog.getByRole('button', { name: 'Thanh lý', exact: true }).click();

    // 409 không chỉ là một toast: hộp ở lại và đọc tên từng thứ máy còn giữ.
    await expect(dialog.getByText(/chưa thanh lý được/)).toBeVisible();
    await expect(dialog.getByText(ipText).first()).toBeVisible();
    expect(sql(`SELECT status FROM device WHERE id = '${kit.deviceId}'`)).toBe('in_use');
  });

  test('"Gỡ hết rồi thanh lý": phải gõ lại đúng mã máy, rồi mọi thứ máy giữ được trả lại', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const kit = await deviceHoldingEverything(page, stamp);
    const code = `PC-E2E-RC-${stamp}`;

    await page.goto(`/devices/${kit.deviceId}`);
    await page.getByRole('button', { name: 'Thanh lý', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Gỡ hết rồi thanh lý' }).check();
    const submit = dialog.getByRole('button', { name: 'Thanh lý', exact: true });
    // Chưa gõ mã thì chưa bấm được — một cú bấm theo quán tính không xoá được IP của máy.
    await expect(submit).toBeDisabled();
    await dialog.getByLabel(new RegExp(`Gõ lại mã máy ${code}`)).fill('PC-E2E-KHAC');
    await expect(submit).toBeDisabled();
    await dialog.getByLabel(new RegExp(`Gõ lại mã máy ${code}`)).fill(code);
    await submit.click();

    await expect(page.getByRole('button', { name: 'Đưa lại vào dùng' })).toBeVisible();
    expect(sql(`SELECT status FROM device WHERE id = '${kit.deviceId}'`)).toBe('retired');
    expect(
      sql(`SELECT status FROM ip_address WHERE id = '${kit.ipId}'`),
      'chọn trên giao diện phải dẫn tới ĐÚNG hành vi mà API đã chứng minh',
    ).toBe('free');
    expect(
      Number(
        sql(
          `SELECT count(*) FROM license_assignment WHERE device_id = '${kit.deviceId}' AND released_at IS NULL`,
        ),
      ),
    ).toBe(0);
  });
});

/**
 * HAI CHỦ NỢ PHẢI CÓ NGƯỜI NHẬN.
 *
 * ===== LỖ BÀI NÀY CANH =====
 *
 * Sáu bảng mang khóa ngoại trỏ tới `device`, tất cả đều `ON DELETE RESTRICT`. Nếu
 * `DeviceRetirementRegistry` chỉ có `ipam` (IP + rule NAT) và `software` (ghế license) đăng
 * ký, thì hai bảng sau không ai nhận:
 *
 *   · `device_port.connected_device_id` — cổng đấu chéo. `0021_device_port.sql` ghi rõ một sợi dây chỉ
 *     tạo MỘT bản ghi, không có bản đối xứng, nên bản ghi trỏ tới máy bị thanh lý nằm trên
 *     hồ sơ của MÁY KHÁC — một máy vẫn đang chạy.
 *   · `isp_line.device_id` — đường truyền cắm vào thiết bị biên.
 *
 * Khi đó thanh lý con router: IP được thu, rule NAT được gỡ, ghế license được trả — còn sơ đồ
 * đấu nối của con switch bên cạnh vẫn trỏ vào một máy đã ra khỏi công ty, và hồ sơ đường
 * truyền vẫn ghi nó đang cắm vào đó.
 *
 * Hậu quả không phải lý thuyết: máy đã thanh lý mà vẫn còn đường truyền cắm vào là chuyện CÓ
 * THẬT với dữ liệu cũ (xem `IspLineService.prepare`). Nới hàng rào `assertUsable` ở đó chỉ vá
 * phần ngọn; dọn liên kết lúc thanh lý là phần gốc.
 */
test.describe('Thanh lý router — cổng đấu chéo và đường truyền', () => {
  interface RouterKit {
    headers: Record<string, string>;
    routerId: string;
    routerCode: string;
    switchId: string;
    switchCode: string;
    portId: string;
    ispId: string;
    ispCode: string;
  }

  /** Con router sắp thanh lý: một switch đang đấu vào nó, và một đường truyền cắm vào nó. */
  async function routerWithCrossConnectAndIsp(page: Page, stamp: string): Promise<RouterKit> {
    const headers = await writeHeaders(page);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const anyType = catalog.deviceTypes[0].id;
    const rtType = catalog.deviceTypes.find((t) => t.name === 'Router')?.id ?? anyType;
    const swType = catalog.deviceTypes.find((t) => t.name === 'Switch')?.id ?? anyType;

    const routerCode = `RT-E2E-XC-${stamp}`;
    const router = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: routerCode, name: 'Router E2E sap thanh ly', deviceTypeId: rtType },
    });
    expect(router.status()).toBe(201);
    const routerId = ((await router.json()) as { device: { id: string } }).device.id;

    const switchCode = `SW-E2E-XC-${stamp}`;
    const sw = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: switchCode, name: 'Switch E2E con chay', deviceTypeId: swType },
    });
    expect(sw.status()).toBe(201);
    const switchId = ((await sw.json()) as { device: { id: string } }).device.id;

    // Cổng NẰM TRÊN switch, TRỎ TỚI router. Chiều này mới là chiều bị bỏ quên.
    const port = await page.request.post(`/api/v1/devices/${switchId}/ports`, {
      headers,
      data: {
        portLabel: 'GI1/0/24',
        connectedDeviceId: routerId,
        connectedPort: 'LAN1',
        usedBy: 'Uplink E2E',
      },
    });
    expect(port.status()).toBe(201);
    const portId = ((await port.json()) as { id: string }).id;

    const ispCode = `ISP-E2E-XC-${stamp}`;
    const isp = await page.request.post('/api/v1/isp-lines', {
      headers,
      data: {
        code: ispCode,
        providerId: await ispProviderId(page, 'VNPT E2E'),
        bandwidth: '100 Mbps',
        contractNo: `HD-E2E-${stamp}`,
        hotline: '18001166',
        deviceId: routerId,
      },
    });
    expect(isp.status()).toBe(201);
    const ispId = ((await isp.json()) as { id: string }).id;

    return { headers, routerId, routerCode, switchId, switchCode, portId, ispId, ispCode };
  }

  test('không tick dọn → BỊ CHẶN, và lỗi gọi đích danh cổng lẫn đường truyền', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const kit = await routerWithCrossConnectAndIsp(page, stamp);

    const blocked = await page.request.patch(`/api/v1/devices/${kit.routerId}/status`, {
      headers: kit.headers,
      data: { status: 'retired', cleanup: false },
    });
    expect(
      blocked.status(),
      'hai chủ nợ này trước 11/09 không ai nhận, nên lượt thanh lý đi thẳng qua',
    ).toBe(409);

    const body = (await blocked.json()) as { code?: string; message?: string };
    expect(body.code).toBe('DEVICE_HAS_HOLDINGS');
    expect(body.message, 'phải nêu TÊN CỔNG, không phải uuid').toContain('GI1/0/24');
    expect(body.message, 'phải nêu MÁY ĐANG GIỮ bản ghi cổng').toContain(kit.switchCode);
    expect(body.message, 'phải nêu mã đường truyền').toContain(kit.ispCode);

    // Bị chặn thì không được đổi gì — chặn nửa vời tệ hơn không chặn.
    expect(sql(`SELECT status FROM device WHERE id = '${kit.routerId}'`)).toBe('in_use');
    expect(
      sql(
        `SELECT coalesce(connected_device_id::text,'<null>') FROM device_port WHERE id = '${kit.portId}'`,
      ),
    ).toBe(kit.routerId);
  });

  test('tick dọn → cổng gỡ liên kết nhưng GIỮ CHỮ, đường truyền rời máy mà hồ sơ còn nguyên', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const kit = await routerWithCrossConnectAndIsp(page, stamp);

    const done = await page.request.patch(`/api/v1/devices/${kit.routerId}/status`, {
      headers: kit.headers,
      data: { status: 'retired', cleanup: true },
    });
    expect(done.status(), 'tick dọn thì phải chạy trọn').toBeLessThan(300);
    expect(sql(`SELECT status FROM device WHERE id = '${kit.routerId}'`)).toBe('retired');

    // ── Cổng đấu chéo ───────────────────────────────────────────────────────────
    expect(
      sql(
        `SELECT coalesce(connected_device_id::text,'<null>') FROM device_port WHERE id = '${kit.portId}'`,
      ),
      'liên kết tới máy đã thanh lý phải được gỡ',
    ).toBe('<null>');
    expect(
      sql(`SELECT coalesce(connected_label,'<null>') FROM device_port WHERE id = '${kit.portId}'`),
      'gỡ liên kết KHÔNG được xoá trắng: sáu tháng sau vẫn phải đọc ra đầu kia từng là máy nào',
    ).toContain(kit.routerCode);
    expect(
      sql(`SELECT port_label FROM device_port WHERE id = '${kit.portId}'`),
      'bản ghi cổng của máy còn sống không được xoá theo',
    ).toBe('GI1/0/24');
    expect(
      Number(
        sql(
          `SELECT count(*) FROM device_history WHERE device_id = '${kit.switchId}' AND action = 'port-unlinked'`,
        ),
      ),
      'lịch sử phải ghi vào máy GIỮ BẢN GHI, để tab Lịch sử của switch giải thích được',
    ).toBe(1);

    // ── Đường truyền ────────────────────────────────────────────────────────────
    expect(
      sql(`SELECT coalesce(device_id::text,'<null>') FROM isp_line WHERE id = '${kit.ispId}'`),
      'đường truyền phải rời khỏi máy đã thanh lý',
    ).toBe('<null>');
    expect(
      sql(`SELECT status FROM isp_line WHERE id = '${kit.ispId}'`),
      'RANH GIỚI: thanh lý MÁY không được thanh lý HỢP ĐỒNG — hoá đơn vẫn về hằng tháng',
    ).toBe('active');
    expect(
      sql(`SELECT contract_no FROM isp_line WHERE id = '${kit.ispId}'`),
      'số hợp đồng phải còn nguyên',
    ).toBe(`HD-E2E-${stamp}`);
    expect(
      Number(
        sql(
          `SELECT count(*) FROM isp_line_history WHERE isp_line_id = '${kit.ispId}' AND action = 'device-detached'`,
        ),
      ),
      'AD-13: rời khỏi router nào, ngày nào — câu sẽ có người hỏi lúc đối soát',
    ).toBe(1);
  });

  /**
   * VẾ ĐỐI CHỨNG, và là ranh giới dễ vượt nhất.
   *
   * Cổng NẰM TRÊN chính máy bị thanh lý là hồ sơ của nó, và phải ở lại:
   * `DevicePortsService.remove` đã giải thích vì sao ("bằng chứng hồi đó nó cắm vào đâu"). Một
   * bản vá dọn quá tay sẽ xoá đúng thứ người ta cần lúc truy vết, và không bài nào ở trên bắt
   * được chuyện đó.
   */
  test('cổng nằm TRÊN máy bị thanh lý thì ở lại — chỉ chiều trỏ TỚI nó mới được gỡ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const kit = await routerWithCrossConnectAndIsp(page, stamp);

    // Một cổng của chính con router, đấu sang switch.
    const own = await page.request.post(`/api/v1/devices/${kit.routerId}/ports`, {
      headers: kit.headers,
      data: { portLabel: 'LAN2', connectedDeviceId: kit.switchId, usedBy: 'Xuong duoi E2E' },
    });
    expect(own.status()).toBe(201);
    const ownPortId = ((await own.json()) as { id: string }).id;

    expect(
      (
        await page.request.patch(`/api/v1/devices/${kit.routerId}/status`, {
          headers: kit.headers,
          data: { status: 'retired', cleanup: true },
        })
      ).status(),
    ).toBeLessThan(300);

    expect(
      Number(sql(`SELECT count(*) FROM device_port WHERE id = '${ownPortId}'`)),
      'hồ sơ cổng của máy đã thanh lý là bằng chứng, không được dọn theo',
    ).toBe(1);
    expect(
      sql(
        `SELECT coalesce(connected_device_id::text,'<null>') FROM device_port WHERE id = '${ownPortId}'`,
      ),
      'và liên kết của nó sang máy còn sống cũng giữ nguyên',
    ).toBe(kit.switchId);
  });

  /**
   * VẾ ĐỐI CHỨNG THỨ HAI: máy không giữ hai thứ này thì hàng rào phải im lặng. Không có bài
   * này thì một bản "luôn báo còn giữ đồ" cũng xanh hai bài đầu, và không ai thanh lý được gì.
   */
  test('router trống thì vẫn thanh lý thẳng, hai chủ nợ mới không được làm phiền', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const headers = await writeHeaders(page);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const created = await page.request.post('/api/v1/devices', {
      headers,
      data: {
        code: `RT-E2E-XCE-${stamp}`,
        name: 'Router E2E trong',
        deviceTypeId: catalog.deviceTypes[0].id,
      },
    });
    const deviceId = ((await created.json()) as { device: { id: string } }).device.id;

    const res = await page.request.patch(`/api/v1/devices/${deviceId}/status`, {
      headers,
      data: { status: 'retired' },
    });
    expect(res.status()).toBeLessThan(300);
    expect(sql(`SELECT status FROM device WHERE id = '${deviceId}'`)).toBe('retired');
  });
});
