import { expect, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  resetAccessList,
  resetApprovals,
  resetDevices,
  resetSecrets,
  resetUsers,
  sql,
  writeHeaders,
} from './helpers';

/**
 * `deny` VÀ `revoke` CỦA BREAK-GLASS — hai endpoint GHI chưa từng có bài kiểm nào.
 *
 * ===== VÌ SAO HAI CỬA NÀY, TRONG SỐ MƯỜI HAI =====
 *
 * Rà soát 07/09 đếm ra 12 endpoint ghi không có bài kiểm. `break-glass.spec.ts` phủ kín
 * `request` / `approve` / `cancel` — nhưng hai cửa TỪ CHỐI và THU HỒI thì không, và chúng
 * mới là hai cửa nói "KHÔNG". Một cửa cấp quyền hỏng thì người dùng kêu ngay trong ngày; một
 * cửa TỪ CHỐI hỏng thì không ai kêu cả, vì thứ nó tạo ra là im lặng: người xin không được
 * báo, và quyền vẫn ở đó.
 *
 * `revoke` còn là cửa duy nhất cắt quyền TRƯỚC HẠN — "người xin không còn trực nữa thì không
 * phải chờ hết giờ". Nếu nó chỉ đổi `state` mà không thật sự chặn được lượt xem tiếp theo thì
 * cả cơ chế break-glass mất chân phanh, và cái chân phanh đó là lý do FR-023 dám cấp quyền
 * tạm cho người ngoài danh sách.
 *
 * ===== ĐO BẰNG HAI CON MẮT =====
 *
 * Không chỉ đọc `state` trong DB (một cột dễ đổi mà không kèm hiệu lực), mà kiểm luôn lượt
 * `reveal` KẾ TIẾP của chính người xin. `break-glass.spec.ts` đã dạy đúng bài học này ở chỗ
 * khác: "state vẫn phải là approved — đó chính là điều đang kiểm", vì hết hạn theo ĐỒNG HỒ
 * chứ không theo cột trạng thái.
 */

test.beforeEach(() => {
  resetUsers();
  resetApprovals();
  resetAccessList();
  resetSecrets();
  resetDevices();
});

interface Kit {
  deviceId: string;
  secretId: string;
  label: string;
}

/** SA dựng thiết bị + secret rồi gán Member tầng "cần duyệt" trên nhóm LOẠI của thiết bị đó. */
async function setUp(page: Page, stamp: string): Promise<Kit> {
  const headers = await writeHeaders(page);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const typeId = (catalog.deviceTypes.find((t) => t.name === 'Switch') ??
    catalog.deviceTypes[0]).id;

  const device = await page.request.post('/api/v1/devices', {
    headers,
    data: { code: `SW-E2E-BGX-${stamp}`, name: 'Switch tu choi', deviceTypeId: typeId },
  });
  expect(device.status()).toBe(201);
  const deviceId = ((await device.json()) as { device: { id: string } }).device.id;

  const label = `admin web E2E ${stamp}`;
  const secret = await page.request.post('/api/v1/vault/secrets', {
    headers,
    data: { ownerType: 'device', ownerId: deviceId, kind: 'password', label, value: `Bg#${stamp}` },
  });
  expect(secret.status()).toBeLessThan(300);
  const secretId = ((await secret.json()) as { id: string }).id;

  const grant = await page.request.post('/api/v1/vault/access', {
    headers,
    data: {
      memberEmail: E2E_MEMBER.email,
      scopeType: 'device_type',
      scopeRef: typeId,
      tier: 'needs_approval',
    },
  });
  expect(grant.status()).toBeLessThan(300);
  return { deviceId, secretId, label };
}

/**
 * Member xin quyền xem két của một CHỦ THỂ, trả về id phiếu.
 *
 * Phiếu gắn với chủ thể (thiết bị), không với từng secret: `tierFor(ownerType, ownerId)` xét
 * quyền theo nhóm, và một cái switch thường có nhiều secret mà người trực cần cả cụm.
 */
async function request(memberPage: Page, deviceId: string, reason: string): Promise<string> {
  const res = await memberPage.request.post('/api/v1/vault/break-glass', {
    headers: await writeHeaders(memberPage),
    data: { ownerType: 'device', ownerId: deviceId, reason, hours: 2 },
  });
  expect(res.status(), 'member phải xin được quyền — đó là bước đầu của cả luồng').toBeLessThan(
    300,
  );
  return ((await res.json()) as { id: string }).id;
}

function stateOf(id: string): string {
  return sql(`SELECT state FROM approval WHERE id = '${id}'`);
}

test.describe('Break-glass — cửa TỪ CHỐI và cửa THU HỒI', () => {
  test('SA từ chối: phiếu sang `denied`, và người xin vẫn KHÔNG xem được', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const kit = await setUp(page, stamp);

    const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await memberContext.newPage();
    await firstLogin(memberPage, E2E_MEMBER);

    const id = await request(memberPage, kit.deviceId, 'xu ly su co ngoai gio');
    expect(stateOf(id)).toBe('pending');

    const denied = await page.request.post(`/api/v1/vault/break-glass/${id}/deny`, {
      headers: await writeHeaders(page),
      data: { note: 'goi cho truc chinh, khong can mo ket' },
    });
    expect(denied.status()).toBeLessThan(300);
    expect(stateOf(id)).toBe('denied');

    /*
     * CÂU CHỐT. Cột `state` đổi là chuyện dễ; điều phải giữ là lượt XEM kế tiếp vẫn bị chặn.
     * Một `deny` chỉ ghi trạng thái mà không cắt quyền là một cái nút không làm gì cả.
     */
    const blocked = await memberPage.request.post(
      `/api/v1/vault/secrets/${kit.secretId}/reveal`,
      { headers: await writeHeaders(memberPage) },
    );
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()) as { code: string }).toMatchObject({
      code: 'BREAK_GLASS_REQUIRED',
    });

    // Lý do từ chối phải vào sổ: tuần sau người ta còn phải trả lời "vì sao không duyệt".
    expect(
      sql(`SELECT count(*) FROM audit_log WHERE action = 'break_glass.denied' AND object_id = '${id}'`),
    ).toBe('1');

    await memberContext.close();
  });

  test('SA thu hồi sớm: quyền đang có hiệu lực bị cắt NGAY, không chờ hết giờ', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-5);
    const kit = await setUp(page, stamp);

    const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await memberContext.newPage();
    await firstLogin(memberPage, E2E_MEMBER);

    const id = await request(memberPage, kit.deviceId, 'kiem tra cau hinh switch');
    const approved = await page.request.post(`/api/v1/vault/break-glass/${id}/approve`, {
      headers: await writeHeaders(page),
      data: { note: 'ok, trong 2 gio' },
    });
    expect(approved.status()).toBeLessThan(300);
    expect(stateOf(id)).toBe('approved');

    /*
     * Vế ĐỐI CHỨNG, và nó phải đứng TRƯỚC: chứng minh quyền THẬT SỰ đang mở. Thiếu vế này thì
     * bài dưới xanh cả khi break-glass hỏng hoàn toàn — 403 sau khi thu hồi chẳng nói gì nếu
     * trước đó cũng đã 403.
     *
     * Không phải mã 403 nào cũng như nhau: ở đây quyền break-glass ĐÃ mở, nên nếu còn bị chặn
     * thì phải vì thiếu step-up (`STEP_UP_REQUIRED`) chứ tuyệt đối không phải
     * `BREAK_GLASS_REQUIRED`.
     */
    const afterApprove = await memberPage.request.post(
      `/api/v1/vault/secrets/${kit.secretId}/reveal`,
      { headers: await writeHeaders(memberPage) },
    );
    const afterApproveBody = (await afterApprove.json()) as { code?: string };
    expect(afterApproveBody.code ?? 'OK').not.toBe('BREAK_GLASS_REQUIRED');

    const revoked = await page.request.post(`/api/v1/vault/break-glass/${id}/revoke`, {
      headers: await writeHeaders(page),
      data: { note: 'da xong viec, cat quyen som' },
    });
    expect(revoked.status()).toBeLessThan(300);
    expect(stateOf(id)).toBe('revoked');

    const blocked = await memberPage.request.post(
      `/api/v1/vault/secrets/${kit.secretId}/reveal`,
      { headers: await writeHeaders(memberPage) },
    );
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()) as { code: string }).toMatchObject({
      code: 'BREAK_GLASS_REQUIRED',
    });

    await memberContext.close();
  });

  test('đường hỏng: member không tự từ chối hay tự thu hồi phiếu của mình', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    await firstLogin(page, E2E_SA);
    const kit = await setUp(page, Date.now().toString().slice(-5));

    const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await memberContext.newPage();
    await firstLogin(memberPage, E2E_MEMBER);
    const id = await request(memberPage, kit.deviceId, 'thu quyen');

    const headers = await writeHeaders(memberPage);
    for (const door of ['deny', 'revoke']) {
      const res = await memberPage.request.post(`/api/v1/vault/break-glass/${id}/${door}`, {
        headers,
        data: { note: 'tu quyet' },
      });
      expect(res.status(), `${door} phải chặn member`).toBe(403);
    }
    expect(stateOf(id), 'không lượt nào được để lại hậu quả').toBe('pending');

    await memberContext.close();
  });
});
