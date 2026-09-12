import type { HistoryEntry } from '@/ui/history-panel';

/**
 * Đổi `nat_rule_history` thô thành dòng người đọc được cho `HistoryPanel` dùng chung.
 *
 * Tách khỏi component để test bằng bảng dữ liệu — cùng khuôn với lịch sử thiết bị / phần mềm /
 * IP / tài khoản dịch vụ.
 */

export interface NatHistoryRow {
  id: string;
  action: string;
  actor: string;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  createdAt: string;
}

const FIELD_LABEL: Record<string, string> = {
  ports: 'port ngoài',
  protocol: 'giao thức',
  internalIp: 'IP trong',
  internalPort: 'port trong',
  usedBy: 'mở cho ai',
  reason: 'lý do',
  enabled: 'trạng thái',
  note: 'ghi chú',
};

export const ACTION_LABEL: Record<string, string> = {
  created: 'Mở rule',
  updated: 'Sửa rule',
  voided: 'Gỡ rule',
};

export function toNatHistory(rows: NatHistoryRow[]): HistoryEntry[] {
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
    // Trường KHÔNG đổi đi kèm chỉ để làm bối cảnh (vd `ports` trong dòng "Gỡ rule") — vẽ
    // "A → A" là bắt người đọc dừng lại tìm xem đã đổi gì.
    if (change.before === change.after) return `${label} ${display(field, change.after)}`;
    return `${label}: ${display(field, change.before)} → ${display(field, change.after)}`;
  });
  return parts.length > 0 ? parts.join('; ') : null;
}

function display(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(trống)';
  // `enabled` là boolean trong DB nhưng "true/false" không phải tiếng Việt.
  if (field === 'enabled') return value === true ? 'Đang bật' : 'Đã tắt';
  return String(value);
}
