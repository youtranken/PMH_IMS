import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

/** Một dòng dữ liệu đã đọc: số dòng THẬT trong sheet + ô theo tên cột ở dòng tiêu đề. */
export interface SheetRow {
  rowNumber: number;
  cells: Record<string, string>;
}

export type SheetData = Record<string, SheetRow[]>;

/** Trần chống zip-bomb / file khổng lồ làm nghẽn worker (khớp trần upload 20MB của NFR-4). */
const MAX_ROWS_PER_SHEET = 20_000;

/**
 * AD-15: nơi DUY NHẤT đọc file xlsx (đối xứng với ExcelExportService là nơi duy nhất ghi).
 * Import danh mục (2.1) và import thiết bị (2.6) dùng chung — hai bộ parser riêng thì
 * cùng một file lại "hợp lệ ở màn này, sai ở màn kia".
 *
 * Trả về DỮ LIỆU THÔ dạng chuỗi. Mọi việc hiểu nghĩa (bắt buộc, số, có/không, đối chiếu
 * danh mục) là của lõi `plan*Import` thuần — để test được bằng bảng dữ liệu, không cần file.
 */
@Injectable()
export class ExcelImportService {
  async read(buffer: Buffer): Promise<SheetData> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException({
        code: 'EXCEL_UNREADABLE',
        message: 'Không đọc được file. Hãy lưu lại dạng .xlsx rồi tải lên lần nữa.',
      });
    }

    const out: SheetData = {};
    wb.eachSheet((sheet) => {
      const headers = readHeaders(sheet);
      if (headers.length === 0) return;

      const rows: SheetRow[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1 || rows.length >= MAX_ROWS_PER_SHEET) return;
        const cells: Record<string, string> = {};
        headers.forEach((header, index) => {
          if (!header) return;
          cells[header] = cellToText(row.getCell(index + 1).value);
        });
        rows.push({ rowNumber, cells });
      });
      out[sheet.name] = rows;
    });
    return out;
  }
}

function readHeaders(sheet: ExcelJS.Worksheet): string[] {
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellToText(cell.value);
  });
  // Cột trống ở giữa vẫn giữ chỗ (để index cột khớp), nhưng nếu CẢ dòng trống thì bỏ sheet.
  return headers.some((h) => h !== '') ? headers : [];
}

/**
 * Ô Excel về chuỗi. exceljs trả về nhiều hình dạng khác nhau cho cùng một thứ người dùng
 * nhìn thấy: số, ngày, công thức `{result}`, rich text `{richText:[…]}`, hyperlink `{text}`.
 * Không quy về một kiểu ở đây thì mỗi chỗ dùng lại tự đoán một kiểu.
 */
function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return stripLeadingQuote(value.trim());
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  const obj = value as unknown as Record<string, unknown>;
  if (typeof obj.text === 'string') return stripLeadingQuote(obj.text.trim());
  if (Array.isArray(obj.richText)) {
    return stripLeadingQuote(
      obj.richText
        .map((part) => {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        })
        .join('')
        .trim(),
    );
  }
  if ('result' in obj) return cellToText(obj.result as ExcelJS.CellValue);
  if ('hyperlink' in obj && typeof obj.hyperlink === 'string') return obj.hyperlink;
  return '';
}

/**
 * Bỏ dấu nháy đơn dẫn đầu do `sanitize()` thêm vào lúc EXPORT (chống formula injection).
 * Không bỏ thì xuất ra rồi nhập lại chính file đó sẽ biến "+84901234567" thành
 * "'+84901234567" — vòng export→import phải khép kín.
 */
function stripLeadingQuote(value: string): string {
  return value.startsWith("'") ? value.slice(1) : value;
}
