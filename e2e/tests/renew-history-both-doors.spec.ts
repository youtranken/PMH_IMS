import { expect, test, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetSoftware,
  resetUsers,
  sql,
  writeHeaders,
  uniqueStamp,
} from './helpers';

/**
 * HAI nút "Gia hạn" phải cùng ghi sổ.
 *
 * ===== RỦI RO =====
 *
 * Web có hai đường gia hạn cùng một hồ sơ:
 *   - `POST /expiry/renew` (từ màn "Sắp hết hạn") → `ExpiryService.renew`;
 *   - `POST /software/:id/renew` (nút trong chính trang hồ sơ) → `SoftwareService.renew`.
 *
 * Nếu một cửa không ghi `renewal_history` thì người dùng ở trang hồ sơ bấm Gia hạn: `end_date`
 * đổi, toast xanh, lịch sử hồ sơ có dòng
 * "Gia hạn" — mọi thứ trông đúng. Nhưng `renewal_history` là bảng CHỈ-THÊM và là nguồn của
 * báo cáo cuối năm lẫn khối "gia hạn gần đây" trên dashboard sếp. Cả hai trả rỗng, và không
 * vá ngược được. AC 3.4.
 *
 * ===== BÀI NÀY GIỮ GÌ =====
 *
 * Không phải "nút gia hạn chạy được" (`software.spec.ts` đã giữ). Mà là: HAI cửa dẫn tới CÙNG
 * MỘT hệ quả. Đó là thứ chỉ thấy khi đi vào DB, vì cửa hỏng trả về đúng 201 và UI của nó
 * không hề đọc `renewal_history`.
 */

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
});

function renewalRowsFor(objectId: string): number {
  return Number(sql(`SELECT count(*) FROM renewal_history WHERE object_id = '${objectId}'`));
}

async function createSoftware(page: Page, code: string): Promise<string> {
  const res = await page.request.post('/api/v1/software', {
    headers: await writeHeaders(page),
    data: {
      code,
      name: `Hop dong ${code}`,
      kind: 'license',
      seatTotal: 10,
      startDate: '2025-01-01',
      endDate: '2026-12-31',
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

test.describe('Gia hạn — hai cửa phải cùng ghi sổ (AC 3.4)', () => {
  test('phần mềm: nút trong trang hồ sơ cũng phải ghi renewal_history', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const id = await createSoftware(page, `SW-E2E-RH-${stamp}`);

    expect(renewalRowsFor(id), 'chưa gia hạn thì chưa có dòng nào').toBe(0);

    const renewed = await page.request.post(`/api/v1/software/${id}/renew`, {
      headers: await writeHeaders(page),
      data: { endDate: '2027-12-31' },
    });
    expect(renewed.status()).toBe(201);

    expect(
      renewalRowsFor(id),
      'gia hạn từ trang hồ sơ cũng phải vào sổ — báo cáo cuối năm đọc bảng này',
    ).toBe(1);

    /*
     * Nội dung dòng phải ĐỦ DÙNG, không chỉ đủ đếm. Báo cáo năm hỏi "gia hạn từ ngày nào sang
     * ngày nào, ai làm" — thiếu `old_end` thì dòng đó chỉ nói là có chuyện gì đó đã xảy ra.
     */
    const row = sql(
      `SELECT coalesce(object_kind,'?') || '|' || coalesce(old_end::text,'?') || '|' || ` +
        `coalesce(new_end::text,'?') || '|' || coalesce(actor,'?') ` +
        `FROM renewal_history WHERE object_id = '${id}'`,
    );
    const [kind, oldEnd, newEnd, actor] = row.split('|');
    expect(kind, 'phải ghi đúng loại để báo cáo lọc được').toBe('license');
    expect(oldEnd).toBe('2026-12-31');
    expect(newEnd).toBe('2027-12-31');
    expect(actor).toBe(E2E_SA.email);
  });

  /**
   * Cửa cũ vẫn phải chạy, và phải ghi ĐÚNG MỘT dòng.
   *
   * Đây là vế dễ hỏng nhất của bản sửa: nếu chuyển phần ghi sổ xuống module chủ mà quên gỡ ở
   * `ExpiryService.renew`, mỗi lượt gia hạn từ màn "Sắp hết hạn" sẽ đẻ HAI dòng — và báo cáo
   * năm đếm gấp đôi. Đổi một lỗi thiếu thành một lỗi thừa thì vẫn là sai số.
   */
  test('cửa màn "Sắp hết hạn" vẫn chạy, và KHÔNG đẻ dòng thứ hai', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const id = await createSoftware(page, `SW-E2E-RH2-${stamp}`);

    const renewed = await page.request.post('/api/v1/expiry/renew', {
      headers: await writeHeaders(page),
      data: { kind: 'license', id, endDate: '2027-06-30' },
    });
    expect(renewed.status(), 'cửa cũ không được gãy').toBeLessThan(300);

    expect(renewalRowsFor(id), 'một lượt gia hạn = đúng một dòng sổ').toBe(1);
    expect(sql(`SELECT new_end::text FROM renewal_history WHERE object_id = '${id}'`)).toBe(
      '2027-06-30',
    );

    // Và `end_date` của hồ sơ thật sự đổi — sổ ghi đúng nhưng hồ sơ không đổi thì tệ hơn.
    expect(sql(`SELECT end_date::text FROM software WHERE id = '${id}'`)).toBe('2027-06-30');
  });

  /**
   * Gia hạn LÙI bị chặn ở `SoftwareService.renew`. Chặn rồi thì KHÔNG được để lại dòng sổ nào
   * — một dòng "đã gia hạn" cho việc chưa từng xảy ra là sổ nói dối, và bảng chỉ-thêm thì không
   * xóa được.
   */
  test('bị chặn vì gia hạn lùi thì không được để lại dòng sổ nào', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const id = await createSoftware(page, `SW-E2E-RH3-${stamp}`);

    const back = await page.request.post(`/api/v1/software/${id}/renew`, {
      headers: await writeHeaders(page),
      data: { endDate: '2026-01-01' },
    });
    expect(back.status()).toBe(400);
    expect(renewalRowsFor(id), 'gia hạn bị từ chối thì sổ phải sạch').toBe(0);
  });
});
