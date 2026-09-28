import type { TFunction } from 'i18next';
import type { HistoryEntry } from '@/ui/history-panel';
import type { DeviceHistoryRow } from '@/lib/device-types';
import { describeFieldChanges, type FieldChanges } from '@/ui/history-changes';

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
    action: actionText(row, t),
    detail: detailText(row, t),
  }));
}

/** Việc với một cổng cụ thể: tên cổng nằm NGAY trong câu ("Thêm cổng Gi1/0/10"). */
const PORT_ACTION: Record<string, string> = {
  'port-added': 'history.devices.actPortAddedOf',
  'port-updated': 'history.devices.actPortUpdatedOf',
  'port-removed': 'history.devices.actPortRemovedOf',
};

function actionText(row: DeviceHistoryRow, t: TFunction): string {
  const portKey = PORT_ACTION[row.action];
  const port = row.changes?.portLabel;
  const label = port ? (port.after ?? port.before) : null;
  if (portKey && label) return t(portKey, { port: String(label) });
  /* Mã lạ (migration sau, dữ liệu cũ) GIỮ NGUYÊN — hiện mã còn hơn hiện ô trống. */
  return ACTION_LABEL[row.action] ? t(ACTION_LABEL[row.action]) : row.action;
}

function detailText(row: DeviceHistoryRow, t: TFunction): string | null {
  /* Tạo hồ sơ: liệt kê "(trống) → …" cho từng ô chỉ là đọc lại hồ sơ dưới dạng khó đọc hơn. */
  if (row.action === 'created' || row.action === 'imported') return null;
  const changes = row.changes ? { ...row.changes } : null;
  if (changes && PORT_ACTION[row.action]) {
    // Tên cổng đã nằm trong câu hành động; chỉ còn in nó nếu chính nó bị đổi.
    const port = changes.portLabel;
    if (port && (port.before === null || port.after === null || port.before === port.after)) {
      delete changes.portLabel;
    }
  }
  /* Cờ kỹ thuật "cleanup" của lượt thanh lý: nói ra bằng câu, không phải "true". */
  const cleaned = changes?.cleanup?.after === true;
  if (changes) delete changes.cleanup;
  const described = describeChanges(changes && Object.keys(changes).length > 0 ? changes : null, t);
  const extra = cleaned ? t('devices.retiredCleaned') : null;
  return [described, extra].filter(Boolean).join('; ') || null;
}

/** Nhãn + cách đọc riêng của màn thiết bị; phần chung ở `ui/history-changes.ts` (AD-15). */
function describeChanges(changes: FieldChanges, t: TFunction): string | null {
  return describeFieldChanges(changes, t, {
    label: (field) => (FIELD_LABEL[field] ? t(FIELD_LABEL[field]) : field),
    display: (field, value) => {
      if (field !== 'status' || value === null || value === undefined || value === '') return undefined;
      const key = STATUS_LABEL[String(value)];
      return key ? t(key) : String(value);
    },
  });
}

