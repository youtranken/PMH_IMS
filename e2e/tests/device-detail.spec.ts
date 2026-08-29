import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { APP_ORIGIN, E2E_SA, firstLogin, resetDevices, resetUsers } from './helpers';

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
    const stamp = Date.now().toString().slice(-6);
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
    for (const name of ['Hồ sơ', 'Port map', 'Giấy tờ', 'Lịch sử']) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }

    /* `.first()`: serial giờ hiện ở HAI chỗ có chủ ý — dòng định danh ngay dưới tiêu đề
       (thứ người ta đọc qua điện thoại cho nhà cung cấp) và ô Serial trong lưới hồ sơ. */
    await expect(page.getByText(`FOC-${code}`).first()).toBeVisible();

    await page.getByRole('tab', { name: 'Port map' }).click();
    await expect(page.getByRole('row', { name: /Gi1\/0\/1/ })).toBeVisible();

    await page.getByRole('tab', { name: 'Giấy tờ' }).click();
    const pdf = join(tmpdir(), `giay-to-${stamp}.pdf`);
    writeFileSync(pdf, '%PDF-1.4\ntrailer<<>>\n');
    await page.getByLabel('Chọn file để đính kèm').setInputFiles(pdf);
    await page.getByRole('button', { name: 'Tải lên' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`giay-to-${stamp}`) })).toBeVisible();

    await page.getByRole('tab', { name: 'Lịch sử' }).click();
    await expect(page.getByText('Tạo hồ sơ')).toBeVisible();
    await expect(page.getByText('Thêm cổng port map')).toBeVisible();
  });

  test('khu mở rộng chưa có module nào đăng ký → API trả rỗng, trang không hiện khối trống', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
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
    const stamp = Date.now().toString().slice(-6);
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
    await expect(page.getByRole('tab', { name: 'Port map' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Hồ sơ', selected: true })).toBeVisible();
  });

  test('mở thiết bị không tồn tại → trang 404 tử tế, không phải khối lỗi đỏ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/devices/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Về trang chủ' })).toBeVisible();
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
    const stamp = Date.now().toString().slice(-6);
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
    const stamp = Date.now().toString().slice(-6);
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
   * Số trên nhãn tab (28/08/2026) — "Giấy tờ 0", "Két sắt 1".
   *
   * Trước đây phải bấm vào từng tab mới biết trong đó có gì, kể cả khi rỗng. Số `0` là một câu
   * trả lời THẬT và vẫn hiện; chỉ khi chưa biết (đang tải, hoặc không có quyền xem két) mới
   * không hiện gì.
   *
   * Đếm ở web qua chính truy vấn mà panel dùng, không phải một endpoint mới: `vault.module` đã
   * import `devices`, nên cho `devices` gọi ngược `vault.api` để đếm là vòng phụ thuộc.
   */
  test('nhãn tab mang sẵn số — không phải bấm vào mới biết trong đó có gì', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const deviceId = await createSwitch(page, `SW-E2E-CNT-${stamp}`);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    await page.goto(`/devices/${deviceId}`);
    // Rỗng vẫn đề 0 — "chưa có gì" khác "chưa biết", và người đọc cần phân biệt được.
    await expect(page.getByRole('tab', { name: 'Giấy tờ 0' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Két sắt 0' })).toBeVisible();

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
    await expect(page.getByRole('tab', { name: 'Két sắt 1' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Giấy tờ 0' })).toBeVisible();

    /*
     * Bấm sang tab là dữ liệu đã nằm sẵn trong cache — số và nội dung panel dùng CHUNG một
     * truy vấn, nên hai chỗ không thể nói hai con số khác nhau.
     */
    await page.getByRole('tab', { name: 'Két sắt 1' }).click();
    await expect(page.getByText(`Mat khau switch E2E ${stamp}`)).toBeVisible();
  });
});
