import { accessSummary, type AccessPoint } from './device-access';
import { portLayoutSummary, type PhysicalPort } from './port-template';
import { diffRecord, hasChanges, type RecordChanges } from '../../common/record-diff';

/**
 * Lịch sử hồ sơ thiết bị (AD-13) — phần riêng của thiết bị là DANH SÁCH TRƯỜNG được theo dõi;
 * luật so sánh dùng chung ở `common/record-diff` với phần mềm, ISP, IP (AD-15).
 */

/** Chỉ những trường này mới được ghi vào lịch sử (bỏ id, created_at, updated_at…). */
const TRACKED_FIELDS = [
  'code',
  'name',
  'deviceTypeId',
  'model',
  'serial',
  'siteId',
  'cabinetId',
  'vendorId',
  'assignedTo',
  'department',
  'purchaseDate',
  'warrantyStart',
  'warrantyEnd',
  'status',
  'note',
  'rackUStart',
  'rackUSize',
  'photoFrontFileId',
  'photoBackFileId',
  'deviceModelId',
] as const;

export type { RecordChanges as DeviceChanges } from '../../common/record-diff';
export { hasChanges };

export function diffDevice(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): RecordChanges {
  const changes = diffRecord(TRACKED_FIELDS, before, after);
  // `diffRecord` không so được mảng (coi mọi object là rỗng): so riêng, ghi chuỗi đọc được vào lịch sử.
  if ('accessPoints' in after) {
    const from = accessSummary((before.accessPoints as AccessPoint[] | undefined) ?? []);
    const to = accessSummary((after.accessPoints as AccessPoint[] | undefined) ?? []);
    if (from !== to) changes.accessPoints = { before: from || null, after: to || null };
  }
  if ('portLayout' in after) {
    const from = portLayoutSummary((before.portLayout as PhysicalPort[] | undefined) ?? []);
    const to = portLayoutSummary((after.portLayout as PhysicalPort[] | undefined) ?? []);
    if (from !== to) changes.portLayout = { before: from || null, after: to || null };
  }
  return changes;
}
