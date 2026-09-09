import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetIpam, resetUsers, writeHeaders } from './helpers';

/**
 * HAI LỖ MIỀN NGHIỆP VỤ CỦA HỒ SƠ IP (rà soát 07/09, mục 6).
 *
 * 1. "XÁC NHẬN VẪN DÙNG" XÓA MẤT NGƯỜI DÙNG. Hộp thoại mở ra với ô "Người dùng" TRỐNG rồi
 *    gửi `usedBy: ''`, và `'' || null` biến nó thành `null`. Một hành động tên là "xác nhận
 *    vẫn dùng" xóa dòng chữ "Phòng Kế toán" khỏi hồ sơ — im lặng, và `ip_history` ghi lại
 *    việc đó như thể đó là ý người dùng.
 *
 * 2. ẨN HỒ SƠ LÀ ĐƯỜNG MỘT CHIỀU. `SubnetService.restore()` bật lại được cả một DẢI, còn một
 *    hồ sơ IP lẻ bấm nhầm thì không có cửa nào. Nó biến khỏi mọi màn, `findOne` trả 404 nên
 *    cũng không mở ra xem được lý do vừa ghi, và nhãn `'ip.restored'` trong
 *    `ip-history-entries.ts` không đường nào tới được. Ô `.5` hiện ra là TRỐNG, người khác cấp
 *    nó cho máy khác, và lịch sử "IP này từng là máy in kế toán" — thứ AC 5.2 bắt giữ vĩnh
 *    viễn — nằm mồ côi dưới một hàng không ai nhìn thấy.
 */

test.beforeEach(() => {
  resetUsers();
  resetIpam();
});

const OWNER = 'Phòng Kế toán E2E';

/** Dựng một dải + một hồ sơ IP có chủ, trả về id của cả hai. */
async function seed(page: Page): Promise<{ subnetId: string; ipId: string; address: string }> {
  const headers = await writeHeaders(page);
  const stamp = Number(Date.now().toString().slice(-4)) % 200;
  const cidr = `10.${60 + (stamp % 60)}.${stamp}.0/24`;

  const subnet = await page.request.post('/api/v1/ipam/subnets', {
    headers,
    data: { name: `Dai E2E xac nhan ${stamp}`, cidr },
  });
  expect(subnet.status()).toBeLessThan(300);
  const subnetId = ((await subnet.json()) as { id: string }).id;

  const address = cidr.replace('.0/24', '.5');
  const ip = await page.request.post('/api/v1/ipam/addresses', {
    headers,
    data: { subnetId, address, usedBy: OWNER, status: 'assigned' },
  });
  expect(ip.status()).toBeLessThan(300);
  return { subnetId, ipId: ((await ip.json()) as { id: string }).id, address };
}

async function slotsOf(page: Page, subnetId: string, includeVoided = false) {
  const res = await page.request.get(
    `/api/v1/ipam/subnets/${subnetId}/addresses${includeVoided ? '?includeVoided=true' : ''}`,
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as {
    kind: string;
    id?: string;
    address: string;
    usedBy?: string | null;
    voidedAt?: string | null;
  }[];
}

test.describe('Hồ sơ IP — xác nhận vẫn dùng, và bật lại sau khi ẩn', () => {
  test('"Xác nhận vẫn dùng" GIỮ NGUYÊN người dùng dù ô gửi lên rỗng', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const { subnetId, ipId } = await seed(page);
    const headers = await writeHeaders(page);

    const dead = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers,
      data: { to: 'suspect_dead', reason: 'khong ping duoc' },
    });
    expect(dead.status()).toBeLessThan(300);

    /*
     * ĐÂY LÀ CÂU HỎI. Gửi `usedBy: ''` — đúng nguyên văn thứ hộp thoại gửi khi người trực để
     * ô trống. Bản cũ trả về `usedBy: null`.
     */
    const alive = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers,
      data: { to: 'assigned', reason: 'may van song', usedBy: '' },
    });
    expect(alive.status()).toBeLessThan(300);
    expect(
      ((await alive.json()) as { usedBy: string | null }).usedBy,
      'xác nhận vẫn dùng KHÔNG được xóa chủ — máy vẫn là chính nó',
    ).toBe(OWNER);

    const rows = await slotsOf(page, subnetId);
    expect(rows.find((r) => r.id === ipId)?.usedBy).toBe(OWNER);

    /*
     * VẾ ĐỐI CHỨNG, và là vế dễ hỏng nhất: gửi một chủ MỚI thì vẫn phải đổi được. Thiếu vế này
     * thì một bản vá thô bạo (bỏ hẳn `usedBy` khỏi lượt chuyển) sẽ xanh ở trên mà làm hỏng
     * đường "cấp lại cho máy X" — đúng loại hồi quy đợt C đã gây ra một lần.
     */
    const again = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers,
      data: { to: 'suspect_dead', reason: 'lai nghi chet' },
    });
    expect(again.status()).toBeLessThan(300);
    const moved = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers,
      data: { to: 'assigned', reason: 'doi chu', usedBy: 'Phòng Kỹ thuật E2E' },
    });
    expect(moved.status()).toBeLessThan(300);
    expect(((await moved.json()) as { usedBy: string | null }).usedBy).toBe('Phòng Kỹ thuật E2E');
  });

  test('cấp MỚI cho ô trống: ô người dùng rỗng vẫn là rỗng, không giữ lại gì', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const { ipId } = await seed(page);
    const headers = await writeHeaders(page);

    // assigned → reclaimed: chủ cũ đi khỏi, `usedBy` phải bị xóa.
    const reclaimed = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers,
      data: { to: 'reclaimed', reason: 'may da thanh ly' },
    });
    expect(reclaimed.status()).toBeLessThan(300);
    expect(((await reclaimed.json()) as { usedBy: string | null }).usedBy).toBeNull();

    // reclaimed → assigned với ô rỗng: chủ MỚI dọn vào, chưa biết ai. Không được hồi sinh
    // chủ cũ — đó mới đúng là nói dối.
    const relet = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers,
      data: { to: 'assigned', reason: 'cap lai', usedBy: '' },
    });
    expect(relet.status()).toBeLessThan(300);
    expect(((await relet.json()) as { usedBy: string | null }).usedBy).toBeNull();
  });

  test('ẩn hồ sơ rồi BẬT LẠI được — lịch sử nối tiếp, không mồ côi', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const { subnetId, ipId, address } = await seed(page);
    const headers = await writeHeaders(page);

    const hidden = await page.request.delete(`/api/v1/ipam/addresses/${ipId}`, {
      headers,
      data: { reason: 'go nham dia chi' },
    });
    expect(hidden.status()).toBeLessThan(300);

    // Mặc định: ô trở lại thành TRỐNG — đó là toàn bộ ý nghĩa của việc ẩn, giữ nguyên.
    const plain = await slotsOf(page, subnetId);
    expect(plain.find((r) => r.address === address)?.kind).toBe('free');

    // Nhưng phải có đường THẤY nó, nếu không cửa bật lại là một endpoint không ai tới được.
    const withVoided = await slotsOf(page, subnetId, true);
    const found = withVoided.find((r) => r.id === ipId);
    expect(found, 'includeVoided=true phải hiện hồ sơ đã ẩn').toBeTruthy();
    expect(found?.voidedAt, 'phải phân biệt được với hồ sơ đang sống').toBeTruthy();

    const back = await page.request.post(`/api/v1/ipam/addresses/${ipId}/restore`, { headers });
    expect(back.status()).toBeLessThan(300);
    expect(((await back.json()) as { usedBy: string | null }).usedBy).toBe(OWNER);

    const after = await slotsOf(page, subnetId);
    const row = after.find((r) => r.id === ipId);
    expect(row?.kind, 'bật lại xong phải hiện ở danh sách thường').toBe('record');
    expect(row?.voidedAt).toBeNull();

    // Lịch sử NỐI TIẾP: phải có cả dòng ẩn lẫn dòng bật lại, không phải bắt đầu lại từ đầu.
    const history = await page.request.get(`/api/v1/ipam/addresses/${ipId}/history`);
    const actions = ((await history.json()) as { action: string }[]).map((h) => h.action);
    expect(actions).toContain('ip.voided');
    expect(actions, 'nhãn ip.restored phải tới được cho hồ sơ lẻ').toContain('ip.restored');
  });

  test('đường hỏng: bật lại hồ sơ đang hiển thị bị từ chối', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const { ipId } = await seed(page);
    const res = await page.request.post(`/api/v1/ipam/addresses/${ipId}/restore`, {
      headers: await writeHeaders(page),
    });
    expect(res.status()).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('IP_NOT_VOIDED');
  });

  /**
   * Đường hỏng quan trọng nhất: ẩn `.5`, rồi có người khai `.5` mới. Bật lại lúc này sẽ tạo
   * HAI hồ sơ cho cùng một địa chỉ — `ip_address_key` chặn ở tầng DB, và câu trả lời phải là
   * một dòng tiếng Việt đọc được chứ không phải 500.
   */
  test('đường hỏng: địa chỉ đã bị hồ sơ khác chiếm thì không bật lại được', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const { subnetId, ipId, address } = await seed(page);
    const headers = await writeHeaders(page);

    await page.request.delete(`/api/v1/ipam/addresses/${ipId}`, {
      headers,
      data: { reason: 'go nham dia chi' },
    });
    const retaken = await page.request.post('/api/v1/ipam/addresses', {
      headers,
      data: { subnetId, address, usedBy: 'Phòng Kỹ thuật E2E', status: 'assigned' },
    });
    expect(retaken.status(), 'ô đã trống nên khai lại phải được').toBeLessThan(300);

    const res = await page.request.post(`/api/v1/ipam/addresses/${ipId}/restore`, { headers });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('IP_TAKEN');
    expect(body.message, 'phải nói rõ phải làm gì tiếp').toContain('hồ sơ kia');
  });
});
