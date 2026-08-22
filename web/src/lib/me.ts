/** Người dùng của phiên hiện tại — shape đúng bằng `GET /api/v1/auth/me`. */
export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: 'sa' | 'admin' | 'member';
  mustChangePassword: boolean;
  /** Đúng mật khẩu nhưng chưa qua TOTP — chỉ vài route được phép. */
  totpPending: boolean;
  /** Đã cài xác thực 2 lớp chưa (quyết định enroll hay nhập mã). */
  totpEnrolled: boolean;
  steppedUpAt: string | null;
  csrfToken: string;
  config: {
    stepUpGraceMinutes: number;
    secretRevealSeconds: number;
  };
}

export const LOGIN_PATH = '/dang-nhap';
export const TOTP_CHALLENGE_PATH = '/dang-nhap/xac-thuc';
export const TOTP_ENROLL_PATH = '/dang-nhap/cai-dat-2-lop';
export const CHANGE_PASSWORD_PATH = '/doi-mat-khau';
export const HOME_PATH = '/';

/**
 * MỘT nơi duy nhất quyết định "người này đang ở bước nào" (AD-15).
 *
 * Trước đây mỗi màn tự gọi navigate() sau khi gọi API — và thua cuộc đua với router
 * khi `me` được nạp lại: màn đăng nhập nhảy về '/', RequireAuth lại đá sang '/dang-nhap/xac-thuc'
 * dù người dùng chưa cài 2 lớp. Giờ router chỉ đọc hàm này, màn không tự điều hướng.
 */
export function nextStepPath(me: Me | null): string {
  if (!me) return LOGIN_PATH;
  if (me.totpPending) return me.totpEnrolled ? TOTP_CHALLENGE_PATH : TOTP_ENROLL_PATH;
  if (me.mustChangePassword) return CHANGE_PASSWORD_PATH;
  return HOME_PATH;
}

export function isAdminOrAbove(me: Me | null | undefined): boolean {
  return me?.role === 'sa' || me?.role === 'admin';
}
