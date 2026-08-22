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
