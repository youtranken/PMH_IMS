import { normalizeTotpSeed, totpRevealView } from './totp-seed';

/**
 * Ngăn "Mã 2 lớp" (Q-18): chuỗi cất vào két luôn là MỘT dạng `otpauth://totp/…` đã chuẩn hoá,
 * dù người dùng dán khoá base32 trần hay nguyên URI đọc từ ảnh QR.
 */

const FALLBACK = { label: 'Fortinet admin', username: 'admin@pmh' };
/** RFC 6238 phụ lục B — khoá ASCII "12345678901234567890". */
const RFC_SHA1 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_SHA256 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
const RFC_SHA512 =
  'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA';

describe('normalizeTotpSeed — nhận khoá trần hoặc otpauth, cất một dạng', () => {
  it.each([
    ['khoá trần viết hoa', 'JBSWY3DPEHPK3PXP'],
    ['khoá trần viết thường, có dấu cách nhóm 4', 'jbsw y3dp ehpk 3pxp'],
    ['khoá trần có gạch nối và đệm =', 'JBSW-Y3DP-EHPK-3PXP=='],
  ])('%s → URI dựng từ tên ngăn + tên đăng nhập', (_name, raw) => {
    const out = normalizeTotpSeed(raw, FALLBACK);
    expect(out.reason).toBeNull();
    expect(out.value).toBe(
      'otpauth://totp/Fortinet%20admin:admin%40pmh?secret=JBSWY3DPEHPK3PXP' +
        '&issuer=Fortinet%20admin&algorithm=SHA1&digits=6&period=30',
    );
    expect(out.secret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('khoá trần mà ngăn không có tên đăng nhập → tài khoản là tên ngăn', () => {
    const out = normalizeTotpSeed('JBSWY3DPEHPK3PXP', { label: 'VPN', username: null });
    expect(out.value).toBe(
      'otpauth://totp/VPN:VPN?secret=JBSWY3DPEHPK3PXP&issuer=VPN&algorithm=SHA1&digits=6&period=30',
    );
  });

  it('URI đầy đủ: giữ issuer + tài khoản của URI, bỏ qua tên ngăn', () => {
    const out = normalizeTotpSeed(
      'otpauth://totp/ACME%20Co:john%40example.com?secret=jbswy3dpehpk3pxp&issuer=ACME%20Co&digits=8&algorithm=sha256',
      FALLBACK,
    );
    expect(out.reason).toBeNull();
    expect(out.value).toBe(
      'otpauth://totp/ACME%20Co:john%40example.com?secret=JBSWY3DPEHPK3PXP' +
        '&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=30',
    );
  });

  it('URI không có issuer: tiền tố của nhãn là issuer', () => {
    const out = normalizeTotpSeed('otpauth://totp/GitHub:dev?secret=JBSWY3DPEHPK3PXP', FALLBACK);
    expect(out.value).toBe(
      'otpauth://totp/GitHub:dev?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA1&digits=6&period=30',
    );
  });

  it('URI nhãn trống: mượn tên ngăn + tên đăng nhập', () => {
    const out = normalizeTotpSeed('OTPAUTH://TOTP/?secret=JBSWY3DPEHPK3PXP', FALLBACK);
    expect(out.value).toBe(
      'otpauth://totp/Fortinet%20admin:admin%40pmh?secret=JBSWY3DPEHPK3PXP' +
        '&issuer=Fortinet%20admin&algorithm=SHA1&digits=6&period=30',
    );
  });

  it('chuẩn hoá hai lần ra cùng một chuỗi (xoay giá trị đưa lại chính URI đã cất)', () => {
    const once = normalizeTotpSeed('jbsw y3dp ehpk 3pxp', FALLBACK).value!;
    expect(normalizeTotpSeed(once, { label: 'khác', username: null }).value).toBe(once);
  });

  it.each([
    ['rỗng', '   ', 'EMPTY'],
    ['ký tự ngoài base32 (0, 1, 8)', 'JBSWY3DPEHPK3PX0', 'BAD_SECRET'],
    ['quá ngắn (dưới 80 bit)', 'JBSWY3DP', 'SECRET_LENGTH'],
    ['quá dài (trên 64 byte)', 'A'.repeat(120), 'SECRET_LENGTH'],
    ['HOTP không phải TOTP', 'otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1', 'NOT_TOTP'],
    ['URI thiếu secret', 'otpauth://totp/x?issuer=y', 'BAD_SECRET'],
    ['URI hỏng', 'otpauth://', 'BAD_URI'],
    ['digits 7', 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=7', 'BAD_DIGITS'],
    ['period 60', 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=60', 'BAD_PERIOD'],
    ['thuật toán MD5', 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5', 'BAD_ALGORITHM'],
    ['link web thường', 'https://example.com/?secret=JBSWY3DPEHPK3PXP', 'BAD_SECRET'],
  ])('từ chối: %s', (_name, raw, reason) => {
    const out = normalizeTotpSeed(raw, FALLBACK);
    expect(out.reason).toBe(reason);
    expect(out.value).toBeNull();
  });
});

describe('totpRevealView — QR + mã hiện tại, server tính', () => {
  const uri = (secret: string, algorithm: string, digits: number) =>
    `otpauth://totp/RFC:test?secret=${secret}&issuer=RFC&algorithm=${algorithm}&digits=${digits}&period=30`;

  it.each([
    // RFC 6238 phụ lục B, T = 59 giây.
    [RFC_SHA1, 'SHA1', 8, '94287082'],
    [RFC_SHA256, 'SHA256', 8, '46119246'],
    [RFC_SHA512, 'SHA512', 8, '90693936'],
    [RFC_SHA1, 'SHA1', 6, '287082'],
  ])('vector RFC 6238: %s %s %d số', async (secret, algorithm, digits, code) => {
    const view = await totpRevealView(uri(secret, algorithm, digits), new Date(59_000), 10);
    expect(view.codes[0]).toBe(code);
    expect(view.digits).toBe(digits);
  });

  it('mã theo từng chu kỳ phủ hết thời gian hiện, giây còn lại tính từ mốc server', async () => {
    // T = 59: còn 1 giây của chu kỳ đầu; hiện 60 giây → cần thêm 2 chu kỳ nữa.
    const view = await totpRevealView(uri(RFC_SHA1, 'SHA1', 8), new Date(59_000), 60);
    expect(view.secondsLeft).toBe(1);
    expect(view.codes).toHaveLength(3);
    // RFC 6238: T = 1111111109 (chu kỳ 37037036) → 07081804; chu kỳ kế tiếp khác mã đầu.
    const later = await totpRevealView(uri(RFC_SHA1, 'SHA1', 8), new Date(1_111_111_109_000), 30);
    expect(later.codes[0]).toBe('07081804');
    expect(later.codes[1]).not.toBe(later.codes[0]);
  });

  it('trả khoá, issuer, tài khoản để hiện; QR là ảnh data URL PNG', async () => {
    const view = await totpRevealView(uri(RFC_SHA1, 'SHA1', 6), new Date(0), 60);
    expect(view.secret).toBe(RFC_SHA1);
    expect(view.issuer).toBe('RFC');
    expect(view.account).toBe('test');
    expect(view.qrDataUrl).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  });
});
