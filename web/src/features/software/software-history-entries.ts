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
  // Dòng gán/gỡ: API đã đổi `deviceId` thành mã máy (`history-device-codes.ts`).
  machine: 'history.software.fMachine',
  cost: 'history.software.fCost',
  contract: 'history.software.fContract',
  overSeatReason: 'history.software.fOverSeatReason',
  // API ghi danh sách website dạng chuỗi nối ", " (`websitesChange`).
  websites: 'history.software.fWebsites',
};

export const ACTION_LABEL: Record<string, string> = {
  created: 'history.software.actCreated',
  updated: 'history.software.actUpdated',
  renewed: 'history.software.actRenewed',
  // Hệ thống tự chuyển theo hạn (DOM-03), actor là `system`.
  expired: 'history.software.actExpired',
  reactivated: 'history.software.actReactivated',
  'auto-retired': 'history.software.actAutoRetired',
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
export function toSoftwareHistory(
  rows: SoftwareHistoryRow[],
  t: TFunction,
  /** Tên nhà cung cấp theo id (danh mục) — không có thì dòng đổi NCC chỉ nói "đổi nhà cung cấp". */
  vendorName?: (id: string) => string | undefined,
): HistoryEntry[] {
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actor: row.actor,
    action: ACTION_LABEL[row.action] ? t(ACTION_LABEL[row.action]) : row.action,
    detail: describe(prepare(row, vendorName), t, vendorName),
  }));
}

/** Nhóm của chip lọc tab Lịch sử: hạn (gia hạn, tự chuyển) · ghế · hồ sơ. */
export function softwareHistoryGroup(action: string): 'renew' | 'seat' | 'profile' {
  if (action.startsWith('license-')) return 'seat';
  if (['renewed', 'expired', 'reactivated', 'auto-retired'].includes(action)) return 'renew';
  return 'profile';
}

/**
 * Đổi `changes` thô về dạng đọc được TRƯỚC khi ghép câu:
 * - Tạo hồ sơ: chỉ giá trị ban đầu ("mã LIC-01"), không "(trống) → LIC-01" cho từng ô.
 * - Gán/gỡ ghế: "máy LT-05", không "ghế: (trống) → LT-05".
 * Cả hai dùng dạng "bối cảnh" (before = after) của `describeFieldChanges`.
 */
function prepare(
  row: SoftwareHistoryRow,
  vendorName?: (id: string) => string | undefined,
): FieldChanges {
  const changes = row.changes;
  if (!changes) return changes;
  if (row.action === 'created') {
    return Object.fromEntries(
      Object.entries(changes)
        .filter(([, change]) => change.after !== null && change.after !== undefined && change.after !== '')
        // Không tra được tên thì bỏ hẳn, đừng để lọt uuid thô ra màn hình.
        .filter(([field, change]) => field !== 'vendorId' || !!vendorName?.(String(change.after)))
        .map(([field, change]) => [
          field === 'vendorId' ? 'vendorAtCreate' : field,
          { before: change.after, after: change.after },
        ]),
    );
  }
  if ((row.action === 'license-assigned' || row.action === 'license-released') && changes.device) {
    const { device, ...rest } = changes;
    const code = device.after ?? device.before;
    return { machine: { before: code, after: code }, ...rest };
  }
  return changes;
}

/** Nhãn + cách đọc riêng của màn phần mềm; phần chung ở `ui/history-changes.ts` (AD-15). */
function describe(
  changes: FieldChanges,
  t: TFunction,
  vendorName?: (id: string) => string | undefined,
): string | null {
  return describeFieldChanges(changes, t, {
    label: (field) =>
      field === 'vendorAtCreate'
        ? t(FIELD_LABEL.vendorId)
        : FIELD_LABEL[field]
          ? t(FIELD_LABEL[field])
          : field,
    display: (field, value) => {
      if (field === 'vendorId' || field === 'vendorAtCreate') {
        if (value === null || value === undefined || value === '') return t('history.blank');
        return vendorName?.(String(value));
      }
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

