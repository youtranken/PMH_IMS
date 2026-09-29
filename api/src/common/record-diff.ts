/**
 * So sánh bản ghi TRƯỚC và SAU khi sửa — hàm THUẦN, dùng chung cho mọi bảng có lịch sử
 * (AD-13): thiết bị, phần mềm, ISP, IP…
 *
 * Vì sao không lưu nguyên cả bản ghi mỗi lần sửa: tab Lịch sử là để người ta đọc "ai đổi
 * gì", không phải để đọc hai bãi JSON rồi tự dò khác nhau chỗ nào.
 */

interface FieldChange {
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

export type RecordChanges = Record<string, FieldChange>;

/**
 * Trường KHÔNG có trong `after` = không đụng tới (giữ nguyên), khác hẳn với có mặt nhưng
 * bằng null = xóa giá trị. Gộp hai chuyện này lại là nguồn của lỗi "sửa tên xong mất serial".
 */
export function diffRecord(
  tracked: readonly string[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): RecordChanges {
  const changes: RecordChanges = {};
  for (const field of tracked) {
    if (!(field in after)) continue;
    const from = normalize(before[field]);
    const to = normalize(after[field]);
    if (from !== to) changes[field] = { before: from, after: to };
  }
  return changes;
}

/**
 * Đưa mọi hình dạng "rỗng" về cùng một giá trị `null` trước khi so.
 * Không làm thế thì ô ghi chú đang trống, người dùng bấm vào rồi bấm ra, hệ thống ghi ngay
 * một dòng lịch sử "đổi ghi chú: null → ''" — lịch sử đầy rác trong một tuần.
 * `Date` về chuỗi ngày YYYY-MM-DD vì cột ngày là ngày lịch, không phải thời điểm.
 */
function normalize(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  // Không bảng nào có trường object; gặp thì coi như không so được, thà bỏ qua còn hơn
  // ghi "[object Object]" vào lịch sử vĩnh viễn.
  return null;
}

export function hasChanges(changes: RecordChanges): boolean {
  return Object.keys(changes).length > 0;
}
