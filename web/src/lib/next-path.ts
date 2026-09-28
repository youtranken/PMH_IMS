import {
  CHANGE_PASSWORD_PATH,
  HOME_PATH,
  LEGACY_AUTH_ROUTES,
  LOGIN_PATH,
  TOTP_CHALLENGE_PATH,
  TOTP_ENROLL_PATH,
} from '@/lib/me';
import { titleKeyOf } from '@/lib/routes';

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

/**
 * Đích đã nhớ có dành cho người đang đăng nhập không.
 *
 * `owner` là email người có phiên vừa chết giữa chừng. Máy dùng chung: người sau đăng nhập trong
 * cùng tab thì trang dở dang của người trước KHÔNG phải việc của họ — bỏ đi. Đích không gắn ai
 * (link trong thư mở khi chưa đăng nhập) thì thuộc người đăng nhập. `forEmail` bỏ trống nghĩa là
 * chỉ hỏi để hiện tên màn, chưa biết ai sẽ đăng nhập. Kho cũ lưu chuỗi trần = không gắn ai.
 */
export function nextPathFor(stored: string | null, forEmail?: string | null): string | null {
  if (!stored) return null;
  let path: unknown = stored;
  let owner: unknown = null;
  if (stored.startsWith('{')) {
    try {
      const parsed = JSON.parse(stored) as { path?: unknown; owner?: unknown };
      path = parsed.path;
      owner = parsed.owner;
    } catch {
      return null;
    }
  }
  if (typeof path !== 'string') return null;
  const { value } = safeNextPath(path);
  if (!value) return null;
  if (typeof owner !== 'string' || owner === '' || forEmail === undefined) return value;
  return owner.toLowerCase() === (forEmail ?? '').toLowerCase() ? value : null;
}

/**
 * Nhớ đích, kèm email người đang làm nếu biết. Đích không an toàn thì bỏ qua — và KHÔNG đè mất
 * đích tốt đã nhớ trước đó.
 */
export function rememberNextPath(raw: string, owner?: string | null): void {
  const { value } = safeNextPath(raw);
  if (!value) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path: value, owner: owner || null }));
  } catch {
    // Kho bị chặn thì đăng nhập xong về trang chủ — mất tiện ích, không mất chức năng.
  }
}

/**
 * Đọc đích đã nhớ cho `forEmail` (xem `nextPathFor`); kiểm lại mỗi lần đọc vì kho có thể bị
 * sửa tay.
 */
export function peekNextPath(forEmail?: string | null): string | null {
  try {
    return nextPathFor(sessionStorage.getItem(KEY), forEmail);
  } catch {
    return null;
  }
}

/** Khoá i18n tên màn của một đích — màn đăng nhập nói "Đăng nhập để mở: Duyệt yêu cầu". */
export function nextPathLabelKey(path: string | null): string | null {
  if (!path) return null;
  return titleKeyOf(new URL(path, PROBE_ORIGIN).pathname);
}

const OWNER_KEY = 'ims_tab_owner';

/**
 * Người có phiên trong TAB này — sống qua F5 (sessionStorage). Phiên chết rồi tải lại trang thì
 * `me` đã là null, nhưng đích dở dang vẫn phải ghi đúng chủ. Đăng xuất chủ động thì xoá
 * (`null`): link trong thư mở sau đó trong tab này thuộc về người sắp đăng nhập.
 */
export function noteTabOwner(email: string | null): void {
  try {
    if (email) sessionStorage.setItem(OWNER_KEY, email);
    else sessionStorage.removeItem(OWNER_KEY);
  } catch {
    // Kho bị chặn: đích không gắn chủ — như trước khi có luật này.
  }
}

export function tabOwner(): string | null {
  try {
    return sessionStorage.getItem(OWNER_KEY);
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
