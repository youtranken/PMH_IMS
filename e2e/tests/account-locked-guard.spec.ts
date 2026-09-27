import { expect, test } from '@playwright/test';
import {
  APP_ORIGIN,
  E2E_SA,
  firstLogin,
  resetUsers,
  sql,
  writeHeaders,
  uniqueStamp,
} from './helpers';

/**
 * SA BẤM "KHÓA TÀI KHOẢN" MÀ NGƯỜI ĐÓ VẪN ĐĂNG NHẬP ĐƯỢC.
 *
 * ===== CHUYỆN GÌ XẢY RA TRƯỚC 09/09 =====
 *
 * `users.status` có ba giá trị: `active` · `locked` · `disabled`. Màn Tài khoản cho SA đặt cả
 * ba, và `accounts.controller.ts` nhận cả ba qua `@IsIn`. Nhưng `auth.service.login()` chỉ
 * kiểm đúng MỘT:
 *
 *     if (user.status === 'disabled') { ...chặn... }
 *
 * `locked` rơi thẳng qua. Hàng rào duy nhất mang tên "locked" trong luồng đăng nhập là
 * `isLocked(failedAttempts, lockedUntil)` — bộ đếm sai mật khẩu TỰ ĐỘNG, không liên quan gì
 * tới việc SA khóa tay.
 *
 * ===== VÌ SAO ĐÂY LÀ LỖ BẢO MẬT, KHÔNG PHẢI LỖI HIỂN THỊ =====
 *
 * "Khóa tài khoản" là việc người ta làm khi nghi tài khoản bị chiếm, hoặc khi nhân viên vừa
 * nghỉ việc. Bấm xong, màn hiện trạng thái "Khóa", nhật ký ghi một dòng, SA đóng máy về.
 * Người kia vẫn đăng nhập bình thường — và không có gì trên hệ thống mâu thuẫn với niềm tin
 * rằng đã khóa xong. Đúng lớp lỗi mà rà soát 07/09 gọi tên: hệ thống nói một đằng, làm một nẻo,
 * và người dùng không có cách nào biết.
 *
 * Cộng thêm một vế mà rà soát nêu: `login` chạy tiếp thì bộ đếm sai bị XÓA và nhật ký ghi
 * `auth.login.ok` — một lần đăng nhập THÀNH CÔNG cho một tài khoản đang bị khóa.
 */

test.beforeEach(() => {
  resetUsers();
});

/** Tài khoản dùng một lần cho bài này — không đụng vào E2E_SA mà mọi bài khác đang dùng. */
async function makeMember(page: import('@playwright/test').Page, stamp: string) {
  const email = `e2e-tao-moi-khoa-${stamp}@pmh.local`;
  const res = await page.request.post('/api/v1/accounts', {
    headers: await writeHeaders(page),
    data: { email, fullName: 'Nguoi bi khoa', role: 'member' },
  });
  expect(res.status(), 'tạo tài khoản phụ để thử').toBe(201);
  const created = (await res.json()) as { temporaryPassword: string };
  return { email, password: created.temporaryPassword };
}

async function tryLogin(page: import('@playwright/test').Page, email: string, password: string) {
  return page.request.post('/api/v1/auth/login', {
    headers: { Origin: APP_ORIGIN },
    data: { email, password },
    failOnStatusCode: false,
  });
}

test.describe('Tài khoản bị SA khóa thì không đăng nhập được', () => {
  test('status = locked → login bị từ chối, và KHÔNG ghi auth.login.ok', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const who = await makeMember(page, stamp);

    // Mật khẩu tạm dùng được khi tài khoản còn `active` — chốt này giữ cho vế sau có nghĩa.
    expect((await tryLogin(page, who.email, who.password)).status(), 'còn active thì vào được')
      .toBeLessThan(400);

    /*
     * Đếm TRƯỚC/SAU thay vì lọc theo mốc thời gian.
     *
     * Bản đầu dùng `created_at >= '${sql('SELECT now()')}'`: chuỗi thời gian có dấu cách và
     * hậu tố múi giờ, đi qua hai lớp trích dẫn (shell → psql) rồi hỏng lặng lẽ — câu đếm trả
     * về 28793, tức là mất luôn cả mệnh đề lọc. Một assertion đếm sai kiểu đó nguy hiểm hơn
     * không có assertion: nó vẫn đỏ/xanh, chỉ là không nói về thứ mình tưởng.
     */
    const okCount = () =>
      Number(
        sql(
          `SELECT count(*) FROM audit_log WHERE action = 'auth.login.ok' AND actor = '${who.email}'`,
        ),
      );
    const before = okCount();

    sql(`UPDATE users SET status = 'locked' WHERE email = '${who.email}'`);

    const res = await tryLogin(page, who.email, who.password);
    expect(res.status(), 'SA đã khóa thì phải bị từ chối').toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe('ACCOUNT_LOCKED');

    /*
     * Vế nhật ký là vế dễ quên nhất, và là vế khiến lỗi cũ vô hình: nếu `login` chạy tiếp thì
     * nó ghi một dòng ĐĂNG NHẬP THÀNH CÔNG cho tài khoản đang bị khóa. Người đọc nhật ký sau
     * này sẽ tin rằng khóa không có tác dụng gì — hoặc tệ hơn, không nhận ra có chuyện.
     */
    expect(okCount(), 'không được ghi thêm lần đăng nhập thành công nào').toBe(before);
  });

  test('status = disabled vẫn bị chặn như cũ, và bằng MÃ LỖI RIÊNG', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const who = await makeMember(page, stamp);

    sql(`UPDATE users SET status = 'disabled' WHERE email = '${who.email}'`);
    const res = await tryLogin(page, who.email, who.password);
    expect(res.status()).toBe(401);
    /*
     * Hai mã khác nhau, có chủ ý: "khóa" là tạm và mở lại được, "vô hiệu hóa" là dứt điểm.
     * Gộp làm một thì người trực không biết nên bảo người dùng chờ hay bảo họ gặp SA.
     */
    expect(((await res.json()) as { code?: string }).code).toBe('ACCOUNT_DISABLED');
  });

  /**
   * Vế đối chứng — và là vế chặn bản vá thô bạo.
   *
   * Chặn theo `status !== 'active'` thì tài khoản mở khóa lại vẫn chết, vì một trạng thái mới
   * thêm về sau sẽ mặc định bị cấm. Bài này chốt rằng mở khóa là mở thật.
   */
  test('mở khóa (về active) thì đăng nhập lại được ngay', async ({ page }) => {
    await firstLogin(page, E2E_SA);
    const stamp = uniqueStamp();
    const who = await makeMember(page, stamp);

    sql(`UPDATE users SET status = 'locked' WHERE email = '${who.email}'`);
    expect((await tryLogin(page, who.email, who.password)).status()).toBe(401);

    sql(`UPDATE users SET status = 'active' WHERE email = '${who.email}'`);
    expect(
      (await tryLogin(page, who.email, who.password)).status(),
      'mở khóa rồi thì vào được ngay, không phải chờ hết cửa sổ nào',
    ).toBeLessThan(400);
  });
});
