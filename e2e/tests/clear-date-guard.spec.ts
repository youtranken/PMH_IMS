import { expect, test, type Page } from '@playwright/test';
import { E2E_SA, firstLogin, resetIsp, resetSoftware, resetUsers, writeHeaders } from './helpers';

/**
 * A-03 (rà soát 19/09): XOÁ một ô ngày không giống BỎ TRỐNG nó khi gửi lên.
 *
 * `prepare()` của cả ba service ghép bản sửa với hồ sơ đang có bằng `??`:
 *
 *     endDate: (values.endDate ?? current?.endDate ?? null)
 *
 * `dateOnly("")` trả `null` — nghĩa là "người dùng đã xoá ô này". Nhưng `??` coi `null` y
 * hệt `undefined` ("người dùng không đụng tới ô này"), nên luật đi soi trên ngày **CŨ**.
 * Hai hậu quả ngược chiều nhau, và bài này canh cả hai:
 *
 *  1. **Lọt cái phải chặn.** `{"endDate":""}` trên một chứng chỉ SSL: `requiresEndDate` soi
 *     ngày cũ nên không nổ, rồi câu ghi vẫn ghi `end_date = NULL`. Hồ sơ mất hạn — đúng thứ
 *     `software-rules.ts` sinh ra để cấm — và vì `findExpiringBetween` lọc `end_date IS NOT
 *     NULL`, nó biến khỏi MỌI lời nhắc gia hạn, vĩnh viễn, không một dòng lỗi. Không lưới DB.
 *  2. **Chặn cái phải cho qua.** Đường truyền ISP xoá ngày bắt đầu rồi đặt hạn sớm hơn ngày
 *     bắt đầu CŨ: luật so với ngày cũ (ngày vừa bị xoá) và từ chối. Người trực bị nhốt lại
 *     bởi một giá trị không còn tồn tại — đúng cái bẫy mà chú thích `isp-line.service.ts`
 *     đã mô tả cho liên kết thiết bị, lặp lại ở cặp ngày.
 *
 * Đường nhập Excel làm ĐÚNG với cùng bài toán từ trước (`device-import.ts` dùng `field in
 * values`). Lại là hình dạng của A-01: cửa Excel được canh, cửa HTTP bỏ ngỏ.
 *
 * Bài đi thẳng HTTP chứ không qua form: ô ngày trên màn hình là widget lịch, còn thứ đang
 * kiểm là phép GHÉP ở tầng service — cửa mà import, script và mọi tích hợp sau này đều đi qua.
 */

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  resetIsp();
});

async function createSoftware(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/v1/software', {
    headers: await writeHeaders(page),
    data,
  });
  expect(res.status(), await res.text()).toBe(201);
  return String(((await res.json()) as { id: string }).id);
}

async function endDateOf(page: Page, id: string): Promise<string | null> {
  const res = await page.request.get(`/api/v1/software/${id}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { endDate: string | null }).endDate;
}

test.describe('Xoá ô ngày — luật phải soi giá trị MỚI, không phải giá trị cũ', () => {
  test('chứng chỉ SSL không xoá được ngày hết hạn, và hạn cũ còn nguyên sau lượt bị từ chối', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const id = await createSoftware(page, {
      code: `SSL-E2E-${stamp}`,
      name: `Chung chi E2E ${stamp}`,
      kind: 'ssl',
      endDate: '2027-01-31',
    });

    const cleared = await page.request.patch(`/api/v1/software/${id}`, {
      headers: await writeHeaders(page),
      data: { endDate: '' },
    });
    expect(cleared.status()).toBe(400);
    const body = (await cleared.json()) as { code: string; message: string };
    expect(body.code).toBe('SOFTWARE_INVALID');
    expect(body.message).toContain('ngày hết hạn');

    // Vế thứ hai: lượt bị từ chối không được để lại nửa bản ghi. Nếu câu ghi vẫn chạy thì
    // hồ sơ đã mất hạn rồi, và mọi lời nhắc gia hạn im lặng bỏ qua nó.
    expect(await endDateOf(page, id)).toBe('2027-01-31');
  });

  test('hợp đồng bảo trì vẫn xoá được ngày hết hạn — luật mới không chặn nhầm đường đúng', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const id = await createSoftware(page, {
      code: `MTN-E2E-${stamp}`,
      name: `Bao tri E2E ${stamp}`,
      kind: 'maintenance',
      endDate: '2027-01-31',
    });

    const cleared = await page.request.patch(`/api/v1/software/${id}`, {
      headers: await writeHeaders(page),
      data: { endDate: '' },
    });
    expect(cleared.status(), await cleared.text()).toBe(200);
    expect(await endDateOf(page, id)).toBeNull();
  });

  test('đường truyền ISP: xoá ngày bắt đầu rồi đặt hạn sớm hơn ngày bắt đầu CŨ vẫn phải lưu được', async ({
    page,
  }) => {
    await firstLogin(page, E2E_SA);
    const stamp = Date.now().toString().slice(-6);
    const created = await page.request.post('/api/v1/isp-lines', {
      headers: await writeHeaders(page),
      data: {
        code: `ISP-E2E-${stamp}`,
        provider: 'Nha mang E2E',
        startDate: '2026-06-01',
        endDate: '2026-12-31',
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const id = String(((await created.json()) as { id: string }).id);

    const moved = await page.request.patch(`/api/v1/isp-lines/${id}`, {
      headers: await writeHeaders(page),
      data: { startDate: '', endDate: '2026-03-01' },
    });
    expect(moved.status(), await moved.text()).toBe(200);

    const after = await page.request.get(`/api/v1/isp-lines/${id}`);
    const line = (await after.json()) as { startDate: string | null; endDate: string | null };
    expect(line.startDate).toBeNull();
    expect(line.endDate).toBe('2026-03-01');
  });
});
