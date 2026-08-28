import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  resetDevices,
  resetIpam,
  resetUsers,
  rowAction,
} from './helpers';

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

/** Story 5.1 — FR-018/FR-019/FR-020: dải mạng, hồ sơ IP, mức sử dụng. */
test.describe('Dải mạng và hồ sơ IP', () => {
  test('đường hạnh phúc: khai dải → thấy ô trống → cấp IP → mức sử dụng đổi theo', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    // /29 cho 6 địa chỉ cấp được — đủ để kiểm mà bảng không dài 254 dòng.
    const cidr = `172.16.${Number(stamp) % 200}.0/29`;

    await page.goto('/ip-addresses');
    await page.getByRole('button', { name: 'Khai dải mới' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Dải' }).fill(cidr);
    await form.getByRole('textbox', { name: 'Tên gọi' }).fill(`LAN thử E2E ${stamp}`);
    await form.getByRole('button', { name: 'Lưu' }).click();

    // Dải mới nằm ở CỘT TRÁI dưới dạng thẻ, không phải một dòng bảng (mockup body-Ipam.html).
    const card = page.getByRole('link', { name: new RegExp(`LAN thử E2E ${stamp}`) });
    await expect(card).toBeVisible();
    // /29 = 8 địa chỉ, trừ địa chỉ mạng và quảng bá còn 6.
    await expect(card.getByText('0% · 0/6 · còn 6')).toBeVisible();

    await card.click();
    await expect(page.getByRole('heading', { name: new RegExp(cidr) })).toBeVisible();

    // Ô trống hiện sẵn trong bảng, không giấu sau nút "thêm".
    await expect(page.getByRole('button', { name: 'Cấp IP này' })).toHaveCount(6);

    await page.getByRole('button', { name: 'Cấp IP này' }).first().click();
    const ipForm = page.getByRole('dialog');
    await ipForm.getByRole('combobox', { name: 'Người / bộ phận dùng' }).fill('Chị Lan — Kế toán');
    await ipForm.getByRole('button', { name: 'Lưu' }).click();

    await expect(page.getByText('Chị Lan — Kế toán')).toBeVisible();
    await expect(page.getByText('17% · 1/6 · còn 5')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cấp IP này' })).toHaveCount(5);
  });

  /**
   * Màn Địa chỉ IP là MỘT trang hai cột (mockup `body-Ipam.html`): dải bên trái, IP của dải
   * đang chọn bên phải.
   *
   * Bản dựng đầu tách hai trang và đường đi giữa chúng là mã CIDR gạch chân trong ô đầu bảng
   * — không ai nhận ra đó là đường vào, nên cả màn trông như "khai được dải mà không khai
   * được IP nào". Bài này khoá lại đúng chuyện đó: bấm một thẻ dải là bảng IP đổi theo, ngay
   * trên cùng một trang.
   */
  test('hai cột: bấm thẻ dải bên trái thì bảng IP bên phải đổi theo', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 150;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };

    // Hai dải, mỗi dải một số VLAN — badge VLAN là thứ mockup vẽ ngay trên thẻ.
    const first = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.16.${octet}.0/29`, name: `LAN A E2E ${stamp}`, vlan: 20 },
    });
    const firstId = ((await first.json()) as { id: string }).id;
    await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.16.${octet + 1}.0/29`, name: `LAN B E2E ${stamp}`, vlan: 30 },
    });
    await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId: firstId, address: `172.16.${octet}.1`, usedBy: 'Máy A của dải A' },
    });

    await page.goto(`/ip-addresses/${firstId}`);
    // Badge VLAN trên thẻ: ở PMH người ta gọi dải theo VLAN chứ không theo CIDR.
    await expect(page.getByText('VLAN 20')).toBeVisible();
    await expect(page.getByText('VLAN 30')).toBeVisible();
    await expect(page.getByText('Máy A của dải A')).toBeVisible();

    // Bấm thẻ dải B → cột phải đổi, KHÔNG rời trang.
    await page.getByRole('link', { name: new RegExp(`LAN B E2E ${stamp}`) }).click();
    await expect(
      page.getByRole('heading', { name: new RegExp(`172.16.${octet + 1}.0/29`) }),
    ).toBeVisible();
    await expect(page.getByText('Máy A của dải A')).toHaveCount(0);
    // Dải B chưa cấp IP nào → 6 ô trống, mỗi ô một nút cấp.
    await expect(page.getByRole('button', { name: 'Cấp IP này' })).toHaveCount(6);
  });

  /**
   * Bộ lọc trạng thái có nhánh "Trống" — thay ô tick "chỉ hiện IP đã cấp" cũ.
   *
   * Ô tick chỉ mở/đóng được MỘT trạng thái, nên câu hỏi hay gặp thứ hai khi cắm máy — "còn
   * chỗ nào trống" — vẫn phải tự dò bằng mắt giữa 254 dòng.
   */
  test('lọc trạng thái: xem riêng ô trống, xem riêng IP đang cấp', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = (Number(stamp) % 150) + 40;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN lọc E2E ${stamp}`);
    await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId, address: `172.16.${octet}.1`, usedBy: 'Chị Lan — Kế toán' },
    });

    await page.goto(`/ip-addresses/${subnetId}`);
    // Mặc định "Tất cả": 1 IP đã cấp + 5 ô trống.
    await expect(page.getByRole('button', { name: 'Cấp IP này' })).toHaveCount(5);
    await expect(page.getByText('Chị Lan — Kế toán')).toBeVisible();

    // Nhãn nút lọc mang luôn con số của CẢ dải ("Đang cấp 1"), nên bám theo tiền tố.
    await page.getByRole('button', { name: /^Đang cấp/ }).click();
    await expect(page.getByRole('button', { name: 'Cấp IP này' })).toHaveCount(0);
    await expect(page.getByText('Chị Lan — Kế toán')).toBeVisible();

    await page.getByRole('button', { name: /^Trống/ }).click();
    await expect(page.getByRole('button', { name: 'Cấp IP này' })).toHaveCount(5);
    await expect(page.getByText('Chị Lan — Kế toán')).toHaveCount(0);
  });

  /** VLAN ngoài dải 802.1Q (1–4094) bị chặn ở SERVER, không chỉ ở ô nhập. */
  test('đường hỏng: số VLAN ngoài 1–4094 bị từ chối', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = (Number(stamp) % 150) + 60;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };

    for (const vlan of [0, 4095, 9999]) {
      const res = await page.request.post('/api/v1/ipam/subnets', {
        headers,
        data: { cidr: `172.16.${octet}.0/29`, name: `LAN vlan E2E ${stamp}`, vlan },
      });
      expect(res.status(), `phải bị từ chối: VLAN ${vlan}`).toBe(400);
    }
  });

  /**
   * AC 5.1: "IP trùng trong cùng subnet bị CHẶN tuyệt đối (unique constraint tầng DB)".
   * Gọi thẳng API và bắn hai request để chắc chắn hàng rào nằm ở DB chứ không phải ở một
   * câu `if` trong service — câu `if` thì hai request vào cùng lúc là lọt cả hai.
   */
  test('đường hỏng: cấp trùng IP trong cùng dải bị chặn ở tầng DB', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN trùng E2E ${stamp}`);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
    const body = { subnetId, address: `172.16.${octet}.1`, usedBy: 'máy A' };

    const [first, second] = await Promise.all([
      page.request.post('/api/v1/ipam/addresses', { headers, data: body }),
      page.request.post('/api/v1/ipam/addresses', {
        headers,
        data: { ...body, usedBy: 'máy B' },
      }),
    ]);

    const statuses = [first.status(), second.status()].sort();
    expect(statuses).toEqual([201, 409]);
    const failed = first.status() === 409 ? first : second;
    expect(await failed.json()).toMatchObject({ code: 'IP_TAKEN' });
  });

  test('đường hỏng: IP ngoài dải, địa chỉ mạng và địa chỉ quảng bá đều bị từ chối', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN biên E2E ${stamp}`);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };

    for (const address of [
      `172.16.${octet}.9`, // ngoài dải /29
      '10.0.0.1', // khác hẳn dải
      `172.16.${octet}.0`, // địa chỉ mạng — trong dải nhưng KHÔNG cấp được
      `172.16.${octet}.7`, // địa chỉ quảng bá
    ]) {
      const res = await page.request.post('/api/v1/ipam/addresses', {
        headers,
        data: { subnetId, address, usedBy: 'thử' },
      });
      expect(res.status(), `phải bị từ chối: ${address}`).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'IP_OUT_OF_SUBNET' });
    }
  });

  test('đường hỏng: dải gõ sai được giải thích tử tế, không phải lỗi 500', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };

    for (const [cidr, code] of [
      ['172.16.10.0', 'SUBNET_INVALID'],
      ['172.16.10.0/33', 'SUBNET_INVALID'],
      ['10.0.0.0/7', 'SUBNET_INVALID'],
      // Trần /24 (quyết định 25/08/2026): /16 là kiểu gõ nhầm dễ xảy ra nhất và tốn nhất —
      // 65.534 dòng dựng một lượt ở màn chi tiết dải.
      ['172.16.0.0/16', 'SUBNET_INVALID'],
      ['172.16.0.0/23', 'SUBNET_INVALID'],
      ['fe80::/64', 'SUBNET_INVALID'],
    ]) {
      const res = await page.request.post('/api/v1/ipam/subnets', {
        headers,
        data: { cidr, name: 'sai E2E' },
      });
      expect(res.status(), `phải bị từ chối: ${cidr}`).toBe(400);
      expect(await res.json()).toMatchObject({ code });
    }

    // Dải rộng quá mức phải CHỈ ĐƯỜNG (chia thành nhiều /24), không chỉ nói "không hợp lệ".
    const wide = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: '10.0.0.0/7', name: 'rộng E2E' },
    });
    const wideMessage = ((await wide.json()) as { message: string }).message;
    expect(wideMessage).toContain('/24');
    expect(wideMessage).toContain('chia thành nhiều');
  });

  test('gõ IP bất kỳ kèm /24 thì tự quy về địa chỉ mạng, không đẻ ra hai dải cho một dải', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };

    const first = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.16.${octet}.37/24`, name: `LAN quy chuẩn E2E ${stamp}` },
    });
    expect(first.status()).toBe(201);
    expect((await first.json()) as { cidr: string }).toMatchObject({
      cidr: `172.16.${octet}.0/24`,
    });

    // Người thứ hai gõ đúng địa chỉ mạng → phải bị coi là TRÙNG, không tạo dải thứ hai.
    const second = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: `172.16.${octet}.0/24`, name: `LAN trùng E2E ${stamp}` },
    });
    expect(second.status()).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'SUBNET_TAKEN' });
  });

  /**
   * Hai cửa khác nhau cho hai việc khác nhau (quyết định 2026-08-27):
   *
   *  - `PATCH :id/void` — vô hiệu hóa kèm LÝ DO, cho dải đã từng dùng. Bản ghi ở lại.
   *  - `DELETE :id`      — xóa HẲN, chỉ cho dải CHƯA TỪNG có hồ sơ IP nào.
   *
   * Trước đây `DELETE` thực ra là ẩn — một cái bẫy cho bất cứ ai đọc route mà không đọc
   * service. Giờ mỗi route mang đúng nghĩa của nó.
   */
  test('vô hiệu hóa dải phải có lý do, và ẩn luôn mọi IP bên trong', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN ẩn E2E ${stamp}`);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };

    const noReason = await page.request.patch(`/api/v1/ipam/subnets/${subnetId}/void`, {
      headers,
      data: { reason: '' },
    });
    expect(noReason.status()).toBe(400);

    /*
     * Dải còn hồ sơ IP thì vô hiệu hóa vẫn CHẠY, và ẩn luôn mọi IP bên trong cùng một lý do
     * (28/08/2026).
     *
     * Bản trước từ chối và bắt đi ẩn tay từng địa chỉ — với một dải /24 đã dùng một nửa thì
     * đó là hơn trăm lượt bấm cho một quyết định đã ra rồi, nên không ai làm và dải hỏng cứ
     * nằm đó. Ẩn chứ KHÔNG xóa: `ip_history` vẫn trỏ vào những hàng đó.
     */
    const created = await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId, address: `172.16.${octet}.1`, usedBy: 'máy A' },
    });
    expect(created.status()).toBe(201);
    const ipId = ((await created.json()) as { id: string }).id;

    const hasIps = await page.request.patch(`/api/v1/ipam/subnets/${subnetId}/void`, {
      headers,
      data: { reason: 'khai nhầm dải' },
    });
    expect(hasIps.status()).toBe(200);

    /*
     * Dải Ở LẠI, mang dấu vô hiệu hóa (28/08/2026) — trước đó nó biến mất khỏi mọi đường đọc,
     * và người dùng đọc đúng cái đó là "đã bị xóa hẳn".
     */
    const still = await page.request.get(`/api/v1/ipam/subnets/${subnetId}`);
    expect(still.status()).toBe(200);
    expect(((await still.json()) as { voidedAt: string | null }).voidedAt).not.toBeNull();

    // Nhưng KHÔNG nằm trong danh sách mặc định: mọi chỗ khác hỏi "dải nào đang dùng".
    const alive = (await (await page.request.get('/api/v1/ipam/subnets')).json()) as {
      id: string;
    }[];
    expect(alive.some((row) => row.id === subnetId)).toBe(false);
    // Chỉ màn dải mạng bật cờ mới thấy.
    const withVoided = (await (
      await page.request.get('/api/v1/ipam/subnets?includeVoided=true')
    ).json()) as { id: string }[];
    expect(withVoided.some((row) => row.id === subnetId)).toBe(true);

    // Hồ sơ IP thì đã ẩn — tra lẻ từng cái là đường GHI, phải từ chối.
    expect((await page.request.get(`/api/v1/ipam/addresses/${ipId}`)).status()).toBe(404);
    /*
     * NHƯNG bảng của chính dải đó vẫn hiện nguyên chúng. Đây là điểm quan trọng nhất của cả
     * thay đổi: mấy cái máy ngoài kia không tự nhả IP tĩnh ra chỉ vì cuốn sổ cất dải đi, nên
     * vẽ 6 ô "Trống" là nói với người đọc rằng cấp lại được — sai, và sai theo hướng gây ra
     * xung đột IP thật.
     */
    const slots = (await (
      await page.request.get(`/api/v1/ipam/subnets/${subnetId}/addresses`)
    ).json()) as { kind: string; address: string }[];
    const mine = slots.find((slot) => slot.address === `172.16.${octet}.1`);
    expect(mine?.kind).toBe('record');

    /* Nhưng LỊCH SỬ vẫn còn — đó là chỗ trả lời "IP này từng của ai" mà AC 5.2 bắt giữ vĩnh
       viễn, và dòng cuối phải nói rõ nó bị ẩn THEO DẢI nào chứ không biến mất im lặng. */
    const history = await page.request.get(`/api/v1/ipam/addresses/${ipId}/history`);
    expect(history.status()).toBe(200);
    const rows = (await history.json()) as { changes: Record<string, unknown> | null }[];
    expect(
      rows.some((row) => String(row.changes?.reason ?? '').includes('khai nhầm dải')),
    ).toBe(true);
  });

  /**
   * Vô hiệu hóa KHÔNG được trông như đã xóa (phiếu người dùng 28/08/2026).
   *
   * Trước đây bấm "Vô hiệu hóa" là thẻ dải biến mất khỏi cột trái, và không còn chỗ nào trên
   * giao diện nói nó tồn tại — nên người dùng đọc ra "đã xóa hẳn". Nhưng dải đó vẫn giữ mấy
   * chục hồ sơ IP TĨNH, và mấy cái máy ngoài kia không nhả địa chỉ ra chỉ vì cuốn sổ cất dải
   * đi. Giờ nó ở lại, gạch ngang, xem được, bật lại được — rồi mới tới chuyện xóa.
   */
  test('vô hiệu hóa: dải Ở LẠI danh sách và gạch ngang, bật lại thì IP bên trong sống lại', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const cidr = `172.16.${octet}.0/29`;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
    const subnetId = await createSubnet(page, cidr, `LAN tắt-bật E2E ${stamp}`);

    // Hai hồ sơ IP: một cái sẽ tắt THEO DẢI, một cái bị xóa lẻ TRƯỚC đó vì lý do riêng.
    const keep = await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId, address: `172.16.${octet}.1`, usedBy: 'Máy chủ file' },
    });
    const gone = await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId, address: `172.16.${octet}.2`, usedBy: 'gõ nhầm' },
    });
    expect(gone.status()).toBe(201);
    const goneId = ((await gone.json()) as { id: string }).id;
    expect(keep.status()).toBe(201);
    expect(
      (
        await page.request.delete(`/api/v1/ipam/addresses/${goneId}`, {
          headers,
          data: { reason: 'gõ nhầm địa chỉ' },
        })
      ).status(),
    ).toBe(200);

    await page.goto(`/ip-addresses/${subnetId}`);
    await rowAction(page, cidr, 'Vô hiệu hóa');
    const off = page.getByRole('dialog');
    await off.getByRole('textbox', { name: 'Lý do' }).fill('gộp sang VLAN mới');
    await off.getByRole('button', { name: 'Vô hiệu hóa' }).click();
    await expect(page.getByText('Đã vô hiệu hóa dải.')).toBeVisible();

    /*
     * Thẻ dải VẪN ĐỨNG ĐÓ, mang huy hiệu và nói rõ vì sao — không biến mất.
     *
     * Bám vào ĐÚNG thẻ của dải này, không phải chữ "Đã vô hiệu hóa" bất kỳ: cột trái giờ
     * hiện cả những dải đã tắt từ các lần chạy trước, nên khớp lỏng là trúng nhiều thẻ.
     */
    const card = page.getByRole('link', { name: new RegExp(cidr.replace(/\./g, '\.')) });
    await expect(card.getByText('Đã vô hiệu hóa', { exact: true })).toBeVisible();
    await expect(card.getByText(/gộp sang VLAN mới/)).toBeVisible();

    // Bảng IP vẫn hiện hồ sơ cũ — địa chỉ KHÔNG được vẽ thành ô trống sẵn sàng cấp lại.
    await expect(page.getByText('Máy chủ file')).toBeVisible();
    // Không một ô nào của dải đã tắt được mời cấp — kể cả những địa chỉ chưa ai dùng.
    await expect(page.getByRole('button', { name: 'Cấp IP này' })).toHaveCount(0);
    await expect(page.getByText(/Dải này đã vô hiệu hóa/)).toBeVisible();

    // Bật lại: dải sống lại, và ĐÚNG hồ sơ đã tắt cùng nó cũng vậy.
    await rowAction(page, cidr, 'Bật lại');
    await page.getByRole('dialog').getByRole('button', { name: 'Bật lại' }).click();
    await expect(page.getByText('Đã bật lại dải.')).toBeVisible();
    await expect(card.getByText('Đã vô hiệu hóa', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Máy chủ file')).toBeVisible();

    /*
     * Hồ sơ bị xóa LẺ trước đó thì KHÔNG sống lại — nó đã xóa vì lý do riêng ("gõ nhầm địa
     * chỉ"), bật lại dải mà kéo theo cả nó là trả về một cuốn sổ khác cuốn lúc tắt.
     */
    const slots = (await (
      await page.request.get(`/api/v1/ipam/subnets/${subnetId}/addresses`)
    ).json()) as { kind: string; address: string }[];
    expect(slots.find((slot) => slot.address === `172.16.${octet}.1`)?.kind).toBe('record');
    expect(slots.find((slot) => slot.address === `172.16.${octet}.2`)?.kind).toBe('free');
  });

  /**
   * Đường hỏng của chính luồng trên: dải đang dùng thì không có gì để bật lại.
   */
  test('đường hỏng: bật lại một dải đang dùng bị từ chối', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN đang dùng E2E ${stamp}`);

    const res = await page.request.patch(`/api/v1/ipam/subnets/${subnetId}/restore`, { headers });
    expect(res.status()).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('SUBNET_NOT_VOIDED');
  });

  /**
   * Xóa hẳn dải khai nhầm — và CHỈ khi nó chưa từng được dùng.
   *
   * Ranh giới nằm ở TỔNG số hàng `ip_address`, không phải số IP đang chiếm chỗ: một hàng đã
   * thu hồi vẫn đang giữ câu trả lời "IP này từng của máy nào" mà AC 5.2 bắt giữ vĩnh viễn.
   * Thu hồi IP xong tưởng dải đã sạch rồi xóa hẳn là mất luôn khúc lịch sử đó.
   */
  test('xóa hẳn dải chưa dùng; dải đã từng có IP thì bị chặn kèm số hồ sơ', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };

    // 1. Dải trắng tinh → xóa hẳn được, và sau đó khai LẠI đúng dải đó cũng được.
    const clean = await createSubnet(page, `172.16.${octet}.0/29`, `LAN xóa E2E ${stamp}`);
    const removed = await page.request.delete(`/api/v1/ipam/subnets/${clean}`, { headers });
    expect(removed.status()).toBe(200);
    expect((await page.request.get(`/api/v1/ipam/subnets/${clean}`)).status()).toBe(404);
    const again = await createSubnet(page, `172.16.${octet}.0/29`, `LAN khai lại E2E ${stamp}`);
    expect(again).toBeTruthy();

    // 2. Dải đã có IP — kể cả khi IP đó đã thu hồi — thì KHÔNG xóa hẳn được.
    const created = await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId: again, address: `172.16.${octet}.1`, usedBy: 'máy A' },
    });
    expect(created.status()).toBe(201);
    const ipId = ((await created.json()) as { id: string }).id;
    const released = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers,
      data: { to: 'reclaimed', reason: 'máy nghỉ' },
    });
    expect(released.status()).toBe(201);

    const blocked = await page.request.delete(`/api/v1/ipam/subnets/${again}`, { headers });
    expect(blocked.status()).toBe(409);
    const body = (await blocked.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'SUBNET_HAS_ADDRESSES', addresses: 1 });
    // Câu báo phải chỉ sang đường còn lại, không để người dùng đứng đó không biết làm gì.
    expect(String(body.message)).toContain('Vô hiệu hóa');
  });

  /**
   * Gateway (0035) — thứ người ta hỏi đầu tiên khi khai IP tĩnh, mà thẻ dải trước đây không
   * có chỗ nào để ghi. Nằm ngoài chính dải của nó là cấu hình sai mà nhìn vẫn thấy hợp lệ.
   */
  test('gateway phải nằm trong chính dải của nó', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };

    const outside = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: {
        cidr: `172.16.${octet}.0/24`,
        name: `LAN GW E2E ${stamp}`,
        gateway: '10.0.0.1',
      },
    });
    expect(outside.status()).toBe(400);
    expect(await outside.json()).toMatchObject({ code: 'GATEWAY_OUT_OF_SUBNET' });

    const ok = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: {
        cidr: `172.16.${octet}.0/24`,
        name: `LAN GW E2E ${stamp}`,
        gateway: `172.16.${octet}.1`,
      },
    });
    expect(ok.status()).toBe(201);
    const id = ((await ok.json()) as { id: string }).id;
    expect((await (await page.request.get(`/api/v1/ipam/subnets/${id}`)).json())).toMatchObject({
      gateway: `172.16.${octet}.1`,
    });

    // Ô để trống là ý định rõ ràng ("dải này không có gateway"), không phải lỗi.
    const cleared = await page.request.patch(`/api/v1/ipam/subnets/${id}`, {
      headers,
      data: { gateway: '' },
    });
    expect(cleared.status()).toBe(200);
    expect((await cleared.json()) as { gateway: string | null }).toMatchObject({ gateway: null });
  });

  test('Member cấp được IP nhưng không khai được dải', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = Number(stamp) % 200;
    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN quyền E2E ${stamp}`);
    await page.getByRole('button', { name: 'Đăng xuất' }).click();

    await firstLogin(page, E2E_MEMBER);
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };

    // Người cắm máy chính là người biết IP nào vừa cấp — bắt chờ Admin duyệt thì cuốn sổ
    // sẽ quay về file Excel trên máy ai đó.
    const assigned = await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId, address: `172.16.${octet}.2`, usedBy: 'máy Member' },
    });
    expect(assigned.status()).toBe(201);

    // Nhưng khai dải thì không: dải sai kéo theo mọi IP bên trong sai.
    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers,
      data: { cidr: '192.168.99.0/24', name: 'Member khai E2E' },
    });
    expect(subnet.status()).toBe(403);
  });
});

/**
 * Hai lỗi người dùng bắt được ngày 28/08/2026, cùng một họ: bảng và con số nói ngược nhau.
 */
test.describe('Hồ sơ IP — trạng thái phải khớp với chủ', () => {
  test('gán máy vào một IP đang TRỐNG thì nó thành ĐANG CẤP, không ở lại "Trống"', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = (Number(stamp) % 150) + 20;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN gán E2E ${stamp}`);

    // Hồ sơ tạo KHÔNG có chủ → 'free', đúng.
    const created = await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId, address: `172.16.${octet}.1`, note: 'để dành' },
    });
    expect(created.status()).toBe(201);
    const ipId = ((await created.json()) as { id: string }).id;
    expect(((await created.json()) as { status?: string }).status ?? 'free').toBe('free');

    /*
     * Rồi SỬA để gán người dùng. Bản trước giữ nguyên `status='free'`: bảng hiện một hàng vừa
     * có tên chủ vừa mang badge "Trống", còn nút lọc phía trên đếm "Đang cấp 0" — và cả hai
     * đều đúng theo dữ liệu. Người dùng tưởng đã cấp, hệ thống vẫn coi là chỗ trống và sẵn
     * sàng cấp lại cho máy khác.
     */
    const updated = await page.request.patch(`/api/v1/ipam/addresses/${ipId}`, {
      headers,
      data: { usedBy: 'Chị Lan — Kế toán' },
    });
    expect(updated.status()).toBe(200);
    expect((await updated.json()) as { status: string }).toMatchObject({ status: 'assigned' });

    // Con số trên màn hình phải đổi theo, không còn "Đang cấp 0".
    await page.goto(`/ip-addresses/${subnetId}`);
    await expect(page.getByRole('button', { name: /^Đang cấp 1/ })).toBeVisible();

    // Và bước chuyển được ghi thành một dòng lịch sử riêng, không lẫn vào "sửa hồ sơ".
    const history = (await (
      await page.request.get(`/api/v1/ipam/addresses/${ipId}/history`)
    ).json()) as { action: string; toStatus: string | null }[];
    expect(history.some((row) => row.toStatus === 'assigned')).toBe(true);
  });

  test('xóa hồ sơ IP khai nhầm: chỗ trống hiện lại, lịch sử vẫn còn', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = (Number(stamp) % 150) + 30;
    const headers = { 'X-CSRF-Token': await csrfOf(page), Origin: 'https://ims.pmh.com.vn' };
    const subnetId = await createSubnet(page, `172.16.${octet}.0/29`, `LAN xoá IP E2E ${stamp}`);
    const created = await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId, address: `172.16.${octet}.2`, usedBy: 'gõ nhầm' },
    });
    const ipId = ((await created.json()) as { id: string }).id;

    await page.goto(`/ip-addresses/${subnetId}`);
    const row = page.getByRole('row', { name: new RegExp(`172\.16\.${octet}\.2`) });
    await rowAction(page, `172.16.${octet}.2`, 'Xóa');
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Lý do' }).fill('gõ nhầm địa chỉ');
    await form.getByRole('button', { name: 'Xóa' }).click();

    await expect(page.getByText('Đã xóa hồ sơ IP.')).toBeVisible();
    // Địa chỉ trở lại thành chỗ TRỐNG, có nút cấp — chứ không nằm lại trong sổ vĩnh viễn.
    await expect(
      page.getByRole('row', { name: new RegExp(`172\.16\.${octet}\.2`) })
        .getByRole('button', { name: 'Cấp IP này' }),
    ).toBeVisible();

    // Lịch sử của hồ sơ đã ẩn VẪN đọc được — đó mới là lúc người ta cần đọc nó.
    const history = await page.request.get(`/api/v1/ipam/addresses/${ipId}/history`);
    expect(history.status()).toBe(200);
  });
});
