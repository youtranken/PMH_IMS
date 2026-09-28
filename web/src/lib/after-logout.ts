import type { QueryClient } from '@tanstack/react-query';
import { LOGIN_PATH } from '@/lib/me';
import { clearNextPath, noteTabOwner } from '@/lib/next-path';

/**
 * Sau khi đăng xuất (FE-02): xoá MỌI dữ liệu đã tải khỏi bộ nhớ rồi mới về màn đăng nhập. Không
 * xoá thì danh sách tài khoản, thiết bị, nhật ký… của người trước còn nằm trong cache vài phút —
 * người đăng nhập kế tiếp trên cùng máy thấy chúng trước khi dữ liệu mới về.
 */
export function afterLogout(
  client: QueryClient,
  navigate: (path: string, options?: { state?: unknown }) => void,
): void {
  client.clear();
  // Chủ động đăng xuất thì không còn "trang đang làm dở" — người đăng nhập kế tiếp về trang chủ.
  // Tab cũng thôi thuộc về người vừa ra: link trong thư mở sau đó thuộc người sắp đăng nhập.
  clearNextPath();
  noteTabOwner(null);
  // Cờ đi qua `state` chứ không qua `?query`: tải lại trang thì câu "đã đăng xuất" không hiện
  // lại, và địa chỉ màn đăng nhập vẫn đúng một đường.
  navigate(LOGIN_PATH, { state: { signedOut: true } });
}
