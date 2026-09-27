import type { TFunction } from 'i18next';
import { formatMoney } from '@/lib/format';
import type { HistoryEntry } from '@/ui/history-panel';
import type { SoftwareHistoryRow } from './software-types';
import { describeFieldChanges, type FieldChanges } from '@/ui/history-changes';

/**
 * Đổi `software_history` thô thành dòng người đọc được cho `HistoryPanel` dùng chung.
 * Tách khỏi component để test bằng bảng dữ liệu (không cần render).
 */

const FIELD_LABEL: Record<string, string> = {
  code: 'history.software.fCode',
  name: 'history.fName',
  kind: 'history.fKind',
  vendorId: 'history.fVendorId',
  seatTotal: 'history.software.fSeatTotal',
  startDate: 'history.fStartDate',
  endDate: 'history.fEndDate',
  note: 'history.fNote',
  status: 'history.fStatus',
  licenseModel: 'history.software.fLicenseModel',
  // Kỳ hạn/chi phí RIÊNG của một ghế (0027) — `device` là mã máy, đi kèm làm bối cảnh.
  device: 'history.software.fDevice',
  cost: 'history.software.fCost',
  contract: 'history.software.fContract',
  overSeatReason: 'history.software.fOverSeatReason',
};

export const ACTION_LABEL: Record<string, string> = {
  created: 'history.software.actCreated',
  updated: 'history.software.actUpdated',
  renewed: 'history.software.actRenewed',
  // Hệ thống tự chuyển theo hạn (DOM-03), actor là `system`.
  expired: 'history.software.actExpired',
  reactivated: 'history.software.actReactivated',
  // Ba hành động này vẫn ghi vào lịch sử từ story 3.2 nhưng chưa bao giờ có nhãn — tab
  // Lịch sử hiện thẳng mã thô "license-assigned" cho người dùng đọc.
  'license-assigned': 'history.software.actLicenseAssigned',
  'license-released': 'history.software.actLicenseReleased',
  'license-terms-updated': 'history.software.actLicenseTermsUpdated',
};

const KIND_LABEL: Record<string, string> = {
  license: 'history.software.kindLicense',
  ssl: 'history.software.kindSsl',
  domain: 'history.software.kindDomain',
  maintenance: 'history.software.kindMaintenance',
  other: 'history.software.kindOther',
};

const LICENSE_MODEL_LABEL: Record<string, string> = {
  subscription: 'history.software.lmSubscription',
  perpetual: 'history.software.lmPerpetual',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'history.software.stActive',
  expired_ok: 'history.software.stExpiredOk',
  retired: 'history.software.stRetired',
};

/*
 * `t` đi vào bằng THAM SỐ, không phải `useTranslation()` bên trong: mấy hàm này là hàm THUẦN,
 * và đó là lý do chúng có bài kiểm bảng dữ liệu không cần dựng React. Gọi hook ở đây là biến
 * chúng thành component và mất luôn cái đó.
 */
export function toSoftwareHistory(rows: SoftwareHistoryRow[], t: TFunction): HistoryEntry[] {
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actor: row.actor,
    action: ACTION_LABEL[row.action] ? t(ACTION_LABEL[row.action]) : row.action,
    detail: describe(row.changes, t),
  }));
}

/** Nhãn + cách đọc riêng của màn phần mềm; phần chung ở `ui/history-changes.ts` (AD-15). */
function describe(changes: FieldChanges, t: TFunction): string | null {
  return describeFieldChanges(changes, t, {
    label: (field) => (FIELD_LABEL[field] ? t(FIELD_LABEL[field]) : field),
    display: (field, value) => {
      // `cost` = 0 là giá trị THẬT (license tặng kèm máy) — không được rơi vào "(trống)".
      if (field === 'cost' && typeof value === 'number') return formatMoney(value);
      if (value === null || value === undefined || value === '') return undefined;
      const table =
        field === 'kind'
          ? KIND_LABEL
          : field === 'licenseModel'
            ? LICENSE_MODEL_LABEL
            : field === 'status'
              ? STATUS_LABEL
              : null;
      if (!table) return undefined;
      const key = table[String(value)];
      return key ? t(key) : String(value);
    },
    // Ghế nào của license 10 chỗ — trường không đổi đi kèm để chỉ rõ đang nói về cái nào.
    unchangedAsContext: true,
  });
}

