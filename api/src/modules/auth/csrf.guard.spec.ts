import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { CsrfGuard } from './csrf.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { SessionService } from './session.service';

/**
 * `CsrfGuard` — LÕI BẢO MẬT, VÀ KHÔNG CÓ BÀI KIỂM NÀO CHO TỚI 20/09/2026.
 *
 * `CLAUDE.md` liệt CSRF vào danh sách "không có test thì không được merge". Guard này 84 dòng
 * và có **hai nhánh bỏ qua IM LẶNG** mà không ai canh (rà soát 19/09, mục A-10):
 *
 *   · `if (!expected) return;`  — thiếu `APP_BASE_URL` ⇒ thôi kiểm Origin
 *   · `if (!origin) return;`    — client không gửi `Origin` ⇒ thôi kiểm Origin
 *
 * Cả hai là đánh đổi CÓ Ý (boot đã fail-fast nếu thiếu biến; vài trình duyệt cũ không gửi
 * `Origin` cho request cùng gốc). Nhưng "có ý" mà không có bài kiểm thì lượt refactor sau
 * không phân biệt được nó với một lỗ hổng, và cả hai đều **âm thầm cho qua** — lớp hỏng tệ
 * nhất, vì không có gì đỏ cả.
 *
 * File này khoá hình dạng của từng nhánh, kèm mã lỗi, để chúng thôi là chuyện truyền miệng.
 */

const CSRF = 'token-that-hop-le';

interface FakeReq {
  method: string;
  headers: Record<string, string | undefined>;
  user?: { sessionId?: string };
}

function contextFor(req: FakeReq): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function guard(isPublic = false, session: { csrfToken: string } | null = { csrfToken: CSRF }) {
  const reflector = {
    getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? isPublic : undefined),
  } as unknown as Reflector;
  const sessions = { find: () => Promise.resolve(session) } as unknown as SessionService;
  return new CsrfGuard(reflector, sessions);
}

async function expectForbidden(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toBeInstanceOf(ForbiddenException);
  await p.catch((error: ForbiddenException) => {
    expect(error.getResponse()).toMatchObject({ code });
  });
}

const ORIGIN = 'https://ims.pmh.com.vn';

describe('CsrfGuard — AD-8, hai lớp', () => {
  const truoc = process.env.APP_BASE_URL;
  beforeEach(() => {
    process.env.APP_BASE_URL = ORIGIN;
  });
  afterAll(() => {
    if (truoc === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = truoc;
  });

  const ghi = (headers: Record<string, string | undefined>, sessionId?: string): FakeReq => ({
    method: 'POST',
    headers,
    user: sessionId ? { sessionId } : undefined,
  });

  /* ---------------- Lượt ĐỌC không bị kiểm ---------------- */

  it.each(['GET', 'HEAD', 'OPTIONS'])('%s đi thẳng: CSRF chỉ canh lượt GHI', async (method) => {
    const req: FakeReq = { method, headers: { origin: 'https://ke-tan-cong.example' } };
    await expect(guard().canActivate(contextFor(req))).resolves.toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s BỊ kiểm', async (method) => {
    const req: FakeReq = { method, headers: { origin: 'https://ke-tan-cong.example' } };
    await expectForbidden(guard().canActivate(contextFor(req)), 'ORIGIN_MISMATCH');
  });

  /* ---------------- Lớp 1: Origin ---------------- */

  it('Origin lạ bị chặn TRƯỚC cả khi xét token — kể cả route công khai', async () => {
    // Thứ tự quan trọng: `assertOrigin` chạy trước nhánh `isPublic`. Màn đăng nhập chưa có
    // phiên nào, nên Origin là lớp DUY NHẤT bảo vệ nó.
    await expectForbidden(
      guard(true).canActivate(contextFor(ghi({ origin: 'https://ke-tan-cong.example' }))),
      'ORIGIN_MISMATCH',
    );
  });

  it('Origin khác hoa/thường và thừa dấu / vẫn được chấp nhận', async () => {
    await expect(
      guard().canActivate(contextFor(ghi({ origin: 'HTTPS://IMS.PMH.COM.VN/', 'x-csrf-token': CSRF }, 's1'))),
    ).resolves.toBe(true);
  });

  /*
   * ===== HAI NHÁNH BỎ QUA IM LẶNG =====
   * Khoá lại đúng hình dạng hiện tại. Nếu một ngày quyết siết (ví dụ đòi `Origin` bắt buộc),
   * hai bài này sẽ ĐỎ — và đó là lời nhắc rằng đánh đổi cũ đang được thay, chứ không phải
   * vô tình bị thay.
   */
  it('KHÔNG có header Origin: bỏ qua lớp 1, vẫn kiểm token (đánh đổi có ý)', async () => {
    await expect(
      guard().canActivate(contextFor(ghi({ 'x-csrf-token': CSRF }, 's1'))),
    ).resolves.toBe(true);
    // ...nhưng thiếu token thì vẫn chặn — bỏ qua Origin KHÔNG phải bỏ qua cả guard.
    await expectForbidden(guard().canActivate(contextFor(ghi({}, 's1'))), 'CSRF_TOKEN_INVALID');
  });

  it('thiếu APP_BASE_URL: bỏ qua lớp 1, lớp 2 vẫn đứng', async () => {
    delete process.env.APP_BASE_URL;
    await expectForbidden(
      guard().canActivate(contextFor(ghi({ origin: 'https://ke-tan-cong.example' }, 's1'))),
      'CSRF_TOKEN_INVALID',
    );
  });

  /* ---------------- Lớp 2: token ---------------- */

  it('token đúng + Origin đúng ⇒ qua', async () => {
    await expect(
      guard().canActivate(contextFor(ghi({ origin: ORIGIN, 'x-csrf-token': CSRF }, 's1'))),
    ).resolves.toBe(true);
  });

  it.each([
    ['thiếu hẳn', undefined],
    ['rỗng', ''],
    ['sai', 'token-sai'],
    ['đúng tiền tố nhưng ngắn hơn', CSRF.slice(0, 5)],
    ['đúng nội dung nhưng dài hơn', `${CSRF}x`],
  ])('token %s ⇒ chặn', async (_ten, token) => {
    const headers: Record<string, string | undefined> = { origin: ORIGIN };
    if (token !== undefined) headers['x-csrf-token'] = token;
    await expectForbidden(
      guard().canActivate(contextFor(ghi(headers, 's1'))),
      'CSRF_TOKEN_INVALID',
    );
  });

  it('phiên không tìm thấy ⇒ chặn, không "không có phiên nên thôi"', async () => {
    await expectForbidden(
      guard(false, null).canActivate(contextFor(ghi({ origin: ORIGIN, 'x-csrf-token': CSRF }, 's1'))),
      'CSRF_TOKEN_INVALID',
    );
  });

  it('route KHÔNG công khai mà không có sessionId ⇒ mã riêng CSRF_NO_SESSION', async () => {
    await expectForbidden(
      guard().canActivate(contextFor(ghi({ origin: ORIGIN, 'x-csrf-token': CSRF }))),
      'CSRF_NO_SESSION',
    );
  });

  it('route công khai (đăng nhập) chỉ cần Origin đúng, không cần token', async () => {
    await expect(guard(true).canActivate(contextFor(ghi({ origin: ORIGIN })))).resolves.toBe(true);
  });
});
