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

export type SettingGroup = 'auth' | 'vault' | 'approval' | 'expiry' | 'dashboard' | 'software';
export type SettingType = 'int' | 'text' | 'int_list';
export type SettingUnit =
  | 'seconds'
  | 'minutes'
  | 'hours'
  | 'days'
  | 'percent'
  | 'times'
  | 'per_minute';

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
  /** Cảnh báo (không chặn) khi giá trị lớn hơn mức này — vd nới rate limit quá rộng. */
  warnAbove?: number;
  /** Cảnh báo khi đặt 0 — ở khoá này 0 nghĩa là TẮT hẳn một hàng rào. */
  warnZero?: boolean;
}

export const EDITABLE_SETTINGS: readonly EditableSetting[] = [
  // Đăng nhập & bảo mật
  { name: 'sessionIdleMinutes', group: 'auth', type: 'int', unit: 'minutes', min: 5, max: 480 },
  { name: 'sessionAbsoluteHours', group: 'auth', type: 'int', unit: 'hours', min: 1, max: 72, warnAbove: 24 },
  { name: 'loginMaxFailedAttempts', group: 'auth', type: 'int', unit: 'times', min: 3, max: 20, warnAbove: 10 },
  { name: 'loginLockoutMinutes', group: 'auth', type: 'int', unit: 'minutes', min: 1, max: 1440 },
  { name: 'loginRateLimitPerIp', group: 'auth', type: 'int', unit: 'per_minute', min: 5, max: 1000, warnAbove: 100 },
  { name: 'loginAccountBackoffMinutes', group: 'auth', type: 'int_list', unit: 'minutes', min: 1, max: 1440 },
  { name: 'totpEnrollReauthMinutes', group: 'auth', type: 'int', unit: 'minutes', min: 1, max: 60 },
  { name: 'authSupportContact', group: 'auth', type: 'text', maxLength: 300 },
  // Két sắt
  { name: 'secretRevealSeconds', group: 'vault', type: 'int', unit: 'seconds', min: 10, max: 600, warnAbove: 120 },
  { name: 'secretStepUpGraceMinutes', group: 'vault', type: 'int', unit: 'minutes', min: 1, max: 60, warnAbove: 30 },
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
  // Hạn & email
  { name: 'expiryCriticalDays', group: 'expiry', type: 'int', unit: 'days', min: 1, max: 90 },
  { name: 'expiryWarningDays', group: 'expiry', type: 'int', unit: 'days', min: 1, max: 365 },
  { name: 'expiryDigestExpiredDays', group: 'expiry', type: 'int', unit: 'days', min: 0, max: 365 },
  // Dashboard
  { name: 'dashboardSubnetFullPercent', group: 'dashboard', type: 'int', unit: 'percent', min: 50, max: 100 },
  { name: 'dashboardSecretStaleDays', group: 'dashboard', type: 'int', unit: 'days', min: 30, max: 3650 },
  // Phần mềm (Q-13: 0 = tắt tự thanh lý)
  { name: 'softwareAutoRetireGraceDays', group: 'software', type: 'int', unit: 'days', min: 0, max: 365, warnZero: true },
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
    if (nums.some((n, i) => i > 0 && n <= nums[i - 1])) {
      return { value: null, reason: 'Các bậc phải tăng dần.' };
    }
    if (nums.length > 10) return { value: null, reason: 'Tối đa 10 bậc.' };
    return { value: nums.join(','), reason: null };
  }

  const num = toInteger(raw);
  if (num === null) return { value: null, reason: 'Giá trị phải là số nguyên.' };
  if (!inRange(spec, num)) return { value: null, reason: rangeReason(spec) };
  return { value: num, reason: null };
}

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
