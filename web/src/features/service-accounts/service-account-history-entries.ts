import type { HistoryEntry } from '@/ui/history-panel';
import type { ServiceAccountHistoryRow } from './service-account-types';

/**
 * Đổi `service_account_history` thô thành dòng người đọc được cho `HistoryPanel` dùng chung.
 * Tách khỏi component để test bằng bảng dữ liệu (không cần render) — cùng khuôn với lịch sử
 * thiết bị / phần mềm / IP.
 */

const FIELD_LABEL: Record<string, string> = {
  code: 'mã',
  kind: 'loại',
  name: 'tên',
  login: 'tên đăng nhập',
  department: 'bộ phận',
  ownerName: 'người phụ trách',
  groupName: 'nhóm VPN',
  allowedIps: 'dải IP được phép',
  note: 'ghi chú',
  status: 'trạng thái',
  reason: 'lý do',
};

const ACTION_LABEL: Record<string, string> = {
  created: 'Tạo hồ sơ',
  updated: 'Sửa hồ sơ',
  disabled: 'Vô hiệu hóa',
  enabled: 'Bật lại',
};

const KIND_LABEL: Record<string, string> = {
  shared: 'Tài khoản dùng chung',
  vpn: 'Tài khoản VPN',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Đang dùng',
  disabled: 'Đã vô hiệu',
};

export function toServiceAccountHistory(rows: ServiceAccountHistoryRow[]): HistoryEntry[] {
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
    // Trường KHÔNG đổi đi kèm chỉ để làm bối cảnh — vẽ "A → A" là bắt người đọc dừng lại
    // tìm xem đã đổi gì.
    if (change.before === change.after) return `${label} ${display(field, change.after)}`;
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
