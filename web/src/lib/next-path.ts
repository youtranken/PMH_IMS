import {
  CHANGE_PASSWORD_PATH,
  HOME_PATH,
  LEGACY_AUTH_ROUTES,
  LOGIN_PATH,
  TOTP_CHALLENGE_PATH,
  TOTP_ENROLL_PATH,
} from '@/lib/me';

/**
 * Đích sau đăng nhập — nơi người dùng định mở trước khi bị đưa về màn đăng nhập (Q-14).
 *
 * sessionStorage chứ không `?next=`: đích phải sống qua ĐỦ các bước (mật khẩu → 2 lớp → đổi
 * mật khẩu bắt buộc), mà router thay URL ở mỗi bước. Theo tab, nên tab khác không bị kéo theo,
 * và đóng tab là mất — không để lại đích cho người dùng máy sau.
 */
const KEY = 'ims_next_path';

const AUTH_PATHS = new Set<string>([
  HOME_PATH,
  LOGIN_PATH,
  TOTP_CHALLENGE_PATH,
  TOTP_ENROLL_PATH,
  CHANGE_PASSWORD_PATH,
  ...LEGACY_AUTH_ROUTES.map((route) => route.from),
]);

/** Chỉ dùng để kiểm "có rời khỏi miền không" — không bao giờ là một địa chỉ thật. */
const PROBE_ORIGIN = 'https://ims.invalid';

export interface NextPathCheck {
  value: string | null;
  reason: 'empty' | 'external' | 'auth' | null;
}

/**
 * Đích có an toàn để chuyển tới không. Chỉ nhận đường NỘI BỘ: bắt đầu bằng đúng một "/".
 *
 * "//evil.com" và "/\evil.com" trình duyệt hiểu là địa chỉ KHÁC MIỀN, còn ký tự điều khiển
 * (tab, xuống dòng) bị trình duyệt xoá trước khi phân tích — nên "/\t/evil.com" thành
 * "//evil.com". Dạng mã hoá "%2F", "%5C" bị từ chối luôn dù hiện tại vô hại: một lớp nào đó
 * giải mã thêm một lần là thành đúng hai dạng trên.
 */
export function safeNextPath(raw: string | null | undefined): NextPathCheck {
  if (!raw) return { value: null, reason: 'empty' };
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return { value: null, reason: 'external' };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f]/.test(raw) || /%(2f|5c)/i.test(raw.split(/[?#]/)[0])) {
    return { value: null, reason: 'external' };
  }
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return { value: null, reason: 'external' };
  }
  if (url.origin !== PROBE_ORIGIN) return { value: null, reason: 'external' };
  if (AUTH_PATHS.has(url.pathname)) return { value: null, reason: 'auth' };
  return { value: raw, reason: null };
}

/** Nhớ đích. Đích không an toàn thì bỏ qua — và KHÔNG đè mất đích tốt đã nhớ trước đó. */
export function rememberNextPath(raw: string): void {
  const { value } = safeNextPath(raw);
  if (!value) return;
  try {
    sessionStorage.setItem(KEY, value);
  } catch {
    // Kho bị chặn thì đăng nhập xong về trang chủ — mất tiện ích, không mất chức năng.
  }
}

/** Đọc đích đã nhớ; kiểm lại mỗi lần đọc vì kho có thể bị sửa tay. */
export function peekNextPath(): string | null {
  try {
    return safeNextPath(sessionStorage.getItem(KEY)).value;
  } catch {
    return null;
  }
}

export function clearNextPath(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // như trên
  }
}
