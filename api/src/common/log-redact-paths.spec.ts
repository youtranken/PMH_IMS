import pino from 'pino';
import { LOG_REDACT_PATHS } from './log-redact';

/**
 * SEC-07 — log HTTP không được chở token phiên. Cookie đi VÀO ở `req.headers.cookie`, và đi RA ở
 * `res.headers["set-cookie"]` lúc đăng nhập/qua TOTP; che một chiều là lộ chiều kia.
 */
function logged(obj: Record<string, unknown>): string {
  let out = '';
  const logger = pino(
    { redact: LOG_REDACT_PATHS },
    { write: (chunk: string) => { out += chunk; } },
  );
  logger.info(obj, 'probe');
  return out;
}

describe('LOG_REDACT_PATHS', () => {
  it.each([
    ['cookie gửi lên', { req: { headers: { cookie: 'ims_session=TOKEN_IN' } } }, 'TOKEN_IN'],
    ['cookie trả về', { res: { headers: { 'set-cookie': 'ims_session=TOKEN_OUT; HttpOnly' } } }, 'TOKEN_OUT'],
    ['CSRF token', { req: { headers: { 'x-csrf-token': 'CSRF_VAL' } } }, 'CSRF_VAL'],
    ['mật khẩu', { req: { body: { password: 'PW_VAL' } } }, 'PW_VAL'],
    ['giá trị két', { req: { body: { value: 'SECRET_VAL' } } }, 'SECRET_VAL'],
  ])('%s không lọt vào log', (_name, obj, needle) => {
    expect(logged(obj)).not.toContain(needle);
  });
});
