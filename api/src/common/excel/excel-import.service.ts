import { BadRequestException, Injectable } from '@nestjs/common';
import { inflateRawSync } from 'node:zlib';
import * as ExcelJS from 'exceljs';
import { EXCEL_UNREADABLE_MESSAGE } from './xlsx-http';

/** Một dòng dữ liệu đã đọc: số dòng THẬT trong sheet + ô theo tên cột ở dòng tiêu đề. */
interface SheetRow {
  rowNumber: number;
  cells: Record<string, string>;
  /**
   * Ô KHÔNG đọc được giá trị (công thức chưa có kết quả tính sẵn, ô lỗi `#N/A`…), theo tên cột
   * → câu mô tả. Ô đó vẫn là `''` trong `cells`, nên lõi `plan*Import` phải xem ở đây trước:
   * coi nó là "ô trống" thì nhập lại sẽ XOÁ giá trị đang có mà không ai hay.
   */
  unreadable?: Record<string, string>;
}

export type SheetData = Record<string, SheetRow[]>;

/**
 * Trần chống zip-bomb / file khổng lồ làm nghẽn worker (khớp trần upload 10MB ở `XLSX_UPLOAD_LIMIT`).
 * Vượt trần thì từ chối CẢ file: cắt bớt thì người dùng thấy "nhập xong" mà phần đuôi mất lặng lẽ.
 */
export const MAX_ROWS_PER_SHEET = 20_000;

/**
 * Trần tổng dung lượng GIẢI NÉN của file xlsx, xét từ mục lục zip trước khi nạp. Trần dòng ở trên
 * chỉ xét được SAU khi ExcelJS đã giải nén cả file vào RAM: file 10 MB nén toàn chữ lặp có thể nở ra
 * hàng trăm MB và làm api (mem_limit 768m) bị OOM-kill. File thật 20.000 dòng nằm xa dưới trần này.
 */
export const MAX_UNZIPPED_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5_000;

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
    assertUnzippedSizeWithin(buffer);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException({
        code: 'EXCEL_UNREADABLE',
        message: EXCEL_UNREADABLE_MESSAGE,
      });
    }

    const out: SheetData = {};
    wb.eachSheet((sheet) => {
      const headers = readHeaders(sheet);
      if (headers.length === 0) return;

      const rows: SheetRow[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (rows.length >= MAX_ROWS_PER_SHEET) throw tooManyRows(sheet.name);
        const cells: Record<string, string> = {};
        let unreadable: Record<string, string> | undefined;
        headers.forEach((header, index) => {
          if (!header) return;
          const value = row.getCell(index + 1).value;
          cells[header] = cellToText(value);
          const problem = cellProblem(value);
          if (problem) (unreadable ??= {})[header] = problem;
        });
        rows.push(unreadable ? { rowNumber, cells, unreadable } : { rowNumber, cells });
      });
      out[sheet.name] = rows;
    });
    return out;
  }
}

function tooLarge(): BadRequestException {
  return new BadRequestException({
    code: 'EXCEL_TOO_LARGE',
    message: `File Excel giải nén ra hơn ${MAX_UNZIPPED_BYTES / 1024 / 1024} MB, vượt trần một lần nhập. Chia thành nhiều file rồi nhập lần lượt. Chưa ghi gì cả.`,
  });
}

/**
 * Đo dung lượng giải nén THẬT của từng mục trong zip, có trần, trước khi đưa cho ExcelJS. Không tin số
 * khai trong mục lục: khai gian số nhỏ thì thư viện zip chỉ phát hiện lệch SAU khi đã giải nén hết vào
 * RAM. `maxOutputLength` dừng giải nén ngay khi vượt phần trần còn lại, nên bộ nhớ dùng ở đây không quá
 * trần.
 */
function assertUnzippedSizeWithin(buffer: Buffer): void {
  const END = 0x06054b50;
  const ENTRY = 0x02014b50;
  const LOCAL = 0x04034b50;
  const searchFrom = Math.max(0, buffer.length - 22 - 0xffff);
  let end = -1;
  for (let at = buffer.length - 22; at >= searchFrom; at -= 1) {
    if (buffer.readUInt32LE(at) === END) {
      end = at;
      break;
    }
  }
  // Không có mục lục thì cũng không phải zip: để ExcelJS báo "không đọc được" như cũ.
  if (end < 0) return;
  const directoryAt = buffer.readUInt32LE(end + 16);
  // ZIP64 (offset / số mục bão hoà): file xlsx thật không bao giờ cần tới, coi là quá trần.
  if (directoryAt === 0xffffffff || buffer.readUInt16LE(end + 10) === 0xffff) throw tooLarge();
  if (directoryAt > end) throw unreadable();
  /*
   * Duyệt mục lục theo CHỮ KÝ tới tận EOCD, không theo số mục khai trong EOCD: thư viện zip đọc
   * mọi mục còn khớp chữ ký, nên khai "1 mục" là giấu được mục bomb phía sau. Gặp chỗ không đọc
   * được thì TỪ CHỐI (không "để ExcelJS lo"): file lạ ở đây là file cố tình.
   */
  let at = directoryAt;
  let total = 0;
  let entries = 0;
  while (at < end) {
    if (at + 46 > end || buffer.readUInt32LE(at) !== ENTRY) throw unreadable();
    entries += 1;
    if (entries > MAX_ZIP_ENTRIES) throw tooLarge();
    const method = buffer.readUInt16LE(at + 10);
    const packedSize = buffer.readUInt32LE(at + 20);
    const local = buffer.readUInt32LE(at + 42);
    at += 46 + buffer.readUInt16LE(at + 28) + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
    if (packedSize === 0xffffffff || local === 0xffffffff) throw tooLarge();
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== LOCAL) throw unreadable();
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const packed = buffer.subarray(dataStart, dataStart + packedSize);
    let size: number;
    if (method === 0) {
      size = packed.length;
    } else if (method === 8) {
      try {
        size = inflateRawSync(packed, { maxOutputLength: MAX_UNZIPPED_BYTES - total + 1 }).length;
      } catch (error) {
        if (error instanceof RangeError || (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw tooLarge();
        throw unreadable();
      }
    } else {
      throw unreadable();
    }
    total += size;
    if (total > MAX_UNZIPPED_BYTES) throw tooLarge();
  }
}

function unreadable(): BadRequestException {
  return new BadRequestException({ code: 'EXCEL_UNREADABLE', message: EXCEL_UNREADABLE_MESSAGE });
}

function tooManyRows(sheetName: string): BadRequestException {
  return new BadRequestException({
    code: 'EXCEL_TOO_MANY_ROWS',
    message: `Sheet "${sheetName}" có hơn ${MAX_ROWS_PER_SHEET.toLocaleString('vi-VN')} dòng dữ liệu, vượt trần một lần nhập. Chia thành nhiều file rồi nhập lần lượt. Chưa ghi gì cả.`,
  });
}

/**
 * Ô có giá trị mà ta KHÔNG đọc ra được: ô lỗi, hoặc công thức không có kết quả tính sẵn (file
 * sinh bằng công cụ không tính công thức, hay Excel để chế độ tính tay). exceljs không tự tính
 * công thức, nên đoán giá trị là đoán mò.
 *
 * Công thức cho ra chuỗi rỗng cũng rơi vào đây: file xlsx không lưu kết quả rỗng, nên không
 * phân biệt được với "chưa tính". Báo lỗi còn hơn xoá dữ liệu thật.
 */
function cellProblem(value: ExcelJS.CellValue): string | null {
  if (value === null || typeof value !== 'object' || value instanceof Date) return null;
  const obj = value as unknown as Record<string, unknown>;
  if (typeof obj.error === 'string') return `ô đang báo lỗi ${obj.error}`;
  if ('formula' in obj || 'sharedFormula' in obj) {
    if (obj.result === undefined || obj.result === null || obj.result === '') {
      return 'ô là công thức chưa có giá trị tính sẵn';
    }
    return cellProblem(obj.result as ExcelJS.CellValue);
  }
  return null;
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
