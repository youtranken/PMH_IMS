import type { TFunction } from 'i18next';
import type { HistoryEntry } from '@/ui/history-panel';
import type { DeviceHistoryRow } from '@/lib/device-types';

/**
 * Đổi bản ghi `device_history` thô thành dòng người đọc được cho `HistoryPanel` dùng chung.
 * Tách khỏi component để test được bằng bảng dữ liệu (không cần render).
 *
 * FR-007: tab Lịch sử để trả lời "ai đổi gì, lúc nào" — không phải để đọc JSON.
 */

/** Tên trường → nhãn tiếng Việt. Trường lạ giữ nguyên tên còn hơn giấu đi. */
const FIELD_LABEL: Record<string, string> = {
  code: 'history.devices.fCode',
  name: 'history.fName',
  deviceTypeId: 'history.devices.fDeviceTypeId',
  model: 'history.devices.fModel',
  serial: 'history.devices.fSerial',
  siteId: 'history.fSiteId',
  cabinetId: 'history.devices.fCabinetId',
  vendorId: 'history.fVendorId',
  assignedTo: 'history.devices.fAssignedTo',
  department: 'history.fDepartment',
  purchaseDate: 'history.devices.fPurchaseDate',
  warrantyStart: 'history.devices.fWarrantyStart',
  warrantyEnd: 'history.devices.fWarrantyEnd',
  status: 'history.fStatus',
  note: 'history.fNote',
  portLabel: 'history.devices.fPortLabel',
};

export const ACTION_LABEL: Record<string, string> = {
  created: 'history.devices.actCreated',
  updated: 'history.devices.actUpdated',
  'status-changed': 'history.devices.actStatusChanged',
  imported: 'history.devices.actImported',
  'imported-update': 'history.devices.actImportedUpdate',
  'port-added': 'history.devices.actPortAdded',
  'port-updated': 'history.devices.actPortUpdated',
  'port-removed': 'history.devices.actPortRemoved',
  /*
   * Dòng này do MÁY KHÁC sinh ra, không phải do ai sửa hồ sơ máy này: thanh lý một thiết bị
   * thì cổng bên máy còn lại bị gỡ liên kết (`port-device-retirement.ts`). Nhãn phải nói rõ
   * "vì sao tự nhiên cổng của tôi rời ra", nếu không người đọc đi tìm người đã sửa.
   */
  'port-unlinked': 'history.devices.actPortUnlinked',
};

const STATUS_LABEL: Record<string, string> = {
  in_use: 'history.devices.stInUse',
  spare: 'history.devices.stSpare',
  broken: 'history.devices.stBroken',
  retired: 'history.devices.stRetired',
};

/*
 * `t` đi vào bằng THAM SỐ, không phải `useTranslation()` bên trong.
 *
 * Mấy hàm này là hàm THUẦN, và đó là lý do chúng có bài kiểm bảng dữ liệu không cần dựng
 * React (`CLAUDE.md`: "Logic thuần phải có test bảng dữ liệu"). Gọi hook ở đây là biến chúng
 * thành component và mất luôn cái đó. Có tiền lệ trong repo: `catalog-screen.tsx` cũng nhận
 * `(t: TFunction) => …`.
 */
export function toHistoryEntries(rows: DeviceHistoryRow[], t: TFunction): HistoryEntry[] {
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actor: row.actor,
    /* Mã lạ (migration sau, dữ liệu cũ) GIỮ NGUYÊN — hiện mã còn hơn hiện ô trống. */
    action: ACTION_LABEL[row.action] ? t(ACTION_LABEL[row.action]) : row.action,
    detail: describeChanges(row.changes, t),
  }));
}

function describeChanges(
  changes: Record<string, { before: unknown; after: unknown }> | null,
  t: TFunction,
): string | null {
  if (!changes) return null;
  const parts = Object.entries(changes)
    // Id danh mục là chuỗi uuid, hiện ra chỉ tổ rối; nói rõ "đã đổi" là đủ dùng.
    .map(([field, change]) => {
      const label = FIELD_LABEL[field] ? t(FIELD_LABEL[field]) : field;
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
