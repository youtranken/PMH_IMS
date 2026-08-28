/**
 * Luật sống/chết của phiên (NFR-01): idle 30 phút HOẶC absolute 12 giờ — cái nào đến trước.
 * Hàm thuần, tách khỏi DB để test được mọi biên.
 */
export interface SessionTimes {
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

export type SessionVerdict = 'alive' | 'idle-expired' | 'absolute-expired' | 'revoked';

export function evaluateSession(
  session: SessionTimes,
  idleMinutes: number,
  now: Date,
): SessionVerdict {
  if (session.revokedAt !== null) return 'revoked';
  if (now.getTime() >= session.absoluteExpiresAt.getTime()) return 'absolute-expired';
  if (now.getTime() - session.lastSeenAt.getTime() >= idleMinutes * 60_000) {
    return 'idle-expired';
  }
  return 'alive';
}

/**
 * FR-022: gõ TOTP một lần dùng được `graceMinutes`; hết thì phải gõ lại.
 * `steppedUpAt === null` nghĩa là chưa từng step-up trong phiên này.
 */
export function isStepUpValid(
  steppedUpAt: Date | null,
  graceMinutes: number,
  now: Date,
): boolean {
  if (steppedUpAt === null) return false;
  return now.getTime() - steppedUpAt.getTime() < graceMinutes * 60_000;
}

/**
 * Còn bao nhiêu GIÂY nữa thì phải gõ lại TOTP. Hết hạn (hoặc chưa từng gõ) → 0.
 *
 * Vì sao client cần con số này: hộp hiện secret đếm ngược HAI số — `60s / 600s`. Số trái là
 * "giá trị này tự ẩn sau bao lâu", số phải là "còn mở được két bao lâu nữa mà không phải gõ
 * lại mã". Thiếu số phải thì người dùng gõ mã lúc 9:00, tới 9:09 mở tiếp một secret nữa và
 * bị hỏi mã giữa chừng mà không hiểu vì sao — trong khi cái mốc đó vốn đoán trước được.
 *
 * Client KHÔNG tự tính được: nó không biết `stepped_up_at`, và nếu tự đếm từ lần gõ mã gần
 * nhất thì mọi tab khác (cùng phiên, cùng mốc) sẽ đếm ra một con số khác.
 */
export function stepUpSecondsLeft(
  steppedUpAt: Date | null,
  graceMinutes: number,
  now: Date,
): number {
  if (steppedUpAt === null) return 0;
  const left = steppedUpAt.getTime() + graceMinutes * 60_000 - now.getTime();
  return left <= 0 ? 0 : Math.ceil(left / 1000);
}
