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
    actorName: row.actorName ?? undefined,
    action: actionLabel(row, t),
    detail: describe(row.changes, t, row.action === 'created'),
  }));
}

/**
 * Thanh lý không có hành động riêng trong sổ — nó là một lượt `updated` đổi trạng thái sang
 * `terminated`. Q-04 đòi đọc ra được "ai thanh lý", nên dòng đó phải mang tên của nó thay vì
 * lẫn vào giữa các lượt "Sửa hồ sơ".
 */
function actionLabel(row: IspHistoryRow, t: TFunction): string {
  if (statusAfter(row) === 'terminated') return t('history.isp.actTerminated');
  return ACTION_LABEL[row.action] ? t(ACTION_LABEL[row.action]) : row.action;
}

function statusAfter(row: IspHistoryRow): unknown {
  return row.changes?.status?.after;
}

/**
 * Lượt thanh lý đang có hiệu lực, hoặc `null`.
 *
 * `rows` đi theo thứ tự API trả (mới nhất trước). Chỉ lượt đổi trạng thái MỚI NHẤT quyết định:
 * thanh lý rồi bật lại thì cái tên người thanh lý cũ không còn đúng với hồ sơ đang xem.
 */
export function liquidationOf(rows: IspHistoryRow[]): { at: string; actor: string } | null {
  const latest = rows.find((row) => statusAfter(row) !== undefined);
  if (!latest || statusAfter(latest) !== 'terminated') return null;
  // Họ tên khi API tra được — "bởi Lê Minh" đọc được, email thì phải tự dịch ra người.
  return { at: latest.createdAt, actor: latest.actorName ?? latest.actor };
}

/** Nhãn + cách đọc riêng của màn này; phần chung ở `ui/history-changes.ts` (AD-15). */
function describe(changes: FieldChanges, t: TFunction, initial: boolean): string | null {
  return describeFieldChanges(changes, t, {
    initial,
    label: (field) => (FIELD_LABEL[field] ? t(FIELD_LABEL[field]) : field),
    display: (field, value) => {
      if (field !== 'status' || value === null || value === undefined || value === '') return undefined;
      const key = STATUS_LABEL[String(value)];
      return key ? t(key) : String(value);
    },
  });
}
