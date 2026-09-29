/**
 * Tập mã nhật ký là "sự kiện an ninh": đoán mật khẩu, mã 2 lớp sai, phiên bị đóng vì gõ sai
 * nhiều lần, bị chặn mở két, cảnh báo dò. Đây là thứ người rà nhật ký phải tìm ra trước tiên.
 *
 * MỘT chỗ định nghĩa: bộ lọc "Chỉ sự kiện an ninh" của API đọc từ đây, còn màu đỏ trên màn
 * Nhật ký (`web/src/features/admin/audit-actions.ts`) có bài kiểm đọc file này và đỏ khi hai
 * bên lệch nhau — lọc ra một tập mà tô màu một tập khác là người rà bỏ sót đúng dòng cần xem.
 *
 * Chỉ các mã THẤT BẠI / BỊ CHẶN; việc hợp lệ mà nhạy cảm (xem giá trị két) không vào đây.
 */
export const SECURITY_AUDIT_ACTIONS: readonly string[] = [
  'auth.login.failed',
  'auth.account.locked',
  'auth.stepup.failed',
  'auth.stepup.session_revoked',
  'auth.totp.failed',
  'auth.totp.session_revoked',
  'auth.totp.enroll.failed',
  'auth.totp.reenroll.failed',
  'auth.password.change_failed',
  'auth.password.session_revoked',
  'auth.totp.enroll.reauth_failed',
  'auth.totp.enroll.session_revoked',
  'auth.totp.reenroll.reauth_failed',
  'auth.totp.reenroll.session_revoked',
  'vault.secret.reveal_denied',
  'security.probe.alerted',
];
