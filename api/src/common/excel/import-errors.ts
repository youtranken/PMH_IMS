import type { ExcelExportService } from './excel-export.service';

/** Một dòng lỗi của bảng đối chiếu nhập Excel — đủ để mở file gốc ra sửa đúng chỗ. */
export interface ImportErrorLine {
  /** Tên sheet như trong file mẫu ("Tủ mạng", "Thiết bị"). */
  sheet: string;
  rowNumber: number;
  label: string;
  message: string;
}

/** Lọc dòng lỗi từ bảng đối chiếu (giữ thứ tự file) — dùng chung cho nhập danh mục và thiết bị. */
export function importErrorRows(
  rows: { sheet: string; rowNumber: number; action: string; label: string; message?: string }[],
): ImportErrorLine[] {
  return rows
    .filter((row) => row.action === 'error')
    .map((row) => ({
      sheet: row.sheet,
      rowNumber: row.rowNumber,
      label: row.label,
      message: row.message ?? '',
    }));
}

/**
 * File "dòng lỗi" của một lượt đối chiếu: Sheet · Dòng · Mục · Lý do. Không ghi gì, không đọc
 * gì ngoài chính file người dùng vừa gửi — nên không đi qua `@Audited` như file xuất dữ liệu.
 */
export function buildImportErrorsXlsx(
  excel: ExcelExportService,
  rows: ImportErrorLine[],
): Promise<Buffer> {
  return excel.build<ImportErrorLine>({
    sheetName: 'Dong loi',
    columns: [
      { header: 'Sheet', width: 16, value: (row) => row.sheet },
      { header: 'Dòng', width: 8, value: (row) => row.rowNumber },
      { header: 'Mục', width: 28, value: (row) => row.label },
      { header: 'Lý do', width: 60, value: (row) => row.message },
    ],
    rows,
  });
}
