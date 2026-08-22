import type { HistoryEntry } from '@/ui/history-panel';
import type { SoftwareHistoryRow } from './software-types';

/**
 * Đổi `software_history` thô thành dòng người đọc được cho `HistoryPanel` dùng chung.
 * Tách khỏi component để test bằng bảng dữ liệu (không cần render).
 */

const FIELD_LABEL: Record<string, string> = {
  code: 'mã',
  name: 'tên',
  kind: 'loại',
  vendorId: 'nhà cung cấp',
  seatTotal: 'số seat',
  startDate: 'ngày bắt đầu',
  endDate: 'ngày hết hạn',
  note: 'ghi chú',
  status: 'trạng thái',
};

const ACTION_LABEL: Record<string, string> = {
  created: 'Tạo hồ sơ',
  updated: 'Sửa hồ sơ',
  renewed: 'Gia hạn',
};

const KIND_LABEL: Record<string, string> = {
  license: 'License phần mềm',
  ssl: 'Chứng chỉ SSL',
  domain: 'Tên miền',
  maintenance: 'Hợp đồng bảo trì',
  other: 'Khác',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Đang dùng',
  expired_ok: 'Hết hạn, không gia hạn',
  retired: 'Đã bỏ',
};

export function toSoftwareHistory(rows: SoftwareHistoryRow[]): HistoryEntry[] {
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actor: row.actor,
    action: ACTION_LABEL[row.action] ?? row.action,
    detail: describe(row.changes),
  }));
}

function describe(
  changes: Record<string, { before: unknown; after: unknown }> | null,
): string | null {
  if (!changes) return null;
  const parts = Object.entries(changes).map(([field, change]) => {
    const label = FIELD_LABEL[field] ?? field;
    // Id danh mục là uuid, hiện ra chỉ tổ rối — nói "đã đổi" là đủ dùng.
    if (field.endsWith('Id')) return `đổi ${label}`;
    return `${label}: ${display(field, change.before)} → ${display(field, change.after)}`;
  });
  return parts.length > 0 ? parts.join('; ') : null;
}

function display(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(trống)';
  if (field === 'kind') return KIND_LABEL[String(value)] ?? String(value);
  if (field === 'status') return STATUS_LABEL[String(value)] ?? String(value);
  return String(value);
}
