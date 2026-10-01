/** Một dòng như `GET /admin/settings` trả về — khai báo ở `system-config.editable.ts` phía API. */
export interface SettingRow {
  name: string;
  key: string;
  group: 'auth' | 'vault' | 'approval' | 'expiry' | 'dashboard' | 'software' | 'ipam' | 'files';
  type: 'int' | 'text' | 'int_list';
  unit?:
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
    | 'files';
  min?: number;
  max?: number;
  maxLength?: number;
  warnAbove?: number;
  warnZero?: boolean;
  defaultValue: unknown;
  value: unknown;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Giá trị đang lưu → chữ trong ô nhập. */
export function toDraft(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Kiểm ô nhập TRƯỚC khi gửi — để người dùng thấy lỗi ngay cạnh ô. API vẫn là nơi quyết
 * (`validateSetting`); hai bên đọc CÙNG một khai báo min/max/maxLength do API trả về nên không
 * có bảng luật thứ hai phải giữ khớp.
 *
 * Một hình dạng trả về (`reason` là khoá i18n + tham số, `null` = hợp lệ) — `tsconfig.app.json`
 * không bật `strict`, union theo cờ boolean không thu hẹp được.
 */
export function checkDraft(
  row: SettingRow,
  draft: string,
): { value: unknown; reason: { key: string; params?: Record<string, unknown> } | null } {
  const text = draft.trim();
  if (row.type === 'text') {
    if (text === '') return { value: null, reason: { key: 'settings.errEmpty' } };
    if (row.maxLength !== undefined && text.length > row.maxLength) {
      return { value: null, reason: { key: 'settings.errTooLong', params: { max: row.maxLength } } };
    }
    return { value: text, reason: null };
  }
  if (row.type === 'int_list') {
    const parts = text.split(',').map((p) => p.trim());
    const nums = parts.map(Number);
    const ok =
      parts.every((p) => /^\d+$/.test(p)) &&
      nums.every((n) => inRange(row, n)) &&
      nums.every((n, i) => i === 0 || n > nums[i - 1]);
    return ok ? { value: nums.join(','), reason: null } : { value: null, reason: { key: 'settings.errList' } };
  }
  if (!/^-?\d+$/.test(text)) return { value: null, reason: { key: 'settings.errInt' } };
  const num = Number(text);
  if (!inRange(row, num)) {
    return { value: null, reason: { key: 'settings.errRange', params: { min: row.min, max: row.max } } };
  }
  return { value: num, reason: null };
}

/** Cảnh báo (không chặn) cho giá trị nguy hiểm — ngưỡng do API khai báo cùng khoá. */
export function warningOf(
  row: SettingRow,
  value: unknown,
): { key: string; params?: Record<string, unknown> } | null {
  if (typeof value !== 'number') return null;
  if (row.warnZero && value === 0) return { key: 'settings.warnZero' };
  if (row.warnAbove !== undefined && value > row.warnAbove) {
    return { key: 'settings.warnAbove', params: { limit: row.warnAbove } };
  }
  return null;
}

/**
 * Q-19: mô tả quá chừng này ký tự thì vào nút (i) cạnh nhãn. Mô tả dài hiện thẳng dưới mỗi ô
 * làm cột tham số dài gấp đôi và đẩy dòng "mặc định · sửa lần cuối" ra xa ô của nó. Đây là
 * luật trình bày, không phải tham số nghiệp vụ, nên không vào `system_config`.
 */
const INLINE_DESCRIPTION_MAX = 80;

/** Mô tả đi chỗ nào: `hint` (hiện dưới ô) hay `tip` (sau nút (i)) — đúng một trong hai. */
export function descriptionSlot(text: string | undefined): { hint?: string; tip?: string } {
  if (!text) return { hint: undefined, tip: undefined };
  return text.length > INLINE_DESCRIPTION_MAX
    ? { hint: undefined, tip: text }
    : { hint: text, tip: undefined };
}

function inRange(row: SettingRow, n: number): boolean {
  return (row.min === undefined || n >= row.min) && (row.max === undefined || n <= row.max);
}
