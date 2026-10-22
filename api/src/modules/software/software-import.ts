import { findSheet, importableRows, readImportFields, type ImportField } from '../../common/import-fields';
import { stripDiacritics, type ParsedRow, type ParsedSheets } from '../../common/import-plan';
import type { ExportColumn } from '../../common/excel/excel-export.service';
import { KIND_LABEL, SOFTWARE_KINDS, STATUS_LABEL, type SoftwareKind, type softwareExportShape } from './software-rules';
import type { SoftwareListItem } from './software.types';

/**
 * Bốn sheet của file Xuất bốn màn (Q-22, `softwareExportShape`) — file nào cũng nhập lại được.
 * Loại mặc định khi file không có cột "Loại"; "Tên miền & SSL" không có mặc định (hai loại).
 */
const SHEETS: { name: string; kind: SoftwareKind | null }[] = [
  { name: 'Phần mềm', kind: 'license' },
  { name: 'Tên miền & SSL', kind: null },
  { name: 'Hợp đồng bảo trì', kind: 'maintenance' },
  { name: 'Dịch vụ có hạn khác', kind: 'other' },
];

function seatText(row: { seatTotal: number | null; seatUsed?: number | null }): string {
  if (row.seatTotal === null) return '';
  return `${row.seatUsed ?? 0}/${row.seatTotal}`;
}

/** Cột của file Xuất từng màn = cột của file mẫu Nhập: một bộ, không hai (UX-E30). */
export function softwareExportColumns(
  shape: ReturnType<typeof softwareExportShape>,
): ExportColumn<SoftwareListItem & { seatUsed?: number | null }>[] {
  type Row = SoftwareListItem & { seatUsed?: number | null };
  return [
    { header: 'Mã hồ sơ', width: 20, value: (r) => r.code },
    { header: 'Tên', width: 32, value: (r) => r.name },
    { header: 'Loại', width: 16, value: (r) => KIND_LABEL[r.kind] },
    { header: 'Nhà cung cấp', width: 22, value: (r) => r.vendorName ?? '' },
    ...(shape.seats ? [{ header: 'Ghế dùng/tổng', width: 14, value: (r: Row) => seatText(r) }] : []),
    { header: 'Bắt đầu', width: 14, value: (r) => r.startDate ?? '' },
    { header: 'Hết hạn', width: 14, value: (r) => r.endDate ?? '' },
    { header: 'Trạng thái', width: 18, value: (r) => STATUS_LABEL[r.status] },
    // Q-22: một hồ sơ = các tên miền dùng chung một ngày hết hạn — cùng danh sách với hồ sơ.
    ...(shape.websites ? [{ header: 'Tên miền', width: 36, value: (r: Row) => (r.websites ?? []).join(', ') }] : []),
    { header: 'Ghi chú', width: 40, value: (r) => r.note ?? '' },
  ];
}

type Key = 'code' | 'name' | 'kindText' | 'vendor' | 'seats' | 'startDate' | 'endDate' | 'websites' | 'note';

/** Nhãn = tiêu đề file Xuất; trần độ dài và cột chặn mật khẩu = DTO của form. */
const FIELDS: ImportField<Key>[] = [
  { key: 'code', label: 'Mã hồ sơ', max: 60 },
  { key: 'name', label: 'Tên', max: 200 },
  { key: 'kindText', label: 'Loại', max: 40 },
  { key: 'vendor', label: 'Nhà cung cấp', max: 160 },
  { key: 'seats', label: 'Ghế dùng/tổng', max: 20 },
  { key: 'startDate', label: 'Bắt đầu', kind: 'date' },
  { key: 'endDate', label: 'Hết hạn', kind: 'date' },
  { key: 'websites', label: 'Tên miền', kind: 'list' },
  { key: 'note', label: 'Ghi chú', max: 2000, noSecret: true },
];

/** Ô của một dòng: nhà cung cấp còn ở dạng TÊN — service dịch ra id rồi đi qua `prepare()`. */
export interface SoftwareImportCells {
  code?: string;
  name?: string;
  kind?: SoftwareKind;
  vendor?: string;
  /** `null` = không giới hạn ghế (ô trống). */
  seatTotal?: number | null;
  startDate?: string;
  endDate?: string;
  websites?: string[];
  note?: string;
}

export interface SoftwareParsedRow {
  rowNumber: number;
  sheet: string;
  cells?: SoftwareImportCells;
  error?: string;
}

function kindOf(text: string): SoftwareKind | null {
  const key = stripDiacritics(text.trim().toLowerCase());
  return (
    SOFTWARE_KINDS.find((kind) => kind === key || stripDiacritics(KIND_LABEL[kind].toLowerCase()) === key) ??
    null
  );
}

/** "3/10" (dùng/tổng của file Xuất) hoặc "10" → 10; trống → null (không giới hạn). */
function seatTotalOf(text: string): number | null | 'bad' {
  if (text === '') return null;
  const match = /^(?:\d+\s*\/\s*)?(\d+)$/.exec(text.trim());
  return match ? Number(match[1]) : 'bad';
}

function parseRow(row: ParsedRow, sheet: string, fallback: SoftwareKind | null): SoftwareParsedRow {
  const read = readImportFields(row, FIELDS);
  if (read.error) return { rowNumber: row.rowNumber, sheet, error: read.error };
  const { kindText, seats, ...rest } = read.cells as Omit<SoftwareImportCells, 'kind' | 'seatTotal'> & {
    kindText?: string;
    seats?: string;
  };
  const cells: SoftwareImportCells = { ...rest };
  if (kindText) {
    const kind = kindOf(kindText);
    if (!kind) return { rowNumber: row.rowNumber, sheet, error: `Cột "Loại": "${kindText}" không phải loại hồ sơ của IMS.` };
    cells.kind = kind;
  } else if (fallback) {
    cells.kind = fallback;
  }
  if (seats !== undefined) {
    const total = seatTotalOf(seats);
    if (total === 'bad') return { rowNumber: row.rowNumber, sheet, error: 'Cột "Ghế dùng/tổng" phải là số ghế (vd 10 hoặc 3/10); trống = không giới hạn.' };
    cells.seatTotal = total;
  }
  return { rowNumber: row.rowNumber, sheet, cells };
}

/**
 * Đọc file Phần mềm thành ô nhập của từng dòng (UX-E30). Chỉ ĐỌC: dịch tên nhà cung cấp ra id,
 * ghép với hồ sơ đang có và kiểm luật là `prepare()` của service. Cột "Trạng thái" bị bỏ qua:
 * trạng thái do hạn tính ra, thanh lý đi đường riêng. `null` = không có sheet nào trong bốn tên.
 */
export function parseSoftwareSheets(sheets: ParsedSheets): SoftwareParsedRow[] | null {
  const present = SHEETS.flatMap((spec) => {
    const rows = findSheet(sheets, spec.name);
    return rows === undefined ? [] : [{ ...spec, rows }];
  });
  if (present.length === 0) return null;
  return present.flatMap((spec) => importableRows(spec.rows).map((row) => parseRow(row, spec.name, spec.kind)));
}
