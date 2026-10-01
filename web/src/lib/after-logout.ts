import type { QueryClient } from '@tanstack/react-query';
import { LOGIN_PATH } from '@/lib/me';
import { clearNextPath, noteTabOwner } from '@/lib/next-path';

const SIGNED_OUT_KEY = 'ims_signed_out';

/** Tiền tố khoá localStorage của danh sách "mở gần đây" trong ô tìm nhanh (`ui/command-palette`). */
export const PALETTE_RECENT_PREFIX = 'ims_palette_recent:';

/**
 * Danh sách "mở gần đây" nằm trong localStorage, sống qua cả lượt đăng xuất: trên máy dùng chung
 * người kế tiếp (hay ai mở công cụ trình duyệt) đọc được mã + tên hồ sơ người trước vừa mở.
 * Xoá của MỌI email chứ không chỉ người vừa ra — lúc này không còn chắc biết email đó.
 *
 * Gọi ở MỌI lúc phiên kết thúc: bấm Đăng xuất (`afterLogout`) và 401-phiên-chết của
 * `lib/api-client` (hết hạn, bị thu hồi, tài khoản bị khoá) — phần lớn phiên trên máy dùng chung
 * kết thúc theo đường sau, không ai bấm Đăng xuất.
 */
export function clearPaletteRecent(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PALETTE_RECENT_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Kho bị chặn thì cũng không có gì đã ghi để xoá.
  }
}

/**
 * Vì sao phiên kết thúc:
 *   - `signedOut`: bấm Đăng xuất — bỏ trang dở, báo "Bạn đã đăng xuất.".
 *   - `back`: "Quay lại" ở màn nhập mã 2 lớp — cùng người sửa lại bước mật khẩu, nên GIỮ trang
 *     dở (Q-14) và không báo gì.
 *   - `totpExpired`: quá thời gian nhập mã (Q-20) — giữ trang dở, báo hết thời gian.
 */
export type SignOutReason = 'signedOut' | 'back' | 'totpExpired';

/** Câu báo màn đăng nhập sẽ hiện ở lượt mở kế tiếp trong tab này. */
export type SignOutNotice = 'signedOut' | 'totpExpired';

const NOTICE_VALUE: Record<SignOutNotice, string> = { signedOut: '1', totpExpired: 'totp-expired' };

/**
 * Ghi câu báo cho màn đăng nhập. Đi qua sessionStorage chứ không qua state của router: ngay sau
 * lượt `navigate`, một lượt gọi API bất kỳ gặp 401 sẽ NẠP LẠI CỨNG trang `/login`, và state của
 * router mất theo. `lib/api-client` cũng gọi hàm này khi server báo hết thời gian nhập mã.
 */
export function noteSignOutNotice(notice: SignOutNotice): void {
  try {
    sessionStorage.setItem(SIGNED_OUT_KEY, NOTICE_VALUE[notice]);
  } catch {
    // Kho bị chặn thì chỉ mất câu báo, đăng xuất vẫn xong.
  }
}

/**
 * Sau khi đăng xuất (FE-02): xoá MỌI dữ liệu đã tải khỏi bộ nhớ rồi mới về màn đăng nhập. Không
 * xoá thì danh sách tài khoản, thiết bị, nhật ký… của người trước còn nằm trong cache vài phút —
 * người đăng nhập kế tiếp trên cùng máy thấy chúng trước khi dữ liệu mới về.
 */
export function afterLogout(
  client: QueryClient,
  navigate: (path: string) => void,
  reason: SignOutReason = 'signedOut',
): void {
  client.clear();
  clearPaletteRecent();
  if (reason === 'signedOut') {
    // Chủ động đăng xuất thì không còn "trang đang làm dở" — người đăng nhập kế tiếp về trang chủ.
    // Tab cũng thôi thuộc về người vừa ra: link trong thư mở sau đó thuộc người sắp đăng nhập.
    clearNextPath();
    noteTabOwner(null);
    // Trên máy dùng chung người ta cần chắc phiên đã đóng.
    noteSignOutNotice('signedOut');
  } else if (reason === 'totpExpired') {
    noteSignOutNotice('totpExpired');
  } else {
    clearSignedOut();
  }
  navigate(LOGIN_PATH);
}

/** Màn đăng nhập hỏi: tab này vừa kết thúc phiên vì lý do nào cần nói ra? */
export function signOutNotice(): SignOutNotice | null {
  try {
    const value = sessionStorage.getItem(SIGNED_OUT_KEY);
    if (value === NOTICE_VALUE.totpExpired) return 'totpExpired';
    return value === NOTICE_VALUE.signedOut ? 'signedOut' : null;
  } catch {
    return null;
  }
}

/** Tắt câu báo — người dùng bắt đầu gõ, hoặc đã đăng nhập lại. */
export function clearSignedOut(): void {
  try {
    sessionStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    // Kho bị chặn thì cũng không có gì đã ghi để xoá.
  }
}
