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
] as const;

export type { RecordChanges as DeviceChanges } from '../../common/record-diff';
export { hasChanges };

export function diffDevice(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): RecordChanges {
  return diffRecord(TRACKED_FIELDS, before, after);
}
