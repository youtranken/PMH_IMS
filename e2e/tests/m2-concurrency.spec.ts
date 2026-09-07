import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  resetDevices,
  resetIpam,
  resetSoftware,
  resetUsers,
  sql,
  writeHeaders,
} from './helpers';

/**
 * Mẫu lỗi "M2" — kiểm ngoài transaction rồi ghi vô điều kiện bên trong.
 *
 * VÌ SAO BÀI NÀY PHẢI LÀ E2E, KHÔNG THỂ LÀ UNIT TEST:
 * lỗi ở đây không nằm trong một hàm nào cả — nó nằm ở KHOẢNG GIỮA hai câu lệnh SQL, và chỉ
 * hiện ra khi có hai kết nối thật chạy chồng lên nhau trên một Postgres thật. Mock drizzle
 * thì không còn transaction để mà đua (và CLAUDE.md cấm mock drizzle). Tầng test giữa —
 * `api/test/` với Postgres thật — hiện đang rỗng, nên E2E là chỗ duy nhất chứng minh được.
 *
 * CÁCH BÀI NÀY ĐƯỢC THIẾT KẾ ĐỂ KHÔNG "XANH VÌ KHÔNG CHẠY GÌ":
 * mỗi bài bắn N request ĐỒNG THỜI vào cùng một bản ghi rồi khẳng định **đúng một** cái thắng.
 * Khẳng định đó chặt theo cả hai chiều: sửa rồi thì luôn đúng bất kể thứ tự hệ điều hành xếp;
 * chưa sửa thì chỉ cần HAI request chồng nhau là đỏ. Bắn 6 thay vì 2 để xác suất chồng nhau
 * gần như chắc chắn.
 *
 * Kèm theo mỗi bài là một khẳng định trên BẢNG LỊCH SỬ: bảng lịch sử là chỉ-thêm (AD-13), nên
 * một dòng thừa sinh ra ở đây là hỏng vĩnh viễn, không sửa lại được. Đây mới là thiệt hại thật
 * của lớp lỗi này, chứ không phải mã HTTP.
 */

const CONCURRENT = 6;

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetDevices();
  resetIpam();
});

async function csrfOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
}

async function createDevice(page: Page, code: string): Promise<string> {
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    return (await res.json()) as { deviceTypes: { id: string; name: string }[] };
  });
  const pc = catalog.deviceTypes.find((type) => type.name === 'PC')!;
  const created = await page.request.post('/api/v1/devices', {
    headers: { 'X-CSRF-Token': await csrfOf(page), Origin: APP_ORIGIN },
    data: { code, name: `Máy ${code}`, deviceTypeId: pc.id },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { device: { id: string } }).device.id;
}

/** Đếm mã trạng thái của một loạt response — dùng để khẳng định "đúng một cái thắng". */
function tally(statuses: number[]): Map<number, number> {
  const counted = new Map<number, number>();
  for (const status of statuses) counted.set(status, (counted.get(status) ?? 0) + 1);
  return counted;
}

test.describe('M2 — ghi song song trên cùng bản ghi', () => {
  /**
   * Finding 2 của Đợt 2: `license-assignment.service.ts` `assign`.
   *
   * Bản cũ đếm seat bằng `usageFor()` chạy trên pool, NGOÀI transaction chèn. License 1 ghế,
   * sáu người gán cùng lúc: cả sáu đọc `used = 0`, `0 >= 1` là sai nên cả sáu qua cửa, cả sáu
   * chèn. Thành 6/1 và KHÔNG AI phải khai `overSeatReason` — trong khi AC 3.2 dựng ra cái ô
   * lý do đó chính vì vượt seat là chuyện pháp lý với nhà cung cấp.
   *
   * UNIQUE `(software_id, device_id)` không cứu: nó canh trùng THIẾT BỊ. Sáu máy khác nhau là
   * sáu dòng hợp lệ với nó.
   */
  test('seat: sáu lượt gán đồng thời vào license 1 ghế → đúng MỘT lượt vào được', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

    const created = await page.request.post('/api/v1/software', {
      headers: await writeHeaders(page),
      data: {
        code: `E2E-SEAT-${stamp}`,
        name: `License đua ghế ${stamp}`,
        kind: 'license',
        seatTotal: 1,
        endDate: '2028-12-31',
      },
    });
    expect(created.status()).toBe(201);
    const softwareId = ((await created.json()) as { id: string }).id;

    // Mỗi request một máy khác nhau: nếu để trùng máy thì UNIQUE chặn giúp và bài kiểm sẽ
    // xanh vì lý do CHẲNG LIÊN QUAN tới seat.
    const deviceIds: string[] = [];
    for (let i = 0; i < CONCURRENT; i += 1) {
      deviceIds.push(await createDevice(page, `E2E-SEAT-${stamp}-${i}`));
    }

    const headers = await writeHeaders(page);
    const responses = await Promise.all(
      deviceIds.map((deviceId) =>
        page.request.post(`/api/v1/software/${softwareId}/assignments`, {
          headers,
          data: { deviceId },
        }),
      ),
    );

    const counted = tally(responses.map((res) => res.status()));
    expect(counted.get(201) ?? 0).toBe(1);
    expect(counted.get(400) ?? 0).toBe(CONCURRENT - 1);

    // Mã lỗi phải là mã NGHIỆP VỤ, không phải 500 chung chung — người dùng cần biết vì sao.
    const rejected = responses.filter((res) => res.status() === 400);
    for (const res of rejected) {
      expect(((await res.json()) as { code: string }).code).toBe('SEAT_LIMIT_REACHED');
    }

    // Thiệt hại thật nằm ở đây: số ghế đã dùng không được vượt số ghế đã mua.
    const used = sql(
      `SELECT count(*) FROM license_assignment WHERE software_id = '${softwareId}' AND released_at IS NULL`,
    );
    expect(Number(used)).toBe(1);
  });

  /**
   * Finding 3 của Đợt 2: `license-assignment.service.ts` `release`.
   *
   * Gỡ ghế hai lần cùng lúc (bấm đúp, hoặc hai người cùng mở màn). Bản cũ ghi đè `released_at`
   * lần nữa VÀ ghi thêm một dòng `software_history` "license-released". `software_history` là
   * bảng chỉ-thêm (AD-13) — dòng thừa đó nằm lại vĩnh viễn, không UPDATE cũng không DELETE
   * được. Sổ lịch sử nói một lần ngồi ghế bị gỡ hai lần.
   */
  test('gỡ ghế: sáu lượt gỡ đồng thời → đúng MỘT lượt, và lịch sử chỉ có MỘT dòng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

    const created = await page.request.post('/api/v1/software', {
      headers: await writeHeaders(page),
      data: {
        code: `E2E-REL-${stamp}`,
        name: `License đua gỡ ${stamp}`,
        kind: 'license',
        seatTotal: 5,
        endDate: '2028-12-31',
      },
    });
    const softwareId = ((await created.json()) as { id: string }).id;
    const deviceId = await createDevice(page, `E2E-REL-${stamp}-0`);

    const assigned = await page.request.post(`/api/v1/software/${softwareId}/assignments`, {
      headers: await writeHeaders(page),
      data: { deviceId },
    });
    expect(assigned.status()).toBe(201);
    const assignmentId = ((await assigned.json()) as { assignment: { id: string } }).assignment.id;

    const headers = await writeHeaders(page);
    const responses = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        page.request.delete(`/api/v1/software/${softwareId}/assignments/${assignmentId}`, {
          headers,
        }),
      ),
    );

    const statuses = responses.map((res) => res.status());
    const winners = statuses.filter((status) => status >= 200 && status < 300);
    expect(winners).toHaveLength(1);
    // Người thua nhận 409 (có người chen ngang) hoặc 404 (đọc lại đã thấy gỡ rồi) — cả hai
    // đều đúng nghiệp vụ. Điều KHÔNG được phép là hai người cùng "thành công".
    for (const status of statuses.filter((s) => s >= 300)) {
      expect([404, 409]).toContain(status);
    }

    const historyRows = sql(
      `SELECT count(*) FROM software_history WHERE software_id = '${softwareId}' AND action = 'license-released'`,
    );
    expect(Number(historyRows)).toBe(1);
  });

  /**
   * Finding 1 của Đợt 2: `ip-address.service.ts` `transition`.
   *
   * `requireAlive` đọc bằng pool, ngoài transaction ghi. Sáu lượt chuyển `free → assigned`
   * cùng lúc trên MỘT hồ sơ IP: cả sáu đọc `from = 'free'`, cả sáu qua `canTransition`, cả
   * sáu UPDATE. Trạng thái cuối là của người bấm sau, và `ip_history` để lại SÁU dòng cùng
   * `from_status = 'free'` — sổ lịch sử tự mâu thuẫn với chính nó, mà AC 5.2 bắt giữ nó
   * vĩnh viễn và bảng thì chỉ-thêm.
   */
  test('trạng thái IP: sáu lượt chuyển đồng thời → đúng MỘT dòng lịch sử', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-4);
    const octet = 100 + (Number(stamp) % 100);

    const subnet = await page.request.post('/api/v1/ipam/subnets', {
      headers: await writeHeaders(page),
      data: { cidr: `172.31.${octet}.0/29`, name: `Dai dua E2E ${stamp}` },
    });
    expect(subnet.status()).toBe(201);
    const subnetId = ((await subnet.json()) as { id: string }).id;

    const address = await page.request.post('/api/v1/ipam/addresses', {
      headers: await writeHeaders(page),
      data: { subnetId, address: `172.31.${octet}.1` },
    });
    expect(address.status()).toBe(201);
    const ipId = ((await address.json()) as { id: string }).id;

    const headers = await writeHeaders(page);
    const responses = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        page.request.post(`/api/v1/ipam/addresses/${ipId}/transition`, {
          headers,
          data: { to: 'assigned', usedBy: `Nguoi ${i}` },
        }),
      ),
    );

    const statuses = responses.map((res) => res.status());
    const winners = statuses.filter((status) => status >= 200 && status < 300);
    expect(winners).toHaveLength(1);
    for (const status of statuses.filter((s) => s >= 300)) {
      expect([400, 409]).toContain(status);
    }

    /*
     * Khẳng định QUAN TRỌNG NHẤT của cả file này.
     *
     * Mã HTTP có thể đúng mà lịch sử vẫn hỏng: chỉ cần câu UPDATE trúng rồi mà vòng ghi lịch
     * sử chạy trên ảnh chụp cũ. Đếm thẳng trong DB là cách duy nhất chốt được điều AC 5.2 hứa.
     */
    const voidedRows = sql(
      `SELECT count(*) FROM ip_history WHERE ip_address_id = '${ipId}' AND from_status = 'free'`,
    );
    expect(Number(voidedRows)).toBe(1);
  });

  /**
   * Finding 4 của Đợt 2: `accounts.service.ts` `setStatus` — chỗ nguy hiểm nhất cả nhóm.
   *
   * NFR-01 bắt hệ thống luôn còn tối thiểu 2 SA hoạt động. Bản cũ đếm SA NGOÀI transaction
   * ghi: hệ thống còn 3 SA, hai lệnh khóa chạy song song trên hai SA khác nhau — cả hai đếm
   * được "còn 2", cả hai qua cửa, cả hai ghi. Còn lại 1. Với đúng 2 SA thì còn 0, tức KHÓA
   * CẢ CÔNG TY RA NGOÀI hệ thống, và không ai mở lại được vì mở cũng cần quyền SA.
   */
  test('SA cuối cùng: hai lệnh khóa đồng thời không được đưa hệ thống xuống dưới 2 SA @slow', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

    /*
     * Kịch bản chỉ có nghĩa ở ĐÚNG 3 SA hoạt động.
     *
     * Luật là "khóa xong phải còn ≥ 2". Với 3 SA, lệnh khóa thứ hai buộc phải trượt. Với 5 SA
     * (đúng số mà DB dev đang có: sa@, caothuan@, e2e-sa@ cộng hai cái test tạo ra) thì khóa
     * hai cái vẫn còn 3 — cả hai lệnh ĐỀU HỢP LỆ và hàng rào không bao giờ được chạm tới.
     * Bài kiểm sẽ xanh mà chẳng kiểm gì.
     *
     * Nên: tạm khóa các SA nền khác bằng SQL, chạy bài, rồi trả lại NGUYÊN TRẠNG trong
     * `finally`. Ghi lại danh sách id để câu trả lại chỉ đụng đúng những hàng này.
     */
    const parked = sql(
      "SELECT string_agg(id::text, ',') FROM users " +
        "WHERE role = 'sa' AND status = 'active' AND email <> '" +
        E2E_SA.email +
        "'",
    );

    try {
      if (parked) {
        sql(`UPDATE users SET status = 'locked' WHERE id IN ('${parked.split(',').join("','")}')`);
      }

      // Tiền tố `e2e-tao-moi-` là quy ước để `dropAccountsCreatedByE2e()` dọn sạch sau này.
      const extraIds: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const res = await page.request.post('/api/v1/accounts', {
          headers: await writeHeaders(page),
          data: {
            email: `e2e-tao-moi-sa-${stamp}-${i}@pmh.com.vn`,
            fullName: `SA phu ${stamp} ${i}`,
            role: 'sa',
            totpLoginRequired: true,
          },
        });
        expect(res.status()).toBe(201);
        // `POST /accounts` trả `{ user, temporaryPassword }`, KHÔNG phải `{ id }` như
        // `/software` và `/ipam/subnets`. Đọc nhầm ở đây thì id thành `undefined`, URL
        // bước sau là `/accounts/undefined/status` và cả hai request trả 500 — bài kiểm
        // vẫn "đỏ", nhưng đỏ vì lý do chẳng liên quan tới lỗi đua đang cần chứng minh.
        const created = (await res.json()) as { user: { id: string } };
        expect(created.user?.id).toBeTruthy();
        extraIds.push(created.user.id);
      }

      // Đúng 3 SA hoạt động: E2E_SA + hai tài khoản vừa tạo. Khóa được đúng MỘT trong hai.
      const before = Number(
        sql("SELECT count(*) FROM users WHERE role = 'sa' AND status = 'active'"),
      );
      expect(before).toBe(3);

      const headers = await writeHeaders(page);
      /*
       * ĐUA NHIỀU VÒNG, không phải một.
       *
       * Ở đây chỉ có ĐÚNG HAI request đua được (hai SA khóa được), trong khi ba bài trên bắn
       * sáu. Cửa sổ hỏng lại rất hẹp: giữa câu đếm và câu ghi chỉ vài trăm micro giây. Chạy
       * một vòng thì bản CHƯA sửa vẫn xanh — tôi đã thử: gỡ bản sửa ra, dựng lại ảnh, bài
       * vẫn qua. Một bài như thế không canh được gì, nó chỉ chốt tính chất tuần tự.
       *
       * Mỗi vòng chỉ tốn hai câu SQL đặt lại trạng thái (không tạo lại tài khoản — băm
       * Argon2 tốn ~200ms mỗi cái), nên chạy nhiều vòng gần như không tốn thêm thời gian
       * mà xác suất trúng cửa sổ tăng theo số vòng.
       */
      const ROUNDS = 12;
      const idList = `('${extraIds.join("','")}')`;
      for (let round = 0; round < ROUNDS; round += 1) {
        sql(`UPDATE users SET status = 'active' WHERE id IN ${idList}`);

        const responses = await Promise.all(
          extraIds.map((id) =>
            page.request.patch(`/api/v1/accounts/${id}/status`, {
              headers,
              data: { status: 'locked' },
            }),
          ),
        );

        const statuses = responses.map((res) => res.status());
        const winners = statuses.filter((status) => status >= 200 && status < 300);
        const rejected = responses.filter((res) => res.status() >= 400);

        expect(winners, `vòng ${round + 1}: mã trả về ${JSON.stringify(statuses)}`).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(((await rejected[0].json()) as { code: string }).code).toBe('LAST_SA');

        // Hàng rào thật: NFR-01 nói tối thiểu 2, và con số này là thứ duy nhất chứng minh nó.
        const after = Number(
          sql("SELECT count(*) FROM users WHERE role = 'sa' AND status = 'active'"),
        );
        expect(after, `vòng ${round + 1}: số SA hoạt động còn lại`).toBe(2);
      }
    } finally {
      // Trả các SA nền về `active` DÙ BÀI ĐỎ — bài kiểm không được để lại một hệ thống mà
      // chính người thật không đăng nhập vào được.
      if (parked) {
        sql(`UPDATE users SET status = 'active' WHERE id IN ('${parked.split(',').join("','")}')`);
      }
    }
  });
});
