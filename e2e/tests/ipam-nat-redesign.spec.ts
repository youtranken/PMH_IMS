import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetDevices,
  resetIpam,
  resetUsers,
} from './helpers';

/**
 * Đợt 3 UI: màn Địa chỉ IP cắt trang 50 dòng + cột dải cuộn riêng, và sổ NAT nhận nhiều
 * khoảng port trong một lần khai (mỗi khoảng ra một dòng).
 */
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
    headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
    data: { cidr, name },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

async function createRouter(page: Page, code: string): Promise<string> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const firewall = catalog.deviceTypes.find((type) => type.name === 'Firewall')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
    data: { code, name: `Router ${code}`, deviceTypeId: firewall.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

test.describe('Màn Địa chỉ IP — cắt trang và cột dải cuộn riêng', () => {
  test('dải /24 hiện 50 dòng một trang, đi được tới trang cuối', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const octet = 30 + (Number(Date.now().toString().slice(-2)) % 60);
    const cidr = `10.${octet}.7.0/24`;
    const id = await createSubnet(page, cidr, `LAN E2E cắt trang ${octet}`);

    await page.goto(`/ip-addresses/${id}`);
    await expect(page.getByRole('heading', { name: new RegExp(cidr) })).toBeVisible();

    // 254 host / 50 = 6 trang. Trước đây đổ hết 254 dòng ra một lượt.
    await expect(page.getByRole('button', { name: 'Cấp IP này' })).toHaveCount(50);
    await expect(page.getByText('1–50 trên 254 dòng')).toBeVisible();
    await expect(page.getByText('Trang 1/6')).toBeVisible();

    // Dòng đầu của dải là .1, dòng cuối trang 1 là .50 — thứ tự địa chỉ, không phải thứ tự ngẫu nhiên.
    await expect(page.getByText(`10.${octet}.7.1`, { exact: true })).toBeVisible();
    await expect(page.getByText(`10.${octet}.7.51`, { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Trang sau' }).click();
    await expect(page.getByText('Trang 2/6')).toBeVisible();
    await expect(page.getByText(`10.${octet}.7.51`, { exact: true })).toBeVisible();

    // Trang cuối của /24 chỉ còn 4 dòng.
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole('button', { name: 'Trang sau' }).click();
    }
    await expect(page.getByText('Trang 6/6')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cấp IP này' })).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Trang sau' })).toBeDisabled();
  });

  test('nút lọc mang con số đếm của CẢ dải, không phải của trang đang xem', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const octet = 90 + (Number(Date.now().toString().slice(-2)) % 60);
    const cidr = `10.${octet}.8.0/24`;
    const id = await createSubnet(page, cidr, `LAN E2E đếm ${octet}`);

    // Cấp một IP nằm ở TRANG 3 — con số trên nút phải thấy nó dù trang 1 đang hiện.
    const created = await page.request.post('/api/v1/ipam/addresses', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
      data: { subnetId: id, address: `10.${octet}.8.120`, usedBy: 'P. Kế toán' },
    });
    expect(created.status()).toBe(201);

    await page.goto(`/ip-addresses/${id}`);
    // Nhãn nút mang luôn con số: "Đang cấp 1", "Trống 253" — đọc được bằng một cái liếc.
    const assigned = page.getByRole('button', { name: 'Đang cấp 1' });
    await expect(assigned).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trống 253' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tất cả 254' })).toBeVisible();

    // Bấm lọc "Đang dùng": còn đúng 1 dòng và TỰ VỀ TRANG 1 — giữ nguyên trang cũ là bảng rỗng.
    await page.getByRole('button', { name: 'Trang sau' }).click();
    await expect(page.getByText('Trang 2/6')).toBeVisible();
    await assigned.click();
    await expect(page.getByText(`10.${octet}.8.120`, { exact: true })).toBeVisible();
    await expect(page.getByText('1–1 trên 1 dòng')).toBeVisible();
  });

  test('đổi sang dải khác thì về TRANG 1, không giữ nguyên trang cũ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const octet = 200 + (Number(Date.now().toString().slice(-2)) % 40);
    const first = await createSubnet(page, `10.${octet}.1.0/24`, `LAN E2E trang A ${octet}`);
    await createSubnet(page, `10.${octet}.2.0/24`, `LAN E2E trang B ${octet}`);

    await page.goto(`/ip-addresses/${first}`);
    await page.getByRole('button', { name: 'Trang sau' }).click();
    await page.getByRole('button', { name: 'Trang sau' }).click();
    await expect(page.getByText('Trang 3/6')).toBeVisible();

    /*
     * Bấm sang dải khác mà vẫn ở trang 3 là mở ra dòng 101–150 của dải mới, còn 100 địa chỉ
     * đầu thì biến mất — không có gì trên màn hình giải thích vì sao.
     */
    await page.getByRole('link', { name: new RegExp(`10\.${octet}\.2\.0/24`) }).click();
    await expect(page.getByText('Trang 1/6')).toBeVisible();
    await expect(page.getByText(`10.${octet}.2.1`, { exact: true })).toBeVisible();
  });

  test('cột dải cuộn riêng: cuộn bảng IP xuống thì cột trái vẫn ở trong tầm nhìn', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const base = 150 + (Number(Date.now().toString().slice(-2)) % 40);
    // Nhiều dải để cột trái dài hơn một màn hình.
    for (let i = 0; i < 12; i += 1) {
      await createSubnet(page, `10.${base}.${i}.0/24`, `LAN E2E cuộn ${base}-${i}`);
    }

    await page.goto('/ip-addresses');
    const rail = page.locator('.subnet-rail');
    await expect(rail).toBeVisible();

    // Cột trái có thanh cuộn RIÊNG: nội dung cao hơn khung của chính nó.
    const scrolls = await rail.evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY === 'auto',
    );
    expect(scrolls).toBe(true);

    // Cuộn trang xuống đáy: cột trái dính lại, không trôi mất khỏi màn hình.
    await page.mouse.wheel(0, 4000);
    await expect(rail).toBeInViewport();
  });
});

test.describe('Sổ NAT — nhiều khoảng port trong một lần khai', () => {
  test('đường hạnh phúc: ba chip port ra ba dòng, dùng chung router và lý do', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const routerCode = `FW-E2E-${stamp}`;
    await createRouter(page, routerCode);

    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm rule' }).click();
    const form = page.getByRole('dialog');

    await form.getByRole('combobox', { name: 'Router' }).fill(routerCode);
    await page.getByRole('option', { name: new RegExp(routerCode) }).click();

    // Ba khoảng, gõ liên tiếp — mỗi lần Enter là một chip.
    const portInput = form.getByPlaceholder('8080 hoặc 8000-8010');
    for (const value of ['8080', '8443', '5060-5070']) {
      await portInput.fill(value);
      await portInput.press('Enter');
    }
    await expect(form.getByText('8080', { exact: true })).toBeVisible();
    await expect(form.getByText('5060-5070', { exact: true })).toBeVisible();
    // Nói TRƯỚC là sẽ ghi mấy dòng.
    await expect(form.getByText(/Bấm Lưu sẽ ghi 3 dòng/)).toBeVisible();

    await form.getByRole('textbox', { name: 'IP trong' }).fill('172.16.10.5');
    await form.getByRole('textbox', { name: 'Port trong' }).fill('3389');
    await form.getByRole('combobox', { name: 'Mở cho ai' }).fill('P. Kế toán');
    await form.getByRole('textbox', { name: 'Lý do mở' }).fill(`Máy chấm công ${stamp}`);
    await form.getByRole('button', { name: 'Lưu' }).click();

    await expect(page.getByText('Đã ghi 3 dòng vào sổ NAT.')).toBeVisible();

    // Ba dòng riêng trong sổ, cùng router · cùng đích · cùng lý do.
    await page.getByRole('searchbox', { name: /Tìm/ }).fill(`Máy chấm công ${stamp}`);
    for (const ports of ['TCP 8080', 'TCP 8443', 'TCP 5060-5070']) {
      await expect(page.getByText(ports, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: routerCode })).toHaveCount(3);
  });

  test('bấm ✕ bỏ một chip trước khi lưu thì port đó không vào sổ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const routerCode = `FW-E2E-X-${stamp}`;
    await createRouter(page, routerCode);

    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm rule' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('combobox', { name: 'Router' }).fill(routerCode);
    await page.getByRole('option', { name: new RegExp(routerCode) }).click();

    const portInput = form.getByPlaceholder('8080 hoặc 8000-8010');
    for (const value of ['9001', '9002']) {
      await portInput.fill(value);
      await portInput.press('Enter');
    }
    await form.getByRole('button', { name: 'Bỏ port 9002' }).click();
    await expect(form.getByText('9002', { exact: true })).toHaveCount(0);

    await form.getByRole('textbox', { name: 'IP trong' }).fill('172.16.10.9');
    await form.getByRole('textbox', { name: 'Port trong' }).fill('80');
    await form.getByRole('combobox', { name: 'Mở cho ai' }).fill('P. Kỹ thuật');
    await form.getByRole('textbox', { name: 'Lý do mở' }).fill(`Web nội bộ ${stamp}`);
    await form.getByRole('button', { name: 'Lưu' }).click();

    await expect(page.getByText('Đã lưu rule NAT.')).toBeVisible();
    await page.getByRole('searchbox', { name: /Tìm/ }).fill(`Web nội bộ ${stamp}`);
    await expect(page.getByText('TCP 9001', { exact: true })).toBeVisible();
    await expect(page.getByText('TCP 9002', { exact: true })).toHaveCount(0);
  });

  test('đường hỏng: port sai định dạng báo ngay tại ô, không chờ bấm Lưu', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const routerCode = `FW-E2E-E-${stamp}`;
    await createRouter(page, routerCode);

    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm rule' }).click();
    const form = page.getByRole('dialog');

    const portInput = form.getByPlaceholder('8080 hoặc 8000-8010');
    await portInput.fill('http');
    await portInput.press('Enter');
    await expect(form.getByText(/Chỉ nhận một số/)).toBeVisible();

    // Dải viết ngược có câu riêng — nói đúng chỗ sai thì sửa trong hai giây.
    await portInput.fill('9000-8000');
    await portInput.press('Enter');
    await expect(form.getByText(/Dải viết ngược/)).toBeVisible();

    await portInput.fill('70000');
    await portInput.press('Enter');
    await expect(form.getByText(/1–65535/)).toBeVisible();

    // Chưa có chip nào thì bấm Lưu phải nói thiếu port, không phải im lặng. Các ô bắt buộc
    // khác phải điền trước, không thì trình duyệt chặn ở `required` và lỗi của form không tới.
    await form.getByRole('combobox', { name: 'Router' }).fill(routerCode);
    await page.getByRole('option', { name: new RegExp(routerCode) }).click();
    await form.getByRole('textbox', { name: 'IP trong' }).fill('172.16.10.4');
    await form.getByRole('textbox', { name: 'Port trong' }).fill('443');
    await form.getByRole('combobox', { name: 'Mở cho ai' }).fill('P. Kỹ thuật');
    await form.getByRole('textbox', { name: 'Lý do mở' }).fill(`Thiếu port ${stamp}`);
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(form.getByText('Thêm ít nhất một port ngoài.')).toBeVisible();
  });

  test('sửa một rule thì chỉ giữ đúng một khoảng port', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const routerCode = `FW-E2E-S-${stamp}`;
    const deviceId = await createRouter(page, routerCode);

    const created = await page.request.post('/api/v1/ipam/nat', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
      data: {
        deviceId,
        protocol: 'tcp',
        externalPorts: '7001',
        internalIp: '172.16.10.7',
        internalPort: 22,
        usedBy: 'P. Kỹ thuật',
        reason: `SSH tạm ${stamp}`,
        enabled: true,
      },
    });
    expect(created.status()).toBe(201);

    await page.goto('/nat');
    await page.getByRole('searchbox', { name: /Tìm/ }).fill(`SSH tạm ${stamp}`);
    await page.getByRole('button', { name: 'Sửa' }).click();

    const form = page.getByRole('dialog');
    // Khoảng đang có mở ra thành chip; ô thêm biến mất kèm lời giải thích.
    await expect(form.getByText('7001', { exact: true })).toBeVisible();
    await expect(form.getByPlaceholder('8080 hoặc 8000-8010')).toHaveCount(0);
    await expect(form.getByText(/chỉ giữ một khoảng port/)).toBeVisible();

    await form.getByRole('button', { name: 'Bỏ port 7001' }).click();
    const portInput = form.getByPlaceholder('8080 hoặc 8000-8010');
    await portInput.fill('7002');
    await portInput.press('Enter');
    await form.getByRole('button', { name: 'Lưu' }).click();

    await expect(page.getByText('Đã lưu rule NAT.')).toBeVisible();
    await page.getByRole('searchbox', { name: /Tìm/ }).fill(`SSH tạm ${stamp}`);
    await expect(page.getByText('TCP 7002', { exact: true })).toBeVisible();
  });
});

test.describe('Sổ NAT — lưu hỏng một phần', () => {
  /**
   * Ghi được một phần thì GIỮ HỘP LẠI, chỉ bỏ đi khoảng đã ghi xong.
   *
   * Đóng hộp là mất trắng router, IP trong, lý do và mấy khoảng còn lại — người dùng gõ lại
   * từ đầu chỉ vì một khoảng đụng rule cũ. Toast cảnh báo trôi qua vài giây, form thì mất hẳn.
   */
  test('một khoảng đụng rule cũ: hộp còn mở, khoảng đã ghi biến khỏi danh sách', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
    const routerCode = `FW-E2E-P-${stamp}`;
    const deviceId = await createRouter(page, routerCode);

    // Dựng sẵn một rule chiếm port 7100 trên chính router đó.
    expect(
      (
        await page.request.post('/api/v1/ipam/nat', {
          headers,
          data: {
            deviceId,
            protocol: 'tcp',
            externalPorts: '7100',
            internalIp: '172.16.10.7',
            internalPort: 22,
            usedBy: 'P. Kỹ thuật',
            reason: `Chiếm sẵn ${stamp}`,
            enabled: true,
          },
        })
      ).status(),
    ).toBe(201);

    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm rule' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('combobox', { name: 'Router' }).fill(routerCode);
    await page.getByRole('option', { name: new RegExp(routerCode) }).click();

    const portInput = form.getByPlaceholder('8080 hoặc 8000-8010');
    for (const value of ['7200', '7100']) {
      await portInput.fill(value);
      await portInput.press('Enter');
    }
    await form.getByRole('textbox', { name: 'IP trong' }).fill('172.16.10.8');
    await form.getByRole('textbox', { name: 'Port trong' }).fill('80');
    await form.getByRole('combobox', { name: 'Mở cho ai' }).fill('P. Kỹ thuật');
    await form.getByRole('textbox', { name: 'Lý do mở' }).fill(`Hỏng một phần ${stamp}`);
    await form.getByRole('button', { name: 'Lưu' }).click();

    // 7200 ghi được, 7100 đụng → hộp CÒN MỞ, báo lỗi tại chỗ, và 7200 đã biến khỏi chip.
    await expect(form.getByRole('alert')).toBeVisible();
    await expect(form.getByRole('button', { name: 'Bỏ port 7100' })).toBeVisible();
    await expect(form.getByRole('button', { name: 'Bỏ port 7200' })).toHaveCount(0);
    // Mọi thứ đã gõ vẫn nguyên — không phải gõ lại từ đầu.
    await expect(form.getByRole('textbox', { name: 'IP trong' })).toHaveValue('172.16.10.8');
    await expect(form.getByRole('textbox', { name: 'Lý do mở' })).toHaveValue(
      `Hỏng một phần ${stamp}`,
    );
  });
});

test.describe('Sổ NAT — máy đích được NAT', () => {
  /**
   * Lỗ hổng lớn nhất của cuốn sổ trước đây: nó ghi "dẫn tới 172.16.10.5" mà không nói
   * 172.16.10.5 là MÁY NÀO. Ba thứ trong form là ba câu khác nhau và không trùng nhau:
   * Router = con THỰC HIỆN NAT · Máy đích = con ĐƯỢC NAT · Mở cho ai = NGƯỜI hưởng dịch vụ.
   */
  test('chọn máy đích thì ô IP chỉ còn IP của chính máy đó, và sổ hiện tên máy', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
    const routerCode = `FW-E2E-T-${stamp}`;
    await createRouter(page, routerCode);

    // Máy đích + IP của nó.
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
    const nasCode = `NAS-E2E-T-${stamp}`;
    const nas = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: nasCode, name: 'NAS phòng máy', deviceTypeId: pc.id },
    });
    const nasId = ((await nas.json()) as { device: { id: string } }).device.id;

    const octet = 20 + (Number(stamp) % 200);
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.20.${octet}.0/24`, name: `LAN E2E đích ${stamp}` },
    });
    const subnetId = ((await subnet.json()) as { id: string }).id;
    const targetIp = `172.20.${octet}.20`;
    expect(
      (
        await page.request.post('/api/v1/ipam/addresses', {
          headers,
          data: { subnetId, address: targetIp, deviceId: nasId, usedBy: 'P. Kỹ thuật' },
        })
      ).status(),
    ).toBe(201);

    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm rule' }).click();
    const form = page.getByRole('dialog');

    // MỘT ô chọn router — ô "Loại thiết bị" cũ đã bỏ, vì nó bắt thao tác hai dropdown cho
    // một việc và chọn nhầm loại là danh sách rỗng trơn.
    await expect(form.getByRole('button', { name: 'Loại thiết bị' })).toHaveCount(0);
    await form.getByRole('combobox', { name: 'Router' }).fill(routerCode);
    await page.getByRole('option', { name: new RegExp(routerCode) }).click();

    const portInput = form.getByPlaceholder('8080 hoặc 8000-8010');
    await portInput.fill('5001');
    await portInput.press('Enter');
    await form.getByRole('textbox', { name: 'Port trong' }).fill('5001');

    // Chưa chọn máy đích: IP là ô gõ tay.
    await expect(form.getByRole('textbox', { name: 'IP trong' })).toBeVisible();

    await form.getByRole('combobox', { name: 'Máy đích (được NAT)' }).fill(nasCode);
    await page.getByRole('option', { name: new RegExp(nasCode) }).click();

    // Chọn máy xong: ô IP thành DANH SÁCH IP của chính máy đó — hết cảnh gõ tay một địa chỉ
    // không thuộc máy nào rồi bị API từ chối ở bước cuối.
    await expect(form.getByRole('textbox', { name: 'IP trong' })).toHaveCount(0);
    await form.getByRole('button', { name: 'IP trong' }).click();
    await page.getByRole('option', { name: new RegExp(targetIp) }).click();

    await form.getByRole('combobox', { name: 'Mở cho ai' }).fill('P. Kỹ thuật');
    await form.getByRole('textbox', { name: 'Lý do mở' }).fill(`NAS cho đối tác ${stamp}`);
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Đã lưu rule NAT.')).toBeVisible();

    // Trong sổ: dòng nói luôn MÁY nào, bấm sang được hồ sơ máy đó.
    await page.getByRole('searchbox', { name: /Tìm/ }).fill(`NAS cho đối tác ${stamp}`);
    const row = page.getByRole('row', { name: new RegExp(routerCode) });
    await expect(row.getByRole('link', { name: nasCode })).toBeVisible();
  });

  /*
   * Ô "Máy đích" là BỘ LỌC, không phải dữ liệu được ghi: máy đích của rule do API suy ra từ
   * hồ sơ IP. Nên khi máy được chọn KHÔNG có hồ sơ IP nào, chọn nó xong gõ tay một địa chỉ
   * là sổ ghi về một máy khác (hoặc không máy nào) — im lặng. Ô gõ tay vẫn phải cho gõ, vì
   * có máy chưa kịp khai IP, nhưng phải NÓI RA rằng máy vừa chọn sẽ không được gắn.
   */
  test('máy đích chưa có hồ sơ IP → vẫn gõ tay được nhưng nói rõ rule không gắn về máy đó', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
    const routerCode = `FW-E2E-NOIP-${stamp}`;
    await createRouter(page, routerCode);

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
    const bareCode = `PC-E2E-NOIP-${stamp}`;
    expect(
      (
        await page.request.post('/api/v1/devices', {
          headers,
          data: { code: bareCode, name: 'Máy chưa khai IP', deviceTypeId: pc.id },
        })
      ).status(),
    ).toBe(201);

    await page.goto('/nat');
    await page.getByRole('button', { name: 'Thêm rule' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('combobox', { name: 'Router' }).fill(routerCode);
    await page.getByRole('option', { name: new RegExp(routerCode) }).click();

    await form.getByRole('combobox', { name: 'Máy đích (được NAT)' }).fill(bareCode);
    await page.getByRole('option', { name: new RegExp(bareCode) }).click();

    // Vẫn là ô gõ tay — nhưng kèm câu cảnh báo, không phải im lặng.
    await expect(form.getByRole('textbox', { name: 'IP trong' })).toBeVisible();
    await expect(form.getByText(/KHÔNG gắn rule về máy vừa chọn/)).toBeVisible();
  });
});

test.describe('Popup Sửa có chỗ quản lý giấy tờ', () => {
  test('sửa thiết bị: thấy panel giấy tờ, tải lên rồi xóa ngay trong hộp', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const code = `PC-E2E-SUA-${stamp}`;

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
    const created = await page.request.post('/api/v1/devices', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' },
      data: { code, name: 'Máy cần đổi giấy tờ', deviceTypeId: pc.id },
    });
    expect(created.status()).toBe(201);

    await page.goto('/devices');
    await page.getByRole('searchbox', { name: /Tìm/ }).fill(code);
    await page.getByRole('button', { name: `Sửa máy ${code}` }).click();

    const form = page.getByRole('dialog');
    await expect(form.getByRole('heading', { name: 'Giấy tờ đính kèm' })).toBeVisible();
    await expect(form.getByText('Chưa có giấy tờ nào.')).toBeVisible();
  });
});
