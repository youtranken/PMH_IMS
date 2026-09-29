import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_PENDING_KEY = 'ims:allow-password-pending';

/**
 * Route này chạy được kể cả khi tài khoản đang bị bắt ĐỔI MẬT KHẨU.
 *
 * ===== LỖ MÀ CỜ NÀY ĐÓNG =====
 *
 * `users.must_change_password` mặc định `true` cho mọi tài khoản mới và mọi lần SA reset mật
 * khẩu. Nếu chỉ `nextStepPath()` bên web đọc cờ đó thì không guard nào chặn, không route nào
 * từ chối.
 *
 * Nghĩa là mật khẩu tạm — thứ đã đi qua email hoặc đọc qua điện thoại, và nằm nguyên trong
 * response của `POST /accounts` — dùng được VÔ THỜI HẠN nếu gọi API thẳng. Người dùng chỉ cần
 * không bấm nút "Lưu" trên màn đổi mật khẩu; UI ép được họ, `curl` thì không.
 *
 * ===== VÌ SAO LÀ DANH SÁCH TRẮNG, KHÔNG PHẢI DANH SÁCH ĐEN =====
 *
 * Cùng khuôn `@AllowTotpPending()` ngay bên cạnh: chặn tất cả rồi mở đúng những cửa cần để
 * người dùng ĐI TIẾP được. Danh sách đen thì mỗi route mới lại là một cơ hội quên, và cái
 * quên đó im lặng — đúng cách cờ này đứng ngoài hàng rào suốt chín epic.
 *
 * Bốn cửa được mở, và chỉ bốn:
 *   · `POST /auth/change-password` — chính việc phải làm;
 *   · `GET  /auth/me` — web hỏi "tôi đang ở bước nào" để điều hướng;
 *   · `POST /auth/logout` — không được nhốt người dùng lại;
 *   · nhóm TOTP enroll/confirm — ở lần đăng nhập đầu, enroll xong mới tới đổi mật khẩu.
 */
export const AllowPasswordPending = () => SetMetadata(ALLOW_PASSWORD_PENDING_KEY, true);
