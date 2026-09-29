import type { ExportColumn } from '../../common/excel/excel-export.service';
import { dateTimeInTz } from '../../common/today';
import type { AssignmentRow } from './license-assignment.service';

/** Dòng tổng cuối file — cùng bộ cột với ghế, chỉ ô đầu và ô chi phí có giá trị. */
type TotalRow = { total: true; count: number; cost: number };
type ExportRow = AssignmentRow | TotalRow;

const isTotal = (row: ExportRow): row is TotalRow => 'total' in row;

/**
 * File "máy đang dùng license này" nộp kiểm toán (SW-057): mỗi ghế một dòng, dòng cuối là tổng
 * số máy + tổng chi phí — câu "license này tốn bao nhiêu" không phải tự cộng tay trong Excel.
 * Chi phí ghi SỐ (không định dạng chuỗi) để Excel cộng/lọc tiếp được. Giờ gán theo
 * `app.timezone` — ExcelJS nhận `Date` thô sẽ quy về UTC và lệch với màn hình.
 */
export function assignmentExportSheet(
  seats: AssignmentRow[],
  timeZone: string,
): { columns: ExportColumn<ExportRow>[]; rows: ExportRow[] } {
  const seat = <T>(pick: (row: AssignmentRow) => T, total: (row: TotalRow) => T | '' = () => '') =>
    (row: ExportRow) => (isTotal(row) ? total(row) : pick(row)) as string | number | null;
  const columns: ExportColumn<ExportRow>[] = [
    { header: 'Mã máy', width: 20, value: seat((r) => r.deviceCode, (r) => `Tổng: ${r.count} máy`) },
    { header: 'Tên máy', width: 28, value: seat((r) => r.deviceName) },
    { header: 'Người dùng máy', width: 24, value: seat((r) => r.deviceAssignedTo ?? '') },
    { header: 'Chi phí (₫)', width: 16, value: seat((r) => r.cost, (r) => r.cost) },
    { header: 'Số hợp đồng', width: 18, value: seat((r) => r.contract ?? '') },
    { header: 'Bắt đầu ghế', width: 14, value: seat((r) => r.startDate ?? '') },
    { header: 'Hết hạn ghế', width: 14, value: seat((r) => r.endDate ?? '') },
    { header: 'Gán lúc', width: 18, value: seat((r) => dateTimeInTz(r.assignedAt, timeZone)) },
    { header: 'Gán bởi', width: 28, value: seat((r) => r.assignedBy) },
    { header: 'Ghi chú', width: 36, value: seat((r) => r.note ?? '') },
  ];
  if (seats.length === 0) return { columns, rows: [] };
  const total: TotalRow = {
    total: true,
    count: seats.length,
    cost: seats.reduce((sum, row) => sum + (row.cost ?? 0), 0),
  };
  return { columns, rows: [...seats, total] };
}
