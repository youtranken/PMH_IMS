import { CONFIG_KEYS, type ConfigName } from './system-config.keys';

/**
 * Tham số vận hành SỬA ĐƯỢC trên màn /admin/settings (Q-14) — danh sách khai báo, không phải
 * "mọi dòng trong bảng".
 *
 * Khoá không có ở đây thì không đọc cũng không sửa được qua API này: `mail.from_address`,
 * `app.timezone` (đổi là lệch mọi mốc ngày), các ngưỡng dọn dữ liệu kỹ thuật, và bất cứ khoá bí
 * mật nào sau này. Muốn mở một khoá thì thêm vào đây kèm khoảng hợp lệ — khoảng là thứ chặn một
 * lần gõ nhầm biến thành "cả công ty không đăng nhập được".
 */

export type SettingGroup =
  | 'auth'
  | 'vault'
  | 'approval'
  | 'expiry'
  | 'dashboard'
  | 'software'
  | 'ipam'
  | 'files'
  | 'diagram'
  | 'devices'
  | 'iso';
export type SettingType = 'int' | 'text' | 'int_list';
export type SettingUnit =
  | 'seconds'
  | 'minutes'
  | 'hours'
  | 'days'
  | 'percent'
  | 'times'
  | 'per_minute'
  | 'ports'
  | 'rows'
  | 'mb'
  | 'kb'
  | 'files'
  | 'cells'
  | 'devices'
  | 'megapixels'
  | 'hops'
  | 'px';

export interface EditableSetting {
  name: ConfigName;
  group: SettingGroup;
  type: SettingType;
  unit?: SettingUnit;
  /** Khoảng hợp lệ (số, hoặc từng phần tử của danh sách số). */
  min?: number;
  max?: number;
  /** Trần độ dài cho khoá chữ. */
  maxLength?: number;
  /** Khuôn của khoá chữ: `month` = `YYYY-MM`. Chặn lúc ghi vì nơi đọc (`periodAccess`) bỏ qua chuỗi sai khuôn. */
  format?: 'month';
  /** Cảnh báo (không chặn) khi giá trị lớn hơn mức này — vd nới rate limit quá rộng. */
  warnAbove?: number;
  /** Cảnh báo khi đặt 0 — ở khoá này 0 nghĩa là TẮT hẳn một hàng rào. */
  warnZero?: boolean;
  /**
   * Danh sách là TẬP (thứ tự không mang nghĩa, vd danh sách cổng): không bắt tăng dần, chỉ cấm
   * trùng. Mặc định danh sách là các BẬC tăng dần (bậc chờ khi gõ sai).
   */
  unordered?: boolean;
  /** Trần số phần tử của danh sách (mặc định 10 — số bậc). */
  maxItems?: number;
}

export const EDITABLE_SETTINGS: readonly EditableSetting[] = [
  // Đăng nhập & bảo mật
  { name: 'sessionIdleMinutes', group: 'auth', type: 'int', unit: 'minutes', min: 5, max: 480 },
  { name: 'sessionAbsoluteHours', group: 'auth', type: 'int', unit: 'hours', min: 1, max: 72, warnAbove: 24 },
  { name: 'loginMaxFailedAttempts', group: 'auth', type: 'int', unit: 'times', min: 3, max: 20, warnAbove: 10 },
  { name: 'loginLockoutMinutes', group: 'auth', type: 'int', unit: 'minutes', min: 1, max: 1440 },
  { name: 'loginRateLimitPerIp', group: 'auth', type: 'int', unit: 'per_minute', min: 5, max: 1000, warnAbove: 100 },
  { name: 'rateTotpPerMinute', group: 'auth', type: 'int', unit: 'per_minute', min: 3, max: 60, warnAbove: 20 },
  { name: 'rateFileUploadPerMinute', group: 'auth', type: 'int', unit: 'per_minute', min: 5, max: 300 },
  { name: 'loginAccountBackoffMinutes', group: 'auth', type: 'int_list', unit: 'minutes', min: 1, max: 1440 },
  // Ân hạn phạm vi két: mở cho mọi route `@RequiresStepUp()` (tài khoản, tham số, két, cấp quyền), nên nằm nhóm đăng nhập chứ không phải két.
  { name: 'secretStepUpGraceMinutes', group: 'auth', type: 'int', unit: 'minutes', min: 1, max: 60, warnAbove: 30 },
  // Ân hạn phạm vi sơ đồ (AD-17) — đứng cạnh ân hạn két để SA thấy hai phạm vi tính riêng.
  { name: 'diagramStepUpGraceMinutes', group: 'auth', type: 'int', unit: 'minutes', min: 1, max: 60, warnAbove: 30 },
  { name: 'totpEnrollReauthMinutes', group: 'auth', type: 'int', unit: 'minutes', min: 1, max: 60 },
  // Dưới 1 phút thì người gõ chậm không kịp mở ứng dụng xác thực.
  { name: 'authTotpChallengeMinutes', group: 'auth', type: 'int', unit: 'minutes', min: 1, max: 30, warnAbove: 10 },
  // Trần một tuần: mật khẩu tạm nằm trong hộp thư lâu hơn thế là chìa thất lạc.
  { name: 'authTempPasswordHours', group: 'auth', type: 'int', unit: 'hours', min: 1, max: 168, warnAbove: 72 },
  { name: 'authSupportContact', group: 'auth', type: 'text', maxLength: 300 },
  // Két sắt
  { name: 'rateSecretRevealPerMinute', group: 'vault', type: 'int', unit: 'per_minute', min: 5, max: 300, warnAbove: 60 },
  { name: 'secretRevealSeconds', group: 'vault', type: 'int', unit: 'seconds', min: 10, max: 600, warnAbove: 120 },
  { name: 'secretStepUpMaxFailures', group: 'vault', type: 'int', unit: 'times', min: 3, max: 20 },
  { name: 'secretProbeAlertThreshold', group: 'vault', type: 'int', unit: 'times', min: 0, max: 50, warnZero: true },
  { name: 'secretProbeWindowMinutes', group: 'vault', type: 'int', unit: 'minutes', min: 1, max: 1440 },
  { name: 'secretProbeCooldownMinutes', group: 'vault', type: 'int', unit: 'minutes', min: 1, max: 1440 },
  // Dưới 2 thì lá leo thang đi ngay lượt sau lá đầu, tức là xoá thời gian nghỉ.
  { name: 'secretProbeEscalationMultiplier', group: 'vault', type: 'int', unit: 'times', min: 2, max: 20 },
  // Duyệt & break-glass
  { name: 'breakGlassMaxGrantHours', group: 'approval', type: 'int', unit: 'hours', min: 1, max: 168, warnAbove: 72 },
  { name: 'approvalReminderHours', group: 'approval', type: 'int', unit: 'hours', min: 0, max: 72, warnZero: true },
  { name: 'breakGlassPendingExpireHours', group: 'approval', type: 'int', unit: 'hours', min: 1, max: 168 },
  // Cửa sổ "break-glass gần đây" (X-02) của bảng điều khiển / hồ sơ.
  { name: 'breakGlassRecentWindowDays', group: 'approval', type: 'int', unit: 'days', min: 1, max: 365 },
  // Hạn & email
  { name: 'expiryCriticalDays', group: 'expiry', type: 'int', unit: 'days', min: 1, max: 90 },
  { name: 'expiryWarningDays', group: 'expiry', type: 'int', unit: 'days', min: 1, max: 365 },
  { name: 'expiryDigestExpiredDays', group: 'expiry', type: 'int', unit: 'days', min: 0, max: 365 },
  { name: 'expiryLookBackDays', group: 'expiry', type: 'int', unit: 'days', min: 30, max: 3650 },
  // Dashboard
  { name: 'dashboardSubnetFullPercent', group: 'dashboard', type: 'int', unit: 'percent', min: 50, max: 100 },
  { name: 'dashboardSecretStaleDays', group: 'dashboard', type: 'int', unit: 'days', min: 30, max: 3650 },
  { name: 'dashboardMaxItems', group: 'dashboard', type: 'int', unit: 'rows', min: 3, max: 30 },
  // Phần mềm (Q-13: 0 = tắt tự thanh lý)
  { name: 'softwareAutoRetireGraceDays', group: 'software', type: 'int', unit: 'days', min: 0, max: 365, warnZero: true },
  // Mạng IP & NAT. Trần dải chỉ siết (24..30) — lý do ở chú thích khoá trong `system-config.keys.ts`.
  { name: 'ipamSubnetMinPrefix', group: 'ipam', type: 'int', min: 24, max: 30 },
  { name: 'natWidePortRange', group: 'ipam', type: 'int', unit: 'ports', min: 10, max: 65535 },
  // Cổng "nhạy cảm" của sổ NAT (X-02): mở ra Internet thì cảnh báo. Là một TẬP cổng, không phải bậc.
  { name: 'natSensitivePorts', group: 'ipam', type: 'int_list', min: 1, max: 65535, unordered: true, maxItems: 50 },
  // Giấy tờ đính kèm (Q-18). Trần 25 = `FILE_HARD_CAP_MB`: multer/nginx chặn cứng ở đó.
  { name: 'fileMaxSizeMb', group: 'files', type: 'int', unit: 'mb', min: 1, max: 25 },
  { name: 'fileMaxFilesPerBatch', group: 'files', type: 'int', unit: 'files', min: 1, max: 20 },
  // Dọn blob không lùi lại được: dưới 7 ngày thì một lần xoá nhầm cuối tuần đã mất hẳn nội dung.
  { name: 'filePurgeAfterDays', group: 'files', type: 'int', unit: 'days', min: 7, max: 3650 },
  // Sơ đồ mạng. Trần trên của hai trần dung lượng (4 MB + 4 MB) giữ dưới trần body 12 MB của route lưu bản vẽ.
  { name: 'diagramEditorInitTimeoutSeconds', group: 'diagram', type: 'int', unit: 'seconds', min: 5, max: 120 },
  { name: 'diagramXmlMaxKb', group: 'diagram', type: 'int', unit: 'kb', min: 256, max: 4096 },
  { name: 'diagramSvgMaxKb', group: 'diagram', type: 'int', unit: 'kb', min: 256, max: 4096 },
  { name: 'diagramMaxCells', group: 'diagram', type: 'int', unit: 'cells', min: 500, max: 20000, warnAbove: 10000 },
  { name: 'diagramPresenceTtlSeconds', group: 'diagram', type: 'int', unit: 'seconds', min: 20, max: 600 },
  { name: 'diagramIconSvgMaxKb', group: 'diagram', type: 'int', unit: 'kb', min: 10, max: 500 },
  { name: 'diagramAutolayoutMaxNodes', group: 'diagram', type: 'int', unit: 'devices', min: 10, max: 2000, warnAbove: 500 },
  { name: 'diagramExportMaxMegapixels', group: 'diagram', type: 'int', unit: 'megapixels', min: 4, max: 100, warnAbove: 60 },
  { name: 'diagramExportTimeoutSeconds', group: 'diagram', type: 'int', unit: 'seconds', min: 5, max: 120 },
  { name: 'diagramDriftNotifyEnabled', group: 'diagram', type: 'int', min: 0, max: 1, warnZero: true },
  { name: 'diagramDriftSweepHour', group: 'diagram', type: 'int', unit: 'hours', min: 0, max: 23 },
  { name: 'diagramPathMaxHops', group: 'diagram', type: 'int', unit: 'hops', min: 2, max: 50, warnAbove: 30 },
  { name: 'diagramPhotoMaxPx', group: 'diagram', type: 'int', unit: 'px', min: 120, max: 1600, warnAbove: 960 },
  { name: 'diagramDeviceWidthPx', group: 'diagram', type: 'int', unit: 'px', min: 40, max: 480 },
  { name: 'devicePortTemplateMax', group: 'devices', type: 'int', unit: 'ports', min: 8, max: 1024 },
  // Phiếu ISO (Q-28). Tháng bắt đầu dạng YYYY-MM; loại bản ký là danh sách đuôi cách nhau dấu phẩy.
  { name: 'isoFirstMonth', group: 'iso', type: 'text', maxLength: 7, format: 'month' },
  { name: 'isoBackupSystem', group: 'iso', type: 'text', maxLength: 120 },
  { name: 'isoAntivirusSystem', group: 'iso', type: 'text', maxLength: 120 },
  { name: 'isoScanMaxMb', group: 'iso', type: 'int', unit: 'mb', min: 1, max: 25 },
  { name: 'isoScanTypes', group: 'iso', type: 'text', maxLength: 40 },
  { name: 'isoRemindHour', group: 'iso', type: 'int', unit: 'hours', min: 0, max: 23 },
  { name: 'isoRemindBackupAfterDays', group: 'iso', type: 'int', unit: 'days', min: 1, max: 31 },
  { name: 'isoRemindSubmitRepeatDays', group: 'iso', type: 'int', unit: 'days', min: 1, max: 31 },
  { name: 'isoRemindApprovalDays', group: 'iso', type: 'int', unit: 'days', min: 1, max: 31 },
  { name: 'isoRemindSignedDays', group: 'iso', type: 'int', unit: 'days', min: 1, max: 90 },
  { name: 'isoRemindInProgressDays', group: 'iso', type: 'int', unit: 'days', min: 1, max: 90 },
];

export function editableByKey(key: string): EditableSetting | undefined {
  return EDITABLE_SETTINGS.find((spec) => CONFIG_KEYS[spec.name].key === key);
}

/**
 * Kiểm + chuẩn hoá MỘT giá trị gửi lên. Hàm thuần, một hình dạng trả về: `reason` khác `null`
 * là từ chối (câu tiếng Việt cho người dùng).
 *
 * Số: nhận số nguyên hoặc chuỗi số nguyên. Chuỗi RỖNG không bao giờ thành 0 — đó đúng là bẫy
 * đã làm cả công ty không đăng nhập được (`system-config.parse.ts`).
 */
export function validateSetting(
  spec: EditableSetting,
  raw: unknown,
): { value: unknown; reason: string | null } {
  if (spec.type === 'text') {
    if (typeof raw !== 'string') return { value: null, reason: 'Giá trị phải là chữ.' };
    const text = raw.trim();
    if (text === '') return { value: null, reason: 'Không được để trống.' };
    if (spec.maxLength !== undefined && text.length > spec.maxLength) {
      return { value: null, reason: `Tối đa ${spec.maxLength} ký tự.` };
    }
    if (spec.format === 'month' && !MONTH_RE.test(text)) {
      return { value: null, reason: 'Nhập tháng dạng YYYY-MM, ví dụ 2026-11.' };
    }
    return { value: text, reason: null };
  }

  if (spec.type === 'int_list') {
    if (typeof raw !== 'string') return { value: null, reason: 'Nhập các số cách nhau bằng dấu phẩy.' };
    const parts = raw.split(',').map((part) => part.trim());
    if (parts.some((part) => !/^\d+$/.test(part))) {
      return { value: null, reason: 'Nhập các số nguyên cách nhau bằng dấu phẩy, ví dụ 5,15,30.' };
    }
    const nums = parts.map(Number);
    const outOfRange = nums.find((n) => !inRange(spec, n));
    if (outOfRange !== undefined) return { value: null, reason: rangeReason(spec) };
    if (spec.unordered) {
      if (new Set(nums).size !== nums.length) return { value: null, reason: 'Có số bị trùng.' };
    } else if (nums.some((n, i) => i > 0 && n <= nums[i - 1])) {
      return { value: null, reason: 'Các bậc phải tăng dần.' };
    }
    const maxItems = spec.maxItems ?? 10;
    if (nums.length > maxItems) return { value: null, reason: `Tối đa ${maxItems} ${spec.unordered ? 'mục' : 'bậc'}.` };
    return { value: nums.join(','), reason: null };
  }

  const num = toInteger(raw);
  if (num === null) return { value: null, reason: 'Giá trị phải là số nguyên.' };
  if (!inRange(spec, num)) return { value: null, reason: rangeReason(spec) };
  return { value: num, reason: null };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function toInteger(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return /^-?\d+$/.test(text) ? Number(text) : null;
}

function inRange(spec: EditableSetting, n: number): boolean {
  return (spec.min === undefined || n >= spec.min) && (spec.max === undefined || n <= spec.max);
}

function rangeReason(spec: EditableSetting): string {
  return `Phải từ ${spec.min ?? '…'} đến ${spec.max ?? '…'}.`;
}
