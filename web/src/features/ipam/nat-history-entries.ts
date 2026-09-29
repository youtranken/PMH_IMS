import type { TFunction } from 'i18next';
import type { HistoryEntry } from '@/ui/history-panel';
import { describeFieldChanges, type FieldChanges } from '@/ui/history-changes';

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
  /** Họ tên người làm — API tra (`withActorNames`); vắng thì panel hiện email. */
  actorName?: string | null;
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
    actorName: row.actorName ?? undefined,
    action: ACTION_LABEL[row.action] ? t(ACTION_LABEL[row.action]) : row.action,
    detail: describe(row.changes, t),
  }));
}

/** Nhãn + cách đọc riêng của sổ NAT; phần chung ở `ui/history-changes.ts` (AD-15). */
function describe(changes: FieldChanges, t: TFunction): string | null {
  return describeFieldChanges(changes, t, {
    label: (field) => (FIELD_LABEL[field] ? t(FIELD_LABEL[field]) : field),
    // `enabled` là boolean trong DB nhưng "true/false" không phải tiếng Việt.
    display: (field, value) =>
      field === 'enabled'
        ? t(value === true ? 'history.nat.stEnabledOn' : 'history.nat.stEnabledOff')
        : undefined,
    // `ports` đi kèm dòng "Gỡ rule" chỉ để làm bối cảnh — xem chú thích ở hàm dùng chung.
    unchangedAsContext: true,
  });
}

