import {
  CODE_MAX_FAILED,
  CODE_MAX_SENDS,
  CODE_TTL_MS,
  codeHash,
  codeMatches,
  generateCode,
  judgeCode,
} from './break-glass-code';

/**
 * Lõi mã duyệt mở két (Q-30): sinh mã, băm, và phán một lượt nhập. Logic thuần, test bảng dữ liệu;
 * đường DB (khoá hàng, cộng lượt sai, huỷ yêu cầu) nằm ở `api/test/break-glass-code.spec.ts`.
 */

const KEY = Buffer.alloc(32, 7);
const ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-20T08:00:00Z');

describe('hằng số của Q-30 viết cố định, không đọc system_config', () => {
  it('mã sống đúng 10 phút, gửi tối đa 1 + 3 lần, sai 5 lần thì huỷ', () => {
    expect(CODE_TTL_MS).toBe(10 * 60_000);
    expect(CODE_MAX_SENDS).toBe(4);
    expect(CODE_MAX_FAILED).toBe(5);
  });
});

describe('generateCode', () => {
  it.each([
    [0, '000000'],
    [42, '000042'],
    [999_999, '999999'],
  ])('số ngẫu nhiên %d → "%s" (luôn đủ 6 chữ số)', (n, code) => {
    expect(generateCode(() => n)).toBe(code);
  });

  it('nguồn ngẫu nhiên thật cho ra mã 6 chữ số, không lặp lại một giá trị cố định', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateCode()));
    for (const code of seen) expect(code).toMatch(/^\d{6}$/);
    expect(seen.size).toBeGreaterThan(40);
  });
});

describe('codeHash / codeMatches', () => {
  it('băm ra 64 chữ số hex, không chứa mã rõ', () => {
    const hash = codeHash(KEY, ID, '123456');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('123456');
  });

  it.each([
    ['đúng mã, đúng yêu cầu', '123456', ID, true],
    ['sai một chữ số', '123457', ID, false],
    ['mã đúng nhưng của yêu cầu khác', '123456', '22222222-2222-4222-8222-222222222222', false],
    ['có khoảng trắng hai đầu vẫn nhận', ' 123456 ', ID, true],
    ['không phải 6 chữ số', '12345', ID, false],
    ['chữ thay số', '12345a', ID, false],
  ])('%s', (_label, typed, forId, expected) => {
    const stored = codeHash(KEY, ID, '123456');
    expect(codeMatches(KEY, forId, typed, stored)).toBe(expected);
  });

  it('khoá khác (master key đã xoay) thì mã cũ không còn khớp', () => {
    const stored = codeHash(KEY, ID, '123456');
    expect(codeMatches(Buffer.alloc(32, 8), ID, '123456', stored)).toBe(false);
  });
});

describe('judgeCode — phán một lượt nhập', () => {
  const live = {
    codeHash: codeHash(KEY, ID, '123456'),
    codeExpiresAt: new Date(NOW.getTime() + 60_000),
    failedAttempts: 0,
  };

  it.each([
    ['đúng mã còn hạn', live, '123456', 'ok'],
    ['sai mã', live, '000000', 'wrong'],
    ['sai tới lượt thứ 5', { ...live, failedAttempts: 4 }, '000000', 'locked'],
    ['đã sai đủ 5 lần thì mã đúng cũng không nhận', { ...live, failedAttempts: 5 }, '123456', 'locked'],
    ['chưa gửi mã (đang chờ thư)', { ...live, codeHash: null, codeExpiresAt: null }, '123456', 'not_sent'],
    ['quá 10 phút', { ...live, codeExpiresAt: new Date(NOW.getTime() - 1) }, '123456', 'expired'],
    ['đúng mốc hết hạn là đã hết', { ...live, codeExpiresAt: NOW }, '123456', 'expired'],
  ])('%s → %s', (_label, row, typed, verdict) => {
    expect(judgeCode(KEY, ID, typed, row, NOW).verdict).toBe(verdict);
  });

  it('mã hết hạn thì KHÔNG so mã và không tính lượt sai (không thành máy dò mã cũ)', () => {
    const expired = { ...live, codeExpiresAt: new Date(NOW.getTime() - 1) };
    expect(judgeCode(KEY, ID, '000000', expired, NOW)).toEqual({ verdict: 'expired', failedAttempts: 0 });
  });

  it('worker gửi lại CÙNG lượt (thư trước có thể đã tới tay người duyệt): mã của thư trước vẫn đúng', () => {
    const retried = { ...live, codeHash: codeHash(KEY, ID, '654321'), prevCodeHash: codeHash(KEY, ID, '123456') };
    expect(judgeCode(KEY, ID, '123456', retried, NOW).verdict).toBe('ok');
    expect(judgeCode(KEY, ID, '654321', retried, NOW).verdict).toBe('ok');
    expect(judgeCode(KEY, ID, '111111', retried, NOW).verdict).toBe('wrong');
  });

  it('khoá của mã không còn (master key đã xoay và gỡ): coi như hết hạn, KHÔNG trừ lượt', () => {
    expect(judgeCode(null, ID, '123456', live, NOW)).toEqual({ verdict: 'expired', failedAttempts: 0 });
  });

  it('lượt sai trả số lượt sai mới để nơi gọi ghi xuống', () => {
    expect(judgeCode(KEY, ID, '000000', { ...live, failedAttempts: 2 }, NOW)).toEqual({
      verdict: 'wrong',
      failedAttempts: 3,
    });
  });
});
