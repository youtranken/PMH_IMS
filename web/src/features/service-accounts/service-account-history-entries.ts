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
    actorName: row.actorName ?? undefined,
    action: ACTION_LABEL[row.action] ? t(ACTION_LABEL[row.action]) : row.action,
    detail: describe(row.changes, t, row.action === 'created'),
  }));
}

/**
 * Lượt vô hiệu hóa đang có hiệu lực — ai, lúc nào, vì sao — cho băng rôn đầu trang hồ sơ, hoặc
 * `null`. `rows` theo thứ tự API trả (mới nhất trước); chỉ lượt đổi trạng thái MỚI NHẤT quyết
 * định: đóng rồi mở lại thì lý do đóng cũ không còn đúng với hồ sơ đang xem.
 */
export function lastDisable(
  rows: ServiceAccountHistoryRow[],
): { at: string; actor: string; reason: string | null } | null {
  const latest = rows.find((row) => row.action === 'disabled' || row.action === 'enabled');
  if (!latest || latest.action !== 'disabled') return null;
  const reason = latest.changes?.reason?.after;
  return {
    at: latest.createdAt,
    actor: latest.actorName ?? latest.actor,
    reason: typeof reason === 'string' && reason.trim() ? reason : null,
  };
}

/** Nhãn + cách đọc riêng của tài khoản dịch vụ; phần chung ở `ui/history-changes.ts`. */
function describe(changes: FieldChanges, t: TFunction, initial: boolean): string | null {
  return describeFieldChanges(changes, t, {
    initial,
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

