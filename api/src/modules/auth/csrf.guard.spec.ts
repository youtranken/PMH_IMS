import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { CsrfGuard } from './csrf.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { SessionService } from './session.service';

/**
 * `CsrfGuard` là lõi bảo mật (CLAUDE.md: không có test thì không merge).
 *
 * Guard có những nhánh CHO QUA mà không đỏ gì cả, nên mỗi nhánh được khoá bằng một bài kiểm kèm
 * mã lỗi: nếu một lượt refactor đổi hình dạng của nhánh, bài kiểm phải đỏ để người sửa biết mình
 * đang thay một đánh đổi chứ không phải vô tình phá nó.
 *
 *   · thiếu `APP_BASE_URL` ⇒ thôi kiểm nguồn (boot đã fail-fast, chỉ gặp ở test);
 *   · thiếu `Origin` ⇒ xét `Sec-Fetch-Site`, rồi `Referer`; route công khai (đăng nhập) mà không
 *     có tín hiệu nguồn nào thì CHẶN, vì ở đó lớp nguồn là lớp duy nhất (SEC-11, login-CSRF).
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
  const previousBaseUrl = process.env.APP_BASE_URL;
  beforeEach(() => {
    process.env.APP_BASE_URL = ORIGIN;
  });
  afterAll(() => {
    if (previousBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousBaseUrl;
  });

  const writeReq = (headers: Record<string, string | undefined>, sessionId?: string): FakeReq => ({
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
      guard(true).canActivate(contextFor(writeReq({ origin: 'https://ke-tan-cong.example' }))),
      'ORIGIN_MISMATCH',
    );
  });

  it('Origin khác hoa/thường và thừa dấu / vẫn được chấp nhận', async () => {
    await expect(
      guard().canActivate(contextFor(writeReq({ origin: 'HTTPS://IMS.PMH.COM.VN/', 'x-csrf-token': CSRF }, 's1'))),
    ).resolves.toBe(true);
  });

  /* ---------------- Thiếu Origin: tín hiệu nguồn dự phòng (SEC-11) ---------------- */

  it('KHÔNG có header Origin trên route cần phiên: lớp token vẫn đứng', async () => {
    await expect(
      guard().canActivate(contextFor(writeReq({ 'x-csrf-token': CSRF }, 's1'))),
    ).resolves.toBe(true);
    // Bỏ qua Origin KHÔNG phải bỏ qua cả guard.
    await expectForbidden(guard().canActivate(contextFor(writeReq({}, 's1'))), 'CSRF_TOKEN_INVALID');
  });

  it('login-CSRF: POST đăng nhập không có Origin, không Sec-Fetch-Site, không Referer ⇒ chặn', async () => {
    await expectForbidden(guard(true).canActivate(contextFor(writeReq({}))), 'ORIGIN_MISSING');
  });

  it.each(['cross-site', 'same-site'])(
    'Sec-Fetch-Site=%s mà thiếu Origin ⇒ chặn, kể cả khi có token đúng',
    async (site) => {
      await expectForbidden(
        guard(true).canActivate(contextFor(writeReq({ 'sec-fetch-site': site }))),
        'ORIGIN_MISMATCH',
      );
      await expectForbidden(
        guard().canActivate(contextFor(writeReq({ 'sec-fetch-site': site, 'x-csrf-token': CSRF }, 's1'))),
        'ORIGIN_MISMATCH',
      );
    },
  );

  it.each(['same-origin', 'none'])('Sec-Fetch-Site=%s mà thiếu Origin ⇒ route công khai cho qua', async (site) => {
    await expect(
      guard(true).canActivate(contextFor(writeReq({ 'sec-fetch-site': site }))),
    ).resolves.toBe(true);
  });

  it('Sec-Fetch-Site không nằm trong danh sách biết ⇒ chặn', async () => {
    await expectForbidden(
      guard(true).canActivate(contextFor(writeReq({ 'sec-fetch-site': 'la-lam' }))),
      'ORIGIN_MISMATCH',
    );
  });

  it('thiếu Origin lẫn Sec-Fetch-Site: Referer cùng gốc ⇒ qua, Referer lạ hoặc hỏng ⇒ chặn', async () => {
    await expect(
      guard(true).canActivate(contextFor(writeReq({ referer: `${ORIGIN}/login?next=%2F` }))),
    ).resolves.toBe(true);
    await expectForbidden(
      guard(true).canActivate(contextFor(writeReq({ referer: 'https://ke-tan-cong.example/ims.pmh.com.vn' }))),
      'ORIGIN_MISMATCH',
    );
    await expectForbidden(
      guard(true).canActivate(contextFor(writeReq({ referer: 'khong-phai-url' }))),
      'ORIGIN_MISMATCH',
    );
  });

  it('Origin có mặt thì thắng Referer: Origin lạ + Referer đúng vẫn chặn', async () => {
    await expectForbidden(
      guard(true).canActivate(
        contextFor(writeReq({ origin: 'https://ke-tan-cong.example', referer: `${ORIGIN}/login` })),
      ),
      'ORIGIN_MISMATCH',
    );
  });

  it('Origin "null" (iframe sandbox, file://) không được coi là thiếu Origin', async () => {
    await expectForbidden(
      guard(true).canActivate(contextFor(writeReq({ origin: 'null', 'sec-fetch-site': 'same-origin' }))),
      'ORIGIN_MISMATCH',
    );
  });

  it('thiếu APP_BASE_URL: bỏ qua lớp 1, lớp 2 vẫn đứng', async () => {
    delete process.env.APP_BASE_URL;
    await expectForbidden(
      guard().canActivate(contextFor(writeReq({ origin: 'https://ke-tan-cong.example' }, 's1'))),
      'CSRF_TOKEN_INVALID',
    );
  });

  /* ---------------- Lớp 2: token ---------------- */

  it('token đúng + Origin đúng ⇒ qua', async () => {
    await expect(
      guard().canActivate(contextFor(writeReq({ origin: ORIGIN, 'x-csrf-token': CSRF }, 's1'))),
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
      guard().canActivate(contextFor(writeReq(headers, 's1'))),
      'CSRF_TOKEN_INVALID',
    );
  });

  it('phiên không tìm thấy ⇒ chặn, không "không có phiên nên thôi"', async () => {
    await expectForbidden(
      guard(false, null).canActivate(contextFor(writeReq({ origin: ORIGIN, 'x-csrf-token': CSRF }, 's1'))),
      'CSRF_TOKEN_INVALID',
    );
  });

  it('route KHÔNG công khai mà không có sessionId ⇒ mã riêng CSRF_NO_SESSION', async () => {
    await expectForbidden(
      guard().canActivate(contextFor(writeReq({ origin: ORIGIN, 'x-csrf-token': CSRF }))),
      'CSRF_NO_SESSION',
    );
  });

  it('route công khai (đăng nhập) chỉ cần Origin đúng, không cần token', async () => {
    await expect(guard(true).canActivate(contextFor(writeReq({ origin: ORIGIN })))).resolves.toBe(true);
  });
});
