import type { TFunction } from 'i18next';
import type { HistoryEntry } from '@/ui/history-panel';
import type { IspHistoryRow } from './isp-types';

/** Đổi `isp_line_history` thô thành dòng đọc được cho `HistoryPanel` dùng chung. */

const FIELD_LABEL: Record<string, string> = {
  code: 'history.isp.fCode',
  provider: 'history.isp.fProvider',
  bandwidth: 'history.isp.fBandwidth',
  wanIp: 'history.isp.fWanIp',
  siteId: 'history.fSiteId',
  deviceId: 'history.isp.fDeviceId',
  hotline: 'history.isp.fHotline',
  contractNo: 'history.isp.fContractNo',
  startDate: 'history.fStartDate',
  endDate: 'history.fEndDate',
  note: 'history.fNote',
  status: 'history.fStatus',
};

export const ACTION_LABEL: Record<string, string> = {
  created: 'history.isp.actCreated',
  updated: 'history.isp.actUpdated',
  renewed: 'history.isp.actRenewed',
  /*
   * Sinh ra khi THIẾT BỊ đang cắm đường này bị thanh lý (`isp-device-retirement.ts`) — hợp
   * đồng giữ nguyên, chỉ rời khỏi máy. Nhãn phải nói đủ vế sau, vì người mở sổ lúc ấy đang lo
   * đúng một câu: "đường truyền của tôi có bị cắt không?".
   */
  'device-detached': 'history.isp.actDeviceDetached',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'history.isp.stActive',
  suspended: 'history.isp.stSuspended',
  terminated: 'history.isp.stTerminated',
};

/*
 * `t` đi vào bằng THAM SỐ, không phải `useTranslation()` bên trong: mấy hàm này là hàm THUẦN,
 * và đó là lý do chúng có bài kiểm bảng dữ liệu không cần dựng React. Gọi hook ở đây là biến
 * chúng thành component và mất luôn cái đó.
 */
export function toIspHistory(rows: IspHistoryRow[], t: TFunction): HistoryEntry[] {
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
    // Id là uuid — hiện ra chỉ tổ rối, nói "đã đổi" là đủ dùng.
    if (field.endsWith('Id')) return t('history.changedOnly', { field: label });
    return `${label}: ${display(field, change.before, t)} → ${display(field, change.after, t)}`;
  });
  return parts.length > 0 ? parts.join('; ') : null;
}

function display(field: string, value: unknown, t: TFunction): string {
  if (value === null || value === undefined || value === '') return t('history.blank');
  if (field === 'status') {
    const key = STATUS_LABEL[String(value)];
    return key ? t(key) : String(value);
  }
  return String(value);
}
