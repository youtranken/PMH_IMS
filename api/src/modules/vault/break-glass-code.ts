import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Mã duyệt "Xin mở két" (Q-30).
 *
 * Ba con số dưới đây viết cố định trong code, KHÔNG đưa vào `system_config`: đây là ngoại lệ có
 * chủ ý của AD-11. Nới được từ màn Tham số thì một tài khoản SA bị chiếm đủ để biến mã 10 phút
 * thành vé mở két cả ngày, hoặc mở thêm lượt đoán.
 */
export const CODE_TTL_MS = 10 * 60_000;
/** Lần gửi đầu + 3 lần "Gửi lại mã". Khớp CHECK `send_no BETWEEN 1 AND 4` của migration 0074. */
export const CODE_MAX_SENDS = 4;
/** Cộng dồn qua mọi lần gửi lại: 5 lượt đoán cho cả yêu cầu, không phải cho mỗi mã. */
export const CODE_MAX_FAILED = 5;

/** `info` của khoá HMAC dẫn xuất từ master key — đổi chuỗi này là mọi mã đang sống mất hiệu lực. */
export const CODE_KEY_INFO = 'break-glass-code|v1';

const SHAPE = /^\d{6}$/;

/** Mã 6 chữ số từ CSPRNG. `pick` chỉ để test bảng dữ liệu cho các mốc biên. */
export function generateCode(pick: () => number = () => randomInt(0, 1_000_000)): string {
  return String(pick()).padStart(6, '0');
}

/**
 * HMAC gắn mã với ĐÚNG yêu cầu: lộ một hash cũng không dùng được cho yêu cầu khác. Băm thường
 * (không khoá) thì 10⁶ khả năng dò ngược trong tích tắc từ bản backup DB.
 */
export function codeHash(key: Buffer, approvalId: string, code: string): string {
  return createHmac('sha256', key).update(`${approvalId}|${code}`).digest('hex');
}

export function codeMatches(key: Buffer, approvalId: string, typed: string, stored: string): boolean {
  const code = typed.trim();
  if (!SHAPE.test(code)) return false;
  const expected = Buffer.from(stored, 'hex');
  const actual = Buffer.from(codeHash(key, approvalId, code), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export type CodeVerdict = 'ok' | 'wrong' | 'locked' | 'not_sent' | 'expired';

export interface CodeState {
  codeHash: string | null;
  codeExpiresAt: Date | null;
  failedAttempts: number;
}

/**
 * Phán một lượt nhập. Trả MỘT hình dạng: `failedAttempts` là số lượt sai SAU lượt này, nơi gọi
 * ghi lại đúng con số đó.
 *
 * Thứ tự kiểm có chủ ý: đã khoá thì không so nữa (mã đúng sau 5 lần sai cũng không nhận); mã hết
 * hạn hay chưa gửi thì không so và không tính lượt, để không ai dùng màn này dò mã của lượt cũ.
 */
export function judgeCode(
  key: Buffer,
  approvalId: string,
  typed: string,
  state: CodeState,
  now: Date,
): { verdict: CodeVerdict; failedAttempts: number } {
  const failed = state.failedAttempts;
  if (failed >= CODE_MAX_FAILED) return { verdict: 'locked', failedAttempts: failed };
  if (!state.codeHash || !state.codeExpiresAt) return { verdict: 'not_sent', failedAttempts: failed };
  if (state.codeExpiresAt.getTime() <= now.getTime()) return { verdict: 'expired', failedAttempts: failed };
  if (codeMatches(key, approvalId, typed, state.codeHash)) return { verdict: 'ok', failedAttempts: failed };
  const next = failed + 1;
  return { verdict: next >= CODE_MAX_FAILED ? 'locked' : 'wrong', failedAttempts: next };
}
