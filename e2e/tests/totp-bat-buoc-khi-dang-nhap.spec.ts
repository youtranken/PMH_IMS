import { expect, test } from '@playwright/test';
import {
  E2E_MEMBER,
  E2E_SA,
  NEW_PASSWORD,
  firstLogin,
  resetUsers,
  sql,
  writeHeaders,
} from './helpers';

/**
 * CÔNG TẮC `totp_login_required` — endpoint GHI cuối cùng chưa có bài kiểm nào.
 *
 * ===== VÌ SAO NÓ ĐÁNG MỘT BÀI RIÊNG =====
 *
 * Đây là công tắc HẠ MỨC BẢO VỆ đăng nhập, và nó nằm trong tay đúng một người (SA). Tắt đi
 * thì `login()` dựng phiên với `totpPending: false` — nghĩa là mật khẩu suông là vào thẳng,
 * không còn bước hai. Ai chiếm được tài khoản SA có thể tắt lớp thứ hai của người khác rồi
 * đăng nhập bằng mật khẩu lấy được từ nơi khác, và người bị tắt KHÔNG thấy gì bất thường trên
 * màn hình của họ.
 *
 * Rà soát 07/09 xếp nó vào nhóm "12 endpoint ghi có 0 test". Đếm lại 09/09 sau khi đã vá
 * `reset-password`, `reset-totp`, break-glass `deny`/`revoke`: trong 73 endpoint ghi của repo,
 * đây là cái CUỐI CÙNG không có bài kiểm nào chạm tới.
 *
 * ===== ĐO HIỆU LỰC, KHÔNG ĐO MÃ TRẢ VỀ =====
 *
 * Một `PATCH` trả 200 mà không đổi gì là cái nút không làm gì cả. Nên bài này bắn thẳng
 * `POST /auth/login` sau mỗi lần bật/tắt và đọc `status` — `totp_required` hay
 * `authenticated`. Đó là câu trả lời của chính hàng rào, không phải của cột trong DB.
 */

test.beforeEach(() => {
  resetUsers();
});

function memberId(): string {
  return sql(`SELECT id FROM users WHERE email = '${E2E_MEMBER.email}'`);
}

function requiredFlag(): string {
  return sql(`SELECT totp_login_required FROM users WHERE email = '${E2E_MEMBER.email}'`);
}

/**
 * Đếm dòng sổ của công tắc này. Trả về số TUYỆT ĐỐI, và nơi gọi phải so CHÊNH LỆCH.
 *
 * `audit_log` là bảng CHỈ-THÊM (NFR-03) nên `resetUsers()` không xóa được nó — số chỉ có thể
 * cộng dồn qua từng lượt chạy. Chốt một con số tuyệt đối là bài kiểm xanh đúng lần đầu rồi đỏ
 * mãi mãi. (Đúng bẫy đã dính ở `account-locked-guard` hôm trước.)
 */
function auditCount(id: string): number {
  return Number(
    sql(
      `SELECT count(*) FROM audit_log WHERE action = 'account.totp_login_required.changed'` +
        ` AND object_id = '${id}'`,
    ),
  );
}

test.describe('SA bật/tắt bắt buộc TOTP lúc đăng nhập', () => {
  test('tắt → mật khẩu suông vào thẳng; bật lại → chặn ở bước hai', async ({ page, browser }) => {
    test.setTimeout(150_000);
    // Member phải qua lần đăng nhập đầu (đổi mật khẩu + cài TOTP) thì mới có mật khẩu ổn định.
    const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await memberContext.newPage();
    await firstLogin(memberPage, E2E_MEMBER);
    const password = sql(
      `SELECT must_change_password FROM users WHERE email = '${E2E_MEMBER.email}'`,
    );
    expect(password, 'firstLogin phải đổi xong mật khẩu, nếu không bài này đo nhầm').toBe('f');

    await firstLogin(page, E2E_SA);
    const id = memberId();
    expect(requiredFlag(), 'mặc định của tài khoản E2E phải là BẬT').toBe('t');
    const auditBefore = auditCount(id);

    // --- TẮT ---
    const off = await page.request.patch(`/api/v1/accounts/${id}/totp-login-required`, {
      headers: await writeHeaders(page),
      data: { required: false },
    });
    expect(off.status()).toBeLessThan(300);
    expect(requiredFlag()).toBe('f');

    /*
     * CÂU CHỐT THỨ NHẤT. Đăng nhập mới, mật khẩu suông: server phải cấp phiên ĐÃ XÁC THỰC
     * ngay, không còn bước hai. Đây chính là mức bảo vệ vừa bị hạ.
     */
    const plain = await memberPage.request.post('/api/v1/auth/login', {
      headers: { Origin: new URL(page.url()).origin },
      data: { email: E2E_MEMBER.email, password: NEW_PASSWORD },
    });
    expect(plain.status()).toBe(200);
    expect((await plain.json()) as { status: string }).toMatchObject({
      status: 'authenticated',
    });

    // --- BẬT LẠI ---
    const on = await page.request.patch(`/api/v1/accounts/${id}/totp-login-required`, {
      headers: await writeHeaders(page),
      data: { required: true },
    });
    expect(on.status()).toBeLessThan(300);
    expect(requiredFlag()).toBe('t');

    /*
     * CÂU CHỐT THỨ HAI, và là vế đối chứng: thiếu nó thì một bản vá thô bạo (bỏ hẳn cờ, luôn
     * trả `authenticated`) vẫn xanh ở trên.
     */
    const guarded = await memberPage.request.post('/api/v1/auth/login', {
      headers: { Origin: new URL(page.url()).origin },
      data: { email: E2E_MEMBER.email, password: NEW_PASSWORD },
    });
    expect(guarded.status()).toBe(200);
    expect((await guarded.json()) as { status: string }).toMatchObject({
      status: 'totp-required',
    });

    // Mỗi lần gạt công tắc phải để lại MỘT dòng sổ — đây là thứ trả lời "ai đã hạ hàng rào".
    expect(auditCount(id) - auditBefore, 'hai lần gạt = hai dòng sổ').toBe(2);

    await memberContext.close();
  });

  test('đường hỏng: chỉ SA gạt được — member tự tắt lớp bảo vệ của mình thì bị chặn', async ({
    page,
  }) => {
    await firstLogin(page, E2E_MEMBER);
    const id = memberId();
    const res = await page.request.patch(`/api/v1/accounts/${id}/totp-login-required`, {
      headers: await writeHeaders(page),
      data: { required: false },
    });
    expect(res.status(), 'member không được tự hạ hàng rào của chính mình').toBe(403);
    expect(requiredFlag(), 'và cờ phải nguyên vẹn').toBe('t');
  });
});
