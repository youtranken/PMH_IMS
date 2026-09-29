import { expect, test, type Page } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_MEMBER,
  E2E_SA,
  clearMailbox,
  firstLogin,
  mailBody,
  resetDevices,
  resetDigestRules,
  resetSoftware,
  resetUsers,
  rowAction,
  waitForMail,
  uniqueStamp,
} from './helpers';

test.beforeEach(async () => {
  resetUsers();
  resetSoftware();
  // PHẢI dọn cả thiết bị: luật dưới đây tính "mọi loại", nên một cái máy sót lại từ spec
  // khác có bảo hành sắp hết là số mục đếm được lệch ngay.
  resetDevices();
  resetDigestRules();
  await clearMailbox();
});

async function post(page: Page, url: string, data: Record<string, unknown>) {
  const csrf = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
  const response = await page.request.post(url, {
    headers: { 'X-CSRF-Token': csrf, Origin: APP_ORIGIN },
    data,
  });
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Lịch gửi KHÔNG BAO GIỜ tới hạn hôm nay — và đây là cả điểm mấu chốt của hai bài dưới.
 *
 * ===== VÌ SAO KHÔNG DÙNG MỘT LỊCH CỐ ĐỊNH =====
 *
 * Khai cứng `frequency: 'weekly', weekday: 1, hour: 8` — "thứ Hai 8 giờ" — thì lượt chạy rơi
 * vào chiều thứ Hai làm `shouldSendNow` trả `true` (đúng thứ · đã qua giờ · `lastSentAt` còn
 * rỗng vì luật vừa tạo) và sweep gửi một digest THẬT — cộng thêm thư `[Gửi thử]` của chính
 * bài. Hai thư, `toHaveLength(1)` đỏ.
 *
 * Nó chập chờn chứ không đỏ hẳn vì sweep chạy mỗi phút: rơi trúng khoảng vài giây giữa lúc
 * tạo luật và lúc đếm thư thì đỏ, không thì xanh. Một bài kiểm hỏng theo NGÀY TRONG TUẦN là bài sẽ bị đổ cho "chập
 * chờn" rồi chạy lại cho qua — đúng thứ làm người ta thôi tin bộ bài kiểm.
 *
 * `frequency: 'daily'` còn hở rộng hơn: tới hạn MỌI ngày sau 8 giờ; assertion đúng với cả hai
 * thư thì chỉ là may, không phải đúng.
 *
 * Nên: chọn ngày cách hôm nay BA ngày. Không phải "ngày mai" — lệch múi giờ giữa máy chạy
 * Playwright và múi giờ ứng dụng có thể biến "ngày mai" thành "hôm nay" ở quanh nửa đêm.
 *
 * Phần đang kiểm — "MỘT thư cho nhiều mục" và "lọc đúng loại" — không phụ thuộc vào ngày gửi,
 * nên đổi lịch không làm yếu bài đi chút nào.
 */
function scheduleNotDueToday(): { frequency: 'weekly'; weekday: number; hour: number } {
  const js = new Date().getDay();
  const isoToday = js === 0 ? 7 : js;
  return { frequency: 'weekly', weekday: ((isoToday - 1 + 3) % 7) + 1, hour: 8 };
}

test.describe('Báo cáo sắp-hết-hạn theo luật', () => {
  test('MỘT email tổng hợp cho nhiều mục, không phải mail lẻ từng món', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    // Ba mục sắp hết hạn thuộc hai loại khác nhau.
    await post(page, '/api/v1/software', {
      code: `SSL-E2E-D1-${stamp}`,
      name: 'SSL pmh.com.vn',
      kind: 'ssl',
      endDate: inDays(5),
    });
    await post(page, '/api/v1/software', {
      code: `SSL-E2E-D2-${stamp}`,
      name: 'SSL portal',
      kind: 'ssl',
      endDate: inDays(12),
    });
    await post(page, '/api/v1/software', {
      code: `DOM-E2E-D1-${stamp}`,
      name: 'pmh.com.vn',
      kind: 'domain',
      endDate: inDays(20),
    });

    const rule = await post(page, '/api/v1/expiry/rules', {
      name: `Luật E2E ${stamp}`,
      // Khoanh đúng hai loại vừa tạo — không phụ thuộc vào dữ liệu thật có sẵn trong DB.
      kinds: ['ssl', 'domain'],
      withinDays: 30,
      recipients: ['sep@pmh.com.vn', 'it@pmh.com.vn'],
      ...scheduleNotDueToday(),
    });
    expect(rule.status).toBe(201);

    const sent = await post(page, `/api/v1/expiry/rules/${String(rule.body.id)}/test`, {});
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ items: 3 });

    const messages = await waitForMail('sắp hết hạn');
    // ĐÚNG MỘT thư cho cả ba mục — đây là điểm chính của FR-013.
    expect(messages).toHaveLength(1);
    expect(messages[0].Subject).toContain('3 mục sắp hết hạn');
    expect(messages[0].To.map((to) => to.Address).sort()).toEqual([
      'it@pmh.com.vn',
      'sep@pmh.com.vn',
    ]);

    // Mỗi dòng nêu đủ tên + loại + hạn để đọc xong quyết được ngay.
    const body = await mailBody(messages[0].ID);
    expect(body).toContain(`SSL-E2E-D1-${stamp}`);
    expect(body).toContain(`DOM-E2E-D1-${stamp}`);
    expect(body).toContain('Chứng chỉ SSL');
    expect(body).toContain('Tên miền');
  });

  /*
   * DOM-03: hồ sơ phần mềm đã qua hạn tự sang "Hết hạn" và THÔI NHẮC qua mail (mail "sắp hết
   * hạn" đã gửi trước đó). Màn Sắp hết hạn vẫn hiện nó — xem expiry.spec "mục đã QUÁ HẠN".
   */
  test('hồ sơ phần mềm đã Hết hạn không vào mail, mục còn hạn thì vẫn vào', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    await post(page, '/api/v1/software', {
      code: `SSL-E2E-QH-${stamp}`,
      name: 'SSL đã quá hạn',
      kind: 'ssl',
      endDate: inDays(-3),
    });
    await post(page, '/api/v1/software', {
      code: `SSL-E2E-CH-${stamp}`,
      name: 'SSL còn hạn',
      kind: 'ssl',
      endDate: inDays(5),
    });
    const rule = await post(page, '/api/v1/expiry/rules', {
      name: `Luật E2E quá hạn ${stamp}`,
      kinds: ['ssl'],
      withinDays: 30,
      recipients: ['it@pmh.com.vn'],
      ...scheduleNotDueToday(),
    });
    expect(rule.status).toBe(201);

    const sent = await post(page, `/api/v1/expiry/rules/${String(rule.body.id)}/test`, {});
    expect(sent.status).toBe(201);
    const messages = await waitForMail('sắp hết hạn');
    const body = await mailBody(messages[0].ID);
    expect(body).toContain(`SSL-E2E-CH-${stamp}`);
    expect(body).not.toContain(`SSL-E2E-QH-${stamp}`);
  });

  test('luật lọc theo loại chỉ gửi đúng loại đó', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    await post(page, '/api/v1/software', {
      code: `SSL-E2E-F1-${stamp}`,
      name: 'SSL',
      kind: 'ssl',
      endDate: inDays(5),
    });
    await post(page, '/api/v1/software', {
      code: `LIC-E2E-F1-${stamp}`,
      name: 'License',
      kind: 'license',
      endDate: inDays(5),
    });

    const rule = await post(page, '/api/v1/expiry/rules', {
      name: `E2E chỉ SSL ${stamp}`,
      kinds: ['ssl'],
      withinDays: 30,
      recipients: ['ssl@pmh.com.vn'],
      ...scheduleNotDueToday(),
    });
    const sent = await post(page, `/api/v1/expiry/rules/${String(rule.body.id)}/test`, {});
    expect(sent.body).toMatchObject({ items: 1 });

    const messages = await waitForMail('sắp hết hạn');
    const body = await mailBody(messages[0].ID);
    expect(body).toContain(`SSL-E2E-F1-${stamp}`);
    expect(body).not.toContain(`LIC-E2E-F1-${stamp}`);
  });

  test('luật ĐANG CHẠY bắt buộc có người nhận; để dành thì phải tắt', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    /*
     * Luật đang chạy mà không có người nhận thì mỗi phút sweep lại đến kỳ, lại bỏ qua, lại
     * ghi một dòng cảnh báo — gần một nghìn dòng rác mỗi ngày mà không ai nhận được gì
     * Chặn ngay lúc lưu.
     */
    const blocked = await post(page, '/api/v1/expiry/rules', {
      name: `E2E không người nhận ${stamp}`,
      recipients: [],
      frequency: 'daily',
      hour: 8,
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body).toMatchObject({ code: 'NO_RECIPIENTS' });

    // Tắt "Đang chạy" thì lưu được — để dành cấu hình mà không đẻ rác log.
    const draft = await post(page, '/api/v1/expiry/rules', {
      name: `E2E nháp ${stamp}`,
      recipients: [],
      active: false,
      frequency: 'daily',
      hour: 8,
    });
    expect(draft.status).toBe(201);

    // Nhưng gửi thử thì vẫn phải từ chối, kèm lý do đọc được.
    const sent = await post(page, `/api/v1/expiry/rules/${String(draft.body.id)}/test`, {});
    expect(sent.status).toBe(400);
    expect(sent.body).toMatchObject({ code: 'NO_RECIPIENTS' });
  });

  test('mã luật sai định dạng trả 400, không phải 500', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    // 36 dấu gạch ngang: lọt qua regex "36 ký tự hex-hoặc-gạch" cũ và bung 500 ở Postgres.
    const result = await post(page, '/api/v1/expiry/rules/------------------------------------/test', {});
    expect(result.status).toBe(400);
  });

  test('email sai định dạng bị chặn ngay khi lưu luật', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const result = await post(page, '/api/v1/expiry/rules', {
      name: 'E2E email hỏng',
      recipients: ['khong-phai-email'],
      frequency: 'daily',
      hour: 8,
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: 'EMAIL_INVALID' });
  });

  test('Member xem được luật nhưng không sửa được', async ({ page }) => {
    await firstLogin(page, E2E_MEMBER);

    await page.goto('/expiry');
    await page.getByRole('tab', { name: 'Luật gửi báo cáo' }).click();
    await expect(page.getByText('Bạn xem được luật nhưng không sửa được.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thêm luật' })).toHaveCount(0);

    const blocked = await post(page, '/api/v1/expiry/rules', {
      name: 'E2E member không được tạo',
      recipients: ['x@pmh.com.vn'],
      frequency: 'daily',
      hour: 8,
    });
    expect(blocked.status).toBe(403);
  });

  test('tạo luật trên UI bằng bộ chọn lịch dùng chung', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();

    await page.goto('/expiry');
    await page.getByRole('tab', { name: 'Luật gửi báo cáo' }).click();
    await expect(page.getByText('Chưa có luật gửi báo cáo nào.')).toBeVisible();

    await page.getByRole('button', { name: 'Thêm luật' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('textbox', { name: 'Tên luật' }).fill(`E2E luật UI ${stamp}`);
    await form.getByRole('textbox', { name: 'Người nhận' }).fill('sep@pmh.com.vn');
    await form.getByRole('button', { name: 'Lưu' }).click();

    const row = page.getByRole('row', { name: new RegExp(`E2E luật UI ${stamp}`) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Chưa gửi lần nào')).toBeVisible();
    await expect(row.getByText(/Hằng tuần/)).toBeVisible();
  });

  /*
   * EX-021: biết thư chứa gì và lần gửi tới là khi nào MÀ KHÔNG phải bắn email thật tới cả
   * danh sách người nhận. "Gửi thử cho tôi" chỉ tới hộp thư người bấm.
   */
  test('lần gửi tới, xem trước thư trong app, gửi thử chỉ cho tôi', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    await post(page, '/api/v1/software', {
      code: `SSL-E2E-XT-${stamp}`,
      name: 'SSL xem trước',
      kind: 'ssl',
      endDate: inDays(9),
    });
    const name = `Luật E2E xem trước ${stamp}`;
    const rule = await post(page, '/api/v1/expiry/rules', {
      name,
      kinds: ['ssl'],
      withinDays: 30,
      recipients: ['sep@pmh.com.vn'],
      ...scheduleNotDueToday(),
    });
    expect(rule.status).toBe(201);

    await page.goto('/expiry');
    await page.getByRole('tab', { name: 'Luật gửi báo cáo' }).click();
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row.getByRole('cell', { name: /\d{2}\/\d{2}\/\d{4}/ }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Lần gửi tới' })).toBeVisible();

    await rowAction(page, name, 'Xem trước thư');
    const dialog = page.getByRole('dialog', { name: new RegExp(`Xem trước thư — ${name}`) });
    await expect(dialog.getByText(/thư có 1 mục/)).toBeVisible();
    await expect(dialog.getByText(`SSL-E2E-XT-${stamp}`, { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Đóng' }).first().click();

    await rowAction(page, name, 'Gửi thử cho tôi');
    const messages = await waitForMail('sắp hết hạn');
    expect(messages).toHaveLength(1);
    expect(messages[0].To.map((to) => to.Address)).toEqual([E2E_SA.email]);
  });

  test('xem trước luật không tồn tại → 404, không phải 500', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const status = await page.evaluate(async () => {
      const res = await fetch('/api/v1/expiry/rules/00000000-0000-4000-8000-000000000000/preview', {
        credentials: 'include',
      });
      return res.status;
    });
    expect(status).toBe(404);
  });
});
