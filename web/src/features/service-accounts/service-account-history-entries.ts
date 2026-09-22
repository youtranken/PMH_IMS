import type { TFunction } from 'i18next';
import type { HistoryEntry } from '@/ui/history-panel';
import type { ServiceAccountHistoryRow } from './service-account-types';
import { describeFieldChanges, type FieldChanges } from '@/ui/history-changes';

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

/** Nhãn + cách đọc riêng của tài khoản dịch vụ; phần chung ở `ui/history-changes.ts`. */
function describe(changes: FieldChanges, t: TFunction): string | null {
  return describeFieldChanges(changes, t, {
    label: (field) => (FIELD_LABEL[field] ? t(FIELD_LABEL[field]) : field),
    display: (field, value) => {
      if (value === null || value === undefined || value === '') return undefined;
      const table = field === 'kind' ? KIND_LABEL : field === 'status' ? STATUS_LABEL : null;
      if (!table) return undefined;
      const key = table[String(value)];
      return key ? t(key) : String(value);
    },
    unchangedAsContext: true,
  });
}

