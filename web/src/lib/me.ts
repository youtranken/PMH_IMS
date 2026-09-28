/**
 * Ba vai của hệ thống — MỘT nguồn cho cả web (22/09).
 *
 * Tách ra khỏi `Me` vì `routes.ts` cần nó để khai bảng quyền theo đường dẫn, và union này gõ
 * tay lần thứ hai ở đó là đúng cái hình dạng mà B-09 vừa dọn.
 */
export type UserRole = 'sa' | 'admin' | 'member';

/** Người dùng của phiên hiện tại — shape đúng bằng `GET /api/v1/auth/me`. */
export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  mustChangePassword: boolean;
  /** Đúng mật khẩu nhưng chưa qua TOTP — chỉ vài route được phép. */
  totpPending: boolean;
  /** Đã cài xác thực 2 lớp chưa (quyết định enroll hay nhập mã). */
  totpEnrolled: boolean;
  /** Mốc cài 2 lớp (ISO) — màn Hồ sơ hiện "Đã bật từ …". */
  totpEnrolledAt?: string | null;
  steppedUpAt: string | null;
  csrfToken: string;
  config: {
    stepUpGraceMinutes: number;
    secretRevealSeconds: number;
  };
}

export const LOGIN_PATH = '/login';
export const TOTP_CHALLENGE_PATH = '/login/2fa';
export const TOTP_ENROLL_PATH = '/login/2fa-setup';
export const CHANGE_PASSWORD_PATH = '/change-password';

/** Đường dẫn tiếng Việt của bản cũ, giữ để link đã ghim còn mở được (xem `lib/routes.ts`). */
export const LEGACY_AUTH_ROUTES: { from: string; to: string }[] = [
  { from: '/dang-nhap', to: LOGIN_PATH },
  { from: '/dang-nhap/xac-thuc', to: TOTP_CHALLENGE_PATH },
  { from: '/dang-nhap/cai-dat-2-lop', to: TOTP_ENROLL_PATH },
  { from: '/doi-mat-khau', to: CHANGE_PASSWORD_PATH },
];
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
