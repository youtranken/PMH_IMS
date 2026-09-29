/**
 * AD-11: danh sách khóa cấu hình + kiểu + mặc định — MỘT nơi khai báo duy nhất (AD-15).
 * Thêm tham số mới: thêm ở đây VÀ seed bằng migration, không rải hằng số trong code. Muốn SA
 * sửa được trên màn Tham số hệ thống thì khai thêm ở `system-config.editable.ts` (kèm khoảng).
 */
export const CONFIG_KEYS = {
  sessionIdleMinutes: { key: 'session.idle_minutes', fallback: 30 },
  sessionAbsoluteHours: { key: 'session.absolute_hours', fallback: 12 },
  loginMaxFailedAttempts: { key: 'login.max_failed_attempts', fallback: 5 },
  loginLockoutMinutes: { key: 'login.lockout_minutes', fallback: 15 },
  loginRateLimitPerIp: { key: 'login.rate_limit_per_ip', fallback: 20 },
  // Bậc chờ khi một tài khoản bị đoán sai nhiều lần (0060, SEC-03). Xem `common/lockout.ts`.
  loginAccountBackoffMinutes: { key: 'login.account_backoff_minutes', fallback: '5,15,30,60' },
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
  /*
   * Câu chỉ đường cho người quên mật khẩu / mất điện thoại 2 lớp (0077, Q-14). Đọc được khi CHƯA
   * đăng nhập qua `GET /auth/support-contact` — route đó chỉ trả đúng khoá này, không mở bảng.
   */
  authSupportContact: {
    key: 'auth.support_contact',
    fallback: 'Liên hệ Super Admin phòng IT (gặp trực tiếp hoặc gọi số nội bộ của phòng IT).',
  },
  secretProbeAlertThreshold: { key: 'secret.probe_alert_threshold', fallback: 3 },
  secretProbeWindowMinutes: { key: 'secret.probe_window_minutes', fallback: 15 },
  secretProbeCooldownMinutes: { key: 'secret.probe_cooldown_minutes', fallback: 60 },
  // Trong lúc nghỉ, vượt hệ số × ngưỡng thì đi thêm một lá leo thang (0250, OLD-SEC-01).
  secretProbeEscalationMultiplier: { key: 'secret.probe_escalation_multiplier', fallback: 3 },
  breakGlassMaxGrantHours: { key: 'breakglass.max_grant_hours', fallback: 24 },
  // Cửa sổ đếm "người này đã xin N lần" trên phiếu người duyệt đọc (0098).
  breakGlassRecentWindowDays: { key: 'breakglass.recent_window_days', fallback: 30 },
  approvalReminderHours: { key: 'approval.reminder_hours', fallback: 4 },
  /*
   * Yêu cầu mở két chờ quá số giờ này mà không ai quyết thì tự hết hạn (0241, Q-15). Phải lớn
   * hơn `approval.reminder_hours` — màn Tham số chặn cặp ngược, vì khi đó thư nhắc không bao giờ
   * kịp đi trước lúc yêu cầu hết hạn.
   */
  breakGlassPendingExpireHours: { key: 'breakglass.pending_expire_hours', fallback: 8 },
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
  // Cổng mở ra Internet bị gắn "Nhạy cảm" trên sổ NAT (0140) — xem `ipam/nat-sensitive.ts`.
  natSensitivePorts: { key: 'nat.sensitive_ports', fallback: '21,22,23,445,1433,3306,3389,5432,5900' },
  // Q-13 (0076): Hết hạn quá số ngày này thì tự Thanh lý + gỡ ghế. 0 = tắt.
  softwareAutoRetireGraceDays: { key: 'software.auto_retire_grace_days', fallback: 30 },
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
  /*
   * GIỮ BAO LÂU RỒI DỌN (0051) — hai ngưỡng, hai bảng chỉ-lớn-lên.
   *
   * Vào `system_config` chứ không viết cứng: "giữ vết bao lâu" là một quyết định của bộ phận
   * IT, và nó sẽ được siết dần — một bản ghi audit cần giữ lâu hơn một dòng outbox đã gửi
   * xong. Siết bằng một câu UPDATE thì không phải dựng lại ảnh docker.
   *
   * KHÔNG áp cho `audit_log` và các bảng `*_history`: những bảng ấy chỉ-thêm và giữ VĨNH VIỄN
   * theo NFR-03/AD-13. Hai ngưỡng dưới đây chỉ nói về vết KỸ THUẬT — phiên đã chết và thư đã
   * gửi — chứ không phải về sổ nghiệp vụ.
   */
  sessionRetentionDays: { key: 'session.retention_days', fallback: 30 },
  outboxRetentionDays: { key: 'outbox.retention_days', fallback: 30 },
  /*
   * Ngăn năm của `audit_log` cũ hơn ngần này năm thì `ops/audit-archive.sh` tách ra và dump
   * (0303, OLD-DB-03). Chỉ script vận hành đọc — không có gì tự chạy: lưu trữ sổ NFR-03 là
   * việc người trực làm có chủ đích, không phải việc một cron lặng lẽ làm.
   */
  auditArchiveAfterYears: { key: 'audit.archive_after_years', fallback: 2 },
} as const;

export type ConfigName = keyof typeof CONFIG_KEYS;
