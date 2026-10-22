import { cellText, pickCell, stripDiacritics, type ParsedSheets } from '../../common/import-plan';
import { findSheet, importableRows, readImportFields, type ImportField } from '../../common/import-fields';
import type { ExportColumn } from '../../common/excel/excel-export.service';
import type { ServiceAccountKind } from './service-account-rules';
import type { ServiceAccountInput, ServiceAccountRecord } from './service-account.types';

/** Tên sheet — đúng tên sheet của file Xuất, để xuất ra sửa rồi nhập lại được (UX-E30). */
export const SERVICE_ACCOUNT_SHEET = 'Tài khoản dịch vụ';

const KIND_LABEL: Record<string, string> = { shared: 'Dùng chung', vpn: 'VPN' };
const STATUS_LABEL: Record<string, string> = { active: 'Đang dùng', disabled: 'Đã ngừng dùng' };

/** Cột của file Xuất = cột của file mẫu Nhập: một bộ, không hai (UX-E30). */
export function serviceAccountExportColumns(): ExportColumn<ServiceAccountRecord>[] {
  return [
    { header: 'Mã', width: 18, value: (r) => r.code },
    { header: 'Tên', width: 28, value: (r) => r.name },
    { header: 'Loại', width: 12, value: (r) => KIND_LABEL[r.kind] ?? r.kind },
    { header: 'Tên đăng nhập', width: 28, value: (r) => r.login ?? '' },
    { header: 'Phòng ban', width: 20, value: (r) => r.department ?? '' },
    { header: 'Người phụ trách', width: 22, value: (r) => r.ownerName ?? '' },
    { header: 'Nhóm VPN', width: 18, value: (r) => r.groupName ?? '' },
    { header: 'Dải IP được phép', width: 28, value: (r) => r.allowedIps ?? '' },
    { header: 'Trạng thái', width: 16, value: (r) => STATUS_LABEL[r.status] ?? r.status },
    { header: 'Hết hạn', width: 14, value: (r) => r.endDate ?? '' },
    { header: 'Ghi chú', width: 30, value: (r) => r.note ?? '' },
  ];
}

/** Ô vắng cột = "đừng đụng tới"; có cột mà trống = xoá. `kind` vắng thì service lấy loại đang có. */
export type ServiceAccountImportInput = Omit<ServiceAccountInput, 'kind'> & { kind?: ServiceAccountKind };

export interface ServiceAccountParsedRow {
  rowNumber: number;
  input?: ServiceAccountImportInput;
  error?: string;
}

type FieldKey = Exclude<keyof ServiceAccountImportInput, 'kind'>;

/** Nhãn = tiêu đề của file Xuất; trần độ dài và cột chặn mật khẩu = DTO của form. */
const FIELDS: ImportField<FieldKey>[] = [
  { key: 'code', label: 'Mã', max: 64 },
  { key: 'name', label: 'Tên', max: 160 },
  { key: 'login', label: 'Tên đăng nhập', max: 160 },
  { key: 'department', label: 'Phòng ban', max: 120 },
  { key: 'ownerName', label: 'Người phụ trách', max: 120 },
  { key: 'groupName', label: 'Nhóm VPN', max: 120 },
  { key: 'allowedIps', label: 'Dải IP được phép', max: 2000 },
  { key: 'note', label: 'Ghi chú', max: 2000, noSecret: true },
  { key: 'endDate', label: 'Hết hạn', kind: 'date' },
];

/** Nhãn loại của file Xuất ("Dùng chung", "VPN"), nhận cả mã máy. */
function kindOf(text: string): ServiceAccountKind | null {
  const key = stripDiacritics(text.trim().toLowerCase());
  if (['dung chung', 'tai khoan dung chung', 'shared'].includes(key)) return 'shared';
  if (['vpn', 'tai khoan vpn'].includes(key)) return 'vpn';
  return null;
}

/**
 * Đọc sheet "Tài khoản dịch vụ" thành ô nhập của từng dòng. Chỉ ĐỌC: ghép với hồ sơ đang có và
 * kiểm luật là `prepare()` của service — cùng một luật với form, không bản thứ hai.
 * Cột "Trạng thái" của file Xuất bị bỏ qua: đổi trạng thái chỉ qua Ngừng dùng / Dùng lại, hai
 * đường bắt ghi lý do. `null` = file không có sheet đúng tên.
 */
export function parseServiceAccountSheet(sheets: ParsedSheets): ServiceAccountParsedRow[] | null {
  const rows = findSheet(sheets, SERVICE_ACCOUNT_SHEET);
  if (rows === undefined) return null;
  return importableRows(rows).map((row): ServiceAccountParsedRow => {
    const read = readImportFields(row, FIELDS);
    if (read.error) return { rowNumber: row.rowNumber, error: read.error };
    const input = read.cells as ServiceAccountImportInput;
    const kindRaw = pickCell(row.cells, ['loại']);
    if (kindRaw !== undefined && cellText(kindRaw) !== '') {
      const kind = kindOf(kindRaw);
      if (!kind) return { rowNumber: row.rowNumber, error: `Cột "Loại": "${cellText(kindRaw)}" không phải "Dùng chung" hay "VPN".` };
      input.kind = kind;
    }
    return { rowNumber: row.rowNumber, input };
  });
}
