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
 * A-02: cài yếu tố thứ hai có được MIỄN gõ lại mật khẩu không.
 *
 * Miễn đúng một trường hợp: phiên còn cờ `totp_pending` VÀ còn trẻ hơn `reauthMinutes`. Đó
 * là người đang đứng giữa luồng đăng nhập bắt buộc cài 2 lớp — mật khẩu vừa được chứng minh
 * để tạo ra chính phiên này, và phiên đó chưa mở được gì ngoài ba route của luồng đăng nhập.
 * Hỏi lại mật khẩu ngay sau màn đăng nhập là ma sát không đổi lấy được gì.
 *
 * Mọi trường hợp còn lại phải gõ mật khẩu — kể cả (và nhất là) một phiên đã đăng nhập đầy đủ
 * mà tài khoản chưa từng cài 2 lớp: đó là cái cookie bị trộm trong mô hình đe dọa của A-02.
 *
 * ===== VÌ SAO ĐO TỪ `createdAt`, KHÔNG PHẢI `lastSeenAt` =====
 *
 * "Còn chờ" không tự hết. Người dùng bỏ dở giữa chừng rồi để máy mở thì cửa ấy đứng đó tới
 * khi phiên hết hạn tuyệt đối — 12 giờ. Nên ngoại lệ tính theo tuổi phiên.
 *
 * Và phải là tuổi kể từ lúc SINH RA: `last_seen_at` bị đẩy tới trước ở mỗi request, nên đo
 * theo nó là để chính kẻ đang giữ cookie tự gia hạn cửa cho mình — hàng rào sẽ không bao giờ
 * đóng với đúng người mà nó sinh ra để chặn.
 */
export function canEnrollWithoutPassword(
  session: { totpPending: boolean; createdAt: Date },
  reauthMinutes: number,
  now: Date,
): boolean {
  if (!session.totpPending) return false;
  return now.getTime() - session.createdAt.getTime() < reauthMinutes * 60_000;
}

/**
 * Phiên chờ NHẬP MÃ 2 lớp (đã đúng mật khẩu, tài khoản ĐÃ cài 2 lớp) chỉ sống `minutes` phút
 * tính từ lúc sinh ra (Q-20, `auth.totp_challenge_minutes`). Bỏ dở màn nhập mã trên máy dùng
 * chung thì người sau không được thừa hưởng "nửa phiên" đã qua mật khẩu.
 *
 * Đo từ `createdAt`, cùng lý do với `canEnrollWithoutPassword`: `last_seen_at` bị đẩy tới ở mỗi
 * request nên kẻ giữ cookie tự gia hạn được.
 *
 * Không áp cho luồng CÀI 2 lớp bắt buộc (`enrolled = false`): người mới phải tải ứng dụng
 * xác thực về máy, có khi mất hơn N phút. Luồng đó đã có hàng rào riêng: quá
 * `totp.enroll_reauth_minutes` thì cài phải gõ lại mật khẩu (`canEnrollWithoutPassword`).
 */
export function isTotpChallengeExpired(
  session: { totpPending: boolean; createdAt: Date },
  enrolled: boolean,
  minutes: number,
  now: Date,
): boolean {
  if (!session.totpPending || !enrolled) return false;
  return now.getTime() - session.createdAt.getTime() >= minutes * 60_000;
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
