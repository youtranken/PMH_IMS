import type { TFunction } from 'i18next';
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
  ports: 'history.nat.fPorts',
  protocol: 'history.nat.fProtocol',
  internalIp: 'history.nat.fInternalIp',
  internalPort: 'history.nat.fInternalPort',
  usedBy: 'history.nat.fUsedBy',
  reason: 'history.fReason',
  enabled: 'history.nat.fEnabled',
  note: 'history.fNote',
};

export const ACTION_LABEL: Record<string, string> = {
  created: 'history.nat.actCreated',
  updated: 'history.nat.actUpdated',
  voided: 'history.nat.actVoided',
};

/*
 * `t` đi vào bằng THAM SỐ, không phải `useTranslation()` bên trong: mấy hàm này là hàm THUẦN,
 * và đó là lý do chúng có bài kiểm bảng dữ liệu không cần dựng React. Gọi hook ở đây là biến
 * chúng thành component và mất luôn cái đó.
 */
export function toNatHistory(rows: NatHistoryRow[], t: TFunction): HistoryEntry[] {
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actor: row.actor,
    action: ACTION_LABEL[row.action] ? t(ACTION_LABEL[row.action]) : row.action,
    detail: describe(row.changes, t),
  }));
}

function describe(
  changes: Record<string, { before: unknown; after: unknown }> | null,
  t: TFunction,
): string | null {
  if (!changes) return null;
  const parts = Object.entries(changes).map(([field, change]) => {
    const label = FIELD_LABEL[field] ? t(FIELD_LABEL[field]) : field;
    // Trường KHÔNG đổi đi kèm chỉ để làm bối cảnh (vd `ports` trong dòng "Gỡ rule") — vẽ
    // "A → A" là bắt người đọc dừng lại tìm xem đã đổi gì.
    if (change.before === change.after) return `${label} ${display(field, change.after, t)}`;
    return `${label}: ${display(field, change.before, t)} → ${display(field, change.after, t)}`;
  });
  return parts.length > 0 ? parts.join('; ') : null;
}

function display(field: string, value: unknown, t: TFunction): string {
  if (value === null || value === undefined || value === '') return t('history.blank');
  // `enabled` là boolean trong DB nhưng "true/false" không phải tiếng Việt.
  if (field === 'enabled')
    return t(value === true ? 'history.nat.stEnabledOn' : 'history.nat.stEnabledOff');
  return String(value);
}
