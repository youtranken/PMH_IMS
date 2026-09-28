/**
 * `detail` của nhật ký là JSON tự do do từng module ghi. Hàm này nhận ra ba hình dạng "đổi
 * từ gì sang gì" đang có trong hệ thống để màn chi tiết vẽ thành bảng Trường · Trước · Sau,
 * còn lại vẫn đọc từng dòng `khoá: giá trị`:
 *
 *   - `{ phone: { before, after }, … }`       — sửa hồ sơ tài khoản;
 *   - `{ before: {…}, after: {…} }`           — sửa danh mục (`before` chỉ chứa trường đổi);
 *   - `{ changes: { phone: [cũ, mới] } }`     — dạng cặp.
 *
 * Một hình dạng trả về (web không bật `strict`).
 */
export interface DetailChange {
  field: string;
  before: unknown;
  after: unknown;
}

export function detailChanges(detail: unknown): { changes: DetailChange[]; rest: [string, unknown][] } {
  if (detail === null || detail === undefined || typeof detail !== 'object' || Array.isArray(detail)) {
    return { changes: [], rest: detail === null || detail === undefined ? [] : [['', detail]] };
  }
  const entries = Object.entries(detail as Record<string, unknown>);
  const changes: DetailChange[] = [];
  const rest: [string, unknown][] = [];

  const record = detail as Record<string, unknown>;
  if (isPlainObject(record.before) && isPlainObject(record.after)) {
    const before = record.before;
    const after = record.after;
    for (const field of Object.keys(before)) {
      changes.push({ field, before: before[field], after: after[field] });
    }
    for (const [key, value] of entries) {
      if (key !== 'before' && key !== 'after') rest.push([key, value]);
    }
    return { changes, rest };
  }

  for (const [key, value] of entries) {
    if (key === 'changes' && isPlainObject(value)) {
      for (const [field, pair] of Object.entries(value)) {
        if (Array.isArray(pair) && pair.length === 2) {
          changes.push({ field, before: pair[0], after: pair[1] });
        } else {
          rest.push([`changes.${field}`, pair]);
        }
      }
      continue;
    }
    if (isPlainObject(value) && 'before' in value && 'after' in value && Object.keys(value).length === 2) {
      changes.push({ field: key, before: value.before, after: value.after });
      continue;
    }
    rest.push([key, value]);
  }
  return { changes, rest };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
