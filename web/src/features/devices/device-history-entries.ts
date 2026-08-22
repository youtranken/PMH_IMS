import type { HistoryEntry } from '@/ui/history-panel';
import type { DeviceHistoryRow } from './device-types';

/**
 * Đổi bản ghi `device_history` thô thành dòng người đọc được cho `HistoryPanel` dùng chung.
 * Tách khỏi component để test được bằng bảng dữ liệu (không cần render).
 *
 * FR-007: tab Lịch sử để trả lời "ai đổi gì, lúc nào" — không phải để đọc JSON.
 */

/** Tên trường → nhãn tiếng Việt. Trường lạ giữ nguyên tên còn hơn giấu đi. */
const FIELD_LABEL: Record<string, string> = {
  code: 'mã',
  name: 'tên',
  deviceTypeId: 'loại',
  model: 'model',
  serial: 'serial',
  siteId: 'site',
  cabinetId: 'tủ mạng',
  vendorId: 'nhà cung cấp',
  assignedTo: 'người sử dụng',
  department: 'bộ phận',
  purchaseDate: 'ngày mua',
  warrantyStart: 'bảo hành từ',
  warrantyEnd: 'bảo hành đến',
  status: 'trạng thái',
  note: 'ghi chú',
};

const ACTION_LABEL: Record<string, string> = {
  created: 'Tạo hồ sơ',
  updated: 'Sửa hồ sơ',
  'status-changed': 'Đổi trạng thái',
  imported: 'Nhập từ Excel',
  'imported-update': 'Cập nhật khi nhập từ Excel',
};

const STATUS_LABEL: Record<string, string> = {
  in_use: 'Đang dùng',
  spare: 'Dự phòng',
  broken: 'Hỏng',
  retired: 'Đã thanh lý',
};

export function toHistoryEntries(rows: DeviceHistoryRow[]): HistoryEntry[] {
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actor: row.actor,
    action: ACTION_LABEL[row.action] ?? row.action,
    detail: describeChanges(row.changes),
  }));
}

function describeChanges(
  changes: Record<string, { before: unknown; after: unknown }> | null,
): string | null {
  if (!changes) return null;
  const parts = Object.entries(changes)
    // Id danh mục là chuỗi uuid, hiện ra chỉ tổ rối; nói rõ "đã đổi" là đủ dùng.
    .map(([field, change]) => {
      const label = FIELD_LABEL[field] ?? field;
      if (field.endsWith('Id')) return `đổi ${label}`;
      return `${label}: ${display(field, change.before)} → ${display(field, change.after)}`;
    });
  return parts.length > 0 ? parts.join('; ') : null;
}

function display(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(trống)';
  if (field === 'status') return STATUS_LABEL[String(value)] ?? String(value);
  return String(value);
}
