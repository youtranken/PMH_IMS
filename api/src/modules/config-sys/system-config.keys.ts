/**
 * AD-11: danh sách khóa cấu hình + kiểu + mặc định — MỘT nơi khai báo duy nhất (AD-15).
 * Thêm tham số mới: thêm ở đây VÀ seed bằng migration, không rải hằng số trong code.
 */
export const CONFIG_KEYS = {
  sessionIdleMinutes: { key: 'session.idle_minutes', fallback: 30 },
  sessionAbsoluteHours: { key: 'session.absolute_hours', fallback: 12 },
  loginMaxFailedAttempts: { key: 'login.max_failed_attempts', fallback: 5 },
  loginLockoutMinutes: { key: 'login.lockout_minutes', fallback: 15 },
  loginRateLimitPerIp: { key: 'login.rate_limit_per_ip', fallback: 20 },
  // 60s (0034): 30 chỉ vừa đủ đọc xong thì hộp đóng, người dùng bấm Xem lại — mỗi lần một dòng audit.
  secretRevealSeconds: { key: 'secret.reveal_seconds', fallback: 60 },
  secretStepUpGraceMinutes: { key: 'secret.stepup_grace_minutes', fallback: 10 },
  secretStepUpMaxFailures: { key: 'secret.stepup_max_failures', fallback: 5 },
  /*
   * Canh người DÒ DẪM quanh két (0046) — xem `audit/security-probe.service.ts`.
   *
   * Ngưỡng 3 là con số chủ dự án chọn. Cửa sổ 15 phút để ba lần rải rác trong một ngày làm
   * việc KHÔNG thành báo động giả — gõ nhầm mã một lần sáng, một lần chiều là chuyện thường.
   * Nghỉ 60 phút giữa hai lần cảnh báo: không có nó thì kẻ bắn liên tục sẽ làm ngập hộp thư
   * quản trị, và chính cái cảnh báo trở thành công cụ tấn công.
   *
   * Đặt ngưỡng = 0 là TẮT hẳn cảnh báo (vẫn ghi nhật ký) — có đường tắt mà không phải sửa code.
   */
  /*
   * Cửa sổ MIỄN gõ lại mật khẩu khi cài yếu tố thứ hai lần đầu (0047, A-02).
   *
   * Cài 2 lớp ngay sau màn đăng nhập bắt buộc thì mật khẩu vừa được chứng minh vài giây
   * trước — hỏi lại là ma sát không đổi lấy được gì. Nhưng một phiên chờ bị bỏ quên trên
   * máy bỏ ngỏ thì không được là cửa mở vĩnh viễn, nên ngoại lệ ấy có hạn.
   *
   * 15 phút: đủ cho người lần đầu tải ứng dụng authenticator về máy, và ngắn hơn hẳn
   * `session.idle_minutes` (30) nên nó luôn là cái hết trước.
   */
  totpEnrollReauthMinutes: { key: 'totp.enroll_reauth_minutes', fallback: 15 },
  secretProbeAlertThreshold: { key: 'secret.probe_alert_threshold', fallback: 3 },
  secretProbeWindowMinutes: { key: 'secret.probe_window_minutes', fallback: 15 },
  secretProbeCooldownMinutes: { key: 'secret.probe_cooldown_minutes', fallback: 60 },
  breakGlassMaxGrantHours: { key: 'breakglass.max_grant_hours', fallback: 24 },
  approvalReminderHours: { key: 'approval.reminder_hours', fallback: 4 },
  mailFromAddress: { key: 'mail.from_address', fallback: 'ims@pmh.com.vn' },
  appTimezone: { key: 'app.timezone', fallback: 'Asia/Ho_Chi_Minh' },
  /*
   * Hai ngưỡng của bảng điều khiển (0038).
   *
   * Vào đây chứ không nằm trong `dashboard.service.ts` vì chúng là LUẬT NGHIỆP VỤ, không phải
   * hằng số hiển thị: "dải bao nhiêu phần trăm thì gọi là sắp đầy" và "mật khẩu bao lâu không
   * đổi thì gọi là cũ" là hai câu mà bộ phận IT sẽ muốn siết dần theo thời gian, và siết bằng
   * một dòng UPDATE thì không cần dựng lại ảnh docker. (Số dòng hiện trên mỗi khối thì ngược
   * lại — đó là chuyện bày biện, để nguyên trong code.)
   */
  dashboardSubnetFullPercent: { key: 'dashboard.subnet_full_percent', fallback: 80 },
  dashboardSecretStaleDays: { key: 'dashboard.secret_stale_days', fallback: 180 },
  /*
   * Hai ngưỡng "sắp hết hạn" (0041). Trước đó chúng nằm cứng ở BA chỗ độc lập — hai bên API,
   * một bên web — và mỗi chú thích tự nhận là "khớp nhau" bằng lời hứa chứ không bằng cơ chế.
   *
   * "Trước bao nhiêu ngày thì phải bắt đầu lo" là câu trả lời của bộ phận IT, không của lập
   * trình viên: gia hạn SSL mất một buổi, gia hạn hợp đồng đường truyền mất ba tuần.
   */
  expiryCriticalDays: { key: 'expiry.critical_days', fallback: 7 },
  expiryWarningDays: { key: 'expiry.warning_days', fallback: 30 },
  /*
   * Email báo cáo nhìn lùi bao nhiêu ngày để bắt mục ĐÃ quá hạn (0043).
   *
   * Màn hình nhìn lùi một năm và đó là đúng — nó là thứ người ta KÉO tới xem. Email thì ĐẨY
   * tới, hằng tuần, mãi mãi: một tên miền đã bỏ sẽ nằm trong 52 lá thư liên tiếp và dạy người
   * nhận rằng thư này có thứ không cần đọc.
   */
  expiryDigestExpiredDays: { key: 'expiry.digest_expired_days', fallback: 30 },
} as const;

export type ConfigName = keyof typeof CONFIG_KEYS;
