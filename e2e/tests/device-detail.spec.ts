import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  resetDevices,
  resetIpam,
  resetUsers,
  uniqueStamp,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetDevices();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function createSwitch(page: Page, code: string): Promise<string> {
  const csrf = await csrfOf(page);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const type = catalog.deviceTypes.find((t) => t.name === 'Switch')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data: {
      code,
      name: 'Switch lõi phòng máy',
      deviceTypeId: type.id,
      assignedTo: 'phòng IT',
      warrantyEnd: '2027-12-31',
      serial: `FOC-${code}`,
    },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

/** Story 2.5 — một trang mở ra thấy mọi thứ về thiết bị. */
test.describe('Trang chi tiết thiết bị', () => {
  test('gom đủ hồ sơ · bảo hành · port map · giấy tờ · lịch sử trong một trang', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SW-E2E-ALL-${stamp}`;
    const deviceId = await createSwitch(page, code);
    const csrf = await csrfOf(page);

    await page.request.post(`/api/v1/devices/${deviceId}/ports`, {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { portLabel: 'Gi1/0/1', connectedLabel: 'uplink nhà mạng' },
    });

    await page.goto(`/devices/${deviceId}`);

    // Dải tóm tắt: trạng thái + tình trạng bảo hành hiện ngay, không phải bấm vào đâu.
    await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
    await expect(page.getByText('Đang dùng').first()).toBeVisible();
    await expect(page.getByText(/Còn \d+ ngày/).first()).toBeVisible();

    // Đủ 4 tab (switch có port map).
    for (const name of ['Tổng quan', 'Sơ đồ cổng', 'Giấy tờ', 'Lịch sử']) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }

    /* `.first()`: serial giờ hiện ở HAI chỗ có chủ ý — dòng định danh ngay dưới tiêu đề
       (thứ người ta đọc qua điện thoại cho nhà cung cấp) và ô Serial trong lưới hồ sơ. */
    await expect(page.getByText(`FOC-${code}`).first()).toBeVisible();

    await page.getByRole('tab', { name: 'Sơ đồ cổng' }).click();
    await expect(page.getByRole('row', { name: /Gi1\/0\/1/ })).toBeVisible();

    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    const pdf = join(tmpdir(), `giay-to-${stamp}.pdf`);
    writeFileSync(pdf, '%PDF-1.4\ntrailer<<>>\n');
    await page.getByLabel('Chọn file để đính kèm').setInputFiles(pdf);
    await expect(page.getByRole('row', { name: new RegExp(`giay-to-${stamp}`) })).toBeVisible();
    // DEV-082: dòng giấy tờ nói ai tải lên (họ tên, không phải id).
    await expect(
      page.getByRole('row', { name: new RegExp(`giay-to-${stamp}`) }).getByText(/^bởi .+/),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    await expect(page.getByText('Tạo hồ sơ')).toBeVisible();
    await expect(page.getByText('Thêm cổng Gi1/0/1', { exact: true })).toBeVisible();

    // ADM-068: từ tab Lịch sử sang Nhật ký hệ thống đã lọc sẵn đúng máy này.
    await page.getByRole('link', { name: 'Nhật ký thao tác' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Nhật ký hệ thống' })).toBeVisible();
    const url = new URL(page.url());
    expect(url.searchParams.get('objectType')).toBe('device');
    expect(url.searchParams.get('objectId')).toBe(deviceId);
    await expect(page.getByRole('searchbox', { name: 'Mã đối tượng' })).toHaveValue(deviceId);
  });

  test('khu mở rộng chưa có module nào đăng ký → API trả rỗng, trang không hiện khối trống', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createSwitch(page, `SW-E2E-EXT-${stamp}`);

    const panels = await page.evaluate(async (id: string) => {
      const res = await fetch(`/api/v1/devices/${id}/panels`, { credentials: 'include' });
      return (await res.json()) as unknown[];
    }, deviceId);
    // Đợt 1: ipam/vault/software chưa tồn tại nên danh sách rỗng — ĐÚNG như thiết kế.
    expect(panels).toEqual([]);

    await page.goto(`/devices/${deviceId}`);
    await expect(page.getByRole('heading', { name: /SW-E2E-EXT/ })).toBeVisible();
    // Không được có tiêu đề khu mở rộng treo lơ lửng, cũng không có lời hứa "sẽ có sau".
    for (const ghost of ['Địa chỉ IP', 'Két sắt', 'License', 'Phiếu']) {
      await expect(page.getByRole('heading', { name: ghost })).toHaveCount(0);
    }
  });

  test('?tab=ports trên máy KHÔNG có port map → rơi về Hồ sơ, không vẽ bảng port', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const csrf = await csrfOf(page);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    // Máy in: `has_port_map = false` trong seed 0011 — đúng loại không có tab Port map.
    const printer = catalog.deviceTypes.find((t) => t.name === 'Printer')!;
    const created = await page.request.post('/api/v1/devices', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: {
        code: `PR-E2E-TAB-${stamp}`,
        name: 'Máy in kiểm tab',
        deviceTypeId: printer.id,
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { device: { id: string } }).device.id;

    /*
     * Danh sách tab hợp lệ phụ thuộc DỮ LIỆU, mà lượt kiểm đầu tiên chạy lúc hồ sơ chưa về.
     * Không kẹp lại sau khi có hồ sơ thì `?tab=ports` lọt qua: thanh tab không ô nào sáng,
     * mà bảng port map vẫn được vẽ ra cho một cái máy in.
     */
    await page.goto(`/devices/${id}?tab=ports`);
    await expect(page.getByRole('heading', { name: new RegExp(`PR-E2E-TAB-${stamp}`) })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sơ đồ cổng' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Tổng quan', selected: true })).toBeVisible();
  });

  test('mở thiết bị không tồn tại → khối "không tìm thấy hồ sơ" có đường về danh sách', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/devices/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('heading', { name: 'Không tìm thấy hồ sơ' })).toBeVisible();
    // MISC-007: không có nút Thử lại (thử lại cũng vẫn 404), có lối về đúng danh sách.
    await expect(page.getByRole('button', { name: 'Thử lại' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Về danh sách Thiết bị' }).click();
    await expect(page).toHaveURL(/\/devices$/);
  });
});

/**
 * Đợt dựng lại trang chi tiết (28/08/2026): thanh thời hạn, dải chỉ số, breadcrumb.
 *
 * Trước đó "bảo hành" chỉ là một cái nhãn chữ ("Còn 157 ngày") — trả lời đúng một câu và
 * giấu mất ba câu còn lại: mua từ bao giờ, hạn chạy từ mốc nào, đã đi hết bao nhiêu phần.
 */
test.describe('Trang chi tiết — dựng lại 28/08', () => {
  test('thanh bảo hành hiện quãng đường và mốc hôm nay, không chỉ một nhãn chữ', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SW-E2E-WT-${stamp}`;
    const csrf = await csrfOf(page);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const type = catalog.deviceTypes.find((item) => item.name === 'Switch')!;
    const created = await page.request.post('/api/v1/devices', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: {
        code,
        name: 'Switch có bảo hành',
        deviceTypeId: type.id,
        purchaseDate: '2025-01-12',
        warrantyStart: '2025-01-12',
        warrantyEnd: '2027-12-31',
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { device: { id: string } }).device.id;

    await page.goto(`/devices/${id}`);

    // Breadcrumb thay nút "Về danh sách": bốn tầng điều hướng rút còn ba, và nó nói thêm
    // được bối cảnh — loại thiết bị nằm giữa danh sách và hồ sơ đang mở.
    const crumbs = page.getByRole('navigation', { name: 'breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Thiết bị' })).toBeVisible();
    await expect(crumbs.getByText('Switch')).toBeVisible();

    /*
     * Thanh là một `progressbar` THẬT, không phải một cái div tô màu: trình đọc màn hình đọc
     * ra được phần trăm, và bài kiểm bám vào giá trị đó thay vì bám vào bề rộng pixel.
     */
    const bar = page.getByRole('progressbar').first();
    await expect(bar).toBeVisible();
    const percent = Number(await bar.getAttribute('aria-valuenow'));
    expect(percent).toBeGreaterThan(0);
    expect(percent).toBeLessThan(100);

    // Hai đầu thanh nói rõ mốc, và vế phải vẫn là câu quen thuộc của badge.
    await expect(page.getByText('12/01/2025').first()).toBeVisible();
    await expect(page.getByText('31/12/2027').first()).toBeVisible();
    await expect(page.getByText(/Đã đi \d+%/)).toBeVisible();
  });

  /* Không có hạn thì KHÔNG vẽ thanh — thanh rỗng chỉ làm người đọc tưởng dữ liệu bị mất. */
  test('máy không khai bảo hành thì không có thanh nào', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const csrf = await csrfOf(page);
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const pc = catalog.deviceTypes.find((item) => item.name === 'PC')!;
    const created = await page.request.post('/api/v1/devices', {
      headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
      data: { code: `PC-E2E-NOWT-${stamp}`, name: 'Máy không hạn', deviceTypeId: pc.id },
    });
    const id = ((await created.json()) as { device: { id: string } }).device.id;

    await page.goto(`/devices/${id}`);
    await expect(page.getByText('Không có hạn')).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);

    // Và ô chưa khai gom về MỘT dòng, không phải một dãy hộp gạch ngang.
    await expect(page.getByText(/Chưa khai:/)).toBeVisible();
  });

  /**
   * Số trên nhãn tab (28/08/2026) — "Két sắt 1".
   *
   * Trước đây phải bấm vào từng tab mới biết trong đó có gì. Số trên nhãn trả lời trước.
   *
   * Đếm ở web qua chính truy vấn mà panel dùng, không phải một endpoint mới: `vault.module` đã
   * import `devices`, nên cho `devices` gọi ngược `vault.api` để đếm là vòng phụ thuộc.
   *
   * ===== VẾ "SỐ 0 VẪN HIỆN" ĐÃ BỊ ĐẢO (18/09/2026) =====
   *
   * Bản 28/08 khẳng định `0` là câu trả lời THẬT và vẫn phải hiện. Đợt thiết kế v2 đảo lại, và
   * đảo có văn bản: `design-ims/v2-chi-tiet/_SPEC.md:61` xếp "Badge đếm hiện số 0" vào danh
   * sách LỖI của bản cũ, `:529` đưa thành gạch nghiệm thu — `count === 0` thì KHÔNG vẽ
   * `.tab-count`. Lý do: số 0 không nói thêm gì so với việc mở tab ra thấy khu rỗng, nhưng nó
   * làm hàng tab của hồ sơ mới trông như đang hỏng ("Tổng quan · Giấy tờ 0 · Két sắt 0").
   *
   * Cái bài này canh thì KHÔNG đổi, và đó mới là phần đáng giá: số chỉ xuất hiện khi có thứ
   * để đếm, và nó phải KHỚP với nội dung panel — hai chỗ dùng chung một truy vấn nên không
   * thể nói hai con số khác nhau.
   */
  test('nhãn tab mang sẵn số — không phải bấm vào mới biết trong đó có gì', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const deviceId = await createSwitch(page, `SW-E2E-CNT-${stamp}`);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    await page.goto(`/devices/${deviceId}`);
    // Rỗng thì tab KHÔNG đeo số nào — `name` khớp CHÍNH XÁC nên "Giấy tờ 0" sẽ không lọt qua.
    await expect(page.getByRole('tab', { name: 'Giấy tờ', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Két sắt', exact: true })).toBeVisible();

    const secret = await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: `Mat khau switch E2E ${stamp}`,
        value: 'Qw3rty!@#Manh2026',
      },
    });
    expect(secret.status()).toBe(201);

    await page.goto(`/devices/${deviceId}`);
    // Có một ngăn → số mọc ra đúng ở tab đó, và CHỈ ở tab đó.
    await expect(page.getByRole('tab', { name: 'Két sắt 1' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Giấy tờ', exact: true })).toBeVisible();

    /*
     * Bấm sang tab là dữ liệu đã nằm sẵn trong cache — số và nội dung panel dùng CHUNG một
     * truy vấn, nên hai chỗ không thể nói hai con số khác nhau.
     */
    await page.getByRole('tab', { name: 'Két sắt 1' }).click();
    await expect(page.getByText(`Mat khau switch E2E ${stamp}`)).toBeVisible();
  });
});

/*
 * DEV-089: cấp IP ngay từ trang thiết bị — chọn dải, IP trống đầu tiên (bỏ gateway) điền sẵn,
 * máy đang xem đã điền trong hộp Cấp IP. Trước đây phải sang màn Địa chỉ IP và lật trang tìm ô.
 */
test.describe('Cấp IP từ trang thiết bị', () => {
  test('đường hạnh phúc: chọn dải → IP đầu tiên sau gateway → khu Địa chỉ IP có dòng mới', async ({
    page,
  }) => {
    resetIpam();
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SW-E2E-IP-${stamp}`;
    const deviceId = await createSwitch(page, code);
    const octet = Number(stamp) % 200;
    const subnetName = `LAN E2E DEV089 ${stamp}`;
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: { cidr: `172.21.${octet}.0/29`, name: subnetName, gateway: `172.21.${octet}.1` },
    });
    expect(subnet.status(), await subnet.text()).toBe(201);

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('button', { name: 'Cấp IP', exact: true }).click();
    const pick = page.getByRole('dialog', { name: `Cấp IP cho ${code}` });
    await pick.getByRole('button', { name: 'Dải mạng' }).click();
    await page.getByRole('option', { name: new RegExp(subnetName) }).click();
    await expect(pick.getByRole('button', { name: 'IP trống' })).toContainText(`172.21.${octet}.2`);
    await pick.getByRole('button', { name: 'Tiếp tục' }).click();

    const assign = page.getByRole('dialog', { name: `Cấp IP — 172.21.${octet}.2` });
    await expect(assign.getByRole('combobox', { name: 'Thiết bị' })).toHaveValue(code);
    await assign.getByRole('button', { name: 'Cấp IP' }).click();
    await expect(page.getByText('Đã cấp IP cho máy này.')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Địa chỉ IP' }).getByRole('link', { name: `172.21.${octet}.2` }),
    ).toBeVisible();
  });

  test('đường hỏng: bấm Tiếp tục khi chưa chọn dải thì báo lỗi dưới ô', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SW-E2E-IP0-${stamp}`;
    const deviceId = await createSwitch(page, code);
    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('button', { name: 'Cấp IP', exact: true }).click();
    const pick = page.getByRole('dialog', { name: `Cấp IP cho ${code}` });
    await pick.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(pick.getByText('Chọn dải mạng để lấy IP.')).toBeVisible();
  });
});

/*
 * DEV-086: tab Lịch sử của máy gộp sự kiện license/IP của module khác, có chip lọc theo nguồn.
 * "Máy này từng dùng key nào" đọc ở một chỗ, kể cả ghế ĐÃ GỠ.
 */
test.describe('Lịch sử hợp nhất của thiết bị', () => {
  test('ghế license gán rồi gỡ hiện trong Lịch sử; chip lọc tách nguồn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const code = `SW-E2E-TL-${stamp}`;
    const deviceId = await createSwitch(page, code);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
    const license = await page.request.post('/api/v1/software', {
      headers,
      data: { code: `LIC-E2E-TL-${stamp}`, name: 'License lịch sử', kind: 'license', seatTotal: 2, endDate: '2030-01-01' },
    });
    expect(license.status()).toBe(201);
    const softwareId = ((await license.json()) as { id: string }).id;
    const seat = await page.request.post(`/api/v1/software/${softwareId}/assignments`, {
      headers,
      data: { deviceId },
    });
    expect(seat.status()).toBe(201);
    const seatId = ((await seat.json()) as { assignment: { id: string } }).assignment.id;
    const released = await page.request.delete(`/api/v1/software/${softwareId}/assignments/${seatId}`, {
      headers,
    });
    expect(released.ok()).toBe(true);

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole('tab', { name: /Lịch sử/ }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText(`Gán license LIC-E2E-TL-${stamp} vào máy`)).toBeVisible();
    await expect(panel.getByText(`Gỡ license LIC-E2E-TL-${stamp} khỏi máy`)).toBeVisible();

    const chips = page.getByRole('group', { name: 'Lọc lịch sử theo nguồn' });
    await chips.getByRole('button', { name: 'IP', exact: true }).click();
    await expect(panel.getByText(`Gán license LIC-E2E-TL-${stamp} vào máy`)).toHaveCount(0);
    await chips.getByRole('button', { name: 'Hồ sơ · Cổng' }).click();
    await expect(panel.getByText(`Gán license LIC-E2E-TL-${stamp} vào máy`)).toHaveCount(0);
    await chips.getByRole('button', { name: 'License', exact: true }).click();
    await expect(panel.getByText(`Gỡ license LIC-E2E-TL-${stamp} khỏi máy`)).toBeVisible();
  });
});
