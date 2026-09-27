import type { QueryClient } from '@tanstack/react-query';
import { LOGIN_PATH } from '@/lib/me';

/**
 * Sau khi đăng xuất (FE-02): xoá MỌI dữ liệu đã tải khỏi bộ nhớ rồi mới về màn đăng nhập. Không
 * xoá thì danh sách tài khoản, thiết bị, nhật ký… của người trước còn nằm trong cache vài phút —
 * người đăng nhập kế tiếp trên cùng máy thấy chúng trước khi dữ liệu mới về.
 */
export function afterLogout(client: QueryClient, navigate: (path: string) => void): void {
  client.clear();
  navigate(LOGIN_PATH);
}
