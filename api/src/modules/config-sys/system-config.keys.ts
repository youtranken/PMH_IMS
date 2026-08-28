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
} as const;

export type ConfigName = keyof typeof CONFIG_KEYS;
