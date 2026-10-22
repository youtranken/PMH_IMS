import type { ExportColumn } from '../../common/excel/excel-export.service';
import { findSheet, importableRows, readImportFields, type ImportField } from '../../common/import-fields';
import { stripDiacritics, type ParsedSheets } from '../../common/import-plan';
import { normalizePhone, PHONE_MESSAGE } from '../../common/phone';
import type { IspLineListItem, IspStatus } from './isp-line.service';

/** Tên sheet — đúng tên sheet của file Xuất, để xuất ra sửa rồi nhập lại được (UX-E30). */
export const ISP_SHEET = 'Đường truyền';

const STATUS_LABEL: Record<IspStatus, string> = {
  active: 'Đang dùng',
  suspended: 'Tạm ngưng',
  terminated: 'Đã thanh lý',
};

/**
 * Bộ cột file Excel đường truyền = cột của file mẫu Nhập (một bộ, không hai). "Tốc độ gói cước"
 * chứ không "Băng thông" (Q-04): đó là tốc độ của gói cước line này, không phải của nhà mạng.
 * Nhãn trạng thái cùng chữ với màn `/isp-lines` (`isp.status*` trong `web/src/locales/vi.ts`).
 */
export const ISP_EXPORT_COLUMNS: ExportColumn<IspLineListItem>[] = [
  { header: 'Mã', width: 18, value: (r) => r.code },
  { header: 'Nhà mạng', width: 22, value: (r) => r.provider },
  { header: 'Tốc độ gói cước', width: 16, value: (r) => r.bandwidth ?? '' },
  // Mọi IP của đường trong MỘT ô (Q-20): một đường vẫn là một dòng, lọc/đếm theo dòng không lệch.
  { header: 'IP WAN', width: 24, value: (r) => r.wanIps.join(', ') },
  { header: 'Site', width: 12, value: (r) => r.siteCode ?? '' },
  { header: 'Thiết bị', width: 18, value: (r) => r.deviceCode ?? '' },
  { header: 'Hotline', width: 16, value: (r) => r.hotline ?? '' },
  { header: 'Số hợp đồng', width: 20, value: (r) => r.contractNo ?? '' },
  { header: 'Bắt đầu', width: 14, value: (r) => r.startDate ?? '' },
  { header: 'Trạng thái', width: 16, value: (r) => STATUS_LABEL[r.status] ?? r.status },
  { header: 'Ghi chú', width: 30, value: (r) => r.note ?? '' },
];

type Key =
  | 'code'
  | 'provider'
  | 'bandwidth'
  | 'wanIps'
  | 'site'
  | 'device'
  | 'hotline'
  | 'contractNo'
  | 'startDate'
  | 'statusText'
  | 'note';

/** Trần độ dài và cột chặn mật khẩu = `IspBodyDto` của form. */
const FIELDS: ImportField<Key>[] = [
  { key: 'code', label: 'Mã', max: 60 },
  { key: 'provider', label: 'Nhà mạng', max: 160 },
  { key: 'bandwidth', label: 'Tốc độ gói cước', max: 60 },
  { key: 'wanIps', label: 'IP WAN', kind: 'list' },
  { key: 'site', label: 'Site', max: 60 },
  { key: 'device', label: 'Thiết bị', max: 120 },
  { key: 'hotline', label: 'Hotline', max: 60 },
  { key: 'contractNo', label: 'Số hợp đồng', max: 80 },
  { key: 'startDate', label: 'Bắt đầu', kind: 'date' },
  { key: 'statusText', label: 'Trạng thái', max: 40 },
  { key: 'note', label: 'Ghi chú', max: 2000, noSecret: true },
];

/** Ô của một dòng: tham chiếu còn ở dạng TÊN / MÃ — service dịch ra id rồi đi qua `prepare()`. */
export interface IspImportCells {
  code?: string;
  provider?: string;
  bandwidth?: string;
  wanIps?: string[];
  site?: string;
  device?: string;
  hotline?: string;
  contractNo?: string;
  startDate?: string;
  status?: IspStatus;
  note?: string;
}

export interface IspParsedRow {
  rowNumber: number;
  cells?: IspImportCells;
  error?: string;
}

function statusOf(text: string): IspStatus | null {
  const key = stripDiacritics(text.trim().toLowerCase());
  const hit = (Object.entries(STATUS_LABEL) as [IspStatus, string][]).find(
    ([status, label]) => stripDiacritics(label.toLowerCase()) === key || status === key,
  );
  return hit ? hit[0] : null;
}

/**
 * Đọc sheet "Đường truyền" thành ô nhập của từng dòng. Chỉ ĐỌC: dịch tên / mã ra id, ghép với hồ
 * sơ đang có và kiểm luật là việc của service (`prepare()` của form). `null` = không có sheet.
 */
export function parseIspSheet(sheets: ParsedSheets): IspParsedRow[] | null {
  const rows = findSheet(sheets, ISP_SHEET);
  if (rows === undefined) return null;
  return importableRows(rows).map((row): IspParsedRow => {
    const read = readImportFields(row, FIELDS);
    if (read.error) return { rowNumber: row.rowNumber, error: read.error };
    const { statusText, hotline, ...rest } = read.cells as Omit<IspImportCells, 'status'> & { statusText?: string };
    const cells: IspImportCells = { ...rest };
    if (hotline !== undefined) {
      const phone = normalizePhone(hotline);
      if (phone.error) return { rowNumber: row.rowNumber, error: `Cột "Hotline": ${PHONE_MESSAGE}` };
      cells.hotline = phone.value ?? '';
    }
    if (statusText !== undefined && statusText !== '') {
      const status = statusOf(statusText);
      if (!status) return { rowNumber: row.rowNumber, error: `Cột "Trạng thái": "${statusText}" không phải Đang dùng / Tạm ngưng / Đã thanh lý.` };
      cells.status = status;
    }
    return { rowNumber: row.rowNumber, cells };
  });
}
