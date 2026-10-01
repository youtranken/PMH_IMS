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
  /*
   * Trần theo phút, THEO USER, của các route nhạy cảm — đọc qua `@ConfigThrottle`.
   *
   * `rate.totp_per_minute`: ba cửa nhận mã TOTP (đăng nhập bước 2, xác nhận cài lại 2 lớp,
   * step-up mở két). Mã chỉ có một triệu khả năng, trần chung 300/phút quá rộng cho một ô 6 số.
   * `rate.secret_reveal_per_minute`: cửa mở két — hàng rào PHÒNG việc rút cả két trong vài phút
   * bằng một phiên đã step-up; audit là hàng rào PHÁT HIỆN.
   * `rate.file_upload_per_minute`: mỗi lượt upload giữ trọn tệp (tới `file.max_size_mb`) trong RAM.
   */
  rateTotpPerMinute: { key: 'rate.totp_per_minute', fallback: 10 },
  rateSecretRevealPerMinute: { key: 'rate.secret_reveal_per_minute', fallback: 30 },
  rateFileUploadPerMinute: { key: 'rate.file_upload_per_minute', fallback: 20 },
  /*
   * Giấy tờ đính kèm (Q-18). Trần dung lượng áp cho MỌI loại file, không còn tách ảnh/biên bản.
   * `file.max_size_mb` không được vượt `FILE_HARD_CAP_MB` (`files/file-validation.ts`): multer
   * và nginx chặn cứng ở trần đó trước khi đọc được cấu hình, nên màn Tham số khoá khoảng 1..25.
   *
   * `file.max_files_per_batch`: mỗi request chỉ mang một file, nên trần "mỗi lượt chọn" do web
   * giữ; server đã có `rate.file_upload_per_minute` làm hàng rào cứng.
   */
  fileMaxSizeMb: { key: 'file.max_size_mb', fallback: 25 },
  fileMaxFilesPerBatch: { key: 'file.max_files_per_batch', fallback: 6 },
  // File xoá mềm quá ngần này ngày thì lượt dọn gỡ blob khỏi đĩa, giữ hàng (`FilesService.purgeDeleted`).
  filePurgeAfterDays: { key: 'file.purge_after_days', fallback: 30 },
  // Bậc chờ khi một tài khoản bị đoán sai nhiều lần (SEC-03). Xem `common/lockout.ts`.
  loginAccountBackoffMinutes: { key: 'login.account_backoff_minutes', fallback: '5,15,30,60' },
  // 60s: 30 chỉ vừa đủ đọc xong thì hộp đóng, người dùng bấm Xem lại — mỗi lần một dòng audit.
  secretRevealSeconds: { key: 'secret.reveal_seconds', fallback: 60 },
  secretStepUpGraceMinutes: { key: 'secret.stepup_grace_minutes', fallback: 10 },
  secretStepUpMaxFailures: { key: 'secret.stepup_max_failures', fallback: 5 },
  /*
   * Canh người DÒ DẪM quanh két — xem `audit/security-probe.service.ts`.
   *
   * Ngưỡng 3 là con số chủ dự án chọn. Cửa sổ 15 phút để ba lần rải rác trong một ngày làm
   * việc KHÔNG thành báo động giả — gõ nhầm mã một lần sáng, một lần chiều là chuyện thường.
   * Nghỉ 60 phút giữa hai lần cảnh báo: không có nó thì kẻ bắn liên tục sẽ làm ngập hộp thư
   * quản trị, và chính cái cảnh báo trở thành công cụ tấn công.
   *
   * Đặt ngưỡng = 0 là TẮT hẳn cảnh báo (vẫn ghi nhật ký) — có đường tắt mà không phải sửa code.
   */
  /*
   * Cửa sổ MIỄN gõ lại mật khẩu khi cài yếu tố thứ hai lần đầu (A-02).
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
   * Phiên chờ NHẬP MÃ 2 lớp sống tối đa ngần này phút kể từ lúc đúng mật khẩu (Q-20). Bỏ dở
   * màn nhập mã trên máy dùng chung thì người sau không thừa hưởng nửa phiên đã qua mật khẩu.
   * Xem `isTotpChallengeExpired`.
   */
  authTotpChallengeMinutes: { key: 'auth.totp_challenge_minutes', fallback: 5 },
  /*
   * Câu chỉ đường cho người quên mật khẩu / mất điện thoại 2 lớp (Q-14). Đọc được khi CHƯA
   * đăng nhập qua `GET /auth/support-contact` — route đó chỉ trả đúng khoá này, không mở bảng.
   */
  authSupportContact: {
    key: 'auth.support_contact',
    fallback: 'Liên hệ Super Admin phòng IT (gặp trực tiếp hoặc gọi số nội bộ của phòng IT).',
  },
  secretProbeAlertThreshold: { key: 'secret.probe_alert_threshold', fallback: 3 },
  secretProbeWindowMinutes: { key: 'secret.probe_window_minutes', fallback: 15 },
  secretProbeCooldownMinutes: { key: 'secret.probe_cooldown_minutes', fallback: 60 },
  // Trong lúc nghỉ, vượt hệ số × ngưỡng thì đi thêm một lá leo thang (OLD-SEC-01).
  secretProbeEscalationMultiplier: { key: 'secret.probe_escalation_multiplier', fallback: 3 },
  breakGlassMaxGrantHours: { key: 'breakglass.max_grant_hours', fallback: 24 },
  // Cửa sổ đếm "người này đã xin N lần" trên phiếu người duyệt đọc.
  breakGlassRecentWindowDays: { key: 'breakglass.recent_window_days', fallback: 30 },
  approvalReminderHours: { key: 'approval.reminder_hours', fallback: 4 },
  /*
   * Yêu cầu mở két chờ quá số giờ này mà không ai quyết thì tự hết hạn (Q-15). Phải lớn
   * hơn `approval.reminder_hours` — màn Tham số chặn cặp ngược, vì khi đó thư nhắc không bao giờ
   * kịp đi trước lúc yêu cầu hết hạn.
   */
  breakGlassPendingExpireHours: { key: 'breakglass.pending_expire_hours', fallback: 8 },
  mailFromAddress: { key: 'mail.from_address', fallback: 'ims@pmh.com.vn' },
  appTimezone: { key: 'app.timezone', fallback: 'Asia/Ho_Chi_Minh' },
  /*
   * Hai ngưỡng của bảng điều khiển.
   *
   * Vào đây chứ không nằm trong `dashboard.service.ts` vì chúng là LUẬT NGHIỆP VỤ, không phải
   * hằng số hiển thị: "dải bao nhiêu phần trăm thì gọi là sắp đầy" và "mật khẩu bao lâu không
   * đổi thì gọi là cũ" là hai câu mà bộ phận IT sẽ muốn siết dần theo thời gian, và siết bằng
   * một dòng UPDATE thì không cần dựng lại ảnh docker.
   */
  dashboardSubnetFullPercent: { key: 'dashboard.subnet_full_percent', fallback: 80 },
  dashboardSecretStaleDays: { key: 'dashboard.secret_stale_days', fallback: 180 },
  /*
   * Số dòng tối đa mỗi khối của trang chủ. Trang này đọc trong ba phút; khối dài quá
   * thì người ta cuộn qua chứ không đọc, và cuối mỗi khối đã có đường sang màn đầy đủ.
   */
  dashboardMaxItems: { key: 'dashboard.max_items', fallback: 8 },
  // Cổng mở ra Internet bị gắn "Nhạy cảm" trên sổ NAT — xem `ipam/nat-sensitive.ts`.
  natSensitivePorts: { key: 'nat.sensitive_ports', fallback: '21,22,23,445,1433,3306,3389,5432,5900' },
  /*
   * Dải rộng nhất được khai, tính bằng độ dài prefix: 24 = /24, 254 host.
   *
   * Chỉ được SIẾT (số lớn hơn), không được nới dưới 24 — màn Tham số chặn ở 24..30. Màn dải
   * liệt kê MỌI host trong một lượt gọi và `enumerateHosts` dựng mảng đồng bộ, nên /16 là 65.534
   * dòng (treo tab), /8 là 16 triệu (treo server). Cũng nhờ trần này mà màn dải cắt trang được ở
   * client (`slot-paging.ts`) và `hostRole` suy được địa chỉ mạng/quảng bá từ octet cuối. Muốn
   * nới thì phải đẩy phân trang dải xuống server trước.
   */
  ipamSubnetMinPrefix: { key: 'ipam.subnet_min_prefix', fallback: 24 },
  // Dải cổng ngoài của một luật NAT rộng hơn ngần này thì CẢNH BÁO, không chặn.
  natWidePortRange: { key: 'nat.wide_port_range', fallback: 1000 },
  // Q-13: Hết hạn quá số ngày này thì tự Thanh lý + gỡ ghế. 0 = tắt.
  softwareAutoRetireGraceDays: { key: 'software.auto_retire_grace_days', fallback: 30 },
  /*
   * Hai ngưỡng "sắp hết hạn". Nằm ở DB chứ không cứng trong code: cứng ở ba chỗ (hai bên API,
   * một bên web) thì "khớp nhau" chỉ bằng lời hứa chứ không bằng cơ chế.
   *
   * "Trước bao nhiêu ngày thì phải bắt đầu lo" là câu trả lời của bộ phận IT, không của lập
   * trình viên: gia hạn SSL mất một buổi, gia hạn hợp đồng đường truyền mất ba tuần.
   */
  expiryCriticalDays: { key: 'expiry.critical_days', fallback: 7 },
  expiryWarningDays: { key: 'expiry.warning_days', fallback: 30 },
  /*
   * Email báo cáo nhìn lùi bao nhiêu ngày để bắt mục ĐÃ quá hạn.
   *
   * Màn hình nhìn lùi một năm và đó là đúng — nó là thứ người ta KÉO tới xem. Email thì ĐẨY
   * tới, hằng tuần, mãi mãi: một tên miền đã bỏ sẽ nằm trong 52 lá thư liên tiếp và dạy người
   * nhận rằng thư này có thứ không cần đọc.
   */
  expiryDigestExpiredDays: { key: 'expiry.digest_expired_days', fallback: 30 },
  /*
   * Màn "Sắp hết hạn" nhìn lùi bao nhiêu ngày để bắt mục ĐÃ quá hạn. Cũng là trần của
   * `expiry.digest_expired_days`: email không bao giờ nhìn lùi xa hơn màn hình.
   */
  expiryLookBackDays: { key: 'expiry.look_back_days', fallback: 365 },
  /*
   * GIỮ BAO LÂU RỒI DỌN — hai ngưỡng, hai bảng chỉ-lớn-lên.
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
  // Máy không đăng nhập lại quá ngần này ngày thì quên; lần sau được báo như thiết bị lạ.
  knownDeviceRetentionDays: { key: 'auth.known_device_retention_days', fallback: 180 },
  /*
   * Ngăn năm của `audit_log` cũ hơn ngần này năm thì `ops/audit-archive.sh` tách ra và dump
   * (OLD-DB-03). Chỉ script vận hành đọc — không có gì tự chạy: lưu trữ sổ NFR-03 là
   * việc người trực làm có chủ đích, không phải việc một cron lặng lẽ làm.
   */
  auditArchiveAfterYears: { key: 'audit.archive_after_years', fallback: 2 },
  /**
   * Relay bỏ một thư sau ngần này lần hỏng. Lease tăng gấp đôi sau mỗi lần hỏng (5, 10,
   * 20, 40, 80 rồi giữ 160 phút) nên 14 lần ≈ 24 giờ thử lại: SMTP chết vài giờ (Google bảo
   * trì, mất Internet) không làm thư rơi vào trạng thái bỏ. Khoá kỹ thuật, không mở trên màn
   * Tham số — hạ nó xuống là thư bị bỏ sớm mà không ai thấy ngoài danh sách gửi lỗi.
   */
  outboxMaxRelayAttempts: { key: 'outbox.max_relay_attempts', fallback: 14 },
} as const;

export type ConfigName = keyof typeof CONFIG_KEYS;
