import { expect, request, test, type Page } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  firstLogin,
  resetDevices,
  resetDigestRules,
  resetIsp,
  resetSoftware,
  resetUsers,
} from './helpers';

/** Mailpit chỉ có ở môi trường dev/test — SMTP thật chỉ cấu hình ở prod. */
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

test.beforeEach(async () => {
  resetUsers();
  resetSoftware();
  resetIsp();
  // PHẢI dọn cả thiết bị: luật dưới đây tính "mọi loại", nên một cái máy sót lại từ spec
  // khác có bảo hành sắp hết là số mục đếm được lệch ngay (code review Epic 3).
  resetDevices();
  resetDigestRules();
  await clearMailbox();
});

async function clearMailbox(): Promise<void> {
  const api = await request.newContext();
  await api.delete(`${MAILPIT}/api/v1/messages`).catch(() => undefined);
  await api.dispose();
}

interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

/**
 * Chờ thư có tiêu đề khớp — KHÔNG lấy bừa thư đầu hộp: luồng đăng nhập lần đầu cũng gửi
 * email "thiết bị mới", nên thư đầu tiên trong hộp thường không phải thư mình đang chờ.
 */
async function waitForMail(subjectPart: string): Promise<MailSummary[]> {
  const api = await request.newContext();
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const res = await api.get(`${MAILPIT}/api/v1/messages`);
      if (res.ok()) {
        const body = (await res.json()) as { messages: MailSummary[] };
        const matched = body.messages.filter((mail) => mail.Subject.includes(subjectPart));
        if (matched.length > 0) return matched;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return [];
  } finally {
    await api.dispose();
  }
}

async function mailBody(id: string): Promise<string> {
  const api = await request.newContext();
  const res = await api.get(`${MAILPIT}/api/v1/message/${id}`);
  const body = (await res.json()) as { Text?: string; HTML?: string };
  await api.dispose();
  return `${body.Text ?? ''}\n${body.HTML ?? ''}`;
}

async function post(page: Page, url: string, data: Record<string, unknown>) {
  const csrf = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return ((await res.json()) as { csrfToken: string }).csrfToken;
  });
  const response = await page.request.post(url, {
    headers: { 'X-CSRF-Token': csrf, Origin: 'https://localhost' },
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

test.describe('Báo cáo sắp-hết-hạn theo luật', () => {
  test('MỘT email tổng hợp cho nhiều mục, không phải mail lẻ từng món', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

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
    await post(page, '/api/v1/isp-lines', {
      code: `ISP-E2E-D1-${stamp}`,
      provider: 'FPT',
      endDate: inDays(20),
    });

    const rule = await post(page, '/api/v1/expiry/rules', {
      name: `Luật E2E ${stamp}`,
      // Khoanh đúng hai loại vừa tạo — không phụ thuộc vào dữ liệu thật có sẵn trong DB.
      kinds: ['ssl', 'isp'],
      withinDays: 30,
      recipients: ['sep@pmh.com.vn', 'it@pmh.com.vn'],
      frequency: 'weekly',
      hour: 8,
      weekday: 1,
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
    expect(body).toContain(`ISP-E2E-D1-${stamp}`);
    expect(body).toContain('Chứng chỉ SSL');
    expect(body).toContain('Hợp đồng đường truyền');
  });

  test('luật lọc theo loại chỉ gửi đúng loại đó', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);

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
      frequency: 'daily',
      hour: 8,
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
    const stamp = Date.now().toString().slice(-6);

    /*
     * Luật đang chạy mà không có người nhận thì mỗi phút sweep lại đến kỳ, lại bỏ qua, lại
     * ghi một dòng cảnh báo — gần một nghìn dòng rác mỗi ngày mà không ai nhận được gì
     * (code review Epic 3). Chặn ngay lúc lưu.
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

    await page.goto('/sap-het-han');
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
    const stamp = Date.now().toString().slice(-6);

    await page.goto('/sap-het-han');
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
});
