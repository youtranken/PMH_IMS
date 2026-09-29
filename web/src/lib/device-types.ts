/** Vòng đời thiết bị — khớp `DEVICE_STATUSES` phía API. Không có "đã xóa". */
export const DEVICE_STATUSES = ['in_use', 'spare', 'broken', 'retired'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export interface DeviceRow {
  id: string;
  code: string;
  name: string;
  deviceTypeId: string;
  deviceTypeName: string;
  hasPortMap: boolean;
  model: string | null;
  serial: string | null;
  siteId: string | null;
  siteCode: string | null;
  cabinetId: string | null;
  cabinetCode: string | null;
  vendorId: string | null;
  vendorName: string | null;
  assignedTo: string | null;
  department: string | null;
  purchaseDate: string | null;
  warrantyStart: string | null;
  warrantyEnd: string | null;
  status: DeviceStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceWriteResult {
  device: DeviceRow;
  /** Cảnh báo không chặn lưu (vd serial trùng thiết bị khác). */
  warnings: string[];
}

export interface DeviceHistoryRow {
  id: string;
  action: string;
  actor: string;
  /** Họ tên người làm — API tra (`withActorNames`); vắng thì panel hiện email. */
  actorName?: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  createdAt: string;
}

/** Khóa i18n của nhãn trạng thái — nhãn không viết cứng trong component (UX-DR4). */
export const STATUS_KEY: Record<DeviceStatus, string> = {
  in_use: 'devices.statusInUse',
  spare: 'devices.statusSpare',
  broken: 'devices.statusBroken',
  retired: 'devices.statusRetired',
};

/** Tông màu badge trạng thái — dùng token qua class `.badge`, không hex (AD-15). */
export const STATUS_TONE: Record<DeviceStatus, string> = {
  in_use: 'ok',
  spare: 'info',
  broken: 'danger',
  retired: 'muted',
};

/** Vị trí đọc được: "PMH-HO · R01", hoặc chỉ site, hoặc gạch nếu chưa gán. */
export function locationLabel(device: {
  siteCode: string | null;
  cabinetCode: string | null;
}): string {
  if (device.siteCode && device.cabinetCode) return `${device.siteCode} · ${device.cabinetCode}`;
  return device.siteCode ?? '—';
}
