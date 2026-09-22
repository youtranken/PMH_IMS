import type { TFunction } from 'i18next';
import type { HistoryEntry } from '@/ui/history-panel';
import type { IspHistoryRow } from './isp-types';
import { describeFieldChanges, type FieldChanges } from '@/ui/history-changes';

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

/** Nhãn + cách đọc riêng của màn này; phần chung ở `ui/history-changes.ts` (AD-15). */
function describe(changes: FieldChanges, t: TFunction): string | null {
  return describeFieldChanges(changes, t, {
    label: (field) => (FIELD_LABEL[field] ? t(FIELD_LABEL[field]) : field),
    display: (field, value) => {
      if (field !== 'status' || value === null || value === undefined || value === '') return undefined;
      const key = STATUS_LABEL[String(value)];
      return key ? t(key) : String(value);
    },
  });
}
