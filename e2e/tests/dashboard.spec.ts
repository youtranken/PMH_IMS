import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  NEW_PASSWORD,
  firstLogin,
  isoInDays,
  loginWithTotp,
  logout,
  resetAccessList,
  resetApprovals,
  resetDevices,
  resetIpam,
  resetSecrets,
  resetSoftware,
  resetUsers,
  sql,
} from './helpers';

test.beforeEach(() => {
  resetUsers();
  resetApprovals();
  resetAccessList();
  resetSecrets();
  resetIpam();
  resetDevices();
  resetSoftware();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

/**
 * Story 7.1 — FR-025: mọi số liệu qua public api của module chủ, rút gọn theo vai.
 *
 * Ba khối gốc (sắp hết hạn · sự cố · break-glass) + ba khối thêm 28/08/2026 (dải mạng sắp đầy ·
 * két lâu chưa đổi · vừa vào kho thanh lý). Tất cả dựng trên dữ liệu đã có sẵn — không bảng
 * mới, không cột mới.
 */
test.describe('Bảng điều khiển', () => {
  test('đường hạnh phúc: ba khối hiện đủ, sắp-hết-hạn xếp gấp nhất lên đầu', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    // Hai hồ sơ: một cái hết hạn gấp hơn cái kia.
    await page.request.post('/api/v1/software', {
      headers,
      data: {
        code: `LIC-E2E-DASH-A-${stamp}`,
        name: 'License gấp',
        kind: 'license',
        endDate: isoInDays(3),
      },
    });
    await page.request.post('/api/v1/software', {
      headers,
      data: {
        code: `LIC-E2E-DASH-B-${stamp}`,
        name: 'License thong tha',
        kind: 'license',
        endDate: isoInDays(25),
      },
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();

    const expiring = page.locator('section').filter({ hasText: 'Hạn cần xử lý' });
    await expect(expiring.getByText('License gấp')).toBeVisible();
    await expect(expiring.getByText('License thong tha')).toBeVisible();

    /*
     * Gấp nhất lên đầu — sếp đọc từ trên xuống và thường chỉ đọc mấy dòng đầu.
     *
     * So THỨ TỰ TƯƠNG ĐỐI của hai hồ sơ bài này vừa tạo, KHÔNG đòi "dòng đầu bảng".
     * DB thật có sẵn hồ sơ của người dùng, và một hồ sơ trùng đúng ngày hết hạn là đủ để đẩy
     * dòng của bài kiểm xuống hàng hai — bài đỏ vì dữ liệu hàng xóm chứ không phải vì thứ tự
     * sắp xếp sai, đúng loại đỏ giả làm người ta mất niềm tin vào cả bộ test.
     */
    // Khối là BẢNG gọn ở desktop (DASH-002): mỗi mục là một dòng, cột Loại là tiếng Việt.
    const labels = await expiring.getByRole('row').allInnerTexts();
    const urgent = labels.findIndex((text) => text.includes('License gấp'));
    const relaxed = labels.findIndex((text) => text.includes('License thong tha'));
    expect(urgent).toBeGreaterThanOrEqual(0);
    expect(urgent).toBeLessThan(relaxed);

    /*
     * DÒNG PHỤ PHẢI LÀ TIẾNG VIỆT, KHÔNG PHẢI MÃ MÁY — rà UI/UX 12/09.
     *
     * Bản trước gọi `t('expiry.kind_' + kind, kind)` trong khi `vi.ts` không có khóa
     * `expiry.kind_*` nào, nên i18next lặng lẽ rơi về tham số mặc định: chính cái mã. Khối
     * đầu tiên của màn mở đầu mỗi ngày in ra `license · 27/08/2026`, `warranty · …`.
     *
     * Hỏng theo kiểu khó thấy, và đó mới là điều đáng chốt: `license` trông vừa đủ giống một
     * nhãn để mắt lướt qua. Lượt test tay 12/09 đi qua đúng khối này mà không nhận ra.
     *
     * Chốt CẢ HAI vế. Chỉ đòi "có chữ License phần mềm" thì một bản in ra cả hai
     * (`license License phần mềm`) cũng xanh; chỉ cấm chữ `license` thì một bản in ra ô trống
     * cũng xanh.
     */
    const urgentLine = labels[urgent];
    expect(urgentLine, 'phải hiện nhãn tiếng Việt lấy từ API').toContain('License phần mềm');
    expect(urgentLine, 'không được để lọt mã máy ra cột Loại').not.toMatch(/\blicense\b/);

    // Khối sự cố PHẢI hiện và nói rõ là chưa có phần này (Epic 9 chưa mở).
    const incidents = page.locator('section').filter({ hasText: 'Sự cố tuần qua' });
    await expect(incidents.getByText(/chưa theo dõi/i)).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Yêu cầu mở két tuần qua' })).toBeVisible();
  });

  /**
   * "Chưa có phần này" và "tuần qua không có sự cố nào" là HAI CÂU khác hẳn nhau. Sếp đọc
   * nhầm câu thứ hai thì tưởng mọi thứ đang yên — trong khi hệ thống chưa hề theo dõi mục đó.
   */
  test('khối chưa mở nói rõ là CHƯA THEO DÕI, không phải "không có gì"', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/');

    const incidents = page.locator('section').filter({ hasText: 'Sự cố tuần qua' });
    await expect(incidents.getByText(/CHƯA theo dõi/i)).toBeVisible();
    await expect(incidents.getByText('Tuần qua không có sự cố nào.')).toHaveCount(0);
  });

  test('break-glass tuần qua nói rõ AI, THIẾT BỊ GÌ, lý do', async ({ page }) => {
    const saTotp = await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const typeId = catalog.deviceTypes.find((t) => t.name === 'Switch')!.id;
    const code = `SW-E2E-DASH-${stamp}`;
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: { code, name: 'Switch tầng 3', deviceTypeId: typeId },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;
    await page.request.post('/api/v1/vault/access', {
      headers,
      data: {
        memberEmail: E2E_MEMBER.email,
        scopeType: 'device_type',
        scopeRef: typeId,
        tier: 'needs_approval',
      },
    });
    await logout(page);

    await firstLogin(page, E2E_MEMBER);
    await page.request.post('/api/v1/vault/break-glass', {
      headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        reason: 'switch tầng 3 mất kết nối lúc 2 giờ sáng',
        hours: 4,
      },
    });

    // Member: dashboard RÚT GỌN — không có khối break-glass toàn cục.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Yêu cầu mở két tuần qua' })).toHaveCount(0);
    // DASH-014: người xin thấy ngay yêu cầu của chính mình đang chờ, ở đầu trang.
    const mine = page.locator('section').filter({ hasText: 'Yêu cầu mở két của tôi' });
    await expect(mine.getByText('Chờ duyệt')).toBeVisible();
    await expect(mine.getByRole('link', { name: new RegExp(code) })).toBeVisible();
    const asMember = (await (await page.request.get('/api/v1/dashboard')).json()) as {
      breakGlass: { available: boolean; items: unknown[] };
    };
    expect(asMember.breakGlass.available).toBe(false);
    expect(asMember.breakGlass.items).toEqual([]);
    await logout(page);

    // SA: thấy đủ ba thứ AC đòi — ai, thiết bị gì, lý do. Mã thiết bị chứ không phải uuid.
    // `loginWithTotp` chứ không phải `firstLogin`: tài khoản này đã cài 2 lớp ở đầu bài.
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    await page.goto('/');
    const block = page.locator('section').filter({ hasText: 'Yêu cầu mở két tuần qua' });
    // DASH-006: TÊN người xin (email nằm trong `title`), không phải email trần.
    await expect(block.getByText('E2E Thành viên')).toBeVisible();
    await expect(block.getByText('Chờ duyệt')).toBeVisible();
    await expect(block.getByText(new RegExp(code))).toBeVisible();
    await expect(block.getByText('switch tầng 3 mất kết nối lúc 2 giờ sáng')).toBeVisible();
  });

  /**
   * AD-2: mọi số liệu đi qua public api của module chủ. Không kiểm được "không có SQL chéo"
   * từ ngoài, nhưng kiểm được HỆ QUẢ: nhãn thiết bị phải là mã thật (tra qua `devices.api`),
   * và dashboard vẫn dựng được khi một module không có dữ liệu nào.
   */
  test('dashboard trống vẫn dựng được, không lỗi', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeVisible();

    /**
     * Khối "Sắp hết hạn" chỉ kiểm là DỰNG ĐƯỢC, không kiểm là rỗng.
     *
     * Các hàm reset chỉ xóa dữ liệu mang dấu "E2E" — cố ý như vậy để bài kiểm không bao giờ
     * chạm vào dữ liệu thật trong stack dev. Hệ quả: một hồ sơ ai đó gõ tay lúc bấm thử giao
     * diện, nếu hạn rơi vào 30 ngày tới, sẽ làm khối này có dữ liệu. Bắt nó phải rỗng là bắt
     * cả cái DB dev phải sạch — điều kiện không đời nào giữ được, và khi vỡ thì báo sai chỗ.
     */
    await expect(page.getByRole('heading', { name: 'Hạn cần xử lý' })).toBeVisible();
    await expect(
      page.getByText('Không tải được khối này. Các khối còn lại vẫn đúng.'),
    ).toHaveCount(0);

    // Hai khối này thì reset kiểm soát được TRỌN VẸN, nên vẫn bắt đúng chữ trạng thái rỗng —
    // đó là chỗ thật sự kiểm được nhánh "không có dữ liệu" của BlockCard.
    await expect(page.getByText('Tuần qua không ai xin quyền xem tạm thời.')).toBeVisible();
  });

  /**
   * Khối "Dải mạng sắp đầy" (28/08/2026).
   *
   * Câu này trước đây chỉ trả lời được bằng cách mở màn IP rồi đọc từng thanh tiến trình — mà
   * không ai mở màn IP khi chưa có việc, nên dải đầy dần trong im lặng cho tới hôm cần cấp gấp
   * một địa chỉ thì không còn.
   */
  test('dải mạng chạm ngưỡng thì lên bảng, kèm số chỗ CÒN LẠI chứ không chỉ phần trăm', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
    const octet = (Number(stamp) % 200) + 30;

    /*
     * /30 cho đúng 2 địa chỉ cấp được (network và broadcast trừ ra). Cấp cả hai là 100% —
     * chắc chắn vượt ngưỡng 80 mà chỉ mất hai lượt gọi để dựng.
     */
    const created = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.16.${octet}.0/30`, name: `LAN chat cho E2E ${stamp}` },
    });
    expect(created.status()).toBe(201);
    const subnetId = ((await created.json()) as { id: string }).id;

    for (const last of [1, 2]) {
      const address = await page.request.post('/api/v1/ipam/addresses', {
        headers,
        data: { subnetId, address: `172.16.${octet}.${last}`, usedBy: `Máy ${last}` },
      });
      expect(address.status()).toBe(201);
    }

    await page.goto('/');
    // Tiêu đề nói luôn ngưỡng đang áp: "Dải mạng ≥ 80%" (DASH-016).
    const block = page.locator('section').filter({ hasText: /Dải mạng ≥ \d+%/ });
    await expect(block.getByRole('link', { name: `LAN chat cho E2E ${stamp}` })).toBeVisible();

    /*
     * "còn 0" mới là con số người ta hành động theo. 95% của một /26 là còn 3 chỗ, 95% của một
     * /24 là còn 12 — hai mức khẩn khác hẳn nhau mà cùng một phần trăm.
     */
    await expect(block.getByText('100% · đã cấp 2/2 · còn 0')).toBeVisible();
  });

  /**
   * Khối "Két lâu chưa đổi" — CHỈ SA/Admin, đúng bằng quyền của `GET /vault/owners`.
   *
   * Cắt ở tầng service chứ không để web ẩn khối đi: ẩn ở web thì bản đồ "công ty giữ bí mật ở
   * đâu" vẫn đi qua dây và Member mở tab mạng ra là đọc được.
   */
  test('két lâu chưa đổi: SA thấy ngăn cũ, Member không nhận khối này từ server', async ({
    page,
  }) => {
    const saTotp = await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const typeId = catalog.deviceTypes.find((type) => type.name === 'Switch')!.id;
    const code = `SW-E2E-STALE-${stamp}`;
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: { code, name: 'Switch phòng máy', deviceTypeId: typeId },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    // Nhãn phải mang chữ "E2E" thì `resetSecrets` mới dọn được ở lần chạy sau.
    const secret = await page.request.post('/api/v1/vault/secrets', {
      headers,
      data: {
        ownerType: 'device',
        ownerId: deviceId,
        kind: 'password',
        label: `Mat khau admin E2E ${stamp}`,
        value: 'Qw3rty!@#Manh2026',
      },
    });
    expect(secret.status()).toBe(201);

    /*
     * Lùi ngày đổi bằng SQL: không có đường API nào đặt `updated_at` về quá khứ, và chờ 180
     * ngày thì không phải là một bài kiểm.
     */
    sql(
      `UPDATE secret SET updated_at = now() - interval '400 days' WHERE owner_id = '${deviceId}'`,
    );

    await page.goto('/');
    const block = page.locator('section').filter({ hasText: 'Két lâu chưa đổi' });
    await expect(block.getByRole('link', { name: code })).toBeVisible();
    await expect(block.getByText(/400 ngày trước/)).toBeVisible();

    /*
     * Khối nói "hồ sơ nào có két, mấy ngăn" — KHÔNG nói trong đó cất gì. Nhãn ngăn không được
     * lọt ra đây (FR-026): một hôm ai đó thấy "hiện luôn tên ngăn cho tiện" là bản đồ bí mật
     * của công ty ra đời.
     */
    await expect(block.getByText(`Mat khau admin E2E ${stamp}`)).toHaveCount(0);
    await expect(block.getByText('1 ngăn')).toBeVisible();

    await logout(page);

    // Member: khối KHÔNG có trên màn, và cũng không có trong dữ liệu server trả về.
    await firstLogin(page, E2E_MEMBER);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Két lâu chưa đổi' })).toHaveCount(0);
    const asMember = (await (await page.request.get('/api/v1/dashboard')).json()) as {
      staleSecrets: { available: boolean; items: unknown[] };
    };
    expect(asMember.staleSecrets.available).toBe(false);
    expect(asMember.staleSecrets.items).toEqual([]);
    await logout(page);

    // SA quay lại: `loginWithTotp` chứ không phải `firstLogin` — tài khoản đã cài 2 lớp.
    await loginWithTotp(page, E2E_SA.email, NEW_PASSWORD, saTotp);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Két lâu chưa đổi' })).toBeVisible();
  });

  /** Khối "Vừa vào kho thanh lý" — đọc qua `disposal.api`, không tự gộp ba module lại lần nữa. */
  test('thiết bị vừa thanh lý hiện ngay ở khối kho thanh lý', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };

    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const typeId = catalog.deviceTypes.find((type) => type.name === 'PC')!.id;
    const code = `PC-E2E-DASHDIS-${stamp}`;
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: { code, name: 'Máy bàn cũ', deviceTypeId: typeId },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

    await page.goto('/');
    const block = page.locator('section').filter({ hasText: 'Vừa vào kho thanh lý' });
    // Chưa thanh lý thì chưa được có mặt — nếu không, bài dưới xanh vì lý do khác.
    await expect(block.getByRole('link', { name: code })).toHaveCount(0);

    expect(
      (
        await page.request.patch(`/api/v1/devices/${deviceId}/status`, {
          headers,
          data: { status: 'retired' },
        })
      ).status(),
    ).toBe(200);

    await page.goto('/');
    await expect(block.getByRole('link', { name: code })).toBeVisible();
    await expect(block.getByText('Máy bàn cũ')).toBeVisible();
  });
});

// `isoInDays` dã chuyển sang `helpers.ts` (24/09) — xem chú thích ở đó về bẫy múi giờ.

/**
 * DASH-002 — khối "Sắp hết hạn" ở làn chính là BẢNG gọn (Đối tượng · Loại · Hết hạn · Còn lại
 * · [Gia hạn]); các khối nhỏ xếp chồng ở làn phụ, không còn khoảng trống chết khi có từ bốn
 * khối trở lên.
 */
test.describe('DASH-002 · khối Sắp hết hạn dạng bảng, hai làn không hở', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  async function seedLoudBoard(page: Page, stamp: string) {
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN };
    const license = await page.request.post('/api/v1/software', {
      headers,
      data: {
        code: `LIC-E2E-D2-${stamp}`,
        name: `License E2E bảng ${stamp}`,
        kind: 'license',
        endDate: isoInDays(4),
      },
    });
    expect(license.status(), await license.text()).toBe(201);

    // Một dải ĐẦY → khối "Dải mạng sắp đầy" có việc.
    const octet = (Number(stamp) % 200) + 20;
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.18.${octet}.0/30`, name: `LAN E2E D2 ${stamp}` },
    });
    expect(subnet.status(), await subnet.text()).toBe(201);
    const subnetId = ((await subnet.json()) as { id: string }).id;
    for (const last of [1, 2]) {
      await page.request.post('/api/v1/ipam/addresses', {
        headers,
        data: { subnetId, address: `172.18.${octet}.${last}`, usedBy: `Máy ${last}` },
      });
    }

    // Một máy vừa thanh lý → khối kho thanh lý có việc.
    const catalog = await page.evaluate(async () => {
      const res = await fetch('/api/v1/catalog', { credentials: 'include' });
      return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
    });
    const typeId = catalog.deviceTypes.find((type) => type.name === 'PC')!.id;
    const device = await page.request.post('/api/v1/devices', {
      headers,
      data: { code: `PC-E2E-D2-${stamp}`, name: 'Máy E2E thanh lý', deviceTypeId: typeId },
    });
    const deviceId = ((await device.json()) as { device: { id: string } }).device.id;
    const retired = await page.request.patch(`/api/v1/devices/${deviceId}/status`, {
      headers,
      data: { status: 'retired' },
    });
    expect(retired.status()).toBe(200);
    return { headers, typeId };
  }

  test('bảng có đủ cột; gia hạn ngay trên dòng; làn phụ xếp chồng sát nhau', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    await seedLoudBoard(page, stamp);

    await page.goto('/');
    const expiring = page.locator('section').filter({ hasText: 'Hạn cần xử lý' });
    for (const name of ['Đối tượng', 'Loại', 'Hết hạn', 'Còn lại']) {
      // Hai nhóm (quá hạn / sắp tới) là hai bảng cùng cột — đọc cột ở bảng đầu.
      await expect(expiring.getByRole('columnheader', { name, exact: true }).first()).toBeVisible();
    }
    const row = expiring.getByRole('row', { name: new RegExp(`License E2E bảng ${stamp}`) });
    await expect(row.getByRole('cell', { name: 'License phần mềm', exact: true })).toBeVisible();

    /* Bố cục: hai làn cùng mép trên, làn phụ nằm HẲN bên phải, và các khối trong làn phụ
       nối nhau sát (khe ≤ 32px) — không còn khoảng trống chết dưới một khối ngắn. */
    const main = (await page.getByTestId('dash-lane-main').boundingBox())!;
    const side = (await page.getByTestId('dash-lane-side').boundingBox())!;
    expect(Math.abs(main.y - side.y), 'hai làn phải cùng mép trên').toBeLessThanOrEqual(2);
    expect(side.x, 'làn phụ phải ở bên phải làn chính').toBeGreaterThanOrEqual(main.x + main.width);
    const cards = page.getByTestId('dash-lane-side').locator('section');
    const count = await cards.count();
    expect(count, 'cần ≥2 khối ở làn phụ (tổng ≥4 khối) để kiểm khoảng trống').toBeGreaterThanOrEqual(
      2,
    );
    expect((await cards.first().boundingBox())!.y - side.y).toBeLessThanOrEqual(2);
    for (let i = 1; i < count; i += 1) {
      const prev = (await cards.nth(i - 1).boundingBox())!;
      const next = (await cards.nth(i).boundingBox())!;
      expect(next.y - (prev.y + prev.height), `khe giữa khối ${i} và ${i + 1}`).toBeLessThanOrEqual(
        32,
      );
      expect(Math.abs(next.x - side.x), 'khối làn phụ không được rơi sang cột khác').toBeLessThanOrEqual(
        1,
      );
    }

    // Gia hạn ngay trên dòng — cùng hộp với màn /expiry.
    await row.getByRole('button', { name: 'Gia hạn', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^Gia hạn — / });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Hạn mới', exact: true }).click();
    await page.getByRole('button', { name: 'Tháng sau' }).click();
    await page.getByRole('button', { name: 'Tháng sau' }).click();
    await page.getByRole('button', { name: /^15 / }).click();
    const renewed = page.waitForResponse((r) => r.url().endsWith('/api/v1/expiry/renew'));
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
    expect((await renewed).status()).toBe(201);
    await expect(page.getByText('Đã gia hạn.')).toBeVisible();
    // Hạn mới xa hơn 30 ngày → mục rời khối, trang chủ tự đọc lại.
    await expect(row).toHaveCount(0);
  });

  test('đường hỏng: bảo hành thiết bị không có nút Gia hạn; chưa chọn ngày thì hộp ở lại', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const { headers, typeId } = await seedLoudBoard(page, stamp);
    const warranty = await page.request.post('/api/v1/devices', {
      headers,
      data: {
        code: `PC-E2E-D2BH-${stamp}`,
        name: 'Máy E2E bảo hành',
        deviceTypeId: typeId,
        warrantyEnd: isoInDays(6),
      },
    });
    expect(warranty.status(), await warranty.text()).toBe(201);

    await page.goto('/');
    const expiring = page.locator('section').filter({ hasText: 'Hạn cần xử lý' });
    const warrantyRow = expiring.getByRole('row', { name: new RegExp(`PC-E2E-D2BH-${stamp}`) });
    await expect(warrantyRow).toBeVisible();
    await expect(warrantyRow.getByRole('button', { name: 'Gia hạn' })).toHaveCount(0);

    const row = expiring.getByRole('row', { name: new RegExp(`License E2E bảng ${stamp}`) });
    await row.getByRole('button', { name: 'Gia hạn', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^Gia hạn — / });
    await dialog.getByTestId('dialog-footer').getByRole('button', { name: 'Gia hạn' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Chọn hạn mới.');
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeVisible();
  });
});
