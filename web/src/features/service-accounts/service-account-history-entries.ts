import type { TFunction } from 'i18next';
import type { HistoryEntry } from '@/ui/history-panel';
import type { ServiceAccountHistoryRow } from './service-account-types';

/**
 * Đổi `service_account_history` thô thành dòng người đọc được cho `HistoryPanel` dùng chung.
 * Tách khỏi component để test bằng bảng dữ liệu (không cần render) — cùng khuôn với lịch sử
 * thiết bị / phần mềm / IP.
 */

const FIELD_LABEL: Record<string, string> = {
  code: 'history.serviceAccounts.fCode',
  kind: 'history.fKind',
  name: 'history.fName',
  login: 'history.serviceAccounts.fLogin',
  department: 'history.fDepartment',
  ownerName: 'history.serviceAccounts.fOwnerName',
  groupName: 'history.serviceAccounts.fGroupName',
  allowedIps: 'history.serviceAccounts.fAllowedIps',
  note: 'history.fNote',
  status: 'history.fStatus',
  reason: 'history.fReason',
};

export const ACTION_LABEL: Record<string, string> = {
  created: 'history.serviceAccounts.actCreated',
  updated: 'history.serviceAccounts.actUpdated',
  disabled: 'history.serviceAccounts.actDisabled',
  enabled: 'history.serviceAccounts.actEnabled',
};

const KIND_LABEL: Record<string, string> = {
  shared: 'history.serviceAccounts.kindShared',
  vpn: 'history.serviceAccounts.kindVpn',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'history.serviceAccounts.stActive',
  disabled: 'history.serviceAccounts.stDisabled',
};

/*
 * `t` đi vào bằng THAM SỐ, không phải `useTranslation()` bên trong: mấy hàm này là hàm THUẦN,
 * và đó là lý do chúng có bài kiểm bảng dữ liệu không cần dựng React. Gọi hook ở đây là biến
 * chúng thành component và mất luôn cái đó.
 */
export function toServiceAccountHistory(
  rows: ServiceAccountHistoryRow[],
  t: TFunction,
): HistoryEntry[] {
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
    // Trường KHÔNG đổi đi kèm chỉ để làm bối cảnh — vẽ "A → A" là bắt người đọc dừng lại
    // tìm xem đã đổi gì.
    if (change.before === change.after) return `${label} ${display(field, change.after, t)}`;
    return `${label}: ${display(field, change.before, t)} → ${display(field, change.after, t)}`;
  });
  return parts.length > 0 ? parts.join('; ') : null;
}

function display(field: string, value: unknown, t: TFunction): string {
  if (value === null || value === undefined || value === '') return t('history.blank');
  const bang = field === 'kind' ? KIND_LABEL : field === 'status' ? STATUS_LABEL : null;
  if (bang) {
    const khoa = bang[String(value)];
    return khoa ? t(khoa) : String(value);
  }
  return String(value);
}
