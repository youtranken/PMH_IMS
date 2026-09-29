import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  resetCatalog,
  resetDevices,
  resetIpam,
  resetUsers,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetIpam();
  resetDevices();
  // Bài "thêm dịch vụ bằng (+)" sinh một mục danh mục — dọn để nó không tích lại qua các lần chạy.
  resetCatalog();
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
  const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  // 'Firewall' mang cờ Router/Firewall (0088) — ô Router của form NAT chỉ liệt kê loại có cờ.
  const type = catalog.deviceTypes.find((t) => t.name === 'Firewall')!;

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

/** FR-017: sổ NAT trả lời "port nào mở, vì sao, cho ai". */
test.describe('Sổ NAT', () => {
  test('đường hạnh phúc: thêm rule → hiện đủ port/lý do/người dùng → nối được sang hồ sơ IP', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { routerCode, internalIp } = await setUp(page, stamp);

    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm luật NAT' }).click();
    const form = page.getByRole('dialog');
    await form.getByPlaceholder('Chọn hoặc gõ để lọc…').fill(routerCode);
    await page.getByRole('option', { name: new RegExp(routerCode) }).click();
    await form.getByRole('textbox', { name: 'Cổng ngoài' }).fill('8080');
    await form.getByRole('textbox', { name: 'IP trong' }).fill(internalIp);
    await form.getByRole('textbox', { name: 'Cổng trong' }).fill('80');
    await form.getByRole('combobox', { name: 'Mở cho ai' }).fill('Phòng Nhân sự');
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
   * Địa chỉ mạng và địa chỉ quảng bá KHÔNG phải một máy.
   *
   * Chỉ hỏi "có phải IPv4 hợp lệ không" là để `172.16.0.0` khai được và cuốn sổ có một dòng
   * dẫn tới hư không: gói tin chuyển tới đó không tới máy nào, còn người đọc sổ thì tin rằng
   * port ấy đang phục vụ một dịch vụ thật. Cuốn sổ này phải chặn giống bên IPAM.
   */
  test('đường hỏng: IP trong là địa chỉ mạng hoặc quảng bá đều bị từ chối', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { headers, routerId, routerCode } = await setUp(page, stamp);

    for (const [internalIp, kind] of [
      ['172.16.0.0', 'mạng'],
      ['172.16.10.0', 'mạng'],
      ['172.16.10.255', 'quảng bá'],
    ]) {
      const res = await page.request.post('/api/v1/ipam/nat', {
        headers,
        data: {
          deviceId: routerId,
          protocol: 'tcp',
          externalPorts: '9090',
          internalIp,
          internalPort: 80,
          usedBy: 'thử',
          reason: 'thử',
        },
      });
      expect(res.status(), `phải bị từ chối: ${internalIp}`).toBe(400);
      // Lỗi phải NÓI RA đó là loại địa chỉ gì, không chỉ "không hợp lệ": người gõ tin là mình
      // gõ đúng, nên cần biết vì sao máy nghĩ khác.
      // Không phân biệt hoa-thường: thông điệp viết "ĐỊA CHỈ MẠNG" in hoa để đập vào mắt.
      expect(String((await res.json()).message)).toMatch(new RegExp(kind, 'i'));
    }

    // Và hàng rào phải hiện ra tận màn hình, không chỉ nằm ở API.
    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm luật NAT' }).click();
    const form = page.getByRole('dialog');
    await form.getByPlaceholder('Chọn hoặc gõ để lọc…').fill(routerCode);
    await page.getByRole('option', { name: new RegExp(routerCode) }).click();
    await form.getByRole('textbox', { name: 'Cổng ngoài' }).fill('9091');
    await form.getByRole('textbox', { name: 'IP trong' }).fill('172.16.0.0');
    await form.getByRole('textbox', { name: 'Cổng trong' }).fill('80');
    await form.getByRole('combobox', { name: 'Mở cho ai' }).fill('thử');
    await form.getByRole('textbox', { name: 'Lý do mở' }).fill('thử');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form.getByText(/ĐỊA CHỈ MẠNG/)).toBeVisible();
  });

  /**
   * Bảng dịch vụ/port nhỏ ngay trong hộp (0028).
   *
   * Một dòng NAT ghi "5001" thì sáu tháng sau không ai biết nó là gì và không ai dám đóng.
   * Chọn "OpenVPN" thì port VÀ giao thức tự điền — đó là toàn bộ lý do danh mục này tồn tại.
   */
  test('chọn dịch vụ từ bảng nhỏ thì điền sẵn cả port lẫn giao thức', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { routerCode, internalIp } = await setUp(page, stamp);

    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm luật NAT' }).click();
    const form = page.getByRole('dialog');
    await form.getByPlaceholder('Chọn hoặc gõ để lọc…').fill(routerCode);
    await page.getByRole('option', { name: new RegExp(routerCode) }).click();

    /*
     * OpenVPN là UDP — chọn nó phải kéo giao thức đổi theo, không chỉ điền con số.
     *
     * Hình dạng của hộp mà bài này đi theo:
     *  - Danh mục dịch vụ là DROPDOWN xổ khi bấm, không phải bảng luôn mở (hai ô port mà
     *    mỗi ô một bảng thì chiếm quá nửa hộp thoại).
     *  - Port ngoài là danh sách CHIP có ✕; chọn dịch vụ là THÊM chip, không ghi đè.
     *  - Giao thức là dải nút nhỏ ngay dưới ô port, không phải ô chọn riêng.
     */
    await form.getByRole('combobox', { name: 'Lọc dịch vụ cho Cổng ngoài' }).click();
    await page.getByRole('option', { name: /OpenVPN/ }).click();
    await expect(form.getByRole('button', { name: 'Bỏ cổng 1194' })).toBeVisible();
    await expect(form.getByRole('radio', { name: 'UDP', exact: true })).toBeChecked();

    await form.getByRole('combobox', { name: 'Lọc dịch vụ cho Cổng trong' }).click();
    await page.getByRole('option', { name: /NAS Web/ }).click();
    await expect(form.getByRole('textbox', { name: 'Cổng trong' })).toHaveValue('5001');

    await form.getByRole('textbox', { name: 'IP trong' }).fill(internalIp);
    await form.getByRole('combobox', { name: 'Mở cho ai' }).fill('Team IT');
    await form.getByRole('textbox', { name: 'Lý do mở' }).fill('VPN vào LAN nội bộ');
    await form.getByRole('button', { name: 'Lưu' }).click();

    const row = page.getByRole('row', { name: new RegExp(routerCode) });
    await expect(row.getByText('UDP 1194')).toBeVisible();
    await expect(row.getByText(`${internalIp}:5001`)).toBeVisible();
  });

  /** Dịch vụ chưa có thì khai NGAY trong hộp, không phải bỏ dở form đi sang màn Danh mục. */
  test('thêm dịch vụ mới bằng (+) rồi dùng luôn cho rule đang khai', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { routerCode, internalIp } = await setUp(page, stamp);
    const serviceName = `Cong E2E ${stamp}`;

    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm luật NAT' }).click();
    const form = page.getByRole('dialog');
    await form.getByPlaceholder('Chọn hoặc gõ để lọc…').fill(routerCode);
    await page.getByRole('option', { name: new RegExp(routerCode) }).click();

    // Dịch vụ chưa có: dòng "＋ Thêm dịch vụ" ghim ở đầu menu dropdown.
    await form.getByRole('combobox', { name: 'Lọc dịch vụ cho Cổng ngoài' }).click();
    await page.getByRole('button', { name: '+ Thêm dịch vụ' }).first().click();
    const serviceForm = page.getByRole('dialog').last();
    // `getByRole` chứ không `getByLabel`: nhãn có kèm dấu * (aria-hidden), nên TEXT của thẻ
    // label là "Port *" còn TÊN TRỢ NĂNG mới đúng là "Port".
    await serviceForm.getByRole('textbox', { name: 'Tên', exact: true }).fill(serviceName);
    await serviceForm.getByRole('textbox', { name: 'Từ port' }).fill('8443');
    await serviceForm.getByRole('button', { name: 'Lưu' }).click();

    // Lưu xong là ÁP THẲNG vào ô đang khai — không bắt người dùng đi tìm lại trong danh sách.
    await expect(form.getByRole('button', { name: 'Bỏ cổng 8443' })).toBeVisible();

    await form.getByRole('textbox', { name: 'IP trong' }).fill(internalIp);
    await form.getByRole('textbox', { name: 'Cổng trong' }).fill('443');
    await form.getByRole('combobox', { name: 'Mở cho ai' }).fill('P. Kinh doanh');
    await form.getByRole('textbox', { name: 'Lý do mở' }).fill('web đơn hàng cho đối tác');
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(
      page.getByRole('row', { name: new RegExp(routerCode) }).getByText('TCP 8443'),
    ).toBeVisible();

    // Và dịch vụ đó ở lại danh mục để lần sau chỉ việc chọn.
    await page.goto('/admin/catalog');
    await page.getByRole('tab', { name: 'Dịch vụ / Port' }).click();
    await expect(page.getByRole('row', { name: new RegExp(serviceName) })).toBeVisible();
  });

  /**
   * Router chưa có trong kho thì thêm NGAY trong hộp.
   *
   * Đây đúng là chỗ người dùng mắc kẹt: ô Router mở ra trắng trơn, gõ không ra gì (kho chưa
   * có router nào), và không có đường nào đi tiếp mà không mất cả form đang khai dở.
   */
  test('thêm router mới ngay trong hộp, không mất form đang khai dở', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { internalIp } = await setUp(page, stamp);
    const newRouter = `RT-E2E-NEW-${stamp}`;

    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm luật NAT' }).click();
    const form = page.getByRole('dialog');

    // Khai dở một ô TRƯỚC khi mở hộp thêm router — nó phải còn nguyên khi quay lại.
    await form.getByRole('combobox', { name: 'Mở cho ai' }).fill('Team IT');

    await form.getByPlaceholder('Chọn hoặc gõ để lọc…').click();
    await page.getByRole('button', { name: '+ Thêm router mới' }).click();

    const deviceForm = page.getByRole('dialog').last();
    await deviceForm.getByLabel('Mã thiết bị').fill(newRouter);
    await deviceForm.getByLabel('Tên thiết bị').fill('Draytek mới');
    await deviceForm.getByRole('button', { name: 'Loại' }).click();
    await page.getByRole('option', { name: 'Switch', exact: true }).click();
    await deviceForm.getByRole('button', { name: 'Lưu' }).click();

    // Router vừa tạo được CHỌN SẴN, và ô khai dở còn nguyên.
    await expect(form.getByPlaceholder('Chọn hoặc gõ để lọc…')).toHaveValue(newRouter);
    await expect(form.getByRole('combobox', { name: 'Mở cho ai' })).toHaveValue('Team IT');

    await form.getByRole('textbox', { name: 'Cổng ngoài' }).fill('7443');
    await form.getByRole('textbox', { name: 'IP trong' }).fill(internalIp);
    await form.getByRole('textbox', { name: 'Cổng trong' }).fill('443');
    await form.getByRole('textbox', { name: 'Lý do mở' }).fill('thử router mới');
    await form.getByRole('button', { name: 'Lưu' }).click();

    await expect(page.getByRole('row', { name: new RegExp(newRouter) })).toBeVisible();
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

  /**
   * Dải rộng là CẢNH BÁO chứ không phải lỗi. Nếu code ném thì người dùng đọc được lời khuyên
   * "nếu đúng ý thì cứ lưu" mà không làm theo được, và dải port camera không vào nổi sổ.
   */
  test('dải port lớn LƯU ĐƯỢC và trả về cảnh báo, không bị chặn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { headers, routerId, internalIp } = await setUp(page, stamp);

    const res = await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: {
        deviceId: routerId,
        protocol: 'tcp',
        externalPorts: '50000-52000',
        internalIp,
        internalPort: 554,
        usedBy: 'Camera kho',
        reason: 'dải RTSP của đầu ghi camera',
      },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { warnings?: string[] };
    expect(body.warnings?.length).toBe(1);
    expect(body.warnings?.[0]).toContain('1000');
  });

  /**
   * `EXCLUDE` của DB so `protocol WITH =` nên không thấy
   * `both` chồng `tcp`. Mà `both` theo định nghĩa phủ cả hai — để lọt là sổ có HAI câu trả
   * lời cho TCP/8080.
   */
  test('đường hỏng: "cả hai giao thức" chồng lên rule TCP đang có bị chặn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { headers, routerId, internalIp } = await setUp(page, stamp);
    const base = {
      deviceId: routerId,
      internalIp,
      internalPort: 80,
      usedBy: 'Phòng Nhân sự',
      reason: 'máy chấm công',
    };

    expect(
      (
        await page.request.post('/api/v1/ipam/nat', {
          headers,
          data: { ...base, protocol: 'tcp', externalPorts: '8080' },
        })
      ).status(),
    ).toBe(201);

    const both = await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: { ...base, protocol: 'both', externalPorts: '8080' },
    });
    expect(both.status()).toBe(409);
    expect(await both.json()).toMatchObject({ code: 'NAT_PORT_OVERLAP' });

    // Và chiều ngược lại: đã có `both` thì thêm `udp` cùng port cũng phải bị chặn.
    const other = await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: { ...base, protocol: 'both', externalPorts: '9090' },
    });
    expect(other.status()).toBe(201);
    const udp = await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: { ...base, protocol: 'udp', externalPorts: '9090' },
    });
    expect(udp.status()).toBe(409);
  });

  /**
   * Tìm `8005` phải ra rule `8000-8010`. Chỉ so `external_from` thì người tra kết luận nhầm là
   * port đang trống.
   */
  test('tìm theo port bắt được cả BÊN TRONG khoảng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { headers, routerId, internalIp } = await setUp(page, stamp);
    await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: {
        deviceId: routerId,
        protocol: 'tcp',
        externalPorts: '8000-8010',
        internalIp,
        internalPort: 80,
        usedBy: 'Phòng Nhân sự',
        reason: 'máy chấm công',
      },
    });

    for (const port of ['8000', '8005', '8010']) {
      const res = await page.request.get(`/api/v1/ipam/nat?search=${port}`);
      const rows = (await res.json()) as unknown[];
      expect(rows.length, `tìm ${port} phải ra rule 8000-8010`).toBeGreaterThan(0);
    }
    const outside = await page.request.get('/api/v1/ipam/nat?search=8011');
    expect(((await outside.json()) as unknown[]).length).toBe(0);
  });

  /**
   * Site không tra ra được (đã xóa / bookmark cũ) phải trả RỖNG. Lọc thành `siteCode === null`
   * là trả về rule của router KHÔNG gắn site —
   * một tập khác hẳn, không rỗng, và auditor đọc thành "đây là rule của site X".
   */
  test('lọc theo site không tồn tại trả RỖNG, không trả nhầm tập khác', async ({ page }) => {
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

    // Router của test không gắn site → nếu lọc sai thì rule này sẽ lọt vào kết quả.
    const stale = await page.request.get(
      '/api/v1/ipam/nat?siteId=00000000-0000-4000-8000-000000000000',
    );
    expect(stale.status()).toBe(200);
    expect(((await stale.json()) as unknown[]).length).toBe(0);

    // Còn id rác thì phải là 400 tử tế, không phải 500.
    const junk = await page.request.get('/api/v1/ipam/nat?deviceId=abc');
    expect(junk.status()).toBe(400);
  });

  /**
   * IP trong phải được chuẩn hóa: không thì một dấu cách thừa làm mất liên kết sang hồ sơ IP — cột "máy trong" trống trong khi hồ sơ có thật.
   */
  test('IP trong có dấu cách thừa vẫn nối được sang hồ sơ IP', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { headers, routerId, internalIp } = await setUp(page, stamp);

    const res = await page.request.post('/api/v1/ipam/nat', {
      headers,
      data: {
        deviceId: routerId,
        protocol: 'tcp',
        externalPorts: '8080',
        internalIp: `  ${internalIp}  `,
        internalPort: 80,
        usedBy: 'Phòng Nhân sự',
        reason: 'máy chấm công',
      },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { internalIp: string; internalOwner: string | null };
    expect(body.internalIp).toBe(internalIp);
    expect(body.internalOwner).toBe('Máy chấm công');
  });

  /**
   * A gỡ rule, B bấm Lưu — không có `voided_at IS NULL` trong
   * chính câu UPDATE thì bản sửa của B ghi đè lên hàng đã gỡ và biến mất vĩnh viễn.
   */
  test('sửa một rule vừa bị người khác gỡ thì báo lỗi, không ghi đè im lặng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { headers, routerId, internalIp } = await setUp(page, stamp);
    const created = await page.request.post('/api/v1/ipam/nat', {
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
    const id = ((await created.json()) as { id: string }).id;

    await page.request.delete(`/api/v1/ipam/nat/${id}`, {
      headers,
      data: { reason: 'dịch vụ đã ngừng' },
    });

    const late = await page.request.patch(`/api/v1/ipam/nat/${id}`, {
      headers,
      data: { usedBy: 'Phòng Kho' },
    });
    expect([404, 409]).toContain(late.status());
  });

  /** AC 5.3: trang thiết bị hiển thị rule của chính nó (qua sổ khu mở rộng `device-panels`). */
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

    await page.goto(`/devices/${routerId}`);
    await expect(page.getByRole('heading', { name: 'Sổ NAT' })).toBeVisible();
    /*
     * Hỏi TRONG KHU "Sổ NAT", không phải "ở đâu đó trên trang".
     *
     * Đầu trang có bản đồ quan hệ, và nó cố ý nhắc lại một dòng tóm tắt của mỗi khu
     * (kèm một bản dự phòng dạng danh sách cho màn hẹp, luôn nằm trong DOM). "TCP 8443" vì thế
     * khớp ba chỗ và Playwright dừng ở strict mode. Bản đồ đang làm đúng việc của nó — cái sai
     * là câu hỏi quá rộng: bài này muốn biết KHU SỔ NAT có dòng ấy hay không.
     */
    const khuNat = page.getByRole('region', { name: 'Sổ NAT' });
    await expect(khuNat.getByText('TCP 8443')).toBeVisible();
    await expect(khuNat.getByText(/phần mềm thuế truy cập từ ngoài/)).toBeVisible();
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

/** Panel IP trên trang thiết bị. */
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

    await page.goto(`/devices/${routerId}`);
    await expect(page.getByRole('heading', { name: 'Địa chỉ IP' })).toBeVisible();
    // Hỏi trong KHU "Địa chỉ IP": bản đồ quan hệ ở trên cũng nhắc lại địa chỉ này (xem bài NAT).
    const khuIp = page.getByRole('region', { name: 'Địa chỉ IP' });
    await expect(khuIp.getByText(`172.16.${octet}.1`)).toBeVisible();
    await expect(khuIp.getByText('cổng mặc định')).toBeVisible();
    // IP của máy khác KHÔNG được lọt vào panel của con router này.
    await expect(page.getByText(internalIp)).toHaveCount(0);
  });

  test('thiết bị chưa có IP thì KHÔNG hiện khu trống lơ lửng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const { routerId } = await setUp(page, stamp);

    await page.goto(`/devices/${routerId}`);
    await expect(page.getByRole('tab', { name: 'Tổng quan' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Địa chỉ IP' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sổ NAT' })).toHaveCount(0);
  });
});
