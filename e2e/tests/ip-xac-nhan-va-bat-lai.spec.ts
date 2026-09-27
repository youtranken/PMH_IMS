import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetIpam, resetUsers, writeHeaders } from './helpers';

/**
 * Hồ sơ IP: thu hồi rồi cấp lại không hồi sinh chủ cũ, và ẩn hồ sơ không phải đường một chiều.
 *
 * ẨN HỒ SƠ PHẢI BẬT LẠI ĐƯỢC. Thiếu cửa đó thì một hồ sơ IP lẻ bấm nhầm biến khỏi mọi màn,
 * `findOne` trả 404 nên cũng không mở ra xem được lý do vừa ghi. Ô `.5` hiện ra là TRỐNG,
 * người khác cấp nó cho máy khác, và lịch sử "IP này từng là máy in kế toán" — thứ AC 5.2 bắt
 * giữ vĩnh viễn — nằm mồ côi dưới một hàng không ai nhìn thấy.
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
    data: { subnetId, address, usedBy: OWNER },
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

test.describe('Hồ sơ IP — cấp lại sau thu hồi, và bật lại sau khi ẩn', () => {
  test('cấp MỚI cho ô trống: ô người dùng rỗng vẫn là rỗng, không giữ lại gì', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const { ipId } = await seed(page);
    const headers = await writeHeaders(page);

    // Thu hồi (assigned → free): chủ cũ đi khỏi, `usedBy` phải bị xóa.
    const reclaimed = await page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
      headers,
      data: { to: 'free', reason: 'may da thanh ly' },
    });
    expect(reclaimed.status()).toBeLessThan(300);
    const freed = (await reclaimed.json()) as { usedBy: string | null; status: string };
    expect(freed.usedBy).toBeNull();
    expect(freed.status).toBe('free');

    // free → assigned với ô rỗng: chủ MỚI dọn vào, chưa biết ai. Không được hồi sinh
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
      data: { subnetId, address, usedBy: 'Phòng Kỹ thuật E2E' },
    });
    expect(retaken.status(), 'ô đã trống nên khai lại phải được').toBeLessThan(300);

    const res = await page.request.post(`/api/v1/ipam/addresses/${ipId}/restore`, { headers });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('IP_TAKEN');
    expect(body.message, 'phải nói rõ phải làm gì tiếp').toContain('hồ sơ kia');
  });
});
